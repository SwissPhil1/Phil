"""
SEC Form 4 corporate insider trade ingestion.

Tracks insider buys and sells (CEOs, directors, 10%+ owners)
via SEC EDGAR RSS feeds and filing XML parsing.
"""

import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime

import httpx
from app.models.database import dialect_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import InsiderTrade, async_session

logger = logging.getLogger(__name__)

SEC_USER_AGENT = "CongressTradesApp admin@congresstrades.app"

# Latest Form 4 filings (global RSS feed)
FORM4_RSS_URL = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=only&count=100&output=atom"

# Transaction codes -> human readable
TX_CODE_MAP = {
    "P": "purchase",
    "S": "sale",
    "M": "exercise",
    "A": "award",
    "G": "gift",
    "F": "tax_withholding",
    "C": "conversion",
    "D": "disposition_to_issuer",
    "J": "other",
}

# Major companies to track insiders for
TRACKED_COMPANIES = [
    {"name": "Apple Inc.", "cik": "0000320193", "ticker": "AAPL"},
    {"name": "Microsoft Corp.", "cik": "0000789019", "ticker": "MSFT"},
    {"name": "NVIDIA Corp.", "cik": "0001045810", "ticker": "NVDA"},
    {"name": "Amazon.com Inc.", "cik": "0001018724", "ticker": "AMZN"},
    {"name": "Alphabet Inc.", "cik": "0001652044", "ticker": "GOOGL"},
    {"name": "Meta Platforms Inc.", "cik": "0001326801", "ticker": "META"},
    {"name": "Tesla Inc.", "cik": "0001318605", "ticker": "TSLA"},
    {"name": "Berkshire Hathaway", "cik": "0001067983", "ticker": "BRK-B"},
    {"name": "JPMorgan Chase", "cik": "0000019617", "ticker": "JPM"},
    {"name": "Visa Inc.", "cik": "0001403161", "ticker": "V"},
    {"name": "Broadcom Inc.", "cik": "0001649338", "ticker": "AVGO"},
    {"name": "Eli Lilly", "cik": "0000059478", "ticker": "LLY"},
    {"name": "Walmart Inc.", "cik": "0000104169", "ticker": "WMT"},
    {"name": "Palantir Technologies", "cik": "0001321655", "ticker": "PLTR"},
    {"name": "Coinbase Global", "cik": "0001679788", "ticker": "COIN"},
]


