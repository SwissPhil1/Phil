"""Backfill service — populates forward-looking price data for score validation.

Fills in:
  - price_30d_after: price 30 calendar days after disclosure
  - price_90d_after: price 90 calendar days after disclosure
  - return_30d / return_90d: percentage returns for those windows
  - excess_return_30d / excess_return_90d: returns minus SPY over same window
  - disclosure_delay_days: (disclosure_date - tx_date).days

This data is the GROUND TRUTH for validating whether the suspicion score
actually predicts future returns. Without it, any score is untestable.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    TickerPrice,
    Trade,
    async_session,
    dialect_insert,
)
from app.services.performance import (
    CONCURRENT_FETCHES,
    YAHOO_HEADERS,
    YAHOO_TIMEOUT,
    get_price_on_date,
)

logger = logging.getLogger(__name__)

# SPY ticker for S&P 500 benchmark
SPY = "SPY"


async def _fetch_price_cached(
    session: AsyncSession,
    client: httpx.AsyncClient,
    ticker: str,
    target_date: datetime,
) -> float | None:
    """Get price for a ticker on a date, using TickerPrice cache first."""
    date_str = target_date.isoformat()[:10]

    # Check cache
    result = await session.execute(
        select(TickerPrice.close_price).where(
            TickerPrice.ticker == ticker,
            TickerPrice.date == date_str,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        return row

    # Fetch from Yahoo
    price = await get_price_on_date(client, ticker, target_date)
    if price is not None:
        stmt = dialect_insert(TickerPrice).values(
            ticker=ticker, date=date_str, close_price=price
        ).on_conflict_do_nothing()
        await session.execute(stmt)

    return price


async def backfill_disclosure_delay(session: AsyncSession) -> int:
    """Populate disclosure_delay_days for all trades that have both dates."""
    result = await session.execute(
        select(Trade).where(
            Trade.tx_date.isnot(None),
            Trade.disclosure_date.isnot(None),
            Trade.disclosure_delay_days.is_(None),
        )
    )
    trades = result.scalars().all()

    count = 0
    for trade in trades:
        delay = (trade.disclosure_date - trade.tx_date).days
        if delay >= 0:
            trade.disclosure_delay_days = delay
            count += 1

    await session.commit()
    logger.info(f"Backfilled disclosure_delay_days for {count} trades")
    return count


async def backfill_forward_prices(
    session: AsyncSession,
    limit: int = 2000,
) -> dict:
    """Populate price_30d_after, price_90d_after, and forward returns.

    Only processes trades where:
    - disclosure_date is at least 90 days ago (so 90d price exists)
    - ticker is not null
    - price_at_disclosure exists (needed for return calculation)
    - return_90d is still null (not yet backfilled)
    """
    cutoff_90d = datetime.utcnow() - timedelta(days=95)  # 5 day buffer

    stmt = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.disclosure_date.isnot(None),
            Trade.disclosure_date <= cutoff_90d,
            Trade.price_at_disclosure.isnot(None),
            Trade.price_at_disclosure > 0,
            Trade.return_90d.is_(None),
            Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]),
        )
        .order_by(Trade.disclosure_date.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        logger.info("No trades need forward price backfill")
        return {"trades_processed": 0}

    logger.info(f"Backfilling forward prices for {len(trades)} trades")

    # Gather all (ticker, date) pairs we need
    needed: dict[str, set[str]] = defaultdict(set)  # ticker -> set of date strings
    trade_dates: dict[int, tuple[datetime, datetime]] = {}  # trade_id -> (30d_date, 90d_date)

    for trade in trades:
        d30 = trade.disclosure_date + timedelta(days=30)
        d90 = trade.disclosure_date + timedelta(days=90)
        trade_dates[trade.id] = (d30, d90)
        needed[trade.ticker].add(d30.isoformat()[:10])
        needed[trade.ticker].add(d90.isoformat()[:10])

    # Also need SPY prices for excess return calculation
    spy_dates: set[str] = set()
    for trade in trades:
        spy_dates.add(trade.disclosure_date.isoformat()[:10])
        d30 = trade.disclosure_date + timedelta(days=30)
        d90 = trade.disclosure_date + timedelta(days=90)
        spy_dates.add(d30.isoformat()[:10])
        spy_dates.add(d90.isoformat()[:10])
    needed[SPY] = spy_dates

    # Fetch all prices (cache-first, then Yahoo)
    semaphore = asyncio.Semaphore(CONCURRENT_FETCHES)
    price_cache: dict[tuple[str, str], float] = {}

    # Pre-load from TickerPrice cache
    all_tickers = list(needed.keys())
    for ticker_chunk_start in range(0, len(all_tickers), 50):
        ticker_chunk = all_tickers[ticker_chunk_start:ticker_chunk_start + 50]
        cached_result = await session.execute(
            select(TickerPrice.ticker, TickerPrice.date, TickerPrice.close_price)
            .where(TickerPrice.ticker.in_(ticker_chunk))
        )
        for row in cached_result:
            price_cache[(row.ticker, row.date)] = row.close_price

    # Find what's still missing
    missing: dict[str, list[str]] = defaultdict(list)
    for ticker, dates in needed.items():
        for d in dates:
            if (ticker, d) not in price_cache:
                missing[ticker].append(d)

    logger.info(
        f"Forward prices: {len(price_cache)} cached, "
        f"{sum(len(v) for v in missing.values())} need Yahoo fetch "
        f"across {len(missing)} tickers"
    )

    # Fetch missing from Yahoo
    if missing:
        async with httpx.AsyncClient(timeout=YAHOO_TIMEOUT, follow_redirects=True) as client:
            async def fetch_ticker_dates(ticker: str, date_strs: list[str]):
                async with semaphore:
                    for date_str in date_strs:
                        target = datetime.fromisoformat(date_str)
                        price = await get_price_on_date(client, ticker, target)
                        if price is not None:
                            price_cache[(ticker, date_str)] = price
                            # Store in cache table
                            stmt = dialect_insert(TickerPrice).values(
                                ticker=ticker, date=date_str, close_price=price
                            ).on_conflict_do_nothing()
                            await session.execute(stmt)

            tickers_to_fetch = list(missing.keys())
            for chunk_start in range(0, len(tickers_to_fetch), 30):
                chunk = tickers_to_fetch[chunk_start:chunk_start + 30]
                tasks = [fetch_ticker_dates(t, missing[t]) for t in chunk]
                await asyncio.gather(*tasks, return_exceptions=True)
                await session.commit()
                if chunk_start + 30 < len(tickers_to_fetch):
                    await asyncio.sleep(0.5)

    # Now update each trade with forward prices and returns
    updated = 0
    for trade in trades:
        d30, d90 = trade_dates[trade.id]
        d30_str = d30.isoformat()[:10]
        d90_str = d90.isoformat()[:10]
        disc_str = trade.disclosure_date.isoformat()[:10]

        p30 = price_cache.get((trade.ticker, d30_str))
        p90 = price_cache.get((trade.ticker, d90_str))
        p_disc = trade.price_at_disclosure

        if p30 is not None:
            trade.price_30d_after = p30
            trade.return_30d = round(((p30 - p_disc) / p_disc) * 100, 2)

        if p90 is not None:
            trade.price_90d_after = p90
            trade.return_90d = round(((p90 - p_disc) / p_disc) * 100, 2)

        # Excess returns (vs SPY)
        spy_disc = price_cache.get((SPY, disc_str))
        if spy_disc and spy_disc > 0:
            spy_30 = price_cache.get((SPY, d30_str))
            spy_90 = price_cache.get((SPY, d90_str))

            if spy_30 and trade.return_30d is not None:
                spy_ret_30 = ((spy_30 - spy_disc) / spy_disc) * 100
                trade.excess_return_30d = round(trade.return_30d - spy_ret_30, 2)

            if spy_90 and trade.return_90d is not None:
                spy_ret_90 = ((spy_90 - spy_disc) / spy_disc) * 100
                trade.excess_return_90d = round(trade.return_90d - spy_ret_90, 2)

        updated += 1

    await session.commit()
    logger.info(f"Backfilled forward prices for {updated} trades")
    return {"trades_processed": updated, "prices_fetched": len(price_cache)}


async def backfill_cluster_flags(session: AsyncSession) -> int:
    """Flag trades where 3+ politicians bought the same ticker within 7 days.

    This is a strong signal of shared non-public information.
    """
    # Find clusters: tickers bought by 3+ different politicians within 7 days
    # We use a self-join approach: for each trade, count distinct politicians
    # who also bought the same ticker within ±7 days

    # Reset all flags first
    await session.execute(
        update(Trade).where(Trade.cluster_flag.is_(True)).values(cluster_flag=False)
    )

    # Get all purchase trades with tickers
    stmt = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
            Trade.tx_date.isnot(None),
        )
        .order_by(Trade.ticker, Trade.tx_date)
    )
    result = await session.execute(stmt)
    trades = result.scalars().all()

    # Group by ticker
    by_ticker: dict[str, list] = defaultdict(list)
    for t in trades:
        by_ticker[t.ticker].append(t)

    flagged = 0
    for ticker, ticker_trades in by_ticker.items():
        for i, trade in enumerate(ticker_trades):
            # Look within ±7 day window
            window_start = trade.tx_date - timedelta(days=7)
            window_end = trade.tx_date + timedelta(days=7)

            politicians_in_window = set()
            for other in ticker_trades:
                if window_start <= other.tx_date <= window_end:
                    politicians_in_window.add(other.politician)

            if len(politicians_in_window) >= 3:
                trade.cluster_flag = True
                flagged += 1

    await session.commit()
    logger.info(f"Flagged {flagged} trades as cluster trades (3+ politicians)")
    return flagged


async def backfill_realized_returns(session: AsyncSession) -> dict:
    """Match buy trades to sell trades and compute realized round-trip returns.

    For each politician+ticker pair:
      1. Sort trades chronologically
      2. Track open buy positions (FIFO queue)
      3. When a sell occurs, match it to the oldest open buy
      4. Compute realized_return = (sell_price - buy_price) / buy_price * 100
      5. Record hold_days = (sell_date - buy_date).days

    This gives us the actual profit/loss the politician made on each
    round-trip trade, which is the most direct test of informed trading.
    """
    # Get all trades with tickers and prices, ordered for matching
    stmt = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.price_at_disclosure.isnot(None),
            Trade.price_at_disclosure > 0,
            Trade.tx_date.isnot(None),
        )
        .order_by(Trade.politician, Trade.ticker, Trade.tx_date)
    )
    result = await session.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        return {"matched": 0}

    # Group by (politician, ticker)
    from collections import defaultdict
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for t in trades:
        groups[(t.politician, t.ticker)].append(t)

    matched = 0
    total_pairs = 0

    for (politician, ticker), group_trades in groups.items():
        # FIFO queue of open buy positions
        open_buys: list[Trade] = []

        for trade in group_trades:
            if trade.tx_type == "purchase":
                open_buys.append(trade)

            elif trade.tx_type in ("sale", "sale_full", "sale_partial"):
                if not open_buys:
                    continue  # Sell without a matching buy (position opened before our data)

                sell_price = trade.price_at_disclosure
                sell_date = trade.tx_date

                if not sell_price or sell_price <= 0:
                    continue

                if trade.tx_type == "sale_partial":
                    # Partial sell: match to the oldest buy but don't remove it
                    buy = open_buys[0]
                    buy_price = buy.price_at_disclosure
                    buy_date = buy.tx_date

                    if buy_price and buy_price > 0 and buy_date:
                        ret = round(((sell_price - buy_price) / buy_price) * 100, 2)
                        days_held = (sell_date - buy_date).days

                        # Store on the BUY trade (so we can correlate with suspicion score)
                        if buy.realized_return is None:
                            buy.realized_return = ret
                            buy.hold_days = days_held
                            buy.sell_price = sell_price
                            buy.matched_sell_id = trade.id
                            matched += 1
                        total_pairs += 1
                else:
                    # Full sell: match and remove the oldest buy (FIFO)
                    buy = open_buys.pop(0)
                    buy_price = buy.price_at_disclosure
                    buy_date = buy.tx_date

                    if buy_price and buy_price > 0 and buy_date:
                        ret = round(((sell_price - buy_price) / buy_price) * 100, 2)
                        days_held = (sell_date - buy_date).days

                        buy.realized_return = ret
                        buy.hold_days = days_held
                        buy.sell_price = sell_price
                        buy.matched_sell_id = trade.id
                        matched += 1
                    total_pairs += 1

        # For remaining open buys with no sell, check if we can use current price
        # as an "unrealized" reference (don't mark as realized — leave realized_return null)
        # This is intentional: we only count actual closed positions as "realized"

    await session.commit()
    logger.info(
        f"Matched {matched} buy→sell round-trips "
        f"({total_pairs} sell events processed)"
    )
    return {"matched_buys": matched, "sell_events": total_pairs}


async def run_full_backfill(price_limit: int = 2000):
    """Run all backfill operations in sequence."""
    async with async_session() as session:
        delay_count = await backfill_disclosure_delay(session)
        forward_result = await backfill_forward_prices(session, limit=price_limit)
        cluster_count = await backfill_cluster_flags(session)
        roundtrip_result = await backfill_realized_returns(session)

        return {
            "disclosure_delays_filled": delay_count,
            "forward_prices": forward_result,
            "cluster_flags": cluster_count,
            "round_trips": roundtrip_result,
        }
