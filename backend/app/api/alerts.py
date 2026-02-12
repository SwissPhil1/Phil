"""API routes for Alerts system - configuration, checking, and history."""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade, InsiderTrade, get_db
from app.models.schemas import AlertConfig, NewTradeAlert
from app.services.alerts import check_and_generate_alerts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["Alerts"])


def _trade_date_filter(since: datetime):
    """Match trades where ANY date (disclosure, tx, or created) is recent."""
    return or_(
        Trade.disclosure_date >= since,
        Trade.tx_date >= since,
        Trade.created_at >= since,
    )


def _insider_date_filter(since: datetime):
    """Match insider trades where ANY date (filing, tx, or created) is recent."""
    return or_(
        InsiderTrade.filing_date >= since,
        InsiderTrade.tx_date >= since,
        InsiderTrade.created_at >= since,
    )


@router.get("/recent")
async def get_recent_alerts(
    hours: int = Query(default=24, ge=1, le=8760),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get recent trade alerts from the last N hours (default 24h).

    Returns trades disclosed, transacted, or ingested recently.
    Includes both congressional trades and insider trades.
    """
    since = datetime.utcnow() - timedelta(hours=hours)

    # Congressional trades - match on any available date
    congress_stmt = (
        select(Trade)
        .where(_trade_date_filter(since))
        .where(Trade.ticker.isnot(None))
        .order_by(func.coalesce(Trade.disclosure_date, Trade.tx_date, Trade.created_at).desc())
        .limit(limit)
    )
    congress_result = await db.execute(congress_stmt)
    congress_trades = congress_result.scalars().all()

    # Insider trades
    insider_stmt = (
        select(InsiderTrade)
        .where(_insider_date_filter(since))
        .where(InsiderTrade.ticker.isnot(None))
        .order_by(func.coalesce(InsiderTrade.filing_date, InsiderTrade.tx_date, InsiderTrade.created_at).desc())
        .limit(limit)
    )
    insider_result = await db.execute(insider_stmt)
    insider_trades = insider_result.scalars().all()

    alerts = []
    for t in congress_trades:
        action = "bought" if t.tx_type == "purchase" else "sold"
        amount_str = ""
        if t.amount_low:
            amount_str = f" (${t.amount_low:,.0f}+)"
        alerts.append({
            "id": f"congress-{t.id}",
            "source": "congress",
            "politician": t.politician,
            "party": t.party,
            "state": t.state,
            "ticker": t.ticker,
            "action": action,
            "tx_type": t.tx_type,
            "amount_low": t.amount_low,
            "amount_high": t.amount_high,
            "tx_date": t.tx_date.isoformat() if t.tx_date else None,
            "disclosure_date": t.disclosure_date.isoformat() if t.disclosure_date else None,
            "description": f"{t.politician} ({t.party or '?'}) {action} {t.ticker}{amount_str}",
            "return_since": t.return_since_disclosure,
        })

    for t in insider_trades:
        action = "bought" if t.tx_type == "purchase" else "sold"
        value_str = f" (${t.total_value:,.0f})" if t.total_value else ""
        alerts.append({
            "id": f"insider-{t.id}",
            "source": "insider",
            "politician": t.insider_name,
            "party": None,
            "state": None,
            "ticker": t.ticker,
            "action": action,
            "tx_type": t.tx_type,
            "amount_low": t.total_value,
            "amount_high": None,
            "tx_date": t.tx_date.isoformat() if t.tx_date else None,
            "disclosure_date": t.filing_date.isoformat() if t.filing_date else None,
            "description": f"{t.insider_name} ({t.insider_title or 'Insider'}) {action} {t.ticker}{value_str}",
            "return_since": t.return_since_filing,
        })

    # Sort all alerts by most relevant date
    alerts.sort(key=lambda a: a.get("disclosure_date") or a.get("tx_date") or "", reverse=True)
    return {"alerts": alerts[:limit], "total": len(alerts), "hours": hours}


@router.post("/check")
async def check_alerts(config: AlertConfig | None = None):
    """Check for new un-notified trades matching alert configuration."""
    return await check_and_generate_alerts(config)


@router.get("/summary")
async def alerts_summary(db: AsyncSession = Depends(get_db)):
    """Get a summary of alert-worthy activity over various time periods."""
    now = datetime.utcnow()

    periods = {
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
    }

    result = {}
    for label, delta in periods.items():
        since = now - delta
        congress_count = (await db.execute(
            select(func.count()).select_from(Trade)
            .where(_trade_date_filter(since))
            .where(Trade.ticker.isnot(None))
        )).scalar() or 0

        insider_count = (await db.execute(
            select(func.count()).select_from(InsiderTrade)
            .where(_insider_date_filter(since))
            .where(InsiderTrade.ticker.isnot(None))
        )).scalar() or 0

        result[label] = {
            "congress_trades": congress_count,
            "insider_trades": insider_count,
            "total": congress_count + insider_count,
        }

    # Most active tickers in last 24h (by any date)
    since_24h = now - timedelta(hours=24)
    hot_tickers = await db.execute(
        select(Trade.ticker, func.count().label("count"))
        .where(_trade_date_filter(since_24h))
        .where(Trade.ticker.isnot(None))
        .group_by(Trade.ticker)
        .order_by(func.count().desc())
        .limit(5)
    )

    return {
        "periods": result,
        "hot_tickers_24h": [
            {"ticker": r.ticker, "count": r.count}
            for r in hot_tickers.all()
        ],
    }


@router.get("/feed")
async def get_activity_feed(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    source: str | None = Query(default=None, description="Filter by source: congress, insider"),
    ticker: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Get a unified activity feed of all trade disclosures across all sources.

    This powers the notifications/activity page.
    """
    activities = []
    offset = (page - 1) * page_size

    if source is None or source == "congress":
        stmt = (
            select(Trade)
            .where(Trade.ticker.isnot(None))
        )
        if ticker:
            stmt = stmt.where(Trade.ticker == ticker.upper())
        stmt = stmt.order_by(
            func.coalesce(Trade.disclosure_date, Trade.tx_date, Trade.created_at).desc()
        ).offset(offset).limit(page_size)
        result = await db.execute(stmt)
        for t in result.scalars().all():
            action = "bought" if t.tx_type == "purchase" else "sold"
            activities.append({
                "id": f"c-{t.id}",
                "source": "congress",
                "actor": t.politician,
                "actor_detail": f"{t.party or '?'}-{t.state or '?'}",
                "action": action,
                "ticker": t.ticker,
                "description": t.asset_description,
                "amount_low": t.amount_low,
                "amount_high": t.amount_high,
                "date": (t.disclosure_date or t.tx_date or t.created_at).isoformat() if (t.disclosure_date or t.tx_date or t.created_at) else None,
                "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                "return_pct": t.return_since_disclosure,
                "price_at_trade": t.price_at_disclosure,
                "price_current": t.price_current,
            })

    if source is None or source == "insider":
        stmt = (
            select(InsiderTrade)
            .where(InsiderTrade.ticker.isnot(None))
        )
        if ticker:
            stmt = stmt.where(InsiderTrade.ticker == ticker.upper())
        stmt = stmt.order_by(
            func.coalesce(InsiderTrade.filing_date, InsiderTrade.tx_date, InsiderTrade.created_at).desc()
        ).offset(offset).limit(page_size)
        result = await db.execute(stmt)
        for t in result.scalars().all():
            action = "bought" if t.tx_type == "purchase" else "sold"
            activities.append({
                "id": f"i-{t.id}",
                "source": "insider",
                "actor": t.insider_name,
                "actor_detail": t.insider_title or "Corporate Insider",
                "action": action,
                "ticker": t.ticker,
                "description": t.issuer_name,
                "amount_low": t.total_value,
                "amount_high": None,
                "date": (t.filing_date or t.tx_date or t.created_at).isoformat() if (t.filing_date or t.tx_date or t.created_at) else None,
                "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                "return_pct": t.return_since_filing,
                "price_at_trade": t.price_per_share,
                "price_current": t.price_current,
            })

    # Sort by date
    activities.sort(key=lambda a: a.get("date") or "", reverse=True)
    return {
        "activities": activities[:page_size],
        "page": page,
        "page_size": page_size,
    }
