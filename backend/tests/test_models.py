"""Tests for database models and schemas."""

import pytest
from datetime import datetime

from app.models.schemas import (
    TradeResponse,
    PoliticianResponse,
    StatsResponse,
    TradeFilters,
)


def test_trade_response_model():
    """Test TradeResponse Pydantic model."""
    trade = TradeResponse(
        id=1,
        chamber="house",
        politician="Nancy Pelosi",
        party="D",
        state="CA",
        ticker="AAPL",
        tx_type="purchase",
    )
    assert trade.politician == "Nancy Pelosi"
    assert trade.party == "D"
    assert trade.return_since_disclosure is None


def test_trade_response_optional_fields():
    """Test TradeResponse with optional fields."""
    trade = TradeResponse(
        id=1,
        chamber="senate",
        politician="Test",
        tx_type="sale",
        price_at_disclosure=100.0,
        price_current=110.0,
        return_since_disclosure=10.0,
    )
    assert trade.price_at_disclosure == 100.0
    assert trade.return_since_disclosure == 10.0


def test_politician_response_none_coercion():
    """Test PoliticianResponse coerces None to 0 for trade counts."""
    pol = PoliticianResponse(
        id=1,
        name="Test",
        total_trades=None,
        total_buys=None,
        total_sells=None,
    )
    assert pol.total_trades == 0
    assert pol.total_buys == 0
    assert pol.total_sells == 0


def test_stats_response_defaults():
    """Test StatsResponse has proper defaults."""
    stats = StatsResponse()
    assert stats.total_trades == 0
    assert stats.total_politicians == 0
    assert stats.most_bought_tickers == []


def test_trade_filters_defaults():
    """Test TradeFilters defaults."""
    filters = TradeFilters()
    assert filters.days == 90
    assert filters.page == 1
    assert filters.page_size == 50
