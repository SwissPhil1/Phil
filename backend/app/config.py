import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# Database URL: supports PostgreSQL (Railway) and SQLite (local dev).
# Railway sets DATABASE_URL to a PostgreSQL URL from its addon.
_default_db = f"sqlite+aiosqlite:///{BASE_DIR}/congress_trades.db"
_env_url = os.getenv("SMARTFLOW_DB_URL") or os.getenv("DATABASE_URL") or ""

if _env_url:
    # Convert postgres:// or postgresql:// to async driver format
    if _env_url.startswith("postgres://"):
        DATABASE_URL = _env_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif _env_url.startswith("postgresql://"):
        DATABASE_URL = _env_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif "sqlite" in _env_url:
        DATABASE_URL = _env_url
    else:
        DATABASE_URL = _env_url  # Trust whatever is set
else:
    DATABASE_URL = _default_db

# Official government data source URLs
HOUSE_FD_ZIP_URL = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"
HOUSE_SEARCH_URL = "https://disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult"
SENATE_EFD_HOME = "https://efdsearch.senate.gov/search/home/"
SENATE_EFD_AGREE = "https://efdsearch.senate.gov/search/report/agree/"
SENATE_EFD_DATA = "https://efdsearch.senate.gov/search/report/data/"

# Ingestion schedule (minutes)
INGESTION_INTERVAL_MINUTES = int(os.getenv("INGESTION_INTERVAL_MINUTES", "60"))

# API settings
API_PAGE_SIZE = int(os.getenv("API_PAGE_SIZE", "50"))

# Years to ingest (current + previous)
INGESTION_YEARS = [2024, 2025, 2026]
