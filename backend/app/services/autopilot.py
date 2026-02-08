"""
Autopilot portfolio tracker.

Scrapes public performance data from Autopilot's marketplace landing pages
(marketplace.joinautopilot.com). Performance curves are embedded as JSON
in Next.js server-side rendered pages (__NEXT_DATA__).

Individual holdings are NOT public -- but since Autopilot's portfolios
are built from 13F filings and STOCK Act disclosures (which we already
ingest), we can reconstruct portfolio compositions from our own data.
"""

import json
import logging
import re
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import async_session

logger = logging.getLogger(__name__)

# Known Autopilot portfolio landing page IDs
# Format: (team_key, portfolio_key, name, category, underlying_source)
AUTOPILOT_PORTFOLIOS = [
    # Politicians
    (1, 8735, "Pelosi Tracker+", "politician", "Nancy Pelosi"),
    (1, None, "Crenshaw Tracker", "politician", "Dan Crenshaw"),
    (1, None, "Tuberville Tracker", "politician", "Tommy Tuberville"),
    (1, None, "MTG Tracker", "politician", "Marjorie Taylor Greene"),
    (1, None, "Wasserman Schultz Tracker", "politician", "Debbie Wasserman Schultz"),
    (1, None, "Goldman Tracker", "politician", "Dan Goldman"),
    (1, None, "Mullin Tracker", "politician", "Markwayne Mullin"),
    # Hedge Funds (13F)
    (1, None, "Buffett Tracker", "hedge_fund", "0001067983"),  # Berkshire CIK
    (1, None, "Burry Tracker", "hedge_fund", "0001649339"),  # Scion CIK
    (1, None, "Ackman Tracker", "hedge_fund", "0001336528"),  # Pershing CIK
    (1, None, "Jim Simons Tracker", "hedge_fund", "0001037389"),  # RenTech CIK
    (1, None, "Point 72 Tracker", "hedge_fund", None),
    (1, None, "Calacanis Tracker", "investor", None),
    # Novelty / Contrarian
    (1, None, "Inverse Cramer", "contrarian", None),
    # AI
    (5, 100040, "AI World War III Portfolio", "ai", None),
    (5, 568906, "The Grok Portfolio", "ai", None),
    (5, None, "GPT Portfolio", "ai", None),
    (7, 739955, "The AI Alpha Fund", "ai", None),
    # Third-party pilots
    (1012, 442381, "Wolff's Flagship Fund", "third_party", None),
]


async def scrape_portfolio_performance(
    client: httpx.AsyncClient, team_key: int, portfolio_key: int
) -> dict | None:
    """
    Scrape performance data from an Autopilot marketplace landing page.
    The Next.js SSR embeds JSON in __NEXT_DATA__ script tags.
    """
    url = f"https://marketplace.joinautopilot.com/landing/{team_key}/{portfolio_key}"
    logger.info(f"Scraping Autopilot portfolio: {url}")

    resp = await client.get(url, follow_redirects=True)
    if resp.status_code != 200:
        logger.warning(f"Autopilot page returned {resp.status_code}: {url}")
        return None

    # Extract __NEXT_DATA__ JSON from the HTML
    match = re.search(
        r'<script\s+id="__NEXT_DATA__"\s+type="application/json">(.*?)</script>',
        resp.text,
        re.DOTALL,
    )
    if not match:
        logger.warning(f"No __NEXT_DATA__ found in {url}")
        return None

    try:
        next_data = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse __NEXT_DATA__: {e}")
        return None

    # Navigate the Next.js data structure to find portfolio info
    props = next_data.get("props", {}).get("pageProps", {})

    return {
        "url": url,
        "raw_props": props,
        "scraped_at": datetime.utcnow().isoformat(),
    }


def extract_performance_data(props: dict) -> dict:
    """Extract performance metrics from Autopilot page props."""
    result = {
        "name": None,
        "aum": None,
        "performance": {},
        "daily_returns": [],
    }

    # Try various paths in the Next.js data
    # The structure varies but commonly includes portfolio metadata
    if isinstance(props, dict):
        # Look for portfolio name
        for key in ("name", "portfolioName", "title"):
            if key in props:
                result["name"] = props[key]
                break

        # Look for AUM
        for key in ("subscriberAum", "aum", "totalAum"):
            if key in props:
                result["aum"] = props[key]
                break

        # Look for performance spans
        perf = props.get("performanceSpan", props.get("performance", {}))
        if isinstance(perf, dict):
            result["performance"] = perf
        elif isinstance(perf, list):
            for item in perf:
                if isinstance(item, dict):
                    span = item.get("span", item.get("period", ""))
                    val = item.get("value", item.get("return", 0))
                    result["performance"][span] = val

        # Look for daily return curves
        for key in ("cumulativePerformance", "dailyReturns", "returns"):
            if key in props and isinstance(props[key], list):
                result["daily_returns"] = props[key]
                break

    return result


async def scrape_all_portfolios() -> dict:
    """Scrape performance data from all known Autopilot portfolios."""
    results = {}
    errors = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for team_key, portfolio_key, name, category, source in AUTOPILOT_PORTFOLIOS:
            if portfolio_key is None:
                # We don't have the portfolio key yet, skip
                continue

            try:
                data = await scrape_portfolio_performance(client, team_key, portfolio_key)
                if data:
                    perf = extract_performance_data(data["raw_props"])
                    results[name] = {
                        "name": perf["name"] or name,
                        "category": category,
                        "aum": perf["aum"],
                        "performance": perf["performance"],
                        "underlying_source": source,
                        "url": data["url"],
                        "scraped_at": data["scraped_at"],
                    }
            except Exception as e:
                logger.error(f"Error scraping {name}: {e}")
                errors.append(f"{name}: {e}")

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "portfolios_scraped": len(results),
        "portfolios": results,
        "errors": errors,
    }


def get_portfolio_mapping() -> list[dict]:
    """
    Return the mapping between Autopilot portfolios and our data sources.
    This shows which of our data feeds replicate which Autopilot portfolio.
    """
    return [
        {
            "autopilot_name": name,
            "category": category,
            "our_data_source": _map_source(category, source),
            "replicable": source is not None,
            "portfolio_url": (
                f"https://marketplace.joinautopilot.com/landing/{team_key}/{portfolio_key}"
                if portfolio_key
                else None
            ),
        }
        for team_key, portfolio_key, name, category, source in AUTOPILOT_PORTFOLIOS
    ]


def _map_source(category: str, source: str | None) -> str:
    if source is None:
        return "Not replicable (proprietary)"
    if category == "politician":
        return f"Congress trades API → /api/v1/politicians/{source}"
    if category == "hedge_fund":
        return f"13F holdings API → /api/v1/hedge-funds/{source}/holdings"
    return f"Unknown: {source}"
