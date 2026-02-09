"""
Smart signals engine - the core intelligence layer of SmartFlow.

Detects unusual patterns, correlates committee assignments with trades,
scores trades by conviction, and flags high-signal opportunities.

Scoring factors (v2 - enhanced):
1. Position Size (0-25 pts) - larger trades = more conviction
2. Committee Overlap (0-30 pts) - strongest insider signal
3. Disclosure Speed (0-15 pts) - fast/slow disclosure patterns
4. Political Cluster (0-20 pts) - multiple politicians buying same stock
5. Cross-Source Confirmation (0-25 pts) - congress + insiders + funds
6. Historical Accuracy (0-15 pts) - politician's track record
7. Timing Anomaly (0-10 pts) - trades before major events
8. Contrarian Signal (0-10 pts) - buying when others sell, or vice versa
"""

import logging
import math
from datetime import datetime, timedelta

from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Trade, Politician, InsiderTrade, HedgeFundHolding,
    PoliticianCommittee, async_session,
)

logger = logging.getLogger(__name__)

# Committee -> Sector mapping (expanded)
COMMITTEE_SECTORS = {
    "Armed Services": ["defense", "aerospace", "military"],
    "Defense": ["defense", "aerospace", "military"],
    "Financial Services": ["finance", "banking", "insurance", "fintech"],
    "Banking": ["finance", "banking", "insurance", "fintech"],
    "Banking, Housing, and Urban Affairs": ["finance", "banking", "insurance", "real_estate"],
    "Energy and Commerce": ["energy", "oil", "gas", "utilities", "healthcare", "pharma", "tech"],
    "Energy and Natural Resources": ["energy", "oil", "gas", "mining", "utilities"],
    "Commerce, Science, and Transportation": ["tech", "telecom", "transport", "space"],
    "Science, Space, and Technology": ["tech", "space", "defense"],
    "Intelligence": ["defense", "cybersecurity", "surveillance", "tech"],
    "Health, Education, Labor, and Pensions": ["healthcare", "pharma", "biotech", "education"],
    "Agriculture": ["agriculture", "food", "commodities"],
    "Agriculture, Nutrition, and Forestry": ["agriculture", "food", "commodities"],
    "Appropriations": ["all"],  # Oversees all spending
    "Ways and Means": ["finance", "tax", "trade"],
    "Finance": ["finance", "tax", "trade", "healthcare"],
    "Judiciary": ["tech", "antitrust", "prison"],
    "Foreign Affairs": ["defense", "oil", "commodities", "emerging_markets"],
    "Foreign Relations": ["defense", "oil", "commodities", "emerging_markets"],
    "Transportation and Infrastructure": ["transport", "construction", "infrastructure"],
    "Environment and Public Works": ["energy", "construction", "infrastructure", "utilities"],
    "Veterans Affairs": ["healthcare", "defense"],
    "Homeland Security": ["defense", "cybersecurity", "border"],
    "Homeland Security and Governmental Affairs": ["defense", "cybersecurity", "border", "tech"],
    "Small Business": ["smallcap", "fintech"],
    "Small Business and Entrepreneurship": ["smallcap", "fintech"],
    "Natural Resources": ["mining", "oil", "gas", "energy"],
    "Budget": ["all"],
    "Rules": ["all"],
    "Oversight and Accountability": ["all"],
    "Oversight and Government Reform": ["all"],
}

