"""API routes for data export (CSV/JSON) across all data sources."""

import csv
import io
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    HedgeFundHolding,
    InsiderTrade,
    Trade,
    get_db,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["Data Export"])


def _make_csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    """Build a streaming CSV response from a list of dicts."""
    if not rows:
        return StreamingResponse(
            iter(["No data"]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/trades/csv")
async def export_trades_csv(
    days: int = Query(default=90, ge=1, le=3650),
    chamber: str | None = None,
    party: str | None = None,
    ticker: str | None = None,
    tx_type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Export congressional trades as CSV."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(Trade)
        .where(Trade.disclosure_date >= since)
        .where(Trade.ticker.isnot(None))
    )
    if chamber:
        stmt = stmt.where(Trade.chamber == chamber.lower())
    if party:
        stmt = stmt.where(Trade.party == party.upper())
    if ticker:
        stmt = stmt.where(Trade.ticker == ticker.upper())
    if tx_type:
        stmt = stmt.where(Trade.tx_type == tx_type.lower())

    stmt = stmt.order_by(Trade.disclosure_date.desc()).limit(10000)
    result = await db.execute(stmt)
    trades = result.scalars().all()

    rows = [
        {
            "politician": t.politician,
            "party": t.party,
            "state": t.state,
            "chamber": t.chamber,
            "ticker": t.ticker,
            "asset_description": t.asset_description,
            "tx_type": t.tx_type,
            "tx_date": str(t.tx_date)[:10] if t.tx_date else "",
            "disclosure_date": str(t.disclosure_date)[:10] if t.disclosure_date else "",
            "amount_low": t.amount_low or "",
            "amount_high": t.amount_high or "",
            "price_at_disclosure": t.price_at_disclosure or "",
            "price_current": t.price_current or "",
            "return_pct": t.return_since_disclosure or "",
        }
        for t in trades
    ]

    return _make_csv_response(rows, f"smartflow_congress_trades_{days}d.csv")


@router.get("/trades/json")
async def export_trades_json(
    days: int = Query(default=90, ge=1, le=3650),
    chamber: str | None = None,
    party: str | None = None,
    ticker: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Export congressional trades as JSON."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(Trade)
        .where(Trade.disclosure_date >= since)
        .where(Trade.ticker.isnot(None))
    )
    if chamber:
        stmt = stmt.where(Trade.chamber == chamber.lower())
    if party:
        stmt = stmt.where(Trade.party == party.upper())
    if ticker:
        stmt = stmt.where(Trade.ticker == ticker.upper())

    stmt = stmt.order_by(Trade.disclosure_date.desc()).limit(10000)
    result = await db.execute(stmt)
    trades = result.scalars().all()

    return {
        "exported_at": datetime.utcnow().isoformat(),
        "total": len(trades),
        "trades": [
            {
                "politician": t.politician,
                "party": t.party,
                "state": t.state,
                "chamber": t.chamber,
                "ticker": t.ticker,
                "asset_description": t.asset_description,
                "tx_type": t.tx_type,
                "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                "disclosure_date": t.disclosure_date.isoformat() if t.disclosure_date else None,
                "amount_low": t.amount_low,
                "amount_high": t.amount_high,
                "price_at_disclosure": t.price_at_disclosure,
                "price_current": t.price_current,
                "return_pct": t.return_since_disclosure,
            }
            for t in trades
        ],
    }


@router.get("/insiders/csv")
async def export_insiders_csv(
    days: int = Query(default=90, ge=1, le=3650),
    ticker: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Export corporate insider trades (Form 4) as CSV."""
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(InsiderTrade)
        .where(InsiderTrade.filing_date >= since)
        .where(InsiderTrade.ticker.isnot(None))
    )
    if ticker:
        stmt = stmt.where(InsiderTrade.ticker == ticker.upper())

    stmt = stmt.order_by(InsiderTrade.filing_date.desc()).limit(10000)
    result = await db.execute(stmt)
    trades = result.scalars().all()

    rows = [
        {
            "insider_name": t.insider_name,
            "insider_title": t.insider_title,
            "issuer_name": t.issuer_name,
            "ticker": t.ticker,
            "tx_type": t.tx_type,
            "tx_date": str(t.tx_date)[:10] if t.tx_date else "",
            "filing_date": str(t.filing_date)[:10] if t.filing_date else "",
            "shares": t.shares or "",
            "price_per_share": t.price_per_share or "",
            "total_value": t.total_value or "",
            "shares_after": t.shares_after or "",
            "return_since_filing": t.return_since_filing or "",
        }
        for t in trades
    ]

    return _make_csv_response(rows, f"smartflow_insider_trades_{days}d.csv")


@router.get("/hedge-funds/csv")
async def export_hedge_fund_csv(
    cik: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Export hedge fund holdings (13F) as CSV."""
    stmt = select(HedgeFundHolding)
    if cik:
        stmt = stmt.where(HedgeFundHolding.fund_cik == cik)

    stmt = stmt.order_by(HedgeFundHolding.report_date.desc()).limit(10000)
    result = await db.execute(stmt)
    holdings = result.scalars().all()

    rows = [
        {
            "fund_cik": h.fund_cik,
            "report_date": h.report_date,
            "issuer_name": h.issuer_name,
            "ticker": h.ticker,
            "cusip": h.cusip,
            "value_usd": h.value or "",
            "shares": h.shares or "",
            "share_type": h.share_type,
            "is_new_position": h.is_new_position,
            "shares_change_pct": h.shares_change_pct or "",
        }
        for h in holdings
    ]

    return _make_csv_response(rows, "smartflow_hedge_fund_holdings.csv")
