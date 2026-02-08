"""API routes for 13F hedge fund holdings."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import HedgeFund, HedgeFundHolding, get_db
from app.services.hedge_funds import TRACKED_FUNDS, run_13f_ingestion

router = APIRouter(prefix="/hedge-funds", tags=["Hedge Funds (13F)"])


@router.get("/")
async def list_funds(db: AsyncSession = Depends(get_db)):
    """List all tracked hedge fund managers with their latest portfolio stats."""
    result = await db.execute(
        select(HedgeFund).order_by(HedgeFund.total_value.desc())
    )
    funds = result.scalars().all()

    return [
        {
            "name": f.name,
            "manager": f.manager_name,
            "cik": f.cik,
            "total_value": f.total_value,
            "num_holdings": f.num_holdings,
            "last_filing_date": f.last_filing_date,
            "report_date": f.report_date,
        }
        for f in funds
    ]


@router.get("/tracked")
async def list_tracked():
    """List all fund managers we track (even before ingestion)."""
    return TRACKED_FUNDS


@router.get("/{cik}/holdings")
async def get_fund_holdings(
    cik: str,
    sort_by: str = Query(default="value", regex="^(value|shares|issuer_name)$"),
    limit: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest holdings for a specific fund."""
    # Get the fund
    fund = await db.execute(select(HedgeFund).where(HedgeFund.cik == cik))
    fund_obj = fund.scalar_one_or_none()
    if not fund_obj:
        raise HTTPException(status_code=404, detail=f"Fund with CIK {cik} not found")

    # Get latest report date for this fund
    latest_report = await db.execute(
        select(HedgeFundHolding.report_date)
        .where(HedgeFundHolding.fund_cik == cik)
        .order_by(HedgeFundHolding.report_date.desc())
        .limit(1)
    )
    report_date = latest_report.scalar_one_or_none()
    if not report_date:
        return {"fund": fund_obj.name, "manager": fund_obj.manager_name, "holdings": []}

    # Get holdings for that report date
    stmt = (
        select(HedgeFundHolding)
        .where(HedgeFundHolding.fund_cik == cik)
        .where(HedgeFundHolding.report_date == report_date)
    )

    if sort_by == "value":
        stmt = stmt.order_by(HedgeFundHolding.value.desc())
    elif sort_by == "shares":
        stmt = stmt.order_by(HedgeFundHolding.shares.desc())
    else:
        stmt = stmt.order_by(HedgeFundHolding.issuer_name.asc())

    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    holdings = result.scalars().all()

    total_value = sum(h.value for h in holdings if h.value)

    return {
        "fund": fund_obj.name,
        "manager": fund_obj.manager_name,
        "report_date": report_date,
        "total_value": fund_obj.total_value,
        "num_holdings": len(holdings),
        "holdings": [
            {
                "issuer": h.issuer_name,
                "title": h.title_of_class,
                "cusip": h.cusip,
                "ticker": h.ticker,
                "value": h.value,
                "shares": h.shares,
                "share_type": h.share_type,
                "put_call": h.put_call,
                "pct_of_portfolio": round(h.value / total_value * 100, 2) if total_value and h.value else None,
                "is_new": h.is_new_position,
                "shares_change_pct": h.shares_change_pct,
            }
            for h in holdings
        ],
    }


@router.get("/overlap")
async def find_holding_overlap(
    ticker: str | None = None,
    cusip: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Find which funds hold a specific stock (by ticker or CUSIP)."""
    if not ticker and not cusip:
        raise HTTPException(status_code=400, detail="Provide ticker or cusip")

    stmt = select(
        HedgeFundHolding.fund_cik,
        HedgeFundHolding.issuer_name,
        HedgeFundHolding.value,
        HedgeFundHolding.shares,
        HedgeFundHolding.put_call,
        HedgeFundHolding.report_date,
    )

    if ticker:
        stmt = stmt.where(HedgeFundHolding.ticker == ticker.upper())
    elif cusip:
        stmt = stmt.where(HedgeFundHolding.cusip == cusip)

    result = await db.execute(stmt)
    rows = result.all()

    # Enrich with fund names
    funds_map = {}
    if rows:
        ciks = list(set(r.fund_cik for r in rows))
        funds = await db.execute(select(HedgeFund).where(HedgeFund.cik.in_(ciks)))
        funds_map = {f.cik: f for f in funds.scalars().all()}

    return [
        {
            "fund": funds_map[r.fund_cik].name if r.fund_cik in funds_map else r.fund_cik,
            "manager": funds_map[r.fund_cik].manager_name if r.fund_cik in funds_map else None,
            "issuer": r.issuer_name,
            "value": r.value,
            "shares": r.shares,
            "put_call": r.put_call,
            "report_date": r.report_date,
        }
        for r in rows
    ]


@router.post("/ingest")
async def trigger_13f_ingestion():
    """Manually trigger 13F ingestion for all tracked funds."""
    return await run_13f_ingestion()
