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


def _analyze_signal(
    signal_name: str,
    values: list[float],
    returns: list[float],
) -> dict:
    """Analyze one signal against a return series."""
    corr, n = _spearman_rank_correlation(values, returns)
    significant = _is_significant(corr, n)

    paired = sorted(zip(values, returns), key=lambda x: x[0])
    mid = len(paired) // 2
    low_half_returns = [p[1] for p in paired[:mid]]
    high_half_returns = [p[1] for p in paired[mid:]]

    mean_low = sum(low_half_returns) / len(low_half_returns) if low_half_returns else 0
    mean_high = sum(high_half_returns) / len(high_half_returns) if high_half_returns else 0

    nonzero = sum(1 for v in values if v > 0)
    total = len(values)

    return {
        "spearman_correlation": round(corr, 4),
        "n_trades": n,
        "significant_at_5pct": significant,
        "t_statistic": round(_t_statistic(corr, n), 2),
        "mean_return_low_score": round(mean_low, 2),
        "mean_return_high_score": round(mean_high, 2),
        "spread": round(mean_high - mean_low, 2),
        "nonzero_count": nonzero,
        "nonzero_pct": round(nonzero / total * 100, 1) if total else 0,
        "recommendation": _recommendation(corr, significant, nonzero / total if total else 0),
    }


def _load_signal_values(
    trades: list,
    committees_by_pol: dict,
    pol_stats: dict,
    avg_delays: dict,
) -> dict[str, list[float]]:
    """Compute all signal values for a list of trades."""
    signals: dict[str, list[float]] = {
        "disclosure_delay": [],
        "trade_size": [],
        "committee_overlap": [],
        "cluster": [],
        "politician_alpha": [],
        "delay_pattern": [],
        "composite": [],
    }

    for trade in trades:
        committees = committees_by_pol.get(trade.politician, [])
        stats = pol_stats.get(trade.politician)
        avg_delay = avg_delays.get(trade.politician)

        signals["disclosure_delay"].append(score_disclosure_delay(trade))
        signals["trade_size"].append(score_trade_size(trade))
        signals["committee_overlap"].append(
            score_committee_overlap(trade, committees)
        )
        signals["cluster"].append(score_cluster(trade))
        signals["politician_alpha"].append(
            score_politician_alpha(
                stats.get("win_rate") if stats else None,
                stats.get("avg_return") if stats else None,
            )
        )
        signals["delay_pattern"].append(score_delay_pattern(avg_delay))
        signals["composite"].append(trade.suspicion_score or 0.0)

    return signals


async def _load_context(session: AsyncSession) -> tuple[dict, dict, dict]:
    """Load committee, politician stats, and delay context for signal computation."""
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

    return committees_by_pol, pol_stats, avg_delays


