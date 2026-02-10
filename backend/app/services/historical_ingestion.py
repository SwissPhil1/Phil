"""
Historical ingestion - scrapes Senate eFD for transaction-level trade data.

The Senate eFD search (efdsearch.senate.gov) provides:
1. Paginated list of PTR (Periodic Transaction Report) filings per year
2. Individual PTR detail pages with HTML tables containing individual trades
   (ticker, date, amount, tx_type, asset description)

Coverage: 2012-present
"""

import asyncio
import logging
import re
from datetime import datetime

import httpx
from sqlalchemy import func, select
from app.models.database import dialect_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade, async_session

logger = logging.getLogger(__name__)

SENATE_EFD_HOME = "https://efdsearch.senate.gov/search/home/"
SENATE_EFD_DATA = "https://efdsearch.senate.gov/search/report/data/"

# Delay between requests to avoid rate limiting (seconds)
REQUEST_DELAY = 0.5

AMOUNT_RANGES = {
    "$1,001 - $15,000": (1001, 15000),
    "$15,001 - $50,000": (15001, 50000),
    "$50,001 - $100,000": (50001, 100000),
    "$100,001 - $250,000": (100001, 250000),
    "$250,001 - $500,000": (250001, 500000),
    "$500,001 - $1,000,000": (500001, 1000000),
    "$1,000,001 - $5,000,000": (1000001, 5000000),
    "$5,000,001 - $25,000,000": (5000001, 25000000),
    "$25,000,001 - $50,000,000": (25000001, 50000000),
    "$50,000,001 +": (50000001, None),
    "Over $50,000,000": (50000001, None),
}

# Known senator party affiliations (partial list, covers most active traders)
SENATOR_PARTIES = {
    "Tommy Tuberville": ("R", "AL"),
    "Markwayne Mullin": ("R", "OK"),
    "Pete Ricketts": ("R", "NE"),
    "Cynthia Lummis": ("R", "WY"),
    "Bill Hagerty": ("R", "TN"),
    "John Hickenlooper": ("D", "CO"),
    "Mark Kelly": ("D", "AZ"),
    "Gary Peters": ("D", "MI"),
    "Sheldon Whitehouse": ("D", "RI"),
    "Thomas Carper": ("D", "DE"),
    "John Hoeven": ("R", "ND"),
    "Susan Collins": ("R", "ME"),
    "Angus King": ("I", "ME"),
    "Jacky Rosen": ("D", "NV"),
    "Jerry Moran": ("R", "KS"),
    "Dan Sullivan": ("R", "AK"),
    "Rick Scott": ("R", "FL"),
    "Tim Scott": ("R", "SC"),
    "Mitt Romney": ("R", "UT"),
    "Ron Wyden": ("D", "OR"),
    "Dianne Feinstein": ("D", "CA"),
    "Pat Toomey": ("R", "PA"),
    "Richard Burr": ("R", "NC"),
    "Kelly Loeffler": ("R", "GA"),
    "David Perdue": ("R", "GA"),
    "James Inhofe": ("R", "OK"),
    "Rand Paul": ("R", "KY"),
    "John Boozman": ("R", "AR"),
    "Roger Marshall": ("R", "KS"),
    "Mitch McConnell": ("R", "KY"),
    "Ted Cruz": ("R", "TX"),
    "Kyrsten Sinema": ("I", "AZ"),
    "Jon Ossoff": ("D", "GA"),
    "Raphael Warnock": ("D", "GA"),
    "Tina Smith": ("D", "MN"),
    "Michael Bennet": ("D", "CO"),
    "Joe Manchin": ("D", "WV"),
    "Lindsey Graham": ("R", "SC"),
    "Chris Coons": ("D", "DE"),
    "Steve Daines": ("R", "MT"),
    "Debbie Stabenow": ("D", "MI"),
    "Thom Tillis": ("R", "NC"),
    "Mike Crapo": ("R", "ID"),
    "Marco Rubio": ("R", "FL"),
    "John Cornyn": ("R", "TX"),
    "Marsha Blackburn": ("R", "TN"),
    "Patrick Leahy": ("D", "VT"),
    "Patty Murray": ("D", "WA"),
    "Chuck Grassley": ("R", "IA"),
    "Sherrod Brown": ("D", "OH"),
    "Bob Casey": ("D", "PA"),
    "Elizabeth Warren": ("D", "MA"),
    "Bernie Sanders": ("I", "VT"),
    "Nancy Pelosi": ("D", "CA"),
    "Daniel Goldman": ("D", "NY"),
    "Josh Gottheimer": ("D", "NJ"),
    "Michael McCaul": ("R", "TX"),
    "Ro Khanna": ("D", "CA"),
    "Austin Scott": ("R", "GA"),
    "Kevin Hern": ("R", "OK"),
    "Virginia Foxx": ("R", "NC"),
    "Marjorie Taylor Greene": ("R", "GA"),
    "Greg Gianforte": ("R", "MT"),
}


