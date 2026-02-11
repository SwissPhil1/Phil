"""API endpoints for the conviction score optimizer."""

import logging

from fastapi import APIRouter, Query

from app.services.optimizer import run_optimization, WeightConfig, evaluate_formula, extract_trade_features, cross_validate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/optimizer", tags=["optimizer"])


@router.get("/run")
async def run_optimizer(
    lookback_days: int = Query(730, description="How far back to look for trade data"),
    max_trades: int = Query(500, description="Maximum trades to analyze"),
    generations: int = Query(3, description="Number of evolutionary generations"),
    top_n: int = Query(10, description="Number of top formulas to return"),
):
    """
    Run the automated conviction score optimizer.

    Tests hundreds of weight combinations, evolves the best ones,
    and cross-validates to find formulas that actually predict returns.

    This is a long-running operation (1-5 minutes depending on data).
    """
    try:
        result = await run_optimization(
            lookback_days=lookback_days,
            max_trades=max_trades,
            generations=generations,
            top_n=top_n,
        )
        if "error" in result:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=422, content=result)
        return result
    except Exception as e:
        logger.error(f"Optimizer run failed: {e}")
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e), "status": "failed"})


@router.get("/test-weights")
async def test_custom_weights(
    position_size_max: float = Query(25.0),
    committee_overlap_max: float = Query(30.0),
    disclosure_speed_max: float = Query(15.0),
    cluster_max: float = Query(20.0),
    cross_source_insider_max: float = Query(15.0),
    cross_source_fund_max: float = Query(10.0),
    track_record_max: float = Query(15.0),
    contrarian_max: float = Query(10.0),
    lookback_days: int = Query(365),
    max_trades: int = Query(300),
):
    """
    Test a specific set of custom weights against historical data.
    Useful for manually tuning the formula.
    """
    try:
        weights = WeightConfig(
            position_size_max=position_size_max,
            committee_overlap_max=committee_overlap_max,
            disclosure_speed_max=disclosure_speed_max,
            cluster_max=cluster_max,
            cross_source_insider_max=cross_source_insider_max,
            cross_source_fund_max=cross_source_fund_max,
            track_record_max=track_record_max,
            contrarian_max=contrarian_max,
        )

        trades = await extract_trade_features(days=lookback_days, max_trades=max_trades)
        if not trades:
            return {"error": "No trades with return data found"}

        result = evaluate_formula(trades, weights)
        cv = cross_validate(trades, weights)

        return {
            "weights": weights.to_dict(),
            "result": result.to_dict(),
            "cross_validation": cv,
            "trades_analyzed": len(trades),
        }
    except Exception as e:
        logger.error(f"Test weights failed: {e}")
        return {"error": str(e), "status": "failed"}


@router.get("/status")
async def optimizer_status():
    """Check what data is available for optimization."""
    try:
        trades = await extract_trade_features(days=730, max_trades=10)
        return {
            "status": "ready" if trades else "no_data",
            "sample_trades": len(trades),
            "detail": (
                "Optimizer has trade data with returns ready for analysis"
                if trades else
                "No historical trades with return data found. Run data ingestion first."
            ),
        }
    except Exception as e:
        logger.error(f"Optimizer status check failed: {e}")
        return {
            "status": "error",
            "sample_trades": 0,
            "detail": f"Status check failed: {e}",
        }
