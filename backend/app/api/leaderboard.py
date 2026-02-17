"""API routes for the unified leaderboard.

All data comes from the pre-computed Politician table -- no live queries
against the Trade table, no Yahoo API calls. Sub-100ms response times.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Politician, get_db

router = APIRouter(prefix="/leaderboard", tags=["Leaderboard"])


@router.get("/")
async def get_leaderboard(
    min_trades: int = Query(default=3, ge=1, description="Minimum priced buy trades to be ranked"),
    chamber: str | None = Query(default=None, description="Filter: house or senate"),
    sort_by: str = Query(default="portfolio_cagr", description="Sort by: portfolio_cagr, conviction_cagr, avg_return, win_rate, total_trades"),
    db: AsyncSession = Depends(get_db),
):
    """
    Unified politician trading leaderboard -- reads from pre-computed Politician table.
    Instant response (<100ms). Data refreshed every 15 min by background job.
    """
    # Try portfolio-based leaderboard first
    try:
        stmt = select(Politician).where(
            Politician.priced_buy_count >= min_trades,
            Politician.portfolio_cagr.isnot(None),
        )
        if chamber:
            stmt = stmt.where(Politician.chamber == chamber.lower())
        result = await db.execute(stmt)
        politicians = list(result.scalars().all())
    except Exception:
        politicians = []

    # Fallback: if no portfolio data, show politicians ranked by basic stats
    if not politicians:
        try:
            stmt = select(Politician).where(
                Politician.total_trades >= max(min_trades, 3),
            )
            if chamber:
                stmt = stmt.where(Politician.chamber == chamber.lower())
            stmt = stmt.order_by(Politician.total_trades.desc()).limit(100)
            result = await db.execute(stmt)
            politicians = list(result.scalars().all())
        except Exception:
            politicians = []

    # Sort
    sort_key_map = {
        "portfolio_cagr": lambda p: p.portfolio_cagr or -999,
        "conviction_cagr": lambda p: p.conviction_cagr or -999,
        "avg_return": lambda p: p.avg_return or -999,
        "win_rate": lambda p: p.win_rate or -999,
        "total_trades": lambda p: p.total_trades or 0,
    }
    sort_fn = sort_key_map.get(sort_by, sort_key_map["portfolio_cagr"])
    politicians.sort(key=sort_fn, reverse=True)

    entries = []
    for i, p in enumerate(politicians):
        entries.append({
            "rank": i + 1,
            "politician": p.name,
            "party": p.party,
            "state": p.state,
            "chamber": p.chamber,
            "total_trades": p.total_trades or 0,
            "total_buys": p.total_buys or 0,
            "total_sells": p.total_sells or 0,
            "avg_return_pct": p.avg_return,
            "win_rate_pct": p.win_rate,
            "portfolio_return_pct": p.portfolio_return,
            "portfolio_cagr_pct": p.portfolio_cagr,
            "conviction_return_pct": p.conviction_return,
            "conviction_cagr_pct": p.conviction_cagr,
            "priced_buy_count": p.priced_buy_count or 0,
            "years_active": p.years_active,
            "last_trade_date": p.last_trade_date.isoformat() if p.last_trade_date else None,
        })

    # Party comparison
    party_stats: dict[str, dict] = {}
    for e in entries:
        party = e["party"] or "Unknown"
        if party not in party_stats:
            party_stats[party] = {"cagrs": [], "avg_returns": [], "count": 0, "total_trades": 0}
        if e["portfolio_cagr_pct"] is not None:
            party_stats[party]["cagrs"].append(e["portfolio_cagr_pct"])
        if e["avg_return_pct"] is not None:
            party_stats[party]["avg_returns"].append(e["avg_return_pct"])
        party_stats[party]["count"] += 1
        party_stats[party]["total_trades"] += e["total_trades"]

    party_comparison = {
        party: {
            "avg_cagr_pct": round(sum(d["cagrs"]) / len(d["cagrs"]), 2) if d["cagrs"] else None,
            "avg_return_pct": round(sum(d["avg_returns"]) / len(d["avg_returns"]), 2) if d["avg_returns"] else None,
            "total_politicians": d["count"],
            "total_trades": d["total_trades"],
        }
        for party, d in party_stats.items()
    }

    has_portfolio_data = any(e["portfolio_cagr_pct"] is not None for e in entries)

    return {
        "leaderboard": entries,
        "total_ranked": len(entries),
        "party_comparison": party_comparison,
        "has_portfolio_data": has_portfolio_data,
    }


@router.get("/portfolio-returns")
async def get_portfolio_returns(
    min_trades: int = Query(default=3, ge=1, description="Minimum priced buy trades to be included"),
    sort_by: str = Query(default="equal_weight", description="Sort by: equal_weight or conviction_weighted"),
    db: AsyncSession = Depends(get_db),
):
    """
    Portfolio-simulated returns -- reads from pre-computed Politician table.
    """
    stmt = select(Politician).where(
        Politician.priced_buy_count >= min_trades,
        Politician.portfolio_cagr.isnot(None),
    )
    result = await db.execute(stmt)
    politicians = result.scalars().all()

    results = []
    for p in politicians:
        results.append({
            "politician": p.name,
            "party": p.party,
            "state": p.state,
            "chamber": p.chamber,
            "total_trades": p.priced_buy_count or 0,
            "equal_weight": {
                "total_return": p.portfolio_return,
                "annual_return": p.portfolio_cagr,
                "total_invested": (p.priced_buy_count or 0) * 10_000,
                "positions_open": 0,
                "years": p.years_active or 0,
            },
            "conviction_weighted": {
                "total_return": p.conviction_return,
                "annual_return": p.conviction_cagr,
                "total_invested": 0,
                "positions_open": 0,
                "years": p.years_active or 0,
            },
        })

    if sort_by == "conviction_weighted":
        results.sort(key=lambda x: x["conviction_weighted"]["annual_return"] or 0, reverse=True)
    else:
        results.sort(key=lambda x: x["equal_weight"]["annual_return"] or 0, reverse=True)

    return results
