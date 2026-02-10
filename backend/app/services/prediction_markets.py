"""
Polymarket top trader tracking.

Uses the Polymarket Data API (data-api.polymarket.com) to track
leaderboard, positions, and trades of top prediction market players.
Also ingests Kalshi market data for cross-platform coverage.
"""

import logging
from datetime import datetime

import httpx
from sqlalchemy import delete
from app.models.database import dialect_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    KalshiMarket,
    PolymarketPosition,
    PolymarketTrade,
    PolymarketTrader,
    async_session,
)

logger = logging.getLogger(__name__)

POLY_DATA_API = "https://data-api.polymarket.com"
POLY_GAMMA_API = "https://gamma-api.polymarket.com"
KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"


# --- Polymarket Leaderboard & Trader Tracking ---


async def fetch_leaderboard(
    client: httpx.AsyncClient,
    time_period: str = "MONTH",
    order_by: str = "PNL",
    limit: int = 50,
    category: str = "OVERALL",
) -> list[dict]:
    """Fetch Polymarket leaderboard."""
    url = f"{POLY_DATA_API}/v1/leaderboard"
    params = {
        "timePeriod": time_period,
        "orderBy": order_by,
        "limit": limit,
        "category": category,
    }
    resp = await client.get(url, params=params)
    if resp.status_code != 200:
        logger.warning(f"Polymarket leaderboard returned {resp.status_code}")
        return []
    return resp.json()


async def fetch_trader_positions(
    client: httpx.AsyncClient, wallet: str, limit: int = 50
) -> list[dict]:
    """Fetch current positions for a Polymarket trader."""
    url = f"{POLY_DATA_API}/positions"
    params = {
        "user": wallet,
        "limit": limit,
        "sortBy": "CURRENT",
        "sortDirection": "DESC",
        "sizeThreshold": 1,
    }
    resp = await client.get(url, params=params)
    if resp.status_code != 200:
        logger.warning(f"Positions for {wallet[:10]}... returned {resp.status_code}")
        return []
    return resp.json()


async def fetch_trader_trades(
    client: httpx.AsyncClient, wallet: str, limit: int = 50
) -> list[dict]:
    """Fetch recent trades for a Polymarket trader."""
    url = f"{POLY_DATA_API}/trades"
    params = {"user": wallet, "limit": limit}
    resp = await client.get(url, params=params)
    if resp.status_code != 200:
        logger.warning(f"Trades for {wallet[:10]}... returned {resp.status_code}")
        return []
    return resp.json()


async def fetch_trader_value(client: httpx.AsyncClient, wallet: str) -> float | None:
    """Fetch total portfolio value for a trader."""
    url = f"{POLY_DATA_API}/value"
    params = {"user": wallet}
    resp = await client.get(url, params=params)
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data and len(data) > 0:
        return data[0].get("value")
    return None


async def ingest_leaderboard(session: AsyncSession, client: httpx.AsyncClient) -> int:
    """Ingest top traders from multiple leaderboard views."""
    all_traders = {}

    # Fetch leaderboards for different time periods and categories
    for period in ["ALL", "MONTH", "WEEK"]:
        for category in ["OVERALL", "POLITICS", "CRYPTO"]:
            entries = await fetch_leaderboard(
                client, time_period=period, limit=50, category=category
            )
            for entry in entries:
                wallet = entry.get("proxyWallet", "")
                if not wallet:
                    continue
                if wallet not in all_traders:
                    all_traders[wallet] = {
                        "wallet": wallet,
                        "username": entry.get("userName", ""),
                        "x_username": entry.get("xUsername", ""),
                        "verified": entry.get("verifiedBadge", False),
                    }
                # Update PnL/volume for appropriate period
                if period == "ALL":
                    all_traders[wallet]["pnl_all"] = entry.get("pnl")
                    all_traders[wallet]["volume_all"] = entry.get("vol")
                    all_traders[wallet]["rank_all"] = int(entry.get("rank", 0))
                elif period == "MONTH":
                    all_traders[wallet]["pnl_month"] = entry.get("pnl")
                    all_traders[wallet]["volume_month"] = entry.get("vol")
                    all_traders[wallet]["rank_month"] = int(entry.get("rank", 0))
                elif period == "WEEK":
                    all_traders[wallet]["pnl_week"] = entry.get("pnl")

    # Upsert traders
    new_count = 0
    for wallet, data in all_traders.items():
        # Fetch portfolio value
        value = await fetch_trader_value(client, wallet)
        data["portfolio_value"] = value

        stmt = (
            dialect_insert(PolymarketTrader)
            .values(**data)
            .on_conflict_do_update(
                index_elements=["wallet"],
                set_={k: v for k, v in data.items() if k != "wallet" and v is not None},
            )
        )
        await session.execute(stmt)
        new_count += 1

    await session.commit()
    logger.info(f"Upserted {new_count} Polymarket traders")
    return new_count


