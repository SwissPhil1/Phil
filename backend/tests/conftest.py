"""Shared test fixtures for SmartFlow backend tests."""

import asyncio
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

# Override DB URL before any imports
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///test_smartflow.db"

from app.models.database import Base, Trade, Politician, InsiderTrade, HedgeFund, HedgeFundHolding, get_db
from app.main import app


# Use a test database (in-memory SQLite)
TEST_DB_URL = "sqlite+aiosqlite:///test_smartflow.db"
test_engine = create_async_engine(TEST_DB_URL, echo=False)
TestSession = sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create and tear down the test database for each test."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def get_test_db():
    async with TestSession() as session:
        yield session


@pytest_asyncio.fixture
async def db_session():
    async with TestSession() as session:
        yield session


@pytest_asyncio.fixture
async def client():
    """Async HTTP client for testing FastAPI endpoints."""
    app.dependency_overrides[get_db] = get_test_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seed_trades(db_session: AsyncSession):
    """Seed the database with sample congressional trades."""
    now = datetime.utcnow()
    trades = [
        Trade(
            chamber="house",
            politician="Nancy Pelosi",
            party="D",
            state="CA",
            ticker="AAPL",
            asset_description="Apple Inc",
            tx_type="purchase",
            tx_date=now - timedelta(days=10),
            disclosure_date=now - timedelta(days=5),
            amount_low=500000,
            amount_high=1000000,
            price_at_disclosure=180.0,
            price_current=195.0,
            return_since_disclosure=8.33,
            notified=False,
        ),
        Trade(
            chamber="house",
            politician="Nancy Pelosi",
            party="D",
            state="CA",
            ticker="NVDA",
            asset_description="NVIDIA Corp",
            tx_type="purchase",
            tx_date=now - timedelta(days=20),
            disclosure_date=now - timedelta(days=15),
            amount_low=1000000,
            amount_high=5000000,
            price_at_disclosure=450.0,
            price_current=500.0,
            return_since_disclosure=11.11,
            notified=False,
        ),
        Trade(
            chamber="senate",
            politician="Tommy Tuberville",
            party="R",
            state="AL",
            ticker="MSFT",
            asset_description="Microsoft Corp",
            tx_type="purchase",
            tx_date=now - timedelta(days=5),
            disclosure_date=now - timedelta(days=2),
            amount_low=15000,
            amount_high=50000,
            price_at_disclosure=380.0,
            price_current=390.0,
            return_since_disclosure=2.63,
            notified=False,
        ),
        Trade(
            chamber="senate",
            politician="Tommy Tuberville",
            party="R",
            state="AL",
            ticker="AAPL",
            asset_description="Apple Inc",
            tx_type="sale",
            tx_date=now - timedelta(days=3),
            disclosure_date=now - timedelta(days=1),
            amount_low=50000,
            amount_high=100000,
            notified=True,
        ),
    ]

    for t in trades:
        db_session.add(t)
    await db_session.commit()
    return trades


@pytest_asyncio.fixture
async def seed_politicians(db_session: AsyncSession):
    """Seed the database with sample politicians."""
    politicians = [
        Politician(
            name="Nancy Pelosi",
            chamber="house",
            party="D",
            state="CA",
            total_trades=50,
            total_buys=35,
            total_sells=15,
            avg_return=12.5,
            win_rate=0.72,
            portfolio_return=112.0,
            portfolio_cagr=28.5,
            priced_buy_count=30,
            years_active=5.2,
        ),
        Politician(
            name="Tommy Tuberville",
            chamber="senate",
            party="R",
            state="AL",
            total_trades=120,
            total_buys=80,
            total_sells=40,
            avg_return=-2.5,
            win_rate=0.45,
            portfolio_return=-15.0,
            portfolio_cagr=-3.8,
            priced_buy_count=60,
            years_active=3.1,
        ),
    ]

    for p in politicians:
        db_session.add(p)
    await db_session.commit()
    return politicians


@pytest_asyncio.fixture
async def seed_insider_trades(db_session: AsyncSession):
    """Seed the database with sample insider trades."""
    now = datetime.utcnow()
    trades = [
        InsiderTrade(
            insider_name="Jensen Huang",
            insider_cik="001234",
            insider_title="CEO",
            is_director=True,
            is_officer=True,
            issuer_name="NVIDIA Corp",
            issuer_cik="001045810",
            ticker="NVDA",
            tx_date=now - timedelta(days=3),
            filing_date=now - timedelta(days=1),
            tx_code="S",
            tx_type="sale",
            shares=10000,
            price_per_share=500.0,
            total_value=5000000,
            shares_after=90000,
            acquired_disposed="D",
        ),
        InsiderTrade(
            insider_name="Tim Cook",
            insider_cik="001235",
            insider_title="CEO",
            is_director=True,
            is_officer=True,
            issuer_name="Apple Inc",
            issuer_cik="0000320193",
            ticker="AAPL",
            tx_date=now - timedelta(days=5),
            filing_date=now - timedelta(days=2),
            tx_code="P",
            tx_type="purchase",
            shares=5000,
            price_per_share=180.0,
            total_value=900000,
            shares_after=100000,
            acquired_disposed="A",
        ),
    ]

    for t in trades:
        db_session.add(t)
    await db_session.commit()
    return trades
