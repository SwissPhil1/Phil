"""API routes for Smart Signals engine."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade, InsiderTrade, HedgeFundHolding, get_db, async_session
from app.services.committees import get_committee_members, get_politician_committees, run_committee_ingestion
from app.services.signals import (
    check_committee_overlap,
    detect_cross_source_signals,
    detect_trade_clusters,
    generate_all_signals,
    score_trade_conviction,
    get_politician_track_record,
)

router = APIRouter(prefix="/signals", tags=["Smart Signals"])


@router.get("/")
async def get_all_signals():
    """
    Get all smart signals: clusters, cross-source convergence, and counts.
    This is the main intelligence endpoint.
    """
    return await generate_all_signals()


@router.get("/clusters")
async def get_clusters(
    days: int = Query(default=14, ge=1, le=90),
    min_politicians: int = Query(default=3, ge=2, le=20),
    db: AsyncSession = Depends(get_db),
):
    """
    Detect clusters where multiple politicians trade the same stock.
    3+ politicians buying the same stock = strong signal.
    """
    return await detect_trade_clusters(db, days=days, min_politicians=min_politicians)


@router.get("/cross-source")
async def get_cross_source_signals(
    days: int = Query(default=30, ge=1, le=180),
    db: AsyncSession = Depends(get_db),
):
    """
    Find stocks where Congress + insiders + hedge funds are all buying.
    Multi-source convergence = strongest possible signal.
    """
    return await detect_cross_source_signals(db, days=days)


@router.get("/score-trade")
async def score_a_trade(
    ticker: str = Query(...),
    tx_type: str = Query(default="purchase"),
    amount_low: float = Query(default=0),
    politician: str | None = None,
    disclosure_delay_days: int | None = None,
):
    """
    Score a trade's conviction level (0-100) using the v2 enhanced scoring.

    Factors scored:
    1. Position Size (0-25 pts)
    2. Committee Overlap (0-30 pts) - strongest insider signal
    3. Disclosure Speed (0-15 pts) - late disclosure = MORE suspicious
    4. Political Cluster (0-20 pts) - weighted by market cap
    5. Cross-Source Confirmation (0-25 pts) - congress + insiders + funds
    6. Historical Accuracy (0-15 pts) - politician's track record
    7. Contrarian Signal (0-10 pts) - buying when others are selling
    """
    ticker = ticker.upper()

    trade = {
        "ticker": ticker,
        "tx_type": tx_type,
        "amount_low": amount_low,
        "disclosure_delay_days": disclosure_delay_days,
    }

    committees = []
    track_record = None
    if politician:
        committees_data = await get_politician_committees(politician)
        committees = [c["committee_name"] for c in committees_data]

        async with async_session() as session:
            track_record = await get_politician_track_record(session, politician)

    # Check cross-source signals
    insider_buying = False
    fund_holds = False
    cluster_count = 0
    recent_sells = 0

    async with async_session() as session:
        from datetime import datetime, timedelta
        since = datetime.utcnow() - timedelta(days=30)

        # Cluster count
        cluster_result = await session.execute(
            select(func.count(func.distinct(Trade.politician)))
            .where(Trade.ticker == ticker)
            .where(Trade.tx_type == "purchase")
            .where(Trade.tx_date >= since)
        )
        cluster_count = cluster_result.scalar() or 0

        # Insider buying?
        insider_result = await session.execute(
            select(func.count())
            .where(InsiderTrade.ticker == ticker)
            .where(InsiderTrade.tx_type == "purchase")
            .where(InsiderTrade.filing_date >= since)
        )
        insider_buying = (insider_result.scalar() or 0) > 0

        # Fund holds?
        fund_result = await session.execute(
            select(func.count())
            .where(HedgeFundHolding.ticker == ticker)
            .where(HedgeFundHolding.is_new_position == True)
        )
        fund_holds = (fund_result.scalar() or 0) > 0

        # Recent sells (for contrarian signal)
        sell_result = await session.execute(
            select(func.count(func.distinct(Trade.politician)))
            .where(Trade.ticker == ticker)
            .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
            .where(Trade.tx_date >= since)
        )
        recent_sells = sell_result.scalar() or 0

    result = score_trade_conviction(
        trade,
        committees=committees,
        cluster_count=cluster_count,
        insider_also_buying=insider_buying,
        fund_also_holds=fund_holds,
        politician_track_record=track_record,
        recent_sells_count=recent_sells,
    )
    result["ticker"] = ticker
    result["politician"] = politician
    result["committees_checked"] = committees
    result["context"] = {
        "cluster_count": cluster_count,
        "insider_buying": insider_buying,
        "fund_holds": fund_holds,
        "recent_sells": recent_sells,
        "track_record": track_record,
    }
    return result


@router.get("/committee-check")
async def check_committee_trade(
    ticker: str = Query(...),
    politician: str = Query(...),
):
    """
    Check if a politician's committee assignments create a conflict
    with a specific stock trade.
    """
    committees_data = await get_politician_committees(politician)
    committees = [c["committee_name"] for c in committees_data]

    overlap = check_committee_overlap(committees, ticker.upper())

    return {
        "politician": politician,
        "ticker": ticker.upper(),
        "committees": committees_data,
        "overlap": overlap,
        "has_conflict": overlap is not None,
        "flag": overlap["flag"] if overlap else None,
    }


# --- Committee Data ---


@router.get("/committees/politician/{name}")
async def get_politician_committee_assignments(name: str):
    """Get all committee assignments for a politician."""
    return await get_politician_committees(name)


@router.get("/committees/members")
async def get_committee_member_list(
    committee: str = Query(..., description="Committee name to search"),
):
    """Get all members of a specific committee."""
    return await get_committee_members(committee)


@router.post("/committees/ingest")
async def trigger_committee_ingestion():
    """Manually trigger committee data ingestion from GitHub."""
    return await run_committee_ingestion()
