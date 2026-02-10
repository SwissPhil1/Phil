"""Portfolio simulation service.

Computes NAV over time for a politician by simulating copy-trading:
- Each buy trade gets an EQUAL allocation (copy-trading style)
- Sells close the position for that ticker
- Track portfolio value weekly using actual historical prices from Yahoo Finance

Equal-weight allocation mirrors how copy-trading products work: the STOCK Act
ranges ($1K-$15K vs $5M-$25M) are just disclosure buckets, not investable
amounts. Each trade signal gets the same capital allocation.
"""

import asyncio
import logging
from bisect import bisect_left
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade

logger = logging.getLogger(__name__)

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}

# Equal $ allocated per buy trade (copy-trading standard)
POSITION_SIZE = 10_000.0


async def _fetch_weekly_prices(
    client: httpx.AsyncClient, ticker: str, start: datetime, end: datetime
) -> list[tuple[int, float]]:
    """Fetch weekly closing prices for a ticker from Yahoo v8 API.

    Returns sorted list of (unix_timestamp, close_price).
    """
    start_ts = int((start - timedelta(days=14)).timestamp())
    end_ts = int((end + timedelta(days=1)).timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?period1={start_ts}&period2={end_ts}&interval=1wk"
    )
    try:
        resp = await client.get(url, headers=YAHOO_HEADERS)
        if resp.status_code != 200:
            logger.debug(f"Yahoo {resp.status_code} for {ticker} history")
            return []
        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return []
        timestamps = result[0].get("timestamp", [])
        closes = (
            result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        )
        prices = []
        for ts, close in zip(timestamps, closes):
            if close is not None and close > 0:
                prices.append((ts, float(close)))
        return sorted(prices, key=lambda x: x[0])
    except Exception as e:
        logger.warning(f"Price history fetch failed for {ticker}: {e}")
        return []


def _nearest_price(
    prices: list[tuple[int, float]], target: datetime
) -> float | None:
    """Binary search for the closest available price to a target date."""
    if not prices:
        return None
    target_ts = int(target.timestamp())
    ts_list = [p[0] for p in prices]
    idx = bisect_left(ts_list, target_ts)

    best = None
    best_diff = float("inf")
    for i in [idx - 1, idx]:
        if 0 <= i < len(prices):
            diff = abs(ts_list[i] - target_ts)
            if diff < best_diff:
                best_diff = diff
                best = prices[i][1]
    return best