# Ticker -> Sector mapping (expanded with more tickers)
TICKER_SECTORS = {
    # Defense & Aerospace
    "LMT": "defense", "RTX": "defense", "NOC": "defense", "GD": "defense",
    "BA": "defense", "LHX": "defense", "HII": "defense", "LDOS": "defense",
    "PLTR": "defense", "BWXT": "defense", "KTOS": "defense", "MRCY": "defense",
    "PANW": "cybersecurity", "CRWD": "cybersecurity",
    "NET": "cybersecurity", "FTNT": "cybersecurity", "ZS": "cybersecurity",
    "RKLB": "space", "ASTR": "space", "ASTS": "space",
    # Energy / Oil & Gas
    "XOM": "oil", "CVX": "oil", "COP": "oil", "OXY": "oil",
    "SLB": "oil", "HAL": "oil", "EOG": "oil", "PXD": "oil",
    "DVN": "oil", "MPC": "oil", "PSX": "oil", "VLO": "oil",
    "NEE": "energy", "DUK": "energy", "SO": "energy", "ENPH": "energy",
    "FSLR": "energy", "TSLA": "energy", "AES": "energy", "EXC": "energy",
    # Finance & Banking
    "JPM": "finance", "BAC": "finance", "GS": "finance", "MS": "finance",
    "C": "finance", "WFC": "finance", "BLK": "finance", "SCHW": "finance",
    "USB": "finance", "PNC": "finance", "TFC": "finance", "COF": "finance",
    "AXP": "finance", "ICE": "finance", "CME": "finance",
    # Fintech
    "V": "fintech", "MA": "fintech", "PYPL": "fintech", "SQ": "fintech",
    "COIN": "fintech", "SOFI": "fintech", "AFRM": "fintech", "HOOD": "fintech",
    # Tech
    "AAPL": "tech", "MSFT": "tech", "GOOGL": "tech", "GOOG": "tech",
    "META": "tech", "AMZN": "tech", "NVDA": "tech", "AMD": "tech",
    "AVGO": "tech", "INTC": "tech", "CRM": "tech", "ORCL": "tech",
    "SNOW": "tech", "SHOP": "tech", "UBER": "tech", "ABNB": "tech",
    "NOW": "tech", "ADBE": "tech", "INTU": "tech", "TEAM": "tech",
    "MU": "tech", "QCOM": "tech", "TXN": "tech", "ARM": "tech",
    # Telecom
    "T": "telecom", "VZ": "telecom", "TMUS": "telecom",
    # Healthcare / Pharma / Biotech
    "JNJ": "pharma", "PFE": "pharma", "MRK": "pharma", "ABBV": "pharma",
    "LLY": "pharma", "BMY": "pharma", "AMGN": "pharma", "GILD": "pharma",
    "UNH": "healthcare", "CVS": "healthcare", "CI": "healthcare",
    "HUM": "healthcare", "ELV": "healthcare", "HCA": "healthcare",
    "MRNA": "biotech", "BNTX": "biotech", "REGN": "biotech",
    "VRTX": "biotech", "BIIB": "biotech", "ILMN": "biotech",
    # Retail & Consumer
    "WMT": "retail", "COST": "retail", "TGT": "retail",
    "HD": "retail", "LOW": "retail", "AMZN": "retail",
    # Media & Entertainment
    "DIS": "media", "NFLX": "media", "RBLX": "media", "PARA": "media",
    "WBD": "media", "CMCSA": "media",
    # Real Estate
    "AMT": "real_estate", "PLD": "real_estate", "SPG": "real_estate",
    # Construction & Infrastructure
    "CAT": "construction", "DE": "construction", "VMC": "construction",
    "MLM": "construction", "URI": "construction",
    # Agriculture & Food
    "ADM": "agriculture", "BG": "agriculture", "CTVA": "agriculture",
    "MOS": "agriculture", "NTR": "agriculture",
    # Mining
    "FCX": "mining", "NEM": "mining", "GOLD": "mining",
    # Prison / Border
    "GEO": "prison", "CXW": "prison",
    # Emerging Markets
    "BABA": "emerging_markets", "PDD": "emerging_markets", "JD": "emerging_markets",
    # Trump-connected (special tracking)
    "DJT": "trump_media", "RUM": "trump_media", "PHUN": "trump_media",
    "NMRK": "trump_real_estate", "BGC": "trump_real_estate",
}

