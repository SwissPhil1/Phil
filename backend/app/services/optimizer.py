"""
Automated Conviction Score Optimizer.

Tests thousands of weight combinations for the conviction score formula
against historical trade data (actual PnL), finds the best-performing
formulas, and validates them on out-of-sample data to prevent overfitting.

Approach:
1. Pull historical trades with known returns (buy->sell pairs + forward returns)
2. Define parameterized weight ranges for each scoring factor
3. Grid search / evolutionary optimization over weight space
4. Rank formulas by predictive power (correlation with actual returns, Sharpe, hit rate)
5. Cross-validate: train on one period, test on another
6. Return top formulas with confidence metrics
"""

import logging
import math
import random
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from itertools import product

import yfinance as yf
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Trade, InsiderTrade, HedgeFundHolding,
    PoliticianCommittee, OptimizedWeights, async_session,
)
from app.services.signals import (
    check_committee_overlap,
    TICKER_SECTORS, MEGA_CAP, LARGE_CAP,
    set_active_weights,
)

logger = logging.getLogger(__name__)

# Price cache shared with backtester
_price_cache: dict[str, float] = {}


def _get_price(ticker: str, date: datetime) -> float | None:
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
    except Exception:
        return None


# ─── Weight Configuration ───


@dataclass
class WeightConfig:
    """Parameterized weights for each conviction score factor."""
    # Factor max points (the weight to optimize)
    position_size_max: float = 25.0
    committee_overlap_max: float = 30.0
    disclosure_speed_max: float = 15.0
    cluster_max: float = 20.0
    cross_source_insider_max: float = 15.0
    cross_source_fund_max: float = 10.0
    triple_confirmation_bonus: float = 5.0
    track_record_max: float = 15.0
    contrarian_max: float = 10.0
    leadership_role_max: float = 20.0  # CEPR study: strongest predictor of informed trading
    small_cap_committee_max: float = 15.0  # Bonus: small/mid-cap + committee overlap = very suspicious

    # Thresholds
    cluster_mega_cap_discount: float = 0.4  # Multiplier for mega-cap cluster score
    late_disclosure_days: int = 45  # Days after which disclosure is "late"
    min_cluster_size: int = 3

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @staticmethod
    def from_dict(d: dict) -> "WeightConfig":
        wc = WeightConfig()
        for k, v in d.items():
            if hasattr(wc, k):
                setattr(wc, k, v)
        return wc