async def ingest_trader_positions(
    session: AsyncSession, client: httpx.AsyncClient, wallet: str
) -> int:
    """Ingest current positions for a specific trader."""
    positions = await fetch_trader_positions(client, wallet)

    # Clear old positions for this wallet
    await session.execute(
        delete(PolymarketPosition).where(PolymarketPosition.wallet == wallet)
    )

    count = 0
    for pos in positions:
        end_date = None
        if pos.get("endDate"):
            try:
                end_date = datetime.fromisoformat(pos["endDate"].replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

        data = {
            "wallet": wallet,
            "condition_id": pos.get("conditionId", ""),
            "market_title": pos.get("title", ""),
            "market_slug": pos.get("slug", ""),
            "outcome": pos.get("outcome", ""),
            "outcome_index": pos.get("outcomeIndex"),
            "opposite_outcome": pos.get("oppositeOutcome", ""),
            "size": pos.get("size"),
            "avg_price": pos.get("avgPrice"),
            "current_price": pos.get("curPrice"),
            "initial_value": pos.get("initialValue"),
            "current_value": pos.get("currentValue"),
            "cash_pnl": pos.get("cashPnl"),
            "percent_pnl": pos.get("percentPnl"),
            "realized_pnl": pos.get("realizedPnl"),
            "end_date": end_date,
        }

        stmt = (
            dialect_insert(PolymarketPosition)
            .values(**data)
            .on_conflict_do_update(
                index_elements=["wallet", "condition_id", "outcome"],
                set_={k: v for k, v in data.items() if k not in ("wallet", "condition_id", "outcome")},
            )
        )
        await session.execute(stmt)
        count += 1

    await session.commit()
    return count


async def ingest_trader_trades(
    session: AsyncSession, client: httpx.AsyncClient, wallet: str
) -> int:
    """Ingest recent trades for a specific trader."""
    trades = await fetch_trader_trades(client, wallet)

    count = 0
    for t in trades:
        tx_hash = t.get("transactionHash", "")
        if not tx_hash:
            continue

        ts = None
        if t.get("timestamp"):
            try:
                ts = datetime.utcfromtimestamp(int(t["timestamp"]))
            except (ValueError, TypeError):
                pass

        data = {
            "wallet": wallet,
            "condition_id": t.get("conditionId", ""),
            "tx_hash": tx_hash,
            "side": t.get("side", ""),
            "size": t.get("size"),
            "price": t.get("price"),
            "timestamp": ts,
            "market_title": t.get("title", ""),
            "outcome": t.get("outcome", ""),
            "outcome_index": t.get("outcomeIndex"),
        }

        stmt = (
            dialect_insert(PolymarketTrade)
            .values(**data)
            .on_conflict_do_nothing(index_elements=["tx_hash"])
        )
        result = await session.execute(stmt)
        if result.rowcount > 0:
            count += 1

    await session.commit()
    return count


# --- Kalshi Market Data ---


async def fetch_kalshi_markets(client: httpx.AsyncClient, limit: int = 200) -> list[dict]:
    """Fetch active Kalshi markets."""
    url = f"{KALSHI_API}/markets"
    params = {"limit": limit, "status": "open"}
    resp = await client.get(url)
    if resp.status_code != 200:
        logger.warning(f"Kalshi markets returned {resp.status_code}")
        return []
    data = resp.json()
    return data.get("markets", [])


async def ingest_kalshi_markets(session: AsyncSession, client: httpx.AsyncClient) -> int:
    """Ingest active Kalshi markets."""
    markets = await fetch_kalshi_markets(client)
    count = 0

    for m in markets:
        close_time = None
        if m.get("close_time"):
            try:
                close_time = datetime.fromisoformat(m["close_time"].replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

        data = {
            "ticker": m.get("ticker", ""),
            "event_ticker": m.get("event_ticker", ""),
            "title": m.get("title", ""),
            "status": m.get("status", ""),
            "last_price": float(m.get("last_price", 0)) / 100 if m.get("last_price") else None,
            "yes_bid": float(m.get("yes_bid_dollars", "0").replace("$", "") or 0) if m.get("yes_bid_dollars") else None,
            "yes_ask": float(m.get("yes_ask_dollars", "0").replace("$", "") or 0) if m.get("yes_ask_dollars") else None,
            "volume": m.get("volume"),
            "open_interest": m.get("open_interest"),
            "liquidity": float(m.get("liquidity_dollars", "0").replace("$", "") or 0) if m.get("liquidity_dollars") else None,
            "close_time": close_time,
            "result": m.get("result", ""),
        }

        stmt = (
            dialect_insert(KalshiMarket)
            .values(**data)
            .on_conflict_do_update(
                index_elements=["ticker"],
                set_={k: v for k, v in data.items() if k != "ticker"},
            )
        )
        await session.execute(stmt)
        count += 1

    await session.commit()
    logger.info(f"Upserted {count} Kalshi markets")
    return count


# --- Main Orchestrator ---


async def run_polymarket_ingestion() -> dict:
    """Full Polymarket ingestion: leaderboard + top trader positions and trades."""
    results = {"traders": 0, "positions": 0, "trades": 0, "errors": []}

    async with httpx.AsyncClient(timeout=30.0) as client:
        async with async_session() as session:
            # Ingest leaderboard
            try:
                results["traders"] = await ingest_leaderboard(session, client)
            except Exception as e:
                logger.error(f"Polymarket leaderboard error: {e}")
                results["errors"].append(f"leaderboard: {e}")

            # For top 20 traders, ingest positions and trades
            from sqlalchemy import select
            top_traders = await session.execute(
                select(PolymarketTrader.wallet)
                .where(PolymarketTrader.rank_month.isnot(None))
                .order_by(PolymarketTrader.rank_month.asc())
                .limit(20)
            )
            wallets = [row[0] for row in top_traders.all()]

            for wallet in wallets:
                try:
                    pos_count = await ingest_trader_positions(session, client, wallet)
                    results["positions"] += pos_count
                    trade_count = await ingest_trader_trades(session, client, wallet)
                    results["trades"] += trade_count
                except Exception as e:
                    logger.error(f"Error ingesting trader {wallet[:10]}...: {e}")
                    results["errors"].append(f"{wallet[:10]}: {e}")

    results["timestamp"] = datetime.utcnow().isoformat()
    logger.info(f"Polymarket ingestion complete: {results}")
    return results


async def run_kalshi_ingestion() -> dict:
    """Ingest Kalshi market data."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        async with async_session() as session:
            try:
                count = await ingest_kalshi_markets(session, client)
                return {"timestamp": datetime.utcnow().isoformat(), "markets": count}
            except Exception as e:
                logger.error(f"Kalshi ingestion error: {e}")
                return {"timestamp": datetime.utcnow().isoformat(), "error": str(e)}
