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
    JSON,
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

    # Portfolio-simulated returns (single source of truth for leaderboard)
    portfolio_return = Column(Float)       # Total return % (equal-weight copy trading)
    portfolio_cagr = Column(Float)         # Annual CAGR % (equal-weight)
    conviction_return = Column(Float)      # Total return % (conviction-weighted)
    conviction_cagr = Column(Float)        # Annual CAGR % (conviction-weighted)
    priced_buy_count = Column(Integer, default=0)  # Buys with price data
    years_active = Column(Float)           # Trading span in years

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


# --- Politician Committee Assignments ---


class PoliticianCommittee(Base):
    __tablename__ = "politician_committees"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bioguide_id = Column(String(20), nullable=False, index=True)
    politician_name = Column(String(200), nullable=False, index=True)
    party = Column(String(50))
    state = Column(String(5))
    chamber = Column(String(10))

    committee_id = Column(String(20), nullable=False, index=True)
    committee_name = Column(String(300), nullable=False)
    role = Column(String(100))  # Chair, Ranking Member, Member
    rank = Column(Integer)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("bioguide_id", "committee_id", name="uq_politician_committee"),
    )


# --- Trump & Inner Circle Tracking ---


class TrumpInsider(Base):
    __tablename__ = "trump_insiders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True, index=True)
    role = Column(String(300))
    category = Column(String(50), index=True)  # family, associate, appointee, donor
    relationship = Column(String(200))

    known_interests = Column(Text)  # semicolon-separated
    board_seats = Column(Text)  # semicolon-separated
    tickers = Column(String(200))  # comma-separated
    sec_ciks = Column(String(200))  # comma-separated
    notes = Column(Text)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TrumpConnection(Base):
    __tablename__ = "trump_connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_name = Column(String(300), nullable=False, unique=True, index=True)
    ticker = Column(String(20), index=True)
    connection_description = Column(Text)
    category = Column(String(50), index=True)  # trump_owned, musk_empire, defense_tech, etc.
    sector = Column(String(100))
    connected_insiders = Column(Text)  # comma-separated names

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TrumpDonor(Base):
    __tablename__ = "trump_donors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True, index=True)
    amount_known = Column(Float)
    entity = Column(String(300))  # PAC name
    interests = Column(Text)  # semicolon-separated

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# --- Optimized Scoring Weights ---


class OptimizedWeights(Base):
    """Stores optimizer-determined scoring weights for the conviction formula."""
    __tablename__ = "optimized_weights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, default="active", index=True)
    weights_json = Column(Text, nullable=False)  # JSON-serialized WeightConfig dict
    fitness = Column(Float)
    hit_rate_90d = Column(Float)
    edge_90d = Column(Float)
    correlation_90d = Column(Float)
    is_robust = Column(Boolean, default=False)
    trades_analyzed = Column(Integer)
    full_result_json = Column(Text, nullable=True)  # Full optimizer output JSON for UI persistence
    applied_at = Column(DateTime, default=datetime.utcnow)


# --- Ticker Price Cache ---


class TickerPrice(Base):
    """Cached price data per ticker. One Yahoo call per ticker, shared across all trades."""
    __tablename__ = "ticker_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticker = Column(String(20), nullable=False, index=True)
    date = Column(String(10), nullable=False, index=True)  # "2025-01-15"
    close_price = Column(Float, nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("ticker", "date", name="uq_ticker_price"),
    )


class TickerCurrentPrice(Base):
    """Latest price per ticker, refreshed every 15 min."""
    __tablename__ = "ticker_current_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticker = Column(String(20), nullable=False, unique=True, index=True)
    price = Column(Float, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


# --- Saved AI Search Segments ---


class SavedSegment(Base):
    """Saved AI search queries that auto-refresh with latest data."""
    __tablename__ = "saved_segments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(300), nullable=False)
    query = Column(Text, nullable=False)           # Original natural language query
    sql = Column(Text, nullable=False)             # Generated SQL to re-execute
    columns_json = Column(Text)                    # JSON: column names
    results_json = Column(Text)                    # JSON: cached result rows
    result_count = Column(Integer, default=0)
    summary = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)
    refreshed_at = Column(DateTime, default=datetime.utcnow)


# Dialect-aware insert for upserts (on_conflict_do_nothing / on_conflict_do_update)
# Both PostgreSQL and SQLite dialects support the same API.
if "postgresql" in DATABASE_URL or "postgres" in DATABASE_URL:
    from sqlalchemy.dialects.postgresql import insert as dialect_insert
else:
    from sqlalchemy.dialects.sqlite import insert as dialect_insert

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Ensure all expected columns exist (create_all doesn't ALTER existing tables)
    if "postgresql" in DATABASE_URL or "postgres" in DATABASE_URL:
        await _migrate_missing_columns()


async def _migrate_missing_columns():
    """Add any columns that were added to the models after the table was first created."""
    import logging
    logger = logging.getLogger(__name__)

    # Map of table -> list of (column_name, column_type_sql, default)
    migrations = {
        "politicians": [
            ("portfolio_return", "DOUBLE PRECISION", None),
            ("portfolio_cagr", "DOUBLE PRECISION", None),
            ("conviction_return", "DOUBLE PRECISION", None),
            ("conviction_cagr", "DOUBLE PRECISION", None),
            ("priced_buy_count", "INTEGER", "0"),
            ("years_active", "DOUBLE PRECISION", None),
            ("total_buys", "INTEGER", "0"),
            ("total_sells", "INTEGER", "0"),
            ("district", "VARCHAR(10)", None),
        ],
        "optimized_weights": [
            ("full_result_json", "TEXT", None),
        ],
    }

    async with engine.begin() as conn:
        for table, columns in migrations.items():
            for col_name, col_type, default in columns:
                try:
                    default_clause = f" DEFAULT {default}" if default else ""
                    await conn.execute(
                        __import__("sqlalchemy").text(
                            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
                            f"{col_name} {col_type}{default_clause}"
                        )
                    )
                except Exception as e:
                    logger.debug(f"Column {table}.{col_name} migration: {e}")


async def get_db():
    async with async_session() as session:
        yield session
