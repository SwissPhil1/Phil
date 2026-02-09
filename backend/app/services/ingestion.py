"""
Ingestion service for congressional trade data.

Sources:
- House: Official Clerk financial disclosure ZIP files (XML index + PTR PDFs)
         https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip
- Senate: efdsearch.senate.gov JSON API (requires CSRF + agreement flow)

Also supports loading seed data for development/demo.
"""

import io
import logging
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    HOUSE_FD_ZIP_URL,
    INGESTION_YEARS,
    SENATE_EFD_AGREE,
    SENATE_EFD_DATA,
    SENATE_EFD_HOME,
)
from app.models.database import Trade, async_session

logger = logging.getLogger(__name__)

# Amount range mapping
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

# Known party affiliations for House members (partial, updated via disclosure data)
PARTY_MAP = {}


def parse_amount(amount_str: str | None) -> tuple[float | None, float | None]:
    if not amount_str:
        return None, None
    amount_str = amount_str.strip()
    if amount_str in AMOUNT_RANGES:
        return AMOUNT_RANGES[amount_str]
    return None, None


def parse_date(date_str: str | None) -> datetime | None:
    if not date_str or date_str.strip() in ("--", "", "N/A"):
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%b %d, %Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def normalize_tx_type(tx_type: str | None) -> str:
    if not tx_type:
        return "unknown"
    tx = tx_type.strip().lower().replace(" ", "_").replace("-", "_")
    if "purchase" in tx or "buy" in tx:
        return "purchase"
    if "sale_full" in tx or "full" in tx:
        return "sale_full"
    if "sale_partial" in tx or "partial" in tx:
        return "sale_partial"
    if "sale" in tx or "sell" in tx:
        return "sale"
    if "exchange" in tx:
        return "exchange"
    return tx


# --- House Ingestion (via Clerk ZIP files) ---


async def fetch_house_fd_zip(year: int) -> list[dict]:
    """
    Download the annual House FD ZIP, parse the XML index,
    and extract PTR (Periodic Transaction Report) filings.
    Returns filing metadata (not individual trades from PDFs).
    """
    url = HOUSE_FD_ZIP_URL.format(year=year)
    logger.info(f"Fetching House FD ZIP for {year}: {url}")

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning(f"House FD ZIP for {year} returned {resp.status_code}")
            return []

    filings = []
    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            # Find the XML file in the ZIP
            xml_files = [f for f in zf.namelist() if f.endswith(".xml")]
            if not xml_files:
                logger.warning(f"No XML file found in {year}FD.zip")
                return []

            with zf.open(xml_files[0]) as xml_file:
                tree = ET.parse(xml_file)
                root = tree.getroot()

                for member in root.findall(".//Member"):
                    filing_type = member.findtext("FilingType", "").strip()
                    # P = Periodic Transaction Report (the trades we want)
                    if filing_type != "P":
                        continue

                    last = member.findtext("Last", "").strip()
                    first = member.findtext("First", "").strip()
                    name = f"{first} {last}".strip()
                    if not name:
                        continue

                    state_dst = member.findtext("StateDst", "").strip()
                    state = state_dst[:2] if state_dst else None
                    district = state_dst[2:] if state_dst and len(state_dst) > 2 else None

                    filing_date = parse_date(member.findtext("FilingDate", ""))
                    doc_id = member.findtext("DocID", "").strip()

                    filings.append({
                        "name": name,
                        "state": state,
                        "district": district,
                        "filing_date": filing_date,
                        "doc_id": doc_id,
                        "year": year,
                    })

    except (zipfile.BadZipFile, ET.ParseError) as e:
        logger.error(f"Error parsing House FD ZIP for {year}: {e}")
        return []

    logger.info(f"Found {len(filings)} House PTR filings for {year}")
    return filings


async def scrape_house_ptr_pdf(doc_id: str, year: int) -> list[dict]:
    """
    Fetch and parse a single House PTR PDF for individual trades.
    The PDFs are structured enough to extract basic trade info.
    For MVP, we extract what we can from the HTML version if available.
    """
    # Try the HTML version first (some are available)
    url = f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{doc_id}.pdf"
    # For now, return empty - PDF parsing will be added in Phase 2
    # The filing metadata alone (who filed a PTR and when) is valuable
    return []


