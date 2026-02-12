"""Tests for Alerts API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_get_recent_alerts_empty(client):
    """Test alerts endpoint returns empty when no data."""
    resp = await client.get("/api/v1/alerts/recent")
    assert resp.status_code == 200
    data = resp.json()
    assert "alerts" in data
    assert data["alerts"] == []


@pytest.mark.asyncio
async def test_get_recent_alerts_with_data(client, seed_trades, seed_insider_trades):
    """Test alerts endpoint returns congress + insider alerts."""
    resp = await client.get("/api/v1/alerts/recent?hours=168")
    assert resp.status_code == 200
    data = resp.json()
    assert "alerts" in data
    assert "total" in data
    # Should have both congress and insider alerts
    sources = {a["source"] for a in data["alerts"]}
    assert "congress" in sources
    assert "insider" in sources


@pytest.mark.asyncio
async def test_get_alerts_summary(client, seed_trades):
    """Test alerts summary endpoint."""
    resp = await client.get("/api/v1/alerts/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "periods" in data
    assert "1h" in data["periods"]
    assert "24h" in data["periods"]
    assert "hot_tickers_24h" in data


@pytest.mark.asyncio
async def test_get_activity_feed(client, seed_trades, seed_insider_trades):
    """Test activity feed endpoint."""
    resp = await client.get("/api/v1/alerts/feed")
    assert resp.status_code == 200
    data = resp.json()
    assert "activities" in data
    assert "page" in data
    assert data["page"] == 1


@pytest.mark.asyncio
async def test_get_activity_feed_filter_source(client, seed_trades, seed_insider_trades):
    """Test activity feed with source filter."""
    resp = await client.get("/api/v1/alerts/feed?source=congress")
    assert resp.status_code == 200
    data = resp.json()
    for activity in data["activities"]:
        assert activity["source"] == "congress"


@pytest.mark.asyncio
async def test_get_activity_feed_filter_ticker(client, seed_trades):
    """Test activity feed with ticker filter."""
    resp = await client.get("/api/v1/alerts/feed?source=congress&ticker=AAPL")
    assert resp.status_code == 200
    data = resp.json()
    for activity in data["activities"]:
        assert activity["ticker"] == "AAPL"


@pytest.mark.asyncio
async def test_get_activity_feed_pagination(client, seed_trades):
    """Test activity feed pagination."""
    resp = await client.get("/api/v1/alerts/feed?page=1&page_size=2")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["activities"]) <= 2
    assert data["page"] == 1
