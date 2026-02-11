"""Portfolio simulation service.

Computes NAV over time for a politician by simulating copy-trading.
Two strategies run in parallel:

  1. Equal-weight: $10K per trade (copy-trading standard — what YOU'd make)
  2. Conviction-weighted: tiered by STOCK Act range (1x–5x, captures sizing signal)

Both use proper cash accounting (sells fund future buys) and historical
Yahoo Finance prices for the equity curve on individual politician pages.

For the leaderboard, a faster version uses stored prices from the DB
(no Yahoo API calls) to compute returns for all politicians at once.
"""

import asyncio
import logging
from bisect import bisect_left
from datetime import datetime, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade

logger = logging.getLogger(__name__)

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}

# Equal $ allocated per buy trade (copy-trading standard)
POSITION_SIZE = 10_000.0

# Conviction tier mapping: (amount_midpoint_threshold, position_size)
# Max ratio 5:1 — captures position-sizing signal without extreme concentration
CONVICTION_TIERS = [
    (15_000, 10_000),       # $1K–$15K     → $10K  (1.0x)
    (50_000, 15_000),       # $15K–$50K    → $15K  (1.5x)
    (100_000, 20_000),      # $50K–$100K   → $20K  (2.0x)
    (250_000, 25_000),      # $100K–$250K  → $25K  (2.5x)
    (500_000, 30_000),      # $250K–$500K  → $30K  (3.0x)
    (1_000_000, 35_000),    # $500K–$1M    → $35K  (3.5x)
    (5_000_000, 40_000),    # $1M–$5M      → $40K  (4.0x)
    (25_000_000, 45_000),   # $5M–$25M     → $45K  (4.5x)
]


def _conviction_amount(amount_low: float | None, amount_high: float | None) -> float:
    """Map STOCK Act disclosure range to conviction-weighted position size."""
    if not amount_low or not amount_high:
        return POSITION_SIZE
    mid = (amount_low + amount_high) / 2
    for threshold, size in CONVICTION_TIERS:
        if mid <= threshold:
            return size
    return 50_000  # $25M+ → $50K (5.0x)


def _cagr(final_nav: float, invested: float, years: float) -> float:
    """Compound Annual Growth Rate."""
    if years <= 0.1 or invested <= 0 or final_nav <= 0:
        return 0.0
    ratio = final_nav / invested
    return round((ratio ** (1 / years) - 1) * 100, 1)


# ─── Yahoo price fetching ───


async def _fetch_weekly_prices(
    client: httpx.AsyncClient, ticker: str, start: datetime, end: datetime
) -> list[tuple[int, float]]:
    """Fetch weekly closing prices for a ticker from Yahoo v8 API."""
    start_ts = int((start - timedelta(days=14)).timestamp())
    end_ts = int((end + timedelta(days=1)).timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?period1={start_ts}&period2={end_ts}&interval=1wk"
    )
    try:
        resp = await client.get(url, headers=YAHOO_HEADERS)
        if resp.status_code != 200:
            return []
        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return []
        timestamps = result[0].get("timestamp", [])
        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        return sorted(
            [(ts, float(c)) for ts, c in zip(timestamps, closes) if c is not None and c > 0],
            key=lambda x: x[0],
        )
    except Exception as e:
        logger.warning(f"Price history fetch failed for {ticker}: {e}")
        return []


def _nearest_price(prices: list[tuple[int, float]], target: datetime) -> float | None:
    """Binary search for the closest available price to a target date."""
    if not prices:
        return None
    target_ts = int(target.timestamp())
    ts_list = [p[0] for p in prices]
    idx = bisect_left(ts_list, target_ts)
    best, best_diff = None, float("inf")
    for i in [idx - 1, idx]:
        if 0 <= i < len(prices):
            diff = abs(ts_list[i] - target_ts)
            if diff < best_diff:
                best_diff = diff
                best = prices[i][1]
    return best


# ─── Core simulation engine (used by both Yahoo and stored-price modes) ───


