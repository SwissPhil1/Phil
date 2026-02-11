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
    """Run a portfolio simulation using Time-Weighted Return (TWR).

    Uses a unit/share approach (like a mutual fund NAV):
    - When fresh capital is needed, issue new "units" at current NAV/unit
    - When sells generate cash, cash stays in the fund (no unit redemption)
    - NAV per unit tracks pure investment performance, independent of
      capital flows — so period rebasing on the frontend works correctly

    Args:
        trades: sorted list of Trade objects
        get_price: function to get price for (ticker, date)
        get_amount: function to get allocation amount for a trade
        weeks: weekly date grid for NAV snapshots (None = final-only mode)

    Returns:
        (nav_series, units_outstanding, positions_open)
    """
    positions: dict[str, dict] = {}
    cash = 0.0
    units = 0.0  # Total fund units outstanding
    trade_idx = 0
    nav_series = []

    if weeks is None:
        # Final-only mode: process all trades, then compute final NAV
        weeks = [datetime.utcnow()]

    def _holdings_value(as_of: datetime) -> float:
        """Mark-to-market value of all open positions."""
        v = 0.0
        for tk, pos in positions.items():
            p = get_price(tk, as_of)
            v += pos["shares"] * p if p else pos["cost"]
        return v

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
                    # Fully funded from existing cash — no new units needed
                    cash -= amount
                else:
                    # Need fresh capital injection → issue new units
                    fresh = amount - cash
                    if units > 0:
                        # Price new units at current NAV/unit
                        current_nav = _holdings_value(t_date) + cash
                        nav_per_unit = current_nav / units
                        if nav_per_unit > 0:
                            units += fresh / nav_per_unit
                        else:
                            units += fresh
                    else:
                        # Very first investment: 1 unit = $1
                        units += fresh
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

        # Weekly NAV snapshot — output NAV per unit (not raw NAV)
        holdings = _holdings_value(week_date)
        nav = holdings + cash
        nav_per_unit = nav / units if units > 0 else 1.0
        return_pct = (nav_per_unit - 1.0) * 100

        nav_series.append({
            "date": week_date.strftime("%Y-%m-%d"),
            "nav": round(nav_per_unit, 4),  # NAV per unit (starts ~1.0)
            "return_pct": round(return_pct, 1),
            "positions": len(positions),
            "invested": round(units, 0),
        })

    return nav_series, units, len(positions)


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

    # 6. Compute annual returns (CAGR on NAV per unit, starting at 1.0)
    years = (end_date - first_date).days / 365.25
    eq_final = eq_series[-1] if eq_series else {"return_pct": 0, "nav": 1.0}
    conv_final = conv_series[-1] if conv_series else {"return_pct": 0, "nav": 1.0}

    return {
        "nav_series": combined,
        "equal_weight": {
            "total_return": eq_final["return_pct"],
            "annual_return": _cagr(eq_final["nav"], 1.0, years),
            "total_invested": round(eq_invested, 0),
            "positions_open": eq_open,
        },
        "conviction_weighted": {
            "total_return": conv_final["return_pct"],
            "annual_return": _cagr(conv_final["nav"], 1.0, years),
            "total_invested": round(conv_invested, 0),
            "positions_open": conv_open,
        },
        "tickers_traded": len(tickers),
        "tickers_priced": len(price_data),
        "total_trades": len(trades),
        "years": round(years, 1),
    }


# ─── Leaderboard: fast returns using stored prices (no Yahoo calls) ───


