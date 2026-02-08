"""SmartFlow API - Copy the smartest money in the world."""

import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.autopilot import router as autopilot_router
from app.api.hedge_funds import router as hedge_funds_router
from app.api.insiders import router as insiders_router
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
from app.services.performance import run_performance_update
from app.services.prediction_markets import run_kalshi_ingestion, run_polymarket_ingestion
from app.services.trump_tracker import run_trump_data_ingestion

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

    # Run initial ingestions (congressional trades first, then others)
    for name, fn in [
        ("Congressional trades", run_ingestion),
        ("13F hedge fund holdings", run_13f_ingestion),
        ("Form 4 insider trades", run_insider_ingestion),
        ("Polymarket traders", run_polymarket_ingestion),
        ("Kalshi markets", run_kalshi_ingestion),
        ("Committee assignments", run_committee_ingestion),
        ("Trump & inner circle data", run_trump_data_ingestion),
    ]:
        try:
            logger.info(f"Running initial {name} ingestion...")
            result = await fn()
            logger.info(f"{name}: {result}")
        except Exception as e:
            logger.error(f"{name} ingestion failed (will retry on schedule): {e}")

    # Schedule periodic jobs
    scheduler.add_job(
        run_ingestion, "interval",
        minutes=INGESTION_INTERVAL_MINUTES,
        id="congress", name="Congressional trade ingestion",
    )
    scheduler.add_job(
        run_13f_ingestion, "interval",
        hours=6,  # 13F filings are quarterly, check every 6h
        id="hedge_funds", name="13F hedge fund ingestion",
    )
    scheduler.add_job(
        run_insider_ingestion, "interval",
        hours=2,  # Form 4 filings come in daily
        id="insiders", name="Form 4 insider trade ingestion",
    )
    scheduler.add_job(
        run_polymarket_ingestion, "interval",
        minutes=30,  # Polymarket positions change frequently
        id="polymarket", name="Polymarket trader ingestion",
    )
    scheduler.add_job(
        run_kalshi_ingestion, "interval",
        hours=1,
        id="kalshi", name="Kalshi market data ingestion",
    )
    scheduler.add_job(
        run_committee_ingestion, "interval",
        hours=24,  # Committees change rarely
        id="committees", name="Committee assignment ingestion",
    )
    scheduler.add_job(
        run_performance_update, "interval",
        minutes=INGESTION_INTERVAL_MINUTES * 2,
        id="performance", name="Price and performance update",
    )
    scheduler.start()
    logger.info("All schedulers started")

    yield

    scheduler.shutdown()
    logger.info("Scheduler stopped")


app = FastAPI(
    title="SmartFlow API",
    description=(
        "Track and copy the smartest money in the world. "
        "Congressional trades (STOCK Act), hedge fund holdings (13F), "
        "corporate insider trades (Form 4), and prediction market whales (Polymarket/Kalshi). "
        "Built for European investors."
    ),
    version="0.3.0",
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


@app.get("/")
async def root():
    return {
        "name": "SmartFlow API",
        "version": "0.3.0",
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
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