def _run_simulation(
    trades: list,
    get_price: callable,  # (ticker, date) -> float | None
    get_amount: callable,  # (trade) -> float
    weeks: list[datetime] | None = None,
) -> tuple[list[dict], float, int]:
    """Run a single portfolio simulation.

    Args:
        trades: sorted list of Trade objects
        get_price: function to get price for (ticker, date)
        get_amount: function to get allocation amount for a trade
        weeks: weekly date grid for NAV snapshots (None = final-only mode)

    Returns:
        (nav_series, total_injected, positions_open)
    """
    positions: dict[str, dict] = {}
    cash = 0.0
    total_injected = 0.0
    trade_idx = 0
    nav_series = []

    if weeks is None:
        # Final-only mode: process all trades, then compute final NAV
        weeks = [datetime.utcnow()]

    for week_date in weeks:
        while trade_idx < len(trades):
            t = trades[trade_idx]
            t_date = t.tx_date or t.disclosure_date
            if t_date and t_date > week_date:
                break

            ticker = t.ticker
            if not ticker:
                trade_idx += 1
                continue

            price = get_price(ticker, t_date) if t_date else None
            if not price or price <= 0:
                trade_idx += 1
                continue

            if t.tx_type == "purchase":
                amount = get_amount(t)
                shares = amount / price

                if cash >= amount:
                    cash -= amount
                else:
                    total_injected += amount - cash
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
                        cash += current_value * 0.5
                        pos["shares"] *= 0.5
                        pos["cost"] *= 0.5
                        if pos["shares"] <= 0.001:
                            del positions[ticker]
                    else:
                        cash += current_value
                        del positions[ticker]

            trade_idx += 1

        # Compute NAV
        holdings = 0.0
        for ticker, pos in positions.items():
            p = get_price(ticker, week_date)
            if p:
                holdings += pos["shares"] * p
            else:
                holdings += pos["cost"]

        nav = holdings + cash
        return_pct = ((nav / total_injected) - 1) * 100 if total_injected > 0 else 0.0

        nav_series.append({
            "date": week_date.strftime("%Y-%m-%d"),
            "nav": round(nav, 0),
            "return_pct": round(return_pct, 1),
            "positions": len(positions),
            "invested": round(total_injected, 0),
        })

    return nav_series, total_injected, len(positions)


# ─── Individual politician page: Yahoo-powered dual simulation ───


async def compute_portfolio_simulation(
    session: AsyncSession,
    politician_name: str,
) -> dict:
    """Compute dual portfolio simulation (equal-weight + conviction-weighted).

    Uses Yahoo Finance weekly prices for a proper equity curve chart.
    Returns both strategies' NAV series merged for dual-line charting.
    """
    # 1. Get trades
    stmt = (
        select(Trade)
        .where(Trade.politician.ilike(f"%{politician_name}%"))
        .where(Trade.ticker.isnot(None))
    )
    result = await session.execute(stmt)
    all_trades = result.scalars().all()

    trades = sorted(
        [t for t in all_trades if t.tx_date or t.disclosure_date],
        key=lambda t: t.tx_date or t.disclosure_date,
    )
    if not trades:
        return {"nav_series": [], "equal_weight": {}, "conviction_weighted": {}}

    tickers = list(set(t.ticker for t in trades))
    first_date = min(t.tx_date or t.disclosure_date for t in trades)
    end_date = datetime.utcnow()

    # 2. Fetch price histories
    price_data: dict[str, list[tuple[int, float]]] = {}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        for i in range(0, len(tickers), 5):
            batch = tickers[i : i + 5]
            coros = [_fetch_weekly_prices(client, t, first_date, end_date) for t in batch]
            results = await asyncio.gather(*coros, return_exceptions=True)
            for ticker, res in zip(batch, results):
                if isinstance(res, list) and res:
                    price_data[ticker] = res
            if i + 5 < len(tickers):
                await asyncio.sleep(0.3)

    if not price_data:
        return {"nav_series": [], "equal_weight": {}, "conviction_weighted": {}, "error": "no_price_data"}

    # 3. Build weekly date grid
    weeks: list[datetime] = []
    d = first_date
    while d <= end_date:
        weeks.append(d)
        d += timedelta(days=7)
    if weeks and (end_date - weeks[-1]).days > 3:
        weeks.append(end_date)

    # Price lookup using Yahoo data
    def yahoo_price(ticker: str, date: datetime) -> float | None:
        if ticker not in price_data:
            return None
        return _nearest_price(price_data[ticker], date)

    # 4. Run both simulations
    eq_series, eq_invested, eq_open = _run_simulation(
        trades, yahoo_price, lambda t: POSITION_SIZE, weeks
    )
    conv_series, conv_invested, conv_open = _run_simulation(
        trades, yahoo_price, lambda t: _conviction_amount(t.amount_low, t.amount_high), weeks
    )

    # 5. Merge into combined series for dual-line chart
    combined = []
    for eq, conv in zip(eq_series, conv_series):
        combined.append({
            "date": eq["date"],
            "eq_return": eq["return_pct"],
            "conv_return": conv["return_pct"],
            "eq_nav": eq["nav"],
            "conv_nav": conv["nav"],
            "positions": eq["positions"],
        })

    # 6. Compute annual returns (CAGR)
    years = (end_date - first_date).days / 365.25
    eq_final = eq_series[-1] if eq_series else {"return_pct": 0, "nav": 0}
    conv_final = conv_series[-1] if conv_series else {"return_pct": 0, "nav": 0}

    return {
        "nav_series": combined,
        "equal_weight": {
            "total_return": eq_final["return_pct"],
            "annual_return": _cagr(eq_final["nav"], eq_invested, years),
            "total_invested": round(eq_invested, 0),
            "positions_open": eq_open,
        },
        "conviction_weighted": {
            "total_return": conv_final["return_pct"],
            "annual_return": _cagr(conv_final["nav"], conv_invested, years),
            "total_invested": round(conv_invested, 0),
            "positions_open": conv_open,
        },
        "tickers_traded": len(tickers),
        "tickers_priced": len(price_data),
        "total_trades": len(trades),
        "years": round(years, 1),
    }


