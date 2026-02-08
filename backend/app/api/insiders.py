"""API routes for SEC Form 4 insider trades."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import InsiderTrade, get_db
from app.services.insiders import TRACKED_COMPANIES, run_insider_ingestion

router = APIRouter(prefix="/insiders", tags=["Corporate Insiders (Form 4)"])


@router.get("/trades")
async def get_insider_trades(
    ticker: str | None = None,
    insider: str | None = None,
    tx_type: str | None = None,
    min_value: float | None = None,
    days: int = Query(default=90, ge=1, le=365),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get insider trades with filters."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = select(InsiderTrade).where(InsiderTrade.filing_date >= since)

    if ticker:
        stmt = stmt.where(InsiderTrade.ticker == ticker.upper())
    if insider:
        stmt = stmt.where(InsiderTrade.insider_name.ilike(f"%{insider}%"))
    if tx_type:
        stmt = stmt.where(InsiderTrade.tx_type == tx_type.lower())
    if min_value:
        stmt = stmt.where(InsiderTrade.total_value >= min_value)

    stmt = stmt.order_by(InsiderTrade.filing_date.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(stmt)
    trades = result.scalars().all()

    return [
        {
            "insider": t.insider_name,
            "title": t.insider_title,
            "is_director": t.is_director,
            "is_officer": t.is_officer,
            "is_ten_pct_owner": t.is_ten_pct_owner,
            "company": t.issuer_name,
            "ticker": t.ticker,
            "tx_date": t.tx_date,
            "filing_date": t.filing_date,
            "tx_type": t.tx_type,
            "tx_code": t.tx_code,
            "shares": t.shares,
            "price_per_share": t.price_per_share,
            "total_value": t.total_value,
            "shares_after": t.shares_after,
            "acquired_disposed": t.acquired_disposed,
        }
        for t in trades
    ]


@router.get("/buys")
async def get_insider_buys(
    days: int = Query(default=30, ge=1, le=365),
    min_value: float = Query(default=100000),
    limit: int = Query(default=30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get significant insider purchases (the signal that matters most)."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(InsiderTrade)
        .where(InsiderTrade.filing_date >= since)
        .where(InsiderTrade.tx_type == "purchase")
        .where(InsiderTrade.total_value >= min_value)
        .order_by(InsiderTrade.total_value.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    trades = result.scalars().all()

    return [
        {
            "insider": t.insider_name,
            "title": t.insider_title,
            "company": t.issuer_name,
            "ticker": t.ticker,
            "tx_date": t.tx_date,
            "shares": t.shares,
            "price_per_share": t.price_per_share,
            "total_value": t.total_value,
        }
        for t in trades
    ]


@router.get("/most-active-tickers")
async def most_active_insider_tickers(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Tickers with most insider activity."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(
            InsiderTrade.ticker,
            InsiderTrade.issuer_name,
            func.count().label("trade_count"),
            func.count(func.distinct(InsiderTrade.insider_name)).label("insider_count"),
            func.sum(InsiderTrade.total_value).label("total_value"),
        )
        .where(InsiderTrade.filing_date >= since)
        .where(InsiderTrade.ticker.isnot(None))
        .group_by(InsiderTrade.ticker, InsiderTrade.issuer_name)
        .order_by(func.count().desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [
        {
            "ticker": r.ticker,
            "company": r.issuer_name,
            "trade_count": r.trade_count,
            "insider_count": r.insider_count,
            "total_value": r.total_value,
        }
        for r in result.all()
    ]


@router.get("/tracked-companies")
async def get_tracked_companies():
    """List companies we actively track for insider trades."""
    return TRACKED_COMPANIES


@router.post("/ingest")
async def trigger_insider_ingestion():
    """Manually trigger insider trade ingestion."""
    return await run_insider_ingestion()
