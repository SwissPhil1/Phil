"""Tests for Congress trades API endpoints."""

import pytest
import pytest_asyncio


@pytest.mark.asyncio
async def test_get_trades_empty(client):
    """Test trades endpoint returns empty list when no data."""
    resp = await client.get("/api/v1/trades")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_trades_with_data(client, seed_trades):
    """Test trades endpoint returns seeded trades."""
    resp = await client.get("/api/v1/trades")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 3
    # Verify trade fields
    trade = data[0]
    assert "politician" in trade
    assert "ticker" in trade
    assert "tx_type" in trade


@pytest.mark.asyncio
async def test_get_trades_filter_chamber(client, seed_trades):
    """Test filtering trades by chamber."""
    resp = await client.get("/api/v1/trades?chamber=house")
    assert resp.status_code == 200
    data = resp.json()
    assert all(t["chamber"] == "house" for t in data)


@pytest.mark.asyncio
async def test_get_trades_filter_party(client, seed_trades):
    """Test filtering trades by party."""
    resp = await client.get("/api/v1/trades?party=D")
    assert resp.status_code == 200
    data = resp.json()
    assert all(t["party"] == "D" for t in data)


@pytest.mark.asyncio
async def test_get_trades_filter_ticker(client, seed_trades):
    """Test filtering trades by ticker."""
    resp = await client.get("/api/v1/trades?ticker=AAPL")
    assert resp.status_code == 200
    data = resp.json()
    assert all(t["ticker"] == "AAPL" for t in data)


@pytest.mark.asyncio
async def test_get_trades_search(client, seed_trades):
    """Test search across politician and ticker."""
    resp = await client.get("/api/v1/trades?search=Pelosi")
    assert resp.status_code == 200
    data = resp.json()
    assert all("Pelosi" in t["politician"] for t in data)


@pytest.mark.asyncio
async def test_get_recent_trades(client, seed_trades):
    """Test recent trades endpoint."""
    resp = await client.get("/api/v1/trades/recent?limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) <= 10


@pytest.mark.asyncio
async def test_get_stats(client, seed_trades, seed_politicians):
    """Test dashboard stats endpoint."""
    resp = await client.get("/api/v1/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_trades" in data
    assert "total_politicians" in data
    assert data["total_trades"] >= 4
    assert data["total_politicians"] >= 2


@pytest.mark.asyncio
async def test_get_politicians(client, seed_politicians):
    """Test politicians list endpoint."""
    resp = await client.get("/api/v1/politicians")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2


@pytest.mark.asyncio
async def test_get_politician_detail(client, seed_trades, seed_politicians):
    """Test politician detail endpoint."""
    resp = await client.get("/api/v1/politicians/Pelosi")
    assert resp.status_code == 200
    data = resp.json()
    assert "Pelosi" in data["name"]
    assert "recent_trades" in data


@pytest.mark.asyncio
async def test_get_politician_not_found(client):
    """Test politician detail returns 404 for unknown name."""
    resp = await client.get("/api/v1/politicians/NonExistentPerson123")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_most_traded_tickers(client, seed_trades):
    """Test most traded tickers endpoint."""
    resp = await client.get("/api/v1/tickers/most-traded?days=365")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    if data:
        assert "ticker" in data[0]
        assert "trade_count" in data[0]


@pytest.mark.asyncio
async def test_get_trades_pagination(client, seed_trades):
    """Test trades pagination."""
    resp = await client.get("/api/v1/trades?page=1&page_size=2")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) <= 2