# ─── Leaderboard: fast returns using stored prices (no Yahoo calls) ───


async def compute_leaderboard_returns(
    session: AsyncSession,
    min_priced_trades: int = 5,
) -> list[dict]:
    """Compute portfolio returns for all politicians using stored DB prices.

    Uses price_at_disclosure for entry/exit and price_current for open
    positions. No Yahoo API calls — fast enough for a leaderboard endpoint.
    """
    # Get politicians with enough priced buy trades
    pol_counts = await session.execute(
        select(Trade.politician, func.count().label("cnt"))
        .where(Trade.ticker.isnot(None))
        .where(Trade.price_at_disclosure.isnot(None))
        .where(Trade.tx_type == "purchase")
        .group_by(Trade.politician)
        .having(func.count() >= min_priced_trades)
    )

    results = []

    for pol_name, _ in pol_counts:
        # Get all trades for this politician (sorted by date)
        trade_result = await session.execute(
            select(Trade)
            .where(Trade.politician == pol_name)
            .where(Trade.ticker.isnot(None))
            .order_by(Trade.tx_date.asc())
        )
        trades = trade_result.scalars().all()
        trades = [t for t in trades if t.tx_date or t.disclosure_date]
        if not trades:
            continue

        # Build current-price lookup (latest price_current per ticker)
        current_prices: dict[str, float] = {}
        for t in reversed(trades):
            if t.ticker and t.price_current and t.ticker not in current_prices:
                current_prices[t.ticker] = t.price_current

        eq_result = None
        conv_result = None

        for mode, get_amount in [
            ("equal_weight", lambda t: POSITION_SIZE),
            ("conviction_weighted", lambda t: _conviction_amount(t.amount_low, t.amount_high)),
        ]:
            positions: dict[str, dict] = {}
            cash = 0.0
            injected = 0.0

            for t in trades:
                price = t.price_at_disclosure
                if not price or price <= 0 or not t.ticker:
                    continue

                if t.tx_type == "purchase":
                    amount = get_amount(t)
                    shares = amount / price
                    if cash >= amount:
                        cash -= amount
                    else:
                        injected += amount - cash
                        cash = 0.0
                    if t.ticker in positions:
                        positions[t.ticker]["shares"] += shares
                        positions[t.ticker]["cost"] += amount
                    else:
                        positions[t.ticker] = {"shares": shares, "cost": amount}

                elif t.tx_type in ("sale", "sale_full", "sale_partial"):
                    if t.ticker in positions:
                        pos = positions[t.ticker]
                        val = pos["shares"] * price
                        if t.tx_type == "sale_partial":
                            cash += val * 0.5
                            pos["shares"] *= 0.5
                            pos["cost"] *= 0.5
                            if pos["shares"] <= 0.001:
                                del positions[t.ticker]
                        else:
                            cash += val
                            del positions[t.ticker]

            if injected <= 0:
                continue

            # Value open positions at current prices
            holdings = 0.0
            for ticker, pos in positions.items():
                cp = current_prices.get(ticker)
                holdings += pos["shares"] * cp if cp else pos["cost"]

            nav = holdings + cash
            total_return = round(((nav / injected) - 1) * 100, 1)

            dates = [t.tx_date or t.disclosure_date for t in trades if t.tx_date or t.disclosure_date]
            years = (datetime.utcnow() - min(dates)).days / 365.25
            annual = _cagr(nav, injected, years)

            result_entry = {
                "total_return": total_return,
                "annual_return": annual,
                "total_invested": round(injected, 0),
                "positions_open": len(positions),
                "years": round(years, 1),
            }
            if mode == "equal_weight":
                eq_result = result_entry
            else:
                conv_result = result_entry

        # Get party info
        party = next((t.party for t in trades if t.party), None)
        state = next((t.state for t in trades if t.state), None)
        chamber = next((t.chamber for t in trades if t.chamber), None)

        buy_count = sum(1 for t in trades if t.tx_type == "purchase")

        if eq_result and conv_result:
            results.append({
                "politician": pol_name,
                "party": party,
                "state": state,
                "chamber": chamber,
                "total_trades": buy_count,
                "equal_weight": eq_result,
                "conviction_weighted": conv_result,
            })

    results.sort(key=lambda x: x["equal_weight"]["annual_return"] or 0, reverse=True)
    return results
