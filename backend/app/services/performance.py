"""Performance tracking service - calculates returns for politician trades.

Architecture (v3 — unified simulation engine):
- TickerPrice / TickerCurrentPrice tables cache ALL price data
- Trades get returns via JOIN with cached prices (bulk UPDATE per ticker)
- Politician table stores pre-computed portfolio stats (leaderboard reads this)
- Portfolio simulation uses the SAME _run_simulation engine from portfolio.py
  for both leaderboard (stored prices) and profile pages (live Yahoo prices)
- Yahoo API calls are per unique ticker (~1000), NOT per trade (~80K)
"""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import httpx
from sqlalchemy import Numeric, case, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Politician,
    TickerCurrentPrice,
    TickerPrice,
    Trade,
    async_session,
    dialect_insert,
)
from app.services.portfolio import (
    _run_simulation,
    _conviction_amount,
    _cagr,
    POSITION_SIZE,
)

logger = logging.getLogger(__name__)

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}
CONCURRENT_FETCHES = 15
YAHOO_TIMEOUT = 12


# ─── Yahoo API helpers ───


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
    """Fetch historical prices for multiple dates + current price for one ticker."""
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


# ─── TickerPrice cache layer ───


async def populate_ticker_price_cache(session: AsyncSession, limit: int = 2000):
    """Fetch prices for trades missing price data and store in TickerPrice tables.

    This is the main pricing pipeline. It:
    1. Finds unpriced trades
    2. Checks TickerPrice cache for existing data
    3. Only calls Yahoo for genuinely missing (ticker, date) pairs
    4. Stores results in TickerPrice + TickerCurrentPrice tables
    5. Bulk-updates Trade rows from the cache
    """
    # Step 1: Find trades needing prices
    stmt = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            or_(Trade.disclosure_date.isnot(None), Trade.tx_date.isnot(None)),
            Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]),
            Trade.price_at_disclosure.is_(None),
        )
        .order_by(Trade.disclosure_date.desc().nullslast())
        .limit(limit)
    )
    result = await session.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        logger.info("No trades need pricing")
        return 0

    # Step 2: Gather needed (ticker, date) pairs
    needed: dict[str, set[str]] = defaultdict(set)  # ticker -> set of date_strs
    for trade in trades:
        if not trade.ticker or trade.ticker in ("--", "N/A"):
            continue
        trade_date = trade.tx_date or trade.disclosure_date
        if not trade_date:
            continue
        needed[trade.ticker].add(trade_date.isoformat()[:10])

    if not needed:
        return 0

    # Step 3: Check what's already in TickerPrice cache
    all_tickers = list(needed.keys())
    cached_result = await session.execute(
        select(TickerPrice.ticker, TickerPrice.date, TickerPrice.close_price)
        .where(TickerPrice.ticker.in_(all_tickers))
    )
    cached: dict[tuple[str, str], float] = {}
    for row in cached_result:
        cached[(row.ticker, row.date)] = row.close_price

    # Check current prices cache
    current_cached_result = await session.execute(
        select(TickerCurrentPrice.ticker, TickerCurrentPrice.price)
        .where(TickerCurrentPrice.ticker.in_(all_tickers))
    )
    current_cached: dict[str, float] = {r.ticker: r.price for r in current_cached_result}

    # Filter to what we actually need to fetch from Yahoo
    fetch_needed: dict[str, set[str]] = defaultdict(set)
    tickers_needing_current: set[str] = set()
    for ticker, dates in needed.items():
        if ticker not in current_cached:
            tickers_needing_current.add(ticker)
        for d in dates:
            if (ticker, d) not in cached:
                fetch_needed[ticker].add(d)
                tickers_needing_current.add(ticker)  # Also get current if fetching historical

    logger.info(
        f"Pricing {len(trades)} trades across {len(needed)} tickers "
        f"({len(fetch_needed)} need Yahoo fetch, {len(needed) - len(fetch_needed)} fully cached)"
    )

    # Step 4: Fetch from Yahoo for missing data
    if fetch_needed or tickers_needing_current:
        semaphore = asyncio.Semaphore(CONCURRENT_FETCHES)
        new_historical: dict[tuple[str, str], float] = {}
        new_current: dict[str, float] = {}

        async def fetch_one(client: httpx.AsyncClient, ticker: str):
            async with semaphore:
                dates_strs = fetch_needed.get(ticker, set())
                dates = [datetime.fromisoformat(d) for d in dates_strs]
                historical, current = await _fetch_ticker_prices(client, ticker, dates)
                for date_str, price in historical.items():
                    new_historical[(ticker, date_str)] = price
                if current:
                    new_current[ticker] = current

        tickers_to_fetch = list(tickers_needing_current | set(fetch_needed.keys()))
        async with httpx.AsyncClient(timeout=YAHOO_TIMEOUT, follow_redirects=True) as client:
            chunk_size = 50
            for chunk_start in range(0, len(tickers_to_fetch), chunk_size):
                chunk = tickers_to_fetch[chunk_start : chunk_start + chunk_size]
                tasks = [fetch_one(client, t) for t in chunk]
                await asyncio.gather(*tasks, return_exceptions=True)
                if chunk_start + chunk_size < len(tickers_to_fetch):
                    await asyncio.sleep(0.5)

        # Store new historical prices in TickerPrice cache
        if new_historical:
            for (ticker, date_str), price in new_historical.items():
                stmt = dialect_insert(TickerPrice).values(
                    ticker=ticker, date=date_str, close_price=price
                ).on_conflict_do_nothing()
                await session.execute(stmt)
            cached.update(new_historical)

        # Store new current prices
        if new_current:
            for ticker, price in new_current.items():
                stmt = dialect_insert(TickerCurrentPrice).values(
                    ticker=ticker, price=price
                ).on_conflict_do_update(
                    index_elements=["ticker"],
                    set_={"price": price, "updated_at": datetime.utcnow()},
                )
                await session.execute(stmt)
            current_cached.update(new_current)

        await session.commit()

    # Step 5: Bulk-update Trade rows from cache (per ticker, not per trade)
    updated = 0
    for ticker, date_strs in needed.items():
        current_price = current_cached.get(ticker)
        if not current_price:
            continue

        for date_str in date_strs:
            hist_price = cached.get((ticker, date_str))
            if not hist_price:
                continue

            ret = round(((current_price - hist_price) / hist_price) * 100, 2)
            # Bulk update all trades with this ticker+date
            trade_date = datetime.fromisoformat(date_str)
            date_start = trade_date.replace(hour=0, minute=0, second=0)
            date_end = trade_date.replace(hour=23, minute=59, second=59)

            result = await session.execute(
                update(Trade)
                .where(
                    Trade.ticker == ticker,
                    Trade.price_at_disclosure.is_(None),
                    or_(
                        Trade.tx_date.between(date_start, date_end),
                        Trade.disclosure_date.between(date_start, date_end),
                    ),
                )
                .values(
                    price_at_disclosure=hist_price,
                    price_current=current_price,
                    return_since_disclosure=ret,
                )
            )
            updated += result.rowcount

    await session.commit()
    logger.info(f"Updated prices for {updated} trades from TickerPrice cache")
    return updated


