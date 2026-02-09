"""Alert service - detect new trades and notify subscribers."""

import logging
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Trade, async_session
from app.models.schemas import AlertConfig, NewTradeAlert, TradeResponse

logger = logging.getLogger(__name__)


async def get_new_trades(
    session: AsyncSession,
    since: datetime | None = None,
    config: AlertConfig | None = None,
) -> list[Trade]:
    """Get trades that haven't been notified yet, optionally filtered by alert config."""
    if since is None:
        since = datetime.utcnow() - timedelta(hours=24)

    stmt = (
        select(Trade)
        .where(Trade.notified == False)  # noqa: E712
        .where(Trade.disclosure_date >= since)
        .order_by(Trade.disclosure_date.desc())
    )

    if config:
        if config.politicians:
            names_lower = [p.lower() for p in config.politicians]
            stmt = stmt.where(
                func_lower(Trade.politician).in_(names_lower)
            )
        if config.tickers:
            stmt = stmt.where(Trade.ticker.in_([t.upper() for t in config.tickers]))
        if config.min_amount:
            stmt = stmt.where(Trade.amount_low >= config.min_amount)
        if config.tx_types:
            stmt = stmt.where(Trade.tx_type.in_(config.tx_types))

    result = await session.execute(stmt)
    return result.scalars().all()


def func_lower(column):
    """SQLAlchemy lower() helper."""
    from sqlalchemy import func
    return func.lower(column)


def build_alert_reason(trade: Trade, config: AlertConfig | None) -> str:
    """Build a human-readable alert reason."""
    parts = []
    amount_str = ""
    if trade.amount_low:
        amount_str = f" (${trade.amount_low:,.0f}–${trade.amount_high:,.0f})" if trade.amount_high else f" (${trade.amount_low:,.0f}+)"

    action = "bought" if trade.tx_type == "purchase" else "sold"
    parts.append(f"{trade.politician} ({trade.party}-{trade.state}) {action} {trade.ticker}{amount_str}")

    if trade.disclosure_date and trade.tx_date:
        delay = (trade.disclosure_date - trade.tx_date).days
        parts.append(f"Disclosed {delay}d after trade")

    return ". ".join(parts)


async def check_and_generate_alerts(
    config: AlertConfig | None = None,
) -> list[NewTradeAlert]:
    """Check for new trades and generate alerts."""
    async with async_session() as session:
        new_trades = await get_new_trades(session, config=config)
        alerts = []

        for trade in new_trades:
            alert = NewTradeAlert(
                trade=TradeResponse(
                    id=trade.id,
                    chamber=trade.chamber,
                    politician=trade.politician,
                    party=trade.party,
                    state=trade.state,
                    ticker=trade.ticker,
                    asset_description=trade.asset_description,
                    tx_type=trade.tx_type,
                    tx_date=trade.tx_date,
                    disclosure_date=trade.disclosure_date,
                    amount_low=trade.amount_low,
                    amount_high=trade.amount_high,
                    price_at_disclosure=trade.price_at_disclosure,
                    return_since_disclosure=trade.return_since_disclosure,
                ),
                alert_reason=build_alert_reason(trade, config),
                detected_at=datetime.utcnow(),
            )
            alerts.append(alert)

        # Mark as notified
        if new_trades:
            trade_ids = [t.id for t in new_trades]
            await session.execute(
                update(Trade).where(Trade.id.in_(trade_ids)).values(notified=True)
            )
            await session.commit()

        logger.info(f"Generated {len(alerts)} alerts")
        return alerts
