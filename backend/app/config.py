import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{BASE_DIR}/congress_trades.db")

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
