"""
13F Hedge Fund Holdings ingestion from SEC EDGAR.

Tracks major hedge fund managers' quarterly holdings via 13F-HR filings.
All data from free SEC EDGAR APIs (no key required, just User-Agent header).
"""

import logging
import xml.etree.ElementTree as ET
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import HedgeFund, HedgeFundHolding, async_session

logger = logging.getLogger(__name__)

SEC_USER_AGENT = "CongressTradesApp admin@congresstrades.app"
SEC_BASE = "https://data.sec.gov"
SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data"

# Top hedge fund managers to track
TRACKED_FUNDS = [
    {"name": "Berkshire Hathaway", "manager": "Warren Buffett", "cik": "0001067983"},
    {"name": "Scion Asset Management", "manager": "Michael Burry", "cik": "0001649339"},
    {"name": "Pershing Square Capital", "manager": "Bill Ackman", "cik": "0001336528"},
    {"name": "Bridgewater Associates", "manager": "Ray Dalio", "cik": "0001350694"},
    {"name": "Appaloosa LP", "manager": "David Tepper", "cik": "0001656456"},
    {"name": "Duquesne Family Office", "manager": "Stanley Druckenmiller", "cik": "0001536411"},
    {"name": "Tiger Global Management", "manager": "Chase Coleman", "cik": "0001167483"},
    {"name": "Citadel Advisors", "manager": "Ken Griffin", "cik": "0001423053"},
    {"name": "Renaissance Technologies", "manager": "Jim Simons", "cik": "0001037389"},
    {"name": "Greenlight Capital", "manager": "David Einhorn", "cik": "0001079114"},
    {"name": "Third Point", "manager": "Dan Loeb", "cik": "0001040273"},
    {"name": "Baupost Group", "manager": "Seth Klarman", "cik": "0001061768"},
    {"name": "Elliott Management", "manager": "Paul Singer", "cik": "0001048445"},
    {"name": "Icahn Enterprises", "manager": "Carl Icahn", "cik": "0000810958"},
    {"name": "Ark Invest", "manager": "Cathie Wood", "cik": "0001803723"},
]

# CUSIP -> Ticker mapping (common stocks, built over time)
CUSIP_TICKER_MAP = {}


