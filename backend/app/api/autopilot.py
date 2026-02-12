"""API routes for Autopilot portfolio monitoring."""

from fastapi import APIRouter

from app.services.autopilot import (
    get_portfolio_mapping,
    get_enriched_portfolio_mapping,
    scrape_all_portfolios,
)

router = APIRouter(prefix="/autopilot", tags=["Autopilot Monitoring"])


@router.get("/portfolios")
async def list_autopilot_portfolios():
    """
    List all known Autopilot portfolios and how they map to our data sources.
    Shows which portfolios we can replicate from public data.
    """
    return get_portfolio_mapping()


@router.get("/portfolios/enriched")
async def list_enriched_portfolios():
    """
    List Autopilot portfolios enriched with our own portfolio data.
    For politician trackers, includes our copy-trading simulation results.
    For hedge fund trackers, includes our 13F holdings data.
    """
    return await get_enriched_portfolio_mapping()


@router.post("/scrape")
async def scrape_autopilot_performance():
    """
    Scrape latest performance data from Autopilot marketplace pages.
    Returns AUM and performance metrics for portfolios with known URLs.
    """
    return await scrape_all_portfolios()
