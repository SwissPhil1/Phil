"""Score validation service — measures whether signals predict excess returns.

This is how we know if the score WORKS. For each signal, we compute:
  - Spearman correlation with 90-day excess return
  - Mean excess return for high-score vs low-score trades
  - Statistical significance (can we reject "this is random"?)

The output tells you exactly which signals to keep, drop, or re-weight.

Usage:
  python -m app.services.validation        # Run from CLI
  Or call via admin API endpoint            # Run from web
"""

import logging
import math
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Politician,
    PoliticianCommittee,
    Trade,
    async_session,
)
from app.services.scoring import (
    score_cluster,
    score_committee_overlap,
    score_delay_pattern,
    score_disclosure_delay,
    score_politician_alpha,
    score_trade_size,
)

logger = logging.getLogger(__name__)


def _spearman_rank_correlation(x: list[float], y: list[float]) -> tuple[float, int]:
    """Compute Spearman rank correlation between two lists.

    Returns (correlation, n) where correlation is in [-1, 1].
    """
    n = len(x)
    if n < 10:
        return 0.0, n

    # Rank the values
    def _rank(values):
        indexed = sorted(enumerate(values), key=lambda t: t[1])
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j < n - 1 and indexed[j + 1][1] == indexed[j][1]:
                j += 1
            avg_rank = (i + j) / 2 + 1
            for k in range(i, j + 1):
                ranks[indexed[k][0]] = avg_rank
            i = j + 1
        return ranks

    rx = _rank(x)
    ry = _rank(y)

    # Compute correlation
    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n

    num = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    den_x = math.sqrt(sum((rx[i] - mean_rx) ** 2 for i in range(n)))
    den_y = math.sqrt(sum((ry[i] - mean_ry) ** 2 for i in range(n)))

    if den_x == 0 or den_y == 0:
        return 0.0, n

    return num / (den_x * den_y), n


def _t_statistic(r: float, n: int) -> float:
    """Compute t-statistic for a correlation coefficient."""
    if n < 3 or abs(r) >= 1.0:
        return 0.0
    return r * math.sqrt((n - 2) / (1 - r * r))


def _is_significant(r: float, n: int, alpha: float = 0.05) -> bool:
    """Approximate significance test for Spearman correlation.

    Uses t-distribution approximation. For n > 30, t > 1.96 ≈ p < 0.05.
    """
    t = abs(_t_statistic(r, n))
    # Approximate critical values
    if n > 100:
        return t > 1.96 if alpha == 0.05 else t > 2.576
    elif n > 30:
        return t > 2.04 if alpha == 0.05 else t > 2.75
    else:
        return t > 2.2 if alpha == 0.05 else t > 3.0


