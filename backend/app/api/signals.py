"""API routes for Smart Signals engine."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import get_db
from app.services.committees import get_committee_members, get_politician_committees, run_committee_ingestion
from app.services.signals import (
    check_committee_overlap,
    detect_cross_source_signals,
    detect_trade_clusters,
    generate_all_signals,
    score_trade_conviction,
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
):
    """
    Score a trade's conviction level (0-100).
    Optionally provide politician name to check committee correlation.
    """
    trade = {
        "ticker": ticker.upper(),
        "tx_type": tx_type,
        "amount_low": amount_low,
    }

    committees = []
    if politician:
        committees_data = await get_politician_committees(politician)
        committees = [c["committee_name"] for c in committees_data]

    result = score_trade_conviction(trade, committees=committees)
    result["ticker"] = ticker.upper()
    result["politician"] = politician
    result["committees_checked"] = committees
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