async def refresh_current_prices(session: AsyncSession):
    """Fast refresh: update current prices for all tickers in the cache.

    1. Fetches current price for each unique ticker (~1000 Yahoo calls)
    2. Stores in TickerCurrentPrice table
    3. Bulk-updates Trade.price_current and return_since_disclosure per ticker
    """
    # Get all unique tickers that have historical price data
    stmt = (
        select(Trade.ticker)
        .where(
            Trade.ticker.isnot(None),
            Trade.price_at_disclosure.isnot(None),
            Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]),
        )
        .distinct()
    )
    result = await session.execute(stmt)
    tickers = [r[0] for r in result.all() if r[0] and r[0] not in ("--", "N/A")]

    if not tickers:
        logger.info("No priced tickers to refresh")
        return 0

    logger.info(f"Refreshing current prices for {len(tickers)} tickers")

    # Fetch current prices in parallel
    semaphore = asyncio.Semaphore(CONCURRENT_FETCHES)
    price_map: dict[str, float] = {}

    async def fetch_one(client: httpx.AsyncClient, ticker: str):
        async with semaphore:
            price = await get_current_price(client, ticker)
            if price:
                price_map[ticker] = price

    async with httpx.AsyncClient(timeout=YAHOO_TIMEOUT, follow_redirects=True) as client:
        chunk_size = 50
        for chunk_start in range(0, len(tickers), chunk_size):
            chunk = tickers[chunk_start : chunk_start + chunk_size]
            await asyncio.gather(
                *[fetch_one(client, t) for t in chunk],
                return_exceptions=True,
            )
            if chunk_start + chunk_size < len(tickers):
                await asyncio.sleep(0.3)

    # Update TickerCurrentPrice cache
    for ticker, price in price_map.items():
        stmt = dialect_insert(TickerCurrentPrice).values(
            ticker=ticker, price=price
        ).on_conflict_do_update(
            index_elements=["ticker"],
            set_={"price": price, "updated_at": datetime.utcnow()},
        )
        await session.execute(stmt)
    await session.commit()

    # Batch update all trades per ticker
    updated = 0
    batch_count = 0
    for ticker, current_price in price_map.items():
        await session.execute(
            update(Trade)
            .where(
                Trade.ticker == ticker,
                Trade.price_at_disclosure.isnot(None),
                Trade.price_at_disclosure > 0,
            )
            .values(
                price_current=current_price,
                return_since_disclosure=func.round(
                    cast(
                        ((current_price - Trade.price_at_disclosure) / Trade.price_at_disclosure) * 100,
                        Numeric,
                    ),
                    2,
                ),
            )
        )
        updated += 1
        batch_count += 1
        if batch_count >= 100:
            await session.commit()
            batch_count = 0

    if batch_count > 0:
        await session.commit()
    logger.info(f"Refreshed current prices: {len(price_map)}/{len(tickers)} tickers updated")
    return updated