# Build a lookup index: last_name -> (party, state) for fuzzy matching
_PARTY_BY_LAST_NAME: dict[str, tuple[str, str]] = {}
for _full_name, _info in SENATOR_PARTIES.items():
    _last = _full_name.split()[-1].lower()
    _PARTY_BY_LAST_NAME[_last] = _info


def _lookup_party(name: str) -> tuple[str | None, str | None]:
    """Fuzzy lookup of party/state from SENATOR_PARTIES.

    Handles mismatches like 'Thomas H Tuberville' vs 'Tommy Tuberville'
    by falling back to last-name matching.
    """
    # Try exact match first
    if name in SENATOR_PARTIES:
        info = SENATOR_PARTIES[name]
        return info[0], info[1]

    # Strip middle initial/name and try again: "Thomas H Tuberville" -> "Thomas Tuberville"
    parts = name.split()
    if len(parts) >= 3:
        stripped = f"{parts[0]} {parts[-1]}"
        if stripped in SENATOR_PARTIES:
            info = SENATOR_PARTIES[stripped]
            return info[0], info[1]

    # Try last name only (may have false positives but senators have unique last names mostly)
    last = parts[-1].lower() if parts else ""
    if last in _PARTY_BY_LAST_NAME:
        return _PARTY_BY_LAST_NAME[last]

    return None, None


def _parse_amount(amount_str: str | None) -> tuple[float | None, float | None]:
    if not amount_str:
        return None, None
    amount_str = amount_str.strip()
    if amount_str in AMOUNT_RANGES:
        return AMOUNT_RANGES[amount_str]
    return None, None


def _normalize_tx_type(tx_type: str | None) -> str:
    if not tx_type:
        return "unknown"
    tx = tx_type.strip().lower()
    if "purchase" in tx or "buy" in tx:
        return "purchase"
    if "sale" in tx and "full" in tx:
        return "sale_full"
    if "sale" in tx and "partial" in tx:
        return "sale_partial"
    if "sale" in tx or "sell" in tx:
        return "sale"
    if "exchange" in tx:
        return "exchange"
    return tx


