"""API routes for conviction score backtesting and politician leaderboard."""

from fastapi import APIRouter, Query

from app.services.backtester import (
    backtest_conviction_scores,
    get_most_profitable_trades,
    get_politician_leaderboard,
)

router = APIRouter(prefix="/leaderboard", tags=["Leaderboard & Backtest"])


@router.get("/")
async def get_leaderboard(
    year: int | None = Query(default=None, description="Filter by year (e.g. 2025). Omit for all years."),
    min_trades: int = Query(default=3, ge=1, description="Minimum trades to be ranked"),
    chamber: str | None = Query(default=None, description="Filter: house or senate"),
):
    """
    Politician trading leaderboard - who makes the best trades?

    Returns rankings by average return, win rate, consistency across years.
    Also shows party comparison (are Democrats or Republicans better traders?).
    """
    return await get_politician_leaderboard(
        year=year,
        min_trades=min_trades,
        chamber=chamber,
    )


@router.get("/best-trades")
async def best_trades(
    days: int = Query(default=365, ge=30, le=3650),
    limit: int = Query(default=50, ge=1, le=200),
):
    """
    The most profitable individual congressional trades.
    Ranked by return since disclosure.
    """
    return await get_most_profitable_trades(days=days, limit=limit)


@router.get("/backtest")
async def run_backtest(
    days: int = Query(default=365, ge=30, le=1825, description="Lookback period"),
    forward_days: int = Query(default=30, ge=7, le=180, description="Forward return period (days after trade)"),
    max_trades: int = Query(default=100, ge=10, le=500, description="Max trades to score (more = slower, uses yfinance)"),
    return_mode: str = Query(
        default="both",
        description=(
            "How to measure returns: "
            "'forward' = fixed N-day window after purchase, "
            "'exit' = actual return when politician sold (real P&L), "
            "'both' = show both + compare if politicians time exits well"
        ),
    ),
):
    """
    Backtest the conviction scoring system against real trade outcomes.

    Three return modes:
    - **forward**: What did the stock do N days after the politician bought?
    - **exit**: What was the actual P&L when the politician SOLD? (matches
      buy→sell pairs per politician per ticker). Shows holding period,
      entry/exit prices, and realized return.
    - **both**: Shows both + a forward_vs_exit comparison that reveals
      whether politicians time their exits well (do they sell at the right time
      or leave money on the table?)

    NOTE: SLOW (5-60 seconds) - calls yfinance for price data per trade.

    Returns:
    - Score bucket analysis (avg return per bucket)
    - Score validation (do high scores beat low scores?)
    - Committee analysis (do committee overlap trades outperform?)
    - Forward vs exit comparison (do politicians time exits well?)
    - Small cap vs large cap hypothesis test
    - Top scored trades with entry, exit, holding period, and all returns
    """
    return await backtest_conviction_scores(
        days=days,
        forward_days=forward_days,
        max_trades=max_trades,
        return_mode=return_mode,
    )