def _sec_headers():
    return {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"}


async def fetch_latest_form4_filings(client: httpx.AsyncClient) -> list[dict]:
    """Fetch the latest Form 4 filings from global RSS feed."""
    resp = await client.get(FORM4_RSS_URL, headers=_sec_headers())
    if resp.status_code != 200:
        logger.warning(f"Form 4 RSS returned {resp.status_code}")
        return []

    filings = []
    try:
        root = ET.fromstring(resp.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        for entry in root.findall("atom:entry", ns):
            title = entry.findtext("atom:title", "", ns).strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.get("href", "") if link_el is not None else ""
            updated = entry.findtext("atom:updated", "", ns).strip()
            summary = entry.findtext("atom:summary", "", ns).strip()

            # Extract accession number from summary
            acc_match = re.search(r"AccNo:\s*(\S+)", summary)
            accession = acc_match.group(1) if acc_match else None

            if accession and link:
                filings.append({
                    "title": title,
                    "link": link,
                    "accession": accession,
                    "updated": updated,
                })
    except ET.ParseError as e:
        logger.error(f"Failed to parse Form 4 RSS: {e}")

    logger.info(f"Found {len(filings)} recent Form 4 filings from RSS")
    return filings


async def fetch_latest_form4_global(client: httpx.AsyncClient) -> list[dict]:
    """Fetch ALL recent Form 4 filings from the global RSS feed and parse each one.

    This provides broad coverage across all publicly traded companies,
    not just the hardcoded TRACKED_COMPANIES list.
    """
    rss_entries = await fetch_latest_form4_filings(client)
    all_trades = []

    for entry in rss_entries:
        link = entry.get("link", "")
        accession = entry.get("accession", "")
        if not link:
            continue

        try:
            trades = await parse_form4_xml(client, link)
            for trade in trades:
                if not trade.get("insider_cik"):
                    continue
                trade["accession_number"] = accession
                all_trades.append(trade)
        except Exception as e:
            logger.debug(f"Failed to parse global Form 4 filing {accession}: {e}")

    logger.info(f"Parsed {len(all_trades)} trades from {len(rss_entries)} global Form 4 filings")
    return all_trades


async def fetch_company_form4s(client: httpx.AsyncClient, cik: str, ticker: str) -> list[dict]:
    """Fetch Form 4 filings for a specific company via RSS."""
    url = (
        f"https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcompany&CIK={cik}&type=4&dateb=&owner=only&count=20&output=atom"
    )
    resp = await client.get(url, headers=_sec_headers())
    if resp.status_code != 200:
        logger.warning(f"Company Form 4 RSS for {ticker} returned {resp.status_code}")
        return []

    filings = []
    try:
        root = ET.fromstring(resp.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        for entry in root.findall("atom:entry", ns):
            content = entry.find("atom:content", ns)
            if content is None:
                continue

            acc = content.findtext("atom:accession-number", "", ns).strip() if content.find("atom:accession-number", ns) is not None else ""
            filing_date = content.findtext("atom:filing-date", "", ns).strip() if content.find("atom:filing-date", ns) is not None else ""
            href = content.findtext("atom:filing-href", "", ns).strip() if content.find("atom:filing-href", ns) is not None else ""

            # Try without namespace prefix for content children
            if not acc:
                acc_el = content.find("{http://www.w3.org/2005/Atom}accession-number")
                if acc_el is None:
                    # Try plain tags
                    for child in content:
                        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                        if tag == "accession-number":
                            acc = (child.text or "").strip()
                        elif tag == "filing-date":
                            filing_date = (child.text or "").strip()
                        elif tag == "filing-href":
                            href = (child.text or "").strip()

            if acc:
                filings.append({
                    "accession": acc,
                    "filing_date": filing_date,
                    "href": href,
                    "ticker": ticker,
                    "issuer_cik": cik,
                })
    except ET.ParseError as e:
        logger.error(f"Failed to parse company Form 4 RSS for {ticker}: {e}")

    return filings


async def parse_form4_xml(client: httpx.AsyncClient, filing_url: str) -> list[dict]:
    """Fetch and parse a Form 4 XML filing for individual transactions."""
    # Convert index URL to the actual XML
    # The filing href points to an index page; we need the XML document
    if filing_url.endswith("-index.htm") or filing_url.endswith("-index.html"):
        # Get the directory listing
        dir_url = filing_url.rsplit("/", 1)[0] + "/"
    else:
        dir_url = filing_url

    # Try to find the Form 4 XML
    resp = await client.get(dir_url, headers=_sec_headers())
    if resp.status_code != 200:
        return []

    # Look for .xml links in the response
    xml_match = re.search(r'href="([^"]*\.xml)"', resp.text)
    if not xml_match:
        return []

    xml_filename = xml_match.group(1)
    if xml_filename.startswith("http"):
        xml_url = xml_filename
    elif xml_filename.startswith("/"):
        # Absolute path - prepend SEC base URL
        xml_url = "https://www.sec.gov" + xml_filename
    else:
        # Relative path - append to directory URL
        xml_url = dir_url + xml_filename

    resp = await client.get(xml_url, headers=_sec_headers())
    if resp.status_code != 200:
        return []

    trades = []
    try:
        root = ET.fromstring(resp.text)

        # Get issuer info
        issuer_el = root.find("issuer")
        issuer_name = ""
        issuer_cik = ""
        ticker = ""
        if issuer_el is not None:
            issuer_cik = issuer_el.findtext("issuerCik", "").strip()
            issuer_name = issuer_el.findtext("issuerName", "").strip()
            ticker = issuer_el.findtext("issuerTradingSymbol", "").strip()

        # Get reporting owner info
        owner_el = root.find("reportingOwner")
        owner_name = ""
        owner_cik = ""
        is_director = False
        is_officer = False
        is_ten_pct = False
        officer_title = ""

        if owner_el is not None:
            owner_id = owner_el.find("reportingOwnerId")
            if owner_id is not None:
                owner_cik = owner_id.findtext("rptOwnerCik", "").strip()
                owner_name = owner_id.findtext("rptOwnerName", "").strip()

            rel = owner_el.find("reportingOwnerRelationship")
            if rel is not None:
                is_director = rel.findtext("isDirector", "0").strip() == "1"
                is_officer = rel.findtext("isOfficer", "0").strip() == "1"
                is_ten_pct = rel.findtext("isTenPercentOwner", "0").strip() == "1"
                officer_title = rel.findtext("officerTitle", "").strip()

        period = root.findtext("periodOfReport", "").strip()

        # Parse non-derivative transactions
        nd_table = root.find("nonDerivativeTable")
        if nd_table is not None:
            for tx in nd_table.findall("nonDerivativeTransaction"):
                tx_date_str = ""
                tx_date_el = tx.find("transactionDate")
                if tx_date_el is not None:
                    tx_date_str = tx_date_el.findtext("value", "").strip()

                tx_code = ""
                coding_el = tx.find("transactionCoding")
                if coding_el is not None:
                    tx_code = coding_el.findtext("transactionCode", "").strip()

                amounts_el = tx.find("transactionAmounts")
                shares_val = 0
                price_val = 0
                acq_disp = ""
                if amounts_el is not None:
                    sh_el = amounts_el.find("transactionShares")
                    shares_val = float(sh_el.findtext("value", "0").strip() or "0") if sh_el is not None else 0
                    pr_el = amounts_el.find("transactionPricePerShare")
                    price_str = pr_el.findtext("value", "0").strip() if pr_el is not None else "0"
                    price_val = float(price_str) if price_str else 0
                    ad_el = amounts_el.find("transactionAcquiredDisposedCode")
                    acq_disp = ad_el.findtext("value", "").strip() if ad_el is not None else ""

                post_el = tx.find("postTransactionAmounts")
                shares_after = 0
                if post_el is not None:
                    sa_el = post_el.find("sharesOwnedFollowingTransaction")
                    shares_after = float(sa_el.findtext("value", "0").strip() or "0") if sa_el is not None else 0

                tx_date = None
                if tx_date_str:
                    try:
                        tx_date = datetime.strptime(tx_date_str, "%Y-%m-%d")
                    except ValueError:
                        pass

                filing_date = None
                if period:
                    try:
                        filing_date = datetime.strptime(period, "%Y-%m-%d")
                    except ValueError:
                        pass

                trades.append({
                    "insider_name": owner_name,
                    "insider_cik": owner_cik,
                    "insider_title": officer_title or ("Director" if is_director else None),
                    "is_director": is_director,
                    "is_officer": is_officer,
                    "is_ten_pct_owner": is_ten_pct,
                    "issuer_name": issuer_name,
                    "issuer_cik": issuer_cik,
                    "ticker": ticker.upper() if ticker else None,
                    "tx_date": tx_date,
                    "filing_date": filing_date,
                    "tx_code": tx_code,
                    "tx_type": TX_CODE_MAP.get(tx_code, tx_code),
                    "shares": shares_val,
                    "price_per_share": price_val,
                    "total_value": shares_val * price_val if shares_val and price_val else None,
                    "shares_after": shares_after,
                    "acquired_disposed": acq_disp,
                })

    except ET.ParseError as e:
        logger.error(f"Failed to parse Form 4 XML: {e}")

    return trades


async def run_insider_ingestion() -> dict:
    """Ingest latest Form 4 insider trades from global feed AND tracked companies.

    1. Fetches the latest 100 Form 4 filings from the SEC global RSS feed
       to capture insider trades across ALL publicly traded companies.
    2. Then fetches filings for each tracked (priority) company for deeper
       historical coverage (up to 10 filings per company).
    """
    total_new = 0
    global_new = 0
    company_results = {}
    errors = []

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        async with async_session() as session:
            # ── Phase 1: Global Form 4 RSS feed (all companies) ──
            try:
                global_trades = await fetch_latest_form4_global(client)
                for trade in global_trades:
                    try:
                        stmt = (
                            dialect_insert(InsiderTrade)
                            .values(**trade)
                            .on_conflict_do_nothing(
                                index_elements=[
                                    "insider_cik", "ticker", "tx_date", "tx_code", "shares"
                                ]
                            )
                        )
                        result = await session.execute(stmt)
                        if result.rowcount > 0:
                            global_new += 1
                    except Exception as e:
                        logger.debug(f"Error inserting global trade: {e}")

                await session.commit()
                total_new += global_new
                logger.info(f"Global Form 4 feed: inserted {global_new} new trades")

            except Exception as e:
                logger.error(f"Error during global Form 4 ingestion: {e}")
                errors.append(f"global_feed: {e}")

            # ── Phase 2: Tracked companies (priority list, deeper history) ──
            for company in TRACKED_COMPANIES:
                try:
                    filings = await fetch_company_form4s(
                        client, company["cik"], company["ticker"]
                    )
                    logger.info(f"Found {len(filings)} Form 4 filings for {company['ticker']}")

                    count = 0
                    for filing in filings[:10]:  # Process last 10 filings per company
                        if not filing.get("href"):
                            continue

                        trades = await parse_form4_xml(client, filing["href"])
                        for trade in trades:
                            if not trade.get("insider_cik"):
                                continue

                            trade["accession_number"] = filing["accession"]

                            stmt = (
                                dialect_insert(InsiderTrade)
                                .values(**trade)
                                .on_conflict_do_nothing(
                                    index_elements=[
                                        "insider_cik", "ticker", "tx_date", "tx_code", "shares"
                                    ]
                                )
                            )
                            result = await session.execute(stmt)
                            if result.rowcount > 0:
                                count += 1

                    await session.commit()
                    company_results[company["ticker"]] = count
                    total_new += count

                except Exception as e:
                    logger.error(f"Error ingesting insiders for {company['ticker']}: {e}")
                    errors.append(f"{company['ticker']}: {e}")

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "total_new_trades": total_new,
        "global_new_trades": global_new,
        "tracked_companies": company_results,
        "errors": errors,
    }