async def validate_signals(session: AsyncSession) -> dict:
    """Run full signal validation against historical trade outcomes.

    Validates against THREE return measures:
    1. excess_return_90d — 90-day forward return minus SPY (fixed window)
    2. realized_return — actual buy→sell round-trip return (what they made)
    3. excess_return_90d for trades WITH realized_return (subset analysis)

    Returns a report with per-signal correlation, significance, and
    recommended weight adjustments.
    """
    # ─── Section 1: Validate against 90-day excess returns ───

    stmt_90d = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
            Trade.excess_return_90d.isnot(None),
        )
    )
    result_90d = await session.execute(stmt_90d)
    trades_90d = result_90d.scalars().all()

    # ─── Section 2: Validate against realized round-trip returns ───

    stmt_realized = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
            Trade.realized_return.isnot(None),
        )
    )
    result_realized = await session.execute(stmt_realized)
    trades_realized = result_realized.scalars().all()

    if len(trades_90d) < 50 and len(trades_realized) < 50:
        return {
            "error": "Not enough trades with return data for validation",
            "trades_with_90d_excess": len(trades_90d),
            "trades_with_realized_return": len(trades_realized),
            "minimum_needed": 50,
        }

    committees_by_pol, pol_stats, avg_delays = await _load_context(session)

    report = {
        "validation_targets": {},
    }

    # ─── Analyze: 90-day excess return ───
    if len(trades_90d) >= 50:
        logger.info(f"Validating signals against {len(trades_90d)} trades with 90d excess returns")

        signals_90d = _load_signal_values(trades_90d, committees_by_pol, pol_stats, avg_delays)
        excess_returns = [t.excess_return_90d for t in trades_90d]

        analysis_90d = {
            "n_trades": len(trades_90d),
            "avg_return": round(sum(excess_returns) / len(excess_returns), 2),
            "description": "90-day forward return minus S&P 500 (fixed window, market-adjusted)",
            "signals": {},
        }

        for signal_name, values in signals_90d.items():
            analysis_90d["signals"][signal_name] = _analyze_signal(
                signal_name, values, excess_returns
            )

        report["validation_targets"]["excess_return_90d"] = analysis_90d

    # ─── Analyze: Realized round-trip return ───
    if len(trades_realized) >= 50:
        logger.info(f"Validating signals against {len(trades_realized)} trades with realized returns")

        signals_realized = _load_signal_values(
            trades_realized, committees_by_pol, pol_stats, avg_delays
        )
        realized_returns = [t.realized_return for t in trades_realized]

        analysis_realized = {
            "n_trades": len(trades_realized),
            "avg_return": round(sum(realized_returns) / len(realized_returns), 2),
            "avg_hold_days": round(
                sum(t.hold_days for t in trades_realized if t.hold_days) / len(trades_realized), 0
            ),
            "win_rate": round(
                sum(1 for r in realized_returns if r > 0) / len(realized_returns) * 100, 1
            ),
            "description": "Actual return from buy price to sell price (round-trip, what they made)",
            "signals": {},
        }

        for signal_name, values in signals_realized.items():
            analysis_realized["signals"][signal_name] = _analyze_signal(
                signal_name, values, realized_returns
            )

        report["validation_targets"]["realized_return"] = analysis_realized

    # ─── Annualized realized return (adjust for hold time) ───
    # Short holds with high returns are more suspicious than long holds
    if len(trades_realized) >= 50:
        annualized_returns = []
        annualized_signals: dict[str, list[float]] = defaultdict(list)
        for i, trade in enumerate(trades_realized):
            if trade.hold_days and trade.hold_days > 0 and trade.realized_return is not None:
                # Annualize: (1 + r/100)^(365/days) - 1, capped at ±500%
                try:
                    annual = ((1 + trade.realized_return / 100) ** (365 / trade.hold_days) - 1) * 100
                    annual = max(min(annual, 500), -100)  # Cap extremes
                except (OverflowError, ZeroDivisionError):
                    continue
                annualized_returns.append(annual)
                for sig_name in signals_realized:
                    annualized_signals[sig_name].append(signals_realized[sig_name][i])

        if len(annualized_returns) >= 50:
            analysis_annual = {
                "n_trades": len(annualized_returns),
                "avg_annualized_return": round(
                    sum(annualized_returns) / len(annualized_returns), 2
                ),
                "description": "Realized return annualized by hold period (rewards quick profits)",
                "signals": {},
            }
            for signal_name, values in annualized_signals.items():
                analysis_annual["signals"][signal_name] = _analyze_signal(
                    signal_name, values, annualized_returns
                )
            report["validation_targets"]["annualized_realized"] = analysis_annual

    # ─── Summary: best signals across all targets ───
    all_signal_corrs: dict[str, list[float]] = defaultdict(list)
    for target_name, target_data in report["validation_targets"].items():
        for sig_name, sig_data in target_data.get("signals", {}).items():
            if sig_name != "composite":
                all_signal_corrs[sig_name].append(sig_data["spearman_correlation"])

    # Rank signals by average correlation across all targets
    signal_rankings = []
    for sig_name, corrs in all_signal_corrs.items():
        avg_corr = sum(corrs) / len(corrs)
        significant_count = sum(
            1 for target in report["validation_targets"].values()
            if target.get("signals", {}).get(sig_name, {}).get("significant_at_5pct", False)
        )
        signal_rankings.append({
            "signal": sig_name,
            "avg_correlation": round(avg_corr, 4),
            "significant_in_n_targets": significant_count,
            "total_targets": len(report["validation_targets"]),
        })

    signal_rankings.sort(key=lambda x: x["avg_correlation"], reverse=True)
    report["signal_rankings"] = signal_rankings

    # Recommended weights from best signals
    positive_ranked = [s for s in signal_rankings if s["avg_correlation"] > 0 and s["significant_in_n_targets"] > 0]
    if positive_ranked:
        total_corr = sum(s["avg_correlation"] for s in positive_ranked)
        report["recommended_weights"] = {
            s["signal"]: round(s["avg_correlation"] / total_corr * 100, 1)
            for s in positive_ranked
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