async def ingest_house(session: AsyncSession) -> int:
    """Ingest House trades from Clerk FD ZIP files."""
    new_count = 0

    for year in INGESTION_YEARS:
        filings = await fetch_house_fd_zip(year)

        for filing in filings:
            # Each PTR filing = at least one trade (we record the filing as a trade entry)
            # In Phase 2, we'll parse the actual PDFs for individual transactions
            trade_data = {
                "chamber": "house",
                "politician": filing["name"],
                "party": PARTY_MAP.get(filing["name"]),
                "state": filing["state"],
                "district": filing["district"],
                "ticker": None,  # Will be filled from PDF parsing in Phase 2
                "asset_description": f"PTR Filing (DocID: {filing['doc_id']})",
                "asset_type": "ptr_filing",
                "tx_type": "ptr_filing",
                "tx_date": filing["filing_date"],
                "disclosure_date": filing["filing_date"],
                "amount_low": None,
                "amount_high": None,
                "comment": f"House PTR {filing['year']}",
            }

            stmt = (
                sqlite_insert(Trade)
                .values(**trade_data)
                .on_conflict_do_nothing(
                    index_elements=[
                        "chamber", "politician", "ticker", "tx_date", "tx_type", "amount_low"
                    ]
                )
            )
            result = await session.execute(stmt)
            if result.rowcount > 0:
                new_count += 1

    await session.commit()
    logger.info(f"Inserted {new_count} new House PTR filings")
    return new_count


# --- Senate Ingestion (via eFD search JSON API) ---


async def fetch_senate_trades() -> list[dict]:
    """
    Fetch Senate PTR data via efdsearch.senate.gov JSON API.
    Requires CSRF token + agreement acceptance flow.
    """
    trades = []

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        # Step 1: Get CSRF token from home page
        logger.info("Fetching Senate eFD home page for CSRF token...")
        home_resp = await client.get(SENATE_EFD_HOME)
        if home_resp.status_code != 200:
            logger.warning(f"Senate eFD home returned {home_resp.status_code}")
            return []

        csrf_token = None
        for cookie_name, cookie_value in client.cookies.items():
            if "csrf" in cookie_name.lower():
                csrf_token = cookie_value
                break

        if not csrf_token:
            logger.warning("Could not find CSRF token in Senate eFD cookies")
            return []

        # Step 2: Accept agreement
        logger.info("Accepting Senate eFD agreement...")
        agree_resp = await client.post(
            SENATE_EFD_AGREE,
            data={
                "csrfmiddlewaretoken": csrf_token,
                "prohibition_agreement": "1",
            },
            headers={
                "Referer": SENATE_EFD_HOME,
            },
        )

        # Step 3: Fetch PTR data
        for year in INGESTION_YEARS:
            logger.info(f"Fetching Senate PTRs for {year}...")
            data_resp = await client.post(
                SENATE_EFD_DATA,
                data={
                    "start": "0",
                    "length": "500",
                    "report_types": "[11]",  # 11 = PTR
                    "filer_types": "[1]",  # 1 = Senator
                    "submitted_start_date": f"01/01/{year}",
                    "submitted_end_date": f"12/31/{year}",
                },
                headers={
                    "Referer": "https://efdsearch.senate.gov/search/",
                    "X-CSRFToken": csrf_token,
                    "X-Requested-With": "XMLHttpRequest",
                },
            )

            if data_resp.status_code != 200:
                logger.warning(f"Senate eFD data returned {data_resp.status_code} for {year}")
                continue

            try:
                result = data_resp.json()
                data = result.get("data", [])
                logger.info(f"Got {len(data)} Senate PTR entries for {year}")

                for entry in data:
                    # entry format: [name_html, office, filing_type, filing_date, report_link_html]
                    if len(entry) < 4:
                        continue

                    # Parse name from HTML link
                    name_html = entry[0] if isinstance(entry[0], str) else str(entry[0])
                    name = name_html
                    if "<" in name_html:
                        # Extract text from HTML tag
                        import re
                        match = re.search(r">([^<]+)<", name_html)
                        if match:
                            name = match.group(1).strip()

                    # Parse filing date
                    filing_date = parse_date(entry[3] if len(entry) > 3 else None)

                    trades.append({
                        "name": name,
                        "filing_date": filing_date,
                        "year": year,
                    })

            except Exception as e:
                logger.error(f"Error parsing Senate eFD response for {year}: {e}")
                continue

    return trades