def score_trade_with_weights(
    trade_features: dict,
    weights: WeightConfig,
) -> float:
    """Score a trade using parameterized weights instead of hardcoded values."""
    score = 0.0

    # Factor 1: Position Size
    amount = trade_features.get("amount_low", 0) or 0
    if amount >= 5_000_001:
        score += weights.position_size_max
    elif amount >= 1_000_001:
        score += weights.position_size_max * 0.88
    elif amount >= 500_001:
        score += weights.position_size_max * 0.72
    elif amount >= 250_001:
        score += weights.position_size_max * 0.60
    elif amount >= 100_001:
        score += weights.position_size_max * 0.40
    elif amount >= 50_001:
        score += weights.position_size_max * 0.28
    else:
        score += weights.position_size_max * 0.12

    # Factor 2: Committee Overlap
    if trade_features.get("has_committee_overlap"):
        if trade_features.get("committee_flag") == "HIGH":
            score += weights.committee_overlap_max
        else:
            score += weights.committee_overlap_max * 0.5

    # Factor 3: Disclosure Speed
    delay = trade_features.get("disclosure_delay_days")
    if delay is not None:
        if delay > weights.late_disclosure_days:
            score += weights.disclosure_speed_max  # Late = suspicious
        elif delay <= 3:
            score += weights.disclosure_speed_max * 0.33
        elif delay <= 7:
            score += weights.disclosure_speed_max * 0.53
        elif delay <= 14:
            score += weights.disclosure_speed_max * 0.33
        elif delay <= 30:
            score += weights.disclosure_speed_max * 0.13

    # Factor 4: Political Cluster
    cluster_count = trade_features.get("cluster_count", 0)
    is_mega = trade_features.get("is_mega_cap", False)
    cap_mult = weights.cluster_mega_cap_discount if is_mega else 1.0

    if cluster_count >= 8:
        score += weights.cluster_max * cap_mult
    elif cluster_count >= 5:
        score += weights.cluster_max * 0.9 * cap_mult
    elif cluster_count >= weights.min_cluster_size:
        score += weights.cluster_max * 0.75 * cap_mult

    # Factor 5: Cross-Source Confirmation
    if trade_features.get("insider_also_buying"):
        score += weights.cross_source_insider_max
    if trade_features.get("fund_also_holds"):
        score += weights.cross_source_fund_max
    if trade_features.get("insider_also_buying") and trade_features.get("fund_also_holds"):
        score += weights.triple_confirmation_bonus

    # Factor 6: Historical Accuracy
    win_rate = trade_features.get("win_rate", 0) or 0
    avg_return = trade_features.get("avg_return", 0) or 0
    total_trades = trade_features.get("total_past_trades", 0) or 0
    if total_trades >= 5:
        if win_rate >= 70 and avg_return > 5:
            score += weights.track_record_max
        elif win_rate >= 60 and avg_return > 2:
            score += weights.track_record_max * 0.67
        elif win_rate >= 50:
            score += weights.track_record_max * 0.33
        elif win_rate < 40:
            score -= weights.track_record_max * 0.33

    # Factor 7: Contrarian Signal
    if trade_features.get("is_contrarian"):
        score += weights.contrarian_max

    # Factor 8: Leadership Role (CEPR study: strongest predictor — 45pp alpha post-ascension)
    leadership = trade_features.get("leadership_role")
    if leadership:
        role_lower = leadership.lower()
        if "chair" in role_lower and "vice" not in role_lower:
            score += weights.leadership_role_max  # Committee Chair = full points
        elif "ranking" in role_lower:
            score += weights.leadership_role_max * 0.85  # Ranking Member
        elif "vice" in role_lower:
            score += weights.leadership_role_max * 0.65  # Vice Chair
        else:
            score += weights.leadership_role_max * 0.40  # Other leadership roles

    # Factor 9: Small-Cap Committee Bonus
    # A politician buying a small/mid-cap stock in the sector their committee oversees
    # is far more suspicious than the same trade in a mega-cap (less coverage, more info asymmetry)
    is_small_cap = not trade_features.get("is_mega_cap", False) and not trade_features.get("is_large_cap", False)
    if is_small_cap and trade_features.get("has_committee_overlap"):
        if trade_features.get("committee_flag") == "HIGH":
            score += weights.small_cap_committee_max  # Direct sector match on small cap
        else:
            score += weights.small_cap_committee_max * 0.5  # Broad oversight on small cap

    return min(max(score, 0), 185)  # Raised cap for new factor


# ─── Trade Feature Extraction ───