def _parse_date(date_str: str | None) -> datetime | None:
    if not date_str or date_str.strip() in ("--", "", "N/A"):
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%b %d, %Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def _clean_html(text: str) -> str:
    """Remove HTML tags, whitespace, and decode entities."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&#39;", "'").replace("&quot;", '"')
    return text.strip()


def _normalize_senator_name(first: str, last: str) -> str:
    """Normalize senator name to 'First Last' format."""
    first = first.strip().rstrip(",")
    last = last.strip().rstrip(",")
    # Sometimes the API returns "Last, First (Senator)" in one field
    if not first and "," in last:
        parts = last.split(",", 1)
        last = parts[0].strip()
        first = parts[1].strip()
    # Remove title suffixes
    for suffix in (" (Senator)", " Jr.", " III", " II", " IV"):
        first = first.replace(suffix, "")
        last = last.replace(suffix, "")
    name = f"{first} {last}".strip()
    return name


async def _get_senate_session() -> tuple[httpx.AsyncClient, str]:
    """Establish authenticated session with Senate eFD search."""
    client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)

    # Step 1: Get CSRF token from home page
    home_resp = await client.get(SENATE_EFD_HOME)
    csrf_token = None
    for cookie_name, cookie_value in client.cookies.items():
        if "csrf" in cookie_name.lower():
            csrf_token = cookie_value
            break

    if not csrf_token:
        # Try extracting from HTML form
        match = re.search(
            r'name=["\']csrfmiddlewaretoken["\'].*?value=["\']([^"\']+)', home_resp.text
        )
        if match:
            csrf_token = match.group(1)

    if not csrf_token:
        await client.aclose()
        raise RuntimeError("Could not get CSRF token from Senate eFD")

    # Step 2: Accept legal agreement
    await client.post(
        SENATE_EFD_HOME,
        data={
            "csrfmiddlewaretoken": csrf_token,
            "prohibition_agreement": "1",
        },
        headers={"Referer": SENATE_EFD_HOME},
    )

    logger.info("Senate eFD session established")
    return client, csrf_token


async def _fetch_ptr_list(
    client: httpx.AsyncClient, csrf_token: str, year: int
) -> list[dict]:
    """Fetch paginated list of all PTR filings for a given year."""
    all_filings = []
    start = 0
    page_size = 100

    while True:
        resp = await client.post(
            SENATE_EFD_DATA,
            data={
                "start": str(start),
                "length": str(page_size),
                "report_types": "[11]",  # 11 = Periodic Transaction Report
                "filer_types": "[1]",  # 1 = Senator
                "submitted_start_date": f"01/01/{year} 00:00:00",
                "submitted_end_date": f"12/31/{year} 00:00:00",
            },
            headers={
                "Referer": "https://efdsearch.senate.gov/search/",
                "X-CSRFToken": csrf_token,
                "X-Requested-With": "XMLHttpRequest",
            },
        )

        if resp.status_code != 200:
            logger.warning(f"Senate eFD API returned {resp.status_code} for year {year}")
            break

        result = resp.json()
        data = result.get("data", [])
        total = result.get("recordsFiltered", 0)

        for entry in data:
            if len(entry) < 4:
                continue

            # entry: [first_name, last_name, name_display, report_link_html, date]
            first_name = str(entry[0]).strip() if entry[0] else ""
            last_name = str(entry[1]).strip() if entry[1] else ""

            # Extract UUID from report link HTML
            report_html = str(entry[3]) if len(entry) > 3 else ""
            uuid_match = re.search(r"/search/view/ptr/([a-f0-9-]+)/", report_html)
            uuid = uuid_match.group(1) if uuid_match else None

            filing_date = str(entry[4]).strip() if len(entry) > 4 else None

            name = _normalize_senator_name(first_name, last_name)
            if not name:
                continue

            all_filings.append(
                {
                    "name": name,
                    "uuid": uuid,
                    "filing_date": filing_date,
                    "year": year,
                }
            )

        if start + page_size >= total or not data:
            break
        start += page_size
        await asyncio.sleep(REQUEST_DELAY)

    logger.info(f"Found {len(all_filings)} Senate PTR filings for {year}")
    return all_filings


async def _parse_ptr_page(client: httpx.AsyncClient, uuid: str) -> list[dict]:
    """Fetch and parse a single Senate PTR detail page for individual trades."""
    if not uuid:
        return []

    url = f"https://efdsearch.senate.gov/search/view/ptr/{uuid}/"
    try:
        resp = await client.get(
            url, headers={"Referer": "https://efdsearch.senate.gov/search/"}
        )
        if resp.status_code != 200:
            logger.warning(f"Senate PTR page {uuid} returned {resp.status_code}")
            return []
    except Exception as e:
        logger.warning(f"Error fetching Senate PTR page {uuid}: {e}")
        return []

    html = resp.text
    trades = []

    # Parse the HTML table rows
    # Table columns: # | Transaction Date | Owner | Ticker | Asset Name | Asset Type | Type | Amount | Comment
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)

    for row in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL)
        if len(cells) < 7:
            continue

        # Skip header rows
        if any("Transaction Date" in c or "<th" in c for c in cells):
            continue

        # Skip row number column (cells[0])
        tx_date_str = _clean_html(cells[1])
        # cells[2] = Owner (Self, Spouse, Child, Joint)
        raw_ticker = _clean_html(cells[3])
        asset_name = _clean_html(cells[4])
        asset_type = _clean_html(cells[5]) if len(cells) > 5 else ""
        tx_type = _clean_html(cells[6]) if len(cells) > 6 else ""
        amount_str = _clean_html(cells[7]) if len(cells) > 7 else ""
        comment = _clean_html(cells[8]) if len(cells) > 8 else ""

        # Skip non-stock/non-ticker entries
        if not raw_ticker or raw_ticker in ("--", "N/A", ""):
            continue

        # Take only the first ticker if multiple (e.g., exchange: "FTV VNT")
        ticker = raw_ticker.split()[0] if raw_ticker else raw_ticker

        trades.append(
            {
                "tx_date": tx_date_str,
                "ticker": ticker,
                "asset_description": asset_name,
                "asset_type": asset_type,
                "tx_type": tx_type,
                "amount": amount_str,
                "comment": comment,
            }
        )

    return trades


async def ingest_senate_historical(
    session: AsyncSession, years: list[int] | None = None
) -> dict:
    """Scrape Senate eFD for historical trade data with transaction-level detail."""
    if years is None:
        years = list(range(2012, 2027))

    client, csrf_token = await _get_senate_session()

    total_trades_inserted = 0
    total_filings = 0
    total_trades_parsed = 0
    errors = 0

    try:
        for year in years:
            logger.info(f"--- Ingesting Senate trades for {year} ---")
            filings = await _fetch_ptr_list(client, csrf_token, year)
            total_filings += len(filings)

            year_trades = 0
            for i, filing in enumerate(filings):
                if not filing["uuid"]:
                    continue

                try:
                    await asyncio.sleep(REQUEST_DELAY)
                    trades = await _parse_ptr_page(client, filing["uuid"])
                    total_trades_parsed += len(trades)

                    for trade in trades:
                        tx_date = _parse_date(trade["tx_date"])
                        disclosure_date = _parse_date(filing["filing_date"])
                        amount_low, amount_high = _parse_amount(trade["amount"])
                        tx_type = _normalize_tx_type(trade["tx_type"])

                        party, state = _lookup_party(filing["name"])

                        trade_data = {
                            "chamber": "senate",
                            "politician": filing["name"],
                            "party": party,
                            "state": state,
                            "district": None,
                            "ticker": trade["ticker"],
                            "asset_description": trade["asset_description"],
                            "asset_type": trade.get("asset_type", "stock"),
                            "tx_type": tx_type,
                            "tx_date": tx_date,
                            "disclosure_date": disclosure_date,
                            "amount_low": amount_low,
                            "amount_high": amount_high,
                            "comment": trade.get("comment"),
                        }

                        stmt = (
                            dialect_insert(Trade)
                            .values(**trade_data)
                            .on_conflict_do_nothing(
                                index_elements=[
                                    "chamber",
                                    "politician",
                                    "ticker",
                                    "tx_date",
                                    "tx_type",
                                    "amount_low",
                                ]
                            )
                        )
                        result = await session.execute(stmt)
                        if result.rowcount > 0:
                            total_trades_inserted += 1
                            year_trades += 1

                except Exception as e:
                    logger.warning(f"Error processing PTR {filing['uuid']}: {e}")
                    errors += 1

                # Commit + log progress every 25 filings
                if (i + 1) % 25 == 0:
                    await session.commit()
                    logger.info(
                        f"  Year {year}: {i + 1}/{len(filings)} filings, "
                        f"+{year_trades} trades"
                    )

            await session.commit()
            logger.info(
                f"Year {year} complete: {year_trades} new trades "
                f"({total_trades_inserted} total)"
            )

    finally:
        await client.aclose()

    await session.commit()

    # Count total trades in DB
    count_result = await session.execute(select(func.count()).select_from(Trade))
    db_total = count_result.scalar()

    summary = {
        "years_processed": len(years),
        "filings_found": total_filings,
        "trades_parsed": total_trades_parsed,
        "trades_inserted": total_trades_inserted,
        "errors": errors,
        "total_trades_in_db": db_total,
    }
    logger.info(f"Senate historical ingestion complete: {summary}")
    return summary


async def run_historical_ingestion(
    years: list[int] | None = None,
) -> dict:
    """Run historical ingestion as a standalone operation."""
    async with async_session() as session:
        return await ingest_senate_historical(session, years)
