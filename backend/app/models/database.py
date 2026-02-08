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


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    chamber = Column(String(10), nullable=False, index=True)  # "house" or "senate"
    politician = Column(String(200), nullable=False, index=True)
    party = Column(String(5), index=True)  # R, D, I
    state = Column(String(5))
    district = Column(String(10))

    ticker = Column(String(20), index=True)
    asset_description = Column(Text)
    asset_type = Column(String(50))
    tx_type = Column(String(50), index=True)  # purchase, sale, sale_full, sale_partial, exchange
    tx_date = Column(DateTime, index=True)
    disclosure_date = Column(DateTime, index=True)
    amount_low = Column(Float)
    amount_high = Column(Float)
    comment = Column(Text)

    # Performance tracking (filled by price service)
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
    win_rate = Column(Float)  # % of buys that were profitable
    last_trade_date = Column(DateTime)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


engine = create_async_engine(DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with async_session() as session:
        yield session