async def ingest_senate(session: AsyncSession) -> int:
    """Ingest Senate trades from eFD search."""
    new_count = 0
    filings = await fetch_senate_trades()

    for filing in filings:
        trade_data = {
            "chamber": "senate",
            "politician": filing["name"],
            "party": None,
            "state": None,
            "district": None,
            "ticker": None,
            "asset_description": f"Senate PTR Filing {filing['year']}",
            "asset_type": "ptr_filing",
            "tx_type": "ptr_filing",
            "tx_date": filing["filing_date"],
            "disclosure_date": filing["filing_date"],
            "amount_low": None,
            "amount_high": None,
            "comment": f"Senate PTR {filing['year']}",
        }

        stmt = (
            sqlite_insert(Trade)
            .values(**trade_data)
            .on_conflict_do_nothing(
                index_elements=[
                    "chamber", "politician", "ticker", "tx_date", "tx_type", "amount_low"
                ]
            )
        )
        result = await session.execute(stmt)
        if result.rowcount > 0:
            new_count += 1

    await session.commit()
    logger.info(f"Inserted {new_count} new Senate PTR filings")
    return new_count


# --- Seed Data (for development/demo) ---


async def load_seed_data(session: AsyncSession) -> int:
    """Load sample trade data for development and demo purposes."""
    seed_file = Path(__file__).parent.parent / "data" / "seed_trades.json"
    if not seed_file.exists():
        logger.info("No seed data file found, skipping")
        return 0

    import json
    with open(seed_file) as f:
        trades = json.load(f)

    new_count = 0
    for trade in trades:
        trade["tx_date"] = parse_date(trade.get("tx_date"))
        trade["disclosure_date"] = parse_date(trade.get("disclosure_date"))
        amount_low, amount_high = parse_amount(trade.pop("amount", None))
        trade["amount_low"] = amount_low
        trade["amount_high"] = amount_high
        trade["tx_type"] = normalize_tx_type(trade.get("tx_type"))

        stmt = (
            sqlite_insert(Trade)
            .values(**trade)
            .on_conflict_do_nothing(
                index_elements=[
                    "chamber", "politician", "ticker", "tx_date", "tx_type", "amount_low"
                ]
            )
        )
        result = await session.execute(stmt)
        if result.rowcount > 0:
            new_count += 1

    await session.commit()
    logger.info(f"Loaded {new_count} trades from seed data")
    return new_count


# --- Main Ingestion Orchestrator ---


async def run_ingestion() -> dict:
    """Run full ingestion from all sources."""
    async with async_session() as session:
        # Load seed data first (for demo/dev)
        seed_count = await load_seed_data(session)

        # Ingest from official sources
        house_count = 0
        senate_count = 0
        errors = []

        try:
            house_count = await ingest_house(session)
        except Exception as e:
            logger.error(f"House ingestion failed: {e}")
            errors.append(f"House: {e}")

        try:
            senate_count = await ingest_senate(session)
        except Exception as e:
            logger.error(f"Senate ingestion failed: {e}")
            errors.append(f"Senate: {e}")

        total = await session.execute(select(func.count()).select_from(Trade))
        total_count = total.scalar()

    summary = {
        "timestamp": datetime.utcnow().isoformat(),
        "seed_loaded": seed_count,
        "house_new": house_count,
        "senate_new": senate_count,
        "total_new": seed_count + house_count + senate_count,
        "total_trades_in_db": total_count,
        "errors": errors,
    }
    logger.info(f"Ingestion complete: {summary}")
    return summary
