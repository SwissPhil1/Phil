"""
CapitolTrades ingestion - fetches House (and optionally Senate) trade data
from capitoltrades.com using their Next.js RSC endpoint.

Provides structured JSON with: ticker, trade type, date, value, politician info,
party, chamber, state, sector. No API key required.

Coverage: ~31,000+ House trades, ~35,000+ Senate trades (3+ years)
"""

import asyncio
import json
import logging
import re
from datetime import datetime

import httpx
from sqlalchemy import func, select

from app.models.database import Trade, async_session, dialect_insert

logger = logging.getLogger(__name__)

CAPITOLTRADES_URL = "https://www.capitoltrades.com/trades"
REQUEST_DELAY = 0.6  # Seconds between page requests (be polite)

# Map CapitolTrades value to STOCK Act disclosure ranges
AMOUNT_RANGES = [
    (15_000, 1_001, 15_000),
    (50_000, 15_001, 50_000),
    (100_000, 50_001, 100_000),
    (250_000, 100_001, 250_000),
    (500_000, 250_001, 500_000),
    (1_000_000, 500_001, 1_000_000),
    (5_000_000, 1_000_001, 5_000_000),
    (25_000_000, 5_000_001, 25_000_000),
    (50_000_000, 25_000_001, 50_000_000),
]


def _value_to_range(value: float | None) -> tuple[float | None, float | None]:
    """Convert a dollar value to the nearest STOCK Act disclosure range."""
    if not value or value <= 0:
        return None, None
    for threshold, low, high in AMOUNT_RANGES:
        if value <= threshold:
            return float(low), float(high)
    return 50_000_001.0, 50_000_001.0


def _normalize_tx_type(tx_type: str | None) -> str:
    """Map CapitolTrades tx types to our standard types."""
    if not tx_type:
        return "unknown"
    tx = tx_type.strip().lower()
    if tx in ("buy", "purchase"):
        return "purchase"
    if tx in ("sell", "sale"):
        return "sale"
    if "sell" in tx and "partial" in tx:
        return "sale_partial"
    if "sell" in tx and "full" in tx:
        return "sale_full"
    if tx == "exchange":
        return "exchange"
    return tx


def _normalize_party(party: str | None) -> str | None:
    if not party:
        return None
    p = party.strip().lower()
    if p in ("democrat", "democratic", "d"):
        return "D"
    if p in ("republican", "r"):
        return "R"
    if p in ("independent", "i"):
        return "I"
    return party[0].upper() if party else None


def _clean_ticker(ticker_str: str | None) -> str | None:
    """Clean ticker: 'NVDA:US' -> 'NVDA', skip non-stock tickers."""
    if not ticker_str:
        return None
    # Strip exchange suffix
    ticker = ticker_str.split(":")[0].strip().upper()
    if not ticker or len(ticker) > 10:
        return None
    # Skip common non-equity tickers
    if ticker in ("N/A", "--", ""):
        return None
    return ticker


