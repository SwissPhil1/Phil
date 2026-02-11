"""Performance tracking service - calculates returns for politician trades.

Optimized for throughput:
- Deduplicates Yahoo API calls by ticker (not per-trade)
- Fetches multiple tickers in parallel (batches of 15)
- Reuses HTTP connections
- Rebuilds politician stats with aggregated SQL (not N+1 queries)
"""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import httpx
from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Politician, Trade, async_session

logger = logging.getLogger(__name__)

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}
CONCURRENT_FETCHES = 15  # parallel ticker requests
YAHOO_TIMEOUT = 12


async def get_price_on_date(
    client: httpx.AsyncClient, ticker: str, date: datetime
) -> float | None:
    """Get closing price for a ticker on a specific date using Yahoo v8 API."""
    try:
        start_ts = int((date - timedelta(days=15)).timestamp())
        end_ts = int((date + timedelta(days=15)).timestamp())
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
            f"?period1={start_ts}&period2={end_ts}&interval=1d"
        )
        resp = await client.get(url, headers=YAHOO_HEADERS)
        if resp.status_code != 200:
            return None

        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return None

        timestamps = result[0].get("timestamp", [])
        closes = (
            result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        )

        if not timestamps or not closes:
            return None

        target_ts = date.timestamp()
        best_idx = 0
        best_diff = abs(timestamps[0] - target_ts)
        for i, ts in enumerate(timestamps):
            diff = abs(ts - target_ts)
            if diff < best_diff and closes[i] is not None:
                best_diff = diff
                best_idx = i

        price = closes[best_idx]
        return float(price) if price is not None else None
    except Exception:
        return None


async def get_current_price(
    client: httpx.AsyncClient, ticker: str
) -> float | None:
    """Get the most recent closing price for a ticker using Yahoo v8 API."""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=5d&interval=1d"
        resp = await client.get(url, headers=YAHOO_HEADERS)
        if resp.status_code != 200:
            return None

        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return None

        closes = (
            result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        )
        valid = [c for c in closes if c is not None]
        return float(valid[-1]) if valid else None
    except Exception:
        return None


async def _fetch_ticker_prices(
    client: httpx.AsyncClient,
    ticker: str,
    dates: list[datetime],
) -> tuple[dict[str, float], float | None]:
    """Fetch historical prices for multiple dates + current price for one ticker.

    Returns (date_str→price dict, current_price).
    """
    # Fetch current price + all historical dates concurrently
    tasks = [get_current_price(client, ticker)]
    for d in dates:
        tasks.append(get_price_on_date(client, ticker, d))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    current = results[0] if not isinstance(results[0], Exception) else None
    historical: dict[str, float] = {}
    for i, d in enumerate(dates):
        price = results[i + 1]
        if not isinstance(price, Exception) and price is not None:
            historical[d.isoformat()[:10]] = price

    return historical, current


async def update_trade_prices(
    session: AsyncSession, limit: int = 2000, force: bool = False
):
    """Update prices for trades missing price data. Deduplicates by ticker for speed."""
    stmt = select(Trade).where(
        Trade.ticker.isnot(None),
        Trade.disclosure_date.isnot(None),
        Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]),
    )
    if not force:
        stmt = stmt.where(Trade.price_at_disclosure.is_(None))
    stmt = stmt.order_by(Trade.disclosure_date.desc()).limit(limit)
    result = await session.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        logger.info("No trades need pricing")
        return 0

    # Group trades by ticker → unique disclosure dates
    ticker_dates: dict[str, set[str]] = defaultdict(set)
    ticker_trades: dict[str, list] = defaultdict(list)
    for trade in trades:
        if not trade.ticker or trade.ticker in ("--", "N/A"):
            continue
        date_key = trade.disclosure_date.isoformat()[:10]
        ticker_dates[trade.ticker].add(date_key)
        ticker_trades[trade.ticker].append(trade)

    logger.info(
        f"Pricing {len(trades)} trades across {len(ticker_dates)} unique tickers"
    )

    # Fetch prices in parallel batches
    updated = 0
    errors = 0
    semaphore = asyncio.Semaphore(CONCURRENT_FETCHES)

    async def fetch_one(client: httpx.AsyncClient, ticker: str):
        async with semaphore:
            dates_strs = ticker_dates[ticker]
            dates = [datetime.fromisoformat(d) for d in dates_strs]
            return ticker, await _fetch_ticker_prices(client, ticker, dates)

    async with httpx.AsyncClient(
        timeout=YAHOO_TIMEOUT, follow_redirects=True
    ) as client:
        tickers = list(ticker_dates.keys())
        # Process in chunks of 50 to avoid overwhelming memory
        chunk_size = 50
        for chunk_start in range(0, len(tickers), chunk_size):
            chunk = tickers[chunk_start : chunk_start + chunk_size]
            tasks = [fetch_one(client, t) for t in chunk]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for res in results:
                if isinstance(res, Exception):
                    errors += 1
                    continue
                ticker, (historical, current_price) = res
                if not current_price:
                    errors += len(ticker_trades[ticker])
                    continue

                for trade in ticker_trades[ticker]:
                    date_key = trade.disclosure_date.isoformat()[:10]
                    hist_price = historical.get(date_key)
                    if hist_price and current_price:
                        ret = ((current_price - hist_price) / hist_price) * 100
                        await session.execute(
                            update(Trade)
                            .where(Trade.id == trade.id)
                            .values(
                                price_at_disclosure=hist_price,
                                price_current=current_price,
                                return_since_disclosure=round(ret, 2),
                            )
                        )
                        updated += 1
                    else:
                        errors += 1

            # Commit after each chunk
            await session.commit()
            if chunk_start + chunk_size < len(tickers):
                await asyncio.sleep(0.5)  # Brief pause between chunks

    logger.info(
        f"Updated prices for {updated}/{len(trades)} trades "
        f"({len(ticker_dates)} tickers, {errors} failed)"
    )
    return updated


