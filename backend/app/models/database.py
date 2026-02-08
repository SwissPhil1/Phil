from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL


class Base(DeclarativeBase):
    pass


# --- Congressional Trades (STOCK Act) ---


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    chamber = Column(String(10), nullable=False, index=True)  # "house" or "senate"
    politician = Column(String(200), nullable=False, index=True)
    party = Column(String(5), index=True)
    state = Column(String(5))
    district = Column(String(10))

    ticker = Column(String(20), index=True)
    asset_description = Column(Text)
    asset_type = Column(String(50))
    tx_type = Column(String(50), index=True)
    tx_date = Column(DateTime, index=True)
    disclosure_date = Column(DateTime, index=True)
    amount_low = Column(Float)
    amount_high = Column(Float)
    comment = Column(Text)

    price_at_disclosure = Column(Float)
    price_current = Column(Float)
    price_30d_after = Column(Float)
    price_90d_after = Column(Float)
    return_since_disclosure = Column(Float)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    notified = Column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint(
            "chamber", "politician", "ticker", "tx_date", "tx_type", "amount_low",
            name="uq_trade",
        ),
    )


class Politician(Base):
    __tablename__ = "politicians"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True)
    chamber = Column(String(10))
    party = Column(String(5))
    state = Column(String(5))
    district = Column(String(10))

    total_trades = Column(Integer, default=0)
    total_buys = Column(Integer, default=0)
    total_sells = Column(Integer, default=0)
    avg_return = Column(Float)
    win_rate = Column(Float)
    last_trade_date = Column(DateTime)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# --- 13F Hedge Fund Holdings ---


class HedgeFund(Base):
    __tablename__ = "hedge_funds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    manager_name = Column(String(200), nullable=False)
    cik = Column(String(20), nullable=False, unique=True, index=True)

    total_value = Column(Float)  # Total portfolio value in USD
    num_holdings = Column(Integer)
    last_filing_date = Column(DateTime)
    report_date = Column(DateTime)  # Quarter end date

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HedgeFundHolding(Base):
    __tablename__ = "hedge_fund_holdings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fund_cik = Column(String(20), nullable=False, index=True)
    report_date = Column(String(10), nullable=False, index=True)  # "2025-09-30"

    issuer_name = Column(String(300))
    title_of_class = Column(String(100))
    cusip = Column(String(20), index=True)
    ticker = Column(String(20), index=True)
    value = Column(Float)  # Market value in USD
    shares = Column(Float)
    share_type = Column(String(10))  # SH or PRN
    put_call = Column(String(10))  # Put, Call, or None
    investment_discretion = Column(String(10))
    voting_sole = Column(Integer)
    voting_shared = Column(Integer)
    voting_none = Column(Integer)

    # Change tracking (vs previous quarter)
    prev_shares = Column(Float)
    shares_change = Column(Float)
    shares_change_pct = Column(Float)
    is_new_position = Column(Boolean, default=False)
    is_closed_position = Column(Boolean, default=False)

    price_current = Column(Float)
    return_since_report = Column(Float)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "fund_cik", "report_date", "cusip", "put_call",
            name="uq_holding",
        ),
    )


# --- Form 4 Corporate Insider Trades ---


class InsiderTrade(Base):
    __tablename__ = "insider_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    insider_name = Column(String(200), nullable=False, index=True)
    insider_cik = Column(String(20))
    insider_title = Column(String(200))  # CEO, CFO, Director, etc.
    is_director = Column(Boolean)
    is_officer = Column(Boolean)
    is_ten_pct_owner = Column(Boolean)

    issuer_name = Column(String(200), nullable=False, index=True)
    issuer_cik = Column(String(20))
    ticker = Column(String(20), index=True)

    tx_date = Column(DateTime, index=True)
    filing_date = Column(DateTime, index=True)
    tx_code = Column(String(5))  # P=purchase, S=sale, M=exercise, A=award, G=gift
    tx_type = Column(String(20))  # purchase, sale, exercise, award, gift
    shares = Column(Float)
    price_per_share = Column(Float)
    total_value = Column(Float)
    shares_after = Column(Float)  # Post-transaction holdings
    acquired_disposed = Column(String(5))  # A or D

    accession_number = Column(String(50), index=True)

    price_current = Column(Float)
    return_since_filing = Column(Float)
    notified = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "insider_cik", "ticker", "tx_date", "tx_code", "shares",
            name="uq_insider_trade",
        ),
    )


# --- Polymarket Trader Tracking ---


class PolymarketTrader(Base):
    __tablename__ = "polymarket_traders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    wallet = Column(String(50), nullable=False, unique=True, index=True)
    username = Column(String(200))
    x_username = Column(String(200))  # Twitter handle
    verified = Column(Boolean, default=False)

    pnl_all = Column(Float)
    pnl_month = Column(Float)
    pnl_week = Column(Float)
    volume_all = Column(Float)
    volume_month = Column(Float)
    portfolio_value = Column(Float)
    rank_all = Column(Integer)
    rank_month = Column(Integer)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PolymarketPosition(Base):
    __tablename__ = "polymarket_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    wallet = Column(String(50), nullable=False, index=True)
    condition_id = Column(String(100), nullable=False, index=True)

    market_title = Column(String(500))
    market_slug = Column(String(500))
    outcome = Column(String(100))
    outcome_index = Column(Integer)
    opposite_outcome = Column(String(100))

    size = Column(Float)
    avg_price = Column(Float)
    current_price = Column(Float)
    initial_value = Column(Float)
    current_value = Column(Float)
    cash_pnl = Column(Float)
    percent_pnl = Column(Float)
    realized_pnl = Column(Float)

    end_date = Column(DateTime)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "wallet", "condition_id", "outcome",
            name="uq_poly_position",
        ),
    )


class PolymarketTrade(Base):
    __tablename__ = "polymarket_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    wallet = Column(String(50), nullable=False, index=True)
    condition_id = Column(String(100), index=True)
    tx_hash = Column(String(100), unique=True, index=True)

    side = Column(String(10))  # BUY or SELL
    size = Column(Float)
    price = Column(Float)
    timestamp = Column(DateTime, index=True)

    market_title = Column(String(500))
    outcome = Column(String(100))
    outcome_index = Column(Integer)

    created_at = Column(DateTime, default=datetime.utcnow)


# --- Kalshi Market Data ---


class KalshiMarket(Base):
    __tablename__ = "kalshi_markets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticker = Column(String(100), nullable=False, unique=True, index=True)
    event_ticker = Column(String(100), index=True)
    title = Column(String(500))
    status = Column(String(20))

    last_price = Column(Float)
    yes_bid = Column(Float)
    yes_ask = Column(Float)
    volume = Column(Integer)
    open_interest = Column(Integer)
    liquidity = Column(Float)

    close_time = Column(DateTime)
    result = Column(String(20))

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


engine = create_async_engine(DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with async_session() as session:
        yield session
