"""SmartFlow API - Copy the smartest money in the world.

Now backed by PostgreSQL for persistent data across deploys.
"""

import logging
import os
import resource
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.autopilot import router as autopilot_router
from app.api.hedge_funds import router as hedge_funds_router
from app.api.insiders import router as insiders_router
from app.api.leaderboard import router as leaderboard_router
from app.api.optimizer import router as optimizer_router
from app.api.prediction_markets import router as prediction_markets_router
from app.api.routes import router as congress_router
from app.api.signals import router as signals_router
from app.api.trump import router as trump_router
from app.config import INGESTION_INTERVAL_MINUTES
from app.models.database import init_db
from app.services.committees import run_committee_ingestion
from app.services.hedge_funds import run_13f_ingestion
from app.services.ingestion import run_ingestion
from app.services.insiders import run_insider_ingestion
from app.services.historical_ingestion import run_historical_ingestion
from app.services.performance import run_performance_update
from app.services.prediction_markets import run_kalshi_ingestion, run_polymarket_ingestion
from app.services.trump_tracker import run_trump_data_ingestion

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def _get_memory_mb():
    """Get current RSS memory usage in MB."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


async def _check_db_has_data() -> bool:
    """Check if the database already has substantial data (i.e., persisted from prior run)."""
    try:
        from sqlalchemy import func, select
        from app.models.database import Trade, async_session
        async with async_session() as session:
            count = (await session.execute(select(func.count()).select_from(Trade))).scalar()
            return (count or 0) > 1000
    except Exception:
        return False


async def _run_initial_ingestions():
    """Run all initial ingestions in background so the app starts immediately."""
    import asyncio
    await asyncio.sleep(30)

    # If DB already has data (PostgreSQL persists across deploys), skip heavy historical ingestion
    has_data = await _check_db_has_data()
    if has_data:
        logger.info("Database already has data - skipping historical ingestion (PostgreSQL persistent)")

    jobs = [
        ("Trump & inner circle data", run_trump_data_ingestion, False),
        ("Committee assignments", run_committee_ingestion, False),
        ("Congressional trades", run_ingestion, False),
        ("Form 4 insider trades", run_insider_ingestion, False),
        ("Polymarket traders", run_polymarket_ingestion, False),
        ("Kalshi markets", run_kalshi_ingestion, False),
        ("13F hedge fund holdings", run_13f_ingestion, False),
        ("Senate historical trades (2012+)", run_historical_ingestion, True),  # skip if has data
        ("Politician stats + prices", lambda: run_performance_update(price_limit=500), False),
    ]

    for name, fn, skip_if_has_data in jobs:
        if skip_if_has_data and has_data:
            logger.info(f"Skipping {name} (data already exists)")
            continue
        try:
            logger.info(f"Background ingestion: {name}... (mem: {_get_memory_mb():.0f} MB)")
            result = await fn()
            logger.info(f"{name}: {result}")
        except BaseException as e:
            logger.error(f"{name} ingestion failed (will retry on schedule): {e}")
            if isinstance(e, (SystemExit, KeyboardInterrupt)):
                raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    # Phase 1: Init DB (fast, required)
    logger.info("Initializing database...")
    try:
        await init_db()
    except Exception as e:
        logger.error(f"Database init failed: {e}")

    logger.info(f"Database ready. Memory: {_get_memory_mb():.0f} MB.")

    # Phase 2: Setup scheduler (wrapped so it never blocks startup)
    try:
        scheduler.add_job(
            run_ingestion, "interval",
            minutes=INGESTION_INTERVAL_MINUTES,
            id="congress", name="Congressional trade ingestion",
        )
        scheduler.add_job(
            run_13f_ingestion, "interval",
            hours=6,
            id="hedge_funds", name="13F hedge fund ingestion",
        )
        scheduler.add_job(
            run_insider_ingestion, "interval",
            hours=2,
            id="insiders", name="Form 4 insider trade ingestion",
        )
        scheduler.add_job(
            run_polymarket_ingestion, "interval",
            minutes=30,
            id="polymarket", name="Polymarket trader ingestion",
        )
        scheduler.add_job(
            run_kalshi_ingestion, "interval",
            hours=1,
            id="kalshi", name="Kalshi market data ingestion",
        )
        scheduler.add_job(
            run_committee_ingestion, "interval",
            hours=24,
            id="committees", name="Committee assignment ingestion",
        )
        scheduler.add_job(
            run_performance_update, "interval",
            minutes=INGESTION_INTERVAL_MINUTES * 2,
            id="performance", name="Price and performance update",
        )
        scheduler.start()
        logger.info("All 7 schedulers started")
    except Exception as e:
        logger.error(f"Scheduler setup failed (app will still run): {e}")

    # Phase 3: Background ingestion (non-blocking, 30s delay)
    try:
        asyncio.create_task(_run_initial_ingestions())
    except Exception as e:
        logger.error(f"Failed to create ingestion task: {e}")

    logger.info("Lifespan complete - app is accepting requests.")

    yield

    try:
        scheduler.shutdown()
    except Exception:
        pass
    logger.info("Shutting down.")


app = FastAPI(
    title="SmartFlow API",
    description=(
        "Track and copy the smartest money in the world. "
        "Congressional trades (STOCK Act), hedge fund holdings (13F), "
        "corporate insider trades (Form 4), and prediction market whales (Polymarket/Kalshi). "
        "Built for European investors."
    ),
    version="0.4.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers
app.include_router(congress_router, prefix="/api/v1")
app.include_router(hedge_funds_router, prefix="/api/v1")
app.include_router(insiders_router, prefix="/api/v1")
app.include_router(prediction_markets_router, prefix="/api/v1")
app.include_router(autopilot_router, prefix="/api/v1")
app.include_router(signals_router, prefix="/api/v1")
app.include_router(trump_router, prefix="/api/v1")
app.include_router(leaderboard_router, prefix="/api/v1")
app.include_router(optimizer_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "name": "SmartFlow API",
        "version": "0.4.0",
        "docs": "/docs",
        "description": "Copy the smartest money - Congress, hedge funds, insiders, prediction markets, Trump tracker",
        "endpoints": {
            "congress": "/api/v1/trades",
            "hedge_funds": "/api/v1/hedge-funds",
            "insiders": "/api/v1/insiders",
            "polymarket": "/api/v1/prediction-markets/polymarket",
            "kalshi": "/api/v1/prediction-markets/kalshi",
            "autopilot": "/api/v1/autopilot",
            "signals": "/api/v1/signals",
            "trump": "/api/v1/trump",
            "leaderboard": "/api/v1/leaderboard",
            "optimizer": "/api/v1/optimizer",
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.4.0", "branch": "claude/investment-tracking-app-phNcX"}


@app.get("/debug")
async def debug():
    """Diagnostic endpoint showing memory, env, and process info."""
    import sys
    return {
        "memory_mb": round(_get_memory_mb(), 1),
        "python": sys.version,
        "pid": os.getpid(),
        "port": os.environ.get("PORT", "not set"),
        "scheduler_running": scheduler.running,
        "scheduled_jobs": len(scheduler.get_jobs()) if scheduler.running else 0,
        "env_keys": sorted(os.environ.keys()),
    }
