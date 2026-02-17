"""API routes for the Congress Trades app."""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import distinct, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Politician, Trade, get_db
from app.models.schemas import (
    PoliticianDetail,
    PoliticianResponse,
    StatsResponse,
    TradeResponse,
)
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
            t.disclosure_delay_days
            if t.disclosure_delay_days is not None
            else (
                (t.disclosure_date - t.tx_date).days
                if t.disclosure_date and t.tx_date else None
            )
        ),
        suspicion_score=t.suspicion_score,
        cluster_flag=t.cluster_flag or False,
        return_30d=t.return_30d,
        return_90d=t.return_90d,
        excess_return_90d=t.excess_return_90d,
    )

router = APIRouter()


# --- Trades ---


@router.get("/trades", response_model=list[TradeResponse])
async def get_trades(
    search: str | None = None,
    chamber: str | None = None,
    politician: str | None = None,
    party: str | None = None,
    state: str | None = None,
    ticker: str | None = None,
    tx_type: str | None = None,
    days: int = Query(default=365, ge=1, le=7300),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get trades with optional filters.

    Use `search` to do a combined politician OR ticker search (ILIKE).
    """
    since = datetime.utcnow() - timedelta(days=days)
    # Only return real stock trades (not PTR filing metadata)
    stmt = select(Trade).where(Trade.disclosure_date >= since).where(Trade.ticker.isnot(None))

    if search:
        stmt = stmt.where(
            Trade.politician.ilike(f"%{search}%") | Trade.ticker.ilike(f"%{search}%")
        )
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

    return [_trade_to_response(t) for t in trades]


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

    return [_trade_to_response(t) for t in trades]


# --- Politicians ---


@router.get("/politicians", response_model=list[PoliticianResponse])
async def get_politicians(
    chamber: str | None = None,
    party: str | None = None,
    search: str | None = Query(default=None, description="Search by politician name"),
    sort_by: str = Query(default="total_trades", pattern="^(total_trades|avg_return|win_rate)$"),
    min_trades: int = Query(default=1, ge=1),
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List politicians with their trading stats."""
    stmt = select(Politician).where(Politician.total_trades >= min_trades)

    if search:
        stmt = stmt.where(Politician.name.ilike(f"%{search}%"))
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


@router.get("/politicians/{name}/portfolio")
async def get_politician_portfolio(
    name: str,
    db: AsyncSession = Depends(get_db),
):
    """Get portfolio simulation for a politician (copy-trading equity curve).

    Simulates buying when the politician buys and selling when they sell,
    using actual historical prices from Yahoo Finance. Returns weekly NAV
    series with return percentages for charting.
    """
    from app.services.portfolio import compute_portfolio_simulation

    result = await compute_portfolio_simulation(db, name)
    return result


@router.get("/politicians/{name}", response_model=PoliticianDetail)
async def get_politician_detail(
    name: str,
    db: AsyncSession = Depends(get_db),
):
    """Get detailed info for a specific politician including recent trades."""
    # Try the Politician table first (has pre-computed stats)
    # Use order_by total_trades desc to pick the best match when multiple name variants exist
    stmt = (
        select(Politician)
        .where(Politician.name.ilike(f"%{name}%"))
        .order_by(Politician.total_trades.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    politician = result.scalar_one_or_none()

    # Only return real stock trades (not PTR filing metadata)
    _has_ticker = Trade.ticker.isnot(None)

    # Fallback: build profile from Trade data if Politician table not yet populated
    if not politician:
        # Find all name variants that match (e.g., "Tommy Tuberville" + "Thomas H Tuberville")
        name_filter = Trade.politician.ilike(f"%{name}%")
        trades_check = await db.execute(
            select(Trade).where(name_filter).limit(1)
        )
        sample_trade = trades_check.scalar_one_or_none()
        if not sample_trade:
            raise HTTPException(status_code=404, detail=f"Politician '{name}' not found")

        # Count only real stock trades (with tickers)
        total = (await db.execute(
            select(func.count()).where(name_filter).where(_has_ticker)
        )).scalar()
        buys = (await db.execute(
            select(func.count()).where(name_filter).where(Trade.tx_type == "purchase")
        )).scalar()
        sells = (await db.execute(
            select(func.count()).where(name_filter).where(
                Trade.tx_type.in_(["sale", "sale_full", "sale_partial"])
            )
        )).scalar()
        last_date = (await db.execute(
            select(func.max(Trade.tx_date)).where(name_filter)
        )).scalar()

        trades_stmt = (
            select(Trade)
            .where(name_filter)
            .where(_has_ticker)
            .order_by(Trade.disclosure_date.desc())
            .limit(500)
        )
        trades = (await db.execute(trades_stmt)).scalars().all()

        display_name = sample_trade.politician

        return PoliticianDetail(
            id=0,
            name=display_name,
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

    # Use ilike to also capture name variants (e.g., "Tommy Tuberville" + "Thomas H Tuberville")
    trades_stmt = (
        select(Trade)
        .where(Trade.politician.ilike(f"%{name}%"))
        .where(_has_ticker)
        .order_by(Trade.disclosure_date.desc())
        .limit(500)
    )
    trades_result = await db.execute(trades_stmt)
    trades = trades_result.scalars().all()

    return PoliticianDetail(
        id=politician.id,
        name=politician.name,
        chamber=politician.chamber,
        party=politician.party,
        state=politician.state,
        total_trades=politician.total_trades or len(trades),
        total_buys=politician.total_buys,
        total_sells=politician.total_sells,
        avg_return=politician.avg_return,
        win_rate=politician.win_rate,
        last_trade_date=politician.last_trade_date,
        portfolio_return=politician.portfolio_return,
        portfolio_cagr=politician.portfolio_cagr,
        conviction_return=politician.conviction_return,
        conviction_cagr=politician.conviction_cagr,
        priced_buy_count=politician.priced_buy_count,
        years_active=politician.years_active,
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

    return [_trade_to_response(t) for t in trades]


@router.get("/tickers/{ticker}/chart")
async def get_ticker_chart(
    ticker: str,
    days: int = Query(default=365, ge=30, le=1825),
    db: AsyncSession = Depends(get_db),
):
    """Get price history and congressional trade markers for a ticker chart."""
    import httpx

    from app.services.portfolio import _fetch_weekly_prices

    ticker_upper = ticker.upper()
    end = datetime.utcnow()
    start = end - timedelta(days=days)

    # 1. Fetch weekly prices from Yahoo
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            prices_raw = await _fetch_weekly_prices(client, ticker_upper, start, end)
    except Exception as e:
        logger.warning(f"Price fetch failed for {ticker_upper}: {e}")
        prices_raw = []

    prices = [
        {
            "date": datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d"),
            "close": round(close, 2),
        }
        for ts, close in prices_raw
    ]

    # 2. Fetch congressional trades for this ticker
    congress_stmt = (
        select(Trade)
        .where(Trade.ticker == ticker_upper)
        .where(Trade.tx_date >= start)
        .order_by(Trade.tx_date.asc())
    )
    congress_result = await db.execute(congress_stmt)
    congress_trades = congress_result.scalars().all()

    trades = []
    for t in congress_trades:
        action = "buy" if t.tx_type == "purchase" else "sell"
        trades.append({
            "date": t.tx_date.strftime("%Y-%m-%d") if t.tx_date else None,
            "type": action,
            "politician": t.politician,
            "source": "congress",
            "party": t.party,
            "amount_low": t.amount_low,
            "amount_high": t.amount_high,
            "price": t.price_at_disclosure,
        })

    return {
        "ticker": ticker_upper,
        "prices": prices,
        "trades": trades,
        "days": days,
    }


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


# --- Suspicious Trades ---


@router.get("/trades/suspicious", response_model=list[TradeResponse])
async def get_suspicious_trades(
    min_score: float = Query(default=50, ge=0, le=100),
    days: int = Query(default=90, ge=1, le=3650),
    chamber: str | None = None,
    party: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get trades ranked by suspicion score.

    Returns purchases sorted by suspicion_score descending.
    This is the automated version of what Autopilot's team does manually
    every morning — flagging suspicious trades.
    """
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(Trade)
        .where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
            Trade.suspicion_score.isnot(None),
            Trade.suspicion_score >= min_score,
            Trade.disclosure_date >= since,
        )
    )
    if chamber:
        stmt = stmt.where(Trade.chamber == chamber.lower())
    if party:
        stmt = stmt.where(Trade.party == party.upper())

    stmt = stmt.order_by(Trade.suspicion_score.desc()).limit(limit)
    result = await db.execute(stmt)
    trades = result.scalars().all()
    return [_trade_to_response(t) for t in trades]


@router.get("/trades/clusters")
async def get_cluster_trades(
    days: int = Query(default=90, ge=1, le=3650),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get cluster trades — tickers bought by 3+ politicians within 7 days.

    Groups by ticker and shows which politicians participated in each cluster.
    """
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(Trade)
        .where(
            Trade.cluster_flag.is_(True),
            Trade.disclosure_date >= since,
        )
        .order_by(Trade.tx_date.desc())
        .limit(limit * 3)  # Get extra to group
    )
    result = await db.execute(stmt)
    trades = result.scalars().all()

    # Group by ticker + approximate date window
    from collections import defaultdict
    clusters: dict[str, list] = defaultdict(list)
    for t in trades:
        # Use week as cluster key
        week_key = t.tx_date.strftime("%Y-W%W") if t.tx_date else "unknown"
        key = f"{t.ticker}_{week_key}"
        clusters[key].append({
            "id": t.id,
            "politician": t.politician,
            "party": t.party,
            "tx_date": t.tx_date.isoformat() if t.tx_date else None,
            "amount_low": t.amount_low,
            "amount_high": t.amount_high,
            "suspicion_score": t.suspicion_score,
            "return_since_disclosure": t.return_since_disclosure,
        })

    # Return top clusters by number of politicians
    sorted_clusters = sorted(
        [
            {
                "ticker": key.split("_")[0],
                "week": key.split("_")[1] if "_" in key else "",
                "politicians": len(set(t["politician"] for t in trades_list)),
                "trades": trades_list,
            }
            for key, trades_list in clusters.items()
        ],
        key=lambda c: c["politicians"],
        reverse=True,
    )

    return sorted_clusters[:limit]


@router.get("/scoring/validation")
async def get_score_validation(db: AsyncSession = Depends(get_db)):
    """Run the scoring validation analysis.

    Returns per-signal correlation with 90-day excess returns,
    statistical significance, and recommended weight adjustments.
    """
    from app.services.validation import validate_signals
    return await validate_signals(db)


@router.get("/scoring/stats")
async def get_scoring_stats(db: AsyncSession = Depends(get_db)):
    """Get scoring coverage statistics."""
    total_purchases = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
        )
    )).scalar() or 0

    scored = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.suspicion_score.isnot(None),
        )
    )).scalar() or 0

    with_forward_prices = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.return_90d.isnot(None),
        )
    )).scalar() or 0

    with_excess = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.excess_return_90d.isnot(None),
        )
    )).scalar() or 0

    clustered = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.cluster_flag.is_(True),
        )
    )).scalar() or 0

    avg_score = (await db.execute(
        select(func.avg(Trade.suspicion_score)).where(
            Trade.suspicion_score.isnot(None),
        )
    )).scalar()

    # Score distribution
    high_score = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.suspicion_score >= 70,
        )
    )).scalar() or 0

    medium_score = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.suspicion_score >= 40,
            Trade.suspicion_score < 70,
        )
    )).scalar() or 0

    return {
        "total_purchases": total_purchases,
        "scored_trades": scored,
        "scoring_coverage": f"{round(scored / total_purchases * 100, 1)}%" if total_purchases else "0%",
        "with_90d_forward_returns": with_forward_prices,
        "with_excess_returns": with_excess,
        "cluster_trades": clustered,
        "avg_suspicion_score": round(avg_score, 1) if avg_score else None,
        "high_suspicion_count": high_score,
        "medium_suspicion_count": medium_score,
    }


