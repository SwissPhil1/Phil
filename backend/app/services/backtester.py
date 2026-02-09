"""
Conviction score backtester and politician leaderboard.

Backtests the scoring system against actual trade returns to validate
whether higher conviction scores actually predict better stock performance.
Also builds year-over-year politician trading leaderboards.

v2: Enhanced with factor attribution, statistical significance testing,
    risk-adjusted returns (Sharpe), and per-factor edge analysis.
"""

import logging
import math
from collections import defaultdict
from datetime import datetime, timedelta

import yfinance as yf
from sqlalchemy import func, select, extract, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Trade, Politician, InsiderTrade, HedgeFundHolding,
    PoliticianCommittee, async_session,
)
from app.services.signals import (
    check_committee_overlap,
    score_trade_conviction,
    get_politician_track_record,
    TICKER_SECTORS,
    MEGA_CAP,
    LARGE_CAP,
)

logger = logging.getLogger(__name__)


# ─── PRICE LOOKUP WITH CACHING ───

_price_cache: dict[str, float] = {}


def _get_price(ticker: str, date: datetime) -> float | None:
    """Get price for a ticker on a date, with simple cache."""
    cache_key = f"{ticker}:{date.strftime('%Y-%m-%d')}"
    if cache_key in _price_cache:
        return _price_cache[cache_key]

    try:
        start = date - timedelta(days=5)
        end = date + timedelta(days=5)
        data = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
        if data.empty:
            return None
        idx = data.index.get_indexer([date], method="nearest")[0]
        close = data.iloc[idx]["Close"]
        price = float(close.iloc[0]) if hasattr(close, "iloc") else float(close)
        _price_cache[cache_key] = price
        return price
    except Exception as e:
        logger.debug(f"Price lookup failed for {ticker} on {date}: {e}")
        return None


# ─── STATISTICAL HELPERS ───


def _calculate_stats(returns: list[float]) -> dict:
    """Calculate comprehensive statistics for a list of returns."""
    if not returns:
        return {
            "count": 0, "avg": None, "median": None, "std": None,
            "win_rate": None, "best": None, "worst": None, "sharpe": None,
        }

    n = len(returns)
    avg = sum(returns) / n
    sorted_returns = sorted(returns)
    median = sorted_returns[n // 2]
    wins = sum(1 for r in returns if r > 0)

    # Standard deviation
    if n > 1:
        variance = sum((r - avg) ** 2 for r in returns) / (n - 1)
        std = math.sqrt(variance)
    else:
        std = 0

    # Annualized Sharpe ratio (assuming risk-free rate ~5% / 252 trading days)
    sharpe = None
    if std > 0 and n >= 5:
        # Simple Sharpe: excess return / volatility
        sharpe = round(avg / std, 2)

    return {
        "count": n,
        "avg": round(avg, 2),
        "median": round(median, 2),
        "std": round(std, 2) if std else 0,
        "win_rate": round(wins / n * 100, 1),
        "best": round(max(returns), 2),
        "worst": round(min(returns), 2),
        "sharpe": sharpe,
        "total_return": round(sum(returns), 2),
    }


def _t_test_edge(high_returns: list[float], low_returns: list[float]) -> dict:
    """Simple t-test to check if high-score returns significantly beat low-score."""
    if len(high_returns) < 3 or len(low_returns) < 3:
        return {"significant": None, "detail": "Not enough data for statistical test"}

    n1, n2 = len(high_returns), len(low_returns)
    mean1, mean2 = sum(high_returns) / n1, sum(low_returns) / n2

    var1 = sum((x - mean1) ** 2 for x in high_returns) / (n1 - 1) if n1 > 1 else 0
    var2 = sum((x - mean2) ** 2 for x in low_returns) / (n2 - 1) if n2 > 1 else 0

    se = math.sqrt(var1 / n1 + var2 / n2) if (var1 / n1 + var2 / n2) > 0 else 0

    if se == 0:
        return {"significant": None, "detail": "Zero variance"}

    t_stat = (mean1 - mean2) / se
    # Rough significance: |t| > 1.96 = 95% confidence
    significant = abs(t_stat) > 1.96

    return {
        "t_statistic": round(t_stat, 3),
        "significant_95pct": significant,
        "edge_pct": round(mean1 - mean2, 2),
        "high_score_avg": round(mean1, 2),
        "low_score_avg": round(mean2, 2),
        "high_count": n1,
        "low_count": n2,
        "detail": (
            f"{'Statistically significant' if significant else 'Not significant'} "
            f"(t={t_stat:.2f}, p{'<' if significant else '>'}0.05)"
        ),
    }


# ─── CONVICTION SCORE BACKTESTER ───


async def _find_exit_trades(session: AsyncSession, since: datetime) -> dict[str, dict]:
    """
    Build a map of (politician, ticker, buy_date) -> exit trade info.
    For each purchase, find the first sale of that same ticker by that
    same politician after the buy date. That's the exit.
    """
    sales_stmt = (
        select(Trade)
        .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_date >= since)
        .where(Trade.ticker != "--")
        .where(Trade.ticker != "N/A")
        .order_by(Trade.tx_date.asc())
    )
    sales_result = await session.execute(sales_stmt)
    all_sales = sales_result.scalars().all()

    sales_index: dict[tuple[str, str], list] = defaultdict(list)
    for s in all_sales:
        if s.ticker and s.tx_date:
            key = (s.politician.lower(), s.ticker.upper())
            sales_index[key].append(s)

    return sales_index


