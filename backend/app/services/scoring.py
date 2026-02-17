"""Suspicion scoring engine — rates each congressional trade 0-100.

Each signal is computed independently so we can measure which ones
actually predict excess returns (via the validation script). Signals
that don't correlate with forward returns get dropped or down-weighted.

Architecture:
  - Each signal function returns a float 0-100 (higher = more suspicious)
  - Signals are combined with configurable weights
  - Weights should be tuned based on backtest correlation analysis
  - Score is written to Trade.suspicion_score

Signals:
  1. Disclosure delay — filing close to the 45-day deadline
  2. Trade size — larger trades = more conviction = more suspicious
  3. Committee-sector overlap — trading in sectors your committee oversees
  4. Cluster signal — multiple politicians buying same ticker in same week
  5. Politician track record — consistently beating the market
  6. Disclosure delay pattern — politicians who habitually file late
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Politician,
    PoliticianCommittee,
    Trade,
    async_session,
)

logger = logging.getLogger(__name__)

# ─── Signal weights (initial — tune via validation.py) ───
# These should sum to 100 for intuitive interpretation

DEFAULT_WEIGHTS = {
    "disclosure_delay": 20,
    "trade_size": 15,
    "committee_overlap": 25,
    "cluster": 15,
    "politician_alpha": 15,
    "delay_pattern": 10,
}

# ─── Committee-sector mapping ───
# Maps congressional committee keywords to stock sectors/tickers they oversee

COMMITTEE_SECTOR_MAP = {
    # Armed Services / Defense
    "armed services": {"sectors": ["defense", "aerospace"], "keywords": ["defense", "military", "aerospace"]},
    "defense": {"sectors": ["defense", "aerospace"], "keywords": ["defense", "military", "aerospace"]},
    # Finance / Banking
    "financial services": {"sectors": ["finance", "banking"], "keywords": ["bank", "financial", "insurance", "credit"]},
    "banking": {"sectors": ["finance", "banking"], "keywords": ["bank", "financial", "insurance", "credit"]},
    # Energy
    "energy": {"sectors": ["energy", "oil"], "keywords": ["energy", "oil", "gas", "petroleum", "solar", "wind"]},
    "natural resources": {"sectors": ["energy", "mining"], "keywords": ["energy", "mining", "oil", "gas"]},
    # Technology
    "science": {"sectors": ["technology"], "keywords": ["tech", "software", "semiconductor", "cyber"]},
    "technology": {"sectors": ["technology"], "keywords": ["tech", "software", "semiconductor", "cyber"]},
    "commerce": {"sectors": ["technology", "telecom"], "keywords": ["tech", "telecom", "internet"]},
    # Health
    "health": {"sectors": ["healthcare", "pharma"], "keywords": ["health", "pharma", "biotech", "medical", "drug"]},
    # Agriculture
    "agriculture": {"sectors": ["agriculture"], "keywords": ["agriculture", "farm", "food", "grain"]},
    # Transportation
    "transportation": {"sectors": ["transportation"], "keywords": ["airline", "railroad", "shipping", "transport"]},
    # Intelligence
    "intelligence": {"sectors": ["defense", "technology"], "keywords": ["defense", "cyber", "intelligence", "security"]},
}

# Ticker-to-sector mapping for common tickers
# This is a simplified version — in production you'd use a full sector database
TICKER_SECTORS = {
    # Defense
    "LMT": "defense", "RTX": "defense", "NOC": "defense", "GD": "defense",
    "BA": "aerospace", "LHX": "defense", "HII": "defense",
    # Tech
    "AAPL": "technology", "MSFT": "technology", "GOOGL": "technology",
    "GOOG": "technology", "META": "technology", "AMZN": "technology",
    "NVDA": "technology", "AMD": "technology", "INTC": "technology",
    "CRM": "technology", "ORCL": "technology", "ADBE": "technology",
    "CSCO": "technology", "AVGO": "technology", "QCOM": "technology",
    "TSM": "technology", "ASML": "technology", "MU": "technology",
    # Finance
    "JPM": "finance", "BAC": "finance", "GS": "finance", "MS": "finance",
    "WFC": "finance", "C": "finance", "BLK": "finance", "SCHW": "finance",
    "V": "finance", "MA": "finance", "AXP": "finance",
    # Healthcare / Pharma
    "JNJ": "healthcare", "PFE": "pharma", "UNH": "healthcare",
    "ABBV": "pharma", "MRK": "pharma", "LLY": "pharma",
    "BMY": "pharma", "AMGN": "pharma", "GILD": "pharma",
    "MRNA": "pharma", "BNTX": "pharma", "REGN": "pharma",
    # Energy
    "XOM": "energy", "CVX": "energy", "COP": "energy", "SLB": "energy",
    "EOG": "energy", "OXY": "energy", "HAL": "energy",
    # Transportation
    "DAL": "transportation", "UAL": "transportation", "AAL": "transportation",
    "LUV": "transportation", "UNP": "transportation", "CSX": "transportation",
    "FDX": "transportation", "UPS": "transportation",
}


# ─── Individual signal scorers ───


def score_disclosure_delay(trade: Trade) -> float:
    """Score based on disclosure delay. Filing near the 45-day limit = suspicious.

    0 = filed immediately (0 days)
    100 = filed at 45+ days (maximum allowed delay)
    """
    delay = trade.disclosure_delay_days
    if delay is None:
        return 0.0

    if delay <= 0:
        return 0.0
    if delay >= 45:
        return 100.0

    # Linear scale with acceleration near the deadline
    # Days 0-15: low suspicion (0-20)
    # Days 15-30: medium (20-50)
    # Days 30-45: high (50-100)
    if delay <= 15:
        return (delay / 15) * 20
    elif delay <= 30:
        return 20 + ((delay - 15) / 15) * 30
    else:
        return 50 + ((delay - 30) / 15) * 50


def score_trade_size(trade: Trade) -> float:
    """Score based on STOCK Act amount range. Larger = more conviction = more suspicious.

    Uses midpoint of the disclosed range.
    """
    if not trade.amount_low or not trade.amount_high:
        return 0.0

    mid = (trade.amount_low + trade.amount_high) / 2

    # Tiers based on STOCK Act ranges
    if mid <= 15_000:
        return 10.0
    elif mid <= 50_000:
        return 20.0
    elif mid <= 100_000:
        return 35.0
    elif mid <= 250_000:
        return 50.0
    elif mid <= 500_000:
        return 65.0
    elif mid <= 1_000_000:
        return 80.0
    elif mid <= 5_000_000:
        return 90.0
    else:
        return 100.0


def score_committee_overlap(
    trade: Trade,
    committees: list[str],
) -> float:
    """Score based on whether the politician trades in a sector their committee oversees.

    This is the strongest academic signal for informed trading.
    """
    if not trade.ticker or not committees:
        return 0.0

    ticker_sector = TICKER_SECTORS.get(trade.ticker)
    asset_desc = (trade.asset_description or "").lower()

    for committee_name in committees:
        committee_lower = committee_name.lower()
        for keyword, mapping in COMMITTEE_SECTOR_MAP.items():
            if keyword in committee_lower:
                # Check ticker sector match
                if ticker_sector and ticker_sector in mapping["sectors"]:
                    return 100.0
                # Check asset description match
                for kw in mapping["keywords"]:
                    if kw in asset_desc:
                        return 80.0

    return 0.0


def score_cluster(trade: Trade) -> float:
    """Score based on cluster flag (3+ politicians same ticker in 7 days)."""
    return 100.0 if trade.cluster_flag else 0.0


def score_politician_alpha(
    win_rate: float | None,
    avg_return: float | None,
) -> float:
    """Score based on politician's historical track record.

    Politicians who consistently beat the market are more likely to be
    trading on information advantage.
    """
    score = 0.0

    if win_rate is not None:
        # Win rate > 60% is suspicious, > 70% is very suspicious
        if win_rate > 70:
            score += 50
        elif win_rate > 60:
            score += 30
        elif win_rate > 55:
            score += 15

    if avg_return is not None:
        # Average return > 10% is suspicious
        if avg_return > 20:
            score += 50
        elif avg_return > 10:
            score += 30
        elif avg_return > 5:
            score += 15

    return min(score, 100.0)


def score_delay_pattern(
    politician_avg_delay: float | None,
) -> float:
    """Score based on whether this politician habitually files late.

    Some politicians consistently file near the deadline — this pattern
    is more suspicious than occasional late filing.
    """
    if politician_avg_delay is None:
        return 0.0

    if politician_avg_delay >= 35:
        return 100.0
    elif politician_avg_delay >= 25:
        return 60.0
    elif politician_avg_delay >= 15:
        return 30.0
    return 0.0


# ─── Composite score ───


def compute_suspicion_score(
    trade: Trade,
    committees: list[str],
    politician_stats: dict | None,
    politician_avg_delay: float | None,
    weights: dict[str, float] | None = None,
) -> float:
    """Compute composite suspicion score (0-100) for a single trade.

    Args:
        trade: The Trade object
        committees: List of committee names for the politician
        politician_stats: Dict with 'win_rate' and 'avg_return' keys
        politician_avg_delay: Average disclosure delay for this politician
        weights: Signal weights (defaults to DEFAULT_WEIGHTS)

    Returns:
        Composite score 0-100
    """
    w = weights or DEFAULT_WEIGHTS
    total_weight = sum(w.values())

    signals = {
        "disclosure_delay": score_disclosure_delay(trade),
        "trade_size": score_trade_size(trade),
        "committee_overlap": score_committee_overlap(trade, committees),
        "cluster": score_cluster(trade),
        "politician_alpha": score_politician_alpha(
            politician_stats.get("win_rate") if politician_stats else None,
            politician_stats.get("avg_return") if politician_stats else None,
        ),
        "delay_pattern": score_delay_pattern(politician_avg_delay),
    }

    # Weighted average
    score = sum(signals[k] * w.get(k, 0) for k in signals) / total_weight
    return round(min(max(score, 0), 100), 1)


# ─── Batch scoring ───


async def score_all_trades(
    session: AsyncSession,
    limit: int | None = None,
    force: bool = False,
) -> int:
    """Score all trades (or re-score if force=True).

    Pre-loads all needed context (committees, politician stats, avg delays)
    then scores each trade in bulk.
    """
    # Load committee assignments
    committee_result = await session.execute(
        select(PoliticianCommittee.politician_name, PoliticianCommittee.committee_name)
    )
    committees_by_pol: dict[str, list[str]] = defaultdict(list)
    for row in committee_result:
        committees_by_pol[row.politician_name].append(row.committee_name)

    # Load politician stats
    pol_result = await session.execute(
        select(Politician.name, Politician.win_rate, Politician.avg_return)
    )
    pol_stats: dict[str, dict] = {}
    for row in pol_result:
        pol_stats[row.name] = {"win_rate": row.win_rate, "avg_return": row.avg_return}

    # Compute average disclosure delay per politician
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

    # Get trades to score
    stmt = select(Trade).where(
        Trade.ticker.isnot(None),
        Trade.tx_type == "purchase",  # Only score purchases (buys)
    )
    if not force:
        stmt = stmt.where(Trade.suspicion_score.is_(None))
    if limit:
        stmt = stmt.limit(limit)

    result = await session.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        logger.info("No trades to score")
        return 0

    logger.info(f"Scoring {len(trades)} trades...")

    count = 0
    for trade in trades:
        committees = committees_by_pol.get(trade.politician, [])
        stats = pol_stats.get(trade.politician)
        avg_delay = avg_delays.get(trade.politician)

        trade.suspicion_score = compute_suspicion_score(
            trade, committees, stats, avg_delay
        )
        count += 1

        if count % 5000 == 0:
            await session.commit()
            logger.info(f"  Scored {count}/{len(trades)} trades...")

    await session.commit()
    logger.info(f"Scored {count} trades")
    return count


async def run_scoring():
    """Entry point for the scoring pipeline."""
    async with async_session() as session:
        return await score_all_trades(session)
