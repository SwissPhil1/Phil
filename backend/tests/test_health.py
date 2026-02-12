"""Tests for system health and root endpoints."""

import pytest


@pytest.mark.asyncio
async def test_root_endpoint(client):
    """Test root endpoint returns API info."""
    resp = await client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "SmartFlow API"
    assert "endpoints" in data
    assert "alerts" in data["endpoints"]
    assert "export" in data["endpoints"]


@pytest.mark.asyncio
async def test_health_endpoint(client):
    """Test health check endpoint."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.asyncio
async def test_debug_endpoint(client):
    """Test debug diagnostic endpoint."""
    resp = await client.get("/debug")
    assert resp.status_code == 200
    data = resp.json()
    assert "memory_mb" in data
    assert "python" in data
    assert "pid" in data