def _match_exit(
    sales_index: dict,
    politician: str,
    ticker: str,
    buy_date: datetime,
) -> dict | None:
    """Find the first sale of this ticker by this politician after buy_date."""
    key = (politician.lower(), ticker.upper())
    sales = sales_index.get(key, [])

    for sale in sales:
        if sale.tx_date and sale.tx_date > buy_date:
            return {
                "exit_date": sale.tx_date,
                "exit_tx_type": sale.tx_type,
                "exit_amount_low": sale.amount_low,
                "exit_amount_high": sale.amount_high,
                "exit_disclosure_date": sale.disclosure_date,
            }

    return None


async def backtest_conviction_scores(
    days: int = 365,
    forward_days: int = 30,
    max_trades: int = 200,
    return_mode: str = "both",
) -> dict:
    """
    Backtest the conviction scoring system against real trade data.

    return_mode options:
    - "forward": measure return N days after purchase (fixed window)
    - "exit": measure return at the actual exit (when politician sold)
    - "both": show both (default) - compare fixed window vs real P&L

    v2 enhancements:
    - Uses enhanced scoring with track record + contrarian factors
    - Factor attribution: which factors contribute most to edge
    - Statistical significance testing (t-test)
    - Risk-adjusted returns (Sharpe ratio per bucket)
    - Per-factor edge analysis
    """
    since = datetime.utcnow() - timedelta(days=days)
    cutoff = datetime.utcnow() - timedelta(days=forward_days)

    async with async_session() as session:
        # Get purchase trades with tickers
        stmt = (
            select(Trade)
            .where(Trade.tx_type == "purchase")
            .where(Trade.ticker.isnot(None))
            .where(Trade.tx_date >= since)
            .where(Trade.tx_date <= cutoff)
            .where(Trade.ticker != "--")
            .where(Trade.ticker != "N/A")
            .order_by(Trade.tx_date.desc())
            .limit(max_trades)
        )
        result = await session.execute(stmt)
        trades = result.scalars().all()

        if not trades:
            return {
                "error": "No trades found in date range to backtest",
                "trades_checked": 0,
            }

        # Build exit trade index
        sales_index = await _find_exit_trades(session, since)

        # Get committee data for all politicians
        politician_names = list(set(t.politician for t in trades))
        committee_map: dict[str, list[str]] = {}
        for name in politician_names:
            comm_result = await session.execute(
                select(PoliticianCommittee.committee_name)
                .where(PoliticianCommittee.politician_name.ilike(f"%{name}%"))
            )
            committee_map[name] = [r[0] for r in comm_result.all()]

        # Get politician track records
        track_records: dict[str, dict] = {}
        for name in politician_names:
            track_records[name] = await get_politician_track_record(session, name)

        # Get cluster data
        cluster_counts: dict[str, int] = {}
        cluster_result = await session.execute(
            select(
                Trade.ticker,
                func.count(func.distinct(Trade.politician)).label("pol_count"),
            )
            .where(Trade.tx_date >= since)
            .where(Trade.tx_type == "purchase")
            .where(Trade.ticker.isnot(None))
            .group_by(Trade.ticker)
        )
        for row in cluster_result.all():
            cluster_counts[row.ticker] = row.pol_count

        # Get sell counts (for contrarian detection)
        sell_counts: dict[str, int] = {}
        sell_result = await session.execute(
            select(
                Trade.ticker,
                func.count(func.distinct(Trade.politician)).label("pol_count"),
            )
            .where(Trade.tx_date >= since)
            .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
            .where(Trade.ticker.isnot(None))
            .group_by(Trade.ticker)
        )
        for row in sell_result.all():
            sell_counts[row.ticker] = row.pol_count

        # Get insider buying tickers
        insider_buying: set[str] = set()
        insider_result = await session.execute(
            select(InsiderTrade.ticker)
            .where(InsiderTrade.filing_date >= since)
            .where(InsiderTrade.tx_type == "purchase")
            .where(InsiderTrade.ticker.isnot(None))
            .distinct()
        )
        for row in insider_result.all():
            insider_buying.add(row[0])

        # Get hedge fund new positions
        fund_new: set[str] = set()
        fund_result = await session.execute(
            select(HedgeFundHolding.ticker)
            .where(HedgeFundHolding.ticker.isnot(None))
            .where(HedgeFundHolding.is_new_position == True)
            .distinct()
        )
        for row in fund_result.all():
            fund_new.add(row[0])

    # Now score each trade and look up returns
    scored_trades = []
    price_lookup_count = 0
    exits_found = 0

    for trade in trades:
        ticker = trade.ticker
        if not ticker or ticker in ("--", "N/A", ""):
            continue

        # Build trade dict for scoring
        trade_dict = {
            "ticker": ticker,
            "tx_type": trade.tx_type,
            "amount_low": trade.amount_low or 0,
            "disclosure_delay_days": (
                (trade.disclosure_date - trade.tx_date).days
                if trade.disclosure_date and trade.tx_date
                else None
            ),
        }

        committees = committee_map.get(trade.politician, [])
        cluster_count = cluster_counts.get(ticker, 0)
        insider_buying_this = ticker in insider_buying
        fund_holds_this = ticker in fund_new
        politician_record = track_records.get(trade.politician)
        recent_sells = sell_counts.get(ticker, 0)

        # Use the enhanced v2 scoring
        score_result = score_trade_conviction(
            trade=trade_dict,
            committees=committees,
            cluster_count=cluster_count,
            insider_also_buying=insider_buying_this,
            fund_also_holds=fund_holds_this,
            politician_track_record=politician_record,
            recent_sells_count=recent_sells,
        )

        score = score_result["score"]
        factors = score_result["factors"]
        factor_breakdown = score_result["factor_breakdown"]

        # ── PRICE LOOKUPS ──

        FORWARD_WINDOWS = [30, 90, 180, 365]

        price_at_trade = None
        forward_returns = {}
        forward_prices = {}
        exit_return = None
        exit_info = None
        holding_days = None
        still_holding = True

        if trade.tx_date:
            price_at_trade = _get_price(ticker, trade.tx_date)
            price_lookup_count += 1

            # Multi-window forward returns
            if return_mode in ("forward", "both"):
                for window in FORWARD_WINDOWS:
                    fwd_date = trade.tx_date + timedelta(days=window)
                    if fwd_date <= datetime.utcnow():
                        p = _get_price(ticker, fwd_date)
                        if price_at_trade and p and price_at_trade > 0:
                            forward_returns[window] = round(
                                ((p - price_at_trade) / price_at_trade) * 100, 2
                            )
                            forward_prices[window] = round(p, 2)

            # Exit return (actual sell date)
            if return_mode in ("exit", "both"):
                exit_match = _match_exit(
                    sales_index, trade.politician, ticker, trade.tx_date
                )
                if exit_match:
                    exits_found += 1
                    still_holding = False
                    exit_date = exit_match["exit_date"]
                    holding_days = (exit_date - trade.tx_date).days

                    price_at_exit = _get_price(ticker, exit_date)

                    if price_at_trade and price_at_exit and price_at_trade > 0:
                        exit_return = ((price_at_exit - price_at_trade) / price_at_trade) * 100

                    exit_info = {
                        "exit_date": exit_date.isoformat(),
                        "exit_type": exit_match["exit_tx_type"],
                        "exit_amount_low": exit_match["exit_amount_low"],
                        "exit_amount_high": exit_match["exit_amount_high"],
                        "holding_days": holding_days,
                        "price_at_exit": round(price_at_exit, 2) if price_at_exit else None,
                        "exit_return_pct": round(exit_return, 2) if exit_return is not None else None,
                    }

        # For still-held positions, show unrealized return
        price_now = None
        unrealized_return = None
        if still_holding and price_at_trade and price_at_trade > 0:
            price_now = _get_price(ticker, datetime.utcnow())
            if price_now:
                unrealized_return = ((price_now - price_at_trade) / price_at_trade) * 100
                holding_days = (datetime.utcnow() - trade.tx_date).days if trade.tx_date else None

        scored_trades.append({
            "politician": trade.politician,
            "party": trade.party,
            "ticker": ticker,
            "tx_date": trade.tx_date.isoformat() if trade.tx_date else None,
            "amount_low": trade.amount_low,
            "score": score,
            "rating": score_result["rating"],
            "factors": factors,
            "factor_breakdown": factor_breakdown,
            "committees": committees,
            "cluster_count": cluster_count,
            "track_record": politician_record,
            # Entry
            "price_at_trade": round(price_at_trade, 2) if price_at_trade else None,
            # Multi-window forward returns
            "forward_returns": {
                f"{w}d": {"price": forward_prices.get(w), "return_pct": forward_returns.get(w)}
                for w in FORWARD_WINDOWS
            },
            "forward_return_pct": forward_returns.get(forward_days),
            # Exit return
            "exit": exit_info,
            "still_holding": still_holding,
            # Unrealized
            "price_now": round(price_now, 2) if price_now else None,
            "unrealized_return_pct": round(unrealized_return, 2) if unrealized_return is not None else None,
            "holding_days": holding_days,
            # Best available return
            "best_return_pct": (
                round(exit_return, 2) if exit_return is not None
                else forward_returns.get(forward_days)
                if forward_returns.get(forward_days) is not None
                else round(unrealized_return, 2) if unrealized_return is not None
                else None
            ),
        })

    # ── ANALYSIS ──

    def _get_return(t: dict, mode: str) -> float | None:
        if mode == "exit":
            if t["exit"] and t["exit"]["exit_return_pct"] is not None:
                return t["exit"]["exit_return_pct"]
            return None
        elif mode == "forward":
            return t["forward_return_pct"]
        else:  # "both" - prefer exit, fall back to forward
            if t["exit"] and t["exit"]["exit_return_pct"] is not None:
                return t["exit"]["exit_return_pct"]
            return t["forward_return_pct"]

    # Score bucket analysis with enhanced stats
    buckets = {
        "0-19 (VERY_LOW)": [],
        "20-39 (LOW)": [],
        "40-59 (MEDIUM)": [],
        "60-79 (HIGH)": [],
        "80-100 (VERY_HIGH)": [],
    }

    for t in scored_trades:
        ret = _get_return(t, return_mode)
        if ret is None:
            continue
        s = t["score"]
        if s >= 80:
            buckets["80-100 (VERY_HIGH)"].append(ret)
        elif s >= 60:
            buckets["60-79 (HIGH)"].append(ret)
        elif s >= 40:
            buckets["40-59 (MEDIUM)"].append(ret)
        elif s >= 20:
            buckets["20-39 (LOW)"].append(ret)
        else:
            buckets["0-19 (VERY_LOW)"].append(ret)

    bucket_analysis = {
        name: _calculate_stats(returns)
        for name, returns in buckets.items()
    }

    # Score validation with statistical significance
    scored_with_returns = [t for t in scored_trades if _get_return(t, return_mode) is not None]
    high_score_returns = [_get_return(t, return_mode) for t in scored_with_returns if t["score"] >= 50]
    low_score_returns = [_get_return(t, return_mode) for t in scored_with_returns if t["score"] < 50]

    score_validation = _t_test_edge(high_score_returns, low_score_returns)

    # ── FACTOR ATTRIBUTION ──
    # For each factor, compare trades that have it vs don't
    factor_attribution = {}
    factor_names = set()
    for t in scored_trades:
        for f in t["factors"]:
            factor_names.add(f["factor"])

    for factor_name in factor_names:
        has_factor = [
            _get_return(t, return_mode) for t in scored_trades
            if any(f["factor"] == factor_name for f in t["factors"])
            and _get_return(t, return_mode) is not None
        ]
        no_factor = [
            _get_return(t, return_mode) for t in scored_trades
            if not any(f["factor"] == factor_name for f in t["factors"])
            and _get_return(t, return_mode) is not None
        ]

        if has_factor and no_factor:
            has_avg = sum(has_factor) / len(has_factor)
            no_avg = sum(no_factor) / len(no_factor)
            factor_attribution[factor_name] = {
                "trades_with": len(has_factor),
                "avg_return_with": round(has_avg, 2),
                "trades_without": len(no_factor),
                "avg_return_without": round(no_avg, 2),
                "edge_pct": round(has_avg - no_avg, 2),
                "win_rate_with": round(sum(1 for r in has_factor if r > 0) / len(has_factor) * 100, 1),
                "win_rate_without": round(sum(1 for r in no_factor if r > 0) / len(no_factor) * 100, 1),
            }

    # Sort by edge
    factor_attribution = dict(
        sorted(factor_attribution.items(), key=lambda x: x[1]["edge_pct"], reverse=True)
    )

    # Top scored trades
    top_scored = sorted(scored_trades, key=lambda x: x["score"], reverse=True)[:20]

    # Committee analysis
    committee_trades = [t for t in scored_trades if any(
        f["factor"] == "committee_overlap" for f in t["factors"]
    )]
    committee_returns = [_get_return(t, return_mode) for t in committee_trades if _get_return(t, return_mode) is not None]
    non_committee_trades = [t for t in scored_trades if not any(
        f["factor"] == "committee_overlap" for f in t["factors"]
    )]
    non_committee_returns = [_get_return(t, return_mode) for t in non_committee_trades if _get_return(t, return_mode) is not None]

    committee_analysis = {
        "committee_overlap_trades": _calculate_stats(committee_returns),
        "non_committee_trades": _calculate_stats(non_committee_returns),
        "statistical_test": _t_test_edge(committee_returns, non_committee_returns),
    }

    # Market cap analysis
    small_cap_committee = [
        _get_return(t, return_mode) for t in scored_trades
        if t["ticker"] not in MEGA_CAP and t["ticker"] not in LARGE_CAP
        and any(f["factor"] == "committee_overlap" for f in t["factors"])
        and _get_return(t, return_mode) is not None
    ]
    large_cap_cluster = [
        _get_return(t, return_mode) for t in scored_trades
        if t["ticker"] in MEGA_CAP
        and t["cluster_count"] >= 3
        and _get_return(t, return_mode) is not None
    ]

    cap_analysis = {
        "question": "Is a committee member buying a small-cap in their sector stronger than politicians clustering into mega-caps?",
        "small_cap_committee": _calculate_stats(small_cap_committee),
        "mega_cap_cluster": _calculate_stats(large_cap_cluster),
        "statistical_test": _t_test_edge(small_cap_committee, large_cap_cluster),
    }

    # Multi-window analysis
    multi_window_analysis = {}
    for window in [30, 90, 180, 365]:
        window_returns = [
            t["forward_returns"].get(f"{window}d", {}).get("return_pct")
            for t in scored_trades
            if t["forward_returns"].get(f"{window}d", {}).get("return_pct") is not None
        ]
        if window_returns:
            stats = _calculate_stats(window_returns)

            # High vs low score for this window
            high_rets = [
                t["forward_returns"].get(f"{window}d", {}).get("return_pct")
                for t in scored_trades
                if t["score"] >= 50
                and t["forward_returns"].get(f"{window}d", {}).get("return_pct") is not None
            ]
            low_rets = [
                t["forward_returns"].get(f"{window}d", {}).get("return_pct")
                for t in scored_trades
                if t["score"] < 50
                and t["forward_returns"].get(f"{window}d", {}).get("return_pct") is not None
            ]

            stats["high_score"] = _calculate_stats(high_rets)
            stats["low_score"] = _calculate_stats(low_rets)
            stats["edge_test"] = _t_test_edge(high_rets, low_rets)

            multi_window_analysis[f"{window}d"] = stats

    # Forward vs exit comparison
    forward_vs_exit = None
    if return_mode == "both":
        trades_with_both = [
            t for t in scored_trades
            if t["forward_return_pct"] is not None
            and t["exit"] is not None
            and t["exit"]["exit_return_pct"] is not None
        ]
        if trades_with_both:
            fwd_returns = [t["forward_return_pct"] for t in trades_with_both]
            exit_returns = [t["exit"]["exit_return_pct"] for t in trades_with_both]
            holding_days_list = [t["exit"]["holding_days"] for t in trades_with_both]

            exit_beat = sum(
                1 for t in trades_with_both
                if t["exit"]["exit_return_pct"] > t["forward_return_pct"]
            )

            forward_vs_exit = {
                "trades_with_both": len(trades_with_both),
                "forward_returns": _calculate_stats(fwd_returns),
                "exit_returns": _calculate_stats(exit_returns),
                "avg_holding_days": round(sum(holding_days_list) / len(holding_days_list), 1),
                "exit_beat_forward_count": exit_beat,
                "exit_beat_forward_pct": round(exit_beat / len(trades_with_both) * 100, 1),
                "politicians_time_exits_well": exit_beat > len(trades_with_both) / 2,
                "timing_test": _t_test_edge(exit_returns, fwd_returns),
            }

    # Party analysis
    party_returns = defaultdict(list)
    for t in scored_trades:
        ret = _get_return(t, return_mode)
        if ret is not None and t.get("party"):
            party_returns[t["party"]].append(ret)

    party_analysis = {
        party: _calculate_stats(returns)
        for party, returns in party_returns.items()
    }

    return {
        "backtest_params": {
            "lookback_days": days,
            "forward_days": forward_days,
            "max_trades": max_trades,
            "return_mode": return_mode,
            "scoring_version": "v2",
        },
        "summary": {
            "total_trades_checked": len(scored_trades),
            "trades_with_returns": len(scored_with_returns),
            "exits_found": exits_found,
            "still_holding": len([t for t in scored_trades if t["still_holding"]]),
            "prices_looked_up": price_lookup_count,
        },
        "score_bucket_analysis": bucket_analysis,
        "score_validation": score_validation,
        "factor_attribution": factor_attribution,
        "multi_window_returns": multi_window_analysis,
        "committee_analysis": committee_analysis,
        "cap_size_analysis": cap_analysis,
        "party_analysis": party_analysis,
        "forward_vs_exit": forward_vs_exit,
        "top_scored_trades": top_scored,
    }


