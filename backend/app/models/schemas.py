from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class TradeResponse(BaseModel):
    id: int
    chamber: str
    politician: str
    party: str | None = None
    state: str | None = None
    ticker: str | None = None
    asset_description: str | None = None
    tx_type: str
    tx_date: datetime | None = None
    disclosure_date: datetime | None = None
    amount_low: float | None = None
    amount_high: float | None = None
    price_at_disclosure: float | None = None
    price_current: float | None = None
    return_since_disclosure: float | None = None
    disclosure_delay_days: int | None = None

    class Config:
        from_attributes = True


class PoliticianResponse(BaseModel):
    id: int
    name: str
    chamber: str | None = None
    party: str | None = None
    state: str | None = None
    total_trades: int = 0
    total_buys: int = 0
    total_sells: int = 0
    avg_return: float | None = None
    win_rate: float | None = None
    last_trade_date: datetime | None = None
    portfolio_return: float | None = None
    portfolio_cagr: float | None = None
    conviction_return: float | None = None
    conviction_cagr: float | None = None
    priced_buy_count: int | None = None
    years_active: float | None = None

    @field_validator('total_trades', 'total_buys', 'total_sells', mode='before')
    @classmethod
    def coerce_none_to_zero(cls, v):
        return v if v is not None else 0

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
    last_run: datetime | None = None
    total_trades: int = 0
    new_trades_last_run: int = 0
    next_run: datetime | None = None


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
    total_trades: int = 0
    total_politicians: int = 0
    trades_last_7d: int = 0
    trades_last_30d: int = 0
    most_bought_tickers: list[dict] = []
    most_active_politicians: list[dict] = []
    party_breakdown: dict = {}