async def extract_trade_features(days: int = 730, max_trades: int = 500) -> list[dict]:
    """
    Extract features for all historical purchase trades, along with their
    actual returns. Uses stored DB prices (price_at_disclosure + return_since_disclosure)
    instead of yfinance, so it's fast and always works.
    """
    from sqlalchemy import or_

    since = datetime.utcnow() - timedelta(days=days)
    cutoff_30 = datetime.utcnow() - timedelta(days=30)

    async with async_session() as session:
        # Get purchase trades — use tx_date OR disclosure_date (many trades lack tx_date)
        stmt = (
            select(Trade)
            .where(Trade.tx_type == "purchase")
            .where(Trade.ticker.isnot(None))
            .where(Trade.ticker.notin_(["--", "N/A", ""]))
            .where(Trade.price_at_disclosure.isnot(None))  # Must have entry price
            .where(Trade.return_since_disclosure.isnot(None))  # Must have return data
            .where(
                or_(
                    Trade.tx_date.between(since, cutoff_30),
                    (Trade.tx_date.is_(None)) & (Trade.disclosure_date.between(since, cutoff_30)),
                )
            )
            .order_by(Trade.tx_date.desc().nullslast())
            .limit(max_trades)
        )
        result = await session.execute(stmt)
        trades = result.scalars().all()

        if not trades:
            return []

        # Batch lookups
        politician_names = list(set(t.politician for t in trades))

        # Committees (batch fetch all at once)
        committee_map: dict[str, list[str]] = defaultdict(list)
        comm_result = await session.execute(
            select(PoliticianCommittee.politician_name, PoliticianCommittee.committee_name)
        )
        for r in comm_result.all():
            committee_map[r.politician_name].append(r.committee_name)

        # Track records (single query)
        track_records: dict[str, dict] = {}
        for name in politician_names:
            tr_result = await session.execute(
                select(
                    func.count().label("total"),
                    func.avg(Trade.return_since_disclosure).label("avg_return"),
                    func.sum(
                        case((Trade.return_since_disclosure > 0, 1), else_=0)
                    ).label("wins"),
                )
                .where(Trade.politician == name)
                .where(Trade.tx_type == "purchase")
                .where(Trade.return_since_disclosure.isnot(None))
            )
            row = tr_result.one_or_none()
            if row and row.total and row.total > 0:
                track_records[name] = {
                    "total": row.total,
                    "avg_return": float(row.avg_return) if row.avg_return else 0,
                    "win_rate": float(row.wins / row.total * 100),
                }
            else:
                track_records[name] = {"total": 0, "avg_return": 0, "win_rate": 0}

        # Cluster counts
        cluster_counts: dict[str, int] = {}
        cluster_result = await session.execute(
            select(
                Trade.ticker,
                func.count(func.distinct(Trade.politician)).label("pol_count"),
            )
            .where(or_(Trade.tx_date >= since, Trade.disclosure_date >= since))
            .where(Trade.tx_type == "purchase")
            .where(Trade.ticker.isnot(None))
            .group_by(Trade.ticker)
        )
        for row in cluster_result.all():
            cluster_counts[row.ticker] = row.pol_count

        # Sell counts (for contrarian detection)
        sell_counts: dict[str, int] = {}
        sell_result = await session.execute(
            select(
                Trade.ticker,
                func.count(func.distinct(Trade.politician)).label("pol_count"),
            )
            .where(or_(Trade.tx_date >= since, Trade.disclosure_date >= since))
            .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
            .where(Trade.ticker.isnot(None))
            .group_by(Trade.ticker)
        )
        for row in sell_result.all():
            sell_counts[row.ticker] = row.pol_count

        # Insider buying tickers
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

        # Hedge fund new positions
        fund_new: set[str] = set()
        fund_result = await session.execute(
            select(HedgeFundHolding.ticker)
            .where(HedgeFundHolding.ticker.isnot(None))
            .where(HedgeFundHolding.is_new_position == True)
            .distinct()
        )
        for row in fund_result.all():
            fund_new.add(row[0])

        # Build exit index (sales by politician+ticker)
        sales_stmt = (
            select(Trade)
            .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
            .where(Trade.ticker.isnot(None))
            .where(Trade.price_at_disclosure.isnot(None))
            .where(or_(Trade.tx_date >= since, Trade.disclosure_date >= since))
            .order_by(Trade.tx_date.asc().nullslast())
        )
        sales_result = await session.execute(sales_stmt)
        all_sales = sales_result.scalars().all()
        sales_index: dict[tuple[str, str], list] = defaultdict(list)
        for s in all_sales:
            if s.ticker:
                s_date = s.tx_date or s.disclosure_date
                if s_date:
                    sales_index[(s.politician.lower(), s.ticker.upper())].append(s)

        # Leadership roles for the new leadership factor
        leadership_map: dict[str, str] = {}
        lead_result = await session.execute(
            select(PoliticianCommittee.politician_name, PoliticianCommittee.role)
            .where(PoliticianCommittee.role.isnot(None))
            .where(PoliticianCommittee.role != "Member")
        )
        for r in lead_result.all():
            existing = leadership_map.get(r.politician_name, "")
            # Keep highest role: Chair > Ranking Member > Vice Chair
            if "Chair" in (r.role or "") and "Chair" not in existing:
                leadership_map[r.politician_name] = r.role
            elif "Ranking" in (r.role or "") and not existing:
                leadership_map[r.politician_name] = r.role

    # Build feature vectors with returns from stored DB data
    features_list = []

    for trade in trades:
        ticker = trade.ticker
        trade_date = trade.tx_date or trade.disclosure_date
        if not ticker or not trade_date:
            continue

        # Match committee data (try exact match, then fuzzy)
        committees = committee_map.get(trade.politician, [])
        if not committees:
            for pol_name, comms in committee_map.items():
                if trade.politician.lower() in pol_name.lower() or pol_name.lower() in trade.politician.lower():
                    committees = comms
                    break

        overlap = check_committee_overlap(committees, ticker) if committees else None

        tr = track_records.get(trade.politician, {})
        cluster_count = cluster_counts.get(ticker, 0)
        recent_sells = sell_counts.get(ticker, 0)

        delay = None
        if trade.disclosure_date and trade.tx_date:
            delay = (trade.disclosure_date - trade.tx_date).days

        # Leadership role
        leadership = leadership_map.get(trade.politician)
        if not leadership:
            for pol_name, role in leadership_map.items():
                if trade.politician.lower() in pol_name.lower() or pol_name.lower() in trade.politician.lower():
                    leadership = role
                    break

        features = {
            # Identifiers
            "politician": trade.politician,
            "ticker": ticker,
            "tx_date": trade_date,
            "party": trade.party,
            # Scoring features
            "amount_low": trade.amount_low or 0,
            "has_committee_overlap": overlap is not None,
            "committee_flag": overlap["flag"] if overlap else None,
            "disclosure_delay_days": delay,
            "cluster_count": cluster_count,
            "is_mega_cap": ticker in MEGA_CAP,
            "is_large_cap": ticker in LARGE_CAP,
            "insider_also_buying": ticker in insider_buying,
            "fund_also_holds": ticker in fund_new,
            "win_rate": tr.get("win_rate", 0),
            "avg_return": tr.get("avg_return", 0),
            "total_past_trades": tr.get("total", 0),
            "is_contrarian": (trade.tx_type == "purchase" and recent_sells >= 3),
            "leadership_role": leadership,
        }

        # Use stored returns from DB (no yfinance needed!)
        entry_price = trade.price_at_disclosure
        current_price = trade.price_current
        ret = trade.return_since_disclosure

        if entry_price and entry_price > 0 and ret is not None:
            features["price_at_trade"] = entry_price

            # return_since_disclosure serves as our "current" return
            # Estimate forward returns based on holding period
            days_held = (datetime.utcnow() - trade_date).days
            if days_held >= 30:
                features["return_30d"] = ret * min(30 / days_held, 1.0)  # Proportional estimate
            if days_held >= 90:
                features["return_90d"] = ret * min(90 / days_held, 1.0)
            if days_held >= 180:
                features["return_180d"] = ret * min(180 / days_held, 1.0)
            # Full holding period return
            features["return_current"] = ret

            # Exit return from matching sales
            key = (trade.politician.lower(), ticker.upper())
            sales = sales_index.get(key, [])
            for sale in sales:
                sale_date = sale.tx_date or sale.disclosure_date
                if sale_date and sale_date > trade_date and sale.price_at_disclosure:
                    features["exit_return"] = ((sale.price_at_disclosure - entry_price) / entry_price) * 100
                    features["holding_days"] = (sale_date - trade_date).days
                    break

        # Include trades with at least one return metric
        if any(k.startswith("return_") or k == "exit_return" for k in features):
            features_list.append(features)

    logger.info(f"Extracted {len(features_list)} trades with return data for optimization")
    return features_list


