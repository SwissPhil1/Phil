"""API routes for Polymarket and Kalshi prediction market data."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    KalshiMarket,
    PolymarketPosition,
    PolymarketTrade,
    PolymarketTrader,
    get_db,
)
from app.services.prediction_markets import run_kalshi_ingestion, run_polymarket_ingestion

router = APIRouter(prefix="/prediction-markets", tags=["Prediction Markets"])


# --- Polymarket ---


@router.get("/polymarket/leaderboard")
async def get_polymarket_leaderboard(
    sort_by: str = Query(default="pnl_month", regex="^(pnl_all|pnl_month|pnl_week|volume_all|portfolio_value)$"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get top Polymarket traders ranked by PnL or volume."""
    stmt = select(PolymarketTrader)

    if sort_by == "pnl_all":
        stmt = stmt.where(PolymarketTrader.pnl_all.isnot(None)).order_by(PolymarketTrader.pnl_all.desc())
    elif sort_by == "pnl_month":
        stmt = stmt.where(PolymarketTrader.pnl_month.isnot(None)).order_by(PolymarketTrader.pnl_month.desc())
    elif sort_by == "pnl_week":
        stmt = stmt.where(PolymarketTrader.pnl_week.isnot(None)).order_by(PolymarketTrader.pnl_week.desc())
    elif sort_by == "volume_all":
        stmt = stmt.where(PolymarketTrader.volume_all.isnot(None)).order_by(PolymarketTrader.volume_all.desc())
    elif sort_by == "portfolio_value":
        stmt = stmt.where(PolymarketTrader.portfolio_value.isnot(None)).order_by(PolymarketTrader.portfolio_value.desc())

    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    traders = result.scalars().all()

    return [
        {
            "wallet": t.wallet,
            "username": t.username,
            "x_username": t.x_username,
            "verified": t.verified,
            "pnl_all": t.pnl_all,
            "pnl_month": t.pnl_month,
            "pnl_week": t.pnl_week,
            "volume_all": t.volume_all,
            "portfolio_value": t.portfolio_value,
            "rank_all": t.rank_all,
            "rank_month": t.rank_month,
        }
        for t in traders
    ]


@router.get("/polymarket/traders/{wallet}")
async def get_trader_detail(wallet: str, db: AsyncSession = Depends(get_db)):
    """Get detailed info for a specific Polymarket trader including positions."""
    trader = await db.execute(
        select(PolymarketTrader).where(PolymarketTrader.wallet == wallet)
    )
    trader_obj = trader.scalar_one_or_none()
    if not trader_obj:
        raise HTTPException(status_code=404, detail="Trader not found")

    # Get positions
    positions = await db.execute(
        select(PolymarketPosition)
        .where(PolymarketPosition.wallet == wallet)
        .order_by(PolymarketPosition.current_value.desc())
    )
    pos_list = positions.scalars().all()

    # Get recent trades
    trades = await db.execute(
        select(PolymarketTrade)
        .where(PolymarketTrade.wallet == wallet)
        .order_by(PolymarketTrade.timestamp.desc())
        .limit(50)
    )
    trade_list = trades.scalars().all()

    return {
        "trader": {
            "wallet": trader_obj.wallet,
            "username": trader_obj.username,
            "x_username": trader_obj.x_username,
            "pnl_all": trader_obj.pnl_all,
            "pnl_month": trader_obj.pnl_month,
            "portfolio_value": trader_obj.portfolio_value,
            "rank_month": trader_obj.rank_month,
        },
        "positions": [
            {
                "market": p.market_title,
                "slug": p.market_slug,
                "outcome": p.outcome,
                "size": p.size,
                "avg_price": p.avg_price,
                "current_price": p.current_price,
                "initial_value": p.initial_value,
                "current_value": p.current_value,
                "pnl": p.cash_pnl,
                "pnl_pct": p.percent_pnl,
                "end_date": p.end_date,
            }
            for p in pos_list
        ],
        "recent_trades": [
            {
                "side": t.side,
                "market": t.market_title,
                "outcome": t.outcome,
                "size": t.size,
                "price": t.price,
                "timestamp": t.timestamp,
                "tx_hash": t.tx_hash,
            }
            for t in trade_list
        ],
    }


@router.get("/polymarket/positions")
async def get_top_positions(
    min_value: float = Query(default=10000, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get largest open positions across all tracked traders (whale watching)."""
    stmt = (
        select(PolymarketPosition)
        .where(PolymarketPosition.current_value >= min_value)
        .order_by(PolymarketPosition.current_value.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    positions = result.scalars().all()

    return [
        {
            "wallet": p.wallet,
            "market": p.market_title,
            "outcome": p.outcome,
            "size": p.size,
            "avg_price": p.avg_price,
            "current_price": p.current_price,
            "current_value": p.current_value,
            "pnl": p.cash_pnl,
            "pnl_pct": p.percent_pnl,
        }
        for p in positions
    ]


# --- Kalshi ---


@router.get("/kalshi/markets")
async def get_kalshi_markets(
    search: str | None = None,
    sort_by: str = Query(default="volume", regex="^(volume|liquidity|last_price|close_time)$"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get active Kalshi markets."""
    stmt = select(KalshiMarket).where(KalshiMarket.status.in_(["open", "active"]))

    if search:
        stmt = stmt.where(KalshiMarket.title.ilike(f"%{search}%"))

    if sort_by == "volume":
        stmt = stmt.order_by(KalshiMarket.volume.desc())
    elif sort_by == "liquidity":
        stmt = stmt.order_by(KalshiMarket.liquidity.desc())
    elif sort_by == "last_price":
        stmt = stmt.order_by(KalshiMarket.last_price.desc())
    elif sort_by == "close_time":
        stmt = stmt.order_by(KalshiMarket.close_time.asc())

    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    markets = result.scalars().all()

    return [
        {
            "ticker": m.ticker,
            "event_ticker": m.event_ticker,
            "title": m.title,
            "last_price": m.last_price,
            "yes_bid": m.yes_bid,
            "yes_ask": m.yes_ask,
            "volume": m.volume,
            "open_interest": m.open_interest,
            "liquidity": m.liquidity,
            "close_time": m.close_time,
        }
        for m in markets
    ]


# --- Admin ---


@router.post("/polymarket/ingest")
async def trigger_polymarket_ingestion():
    """Manually trigger Polymarket leaderboard + trader data ingestion."""
    return await run_polymarket_ingestion()


@router.post("/kalshi/ingest")
async def trigger_kalshi_ingestion():
    """Manually trigger Kalshi market data ingestion."""
    return await run_kalshi_ingestion()