async def rebuild_politician_stats(session: AsyncSession):
    """Recalculate aggregate stats for all politicians using efficient SQL aggregation."""
    from app.services.historical_ingestion import _lookup_party

    # --- Single aggregated query for all politician stats ---
    # Uses CASE expressions for SQLite + PostgreSQL compatibility
    stats_query = (
        select(
            Trade.politician,
            Trade.chamber,
            Trade.party,
            Trade.state,
            Trade.district,
            # Total trades with tickers
            func.sum(
                case((Trade.ticker.isnot(None), 1), else_=0)
            ).label("total_trades"),
            # Total buys
            func.sum(
                case((Trade.tx_type == "purchase", 1), else_=0)
            ).label("total_buys"),
            # Total sells
            func.sum(
                case(
                    (Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]), 1),
                    else_=0,
                )
            ).label("total_sells"),
            # Average return on priced purchases
            func.avg(
                case(
                    (
                        (Trade.tx_type == "purchase")
                        & (Trade.return_since_disclosure.isnot(None)),
                        Trade.return_since_disclosure,
                    ),
                    else_=None,
                )
            ).label("avg_return"),
            # Win count (positive return purchases)
            func.sum(
                case(
                    (
                        (Trade.tx_type == "purchase")
                        & (Trade.return_since_disclosure > 0),
                        1,
                    ),
                    else_=0,
                )
            ).label("win_count"),
            # Total priced purchases (for win rate denominator)
            func.sum(
                case(
                    (
                        (Trade.tx_type == "purchase")
                        & (Trade.return_since_disclosure.isnot(None)),
                        1,
                    ),
                    else_=0,
                )
            ).label("total_with_return"),
            # Last trade date
            func.max(Trade.tx_date).label("last_trade_date"),
        )
        .group_by(
            Trade.politician, Trade.chamber, Trade.party, Trade.state, Trade.district
        )
    )

    result = await session.execute(stats_query)
    rows = result.all()

    # Deduplicate by politician name (prefer row with most trades / non-null party)
    best_row: dict[str, any] = {}
    for row in rows:
        name = row.politician
        if name not in best_row:
            best_row[name] = row
        else:
            existing = best_row[name]
            # Prefer row with party info, then more trades
            if (not existing.party and row.party) or (
                row.total_trades > existing.total_trades
            ):
                best_row[name] = row

    # Batch fetch existing politicians
    existing_pols_result = await session.execute(select(Politician))
    existing_pols = {p.name: p for p in existing_pols_result.scalars().all()}

    count = 0
    for name, row in best_row.items():
        party = row.party
        state = row.state

        # Party fallback
        if not party:
            looked_party, looked_state = _lookup_party(name)
            if looked_party:
                party = looked_party
                state = looked_state or state

        win_rate = (
            round(row.win_count / row.total_with_return * 100, 2)
            if row.total_with_return and row.total_with_return > 0
            else None
        )
        avg_return = round(row.avg_return, 2) if row.avg_return else None

        pol = existing_pols.get(name)
        if pol:
            pol.chamber = row.chamber
            pol.party = party
            pol.state = state
            pol.district = row.district
            pol.total_trades = row.total_trades
            pol.total_buys = row.total_buys
            pol.total_sells = row.total_sells
            pol.avg_return = avg_return
            pol.win_rate = win_rate
            pol.last_trade_date = row.last_trade_date
        else:
            session.add(
                Politician(
                    name=name,
                    chamber=row.chamber,
                    party=party,
                    state=state,
                    district=row.district,
                    total_trades=row.total_trades,
                    total_buys=row.total_buys,
                    total_sells=row.total_sells,
                    avg_return=avg_return,
                    win_rate=win_rate,
                    last_trade_date=row.last_trade_date,
                )
            )
        count += 1

    await session.commit()
    logger.info(f"Rebuilt stats for {count} politicians (aggregated SQL)")


async def run_performance_update(price_limit: int = 2000, force: bool = False):
    """Run full performance update cycle."""
    async with async_session() as session:
        updated = await update_trade_prices(session, limit=price_limit, force=force)
        await rebuild_politician_stats(session)
        return {"prices_updated": updated}
