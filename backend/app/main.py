"""SmartFlow API - Copy the smartest money in the world."""

import logging
import os
import resource
from contextlib import asynccontextmanager

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
from app.models.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def _get_memory_mb():
    """Get current RSS memory usage in MB."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - init DB only (keep it minimal so healthcheck passes fast)
    logger.info("Initializing database...")
    try:
        await init_db()
    except Exception as e:
        logger.error(f"Database init failed: {e}")

    logger.info(f"Database ready. Memory: {_get_memory_mb():.0f} MB. App is accepting requests.")

    yield

    logger.info("Shutting down.")


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
app.include_router(leaderboard_router, prefix="/api/v1")
app.include_router(optimizer_router, prefix="/api/v1")


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
        "env_keys": sorted(os.environ.keys()),
    }
