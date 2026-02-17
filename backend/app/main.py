"""SmartFlow API - Copy trading intelligence for Congressional trades.

Core functionality: Ingest STOCK Act disclosures, simulate copy-trading
portfolios, and rank politicians by trading performance.
"""

import logging
import os
import resource
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as congress_router
from app.api.leaderboard import router as leaderboard_router
from app.config import INGESTION_INTERVAL_MINUTES
from app.models.database import init_db
from app.services.ingestion import run_ingestion
from app.services.historical_ingestion import run_historical_ingestion
from app.services.capitoltrades import run_capitoltrades_ingestion
from app.services.performance import run_performance_update, run_price_refresh

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

    has_data = await _check_db_has_data()
    if has_data:
        logger.info("Database already has data - skipping historical ingestion (PostgreSQL persistent)")

    jobs = [
        ("Congressional trades", run_ingestion, False),
        ("Senate historical trades (2012+)", run_historical_ingestion, True),
        ("House trades (CapitolTrades)", lambda: run_capitoltrades_ingestion(chamber="house"), True),
        ("Politician stats + prices", lambda: run_performance_update(price_limit=50000), False),
        ("Refresh current prices", run_price_refresh, False),
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

    # Phase 1: Init DB
    logger.info("Initializing database...")
    try:
        await init_db()
    except Exception as e:
        logger.error(f"Database init failed: {e}")

    logger.info(f"Database ready. Memory: {_get_memory_mb():.0f} MB.")

    # Phase 2: Setup scheduler
    try:
        scheduler.add_job(
            run_ingestion, "interval",
            minutes=INGESTION_INTERVAL_MINUTES,
            id="congress", name="Congressional trade ingestion",
        )
        scheduler.add_job(
            lambda: run_capitoltrades_ingestion(chamber="house", max_pages=100),
            "interval",
            hours=6,
            id="capitoltrades", name="CapitolTrades House trade refresh",
        )
        scheduler.add_job(
            lambda: run_performance_update(price_limit=20000), "interval",
            minutes=60,
            id="performance", name="Price new trades",
        )
        scheduler.add_job(
            run_price_refresh, "interval",
            minutes=15,
            id="price_refresh", name="Refresh current prices + leaderboard",
        )
        scheduler.start()
        logger.info("All 4 schedulers started")
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
    description="Track and copy-trade Congressional stock trades (STOCK Act disclosures).",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount core routers
app.include_router(congress_router, prefix="/api/v1")
app.include_router(leaderboard_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "name": "SmartFlow API",
        "version": "1.0.0",
        "docs": "/docs",
        "description": "Copy trading intelligence - Congressional STOCK Act trades",
        "endpoints": {
            "trades": "/api/v1/trades",
            "politicians": "/api/v1/politicians",
            "leaderboard": "/api/v1/leaderboard",
            "stats": "/api/v1/stats",
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


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
    }
