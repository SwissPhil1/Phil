"""Congress Trades API - Autopilot for Europe."""

import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import INGESTION_INTERVAL_MINUTES
from app.models.database import init_db
from app.services.ingestion import run_ingestion
from app.services.performance import run_performance_update

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    await init_db()

    logger.info("Running initial data ingestion...")
    try:
        result = await run_ingestion()
        logger.info(f"Initial ingestion: {result}")
    except Exception as e:
        logger.error(f"Initial ingestion failed (will retry on schedule): {e}")

    # Schedule periodic ingestion
    scheduler.add_job(
        run_ingestion,
        "interval",
        minutes=INGESTION_INTERVAL_MINUTES,
        id="ingestion",
        name="Congressional trade data ingestion",
    )
    scheduler.add_job(
        run_performance_update,
        "interval",
        minutes=INGESTION_INTERVAL_MINUTES * 2,
        id="performance",
        name="Price and performance update",
    )
    scheduler.start()
    logger.info(f"Scheduler started: ingestion every {INGESTION_INTERVAL_MINUTES}min")

    yield

    # Shutdown
    scheduler.shutdown()
    logger.info("Scheduler stopped")


app = FastAPI(
    title="Congress Trades API",
    description=(
        "Track US congressional stock trades for European investors. "
        "Data sourced from STOCK Act disclosures via House & Senate Stock Watcher."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "name": "Congress Trades API",
        "version": "0.1.0",
        "docs": "/docs",
        "description": "Autopilot for Europe - Track and copy US congressional trades",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
