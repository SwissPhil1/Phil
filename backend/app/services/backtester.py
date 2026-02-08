"""
Conviction score backtester and politician leaderboard.

Backtests the scoring system against actual trade returns to validate
whether higher conviction scores actually predict better stock performance.
Also builds year-over-year politician trading leaderboards.
"""

import logging
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
    TICKER_SECTORS,
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


# ─── CONVICTION SCORE BACKTESTER ───


async def backtest_conviction_scores(
    days: int = 365,
    forward_days: int = 30,
    max_trades: int = 200,
) -> dict:
    """
    Backtest the conviction scoring system against real trade data.

    For each congressional purchase in the last N days:
    1. Score it with the conviction engine
    2. Look up the stock price at trade date and forward_days later
    3. Calculate actual return
    4. Group by score bucket and compare average returns

    This answers: "Do higher-scored trades actually perform better?"
    """
    since = datetime.utcnow() - timedelta(days=days)
    # Need trades old enough that we can measure forward returns
    cutoff = datetime.utcnow() - timedelta(days=forward_days)

    async with async_session() as session:
        # Get purchase trades with tickers
        stmt = (
            select(Trade)
            .where(Trade.tx_type == "purchase")
            .where(Trade.ticker.isnot(None))
            .where(Trade.tx_date >= since)
            .where(Trade.tx_date <= cutoff)  # Must be old enough to measure
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

        # Get committee data for all politicians in these trades
        politician_names = list(set(t.politician for t in trades))
        committee_map: dict[str, list[str]] = {}
        for name in politician_names:
            comm_result = await session.execute(
                select(PoliticianCommittee.committee_name)
                .where(PoliticianCommittee.politician_name.ilike(f"%{name}%"))
            )
            committee_map[name] = [r[0] for r in comm_result.all()]

        # Get cluster data: which tickers have multiple politicians trading
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

    # Now score each trade and look up forward returns
    scored_trades = []
    price_lookup_count = 0

    for trade in trades:
        ticker = trade.ticker
        if not ticker or ticker in ("--", "N/A", ""):
            continue

        # Score the trade
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

        # Calculate score
        score = 0
        factors = []

        # Amount
        amount = trade_dict.get("amount_low", 0) or 0
        if amount >= 1000001:
            score += 25
            factors.append("Large position ($1M+)")
        elif amount >= 250001:
            score += 15
            factors.append("Significant position ($250K+)")
        elif amount >= 50001:
            score += 10
            factors.append("Medium position ($50K+)")
        else:
            score += 5
            factors.append("Small position")

        # Committee overlap
        if committees:
            overlap = check_committee_overlap(committees, ticker)
            if overlap:
                if overlap["flag"] == "HIGH":
                    score += 30
                    factors.append(f"COMMITTEE OVERLAP: {overlap['committee']}")
                else:
                    score += 15
                    factors.append(f"Broad committee overlap")

        # Disclosure speed
        delay = trade_dict.get("disclosure_delay_days")
        if delay is not None:
            if delay <= 7:
                score += 10
                factors.append("Fast disclosure")
            elif delay <= 14:
                score += 5
                factors.append("Timely disclosure")

        # Cluster
        if cluster_count >= 5:
            score += 20
            factors.append(f"Strong cluster ({cluster_count} politicians)")
        elif cluster_count >= 3:
            score += 15
            factors.append(f"Cluster ({cluster_count} politicians)")

        # Cross-source
        if insider_buying_this:
            score += 15
            factors.append("Insiders also buying")
        if fund_holds_this:
            score += 10
            factors.append("Hedge fund holds")

        score = min(score, 100)

        # Get forward return
        if trade.tx_date:
            price_at_trade = _get_price(ticker, trade.tx_date)
            forward_date = trade.tx_date + timedelta(days=forward_days)
            price_forward = _get_price(ticker, forward_date)
            price_lookup_count += 1
        else:
            price_at_trade = None
            price_forward = None

        if price_at_trade and price_forward and price_at_trade > 0:
            forward_return = ((price_forward - price_at_trade) / price_at_trade) * 100
        else:
            forward_return = None

        scored_trades.append({
            "politician": trade.politician,
            "party": trade.party,
            "ticker": ticker,
            "tx_date": trade.tx_date.isoformat() if trade.tx_date else None,
            "amount_low": trade.amount_low,
            "score": score,
            "factors": factors,
            "committees": committees,
            "cluster_count": cluster_count,
            "price_at_trade": round(price_at_trade, 2) if price_at_trade else None,
            "price_forward": round(price_forward, 2) if price_forward else None,
            "forward_return_pct": round(forward_return, 2) if forward_return is not None else None,
        })

    # Analyze by score bucket
    buckets = {
        "0-19 (VERY_LOW)": [],
        "20-39 (LOW)": [],
        "40-59 (MEDIUM)": [],
        "60-79 (HIGH)": [],
        "80-100 (VERY_HIGH)": [],
    }

    for t in scored_trades:
        ret = t["forward_return_pct"]
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

    bucket_analysis = {}
    for bucket_name, returns in buckets.items():
        if returns:
            avg = sum(returns) / len(returns)
            wins = sum(1 for r in returns if r > 0)
            bucket_analysis[bucket_name] = {
                "trade_count": len(returns),
                "avg_return_pct": round(avg, 2),
                "median_return_pct": round(sorted(returns)[len(returns) // 2], 2),
                "win_rate_pct": round(wins / len(returns) * 100, 1),
                "best_trade_pct": round(max(returns), 2),
                "worst_trade_pct": round(min(returns), 2),
            }
        else:
            bucket_analysis[bucket_name] = {
                "trade_count": 0,
                "avg_return_pct": None,
            }

    # Check if higher scores = better returns
    scored_with_returns = [t for t in scored_trades if t["forward_return_pct"] is not None]
    if len(scored_with_returns) >= 2:
        high_score = [t for t in scored_with_returns if t["score"] >= 50]
        low_score = [t for t in scored_with_returns if t["score"] < 50]

        high_avg = sum(t["forward_return_pct"] for t in high_score) / len(high_score) if high_score else 0
        low_avg = sum(t["forward_return_pct"] for t in low_score) / len(low_score) if low_score else 0

        score_validation = {
            "high_score_avg_return": round(high_avg, 2),
            "low_score_avg_return": round(low_avg, 2),
            "high_score_count": len(high_score),
            "low_score_count": len(low_score),
            "score_predicts_returns": high_avg > low_avg,
            "edge_pct": round(high_avg - low_avg, 2),
        }
    else:
        score_validation = {"error": "Not enough trades with return data"}

    # Top scored trades (for display)
    top_scored = sorted(scored_trades, key=lambda x: x["score"], reverse=True)[:20]

    # Committee overlap trades specifically
    committee_trades = [t for t in scored_trades if any("COMMITTEE" in f for f in t["factors"])]
    committee_returns = [t["forward_return_pct"] for t in committee_trades if t["forward_return_pct"] is not None]
    non_committee_trades = [t for t in scored_trades if not any("COMMITTEE" in f for f in t["factors"])]
    non_committee_returns = [t["forward_return_pct"] for t in non_committee_trades if t["forward_return_pct"] is not None]

    committee_analysis = {
        "committee_overlap_trades": len(committee_trades),
        "committee_avg_return": round(sum(committee_returns) / len(committee_returns), 2) if committee_returns else None,
        "non_committee_trades": len(non_committee_trades),
        "non_committee_avg_return": round(sum(non_committee_returns) / len(non_committee_returns), 2) if non_committee_returns else None,
        "committee_edge": (
            round(
                (sum(committee_returns) / len(committee_returns)) - (sum(non_committee_returns) / len(non_committee_returns)),
                2,
            )
            if committee_returns and non_committee_returns
            else None
        ),
    }

    # Small cap vs large cap analysis (your hypothesis)
    # Check if single committee member buying small cap > cluster buying NVDA
    small_cap_tickers = {t for t in TICKER_SECTORS if TICKER_SECTORS[t] not in ("tech", "finance", "pharma")}
    large_cap_tickers = {"NVDA", "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "TSLA"}

    small_cap_committee = [
        t for t in scored_trades
        if t["ticker"] in small_cap_tickers
        and any("COMMITTEE" in f for f in t["factors"])
        and t["forward_return_pct"] is not None
    ]
    large_cap_cluster = [
        t for t in scored_trades
        if t["ticker"] in large_cap_tickers
        and t["cluster_count"] >= 3
        and t["forward_return_pct"] is not None
    ]

    your_hypothesis = {
        "question": "Is a committee member buying a small-cap in their sector stronger than 10 politicians buying NVDA?",
        "small_cap_committee_trades": len(small_cap_committee),
        "small_cap_committee_avg_return": (
            round(sum(t["forward_return_pct"] for t in small_cap_committee) / len(small_cap_committee), 2)
            if small_cap_committee else None
        ),
        "large_cap_cluster_trades": len(large_cap_cluster),
        "large_cap_cluster_avg_return": (
            round(sum(t["forward_return_pct"] for t in large_cap_cluster) / len(large_cap_cluster), 2)
            if large_cap_cluster else None
        ),
        "small_cap_committee_examples": [
            {"politician": t["politician"], "ticker": t["ticker"], "return": t["forward_return_pct"]}
            for t in small_cap_committee[:5]
        ],
    }

    return {
        "backtest_params": {
            "lookback_days": days,
            "forward_days": forward_days,
            "max_trades": max_trades,
        },
        "total_trades_checked": len(scored_trades),
        "trades_with_returns": len(scored_with_returns),
        "prices_looked_up": price_lookup_count,
        "score_bucket_analysis": bucket_analysis,
        "score_validation": score_validation,
        "committee_analysis": committee_analysis,
        "small_vs_large_cap": your_hypothesis,
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

            # Get per-politician stats for this year
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

            # Sort by avg_return descending (best traders first)
            leaderboard.sort(
                key=lambda x: x["avg_return_pct"] if x["avg_return_pct"] is not None else -999,
                reverse=True,
            )

            # Add rank
            for i, entry in enumerate(leaderboard):
                entry["rank"] = i + 1

            all_leaderboards[str(yr)] = {
                "year": yr,
                "politicians_ranked": len(leaderboard),
                "top_10": leaderboard[:10],
                "bottom_10": leaderboard[-10:] if len(leaderboard) > 10 else [],
                "full_leaderboard": leaderboard,
            }

        # Year-over-year consistency check
        if len(target_years) >= 2:
            # Find politicians who appear in multiple years
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
                    avg_return_all_years = sum(
                        y["avg_return"] for y in years_data if y["avg_return"] is not None
                    ) / max(sum(1 for y in years_data if y["avg_return"] is not None), 1)
                    consistent_winners.append({
                        "politician": pol,
                        "years_active": len(years_data),
                        "avg_rank": round(avg_rank, 1),
                        "avg_return_all_years": round(avg_return_all_years, 2),
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
