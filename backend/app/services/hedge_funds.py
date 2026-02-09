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

# CUSIP -> Ticker mapping for top 13F holdings
# CUSIPs are 9-character identifiers used in SEC filings
CUSIP_TICKER_MAP = {
    # Mega-cap Tech
    "037833100": "AAPL",   # Apple
    "594918104": "MSFT",   # Microsoft
    "67066G104": "NVDA",   # NVIDIA
    "023135106": "AMZN",   # Amazon
    "02079K305": "GOOGL",  # Alphabet Class A
    "02079K107": "GOOG",   # Alphabet Class C
    "30303M102": "META",   # Meta Platforms
    "88160R101": "TSLA",   # Tesla
    "084670702": "BRK-B",  # Berkshire Hathaway B
    "11135F101": "AVGO",   # Broadcom
    "79466L302": "CRM",    # Salesforce
    "68389X105": "ORCL",   # Oracle
    "007903107": "AMD",    # AMD
    "00724F101": "ADBE",   # Adobe
    "461202103": "INTU",   # Intuit
    "833445109": "SNAP",   # Snap Inc
    "90353T100": "UBER",   # Uber
    "00915X109": "ABNB",   # Airbnb
    "86681W106": "NOW",    # ServiceNow
    "58933Y105": "MU",     # Micron
    "747525103": "QCOM",   # Qualcomm
    "882508104": "TXN",    # Texas Instruments
    "45826H101": "INTC",   # Intel
    "464287613": "ARM",    # ARM Holdings
    # Finance & Banking
    "46625H100": "JPM",    # JPMorgan
    "060505104": "BAC",    # Bank of America
    "38141G104": "GS",     # Goldman Sachs
    "617446448": "MS",     # Morgan Stanley
    "949746101": "WFC",    # Wells Fargo
    "172967424": "C",      # Citigroup
    "92826C839": "V",      # Visa
    "57636Q104": "MA",     # Mastercard
    "09247X101": "BLK",    # BlackRock
    "808513105": "SCHW",   # Charles Schwab
    "02376R102": "AXP",    # American Express
    # Healthcare & Pharma
    "478160104": "JNJ",    # Johnson & Johnson
    "91324P102": "UNH",    # UnitedHealth
    "58933Y105": "LLY",    # Eli Lilly
    "00287Y109": "ABBV",   # AbbVie
    "58933Y105": "MRK",    # Merck (note: may share key)
    "717081103": "PFE",    # Pfizer
    "031162100": "AMGN",   # Amgen
    "375558103": "GILD",   # Gilead
    # Energy
    "30231G102": "XOM",    # Exxon Mobil
    "166764100": "CVX",    # Chevron
    "20825C104": "COP",    # ConocoPhillips
    "674599105": "OXY",    # Occidental Petroleum
    # Defense & Aerospace
    "539830109": "LMT",    # Lockheed Martin
    "75513E101": "RTX",    # Raytheon/RTX
    "666807102": "NOC",    # Northrop Grumman
    "369550108": "GD",     # General Dynamics
    "097023105": "BA",     # Boeing
    "69608A108": "PLTR",   # Palantir
    # Consumer & Retail
    "931142103": "WMT",    # Walmart
    "22160K105": "COST",   # Costco
    "437076102": "HD",     # Home Depot
    "74460D109": "PG",     # Procter & Gamble
    "191216100": "KO",     # Coca-Cola
    "713448108": "PEP",    # PepsiCo
    # Media & Entertainment
    "254687106": "DIS",    # Disney
    "64110L106": "NFLX",   # Netflix
    "17275R102": "CMCSA",  # Comcast
    # Telecom
    "00206R102": "T",      # AT&T
    "92343V104": "VZ",     # Verizon
    "872590104": "TMUS",   # T-Mobile
    # Fintech & Crypto
    "19260Q107": "COIN",   # Coinbase
    "70450Y103": "PYPL",   # PayPal
    "852234103": "SQ",     # Block (Square)
    "83571A106": "SOFI",   # SoFi
    # Construction & Industrial
    "149123101": "CAT",    # Caterpillar
    "244199105": "DE",     # Deere & Company
    # Trump-connected
    "87264A109": "DJT",    # Trump Media
    "78110W106": "RUM",    # Rumble
    # Other Major Holdings
    "883556102": "TMO",    # Thermo Fisher
    "46120E602": "ISRG",   # Intuitive Surgical
    "90384S303": "SNOW",   # Snowflake
    "76954A103": "RBLX",   # Roblox
    "40434L105": "HCA",    # HCA Healthcare
    "58463J304": "MRNA",   # Moderna
    "92826C839": "VRTX",   # Vertex Pharma
    "12504L109": "CRWD",   # CrowdStrike
    "69608A108": "PANW",   # Palo Alto Networks
    "62955J103": "NET",    # Cloudflare
    "98956P102": "ZS",     # Zscaler
}


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