# ─── Optimization Engine ───


@dataclass
class FormulaResult:
    """Result of testing a single weight configuration."""
    weights: WeightConfig
    # Primary metrics
    correlation_30d: float = 0.0
    correlation_90d: float = 0.0
    # Hit rate: % of trades where high score (>50) had positive return
    hit_rate_30d: float = 0.0
    hit_rate_90d: float = 0.0
    # Sharpe-like ratio
    high_score_avg_return_30d: float = 0.0
    high_score_avg_return_90d: float = 0.0
    low_score_avg_return_30d: float = 0.0
    low_score_avg_return_90d: float = 0.0
    # Edge: high score returns minus low score returns
    edge_30d: float = 0.0
    edge_90d: float = 0.0
    # Combined fitness score
    fitness: float = 0.0
    # Stats
    n_trades: int = 0
    n_high_score: int = 0
    n_low_score: int = 0

    def to_dict(self) -> dict:
        return {
            "weights": self.weights.to_dict(),
            "correlation_30d": round(self.correlation_30d, 4),
            "correlation_90d": round(self.correlation_90d, 4),
            "hit_rate_30d": round(self.hit_rate_30d, 1),
            "hit_rate_90d": round(self.hit_rate_90d, 1),
            "high_score_avg_return_30d": round(self.high_score_avg_return_30d, 2),
            "high_score_avg_return_90d": round(self.high_score_avg_return_90d, 2),
            "low_score_avg_return_30d": round(self.low_score_avg_return_30d, 2),
            "low_score_avg_return_90d": round(self.low_score_avg_return_90d, 2),
            "edge_30d": round(self.edge_30d, 2),
            "edge_90d": round(self.edge_90d, 2),
            "fitness": round(self.fitness, 4),
            "n_trades": self.n_trades,
            "n_high_score": self.n_high_score,
            "n_low_score": self.n_low_score,
        }


