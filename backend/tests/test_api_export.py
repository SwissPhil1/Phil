"""Tests for Data Export API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_export_trades_csv(client, seed_trades):
    """Test exporting congressional trades as CSV."""
    resp = await client.get("/api/v1/export/trades/csv?days=365")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers.get("content-type", "")
    content = resp.text
    assert "politician" in content
    assert "ticker" in content
    assert "Pelosi" in content


@pytest.mark.asyncio
async def test_export_trades_csv_filter_party(client, seed_trades):
    """Test exporting trades filtered by party."""
    resp = await client.get("/api/v1/export/trades/csv?days=365&party=D")
    assert resp.status_code == 200
    content = resp.text
    lines = content.strip().split("\n")
    # Header + at least one data row
    assert len(lines) >= 2


@pytest.mark.asyncio
async def test_export_trades_json(client, seed_trades):
    """Test exporting congressional trades as JSON."""
    resp = await client.get("/api/v1/export/trades/json?days=365")
    assert resp.status_code == 200
    data = resp.json()
    assert "exported_at" in data
    assert "total" in data
    assert "trades" in data
    assert data["total"] >= 3


@pytest.mark.asyncio
async def test_export_insiders_csv(client, seed_insider_trades):
    """Test exporting insider trades as CSV."""
    resp = await client.get("/api/v1/export/insiders/csv?days=365")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers.get("content-type", "")
    content = resp.text
    assert "insider_name" in content
    assert "ticker" in content


@pytest.mark.asyncio
async def test_export_hedge_funds_csv(client):
    """Test exporting hedge fund holdings as CSV (empty)."""
    resp = await client.get("/api/v1/export/hedge-funds/csv")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_export_empty_returns_no_data(client):
    """Test export with no matching data."""
    resp = await client.get("/api/v1/export/trades/csv?days=1&ticker=NONEXISTENT")
    assert resp.status_code == 200
