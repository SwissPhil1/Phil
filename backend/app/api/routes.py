"""API routes for the Congress Trades app."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Politician, Trade, get_db
from app.models.schemas import (
    AlertConfig,
    NewTradeAlert,
    PoliticianDetail,
    PoliticianResponse,
    StatsResponse,
    TradeResponse,
)
from app.services.alerts import check_and_generate_alerts
from app.services.ingestion import run_ingestion
from app.services.performance import run_performance_update


def _trade_to_response(t: Trade) -> TradeResponse:
    """Convert a Trade ORM object to a TradeResponse with all fields."""
    return TradeResponse(
        id=t.id,
        chamber=t.chamber,
        politician=t.politician,
        party=t.party,
        state=t.state,
        ticker=t.ticker,
        asset_description=t.asset_description,
        tx_type=t.tx_type,
        tx_date=t.tx_date,
        disclosure_date=t.disclosure_date,
        amount_low=t.amount_low,
        amount_high=t.amount_high,
        price_at_disclosure=t.price_at_disclosure,
        price_current=t.price_current,
        return_since_disclosure=t.return_since_disclosure,
        disclosure_delay_days=(
            (t.disclosure_date - t.tx_date).days
            if t.disclosure_date and t.tx_date else None
        ),
    )

router = APIRouter()


# --- Trades ---


@router.get("/trades", response_model=list[TradeResponse])
async def get_trades(
    chamber: str | None = None,
    politician: str | None = None,
    party: str | None = None,
    state: str | None = None,
    ticker: str | None = None,
    tx_type: str | None = None,
    days: int = Query(default=90, ge=1, le=3650),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get trades with optional filters."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = select(Trade).where(Trade.disclosure_date >= since)

    if chamber:
        stmt = stmt.where(Trade.chamber == chamber.lower())
    if politician:
        stmt = stmt.where(Trade.politician.ilike(f"%{politician}%"))
    if party:
        stmt = stmt.where(Trade.party == party.upper())
    if state:
        stmt = stmt.where(Trade.state == state.upper())
    if ticker:
        stmt = stmt.where(Trade.ticker == ticker.upper())
    if tx_type:
        stmt = stmt.where(Trade.tx_type == tx_type.lower())

    stmt = stmt.order_by(Trade.disclosure_date.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(stmt)
    trades = result.scalars().all()

    return [
        TradeResponse(
            id=t.id,
            chamber=t.chamber,
            politician=t.politician,
            party=t.party,
            state=t.state,
            ticker=t.ticker,
            asset_description=t.asset_description,
            tx_type=t.tx_type,
            tx_date=t.tx_date,
            disclosure_date=t.disclosure_date,
            amount_low=t.amount_low,
            amount_high=t.amount_high,
            price_at_disclosure=t.price_at_disclosure,
            return_since_disclosure=t.return_since_disclosure,
            disclosure_delay_days=(
                (t.disclosure_date - t.tx_date).days
                if t.disclosure_date and t.tx_date
                else None
            ),
        )
        for t in trades
    ]


@router.get("/trades/recent", response_model=list[TradeResponse])
async def get_recent_trades(
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recently disclosed trades."""
    stmt = (
        select(Trade)
        .where(Trade.ticker.isnot(None))
        .order_by(Trade.disclosure_date.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    trades = result.scalars().all()

    return [
        TradeResponse(
            id=t.id,
            chamber=t.chamber,
            politician=t.politician,
            party=t.party,
            state=t.state,
            ticker=t.ticker,
            asset_description=t.asset_description,
            tx_type=t.tx_type,
            tx_date=t.tx_date,
            disclosure_date=t.disclosure_date,
            amount_low=t.amount_low,
            amount_high=t.amount_high,
            price_at_disclosure=t.price_at_disclosure,
            return_since_disclosure=t.return_since_disclosure,
            disclosure_delay_days=(
                (t.disclosure_date - t.tx_date).days
                if t.disclosure_date and t.tx_date
                else None
            ),
        )
        for t in trades
    ]


# --- Politicians ---


@router.get("/politicians", response_model=list[PoliticianResponse])
async def get_politicians(
    chamber: str | None = None,
    party: str | None = None,
    sort_by: str = Query(default="total_trades", regex="^(total_trades|avg_return|win_rate)$"),
    min_trades: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List politicians with their trading stats."""
    stmt = select(Politician).where(Politician.total_trades >= min_trades)

    if chamber:
        stmt = stmt.where(Politician.chamber == chamber.lower())
    if party:
        stmt = stmt.where(Politician.party == party.upper())

    if sort_by == "avg_return":
        stmt = stmt.where(Politician.avg_return.isnot(None)).order_by(Politician.avg_return.desc())
    elif sort_by == "win_rate":
        stmt = stmt.where(Politician.win_rate.isnot(None)).order_by(Politician.win_rate.desc())
    else:
        stmt = stmt.order_by(Politician.total_trades.desc())

    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/politicians/rankings", response_model=list[PoliticianResponse])
async def get_rankings(
    chamber: str | None = None,
    party: str | None = None,
    min_trades: int = Query(default=5, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get politician rankings by trading performance (min 5 trades by default)."""
    stmt = (
        select(Politician)
        .where(Politician.total_trades >= min_trades)
        .where(Politician.avg_return.isnot(None))
    )

    if chamber:
        stmt = stmt.where(Politician.chamber == chamber.lower())
    if party:
        stmt = stmt.where(Politician.party == party.upper())

    stmt = stmt.order_by(Politician.avg_return.desc()).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/politicians/{name}", response_model=PoliticianDetail)
async def get_politician_detail(
    name: str,
    db: AsyncSession = Depends(get_db),
):
    """Get detailed info for a specific politician including recent trades."""
    # Try the Politician table first (has pre-computed stats)
    stmt = select(Politician).where(Politician.name.ilike(f"%{name}%"))
    result = await db.execute(stmt)
    politician = result.scalar_one_or_none()

    # Fallback: build profile from Trade data if Politician table not yet populated
    if not politician:
        trades_check = await db.execute(
            select(Trade).where(Trade.politician.ilike(f"%{name}%")).limit(1)
        )
        sample_trade = trades_check.scalar_one_or_none()
        if not sample_trade:
            raise HTTPException(status_code=404, detail=f"Politician '{name}' not found")

        # Build stats from trades directly
        pol_name = sample_trade.politician
        total = (await db.execute(
            select(func.count()).where(Trade.politician == pol_name)
        )).scalar()
        buys = (await db.execute(
            select(func.count()).where(Trade.politician == pol_name).where(Trade.tx_type == "purchase")
        )).scalar()
        sells = (await db.execute(
            select(func.count()).where(Trade.politician == pol_name).where(
                Trade.tx_type.in_(["sale", "sale_full", "sale_partial"])
            )
        )).scalar()
        last_date = (await db.execute(
            select(func.max(Trade.tx_date)).where(Trade.politician == pol_name)
        )).scalar()

        trades_stmt = (
            select(Trade)
            .where(Trade.politician == pol_name)
            .order_by(Trade.disclosure_date.desc())
            .limit(50)
        )
        trades = (await db.execute(trades_stmt)).scalars().all()

        return PoliticianDetail(
            id=0,
            name=pol_name,
            chamber=sample_trade.chamber,
            party=sample_trade.party,
            state=sample_trade.state,
            total_trades=total,
            total_buys=buys,
            total_sells=sells,
            avg_return=None,
            win_rate=None,
            last_trade_date=last_date,
            recent_trades=[_trade_to_response(t) for t in trades],
        )

    trades_stmt = (
        select(Trade)
        .where(Trade.politician == politician.name)
        .order_by(Trade.disclosure_date.desc())
        .limit(50)
    )
    trades_result = await db.execute(trades_stmt)
    trades = trades_result.scalars().all()

    return PoliticianDetail(
        id=politician.id,
        name=politician.name,
        chamber=politician.chamber,
        party=politician.party,
        state=politician.state,
        total_trades=politician.total_trades,
        total_buys=politician.total_buys,
        total_sells=politician.total_sells,
        avg_return=politician.avg_return,
        win_rate=politician.win_rate,
        last_trade_date=politician.last_trade_date,
        recent_trades=[_trade_to_response(t) for t in trades],
    )


# --- Tickers ---


@router.get("/tickers/most-traded")
async def get_most_traded_tickers(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get the most traded tickers by politicians."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(
            Trade.ticker,
            func.count().label("trade_count"),
            func.count(func.distinct(Trade.politician)).label("politician_count"),
        )
        .where(Trade.disclosure_date >= since)
        .where(Trade.ticker.isnot(None))
        .group_by(Trade.ticker)
        .order_by(func.count().desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        {"ticker": r.ticker, "trade_count": r.trade_count, "politician_count": r.politician_count}
        for r in rows
    ]


@router.get("/tickers/{ticker}/trades", response_model=list[TradeResponse])
async def get_trades_for_ticker(
    ticker: str,
    days: int = Query(default=365, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
):
    """Get all politician trades for a specific ticker."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(Trade)
        .where(Trade.ticker == ticker.upper())
        .where(Trade.disclosure_date >= since)
        .order_by(Trade.disclosure_date.desc())
    )
    result = await db.execute(stmt)
    trades = result.scalars().all()

    return [
        TradeResponse(
            id=t.id,
            chamber=t.chamber,
            politician=t.politician,
            party=t.party,
            state=t.state,
            ticker=t.ticker,
            asset_description=t.asset_description,
            tx_type=t.tx_type,
            tx_date=t.tx_date,
            disclosure_date=t.disclosure_date,
            amount_low=t.amount_low,
            amount_high=t.amount_high,
            price_at_disclosure=t.price_at_disclosure,
            return_since_disclosure=t.return_since_disclosure,
            disclosure_delay_days=(
                (t.disclosure_date - t.tx_date).days
                if t.disclosure_date and t.tx_date
                else None
            ),
        )
        for t in trades
    ]


# --- Stats ---


@router.get("/stats", response_model=StatsResponse)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Get overall dashboard stats."""
    total_trades = (await db.execute(select(func.count()).select_from(Trade))).scalar()
    total_politicians = (await db.execute(select(func.count()).select_from(Politician))).scalar()

    now = datetime.utcnow()
    trades_7d = (
        await db.execute(
            select(func.count())
            .select_from(Trade)
            .where(Trade.disclosure_date >= now - timedelta(days=7))
        )
    ).scalar()
    trades_30d = (
        await db.execute(
            select(func.count())
            .select_from(Trade)
            .where(Trade.disclosure_date >= now - timedelta(days=30))
        )
    ).scalar()

    # Most bought tickers (last 30d)
    most_bought = await db.execute(
        select(Trade.ticker, func.count().label("count"))
        .where(Trade.tx_type == "purchase")
        .where(Trade.disclosure_date >= now - timedelta(days=30))
        .where(Trade.ticker.isnot(None))
        .group_by(Trade.ticker)
        .order_by(func.count().desc())
        .limit(10)
    )
    most_bought_tickers = [{"ticker": r.ticker, "count": r.count} for r in most_bought.all()]

    # Most active politicians (last 30d)
    most_active = await db.execute(
        select(Trade.politician, Trade.party, func.count().label("count"))
        .where(Trade.disclosure_date >= now - timedelta(days=30))
        .group_by(Trade.politician, Trade.party)
        .order_by(func.count().desc())
        .limit(10)
    )
    most_active_politicians = [
        {"politician": r.politician, "party": r.party, "count": r.count}
        for r in most_active.all()
    ]

    # Party breakdown
    party_counts = await db.execute(
        select(Trade.party, func.count().label("count"))
        .group_by(Trade.party)
    )
    party_breakdown = {r.party or "Unknown": r.count for r in party_counts.all()}

    return StatsResponse(
        total_trades=total_trades or 0,
        total_politicians=total_politicians or 0,
        trades_last_7d=trades_7d or 0,
        trades_last_30d=trades_30d or 0,
        most_bought_tickers=most_bought_tickers,
        most_active_politicians=most_active_politicians,
        party_breakdown=party_breakdown,
    )


# --- Alerts ---


@router.post("/alerts/check", response_model=list[NewTradeAlert])
async def check_alerts(config: AlertConfig | None = None):
    """Check for new trades matching alert configuration."""
    return await check_and_generate_alerts(config)


# --- Admin / Ingestion ---


@router.post("/admin/ingest")
async def trigger_ingestion():
    """Manually trigger data ingestion from House & Senate sources."""
    result = await run_ingestion()
    return result


@router.post("/admin/update-prices")
async def trigger_price_update(
    limit: int = Query(default=50, ge=1, le=500),
):
    """Manually trigger price updates for trades (uses yfinance, rate-limited)."""
    result = await run_performance_update(price_limit=limit)
    return result