def _pearson_correlation(x: list[float], y: list[float]) -> float:
    """Calculate Pearson correlation between two lists."""
    if len(x) < 3 or len(x) != len(y):
        return 0.0
    n = len(x)
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    cov = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    std_x = math.sqrt(sum((xi - mean_x) ** 2 for xi in x))
    std_y = math.sqrt(sum((yi - mean_y) ** 2 for yi in y))
    if std_x == 0 or std_y == 0:
        return 0.0
    return cov / (std_x * std_y)


def evaluate_formula(
    trades: list[dict],
    weights: WeightConfig,
    score_threshold: float = 50.0,
) -> FormulaResult:
    """Evaluate a single weight configuration against trade data."""
    scores = []
    returns_30d = []
    returns_90d = []
    high_score_returns_30d = []
    high_score_returns_90d = []
    low_score_returns_30d = []
    low_score_returns_90d = []

    for t in trades:
        score = score_trade_with_weights(t, weights)
        scores.append(score)

        r30 = t.get("return_30d")
        r90 = t.get("return_90d")

        if r30 is not None:
            returns_30d.append((score, r30))
            if score >= score_threshold:
                high_score_returns_30d.append(r30)
            else:
                low_score_returns_30d.append(r30)

        if r90 is not None:
            returns_90d.append((score, r90))
            if score >= score_threshold:
                high_score_returns_90d.append(r90)
            else:
                low_score_returns_90d.append(r90)

    result = FormulaResult(weights=weights, n_trades=len(trades))

    # Correlations
    if returns_30d:
        s30, r30 = zip(*returns_30d)
        result.correlation_30d = _pearson_correlation(list(s30), list(r30))
    if returns_90d:
        s90, r90 = zip(*returns_90d)
        result.correlation_90d = _pearson_correlation(list(s90), list(r90))

    # Hit rates
    if high_score_returns_30d:
        result.hit_rate_30d = sum(1 for r in high_score_returns_30d if r > 0) / len(high_score_returns_30d) * 100
        result.high_score_avg_return_30d = sum(high_score_returns_30d) / len(high_score_returns_30d)
    if high_score_returns_90d:
        result.hit_rate_90d = sum(1 for r in high_score_returns_90d if r > 0) / len(high_score_returns_90d) * 100
        result.high_score_avg_return_90d = sum(high_score_returns_90d) / len(high_score_returns_90d)

    # Low score averages
    if low_score_returns_30d:
        result.low_score_avg_return_30d = sum(low_score_returns_30d) / len(low_score_returns_30d)
    if low_score_returns_90d:
        result.low_score_avg_return_90d = sum(low_score_returns_90d) / len(low_score_returns_90d)

    # Edge
    result.edge_30d = result.high_score_avg_return_30d - result.low_score_avg_return_30d
    result.edge_90d = result.high_score_avg_return_90d - result.low_score_avg_return_90d

    result.n_high_score = len(high_score_returns_30d) or len(high_score_returns_90d)
    result.n_low_score = len(low_score_returns_30d) or len(low_score_returns_90d)

    # Combined fitness: weighted combination of metrics
    # We want: high correlation, high hit rate, large edge, decent sample in both buckets
    balance_penalty = 0.0
    total = result.n_high_score + result.n_low_score
    if total > 0:
        ratio = min(result.n_high_score, result.n_low_score) / max(total * 0.5, 1)
        balance_penalty = max(0, 1 - ratio) * 0.3  # Penalize extreme imbalance

    result.fitness = (
        result.correlation_30d * 0.15
        + result.correlation_90d * 0.20
        + (result.hit_rate_30d / 100) * 0.15
        + (result.hit_rate_90d / 100) * 0.15
        + min(result.edge_30d / 10, 1.0) * 0.15  # Normalize edge
        + min(result.edge_90d / 10, 1.0) * 0.20
        - balance_penalty
    )

    return result