# --- Admin / Ingestion ---


@router.post("/admin/ingest")
async def trigger_ingestion():
    """Manually trigger data ingestion from House & Senate sources."""
    result = await run_ingestion()
    return result


@router.post("/admin/update-prices")
async def trigger_price_update(
    limit: int = Query(default=50, ge=1, le=5000),
    force: bool = Query(default=False),
    background: bool = Query(default=False),
):
    """Manually trigger price updates. Use force=true to recalculate all.

    For large batches (>100), use background=true to avoid timeouts.
    """
    if background:
        import asyncio

        async def _run():
            try:
                result = await run_performance_update(price_limit=limit, force=force)
                logger.info(f"Background price update finished: {result}")
            except Exception as e:
                logger.error(f"Background price update failed: {e}")

        asyncio.create_task(_run())
        return {"status": "started", "limit": limit, "force": force}

    result = await run_performance_update(price_limit=limit, force=force)
    return result


@router.post("/admin/refresh-prices")
async def trigger_price_refresh():
    """Manually trigger current price refresh for all priced tickers.

    This backfills price_current for trades where it's missing and
    updates returns. Runs in background.
    """
    import asyncio
    from app.services.performance import run_price_refresh

    async def _run():
        try:
            result = await run_price_refresh()
            logger.info(f"Price refresh finished: {result}")
        except Exception as e:
            logger.error(f"Price refresh failed: {e}")

    asyncio.create_task(_run())
    return {"status": "started", "message": "Refreshing current prices for all priced tickers"}