async def validate_signals(session: AsyncSession) -> dict:
    """Run full signal validation against historical trade outcomes.

    Only uses trades with excess_return_90d populated (i.e., old enough
    to have 90-day forward returns + SPY benchmark).

    Returns a report with per-signal correlation, significance, and
    recommended weight adjustments.
    """
    # Load trades with 90-day forward excess returns
    stmt = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
            Trade.excess_return_90d.isnot(None),
        )
    )
    result = await session.execute(stmt)
    trades = result.scalars().all()

    if len(trades) < 50:
        return {
            "error": "Not enough trades with 90-day excess returns for validation",
            "trades_available": len(trades),
            "minimum_needed": 50,
        }

    logger.info(f"Validating signals against {len(trades)} trades with 90d excess returns")

    # Load context data
    committee_result = await session.execute(
        select(PoliticianCommittee.politician_name, PoliticianCommittee.committee_name)
    )
    committees_by_pol: dict[str, list[str]] = defaultdict(list)
    for row in committee_result:
        committees_by_pol[row.politician_name].append(row.committee_name)

    pol_result = await session.execute(
        select(Politician.name, Politician.win_rate, Politician.avg_return)
    )
    pol_stats: dict[str, dict] = {}
    for row in pol_result:
        pol_stats[row.name] = {"win_rate": row.win_rate, "avg_return": row.avg_return}

    delay_result = await session.execute(
        select(
            Trade.politician,
            func.avg(Trade.disclosure_delay_days).label("avg_delay"),
        )
        .where(Trade.disclosure_delay_days.isnot(None))
        .group_by(Trade.politician)
    )
    avg_delays: dict[str, float] = {}
    for row in delay_result:
        avg_delays[row.politician] = float(row.avg_delay) if row.avg_delay else None

    # Compute each signal for every trade
    signal_values: dict[str, list[float]] = {
        "disclosure_delay": [],
        "trade_size": [],
        "committee_overlap": [],
        "cluster": [],
        "politician_alpha": [],
        "delay_pattern": [],
        "composite": [],
    }
    excess_returns: list[float] = []

    for trade in trades:
        committees = committees_by_pol.get(trade.politician, [])
        stats = pol_stats.get(trade.politician)
        avg_delay = avg_delays.get(trade.politician)

        signal_values["disclosure_delay"].append(score_disclosure_delay(trade))
        signal_values["trade_size"].append(score_trade_size(trade))
        signal_values["committee_overlap"].append(
            score_committee_overlap(trade, committees)
        )
        signal_values["cluster"].append(score_cluster(trade))
        signal_values["politician_alpha"].append(
            score_politician_alpha(
                stats.get("win_rate") if stats else None,
                stats.get("avg_return") if stats else None,
            )
        )
        signal_values["delay_pattern"].append(score_delay_pattern(avg_delay))

        # Composite uses current suspicion_score if available
        signal_values["composite"].append(trade.suspicion_score or 0.0)

        excess_returns.append(trade.excess_return_90d)

    # Analyze each signal
    report = {
        "total_trades": len(trades),
        "avg_excess_return_90d": round(sum(excess_returns) / len(excess_returns), 2),
        "signals": {},
    }

    for signal_name, values in signal_values.items():
        corr, n = _spearman_rank_correlation(values, excess_returns)
        significant = _is_significant(corr, n)

        # Split into high/low halves for mean comparison
        paired = sorted(zip(values, excess_returns), key=lambda x: x[0])
        mid = len(paired) // 2
        low_half_returns = [p[1] for p in paired[:mid]]
        high_half_returns = [p[1] for p in paired[mid:]]

        mean_low = sum(low_half_returns) / len(low_half_returns) if low_half_returns else 0
        mean_high = sum(high_half_returns) / len(high_half_returns) if high_half_returns else 0

        # Non-zero count (how many trades have this signal active)
        nonzero = sum(1 for v in values if v > 0)

        report["signals"][signal_name] = {
            "spearman_correlation": round(corr, 4),
            "n_trades": n,
            "significant_at_5pct": significant,
            "t_statistic": round(_t_statistic(corr, n), 2),
            "mean_excess_return_low_score": round(mean_low, 2),
            "mean_excess_return_high_score": round(mean_high, 2),
            "spread": round(mean_high - mean_low, 2),
            "nonzero_count": nonzero,
            "nonzero_pct": round(nonzero / len(trades) * 100, 1),
            "recommendation": _recommendation(corr, significant, nonzero / len(trades)),
        }

    # Optimal weights based on positive correlations
    positive_signals = {
        k: v for k, v in report["signals"].items()
        if k != "composite" and v["spearman_correlation"] > 0 and v["significant_at_5pct"]
    }

    if positive_signals:
        total_corr = sum(v["spearman_correlation"] for v in positive_signals.values())
        report["recommended_weights"] = {
            k: round(v["spearman_correlation"] / total_corr * 100, 1)
            for k, v in positive_signals.items()
        }
    else:
        report["recommended_weights"] = "Not enough significant positive signals yet"

    return report


def _recommendation(corr: float, significant: bool, coverage: float) -> str:
    """Generate human-readable recommendation for a signal."""
    if coverage < 0.01:
        return "SKIP — too few trades have this signal active (<1%)"
    if not significant:
        if abs(corr) < 0.02:
            return "SKIP — no correlation with returns"
        return "WEAK — not statistically significant, needs more data"
    if corr > 0.1:
        return "STRONG — significant positive correlation, KEEP with high weight"
    if corr > 0.03:
        return "MODERATE — significant positive correlation, KEEP"
    if corr > 0:
        return "MARGINAL — barely positive, keep with low weight"
    if corr < -0.05:
        return "INVERSE — significant NEGATIVE correlation (high score = WORSE returns)"
    return "NEUTRAL — no useful signal"


async def run_validation() -> dict:
    """Entry point for validation pipeline."""
    async with async_session() as session:
        return await validate_signals(session)


# CLI entry point
if __name__ == "__main__":
    import asyncio
    import json

    async def main():
        logging.basicConfig(level=logging.INFO)
        result = await run_validation()
        print(json.dumps(result, indent=2))

    asyncio.run(main())