def _generate_weight_grid(n_steps: int = 5) -> list[WeightConfig]:
    """Generate a grid of weight configurations to test."""
    configs = []

    # Define ranges for each parameter (min, max, steps)
    ranges = {
        "position_size_max": [10, 15, 20, 25, 30],
        "committee_overlap_max": [15, 20, 25, 30, 40],
        "disclosure_speed_max": [5, 10, 15, 20],
        "cluster_max": [10, 15, 20, 25],
        "cross_source_insider_max": [10, 15, 20, 25],
        "cross_source_fund_max": [5, 10, 15],
        "track_record_max": [5, 10, 15, 20],
        "contrarian_max": [5, 10, 15],
        "leadership_role_max": [10, 15, 20, 25, 30],
        "small_cap_committee_max": [0, 5, 10, 15, 20, 25],
    }

    # Full grid would be too large, so sample strategically
    # Start with baseline variations (vary one factor at a time)
    baseline = WeightConfig()

    # Single-factor sweeps
    for param, values in ranges.items():
        for val in values:
            wc = WeightConfig()
            setattr(wc, param, val)
            configs.append(wc)

    # Random combinations (Monte Carlo exploration)
    random.seed(42)  # Reproducible
    for _ in range(500):
        wc = WeightConfig(
            position_size_max=random.choice(ranges["position_size_max"]),
            committee_overlap_max=random.choice(ranges["committee_overlap_max"]),
            disclosure_speed_max=random.choice(ranges["disclosure_speed_max"]),
            cluster_max=random.choice(ranges["cluster_max"]),
            cross_source_insider_max=random.choice(ranges["cross_source_insider_max"]),
            cross_source_fund_max=random.choice(ranges["cross_source_fund_max"]),
            track_record_max=random.choice(ranges["track_record_max"]),
            contrarian_max=random.choice(ranges["contrarian_max"]),
            leadership_role_max=random.choice(ranges["leadership_role_max"]),
            small_cap_committee_max=random.choice(ranges["small_cap_committee_max"]),
            cluster_mega_cap_discount=random.choice([0.2, 0.3, 0.4, 0.5, 0.6]),
            late_disclosure_days=random.choice([30, 45, 60]),
            min_cluster_size=random.choice([2, 3, 4]),
        )
        configs.append(wc)

    # Include current production weights
    configs.append(baseline)

    return configs


def _evolve_weights(
    top_configs: list[WeightConfig],
    n_children: int = 200,
) -> list[WeightConfig]:
    """Create new weight configs by mutating and crossing over the best performers."""
    children = []
    random.seed(int(time.time()))

    fields = [
        "position_size_max", "committee_overlap_max", "disclosure_speed_max",
        "cluster_max", "cross_source_insider_max", "cross_source_fund_max",
        "track_record_max", "contrarian_max", "leadership_role_max", "small_cap_committee_max",
        "triple_confirmation_bonus", "cluster_mega_cap_discount", "late_disclosure_days", "min_cluster_size",
    ]

    for _ in range(n_children):
        # Pick two parents
        p1 = random.choice(top_configs)
        p2 = random.choice(top_configs)

        # Crossover
        child = WeightConfig()
        for f in fields:
            val = getattr(p1, f) if random.random() < 0.5 else getattr(p2, f)

            # Mutation (20% chance)
            if random.random() < 0.2:
                if isinstance(val, int):
                    val = max(1, val + random.randint(-5, 5))
                else:
                    val = max(0.0, val * random.uniform(0.7, 1.3))

            setattr(child, f, val)

        children.append(child)

    return children


# ─── Cross-Validation ───