@router.post("/admin/ingest-historical")
async def trigger_historical_ingestion(
    start_year: int = Query(default=2012, ge=2012, le=2026),
    end_year: int = Query(default=2026, ge=2012, le=2026),
):
    """Ingest historical Senate trades from eFD PTR filings (2012-present).

    This scrapes individual PTR pages for transaction-level data (ticker, date, amount).
    Can take 10-30 minutes for a full run (2012-2026).
    """
    import asyncio

    from app.services.historical_ingestion import run_historical_ingestion

    years = list(range(start_year, end_year + 1))

    # Run in background so the endpoint returns immediately
    async def _run():
        try:
            result = await run_historical_ingestion(years=years)
            logger.info(f"Historical ingestion finished: {result}")
        except Exception as e:
            logger.error(f"Historical ingestion failed: {e}")

    asyncio.create_task(_run())
    return {
        "status": "started",
        "years": years,
        "message": f"Historical ingestion started for {start_year}-{end_year}. Check logs for progress.",
    }


@router.post("/admin/backfill-parties")
async def backfill_parties(db: AsyncSession = Depends(get_db)):
    """Backfill party/state for trades AND politicians using fuzzy name matching."""
    from app.services.historical_ingestion import _lookup_party

    # 1. Backfill Trade rows missing party
    stmt = (
        select(Trade.politician)
        .where((Trade.party.is_(None)) | (Trade.party == ""))
        .distinct()
    )
    result = await db.execute(stmt)
    politicians = [row[0] for row in result.all()]

    trades_updated = 0
    for pol_name in politicians:
        party, state = _lookup_party(pol_name)
        if party:
            await db.execute(
                update(Trade)
                .where(Trade.politician == pol_name)
                .where((Trade.party.is_(None)) | (Trade.party == ""))
                .values(party=party, state=state)
            )
            trades_updated += 1

    # 2. Backfill Politician table rows missing party
    pol_stmt = (
        select(Politician)
        .where((Politician.party.is_(None)) | (Politician.party == ""))
    )
    pol_result = await db.execute(pol_stmt)
    null_pols = pol_result.scalars().all()

    pols_updated = 0
    for pol in null_pols:
        # First check if any of their trades already have party data
        trade_party = await db.execute(
            select(Trade.party, Trade.state).where(
                Trade.politician == pol.name,
                Trade.party.isnot(None),
                Trade.party != "",
            ).limit(1)
        )
        row = trade_party.first()
        if row:
            pol.party = row[0]
            pol.state = row[1] or pol.state
            pols_updated += 1
        else:
            # Fall back to lookup dict
            party, state = _lookup_party(pol.name)
            if party:
                pol.party = party
                pol.state = state or pol.state
                pols_updated += 1

    await db.commit()
    return {
        "trades_politicians_updated": trades_updated,
        "trades_total_missing": len(politicians),
        "politician_table_updated": pols_updated,
        "politician_table_total_missing": len(null_pols),
    }