async def _batch_fetch_current_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch current prices for a batch of tickers from Yahoo v8 API.

    Used as a fallback when stored prices are missing from the DB.
    """
    prices: dict[str, float] = {}
    if not tickers:
        return prices

    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        for i in range(0, len(tickers), 10):
            batch = tickers[i : i + 10]
            coros = []
            for ticker in batch:
                async def _fetch(t=ticker):
                    try:
                        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?range=5d&interval=1d"
                        resp = await client.get(url, headers=YAHOO_HEADERS)
                        if resp.status_code != 200:
                            return t, None
                        data = resp.json()
                        result = data.get("chart", {}).get("result", [])
                        if not result:
                            return t, None
                        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                        valid = [c for c in closes if c is not None]
                        return t, float(valid[-1]) if valid else None
                    except Exception:
                        return t, None
                coros.append(_fetch())
            results = await asyncio.gather(*coros, return_exceptions=True)
            for res in results:
                if isinstance(res, tuple) and res[1] is not None:
                    prices[res[0]] = res[1]
            if i + 10 < len(tickers):
                await asyncio.sleep(0.3)

    logger.info(f"Yahoo fallback: fetched {len(prices)}/{len(tickers)} current prices")
    return prices


async def compute_leaderboard_returns(
    session: AsyncSession,
    min_priced_trades: int = 3,
) -> list[dict]:
    """Compute portfolio returns for all politicians using stored DB prices.

    Uses price_at_disclosure for entry/exit and price_current for open
    positions. Falls back to Yahoo API for tickers missing current prices.

    Includes politicians even if not all their trades have prices — the
    simulation just skips unpriced trades and requires at least
    min_priced_trades executed buys to be included.
    """
    # Get ALL politicians with enough buy trades (regardless of price data)
    pol_counts = await session.execute(
        select(Trade.politician, func.count().label("cnt"))
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_type == "purchase")
        .group_by(Trade.politician)
        .having(func.count() >= min_priced_trades)
    )

    # Build a GLOBAL current-price lookup from ALL trades (not per-politician)
    # This ensures tickers priced for one politician benefit all others too
    all_price_result = await session.execute(
        select(Trade.ticker, Trade.price_current, Trade.price_at_disclosure, Trade.return_since_disclosure)
        .where(Trade.ticker.isnot(None))
        .where(Trade.price_at_disclosure.isnot(None))
        .order_by(Trade.tx_date.desc().nullslast())
    )
    global_current_prices: dict[str, float] = {}
    for row in all_price_result:
        ticker = row.ticker
        if ticker in global_current_prices:
            continue
        if row.price_current:
            global_current_prices[ticker] = row.price_current
        elif row.price_at_disclosure and row.return_since_disclosure is not None:
            global_current_prices[ticker] = row.price_at_disclosure * (1 + row.return_since_disclosure / 100)

    results = []
    # Track tickers that need Yahoo fallback (open positions without current price)
    missing_tickers: set[str] = set()

    # First pass: simulate all politicians and identify missing prices
    politician_data: list[tuple] = []
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
        politician_data.append((pol_name, trades))

        # Check for open positions missing current prices
        open_tickers: set[str] = set()
        for t in trades:
            if not t.ticker or not t.price_at_disclosure:
                continue
            if t.tx_type == "purchase":
                open_tickers.add(t.ticker)
            elif t.tx_type in ("sale", "sale_full"):
                open_tickers.discard(t.ticker)
        for ticker in open_tickers:
            if ticker not in global_current_prices:
                missing_tickers.add(ticker)

    # Fetch missing prices from Yahoo (lightweight — only for tickers without DB prices)
    if missing_tickers:
        yahoo_prices = await _batch_fetch_current_prices(list(missing_tickers))
        global_current_prices.update(yahoo_prices)

    # Second pass: compute returns with complete price data
    for pol_name, trades in politician_data:
        eq_result = None
        conv_result = None

        for mode, get_amount in [
            ("equal_weight", lambda t: POSITION_SIZE),
            ("conviction_weighted", lambda t: _conviction_amount(t.amount_low, t.amount_high)),
        ]:
            positions: dict[str, dict] = {}
            cash = 0.0
            total_bought = 0.0
            priced_buys = 0

            for t in trades:
                price = t.price_at_disclosure
                if not price or price <= 0 or not t.ticker:
                    continue

                if t.tx_type == "purchase":
                    amount = get_amount(t)
                    shares = amount / price
                    total_bought += amount
                    priced_buys += 1
                    if cash >= amount:
                        cash -= amount
                    else:
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

            if total_bought <= 0 or priced_buys < min_priced_trades:
                if mode == "equal_weight":
                    total_buys = sum(1 for t in trades if t.tx_type == "purchase")
                    unpriced = sum(1 for t in trades if t.tx_type == "purchase" and (not t.price_at_disclosure or t.price_at_disclosure <= 0))
                    if total_buys >= min_priced_trades:
                        logger.warning(
                            f"Leaderboard EXCLUDED {pol_name}: {total_buys} buys but only "
                            f"{priced_buys} priced (need {min_priced_trades}). "
                            f"{unpriced} buys missing price_at_disclosure."
                        )
                continue

            # Value open positions at current prices (global lookup)
            holdings = 0.0
            for ticker, pos in positions.items():
                cp = global_current_prices.get(ticker)
                holdings += pos["shares"] * cp if cp else pos["cost"]

            nav = holdings + cash
            total_return = round(((nav / total_bought) - 1) * 100, 1)

            dates = [t.tx_date or t.disclosure_date for t in trades if t.tx_date or t.disclosure_date]
            years = (datetime.utcnow() - min(dates)).days / 365.25
            annual = _cagr(nav, total_bought, years)

            result_entry = {
                "total_return": total_return,
                "annual_return": annual,
                "total_invested": round(total_bought, 0),
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