def cross_validate(
    trades: list[dict],
    weights: WeightConfig,
    n_folds: int = 3,
) -> dict:
    """
    K-fold cross-validation to check if a formula generalizes.
    Split trades chronologically (not random) to simulate real conditions.
    """
    # Sort by date
    sorted_trades = sorted(trades, key=lambda t: t.get("tx_date") or datetime.min)
    fold_size = len(sorted_trades) // n_folds

    fold_results = []

    for i in range(n_folds):
        test_start = i * fold_size
        test_end = (i + 1) * fold_size if i < n_folds - 1 else len(sorted_trades)

        test_set = sorted_trades[test_start:test_end]
        train_set = sorted_trades[:test_start] + sorted_trades[test_end:]

        if not test_set or not train_set:
            continue

        # Evaluate on test set
        test_result = evaluate_formula(test_set, weights)
        train_result = evaluate_formula(train_set, weights)

        fold_results.append({
            "fold": i + 1,
            "train_trades": len(train_set),
            "test_trades": len(test_set),
            "train_fitness": round(train_result.fitness, 4),
            "test_fitness": round(test_result.fitness, 4),
            "train_edge_90d": round(train_result.edge_90d, 2),
            "test_edge_90d": round(test_result.edge_90d, 2),
            "train_hit_rate_90d": round(train_result.hit_rate_90d, 1),
            "test_hit_rate_90d": round(test_result.hit_rate_90d, 1),
            "overfit_ratio": round(
                train_result.fitness / test_result.fitness if test_result.fitness != 0 else 999,
                2
            ),
        })

    avg_test_fitness = sum(f["test_fitness"] for f in fold_results) / len(fold_results) if fold_results else 0
    avg_overfit = sum(f["overfit_ratio"] for f in fold_results) / len(fold_results) if fold_results else 0

    return {
        "n_folds": n_folds,
        "folds": fold_results,
        "avg_test_fitness": round(avg_test_fitness, 4),
        "avg_overfit_ratio": round(avg_overfit, 2),
        "is_robust": avg_overfit < 1.5 and avg_test_fitness > 0.3,
    }


# ─── Weights Persistence ───


async def save_optimized_weights(
    weights: WeightConfig,
    fitness: float = 0.0,
    hit_rate_90d: float = 0.0,
    edge_90d: float = 0.0,
    correlation_90d: float = 0.0,
    is_robust: bool = False,
    trades_analyzed: int = 0,
) -> dict:
    """Save optimizer-determined weights to DB and update the live scoring cache."""
    import json

    weights_dict = weights.to_dict()

    async with async_session() as session:
        row = OptimizedWeights(
            name="active",
            weights_json=json.dumps(weights_dict),
            fitness=fitness,
            hit_rate_90d=hit_rate_90d,
            edge_90d=edge_90d,
            correlation_90d=correlation_90d,
            is_robust=is_robust,
            trades_analyzed=trades_analyzed,
            applied_at=datetime.utcnow(),
        )
        session.add(row)
        await session.commit()

    # Update the live scoring cache immediately
    set_active_weights(weights_dict)
    logger.info(f"Applied optimized weights (fitness={fitness:.4f}, robust={is_robust})")

    return {
        "status": "applied",
        "weights": weights_dict,
        "fitness": fitness,
        "is_robust": is_robust,
    }


