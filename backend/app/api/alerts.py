"""API routes for Alerts system - configuration, checking, and history."""

import logging
from bisect import bisect_left
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Trade, InsiderTrade, HedgeFundHolding, PoliticianCommittee,
    TickerPrice, TickerCurrentPrice, get_db,
)
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
    """Match trades where disclosure or tx date is recent."""
    return or_(
        Trade.disclosure_date >= since,
        Trade.tx_date >= since,
    )


def _insider_date_filter(since: datetime):
    """Match insider trades where filing or tx date is recent."""
    return or_(
        InsiderTrade.filing_date >= since,
        InsiderTrade.tx_date >= since,
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
        "congress_total": congress_total,
        "insider_total": insider_total,
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
    min_score: int = Query(default=10, ge=0, le=100),
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

    # 3g. Leadership roles per politician
    lead_result = await db.execute(
        select(PoliticianCommittee.politician_name, PoliticianCommittee.role)
        .where(PoliticianCommittee.role.isnot(None))
        .where(PoliticianCommittee.role != "Member")
    )
    leadership_map: dict[str, str] = {}
    for r in lead_result.all():
        existing = leadership_map.get(r.politician_name, "")
        if "Chair" in (r.role or "") and "Chair" not in existing:
            leadership_map[r.politician_name] = r.role
        elif "Ranking" in (r.role or "") and not existing:
            leadership_map[r.politician_name] = r.role

    # 3h. Repeated buyer counts (politician+ticker)
    repeat_result = await db.execute(
        select(Trade.politician, Trade.ticker, func.count().label("buy_count"))
        .where(Trade.tx_type == "purchase")
        .where(Trade.ticker.isnot(None))
        .where(_trade_date_filter(since))
        .group_by(Trade.politician, Trade.ticker)
    )
    repeated_buyers = {(r.politician, r.ticker): r.buy_count for r in repeat_result.all()}

    # 3i. Median trade amounts per politician
    amount_result = await db.execute(
        select(Trade.politician, Trade.amount_low)
        .where(Trade.tx_type == "purchase")
        .where(Trade.amount_low.isnot(None))
        .where(Trade.amount_low > 0)
    )
    pol_amounts: dict[str, list[float]] = defaultdict(list)
    for row in amount_result.all():
        pol_amounts[row.politician].append(row.amount_low)
    median_amounts: dict[str, float] = {}
    for pol, amounts in pol_amounts.items():
        sorted_amounts = sorted(amounts)
        median_amounts[pol] = sorted_amounts[len(sorted_amounts) // 2]

    # 3j. C-suite insider tickers (officer-level buys)
    officer_result = await db.execute(
        select(InsiderTrade.ticker)
        .where(InsiderTrade.tx_type == "purchase")
        .where(InsiderTrade.ticker.isnot(None))
        .where(InsiderTrade.is_officer == True)
        .where(_insider_date_filter(since))
        .distinct()
    )
    insider_officer_tickers = {r[0] for r in officer_result.all()}

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
            leadership_role=leadership_map.get(t.politician),
            repeated_buy_count=repeated_buyers.get((t.politician, t.ticker), 0),
            relative_size_ratio=(
                (t.amount_low or 0) / median_amounts[t.politician]
                if t.politician in median_amounts and median_amounts[t.politician] > 0 and (t.amount_low or 0) > 0
                else None
            ),
            insider_is_officer=t.ticker in insider_officer_tickers,
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
            insider_is_officer=t.ticker in insider_officer_tickers,
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


@router.get("/conviction-portfolio")
async def conviction_portfolio_sim(
    min_score: int = Query(default=50, ge=0, le=100),
    days: int = Query(default=1825, ge=30, le=3650),
    initial_capital: float = Query(default=10000, ge=1000, le=10_000_000),
    max_positions: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Simulate a fixed-capital copy-trade portfolio.

    Starts with initial_capital, allocates capital / max_positions per position.
    Buys when a high-conviction trade signal fires, sells when the original
    trader sells. Cash from sells funds future buys (compounding). Trades are
    skipped when cash is insufficient or max concurrent positions reached.
    Returns a weekly NAV series for equity curve charting.

    Uses stored DB prices (TickerPrice cache + Trade.price_at_disclosure) —
    no external API calls during the request.
    """
    since = datetime.utcnow() - timedelta(days=days)
    now = datetime.utcnow()
    position_size = initial_capital / max_positions

    # ── 1. Fetch all trades (buys + sells) ──
    congress_stmt = (
        select(Trade)
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_date >= since)
        .order_by(Trade.tx_date.asc())
    )
    congress_result = await db.execute(congress_stmt)
    all_congress = congress_result.scalars().all()

    insider_stmt = (
        select(InsiderTrade)
        .where(InsiderTrade.ticker.isnot(None))
        .where(InsiderTrade.tx_date >= since)
        .order_by(InsiderTrade.tx_date.asc())
    )
    insider_result = await db.execute(insider_stmt)
    all_insiders = insider_result.scalars().all()

    logger.info(f"Portfolio sim: {len(all_congress)} congress + {len(all_insiders)} insider trades loaded")

    # ── 2. Build price infrastructure (DB-only, no Yahoo calls) ──
    all_tickers = set()
    for t in all_congress:
        if t.ticker:
            all_tickers.add(t.ticker)
    for t in all_insiders:
        if t.ticker:
            all_tickers.add(t.ticker)

    historical_prices: dict[tuple[str, str], float] = {}

    # TickerPrice cache (weekly Yahoo data, pre-populated by scheduled jobs)
    if all_tickers:
        tp_stmt = (
            select(TickerPrice.ticker, TickerPrice.date, TickerPrice.close_price)
            .where(TickerPrice.ticker.in_(list(all_tickers)))
        )
        tp_result = await db.execute(tp_stmt)
        for row in tp_result:
            historical_prices[(row.ticker, row.date)] = row.close_price

    # Trade.price_at_disclosure — exact trade-date prices (highest priority)
    for t in all_congress:
        if t.price_at_disclosure and t.price_at_disclosure > 0 and t.ticker and t.tx_date:
            historical_prices[(t.ticker, t.tx_date.isoformat()[:10])] = t.price_at_disclosure

    # Insider trade prices
    for t in all_insiders:
        if hasattr(t, "price_per_share") and t.price_per_share and t.price_per_share > 0 and t.ticker and t.tx_date:
            historical_prices[(t.ticker, t.tx_date.isoformat()[:10])] = t.price_per_share

    # Current prices
    current_prices: dict[str, float] = {}
    if all_tickers:
        cp_result = await db.execute(
            select(TickerCurrentPrice.ticker, TickerCurrentPrice.price)
            .where(TickerCurrentPrice.ticker.in_(list(all_tickers)))
        )
        for row in cp_result:
            current_prices[row.ticker] = row.price

    # Fallback from Trade/InsiderTrade price_current
    for t in all_congress:
        if t.ticker and t.price_current and t.ticker not in current_prices:
            current_prices[t.ticker] = t.price_current
    for t in all_insiders:
        if t.ticker and t.price_current and t.ticker not in current_prices:
            current_prices[t.ticker] = t.price_current

    # Build per-ticker sorted timeline for nearest-date matching
    ticker_timeline: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for (tk, ds), px in historical_prices.items():
        ticker_timeline[tk].append((ds, px))
    for tk in ticker_timeline:
        ticker_timeline[tk].sort()

    today_str = now.isoformat()[:10]

    def get_price(ticker: str, date: datetime) -> float | None:
        date_str = date.isoformat()[:10]
        exact = historical_prices.get((ticker, date_str))
        if exact:
            return exact
        if date_str >= today_str:
            return current_prices.get(ticker)
        timeline = ticker_timeline.get(ticker)
        if timeline:
            dates_list = [h[0] for h in timeline]
            idx = bisect_left(dates_list, date_str)
            best, best_diff = None, float("inf")
            for i in [idx - 1, idx]:
                if 0 <= i < len(timeline):
                    try:
                        d_ts = datetime.fromisoformat(timeline[i][0]).timestamp()
                        diff = abs(d_ts - date.timestamp())
                        if diff < best_diff:
                            best_diff = diff
                            best = timeline[i][1]
                    except Exception:
                        pass
            if best is not None and best_diff < 180 * 86400:
                return best
        return None

    # ── 3. Pre-compute scoring data ──
    cluster_stmt = (
        select(Trade.ticker, func.count(func.distinct(Trade.politician)).label("pol_count"))
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_date >= since)
        .group_by(Trade.ticker)
    )
    cluster_result_q = await db.execute(cluster_stmt)
    cluster_map = {r.ticker: r.pol_count for r in cluster_result_q.all()}

    insider_buying_stmt = (
        select(InsiderTrade.ticker)
        .where(InsiderTrade.tx_type == "purchase")
        .where(InsiderTrade.ticker.isnot(None))
        .where(InsiderTrade.tx_date >= since)
        .distinct()
    )
    insider_buying_result = await db.execute(insider_buying_stmt)
    insider_buying_tickers = {r[0] for r in insider_buying_result.all()}

    fund_stmt = (
        select(HedgeFundHolding.ticker)
        .where(HedgeFundHolding.ticker.isnot(None))
        .where(HedgeFundHolding.is_new_position == True)
        .distinct()
    )
    fund_result_q = await db.execute(fund_stmt)
    fund_tickers = {r[0] for r in fund_result_q.all()}

    comm_result_q = await db.execute(select(PoliticianCommittee))
    all_committees = comm_result_q.scalars().all()
    politician_committees: dict[str, list[str]] = {}
    for c in all_committees:
        name = c.politician_name or ""
        comm_name = c.committee_name or c.committee_id or ""
        politician_committees.setdefault(name, []).append(comm_name)

    politician_names = {t.politician for t in all_congress if t.tx_type == "purchase"}
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
            track_result_q = await db.execute(track_stmt)
            for row in track_result_q.all():
                if row.total and row.total > 0:
                    politician_track_records[row.politician] = {
                        "total": row.total,
                        "avg_return": float(row.avg_return) if row.avg_return else 0,
                        "win_rate": float(row.wins / row.total * 100),
                    }
        except Exception as e:
            logger.warning(f"Failed to load track records for portfolio sim: {e}")

    sell_stmt = (
        select(Trade.ticker, func.count(func.distinct(Trade.politician)).label("sell_count"))
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
        .where(Trade.tx_date >= since)
        .group_by(Trade.ticker)
    )
    sell_result_q = await db.execute(sell_stmt)
    recent_sells_map = {r.ticker: r.sell_count for r in sell_result_q.all()}

    # Leadership roles
    lead_result_q = await db.execute(
        select(PoliticianCommittee.politician_name, PoliticianCommittee.role)
        .where(PoliticianCommittee.role.isnot(None))
        .where(PoliticianCommittee.role != "Member")
    )
    leadership_map: dict[str, str] = {}
    for r in lead_result_q.all():
        existing = leadership_map.get(r.politician_name, "")
        if "Chair" in (r.role or "") and "Chair" not in existing:
            leadership_map[r.politician_name] = r.role
        elif "Ranking" in (r.role or "") and not existing:
            leadership_map[r.politician_name] = r.role

    # Repeated buyer counts
    repeat_result_q = await db.execute(
        select(Trade.politician, Trade.ticker, func.count().label("buy_count"))
        .where(Trade.tx_type == "purchase")
        .where(Trade.ticker.isnot(None))
        .where(Trade.tx_date >= since)
        .group_by(Trade.politician, Trade.ticker)
    )
    repeated_buyers = {(r.politician, r.ticker): r.buy_count for r in repeat_result_q.all()}

    # Median trade amounts
    amount_result_q = await db.execute(
        select(Trade.politician, Trade.amount_low)
        .where(Trade.tx_type == "purchase")
        .where(Trade.amount_low.isnot(None))
        .where(Trade.amount_low > 0)
    )
    pol_amounts: dict[str, list[float]] = defaultdict(list)
    for row in amount_result_q.all():
        pol_amounts[row.politician].append(row.amount_low)
    median_amounts: dict[str, float] = {}
    for pol, amounts in pol_amounts.items():
        sorted_amounts = sorted(amounts)
        median_amounts[pol] = sorted_amounts[len(sorted_amounts) // 2]

    # C-suite insider tickers
    officer_result_q = await db.execute(
        select(InsiderTrade.ticker)
        .where(InsiderTrade.tx_type == "purchase")
        .where(InsiderTrade.ticker.isnot(None))
        .where(InsiderTrade.is_officer == True)
        .where(InsiderTrade.tx_date >= since)
        .distinct()
    )
    insider_officer_tickers = {r[0] for r in officer_result_q.all()}

    # ── 4. Build unified chronological trade events ──
    events: list[dict] = []
    skipped_no_cash = 0
    skipped_max_pos = 0

    # Score and add congress buys + all sells
    for t in all_congress:
        if not t.tx_date or not t.ticker:
            continue
        if t.tx_type == "purchase":
            delay = (
                (t.disclosure_date - t.tx_date).days
                if t.disclosure_date and t.tx_date else None
            )
            result = score_trade_conviction(
                trade={
                    "ticker": t.ticker,
                    "tx_type": t.tx_type,
                    "amount_low": t.amount_low,
                    "disclosure_delay_days": delay,
                },
                committees=politician_committees.get(t.politician),
                cluster_count=cluster_map.get(t.ticker, 0),
                insider_also_buying=t.ticker in insider_buying_tickers,
                fund_also_holds=t.ticker in fund_tickers,
                politician_track_record=politician_track_records.get(t.politician),
                recent_sells_count=recent_sells_map.get(t.ticker, 0),
                leadership_role=leadership_map.get(t.politician),
                repeated_buy_count=repeated_buyers.get((t.politician, t.ticker), 0),
                relative_size_ratio=(
                    (t.amount_low or 0) / median_amounts[t.politician]
                    if t.politician in median_amounts and median_amounts[t.politician] > 0 and (t.amount_low or 0) > 0
                    else None
                ),
                insider_is_officer=t.ticker in insider_officer_tickers,
            )
            if result["score"] >= min_score:
                events.append({
                    "type": "buy", "date": t.tx_date,
                    "ticker": t.ticker.upper(), "pol_key": t.politician.lower(),
                    "politician": t.politician, "party": t.party,
                    "source": "congress", "score": result["score"],
                    "rating": result["rating"], "trade_id": t.id,
                })
        elif t.tx_type in ("sale", "sale_full", "sale_partial"):
            events.append({
                "type": "sell", "date": t.tx_date,
                "ticker": t.ticker.upper(), "pol_key": t.politician.lower(),
                "politician": t.politician, "party": t.party,
                "source": "congress", "score": 0, "rating": "",
                "trade_id": t.id,
            })

    # Score and add insider buys + all sells
    for t in all_insiders:
        if not t.tx_date or not t.ticker:
            continue
        if t.tx_type == "purchase":
            delay = (
                (t.filing_date - t.tx_date).days
                if t.filing_date and t.tx_date else None
            )
            result = score_trade_conviction(
                trade={
                    "ticker": t.ticker,
                    "tx_type": t.tx_type,
                    "amount_low": t.total_value,
                    "disclosure_delay_days": delay,
                },
                committees=None,
                cluster_count=cluster_map.get(t.ticker, 0),
                insider_also_buying=t.ticker in insider_buying_tickers,
                fund_also_holds=t.ticker in fund_tickers,
                politician_track_record=None,
                recent_sells_count=recent_sells_map.get(t.ticker, 0),
                insider_is_officer=t.ticker in insider_officer_tickers,
            )
            if result["score"] >= min_score:
                events.append({
                    "type": "buy", "date": t.tx_date,
                    "ticker": t.ticker.upper(),
                    "pol_key": (t.insider_name or "").lower(),
                    "politician": t.insider_name, "party": None,
                    "source": "insider", "score": result["score"],
                    "rating": result["rating"], "trade_id": t.id,
                })
        elif t.tx_type in ("sale", "sale_full", "sale_partial", "sell"):
            events.append({
                "type": "sell", "date": t.tx_date,
                "ticker": t.ticker.upper(),
                "pol_key": (t.insider_name or "").lower(),
                "politician": t.insider_name, "party": None,
                "source": "insider", "score": 0, "rating": "",
                "trade_id": t.id,
            })

    events.sort(key=lambda e: e["date"])

    # ── 5. Fixed-capital simulation ──
    cash = float(initial_capital)
    positions: dict[tuple, dict] = {}  # (source, pol_key, ticker) -> position
    closed_positions: list[dict] = []

    first_date = events[0]["date"] if events else since
    weeks: list[datetime] = []
    d = first_date
    while d <= now:
        weeks.append(d)
        d += timedelta(days=7)
    if weeks and (now - weeks[-1]).days > 3:
        weeks.append(now)

    nav_series: list[dict] = []
    event_idx = 0

    for week_date in weeks:
        # Process all events up to this week
        while event_idx < len(events) and events[event_idx]["date"] <= week_date:
            ev = events[event_idx]
            key = (ev["source"], ev["pol_key"], ev["ticker"])

            if ev["type"] == "buy":
                if key not in positions:
                    if len(positions) >= max_positions:
                        skipped_max_pos += 1
                    elif cash >= position_size:
                        price = get_price(ev["ticker"], ev["date"])
                        if price and price > 0:
                            alloc = min(position_size, cash)
                            shares = alloc / price
                            cash -= alloc
                            positions[key] = {
                                "shares": shares, "cost": alloc,
                                "entry_price": price, "entry_date": ev["date"],
                                "ticker": ev["ticker"],
                                "politician": ev["politician"],
                                "party": ev["party"], "source": ev["source"],
                                "score": ev["score"], "rating": ev["rating"],
                                "trade_id": ev["trade_id"],
                            }
                    else:
                        skipped_no_cash += 1

            elif ev["type"] == "sell":
                if key in positions:
                    pos = positions[key]
                    price = get_price(ev["ticker"], ev["date"])
                    if price and price > 0:
                        exit_value = pos["shares"] * price
                        cash += exit_value
                        closed_positions.append({
                            **pos,
                            "exit_price": price,
                            "exit_date": ev["date"],
                            "current_value": exit_value,
                            "return_pct": (price - pos["entry_price"]) / pos["entry_price"] * 100,
                            "pnl": exit_value - pos["cost"],
                            "holding_days": (ev["date"] - pos["entry_date"]).days,
                            "status": "closed",
                        })
                        del positions[key]

            event_idx += 1

        # Weekly NAV snapshot
        holdings_value = 0.0
        for _key, pos in positions.items():
            p = get_price(pos["ticker"], week_date)
            holdings_value += pos["shares"] * p if p and p > 0 else pos["cost"]

        nav = cash + holdings_value
        return_pct = (nav / initial_capital - 1) * 100
        nav_series.append({
            "date": week_date.strftime("%Y-%m-%d"),
            "nav": round(nav, 2),
            "return_pct": round(return_pct, 1),
            "positions": len(positions),
            "cash": round(cash, 2),
        })

    # ── 6. Mark-to-market open positions ──
    open_list: list[dict] = []
    for _key, pos in positions.items():
        price = get_price(pos["ticker"], now)
        if price and price > 0:
            current_value = pos["shares"] * price
            ret = (price - pos["entry_price"]) / pos["entry_price"] * 100
        else:
            current_value = pos["cost"]
            ret = 0
        open_list.append({
            **pos,
            "exit_price": price or pos["entry_price"],
            "exit_date": None,
            "current_value": current_value,
            "return_pct": ret,
            "pnl": current_value - pos["cost"],
            "holding_days": (now - pos["entry_date"]).days,
            "status": "holding",
        })

    # ── 7. Summary ──
    all_pos = closed_positions + open_list

    if not all_pos and not nav_series:
        return {
            "nav_series": [],
            "summary": {
                "initial_capital": initial_capital,
                "current_value": initial_capital,
                "total_return_pct": 0, "cagr_pct": 0,
                "total_positions": 0, "open_positions": 0,
                "closed_positions": 0, "win_rate": 0,
                "best_trade_pct": None, "worst_trade_pct": None,
                "avg_holding_days": None, "cash": initial_capital,
                "skipped_no_cash": 0, "skipped_max_positions": 0,
            },
            "positions": [], "min_score": min_score,
            "days": days, "initial_capital": initial_capital,
            "max_positions": max_positions,
        }

    final_nav = nav_series[-1]["nav"] if nav_series else initial_capital
    total_return_pct = (final_nav / initial_capital - 1) * 100
    years = (now - first_date).days / 365.25
    if years > 0.1 and final_nav > 0 and initial_capital > 0:
        cagr = ((final_nav / initial_capital) ** (1 / years) - 1) * 100
    else:
        cagr = 0

    winning = [p for p in all_pos if p["return_pct"] > 0]
    win_rate = (len(winning) / len(all_pos) * 100) if all_pos else 0
    avg_holding = (
        sum(p.get("holding_days", 0) or 0 for p in all_pos) / len(all_pos)
        if all_pos else 0
    )

    formatted = []
    for p in sorted(all_pos, key=lambda x: x.get("return_pct", 0), reverse=True):
        formatted.append({
            "id": f"{'c' if p['source'] == 'congress' else 'i'}-{p['trade_id']}",
            "source": p["source"],
            "politician": p["politician"],
            "party": p.get("party"),
            "ticker": p["ticker"],
            "conviction_score": p["score"],
            "conviction_rating": p["rating"],
            "entry_date": p["entry_date"].isoformat() if p.get("entry_date") else None,
            "entry_price": round(p["entry_price"], 2),
            "exit_date": p["exit_date"].isoformat() if p.get("exit_date") else None,
            "exit_price": round(p.get("exit_price", p["entry_price"]), 2),
            "return_pct": round(p["return_pct"], 2),
            "invested": round(p["cost"], 0),
            "current_value": round(p.get("current_value", p["cost"]), 0),
            "pnl": round(p.get("pnl", 0), 0),
            "holding_days": p.get("holding_days"),
            "status": p["status"],
        })

    return {
        "nav_series": nav_series,
        "summary": {
            "initial_capital": initial_capital,
            "current_value": round(final_nav, 2),
            "total_return_pct": round(total_return_pct, 1),
            "cagr_pct": round(cagr, 1),
            "total_positions": len(all_pos),
            "open_positions": len(open_list),
            "closed_positions": len(closed_positions),
            "win_rate": round(win_rate, 1),
            "best_trade_pct": round(max(p["return_pct"] for p in all_pos), 2) if all_pos else None,
            "worst_trade_pct": round(min(p["return_pct"] for p in all_pos), 2) if all_pos else None,
            "avg_holding_days": round(avg_holding, 0) if all_pos else None,
            "cash": round(cash, 2),
            "skipped_no_cash": skipped_no_cash,
            "skipped_max_positions": skipped_max_pos,
        },
        "positions": formatted,
        "min_score": min_score,
        "days": days,
        "initial_capital": initial_capital,
        "max_positions": max_positions,
    }