async def compute_portfolio_simulation(
    session: AsyncSession,
    politician_name: str,
) -> dict:
    """Simulate a copy-trading portfolio for a politician.

    Uses EQUAL-WEIGHT allocation: each buy trade gets $POSITION_SIZE
    regardless of the disclosed STOCK Act range. This mirrors how
    copy-trading products (like Autopilot) work.

    Sells close the position for that ticker. Cash from sells funds
    subsequent buys (no double-counting of reinvested capital).

    Returns:
        dict with nav_series (weekly data points), total_return, etc.
    """
    # 1. Get all trades for this politician (with tickers)
    stmt = (
        select(Trade)
        .where(Trade.politician.ilike(f"%{politician_name}%"))
        .where(Trade.ticker.isnot(None))
    )
    result = await session.execute(stmt)
    all_trades = result.scalars().all()

    # Filter to trades with dates and sort chronologically
    trades = [t for t in all_trades if t.tx_date or t.disclosure_date]
    if not trades:
        return {"nav_series": [], "total_return": 0, "total_invested": 0}

    trades.sort(key=lambda t: t.tx_date or t.disclosure_date)

    # 2. Unique tickers
    tickers = list(set(t.ticker for t in trades))

    # 3. Date range
    first_date = min(t.tx_date or t.disclosure_date for t in trades)
    end_date = datetime.utcnow()

    # 4. Fetch all price histories concurrently (batches of 5)
    price_data: dict[str, list[tuple[int, float]]] = {}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        for i in range(0, len(tickers), 5):
            batch = tickers[i : i + 5]
            coros = [
                _fetch_weekly_prices(client, t, first_date, end_date) for t in batch
            ]
            results = await asyncio.gather(*coros, return_exceptions=True)
            for ticker, res in zip(batch, results):
                if isinstance(res, list) and res:
                    price_data[ticker] = res
            if i + 5 < len(tickers):
                await asyncio.sleep(0.3)

    if not price_data:
        return {
            "nav_series": [],
            "total_return": 0,
            "total_invested": 0,
            "error": "no_price_data",
        }

    # 5. Build weekly date grid
    weeks: list[datetime] = []
    d = first_date
    while d <= end_date:
        weeks.append(d)
        d += timedelta(days=7)
    # Ensure we have a recent data point
    if weeks and (end_date - weeks[-1]).days > 3:
        weeks.append(end_date)

    # 6. Simulate portfolio — equal-weight, proper cash accounting
    #
    # Each buy: allocate $POSITION_SIZE (equal weight, not STOCK Act amounts).
    # Each sell: close position for that ticker (cash back to balance).
    # Cash from sells funds future buys; only inject new capital when needed.
    positions: dict[str, dict] = {}  # ticker -> {shares, cost}
    cash = 0.0  # Available cash from sell proceeds
    total_injected = 0.0  # Fresh capital injected (NOT recycled proceeds)
    trade_idx = 0
    nav_series = []

    for week_date in weeks:
        # Process all trades that happened on or before this week
        while trade_idx < len(trades):
            t = trades[trade_idx]
            t_date = t.tx_date or t.disclosure_date
            if t_date > week_date:
                break

            ticker = t.ticker
            if not ticker or ticker not in price_data:
                trade_idx += 1
                continue

            price = _nearest_price(price_data[ticker], t_date)
            if not price or price <= 0:
                trade_idx += 1
                continue

            if t.tx_type == "purchase":
                amount = POSITION_SIZE
                shares = amount / price

                # Use existing cash (from prior sells) first, then inject
                if cash >= amount:
                    cash -= amount
                else:
                    needed = amount - cash
                    total_injected += needed
                    cash = 0.0

                if ticker in positions:
                    positions[ticker]["shares"] += shares
                    positions[ticker]["cost"] += amount
                else:
                    positions[ticker] = {"shares": shares, "cost": amount}

            elif t.tx_type in ("sale", "sale_full", "sale_partial"):
                if ticker in positions:
                    pos = positions[ticker]
                    current_value = pos["shares"] * price

                    if t.tx_type == "sale_partial":
                        # Explicitly partial — sell half
                        sell_value = current_value * 0.5
                        cash += sell_value
                        pos["shares"] *= 0.5
                        pos["cost"] *= 0.5
                        if pos["shares"] <= 0.001:
                            del positions[ticker]
                    else:
                        # "sale" or "sale_full" — close entire position
                        # (politician signaled exit from this stock)
                        cash += current_value
                        del positions[ticker]

            trade_idx += 1

        # Compute NAV = market value of open positions + idle cash
        holdings_value = 0.0
        for ticker, pos in positions.items():
            p = _nearest_price(price_data[ticker], week_date)
            if p:
                holdings_value += pos["shares"] * p
            else:
                holdings_value += pos["cost"]  # fallback

        total_value = holdings_value + cash
        return_pct = (
            ((total_value / total_injected) - 1) * 100
            if total_injected > 0
            else 0.0
        )

        nav_series.append(
            {
                "date": week_date.strftime("%Y-%m-%d"),
                "nav": round(total_value, 0),
                "return_pct": round(return_pct, 1),
                "positions": len(positions),
                "invested": round(total_injected, 0),
            }
        )

    final_return = nav_series[-1]["return_pct"] if nav_series else 0

    return {
        "nav_series": nav_series,
        "total_return": final_return,
        "total_invested": round(total_injected, 0),
        "positions_open": len(positions),
        "tickers_traded": len(tickers),
        "tickers_priced": len(price_data),
        "total_trades": len(trades),
    }
