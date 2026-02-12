"""Tests for backend service functions."""

import pytest
from datetime import datetime

from app.services.alerts import build_alert_reason, func_lower
from app.services.autopilot import get_portfolio_mapping, extract_performance_data


class TestAlertService:
    """Tests for the alerts service."""

    def test_build_alert_reason_purchase(self):
        """Test alert reason for a purchase trade."""

        class FakeTrade:
            politician = "Nancy Pelosi"
            party = "D"
            state = "CA"
            ticker = "AAPL"
            tx_type = "purchase"
            amount_low = 500000
            amount_high = 1000000
            disclosure_date = datetime(2025, 6, 15)
            tx_date = datetime(2025, 6, 10)

        reason = build_alert_reason(FakeTrade(), None)
        assert "Pelosi" in reason
        assert "bought" in reason
        assert "AAPL" in reason
        assert "$500,000" in reason

    def test_build_alert_reason_sale(self):
        """Test alert reason for a sale trade."""

        class FakeTrade:
            politician = "Tommy Tuberville"
            party = "R"
            state = "AL"
            ticker = "MSFT"
            tx_type = "sale"
            amount_low = 15000
            amount_high = None
            disclosure_date = datetime(2025, 6, 15)
            tx_date = datetime(2025, 6, 12)

        reason = build_alert_reason(FakeTrade(), None)
        assert "Tuberville" in reason
        assert "sold" in reason
        assert "MSFT" in reason

    def test_build_alert_reason_no_dates(self):
        """Test alert reason when dates are missing."""

        class FakeTrade:
            politician = "Test Trader"
            party = "I"
            state = "NY"
            ticker = "TSLA"
            tx_type = "purchase"
            amount_low = None
            amount_high = None
            disclosure_date = None
            tx_date = None

        reason = build_alert_reason(FakeTrade(), None)
        assert "Test Trader" in reason
        assert "bought" in reason


class TestAutopilotService:
    """Tests for the autopilot service."""

    def test_get_portfolio_mapping(self):
        """Test that portfolio mapping returns correct structure."""
        mapping = get_portfolio_mapping()
        assert isinstance(mapping, list)
        assert len(mapping) > 0
        first = mapping[0]
        assert "autopilot_name" in first
        assert "category" in first
        assert "replicable" in first

    def test_portfolio_mapping_has_pelosi(self):
        """Test that Pelosi tracker is in the mapping."""
        mapping = get_portfolio_mapping()
        names = [m["autopilot_name"] for m in mapping]
        assert "Pelosi Tracker+" in names

    def test_portfolio_mapping_replicable_flag(self):
        """Test that replicable flag is correctly set."""
        mapping = get_portfolio_mapping()
        pelosi = next(m for m in mapping if m["autopilot_name"] == "Pelosi Tracker+")
        assert pelosi["replicable"] is True

    def test_extract_performance_data_empty(self):
        """Test extracting performance from empty props."""
        result = extract_performance_data({})
        assert result["name"] is None
        assert result["aum"] is None
        assert result["performance"] == {}

    def test_extract_performance_data_with_name(self):
        """Test extracting performance with portfolio name."""
        props = {"name": "My Portfolio", "subscriberAum": 1500000}
        result = extract_performance_data(props)
        assert result["name"] == "My Portfolio"
        assert result["aum"] == 1500000

    def test_extract_performance_data_dict_perf(self):
        """Test extracting dict performance span."""
        props = {
            "title": "Test Fund",
            "performanceSpan": {"1m": 5.2, "3m": 12.1, "1y": 45.0}
        }
        result = extract_performance_data(props)
        assert result["name"] == "Test Fund"
        assert result["performance"]["1m"] == 5.2

    def test_extract_performance_data_list_perf(self):
        """Test extracting list performance span."""
        props = {
            "portfolioName": "List Fund",
            "performanceSpan": [
                {"span": "1m", "value": 3.0},
                {"span": "3m", "value": 8.5},
            ]
        }
        result = extract_performance_data(props)
        assert result["name"] == "List Fund"
        assert result["performance"]["1m"] == 3.0
        assert result["performance"]["3m"] == 8.5
