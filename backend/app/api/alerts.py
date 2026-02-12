"""API routes for Alerts system - configuration, checking, and history."""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade, InsiderTrade, HedgeFundHolding, PoliticianCommittee, get_db
from app.models.schemas import AlertConfig, NewTradeAlert
from app.services.alerts import check_and_generate_alerts
from app.services.signals import (
    check_committee_overlap,
    score_trade_conviction,
    TICKER_SECTORS,
    COMMITTEE_SECTORS,
)

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
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get recent trade alerts from the last N hours (default 24h).

    Returns trades disclosed, transacted, or ingested recently.
    Includes both congressional trades and insider trades.
    Supports pagination.
    """
    since = datetime.utcnow() - timedelta(hours=hours)

    # Get total counts first
    congress_total = (await db.execute(
        select(func.count()).select_from(Trade)
        .where(_trade_date_filter(since))
        .where(Trade.ticker.isnot(None))
    )).scalar() or 0

    insider_total = (await db.execute(
        select(func.count()).select_from(InsiderTrade)
        .where(_insider_date_filter(since))
        .where(InsiderTrade.ticker.isnot(None))
    )).scalar() or 0

    total_count = congress_total + insider_total

    # Fetch both sources with generous limits to sort across sources
    fetch_limit = page * page_size + page_size  # fetch enough to paginate combined

    # Congressional trades - match on any available date
    congress_stmt = (
        select(Trade)
        .where(_trade_date_filter(since))
        .where(Trade.ticker.isnot(None))
        .order_by(func.coalesce(Trade.disclosure_date, Trade.tx_date, Trade.created_at).desc())
        .limit(fetch_limit)
    )
    congress_result = await db.execute(congress_stmt)
    congress_trades = congress_result.scalars().all()

    # Insider trades
    insider_stmt = (
        select(InsiderTrade)
        .where(_insider_date_filter(since))
        .where(InsiderTrade.ticker.isnot(None))
        .order_by(func.coalesce(InsiderTrade.filing_date, InsiderTrade.tx_date, InsiderTrade.created_at).desc())
        .limit(fetch_limit)
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

    # Paginate
    start = (page - 1) * page_size
    end = start + page_size
    page_alerts = alerts[start:end]

    return {
        "alerts": page_alerts,
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "hours": hours,
    }


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


@router.get("/suspicious")
async def get_suspicious_trades(
    days: int = Query(default=90, ge=1, le=730),
    limit: int = Query(default=100, ge=1, le=500),
    min_score: int = Query(default=10, ge=0, le=115),
    db: AsyncSession = Depends(get_db),
):
    """Identify the most suspicious/high-conviction trades using conviction scoring.

    Scores ALL recent trades (congressional + insider) using the same conviction
    scoring system from signals.py with 9 factors:
    - Position size, committee overlap, disclosure speed, political clustering,
      cross-source confirmation, historical accuracy, contrarian signal,
      size anomaly, small-cap committee bonus.

    Returns trades ranked by conviction score, highest first.
    """
    since = datetime.utcnow() - timedelta(days=days)

    # 1. Fetch congressional trades (ALL tx_types, not just purchases)
    congress_stmt = (
        select(Trade)
        .where(Trade.ticker.isnot(None))
        .where(_trade_date_filter(since))
        .order_by(func.coalesce(Trade.tx_date, Trade.disclosure_date).desc())
        .limit(2000)
    )
    congress_result = await db.execute(congress_stmt)
    congress_trades = congress_result.scalars().all()

    # 2. Fetch insider trades
    insider_stmt = (
        select(InsiderTrade)
        .where(InsiderTrade.ticker.isnot(None))
        .where(_insider_date_filter(since))
        .order_by(func.coalesce(InsiderTrade.filing_date, InsiderTrade.tx_date).desc())
        .limit(2000)
    )
    insider_result = await db.execute(insider_stmt)
    insider_trades_list = insider_result.scalars().all()

    # 3. Pre-compute batch data for scoring

    # 3a. Cluster map: ticker -> distinct politician count (all tx_types)
    cluster_stmt = (
        select(
            Trade.ticker,
            func.count(func.distinct(Trade.politician)).label("pol_count"),
        )
        .where(Trade.ticker.isnot(None))
        .where(_trade_date_filter(since))
        .group_by(Trade.ticker)
    )
    cluster_result = await db.execute(cluster_stmt)
    cluster_map = {r.ticker: r.pol_count for r in cluster_result.all()}

    # 3b. Insider buying tickers (for cross-source signal)
    insider_buying_stmt = (
        select(InsiderTrade.ticker)
        .where(InsiderTrade.tx_type == "purchase")
        .where(InsiderTrade.ticker.isnot(None))
        .where(_insider_date_filter(since))
        .distinct()
    )
    insider_buying_result = await db.execute(insider_buying_stmt)
    insider_buying_tickers = {r[0] for r in insider_buying_result.all()}

    # 3c. Fund new-position tickers
    fund_stmt = (
        select(HedgeFundHolding.ticker)
        .where(HedgeFundHolding.ticker.isnot(None))
        .where(HedgeFundHolding.is_new_position == True)
        .distinct()
    )
    fund_result = await db.execute(fund_stmt)
    fund_tickers = {r[0] for r in fund_result.all()}

    # 3d. Committee assignments per politician
    comm_stmt = select(PoliticianCommittee)
    comm_result = await db.execute(comm_stmt)
    all_committees = comm_result.scalars().all()
    politician_committees: dict[str, list[str]] = {}
    for c in all_committees:
        name = c.politician_name or ""
        comm_name = c.committee_name or c.committee_id or ""
        politician_committees.setdefault(name, []).append(comm_name)

    # 3e. Batch track records (single query instead of N)
    politician_names = {t.politician for t in congress_trades}
    politician_track_records: dict[str, dict] = {}
    if politician_names:
        try:
            track_stmt = (
                select(
                    Trade.politician,
                    func.count().label("total"),
                    func.avg(Trade.return_since_disclosure).label("avg_return"),
                    func.sum(
                        case((Trade.return_since_disclosure > 0, 1), else_=0)
                    ).label("wins"),
                )
                .where(Trade.politician.in_(list(politician_names)))
                .where(Trade.tx_type == "purchase")
                .where(Trade.return_since_disclosure.isnot(None))
                .group_by(Trade.politician)
            )
            track_result = await db.execute(track_stmt)
            for row in track_result.all():
                if row.total and row.total > 0:
                    politician_track_records[row.politician] = {
                        "total": row.total,
                        "avg_return": float(row.avg_return) if row.avg_return else 0,
                        "win_rate": float(row.wins / row.total * 100),
                    }
        except Exception as e:
            logger.warning(f"Failed to load track records: {e}")

    # 3f. Recent sells per ticker (for contrarian signal)
    sell_stmt = (
        select(
            Trade.ticker,
            func.count(func.distinct(Trade.politician)).label("sell_count"),
        )
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
        .where(_trade_date_filter(since))
        .group_by(Trade.ticker)
    )
    sell_result = await db.execute(sell_stmt)
    recent_sells_map = {r.ticker: r.sell_count for r in sell_result.all()}

    # 4. Score each trade using the conviction scoring system

    scored_trades = []

    # Score congressional trades
    for t in congress_trades:
        delay = (
            (t.disclosure_date - t.tx_date).days
            if t.disclosure_date and t.tx_date else None
        )
        trade_dict = {
            "ticker": t.ticker,
            "tx_type": t.tx_type,
            "amount_low": t.amount_low,
            "disclosure_delay_days": delay,
        }
        result = score_trade_conviction(
            trade=trade_dict,
            committees=politician_committees.get(t.politician) or None,
            cluster_count=cluster_map.get(t.ticker, 0),
            insider_also_buying=t.ticker in insider_buying_tickers,
            fund_also_holds=t.ticker in fund_tickers,
            politician_track_record=politician_track_records.get(t.politician),
            recent_sells_count=recent_sells_map.get(t.ticker, 0),
        )

        if result["score"] >= min_score:
            action = "bought" if t.tx_type == "purchase" else "sold"
            scored_trades.append({
                "id": f"congress-{t.id}",
                "source": "congress",
                "politician": t.politician,
                "party": t.party,
                "state": t.state,
                "ticker": t.ticker,
                "asset_description": t.asset_description,
                "amount_low": t.amount_low,
                "amount_high": t.amount_high,
                "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                "disclosure_date": t.disclosure_date.isoformat() if t.disclosure_date else None,
                "disclosure_delay_days": delay,
                "tx_type": t.tx_type,
                "action": action,
                "return_since": t.return_since_disclosure,
                "conviction_score": result["score"],
                "conviction_rating": result["rating"],
                "factors": result["factors"],
                "committee_overlap": result["committee_overlap"],
                "cluster_count": cluster_map.get(t.ticker, 0),
                "insider_also_buying": t.ticker in insider_buying_tickers,
                "fund_also_holds": t.ticker in fund_tickers,
            })

    # Score insider trades
    for t in insider_trades_list:
        delay = (
            (t.filing_date - t.tx_date).days
            if t.filing_date and t.tx_date else None
        )
        trade_dict = {
            "ticker": t.ticker,
            "tx_type": t.tx_type,
            "amount_low": t.total_value,
            "disclosure_delay_days": delay,
        }
        result = score_trade_conviction(
            trade=trade_dict,
            committees=None,
            cluster_count=cluster_map.get(t.ticker, 0),
            insider_also_buying=t.ticker in insider_buying_tickers,
            fund_also_holds=t.ticker in fund_tickers,
            politician_track_record=None,
            recent_sells_count=recent_sells_map.get(t.ticker, 0),
        )

        if result["score"] >= min_score:
            action = "bought" if t.tx_type == "purchase" else "sold"
            scored_trades.append({
                "id": f"insider-{t.id}",
                "source": "insider",
                "politician": t.insider_name,
                "party": None,
                "state": None,
                "ticker": t.ticker,
                "asset_description": t.issuer_name,
                "amount_low": t.total_value,
                "amount_high": None,
                "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                "disclosure_date": t.filing_date.isoformat() if t.filing_date else None,
                "disclosure_delay_days": delay,
                "tx_type": t.tx_type,
                "action": action,
                "return_since": t.return_since_filing,
                "conviction_score": result["score"],
                "conviction_rating": result["rating"],
                "factors": result["factors"],
                "committee_overlap": result["committee_overlap"],
                "cluster_count": cluster_map.get(t.ticker, 0),
                "insider_also_buying": t.ticker in insider_buying_tickers,
                "fund_also_holds": t.ticker in fund_tickers,
            })

    # Sort by conviction score (highest first)
    scored_trades.sort(key=lambda x: x["conviction_score"], reverse=True)
    return {
        "trades": scored_trades[:limit],
        "total": len(scored_trades),
        "days_checked": days,
    }
