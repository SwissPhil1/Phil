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

# Comprehensive party affiliations covering senators (current + recent) and key House members.
# Includes both common names AND formal eFD names to avoid mismatches.
SENATOR_PARTIES = {
    # --- Senate: current & recent (2012-present) ---
    # Alabama
    "Tommy Tuberville": ("R", "AL"),
    "Thomas H Tuberville": ("R", "AL"),
    "Katie Britt": ("R", "AL"),
    "Katie Boyd Britt": ("R", "AL"),
    "Richard Shelby": ("R", "AL"),
    "Doug Jones": ("D", "AL"),
    # Alaska
    "Dan Sullivan": ("R", "AK"),
    "Lisa Murkowski": ("R", "AK"),
    # Arizona
    "Mark Kelly": ("D", "AZ"),
    "Kyrsten Sinema": ("I", "AZ"),
    "Ruben Gallego": ("D", "AZ"),
    "Martha McSally": ("R", "AZ"),
    "Jeff Flake": ("R", "AZ"),
    "John McCain": ("R", "AZ"),
    # Arkansas
    "John Boozman": ("R", "AR"),
    "Tom Cotton": ("R", "AR"),
    "Mark Pryor": ("D", "AR"),
    # California
    "Dianne Feinstein": ("D", "CA"),
    "Alex Padilla": ("D", "CA"),
    "Kamala Harris": ("D", "CA"),
    "Adam Schiff": ("D", "CA"),
    "Adam B Schiff": ("D", "CA"),
    # Colorado
    "John Hickenlooper": ("D", "CO"),
    "John W Hickenlooper": ("D", "CO"),
    "Michael Bennet": ("D", "CO"),
    # Connecticut
    "Chris Murphy": ("D", "CT"),
    "Richard Blumenthal": ("D", "CT"),
    # Delaware
    "Thomas Carper": ("D", "DE"),
    "Chris Coons": ("D", "DE"),
    # Florida
    "Rick Scott": ("R", "FL"),
    "Marco Rubio": ("R", "FL"),
    "Ashley Moody": ("R", "FL"),
    "Bill Nelson": ("D", "FL"),
    # Georgia
    "Jon Ossoff": ("D", "GA"),
    "Raphael Warnock": ("D", "GA"),
    "Kelly Loeffler": ("R", "GA"),
    "David Perdue": ("R", "GA"),
    "Johnny Isakson": ("R", "GA"),
    # Hawaii
    "Mazie Hirono": ("D", "HI"),
    "Brian Schatz": ("D", "HI"),
    # Idaho
    "Mike Crapo": ("R", "ID"),
    "Jim Risch": ("R", "ID"),
    # Illinois
    "Dick Durbin": ("D", "IL"),
    "Tammy Duckworth": ("D", "IL"),
    "Ladda Tammy Duckworth": ("D", "IL"),
    # Indiana
    "Todd Young": ("R", "IN"),
    "Mike Braun": ("R", "IN"),
    "Jim Banks": ("R", "IN"),
    "James Banks": ("R", "IN"),
    # Iowa
    "Chuck Grassley": ("R", "IA"),
    "Joni Ernst": ("R", "IA"),
    # Kansas
    "Jerry Moran": ("R", "KS"),
    "Roger Marshall": ("R", "KS"),
    # Kentucky
    "Mitch McConnell": ("R", "KY"),
    "A. Mitchell McConnell": ("R", "KY"),
    "Rand Paul": ("R", "KY"),
    # Louisiana
    "Bill Cassidy": ("R", "LA"),
    "William Cassidy": ("R", "LA"),
    "John N Kennedy": ("R", "LA"),
    "John Kennedy": ("R", "LA"),
    # Maine
    "Susan Collins": ("R", "ME"),
    "Susan M Collins": ("R", "ME"),
    "Angus King": ("I", "ME"),
    "Angus S King": ("I", "ME"),
    # Maryland
    "Chris Van Hollen": ("D", "MD"),
    "Ben Cardin": ("D", "MD"),
    "Angela Alsobrooks": ("D", "MD"),
    # Massachusetts
    "Elizabeth Warren": ("D", "MA"),
    "Ed Markey": ("D", "MA"),
    # Michigan
    "Gary Peters": ("D", "MI"),
    "Debbie Stabenow": ("D", "MI"),
    "Elissa Slotkin": ("D", "MI"),
    # Minnesota
    "Tina Smith": ("D", "MN"),
    "Amy Klobuchar": ("D", "MN"),
    # Mississippi
    "Cindy Hyde-Smith": ("R", "MS"),
    "Roger Wicker": ("R", "MS"),
    "Roger F Wicker": ("R", "MS"),
    # Missouri
    "Josh Hawley": ("R", "MO"),
    "Eric Schmitt": ("R", "MO"),
    "Roy Blunt": ("R", "MO"),
    # Montana
    "Steve Daines": ("R", "MT"),
    "Jon Tester": ("D", "MT"),
    "Tim Sheehy": ("R", "MT"),
    # Nebraska
    "Pete Ricketts": ("R", "NE"),
    "Deb Fischer": ("R", "NE"),
    "Debra S Fischer": ("R", "NE"),
    # Nevada
    "Jacky Rosen": ("D", "NV"),
    "Catherine Cortez Masto": ("D", "NV"),
    # New Hampshire
    "Jeanne Shaheen": ("D", "NH"),
    "Maggie Hassan": ("D", "NH"),
    # New Jersey
    "Cory Booker": ("D", "NJ"),
    "Cory A Booker": ("D", "NJ"),
    "Andy Kim": ("D", "NJ"),
    "Bob Menendez": ("D", "NJ"),
    # New Mexico
    "Martin Heinrich": ("D", "NM"),
    "Ben Ray Lujan": ("D", "NM"),
    # New York
    "Chuck Schumer": ("D", "NY"),
    "Kirsten Gillibrand": ("D", "NY"),
    # North Carolina
    "Thom Tillis": ("R", "NC"),
    "Richard Burr": ("R", "NC"),
    "Ted Budd": ("R", "NC"),
    # North Dakota
    "John Hoeven": ("R", "ND"),
    "Kevin Cramer": ("R", "ND"),
    # Ohio
    "Sherrod Brown": ("D", "OH"),
    "J.D. Vance": ("R", "OH"),
    "Rob Portman": ("R", "OH"),
    "Bernie Moreno": ("R", "OH"),
    # Oklahoma
    "Markwayne Mullin": ("R", "OK"),
    "James Inhofe": ("R", "OK"),
    "James Lankford": ("R", "OK"),
    # Oregon
    "Ron Wyden": ("D", "OR"),
    "Ron L Wyden": ("D", "OR"),
    "Jeff Merkley": ("D", "OR"),
    # Pennsylvania
    "Bob Casey": ("D", "PA"),
    "Pat Toomey": ("R", "PA"),
    "John Fetterman": ("D", "PA"),
    "Dave McCormick": ("R", "PA"),
    "David McCormick": ("R", "PA"),
    "David H McCormick": ("R", "PA"),
    # Rhode Island
    "Sheldon Whitehouse": ("D", "RI"),
    "Jack Reed": ("D", "RI"),
    "John F Reed": ("D", "RI"),
    # South Carolina
    "Lindsey Graham": ("R", "SC"),
    "Tim Scott": ("R", "SC"),
    # South Dakota
    "John Thune": ("R", "SD"),
    "John R Thune": ("R", "SD"),
    "Mike Rounds": ("R", "SD"),
    # Tennessee
    "Bill Hagerty": ("R", "TN"),
    "William F Hagerty": ("R", "TN"),
    "Marsha Blackburn": ("R", "TN"),
    "Lamar Alexander": ("R", "TN"),
    # Texas
    "Ted Cruz": ("R", "TX"),
    "John Cornyn": ("R", "TX"),
    # Utah
    "Mitt Romney": ("R", "UT"),
    "Mike Lee": ("R", "UT"),
    # Vermont
    "Patrick Leahy": ("D", "VT"),
    "Bernie Sanders": ("I", "VT"),
    "Peter Welch": ("D", "VT"),
    # Virginia
    "Mark Warner": ("D", "VA"),
    "Mark R Warner": ("D", "VA"),
    "Tim Kaine": ("D", "VA"),
    "Timothy M Kaine": ("D", "VA"),
    # Washington
    "Patty Murray": ("D", "WA"),
    "Maria Cantwell": ("D", "WA"),
    # West Virginia
    "Joe Manchin": ("D", "WV"),
    "Shelley Capito": ("R", "WV"),
    "Shelley M Capito": ("R", "WV"),
    "Shelley Moore Capito": ("R", "WV"),
    "Jim Justice": ("R", "WV"),
    "James Conley Justice": ("R", "WV"),
    # Wisconsin
    "Tammy Baldwin": ("D", "WI"),
    "Ron Johnson": ("R", "WI"),
    "Eric Hovde": ("R", "WI"),
    # Wyoming
    "Cynthia Lummis": ("R", "WY"),
    "John Barrasso": ("R", "WY"),
    # --- Key House members ---
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
    "Dan Crenshaw": ("R", "TX"),
    "Suzan DelBene": ("D", "WA"),
    "Suzan K. DelBene": ("D", "WA"),
    "Steve Cohen": ("D", "TN"),
    "Kelly Louise Morrison": ("D", "MN"),
    "Sheri Biggs": ("R", "SC"),
    "Cleo Fields": ("D", "LA"),
    "David Taylor": ("R", "OH"),
    "David J. Taylor": ("R", "OH"),
    "Max Miller": ("R", "OH"),
    "Michael Garcia": ("R", "CA"),
    "Mike Garcia": ("R", "CA"),
    "Debbie Wasserman Schultz": ("D", "FL"),
    "Tom Malinowski": ("D", "NJ"),
    "Kevin Brady": ("R", "TX"),
    "Pat Fallon": ("R", "TX"),
    "Blake Moore": ("R", "UT"),
    "Marie Gluesenkamp Perez": ("D", "WA"),
    "John Curtis": ("R", "UT"),
    "French Hill": ("R", "AR"),
    "Michael Cloud": ("R", "TX"),
    "Lois Frankel": ("D", "FL"),
    "Kathy Manning": ("D", "NC"),
    "Kim Schrier": ("D", "WA"),
    "Dean Phillips": ("D", "MN"),
    "John Rutherford": ("R", "FL"),
    "Bob Gibbs": ("R", "OH"),
    "Tommy Tuberville": ("R", "AL"),
}


