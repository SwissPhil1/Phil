"""
Smart signals engine - the core intelligence layer of SmartFlow.

Detects unusual patterns, correlates committee assignments with trades,
scores trades by conviction, and flags high-signal opportunities.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade, Politician, InsiderTrade, HedgeFundHolding, async_session

logger = logging.getLogger(__name__)

# Committee -> Sector mapping
COMMITTEE_SECTORS = {
    "Armed Services": ["defense", "aerospace", "military"],
    "Defense": ["defense", "aerospace", "military"],
    "Financial Services": ["finance", "banking", "insurance", "fintech"],
    "Banking": ["finance", "banking", "insurance", "fintech"],
    "Energy and Commerce": ["energy", "oil", "gas", "utilities", "healthcare", "pharma"],
    "Energy and Natural Resources": ["energy", "oil", "gas", "mining", "utilities"],
    "Commerce, Science, and Transportation": ["tech", "telecom", "transport", "space"],
    "Science, Space, and Technology": ["tech", "space", "defense"],
    "Intelligence": ["defense", "cybersecurity", "surveillance", "tech"],
    "Health, Education, Labor, and Pensions": ["healthcare", "pharma", "biotech", "education"],
    "Agriculture": ["agriculture", "food", "commodities"],
    "Appropriations": ["all"],  # Oversees all spending
    "Ways and Means": ["finance", "tax", "trade"],
    "Judiciary": ["tech", "antitrust", "prison"],
    "Foreign Affairs": ["defense", "oil", "commodities", "emerging_markets"],
    "Foreign Relations": ["defense", "oil", "commodities", "emerging_markets"],
    "Transportation and Infrastructure": ["transport", "construction", "infrastructure"],
    "Veterans Affairs": ["healthcare", "defense"],
    "Homeland Security": ["defense", "cybersecurity", "border"],
    "Small Business": ["smallcap", "fintech"],
    "Natural Resources": ["mining", "oil", "gas", "energy"],
    "Oversight and Accountability": ["all"],
}

# Ticker -> Sector mapping (major stocks)
TICKER_SECTORS = {
    # Defense
    "LMT": "defense", "RTX": "defense", "NOC": "defense", "GD": "defense",
    "BA": "defense", "LHX": "defense", "HII": "defense", "LDOS": "defense",
    "PLTR": "defense", "PANW": "cybersecurity", "CRWD": "cybersecurity",
    "NET": "cybersecurity", "FTNT": "cybersecurity", "RKLB": "space",
    # Energy / Oil
    "XOM": "oil", "CVX": "oil", "COP": "oil", "OXY": "oil",
    "SLB": "oil", "HAL": "oil", "EOG": "oil", "PXD": "oil",
    "NEE": "energy", "DUK": "energy", "SO": "energy", "ENPH": "energy",
    "FSLR": "energy", "TSLA": "energy",
    # Finance
    "JPM": "finance", "BAC": "finance", "GS": "finance", "MS": "finance",
    "C": "finance", "WFC": "finance", "BLK": "finance", "SCHW": "finance",
    "V": "fintech", "MA": "fintech", "PYPL": "fintech", "SQ": "fintech",
    "COIN": "fintech", "SOFI": "fintech",
    # Tech
    "AAPL": "tech", "MSFT": "tech", "GOOGL": "tech", "GOOG": "tech",
    "META": "tech", "AMZN": "tech", "NVDA": "tech", "AMD": "tech",
    "AVGO": "tech", "INTC": "tech", "CRM": "tech", "ORCL": "tech",
    "SNOW": "tech", "SHOP": "tech", "UBER": "tech",
    # Healthcare / Pharma
    "JNJ": "pharma", "PFE": "pharma", "MRK": "pharma", "ABBV": "pharma",
    "LLY": "pharma", "UNH": "healthcare", "CVS": "healthcare",
    "MRNA": "biotech", "BNTX": "biotech", "REGN": "biotech",
    # Other
    "WMT": "retail", "COST": "retail", "TGT": "retail",
    "DIS": "media", "NFLX": "media", "RBLX": "media",
}


# --- Committee-Trade Correlation ---


def check_committee_overlap(committees: list[str], ticker: str) -> dict | None:
    """
    Check if a politician's committee assignments overlap with a stock's sector.
    Returns correlation details if overlap found.
    """
    stock_sector = TICKER_SECTORS.get(ticker)
    if not stock_sector:
        return None

    for committee in committees:
        sectors = []
        for comm_name, comm_sectors in COMMITTEE_SECTORS.items():
            if comm_name.lower() in committee.lower() or committee.lower() in comm_name.lower():
                sectors = comm_sectors
                break

        if "all" in sectors or stock_sector in sectors:
            return {
                "committee": committee,
                "stock_sector": stock_sector,
                "overlap_type": "direct" if stock_sector in sectors else "broad_oversight",
                "flag": "HIGH" if stock_sector in sectors else "MEDIUM",
            }

    return None


# --- Cluster Detection ---


async def detect_trade_clusters(
    session: AsyncSession,
    days: int = 14,
    min_politicians: int = 3,
) -> list[dict]:
    """
    Detect when multiple politicians buy/sell the same stock within a window.
    This is a strong signal - if 3+ Congress members buy the same small stock,
    something is likely happening.
    """
    since = datetime.utcnow() - timedelta(days=days)

    stmt = (
        select(
            Trade.ticker,
            Trade.tx_type,
            func.count(func.distinct(Trade.politician)).label("politician_count"),
            func.group_concat(func.distinct(Trade.politician)).label("politicians"),
            func.min(Trade.tx_date).label("first_trade"),
            func.max(Trade.tx_date).label("last_trade"),
        )
        .where(Trade.tx_date >= since)
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_type.in_(["purchase", "sale", "sale_full", "sale_partial"]))
        .group_by(Trade.ticker, Trade.tx_type)
        .having(func.count(func.distinct(Trade.politician)) >= min_politicians)
        .order_by(func.count(func.distinct(Trade.politician)).desc())
    )

    result = await session.execute(stmt)
    rows = result.all()

    clusters = []
    for row in rows:
        politicians = row.politicians.split(",") if row.politicians else []
        clusters.append({
            "ticker": row.ticker,
            "action": "BUYING" if row.tx_type == "purchase" else "SELLING",
            "politician_count": row.politician_count,
            "politicians": politicians,
            "first_trade": row.first_trade.isoformat() if row.first_trade else None,
            "last_trade": row.last_trade.isoformat() if row.last_trade else None,
            "window_days": (row.last_trade - row.first_trade).days if row.first_trade and row.last_trade else 0,
            "signal_strength": "VERY_HIGH" if row.politician_count >= 5 else "HIGH" if row.politician_count >= 3 else "MEDIUM",
        })

    return clusters


# --- Cross-Source Signal Detection ---


async def detect_cross_source_signals(
    session: AsyncSession,
    days: int = 30,
) -> list[dict]:
    """
    Detect when both politicians AND insiders are buying the same stock.
    Or when a hedge fund adds a position that politicians are also buying.
    Multi-source convergence = strongest possible signal.
    """
    since = datetime.utcnow() - timedelta(days=days)
    signals = []

    # Get tickers politicians are buying
    congress_buys = await session.execute(
        select(Trade.ticker, func.count().label("count"))
        .where(Trade.tx_date >= since)
        .where(Trade.tx_type == "purchase")
        .where(Trade.ticker.isnot(None))
        .group_by(Trade.ticker)
    )
    congress_tickers = {row.ticker: row.count for row in congress_buys.all()}

    # Get tickers insiders are buying
    insider_buys = await session.execute(
        select(InsiderTrade.ticker, func.count().label("count"))
        .where(InsiderTrade.filing_date >= since)
        .where(InsiderTrade.tx_type == "purchase")
        .where(InsiderTrade.ticker.isnot(None))
        .group_by(InsiderTrade.ticker)
    )
    insider_tickers = {row.ticker: row.count for row in insider_buys.all()}

    # Get tickers hedge funds hold (from latest reports)
    fund_holdings = await session.execute(
        select(HedgeFundHolding.ticker)
        .where(HedgeFundHolding.ticker.isnot(None))
        .where(HedgeFundHolding.is_new_position == True)
        .distinct()
    )
    fund_new_tickers = {row.ticker for row in fund_holdings.all()}

    # Find overlaps
    all_tickers = set(congress_tickers.keys()) | set(insider_tickers.keys())

    for ticker in all_tickers:
        sources = []
        if ticker in congress_tickers:
            sources.append(f"Congress ({congress_tickers[ticker]} trades)")
        if ticker in insider_tickers:
            sources.append(f"Insiders ({insider_tickers[ticker]} trades)")
        if ticker in fund_new_tickers:
            sources.append("New hedge fund position")

        if len(sources) >= 2:
            signals.append({
                "ticker": ticker,
                "sector": TICKER_SECTORS.get(ticker, "unknown"),
                "sources": sources,
                "source_count": len(sources),
                "signal_strength": "VERY_HIGH" if len(sources) >= 3 else "HIGH",
                "description": f"{ticker}: {' + '.join(sources)}",
            })

    signals.sort(key=lambda x: x["source_count"], reverse=True)
    return signals


# --- Conviction Scoring ---


def score_trade_conviction(
    trade: dict,
    committees: list[str] | None = None,
    cluster_count: int = 0,
    insider_also_buying: bool = False,
    fund_also_holds: bool = False,
) -> dict:
    """
    Score a single trade on conviction (0-100).
    Higher score = stronger signal.
    """
    score = 0
    factors = []

    # Base score by amount
    amount = trade.get("amount_low", 0) or 0
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

    # Committee overlap (the killer signal)
    if committees and trade.get("ticker"):
        overlap = check_committee_overlap(committees, trade["ticker"])
        if overlap:
            if overlap["flag"] == "HIGH":
                score += 30
                factors.append(f"COMMITTEE OVERLAP: {overlap['committee']} → {overlap['stock_sector']}")
            else:
                score += 15
                factors.append(f"Broad committee overlap: {overlap['committee']}")

    # Disclosure speed (fast disclosure = more confident)
    delay = trade.get("disclosure_delay_days")
    if delay is not None:
        if delay <= 7:
            score += 10
            factors.append("Fast disclosure (within 7 days)")
        elif delay <= 14:
            score += 5
            factors.append("Timely disclosure (within 14 days)")

    # Cluster signal
    if cluster_count >= 5:
        score += 20
        factors.append(f"Strong cluster: {cluster_count} politicians trading same stock")
    elif cluster_count >= 3:
        score += 15
        factors.append(f"Cluster: {cluster_count} politicians trading same stock")

    # Cross-source confirmation
    if insider_also_buying:
        score += 15
        factors.append("Corporate insiders also buying")
    if fund_also_holds:
        score += 10
        factors.append("Top hedge fund also holds position")

    # Cap at 100
    score = min(score, 100)

    # Rating
    if score >= 80:
        rating = "VERY_HIGH"
    elif score >= 60:
        rating = "HIGH"
    elif score >= 40:
        rating = "MEDIUM"
    elif score >= 20:
        rating = "LOW"
    else:
        rating = "VERY_LOW"

    return {
        "score": score,
        "rating": rating,
        "factors": factors,
    }


# --- Main Signal Generation ---


async def generate_all_signals() -> dict:
    """Generate all smart signals across data sources."""
    async with async_session() as session:
        clusters = await detect_trade_clusters(session)
        cross_signals = await detect_cross_source_signals(session)

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "clusters": clusters,
        "cross_source_signals": cross_signals,
        "total_high_signals": sum(
            1 for s in cross_signals if s["signal_strength"] == "VERY_HIGH"
        ) + sum(
            1 for c in clusters if c["signal_strength"] == "VERY_HIGH"
        ),
    }