@router.post("/admin/ingest-capitoltrades")
async def trigger_capitoltrades_ingestion(
    chamber: str = Query(default="house", regex="^(house|senate)$"),
    max_pages: int = Query(default=0, ge=0, le=5000),
):
    """Ingest House (or Senate) trades from CapitolTrades.com.

    Each page has 12 trades. Total House trades ~2,600+ pages.
    Use max_pages=0 for all pages. Runs in background.
    """
    import asyncio
    from app.services.capitoltrades import run_capitoltrades_ingestion

    effective_max = max_pages if max_pages > 0 else None

    async def _run():
        try:
            result = await run_capitoltrades_ingestion(
                chamber=chamber, max_pages=effective_max
            )
            logger.info(f"CapitolTrades ingestion finished: {result}")
        except Exception as e:
            logger.error(f"CapitolTrades ingestion failed: {e}")

    asyncio.create_task(_run())
    return {
        "status": "started",
        "chamber": chamber,
        "max_pages": effective_max or "all",
        "message": f"CapitolTrades {chamber} ingestion started. Check logs for progress.",
    }


@router.get("/admin/test-prices")
async def test_prices(ticker: str = Query(default="AAPL")):
    """Test price fetching using Yahoo v8 API (via httpx)."""
    import httpx
    from app.services.performance import get_current_price, get_price_on_date
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        current = await get_current_price(client, ticker)
        historical = await get_price_on_date(client, ticker, datetime.utcnow() - timedelta(days=30))
    return {
        "ticker": ticker,
        "current_price": current,
        "price_30d_ago": historical,
        "working": current is not None,
    }