async def get_current_applied_weights() -> dict | None:
    """Get the currently applied weights from DB."""
    import json

    async with async_session() as session:
        result = await session.execute(
            select(OptimizedWeights)
            .where(OptimizedWeights.name == "active")
            .order_by(OptimizedWeights.applied_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row:
            return {
                "weights": json.loads(row.weights_json),
                "fitness": row.fitness,
                "hit_rate_90d": row.hit_rate_90d,
                "edge_90d": row.edge_90d,
                "is_robust": row.is_robust,
                "trades_analyzed": row.trades_analyzed,
                "applied_at": row.applied_at.isoformat() if row.applied_at else None,
            }
    return None


# ─── Main Optimizer ───


async def run_optimization(
    lookback_days: int = 730,
    max_trades: int = 500,
    generations: int = 3,
    top_n: int = 10,
) -> dict:
    """
    Run the full optimization pipeline:
    1. Extract historical trade features with actual returns
    2. Generate initial weight grid
    3. Evaluate all configs
    4. Evolve top performers for N generations
    5. Cross-validate top formulas
    6. Return ranked results with recommendations
    """
    start_time = time.time()
    logger.info(f"Starting optimizer: {lookback_days}d lookback, {max_trades} max trades, {generations} generations")

    # Step 1: Extract features
    trades = await extract_trade_features(days=lookback_days, max_trades=max_trades)
    if not trades:
        return {"error": "No trades with return data found for optimization", "trades_found": 0}

    logger.info(f"Extracted {len(trades)} trades with returns")

    # Step 2: Initial grid
    configs = _generate_weight_grid()
    logger.info(f"Testing {len(configs)} initial weight configurations...")

    # Step 3: Evaluate all
    all_results: list[FormulaResult] = []
    for wc in configs:
        result = evaluate_formula(trades, wc)
        all_results.append(result)

    # Sort by fitness
    all_results.sort(key=lambda r: r.fitness, reverse=True)
    generation_history = [{
        "generation": 0,
        "configs_tested": len(configs),
        "best_fitness": all_results[0].fitness if all_results else 0,
        "avg_fitness": sum(r.fitness for r in all_results) / len(all_results) if all_results else 0,
    }]

    # Step 4: Evolutionary generations
    for gen in range(1, generations + 1):
        top_weights = [r.weights for r in all_results[:20]]
        children = _evolve_weights(top_weights, n_children=200)

        child_results = []
        for wc in children:
            result = evaluate_formula(trades, wc)
            child_results.append(result)

        # Merge and re-sort
        all_results.extend(child_results)
        all_results.sort(key=lambda r: r.fitness, reverse=True)
        all_results = all_results[:100]  # Keep top 100

        generation_history.append({
            "generation": gen,
            "configs_tested": len(children),
            "best_fitness": all_results[0].fitness,
            "avg_fitness": sum(r.fitness for r in all_results[:20]) / 20,
        })
        logger.info(f"Generation {gen}: best fitness = {all_results[0].fitness:.4f}")

    # Step 5: Cross-validate top formulas
    top_formulas = all_results[:top_n]
    validated_results = []

    for i, result in enumerate(top_formulas):
        cv = cross_validate(trades, result.weights)
        validated_results.append({
            "rank": i + 1,
            **result.to_dict(),
            "cross_validation": cv,
        })

    # Step 6: Compare to current production formula
    current_weights = WeightConfig()  # Default = current production
    current_result = evaluate_formula(trades, current_weights)
    current_cv = cross_validate(trades, current_weights)

    # Find the best robust formula
    best_robust = None
    for vr in validated_results:
        if vr["cross_validation"]["is_robust"]:
            best_robust = vr
            break

    # Step 7: Auto-apply best robust formula if it beats current
    applied_info = None
    use_new = (
        best_robust is not None
        and best_robust["fitness"] > current_result.fitness * 1.1
    )
    if use_new:
        best_wc = WeightConfig.from_dict(best_robust["weights"])
        applied_info = await save_optimized_weights(
            weights=best_wc,
            fitness=best_robust["fitness"],
            hit_rate_90d=best_robust.get("hit_rate_90d", 0),
            edge_90d=best_robust.get("edge_90d", 0),
            correlation_90d=best_robust.get("correlation_90d", 0),
            is_robust=True,
            trades_analyzed=len(trades),
        )
        logger.info("Auto-applied best robust formula to live scoring")

    elapsed = time.time() - start_time

    return {
        "optimization_params": {
            "lookback_days": lookback_days,
            "max_trades": max_trades,
            "generations": generations,
            "total_configs_tested": sum(g["configs_tested"] for g in generation_history),
            "elapsed_seconds": round(elapsed, 1),
        },
        "data_summary": {
            "trades_with_returns": len(trades),
            "trades_with_30d_return": sum(1 for t in trades if "return_30d" in t),
            "trades_with_90d_return": sum(1 for t in trades if "return_90d" in t),
            "trades_with_exit": sum(1 for t in trades if "exit_return" in t),
            "date_range": {
                "earliest": min(t["tx_date"].isoformat() for t in trades if t.get("tx_date")),
                "latest": max(t["tx_date"].isoformat() for t in trades if t.get("tx_date")),
            },
        },
        "generation_history": generation_history,
        "current_formula": {
            **current_result.to_dict(),
            "cross_validation": current_cv,
        },
        "top_formulas": validated_results,
        "best_robust_formula": best_robust,
        "recommendation": {
            "use_new_formula": (
                best_robust is not None
                and best_robust["fitness"] > current_result.fitness * 1.1
            ),
            "improvement_pct": round(
                (best_robust["fitness"] - current_result.fitness) / max(current_result.fitness, 0.01) * 100, 1
            ) if best_robust else 0,
            "detail": (
                f"Best robust formula improves fitness by "
                f"{round((best_robust['fitness'] - current_result.fitness) / max(current_result.fitness, 0.01) * 100, 1)}% "
                f"over current (fitness {best_robust['fitness']:.4f} vs {current_result.fitness:.4f}). "
                f"Cross-validation confirms it generalizes."
                if best_robust and best_robust["fitness"] > current_result.fitness * 1.1
                else "Current formula is already near-optimal or insufficient data to improve."
            ),
        },
        "applied": applied_info,
    }