def _extract_trades_from_rsc(text: str) -> tuple[list[dict], int, int]:
    """Extract trade objects and pagination info from RSC stream.

    Returns: (trades_list, total_count, total_pages)
    """
    trades = []
    total_count = 0
    total_pages = 0

    # Extract pagination info
    m = re.search(r'"totalCount"\s*:\s*(\d+).*?"totalPages"\s*:\s*(\d+)', text)
    if m:
        total_count = int(m.group(1))
        total_pages = int(m.group(2))

    # Find and extract the JSON array of trades
    idx = text.find('"_issuerId"')
    if idx < 0:
        return trades, total_count, total_pages

    bracket_start = text.rfind("[", 0, idx)
    if bracket_start < 0:
        return trades, total_count, total_pages

    # Walk forward to find the matching closing bracket
    depth = 0
    for i in range(bracket_start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
        if depth == 0:
            try:
                trades = json.loads(text[bracket_start : i + 1])
            except json.JSONDecodeError:
                logger.warning("Failed to parse RSC trade data")
            break

    return trades, total_count, total_pages


def _trade_to_row(t: dict) -> dict | None:
    """Convert a CapitolTrades trade object to a Trade table row dict."""
    issuer = t.get("issuer") or {}
    politician = t.get("politician") or {}

    ticker = _clean_ticker(issuer.get("issuerTicker"))
    if not ticker:
        return None  # Skip trades without tickers

    # Build politician name: prefer nickname over firstName
    first = politician.get("nickname") or politician.get("firstName") or ""
    last = politician.get("lastName") or ""
    name = f"{first} {last}".strip()
    if not name:
        return None

    tx_type = _normalize_tx_type(t.get("txType"))
    party = _normalize_party(politician.get("party"))
    state = (politician.get("_stateId") or "").upper() or None
    chamber = (t.get("chamber") or "").lower()

    # Parse dates
    tx_date = None
    if t.get("txDate"):
        try:
            tx_date = datetime.strptime(t["txDate"], "%Y-%m-%d")
        except (ValueError, TypeError):
            pass

    disclosure_date = None
    if t.get("pubDate"):
        try:
            disclosure_date = datetime.fromisoformat(
                t["pubDate"].replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except (ValueError, TypeError):
            pass

    value = t.get("value")
    amount_low, amount_high = _value_to_range(value)

    return {
        "chamber": chamber or "house",
        "politician": name,
        "party": party,
        "state": state,
        "district": None,
        "ticker": ticker,
        "asset_description": issuer.get("issuerName"),
        "asset_type": issuer.get("sector"),
        "tx_type": tx_type,
        "tx_date": tx_date,
        "disclosure_date": disclosure_date,
        "amount_low": amount_low,
        "amount_high": amount_high,
        "comment": t.get("comment"),
    }


async def _fetch_page(
    client: httpx.AsyncClient, page: int, chamber: str = "house"
) -> tuple[list[dict], int, int]:
    """Fetch a single page of trades from CapitolTrades."""
    try:
        resp = await client.get(
            CAPITOLTRADES_URL,
            params={"page": str(page), "chamber": chamber},
            headers={"RSC": "1"},
        )
        if resp.status_code != 200:
            logger.warning(f"CapitolTrades page {page} returned {resp.status_code}")
            return [], 0, 0
        return _extract_trades_from_rsc(resp.text)
    except Exception as e:
        logger.warning(f"Error fetching CapitolTrades page {page}: {e}")
        return [], 0, 0


async def run_capitoltrades_ingestion(
    chamber: str = "house",
    max_pages: int | None = None,
) -> dict:
    """Ingest trades from CapitolTrades.com.

    Args:
        chamber: "house" or "senate" (default "house")
        max_pages: limit number of pages to fetch (None = all pages)
    """
    logger.info(f"Starting CapitolTrades ingestion for {chamber}...")

    total_fetched = 0
    total_inserted = 0
    page = 1
    total_pages = None

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        while True:
            trades_raw, total_count, pages = await _fetch_page(client, page, chamber)

            if total_pages is None and pages > 0:
                total_pages = pages
                effective_max = min(total_pages, max_pages) if max_pages else total_pages
                logger.info(
                    f"CapitolTrades {chamber}: {total_count} trades across {total_pages} pages "
                    f"(fetching {effective_max})"
                )

            if not trades_raw:
                if page == 1:
                    logger.warning("No trades on page 1 - stopping")
                break

            # Convert to row dicts
            rows = []
            for t in trades_raw:
                row = _trade_to_row(t)
                if row:
                    rows.append(row)

            # Batch insert with on_conflict_do_nothing
            if rows:
                async with async_session() as session:
                    stmt = dialect_insert(Trade).values(rows)
                    stmt = stmt.on_conflict_do_nothing(
                        index_elements=[
                            "chamber", "politician", "ticker",
                            "tx_date", "tx_type", "amount_low",
                        ]
                    )
                    result = await session.execute(stmt)
                    await session.commit()
                    inserted = result.rowcount if hasattr(result, "rowcount") else len(rows)
                    total_inserted += inserted

            total_fetched += len(trades_raw)

            if page % 50 == 0 or page == 1:
                logger.info(
                    f"  Page {page}/{total_pages or '?'}: "
                    f"{total_fetched} fetched, {total_inserted} new"
                )

            # Check if we've reached the end or the page limit
            effective_max = min(total_pages or page, max_pages or float("inf"))
            if page >= effective_max:
                break

            page += 1
            await asyncio.sleep(REQUEST_DELAY)

    logger.info(
        f"CapitolTrades {chamber} ingestion complete: "
        f"{total_fetched} fetched, {total_inserted} new trades inserted"
    )
    return {
        "chamber": chamber,
        "pages_fetched": page,
        "trades_fetched": total_fetched,
        "trades_inserted": total_inserted,
    }