@router.get("/admin/pricing-status")
async def pricing_status(db: AsyncSession = Depends(get_db)):
    """Diagnostic: show pricing coverage across all trades."""
    from sqlalchemy import distinct

    # Total trades with tickers
    total = (await db.execute(
        select(func.count()).select_from(Trade).where(Trade.ticker.isnot(None))
    )).scalar() or 0

    # Trades with price_at_disclosure
    priced = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.ticker.isnot(None),
            Trade.price_at_disclosure.isnot(None),
        )
    )).scalar() or 0

    # Buy trades with prices
    priced_buys = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.ticker.isnot(None),
            Trade.price_at_disclosure.isnot(None),
            Trade.tx_type == "purchase",
        )
    )).scalar() or 0

    # Total buy trades
    total_buys = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.ticker.isnot(None),
            Trade.tx_type == "purchase",
        )
    )).scalar() or 0

    # Trades eligible for pricing (have disclosure_date)
    eligible = (await db.execute(
        select(func.count()).select_from(Trade).where(
            Trade.ticker.isnot(None),
            Trade.disclosure_date.isnot(None),
            Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]),
            Trade.price_at_disclosure.is_(None),
        )
    )).scalar() or 0

    # Unique tickers
    total_tickers = (await db.execute(
        select(func.count(distinct(Trade.ticker))).where(Trade.ticker.isnot(None))
    )).scalar() or 0

    priced_tickers = (await db.execute(
        select(func.count(distinct(Trade.ticker))).where(
            Trade.ticker.isnot(None),
            Trade.price_at_disclosure.isnot(None),
        )
    )).scalar() or 0

    # Politicians with 3+ priced buys (leaderboard eligible)
    lb_eligible = (await db.execute(
        select(func.count()).select_from(
            select(Trade.politician)
            .where(
                Trade.ticker.isnot(None),
                Trade.price_at_disclosure.isnot(None),
                Trade.tx_type == "purchase",
            )
            .group_by(Trade.politician)
            .having(func.count() >= 3)
            .subquery()
        )
    )).scalar() or 0

    return {
        "total_trades_with_ticker": total,
        "priced_trades": priced,
        "unpriced_eligible": eligible,
        "pricing_coverage": f"{round(priced / total * 100, 1)}%" if total else "0%",
        "total_buys": total_buys,
        "priced_buys": priced_buys,
        "buy_coverage": f"{round(priced_buys / total_buys * 100, 1)}%" if total_buys else "0%",
        "unique_tickers": total_tickers,
        "priced_tickers": priced_tickers,
        "leaderboard_eligible_politicians": lb_eligible,
    }