def _sec_headers():
    return {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"}


async def get_latest_13f(client: httpx.AsyncClient, cik: str) -> dict | None:
    """Get the most recent 13F-HR filing metadata for a fund."""
    url = f"{SEC_BASE}/submissions/CIK{cik}.json"
    resp = await client.get(url, headers=_sec_headers())
    if resp.status_code != 200:
        logger.warning(f"SEC submissions returned {resp.status_code} for CIK {cik}")
        return None

    data = resp.json()
    filings = data.get("filings", {}).get("recent", {})
    forms = filings.get("form", [])
    accessions = filings.get("accessionNumber", [])
    filing_dates = filings.get("filingDate", [])
    report_dates = filings.get("reportDate", [])
    primary_docs = filings.get("primaryDocument", [])

    # Find the most recent 13F-HR
    for i, form in enumerate(forms):
        if "13F" in form:
            return {
                "accession": accessions[i],
                "filing_date": filing_dates[i],
                "report_date": report_dates[i],
                "primary_doc": primary_docs[i],
                "cik_num": cik.lstrip("0"),
            }

    return None


async def get_13f_holdings_xml(
    client: httpx.AsyncClient, cik_num: str, accession: str
) -> str | None:
    """Fetch the holdings XML from a 13F filing."""
    accession_clean = accession.replace("-", "")

    # Get filing index to find the info table XML
    index_url = f"{SEC_ARCHIVES}/{cik_num}/{accession_clean}/index.json"
    resp = await client.get(index_url, headers=_sec_headers())
    if resp.status_code != 200:
        logger.warning(f"Filing index returned {resp.status_code}: {index_url}")
        return None

    index_data = resp.json()
    items = index_data.get("directory", {}).get("item", [])

    # Find the info table XML (largest XML file that isn't primary_doc.xml)
    xml_files = [
        item for item in items
        if item["name"].endswith(".xml") and "primary_doc" not in item["name"]
    ]

    if not xml_files:
        logger.warning(f"No info table XML found in filing {accession}")
        return None

    # Pick the largest XML file (the info table)
    target = max(xml_files, key=lambda x: int(x.get("size", "0") or "0"))
    xml_url = f"{SEC_ARCHIVES}/{cik_num}/{accession_clean}/{target['name']}"

    resp = await client.get(xml_url, headers=_sec_headers())
    if resp.status_code != 200:
        logger.warning(f"Holdings XML returned {resp.status_code}: {xml_url}")
        return None

    return resp.text


def parse_13f_holdings(xml_text: str) -> list[dict]:
    """Parse 13F information table XML into holdings list."""
    holdings = []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        logger.error(f"Failed to parse 13F XML: {e}")
        return []

    # Handle namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    for entry in root.findall(f".//{ns}infoTable"):
        issuer = entry.findtext(f"{ns}nameOfIssuer", "").strip()
        title = entry.findtext(f"{ns}titleOfClass", "").strip()
        cusip = entry.findtext(f"{ns}cusip", "").strip()
        value = entry.findtext(f"{ns}value", "0").strip()
        put_call = entry.findtext(f"{ns}putCall", "").strip() or None

        shares_el = entry.find(f"{ns}shrsOrPrnAmt")
        shares = 0
        share_type = "SH"
        if shares_el is not None:
            shares = float(shares_el.findtext(f"{ns}sshPrnamt", "0").strip() or "0")
            share_type = shares_el.findtext(f"{ns}sshPrnamtType", "SH").strip()

        discretion = entry.findtext(f"{ns}investmentDiscretion", "").strip()

        vote_el = entry.find(f"{ns}votingAuthority")
        v_sole = v_shared = v_none = 0
        if vote_el is not None:
            v_sole = int(vote_el.findtext(f"{ns}Sole", "0").strip() or "0")
            v_shared = int(vote_el.findtext(f"{ns}Shared", "0").strip() or "0")
            v_none = int(vote_el.findtext(f"{ns}None", "0").strip() or "0")

        # Try to map CUSIP to ticker
        ticker = CUSIP_TICKER_MAP.get(cusip)

        holdings.append({
            "issuer_name": issuer,
            "title_of_class": title,
            "cusip": cusip,
            "ticker": ticker,
            "value": float(value),
            "shares": shares,
            "share_type": share_type,
            "put_call": put_call,
            "investment_discretion": discretion,
            "voting_sole": v_sole,
            "voting_shared": v_shared,
            "voting_none": v_none,
        })

    return holdings


async def ingest_fund(session: AsyncSession, client: httpx.AsyncClient, fund: dict) -> int:
    """Ingest the latest 13F for a single fund."""
    cik = fund["cik"]
    logger.info(f"Fetching 13F for {fund['name']} ({fund['manager']})...")

    filing = await get_latest_13f(client, cik)
    if not filing:
        logger.warning(f"No 13F found for {fund['name']}")
        return 0

    # Update/create fund record
    existing = await session.execute(select(HedgeFund).where(HedgeFund.cik == cik))
    hf = existing.scalar_one_or_none()
    if not hf:
        hf = HedgeFund(
            name=fund["name"],
            manager_name=fund["manager"],
            cik=cik,
        )
        session.add(hf)

    hf.last_filing_date = datetime.strptime(filing["filing_date"], "%Y-%m-%d")
    hf.report_date = datetime.strptime(filing["report_date"], "%Y-%m-%d") if filing["report_date"] else None

    # Fetch and parse holdings
    xml_text = await get_13f_holdings_xml(client, filing["cik_num"], filing["accession"])
    if not xml_text:
        await session.commit()
        return 0

    holdings = parse_13f_holdings(xml_text)
    logger.info(f"Parsed {len(holdings)} holdings for {fund['name']}")

    hf.num_holdings = len(holdings)
    hf.total_value = sum(h["value"] for h in holdings)

    new_count = 0
    for h in holdings:
        h["fund_cik"] = cik
        h["report_date"] = filing["report_date"]

        stmt = (
            sqlite_insert(HedgeFundHolding)
            .values(**h)
            .on_conflict_do_nothing(
                index_elements=["fund_cik", "report_date", "cusip", "put_call"]
            )
        )
        result = await session.execute(stmt)
        if result.rowcount > 0:
            new_count += 1

    await session.commit()
    logger.info(f"Inserted {new_count} holdings for {fund['name']}")
    return new_count


async def run_13f_ingestion() -> dict:
    """Ingest latest 13F filings for all tracked funds."""
    total_new = 0
    fund_results = {}
    errors = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        async with async_session() as session:
            for fund in TRACKED_FUNDS:
                try:
                    count = await ingest_fund(session, client, fund)
                    fund_results[fund["manager"]] = count
                    total_new += count
                except Exception as e:
                    logger.error(f"Error ingesting {fund['name']}: {e}")
                    errors.append(f"{fund['name']}: {e}")

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "total_new_holdings": total_new,
        "funds": fund_results,
        "errors": errors,
    }