# Build a lookup index: last_name -> (party, state) for fuzzy matching
_PARTY_BY_LAST_NAME: dict[str, tuple[str, str]] = {}
for _full_name, _info in SENATOR_PARTIES.items():
    _last = _full_name.split()[-1].lower()
    _PARTY_BY_LAST_NAME[_last] = _info


def _lookup_party(name: str) -> tuple[str | None, str | None]:
    """Fuzzy lookup of party/state from SENATOR_PARTIES.

    Handles mismatches like 'Thomas H Tuberville' vs 'Tommy Tuberville',
    trailing commas ('Angus S King,'), and Jr/III suffixes.
    """
    # Clean trailing commas / periods / whitespace
    cleaned = name.strip().rstrip(",").rstrip(".").strip()

    # Try exact match first
    if cleaned in SENATOR_PARTIES:
        return SENATOR_PARTIES[cleaned]

    # Try original name (with comma) in case it's in the dict
    if name in SENATOR_PARTIES:
        return SENATOR_PARTIES[name]

    parts = cleaned.split()
    if not parts:
        return None, None

    # Strip middle initial/name: "Thomas H Tuberville" -> "Thomas Tuberville"
    if len(parts) >= 3:
        stripped = f"{parts[0]} {parts[-1]}"
        if stripped in SENATOR_PARTIES:
            return SENATOR_PARTIES[stripped]

    # Try first + last only (skip all middle parts): "A. Mitchell McConnell" -> last name match
    # Also handles "John W Hickenlooper" -> "John Hickenlooper"
    if len(parts) >= 2:
        first_last = f"{parts[0]} {parts[-1]}"
        if first_last in SENATOR_PARTIES:
            return SENATOR_PARTIES[first_last]

    # Try last name only (senators mostly have unique last names)
    last = parts[-1].lower()
    # Skip generic suffixes
    if last in ("jr", "jr.", "ii", "iii", "iv", "sr", "sr.") and len(parts) >= 2:
        last = parts[-2].lower()
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