@router.get("/admin/pricing-status/{politician}")
async def politician_pricing_status(
    politician: str,
    db: AsyncSession = Depends(get_db),
):
    """Diagnostic: show pricing details for a specific politician's trades."""
    from sqlalchemy import distinct

    stmt = (
        select(Trade)
        .where(Trade.politician.ilike(f"%{politician}%"))
        .where(Trade.ticker.isnot(None))
        .order_by(Trade.tx_date.desc().nullslast())
    )
    result = await db.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        return {"error": f"No trades found for '{politician}'"}

    buys = [t for t in trades if t.tx_type == "purchase"]
    priced_buys = [t for t in buys if t.price_at_disclosure]
    has_current = [t for t in trades if t.price_current]

    # Sample trades with full pricing info
    samples = []
    for t in trades[:20]:
        samples.append({
            "ticker": t.ticker,
            "tx_type": t.tx_type,
            "tx_date": str(t.tx_date)[:10] if t.tx_date else None,
            "price_at_disclosure": t.price_at_disclosure,
            "price_current": t.price_current,
            "return_pct": t.return_since_disclosure,
        })

    # Unique tickers with current prices
    ticker_prices = {}
    for t in reversed(trades):
        if t.ticker and t.ticker not in ticker_prices:
            ticker_prices[t.ticker] = {
                "price_at_disclosure": t.price_at_disclosure,
                "price_current": t.price_current,
                "return_pct": t.return_since_disclosure,
            }

    return {
        "politician": trades[0].politician,
        "total_trades": len(trades),
        "total_buys": len(buys),
        "priced_buys": len(priced_buys),
        "trades_with_current_price": len(has_current),
        "leaderboard_eligible": len(priced_buys) >= 3,
        "unpriced_buys": [
            {"ticker": t.ticker, "tx_date": str(t.tx_date)[:10] if t.tx_date else None}
            for t in buys if not t.price_at_disclosure
        ],
        "ticker_prices": ticker_prices,
        "sample_trades": samples,
    }


@router.post("/admin/force-price/{politician}")
async def force_price_politician(
    politician: str,
    db: AsyncSession = Depends(get_db),
):
    """Force-price all unpriced trades for a specific politician using Yahoo API."""
    import httpx
    from app.services.performance import get_price_on_date, get_current_price

    stmt = (
        select(Trade)
        .where(Trade.politician.ilike(f"%{politician}%"))
        .where(Trade.ticker.isnot(None))
        .where(Trade.price_at_disclosure.is_(None))
        .order_by(Trade.tx_date.desc().nullslast())
    )
    result = await db.execute(stmt)
    trades = result.scalars().all()

    if not trades:
        return {"message": f"No unpriced trades for '{politician}'", "updated": 0}

    updated = 0
    errors = []
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for t in trades:
            trade_date = t.tx_date or t.disclosure_date
            if not trade_date or not t.ticker:
                continue
            try:
                hist_price = await get_price_on_date(client, t.ticker, trade_date)
                curr_price = await get_current_price(client, t.ticker)
                if hist_price and curr_price:
                    ret = ((curr_price - hist_price) / hist_price) * 100
                    t.price_at_disclosure = hist_price
                    t.price_current = curr_price
                    t.return_since_disclosure = round(ret, 2)
                    updated += 1
                else:
                    errors.append(f"{t.ticker} {str(trade_date)[:10]}: hist={hist_price} curr={curr_price}")
            except Exception as e:
                errors.append(f"{t.ticker}: {e}")

    await db.commit()
    return {"politician": politician, "updated": updated, "attempted": len(trades), "errors": errors[:10]}


@router.post("/admin/backfill-scores")
async def trigger_backfill_and_score(
    limit: int = Query(default=2000, ge=1, le=50000),
):
    """Run the full scoring pipeline: backfill forward prices, compute scores.

    Steps:
    1. Backfill disclosure_delay_days
    2. Backfill 30d/90d forward prices + excess returns
    3. Detect trade clusters
    4. Score all unscored trades
    """
    import asyncio
    from app.services.backfill import run_full_backfill
    from app.services.scoring import run_scoring

    async def _run():
        try:
            backfill_result = await run_full_backfill(price_limit=limit)
            logger.info(f"Backfill complete: {backfill_result}")
            scoring_result = await run_scoring()
            logger.info(f"Scoring complete: {scoring_result} trades scored")
        except Exception as e:
            logger.error(f"Backfill/scoring failed: {e}")

    asyncio.create_task(_run())
    return {"status": "started", "limit": limit, "message": "Backfill + scoring started. Check logs."}


@router.post("/admin/ingest-committees")
async def trigger_committee_ingestion():
    """Ingest congressional committee assignments from GitHub.

    Populates PoliticianCommittee table used for committee-sector
    overlap scoring signal.
    """
    import asyncio
    from app.services.committees import run_committee_ingestion

    async def _run():
        try:
            result = await run_committee_ingestion()
            logger.info(f"Committee ingestion complete: {result}")
        except Exception as e:
            logger.error(f"Committee ingestion failed: {e}")

    asyncio.create_task(_run())
    return {"status": "started", "message": "Committee ingestion started. Check logs."}