# ─── Portfolio simulation ───
# Uses the shared _run_simulation engine from portfolio.py so that
# leaderboard stats and individual profile pages produce identical results.
# Only the price source differs: stored DB prices here vs live Yahoo on profile pages.


# ─── Unified stats rebuild ───


async def rebuild_politician_stats(session: AsyncSession):
    """Recalculate ALL politician stats: basic aggregates + portfolio returns.

    This is the single source of truth. Both the leaderboard and politician
    detail page read from the Politician table that this function populates.
    """
    from app.services.historical_ingestion import _lookup_party

    # --- Phase 1: Aggregated SQL stats (fast GROUP BY) ---
    stats_query = (
        select(
            Trade.politician,
            Trade.chamber,
            Trade.party,
            Trade.state,
            Trade.district,
            func.sum(
                case((Trade.ticker.isnot(None), 1), else_=0)
            ).label("total_trades"),
            func.sum(
                case((Trade.tx_type == "purchase", 1), else_=0)
            ).label("total_buys"),
            func.sum(
                case(
                    (Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]), 1),
                    else_=0,
                )
            ).label("total_sells"),
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
            if (not existing.party and row.party) or (
                row.total_trades > existing.total_trades
            ):
                best_row[name] = row

    # --- Phase 2: Portfolio simulation for each politician ---
    # Build global current price lookup from TickerCurrentPrice table
    current_prices_result = await session.execute(
        select(TickerCurrentPrice.ticker, TickerCurrentPrice.price)
    )
    current_prices: dict[str, float] = {r.ticker: r.price for r in current_prices_result}

    # Fallback: also pull from Trade.price_current for tickers not yet in cache
    trade_prices_result = await session.execute(
        select(Trade.ticker, Trade.price_current)
        .where(Trade.ticker.isnot(None), Trade.price_current.isnot(None))
        .distinct(Trade.ticker)
    )
    for r in trade_prices_result:
        if r.ticker not in current_prices and r.price_current:
            current_prices[r.ticker] = r.price_current

    # Fetch ALL trades grouped by politician (single query, ordered)
    all_trades_result = await session.execute(
        select(Trade)
        .where(Trade.ticker.isnot(None))
        .order_by(Trade.politician, Trade.tx_date.asc().nullslast())
    )
    all_trades = all_trades_result.scalars().all()

    # Group by politician
    politician_trades: dict[str, list] = defaultdict(list)
    for t in all_trades:
        politician_trades[t.politician].append(t)

    # Merge name variants into best_row keys
    # Map all trade politician names to their best_row canonical name
    canonical_map: dict[str, str] = {}
    for name in best_row:
        canonical_map[name] = name
    # For trades whose politician name isn't in best_row, try to find a match
    for pol_name in politician_trades:
        if pol_name not in canonical_map:
            canonical_map[pol_name] = pol_name

    # Build global (ticker, date) → historical price lookup from trade data
    # This lets _run_simulation look up entry prices without Yahoo API calls
    historical_prices: dict[tuple[str, str], float] = {}
    for t in all_trades:
        if t.price_at_disclosure and t.price_at_disclosure > 0 and t.ticker:
            d = t.tx_date or t.disclosure_date
            if d:
                historical_prices[(t.ticker, d.isoformat()[:10])] = t.price_at_disclosure

    # Build per-ticker sorted price timelines for nearest-price lookup
    # Uses ALL politicians' trades so more data points are available
    from bisect import bisect_left as _bisect
    from collections import defaultdict as _ddict
    ticker_timeline: dict[str, list[tuple[str, float]]] = _ddict(list)
    for (tk, ds), px in historical_prices.items():
        ticker_timeline[tk].append((ds, px))
    for tk in ticker_timeline:
        ticker_timeline[tk].sort()

    today_str = datetime.utcnow().isoformat()[:10]

    def stored_price(ticker: str, date: datetime) -> float | None:
        """Price lookup using stored DB data.

        For trade dates: returns exact price_at_disclosure.
        For current (today): returns cached current price.
        For intermediate dates: finds nearest historical price from ANY
        politician's trades within 6 months, so TWR unit pricing is accurate.
        Falls back to None (engine uses position cost) if nothing close.
        """
        date_str = date.isoformat()[:10]
        # Exact match on a trade date
        hist = historical_prices.get((ticker, date_str))
        if hist:
            return hist
        # Today or future → use current market price
        if date_str >= today_str:
            return current_prices.get(ticker)
        # Intermediate date: find nearest price from any politician's trades
        timeline = ticker_timeline.get(ticker)
        if timeline:
            dates = [h[0] for h in timeline]
            idx = _bisect(dates, date_str)
            best, best_diff = None, float("inf")
            for i in [idx - 1, idx]:
                if 0 <= i < len(timeline):
                    try:
                        d_ts = datetime.fromisoformat(timeline[i][0]).timestamp()
                        diff = abs(d_ts - date.timestamp())
                        if diff < best_diff:
                            best_diff = diff
                            best = timeline[i][1]
                    except Exception:
                        pass
            # Accept if within 6 months
            if best is not None and best_diff < 180 * 86400:
                return best
        # No data → _run_simulation falls back to position cost
        return None

    # Compute portfolio stats per politician using the SAME engine as profile pages
    portfolio_stats: dict[str, dict] = {}
    for pol_name, trades in politician_trades.items():
        canonical = canonical_map.get(pol_name, pol_name)
        if canonical in portfolio_stats:
            continue  # Already computed

        # Collect all trades for this politician (including name variants)
        all_pol_trades = []
        for variant_name, variant_trades in politician_trades.items():
            if canonical_map.get(variant_name) == canonical:
                all_pol_trades.extend(variant_trades)

        # Sort by date
        all_pol_trades.sort(key=lambda t: (t.tx_date or t.disclosure_date or datetime.min))

        # Count priced buys for minimum threshold
        priced_buys = sum(
            1 for t in all_pol_trades
            if t.tx_type == "purchase"
            and t.ticker
            and (t.tx_date or t.disclosure_date)
            and t.price_at_disclosure
            and t.price_at_disclosure > 0
        )

        # Compute years active
        dates = [t.tx_date or t.disclosure_date for t in all_pol_trades if t.tx_date or t.disclosure_date]
        years = (datetime.utcnow() - min(dates)).days / 365.25 if dates else 0

        def _extract_stats(nav_series, positions_open):
            """Convert _run_simulation output to leaderboard stats dict."""
            if not nav_series or priced_buys < 3:
                return None
            final = nav_series[-1]
            return {
                "total_return": final["return_pct"],
                "annual_return": _cagr(final["nav"], 1.0, years),
                "priced_buys": priced_buys,
                "positions_open": positions_open,
                "years": round(years, 1),
            }

        # Equal-weight simulation (same engine as profile page)
        eq_series, _, eq_open = _run_simulation(
            all_pol_trades, stored_price, lambda t: POSITION_SIZE,
        )
        eq = _extract_stats(eq_series, eq_open)

        # Conviction-weighted simulation (same engine + same tiers as profile page)
        conv_series, _, conv_open = _run_simulation(
            all_pol_trades, stored_price,
            lambda t: _conviction_amount(t.amount_low, t.amount_high),
        )
        conv = _extract_stats(conv_series, conv_open)

        # Include if at least one simulation succeeded
        primary = eq or conv
        if primary:
            portfolio_stats[canonical] = {
                "portfolio_return": eq["total_return"] if eq else conv["total_return"],
                "portfolio_cagr": eq["annual_return"] if eq else conv["annual_return"],
                "conviction_return": conv["total_return"] if conv else None,
                "conviction_cagr": conv["annual_return"] if conv else None,
                "priced_buy_count": primary["priced_buys"],
                "years_active": primary["years"],
            }

    # --- Phase 3: Write everything to Politician table ---
    existing_pols_result = await session.execute(select(Politician))
    existing_pols = {p.name: p for p in existing_pols_result.scalars().all()}

    count = 0
    for name, row in best_row.items():
        party = row.party
        state = row.state

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

        pf = portfolio_stats.get(name, {})

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
            pol.portfolio_return = pf.get("portfolio_return")
            pol.portfolio_cagr = pf.get("portfolio_cagr")
            pol.conviction_return = pf.get("conviction_return")
            pol.conviction_cagr = pf.get("conviction_cagr")
            pol.priced_buy_count = pf.get("priced_buy_count", 0)
            pol.years_active = pf.get("years_active")
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
                    portfolio_return=pf.get("portfolio_return"),
                    portfolio_cagr=pf.get("portfolio_cagr"),
                    conviction_return=pf.get("conviction_return"),
                    conviction_cagr=pf.get("conviction_cagr"),
                    priced_buy_count=pf.get("priced_buy_count", 0),
                    years_active=pf.get("years_active"),
                )
            )
        count += 1

    await session.commit()
    logger.info(
        f"Rebuilt stats for {count} politicians "
        f"({len(portfolio_stats)} with portfolio returns)"
    )


# ─── Scheduled job entry points ───


async def update_trade_prices(
    session: AsyncSession, limit: int = 2000, force: bool = False
):
    """Compat wrapper: calls the new TickerPrice-based pipeline."""
    return await populate_ticker_price_cache(session, limit=limit)


async def run_performance_update(price_limit: int = 2000, force: bool = False):
    """Run full performance update cycle: price new trades + rebuild stats."""
    async with async_session() as session:
        updated = await populate_ticker_price_cache(session, limit=price_limit)
        await rebuild_politician_stats(session)
        return {"prices_updated": updated}


async def run_price_refresh():
    """Fast cycle: refresh current prices for already-priced tickers + rebuild stats."""
    async with async_session() as session:
        updated = await refresh_current_prices(session)
        await rebuild_politician_stats(session)
        return {"tickers_refreshed": updated}