# ─── POLITICIAN LEADERBOARD ───


async def get_politician_leaderboard(
    year: int | None = None,
    min_trades: int = 3,
    chamber: str | None = None,
) -> dict:
    """
    Build a politician trading leaderboard by year.
    Shows best and worst traders with stats.
    """
    async with async_session() as session:
        # Determine which years we have data for
        years_result = await session.execute(
            select(func.distinct(extract("year", Trade.tx_date)))
            .where(Trade.tx_date.isnot(None))
            .order_by(extract("year", Trade.tx_date).desc())
        )
        available_years = [int(r[0]) for r in years_result.all() if r[0]]

        target_years = [year] if year else available_years

        all_leaderboards = {}

        for yr in target_years:
            year_start = datetime(yr, 1, 1)
            year_end = datetime(yr, 12, 31, 23, 59, 59)

            stmt = select(
                Trade.politician,
                Trade.party,
                Trade.state,
                Trade.chamber,
                func.count().label("total_trades"),
                func.sum(case((Trade.tx_type == "purchase", 1), else_=0)).label("buys"),
                func.sum(case(
                    (Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]), 1),
                    else_=0,
                )).label("sells"),
                func.avg(
                    case(
                        (
                            (Trade.tx_type == "purchase") & (Trade.return_since_disclosure.isnot(None)),
                            Trade.return_since_disclosure,
                        ),
                        else_=None,
                    )
                ).label("avg_return"),
                func.sum(
                    case(
                        (
                            (Trade.tx_type == "purchase") & (Trade.return_since_disclosure > 0),
                            1,
                        ),
                        else_=0,
                    )
                ).label("wins"),
                func.sum(
                    case(
                        (
                            (Trade.tx_type == "purchase") & (Trade.return_since_disclosure.isnot(None)),
                            1,
                        ),
                        else_=0,
                    )
                ).label("trades_with_returns"),
                func.max(Trade.amount_high).label("biggest_trade"),
                func.min(Trade.return_since_disclosure).label("worst_trade_return"),
                func.max(Trade.return_since_disclosure).label("best_trade_return"),
            ).where(
                Trade.tx_date >= year_start,
                Trade.tx_date <= year_end,
            ).group_by(
                Trade.politician, Trade.party, Trade.state, Trade.chamber,
            ).having(
                func.count() >= min_trades,
            )

            if chamber:
                stmt = stmt.where(Trade.chamber == chamber.lower())

            result = await session.execute(stmt)
            rows = result.all()

            leaderboard = []
            for row in rows:
                win_rate = (
                    round(row.wins / row.trades_with_returns * 100, 1)
                    if row.trades_with_returns and row.trades_with_returns > 0
                    else None
                )

                leaderboard.append({
                    "politician": row.politician,
                    "party": row.party,
                    "state": row.state,
                    "chamber": row.chamber,
                    "total_trades": row.total_trades,
                    "buys": row.buys,
                    "sells": row.sells,
                    "avg_return_pct": round(row.avg_return, 2) if row.avg_return else None,
                    "win_rate_pct": win_rate,
                    "trades_with_returns": row.trades_with_returns,
                    "biggest_trade_amount": row.biggest_trade,
                    "best_trade_return_pct": round(row.best_trade_return, 2) if row.best_trade_return else None,
                    "worst_trade_return_pct": round(row.worst_trade_return, 2) if row.worst_trade_return else None,
                })

            leaderboard.sort(
                key=lambda x: x["avg_return_pct"] if x["avg_return_pct"] is not None else -999,
                reverse=True,
            )

            for i, entry in enumerate(leaderboard):
                entry["rank"] = i + 1

            all_leaderboards[str(yr)] = {
                "year": yr,
                "politicians_ranked": len(leaderboard),
                "top_10": leaderboard[:10],
                "bottom_10": leaderboard[-10:] if len(leaderboard) > 10 else [],
                "full_leaderboard": leaderboard,
            }

        # Year-over-year consistency
        if len(target_years) >= 2:
            pol_years: dict[str, list] = defaultdict(list)
            for yr_str, lb_data in all_leaderboards.items():
                for entry in lb_data["full_leaderboard"]:
                    pol_years[entry["politician"]].append({
                        "year": int(yr_str),
                        "rank": entry["rank"],
                        "avg_return": entry["avg_return_pct"],
                        "trades": entry["total_trades"],
                    })

            consistent_winners = []
            for pol, years_data in pol_years.items():
                if len(years_data) >= 2:
                    avg_rank = sum(y["rank"] for y in years_data) / len(years_data)
                    valid_returns = [y["avg_return"] for y in years_data if y["avg_return"] is not None]
                    avg_return_all = sum(valid_returns) / len(valid_returns) if valid_returns else 0
                    consistent_winners.append({
                        "politician": pol,
                        "years_active": len(years_data),
                        "avg_rank": round(avg_rank, 1),
                        "avg_return_all_years": round(avg_return_all, 2),
                        "yearly_data": years_data,
                    })

            consistent_winners.sort(key=lambda x: x["avg_return_all_years"], reverse=True)
        else:
            consistent_winners = []

        # Party comparison
        party_stats = {}
        for yr_str, lb_data in all_leaderboards.items():
            for entry in lb_data["full_leaderboard"]:
                party = entry["party"] or "Unknown"
                if party not in party_stats:
                    party_stats[party] = {"returns": [], "trades": 0}
                if entry["avg_return_pct"] is not None:
                    party_stats[party]["returns"].append(entry["avg_return_pct"])
                party_stats[party]["trades"] += entry["total_trades"]

        party_comparison = {
            party: {
                "avg_return_pct": round(sum(data["returns"]) / len(data["returns"]), 2) if data["returns"] else None,
                "total_politicians": len(data["returns"]),
                "total_trades": data["trades"],
            }
            for party, data in party_stats.items()
        }

        return {
            "available_years": available_years,
            "leaderboards": all_leaderboards,
            "consistent_winners": consistent_winners[:10],
            "party_comparison": party_comparison,
        }


