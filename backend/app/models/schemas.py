from datetime import datetime

from pydantic import BaseModel, Field


class TradeResponse(BaseModel):
    id: int
    chamber: str
    politician: str
    party: str | None
    state: str | None
    ticker: str | None
    asset_description: str | None
    tx_type: str
    tx_date: datetime | None
    disclosure_date: datetime | None
    amount_low: float | None
    amount_high: float | None
    price_at_disclosure: float | None
    return_since_disclosure: float | None
    disclosure_delay_days: int | None = None

    class Config:
        from_attributes = True


class PoliticianResponse(BaseModel):
    id: int
    name: str
    chamber: str | None
    party: str | None
    state: str | None
    total_trades: int
    total_buys: int
    total_sells: int
    avg_return: float | None
    win_rate: float | None
    last_trade_date: datetime | None

    class Config:
        from_attributes = True


class PoliticianDetail(PoliticianResponse):
    recent_trades: list[TradeResponse] = []


class TradeFilters(BaseModel):
    chamber: str | None = None
    politician: str | None = None
    party: str | None = None
    state: str | None = None
    ticker: str | None = None
    tx_type: str | None = None
    days: int = Field(default=90, description="Look back N days")
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)


class RankingFilters(BaseModel):
    chamber: str | None = None
    party: str | None = None
    sort_by: str = Field(default="avg_return", description="avg_return, win_rate, total_trades")
    min_trades: int = Field(default=5, description="Minimum trades to be ranked")
    limit: int = Field(default=20, ge=1, le=100)


class IngestionStatus(BaseModel):
    last_run: datetime | None
    total_trades: int
    new_trades_last_run: int
    next_run: datetime | None


class AlertConfig(BaseModel):
    politicians: list[str] = Field(default_factory=list, description="Politicians to watch")
    tickers: list[str] = Field(default_factory=list, description="Tickers to watch")
    min_amount: float | None = Field(default=None, description="Min trade amount to alert on")
    tx_types: list[str] = Field(default_factory=list, description="purchase, sale, etc.")


class NewTradeAlert(BaseModel):
    trade: TradeResponse
    alert_reason: str
    detected_at: datetime


class StatsResponse(BaseModel):
    total_trades: int
    total_politicians: int
    trades_last_7d: int
    trades_last_30d: int
    most_bought_tickers: list[dict]
    most_active_politicians: list[dict]
    party_breakdown: dict
