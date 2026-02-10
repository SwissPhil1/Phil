"""Performance tracking service - calculates returns for politician trades."""

import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Politician, Trade, async_session

logger = logging.getLogger(__name__)

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0"}


async def get_price_on_date(ticker: str, date: datetime) -> float | None:
    """Get closing price for a ticker on a specific date using Yahoo v8 API."""
    try:
        # Fetch ~30 days around the target date to ensure we get nearby trading days
        start_ts = int((date - timedelta(days=15)).timestamp())
        end_ts = int((date + timedelta(days=15)).timestamp())
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
            f"?period1={start_ts}&period2={end_ts}&interval=1d"
        )
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url, headers=YAHOO_HEADERS)
            if resp.status_code != 200:
                logger.warning(f"Yahoo API {resp.status_code} for {ticker} historical")
                return None

            data = resp.json()
            result = data.get("chart", {}).get("result", [])
            if not result:
                return None

            timestamps = result[0].get("timestamp", [])
            closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])

            if not timestamps or not closes:
                return None

            # Find closest timestamp to target date
            target_ts = date.timestamp()
            best_idx = 0
            best_diff = abs(timestamps[0] - target_ts)
            for i, ts in enumerate(timestamps):
                diff = abs(ts - target_ts)
                if diff < best_diff and closes[i] is not None:
                    best_diff = diff
                    best_idx = i

            price = closes[best_idx]
            if price is not None:
                logger.info(f"Price for {ticker} on {date.date()}: ${price:.2f}")
                return float(price)
            return None
    except Exception as e:
        logger.warning(f"Could not fetch price for {ticker} on {date}: {e}")
        return None


async def get_current_price(ticker: str) -> float | None:
    """Get the most recent closing price for a ticker using Yahoo v8 API."""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=5d&interval=1d"
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url, headers=YAHOO_HEADERS)
            if resp.status_code != 200:
                logger.warning(f"Yahoo API {resp.status_code} for {ticker} current price")
                return None

            data = resp.json()
            result = data.get("chart", {}).get("result", [])
            if not result:
                return None

            closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
            valid = [c for c in closes if c is not None]
            if not valid:
                return None

            price = valid[-1]
            logger.info(f"Current price for {ticker}: ${price:.2f}")
            return float(price)
    except Exception as e:
        logger.warning(f"Could not fetch current price for {ticker}: {e}")
        return None


async def update_trade_prices(session: AsyncSession, limit: int = 100, force: bool = False):
    """Update prices for trades that don't have price data yet (or all if force=True)."""
    stmt = select(Trade).where(
        Trade.ticker.isnot(None),
        Trade.disclosure_date.isnot(None),
        Trade.tx_type.in_(["purchase", "sale", "sale_partial", "sale_full"]),
    )
    if not force:
        stmt = stmt.where(Trade.price_at_disclosure.is_(None))
    stmt = stmt.order_by(Trade.disclosure_date.desc()).limit(limit)
    result = await session.execute(stmt)
    trades = result.scalars().all()

    updated = 0
    errors = 0
    for trade in trades:
        if not trade.ticker or trade.ticker in ("--", "N/A"):
            continue

        price_at_disclosure = await get_price_on_date(trade.ticker, trade.disclosure_date)
        current_price = await get_current_price(trade.ticker)

        if price_at_disclosure and current_price:
            ret = ((current_price - price_at_disclosure) / price_at_disclosure) * 100
            # return_since_disclosure always represents stock price movement
            # since disclosure, regardless of buy/sell. Portfolio logic on the
            # frontend handles the sign based on position type.

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
            logger.info(
                f"Updated {trade.ticker} (id={trade.id}): "
                f"${price_at_disclosure:.2f} -> ${current_price:.2f} = {ret:+.1f}%"
            )
        else:
            errors += 1

    await session.commit()
    logger.info(f"Updated prices for {updated}/{len(trades)} trades ({errors} failed)")
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


async def run_performance_update(price_limit: int = 100, force: bool = False):
    """Run full performance update cycle."""
    async with async_session() as session:
        updated = await update_trade_prices(session, limit=price_limit, force=force)
        await rebuild_politician_stats(session)
        return {"prices_updated": updated}