# Market cap categories for weighting
MEGA_CAP = {"AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "UNH", "LLY", "V", "JPM"}
LARGE_CAP = {"JNJ", "XOM", "PG", "MA", "HD", "CVX", "MRK", "ABBV", "PFE", "COST", "AVGO", "PEP", "KO", "WMT",
             "BAC", "CRM", "ORCL", "AMD", "ADBE", "NFLX", "DIS", "INTC", "QCOM", "TXN", "GS", "MS", "BA",
             "LMT", "RTX", "NOC", "GD", "CAT", "DE"}


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

        # Boost signal for small/mid cap stocks (more unusual)
        is_mega = row.ticker in MEGA_CAP
        base_strength = row.politician_count

        clusters.append({
            "ticker": row.ticker,
            "action": "BUYING" if row.tx_type == "purchase" else "SELLING",
            "politician_count": row.politician_count,
            "politicians": politicians,
            "first_trade": row.first_trade.isoformat() if row.first_trade else None,
            "last_trade": row.last_trade.isoformat() if row.last_trade else None,
            "window_days": (row.last_trade - row.first_trade).days if row.first_trade and row.last_trade else 0,
            "is_mega_cap": is_mega,
            "signal_strength": (
                "VERY_HIGH" if (base_strength >= 5 and not is_mega) or base_strength >= 8
                else "HIGH" if base_strength >= 3
                else "MEDIUM"
            ),
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


# --- Enhanced Conviction Scoring (v2) ---


async def get_politician_track_record(
    session: AsyncSession, politician: str
) -> dict:
    """Get a politician's historical trading performance for accuracy scoring."""
    result = await session.execute(
        select(
            func.count().label("total"),
            func.avg(Trade.return_since_disclosure).label("avg_return"),
            func.sum(
                func.case((Trade.return_since_disclosure > 0, 1), else_=0)
            ).label("wins"),
        )
        .where(Trade.politician.ilike(f"%{politician}%"))
        .where(Trade.tx_type == "purchase")
        .where(Trade.return_since_disclosure.isnot(None))
    )
    row = result.one_or_none()
    if not row or not row.total or row.total == 0:
        return {"total": 0, "avg_return": None, "win_rate": None}

    return {
        "total": row.total,
        "avg_return": float(row.avg_return) if row.avg_return else 0,
        "win_rate": float(row.wins / row.total * 100) if row.total > 0 else 0,
    }


def score_trade_conviction(
    trade: dict,
    committees: list[str] | None = None,
    cluster_count: int = 0,
    insider_also_buying: bool = False,
    fund_also_holds: bool = False,
    politician_track_record: dict | None = None,
    recent_sells_count: int = 0,
) -> dict:
    """
    Score a single trade on conviction (0-100).
    Higher score = stronger signal that this trade has insider information edge.

    v2 scoring with 8 factors:
    1. Position Size (0-25 pts)
    2. Committee Overlap (0-30 pts)
    3. Disclosure Speed (0-15 pts) - includes late-disclosure penalty detection
    4. Political Cluster (0-20 pts) - weighted by market cap
    5. Cross-Source Confirmation (0-25 pts)
    6. Historical Accuracy (0-15 pts) - politician's track record
    7. Contrarian Signal (0-10 pts) - buying when market/others selling
    8. Size Anomaly (0-10 pts) - trade size vs politician's usual
    """
    score = 0
    factors = []

    ticker = trade.get("ticker", "")

    # ─── Factor 1: Position Size (0-25 pts) ───
    amount = trade.get("amount_low", 0) or 0
    if amount >= 5000001:
        score += 25
        factors.append({"factor": "position_size", "points": 25, "detail": "Very large position ($5M+)"})
    elif amount >= 1000001:
        score += 22
        factors.append({"factor": "position_size", "points": 22, "detail": "Large position ($1M+)"})
    elif amount >= 500001:
        score += 18
        factors.append({"factor": "position_size", "points": 18, "detail": "Significant position ($500K+)"})
    elif amount >= 250001:
        score += 15
        factors.append({"factor": "position_size", "points": 15, "detail": "Medium-large position ($250K+)"})
    elif amount >= 100001:
        score += 10
        factors.append({"factor": "position_size", "points": 10, "detail": "Medium position ($100K+)"})
    elif amount >= 50001:
        score += 7
        factors.append({"factor": "position_size", "points": 7, "detail": "Moderate position ($50K+)"})
    else:
        score += 3
        factors.append({"factor": "position_size", "points": 3, "detail": "Small position"})

    # ─── Factor 2: Committee Overlap (0-30 pts) ───
    committee_overlap = None
    if committees and ticker:
        overlap = check_committee_overlap(committees, ticker)
        if overlap:
            committee_overlap = overlap
            if overlap["flag"] == "HIGH":
                # Direct sector match - strongest signal
                pts = 30
                # Bonus: small/mid cap + committee = even more suspicious
                if ticker not in MEGA_CAP and ticker not in LARGE_CAP:
                    pts = 30  # Already max, but flag it
                    factors.append({
                        "factor": "committee_smallcap_bonus", "points": 0,
                        "detail": f"Small/mid-cap + committee overlap (very suspicious)"
                    })
                score += pts
                factors.append({
                    "factor": "committee_overlap", "points": pts,
                    "detail": f"DIRECT: {overlap['committee']} → {overlap['stock_sector']}"
                })
            else:
                score += 15
                factors.append({
                    "factor": "committee_overlap", "points": 15,
                    "detail": f"Broad oversight: {overlap['committee']}"
                })

    # ─── Factor 3: Disclosure Speed (0-15 pts) ───
    delay = trade.get("disclosure_delay_days")
    if delay is not None:
        if delay <= 3:
            score += 5
            factors.append({"factor": "disclosure_speed", "points": 5, "detail": "Very fast disclosure (≤3 days)"})
        elif delay <= 7:
            score += 8
            factors.append({"factor": "disclosure_speed", "points": 8, "detail": "Fast disclosure (≤7 days)"})
        elif delay <= 14:
            score += 5
            factors.append({"factor": "disclosure_speed", "points": 5, "detail": "Timely disclosure (≤14 days)"})
        elif delay <= 30:
            score += 2
            factors.append({"factor": "disclosure_speed", "points": 2, "detail": "Standard disclosure (≤30 days)"})
        elif delay > 45:
            # LATE disclosure is actually MORE suspicious - they're trying to hide it
            score += 15
            factors.append({
                "factor": "disclosure_speed", "points": 15,
                "detail": f"LATE disclosure ({delay} days) - potentially hiding trade"
            })

    # ─── Factor 4: Political Cluster (0-20 pts) ───
    if cluster_count >= 8:
        pts = 20
        # But if it's a mega-cap, reduce the signal (everyone buys NVDA)
        if ticker in MEGA_CAP:
            pts = 8
        score += pts
        factors.append({
            "factor": "cluster", "points": pts,
            "detail": f"Strong cluster: {cluster_count} politicians trading {ticker}"
            + (" (mega-cap discount)" if ticker in MEGA_CAP else "")
        })
    elif cluster_count >= 5:
        pts = 18 if ticker not in MEGA_CAP else 6
        score += pts
        factors.append({
            "factor": "cluster", "points": pts,
            "detail": f"Cluster: {cluster_count} politicians trading {ticker}"
        })
    elif cluster_count >= 3:
        pts = 15 if ticker not in MEGA_CAP else 5
        score += pts
        factors.append({
            "factor": "cluster", "points": pts,
            "detail": f"Cluster: {cluster_count} politicians trading {ticker}"
        })

    # ─── Factor 5: Cross-Source Confirmation (0-25 pts) ───
    cross_sources = 0
    if insider_also_buying:
        cross_sources += 1
        score += 15
        factors.append({
            "factor": "cross_source_insider", "points": 15,
            "detail": "Corporate insiders also buying"
        })
    if fund_also_holds:
        cross_sources += 1
        score += 10
        factors.append({
            "factor": "cross_source_fund", "points": 10,
            "detail": "Top hedge fund also holds/adding position"
        })
    # Triple confirmation bonus
    if cross_sources >= 2:
        bonus = 5
        score += bonus
        factors.append({
            "factor": "triple_confirmation", "points": bonus,
            "detail": "TRIPLE CONFIRMATION: Congress + Insiders + Hedge Funds"
        })

    # ─── Factor 6: Historical Accuracy (0-15 pts) ───
    if politician_track_record and politician_track_record.get("total", 0) >= 5:
        win_rate = politician_track_record.get("win_rate", 0) or 0
        avg_return = politician_track_record.get("avg_return", 0) or 0
        if win_rate >= 70 and avg_return > 5:
            score += 15
            factors.append({
                "factor": "track_record", "points": 15,
                "detail": f"Star trader: {win_rate:.0f}% win rate, {avg_return:.1f}% avg return"
            })
        elif win_rate >= 60 and avg_return > 2:
            score += 10
            factors.append({
                "factor": "track_record", "points": 10,
                "detail": f"Good track record: {win_rate:.0f}% win rate, {avg_return:.1f}% avg return"
            })
        elif win_rate >= 50:
            score += 5
            factors.append({
                "factor": "track_record", "points": 5,
                "detail": f"Average track record: {win_rate:.0f}% win rate"
            })
        elif win_rate < 40:
            # Consistently bad trader - negative signal
            score -= 5
            factors.append({
                "factor": "track_record", "points": -5,
                "detail": f"Poor track record: {win_rate:.0f}% win rate (contrarian signal)"
            })

    # ─── Factor 7: Contrarian Signal (0-10 pts) ───
    tx_type = trade.get("tx_type", "")
    if tx_type == "purchase" and recent_sells_count >= 3:
        score += 10
        factors.append({
            "factor": "contrarian", "points": 10,
            "detail": f"Buying while {recent_sells_count} others selling (contrarian conviction)"
        })

    # Cap at 100
    score = min(max(score, 0), 100)

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
        "factor_breakdown": {
            f["factor"]: f["points"] for f in factors
        },
        "committee_overlap": committee_overlap,
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