async def get_most_profitable_trades(
    days: int = 365,
    limit: int = 50,
) -> list[dict]:
    """Get the most profitable individual trades."""
    since = datetime.utcnow() - timedelta(days=days)

    async with async_session() as session:
        stmt = (
            select(Trade)
            .where(Trade.tx_date >= since)
            .where(Trade.tx_type == "purchase")
            .where(Trade.return_since_disclosure.isnot(None))
            .order_by(Trade.return_since_disclosure.desc())
            .limit(limit)
        )
        result = await session.execute(stmt)
        trades = result.scalars().all()

        return [
            {
                "rank": i + 1,
                "politician": t.politician,
                "party": t.party,
                "state": t.state,
                "chamber": t.chamber,
                "ticker": t.ticker,
                "asset": t.asset_description,
                "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                "disclosure_date": t.disclosure_date.isoformat() if t.disclosure_date else None,
                "amount_low": t.amount_low,
                "amount_high": t.amount_high,
                "price_at_disclosure": t.price_at_disclosure,
                "price_current": t.price_current,
                "return_pct": t.return_since_disclosure,
                "disclosure_delay_days": (
                    (t.disclosure_date - t.tx_date).days
                    if t.disclosure_date and t.tx_date
                    else None
                ),
            }
            for i, t in enumerate(trades)
        ]
