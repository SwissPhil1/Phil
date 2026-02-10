"""Performance tracking service - calculates returns for politician trades."""

import logging
from datetime import datetime, timedelta

import yfinance as yf
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Politician, Trade, async_session

logger = logging.getLogger(__name__)


def get_price_on_date(ticker: str, date: datetime) -> float | None:
    """Get closing price for a ticker on a specific date (or nearest trading day)."""
    try:
        start = date - timedelta(days=5)
        end = date + timedelta(days=5)
        data = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
        if data.empty:
            logger.warning(f"yfinance returned empty data for {ticker} on {date}")
            return None
        # Find nearest date
        idx = data.index.get_indexer([date], method="nearest")[0]
        price = float(data.iloc[idx]["Close"].iloc[0]) if hasattr(data.iloc[idx]["Close"], "iloc") else float(data.iloc[idx]["Close"])
        logger.info(f"Price for {ticker} on {date.date()}: ${price:.2f}")
        return price
    except Exception as e:
        logger.warning(f"Could not fetch price for {ticker} on {date}: {e}")
        return None


def get_current_price(ticker: str) -> float | None:
    """Get the most recent closing price for a ticker."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="5d")
        if hist.empty:
            logger.warning(f"yfinance returned empty history for {ticker}")
            return None
        price = float(hist["Close"].iloc[-1])
        logger.info(f"Current price for {ticker}: ${price:.2f}")
        return price
    except Exception as e:
        logger.warning(f"Could not fetch current price for {ticker}: {e}")
        return None


async def update_trade_prices(session: AsyncSession, limit: int = 100):
    """Update prices for trades that don't have price data yet."""
    stmt = (
        select(Trade)
        .where(Trade.price_at_disclosure.is_(None))
        .where(Trade.ticker.isnot(None))
        .where(Trade.disclosure_date.isnot(None))
        .where(Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]))
        .order_by(Trade.disclosure_date.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    trades = result.scalars().all()

    updated = 0
    for trade in trades:
        if not trade.ticker or trade.ticker in ("--", "N/A"):
            continue

        price_at_disclosure = get_price_on_date(trade.ticker, trade.disclosure_date)
        current_price = get_current_price(trade.ticker)

        if price_at_disclosure and current_price:
            ret = ((current_price - price_at_disclosure) / price_at_disclosure) * 100
            if trade.tx_type in ("sale", "sale_full", "sale_partial"):
                ret = -ret  # Inverse for sales

            await session.execute(
                update(Trade)
                .where(Trade.id == trade.id)
                .values(
                    price_at_disclosure=price_at_disclosure,
                    price_current=current_price,
                    return_since_disclosure=round(ret, 2),
                )
            )
            updated += 1

    await session.commit()
    logger.info(f"Updated prices for {updated} trades")
    return updated


async def rebuild_politician_stats(session: AsyncSession):
    """Recalculate aggregate stats for all politicians."""
    # Get all unique politicians
    stmt = select(Trade.politician, Trade.chamber, Trade.party, Trade.state, Trade.district).distinct()
    result = await session.execute(stmt)
    politicians = result.all()

    for pol_name, chamber, party, state, district in politicians:
        # Count trades
        total = await session.execute(
            select(func.count()).where(Trade.politician == pol_name)
        )
        total_trades = total.scalar()

        buys = await session.execute(
            select(func.count())
            .where(Trade.politician == pol_name)
            .where(Trade.tx_type == "purchase")
        )
        total_buys = buys.scalar()

        sells = await session.execute(
            select(func.count())
            .where(Trade.politician == pol_name)
            .where(Trade.tx_type.in_(["sale", "sale_full", "sale_partial"]))
        )
        total_sells = sells.scalar()

        # Average return on purchases with price data
        avg_ret = await session.execute(
            select(func.avg(Trade.return_since_disclosure))
            .where(Trade.politician == pol_name)
            .where(Trade.tx_type == "purchase")
            .where(Trade.return_since_disclosure.isnot(None))
        )
        avg_return = avg_ret.scalar()

        # Win rate (% of buys with positive return)
        wins = await session.execute(
            select(func.count())
            .where(Trade.politician == pol_name)
            .where(Trade.tx_type == "purchase")
            .where(Trade.return_since_disclosure > 0)
        )
        total_with_return = await session.execute(
            select(func.count())
            .where(Trade.politician == pol_name)
            .where(Trade.tx_type == "purchase")
            .where(Trade.return_since_disclosure.isnot(None))
        )
        win_count = wins.scalar()
        total_ret = total_with_return.scalar()
        win_rate = (win_count / total_ret * 100) if total_ret and total_ret > 0 else None

        # Last trade date
        last_trade = await session.execute(
            select(func.max(Trade.tx_date)).where(Trade.politician == pol_name)
        )
        last_trade_date = last_trade.scalar()

        # Upsert politician
        existing = await session.execute(
            select(Politician).where(Politician.name == pol_name)
        )
        pol = existing.scalar_one_or_none()

        if pol:
            pol.chamber = chamber
            pol.party = party
            pol.state = state
            pol.district = district
            pol.total_trades = total_trades
            pol.total_buys = total_buys
            pol.total_sells = total_sells
            pol.avg_return = round(avg_return, 2) if avg_return else None
            pol.win_rate = round(win_rate, 2) if win_rate else None
            pol.last_trade_date = last_trade_date
        else:
            session.add(Politician(
                name=pol_name,
                chamber=chamber,
                party=party,
                state=state,
                district=district,
                total_trades=total_trades,
                total_buys=total_buys,
                total_sells=total_sells,
                avg_return=round(avg_return, 2) if avg_return else None,
                win_rate=round(win_rate, 2) if win_rate else None,
                last_trade_date=last_trade_date,
            ))

    await session.commit()
    logger.info(f"Rebuilt stats for {len(politicians)} politicians")


async def run_performance_update(price_limit: int = 100):
    """Run full performance update cycle."""
    async with async_session() as session:
        updated = await update_trade_prices(session, limit=price_limit)
        await rebuild_politician_stats(session)
        return {"prices_updated": updated}
