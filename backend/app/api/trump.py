"""API routes for Trump & Inner Circle tracking."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import TrumpConnection, TrumpDonor, TrumpInsider, get_db
from app.services.trump_tracker import (
    POLICY_CONNECTIONS,
    TRUMP_CONNECTED_COMPANIES,
    TRUMP_INSIDERS,
    TRUMP_MAJOR_DONORS,
    get_trump_hedge_fund_overlap,
    get_trump_insider_trades,
    run_trump_data_ingestion,
)

router = APIRouter(prefix="/trump", tags=["Trump & Inner Circle"])


@router.get("/")
async def trump_overview():
    """
    Get a complete overview of the Trump financial tracking dashboard.
    Returns counts and categories of tracked entities.
    """
    return {
        "description": "Trump & Inner Circle financial interest tracker",
        "tracked_insiders": len(TRUMP_INSIDERS),
        "tracked_companies": len(TRUMP_CONNECTED_COMPANIES),
        "major_donors": len(TRUMP_MAJOR_DONORS),
        "policy_connections": len(POLICY_CONNECTIONS),
        "categories": {
            "family": sum(1 for i in TRUMP_INSIDERS if i["category"] == "family"),
            "associates": sum(1 for i in TRUMP_INSIDERS if i["category"] == "associate"),
            "appointees": sum(1 for i in TRUMP_INSIDERS if i["category"] == "appointee"),
            "donors": sum(1 for i in TRUMP_INSIDERS if i["category"] == "donor"),
        },
    }


@router.get("/insiders")
async def list_trump_insiders(
    category: str | None = Query(default=None, description="Filter: family, associate, appointee, donor"),
    db: AsyncSession = Depends(get_db),
):
    """
    List all tracked Trump insiders with their financial interests,
    board seats, and connected tickers.
    """
    stmt = select(TrumpInsider)
    if category:
        stmt = stmt.where(TrumpInsider.category == category)
    stmt = stmt.order_by(TrumpInsider.category, TrumpInsider.name)

    result = await db.execute(stmt)
    insiders = result.scalars().all()

    if not insiders:
        # Fall back to static data if not yet ingested
        data = TRUMP_INSIDERS
        if category:
            data = [i for i in data if i["category"] == category]
        return data

    return [
        {
            "name": i.name,
            "role": i.role,
            "category": i.category,
            "relationship": i.relationship,
            "known_interests": i.known_interests.split("; ") if i.known_interests else [],
            "board_seats": i.board_seats.split("; ") if i.board_seats else [],
            "tickers": i.tickers.split(",") if i.tickers else [],
            "notes": i.notes,
        }
        for i in insiders
    ]


@router.get("/insiders/{name}")
async def get_trump_insider_detail(name: str, db: AsyncSession = Depends(get_db)):
    """Get detailed info on a specific Trump insider."""
    stmt = select(TrumpInsider).where(TrumpInsider.name.ilike(f"%{name}%"))
    result = await db.execute(stmt)
    insider = result.scalar_one_or_none()

    if not insider:
        # Try static data
        match = next((i for i in TRUMP_INSIDERS if name.lower() in i["name"].lower()), None)
        if match:
            return match
        return {"error": f"Insider '{name}' not found"}

    # Get their connected companies
    connected = [
        c for c in TRUMP_CONNECTED_COMPANIES
        if insider.name in c.get("insiders", [])
    ]

    return {
        "name": insider.name,
        "role": insider.role,
        "category": insider.category,
        "relationship": insider.relationship,
        "known_interests": insider.known_interests.split("; ") if insider.known_interests else [],
        "board_seats": insider.board_seats.split("; ") if insider.board_seats else [],
        "tickers": insider.tickers.split(",") if insider.tickers else [],
        "notes": insider.notes,
        "connected_companies": connected,
    }


@router.get("/companies")
async def list_trump_connected_companies(
    category: str | None = Query(default=None, description="Filter: trump_owned, musk_empire, defense_tech, tech_ally, appointee_company, policy_beneficiary"),
    db: AsyncSession = Depends(get_db),
):
    """
    List all companies with financial ties to Trump orbit.
    Includes ownership, board connections, donor relationships, and policy beneficiaries.
    """
    stmt = select(TrumpConnection)
    if category:
        stmt = stmt.where(TrumpConnection.category == category)
    stmt = stmt.order_by(TrumpConnection.category, TrumpConnection.company_name)

    result = await db.execute(stmt)
    companies = result.scalars().all()

    if not companies:
        data = TRUMP_CONNECTED_COMPANIES
        if category:
            data = [c for c in data if c["category"] == category]
        return data

    return [
        {
            "company_name": c.company_name,
            "ticker": c.ticker,
            "connection": c.connection_description,
            "category": c.category,
            "sector": c.sector,
            "connected_insiders": c.connected_insiders.split(",") if c.connected_insiders else [],
        }
        for c in companies
    ]


@router.get("/donors")
async def list_trump_donors(db: AsyncSession = Depends(get_db)):
    """
    List major Trump donors for the 2024 cycle with their financial interests.
    Useful for tracking whose money is behind policy decisions.
    """
    stmt = select(TrumpDonor).order_by(TrumpDonor.amount_known.desc())
    result = await db.execute(stmt)
    donors = result.scalars().all()

    if not donors:
        return TRUMP_MAJOR_DONORS

    return [
        {
            "name": d.name,
            "amount_known": d.amount_known,
            "entity": d.entity,
            "interests": d.interests.split("; ") if d.interests else [],
        }
        for d in donors
    ]


@router.get("/policy-connections")
async def get_policy_stock_connections():
    """
    Map Trump policy actions to affected stocks.
    Shows winners and losers from each major policy initiative.
    """
    return POLICY_CONNECTIONS


@router.get("/trades")
async def get_trump_connected_trades():
    """
    Cross-reference: find insider trades and congressional trades
    for Trump-connected company tickers (DJT, TSLA, PLTR, ORCL, etc.).
    """
    return await get_trump_insider_trades()


@router.get("/hedge-fund-overlap")
async def get_trump_fund_overlap():
    """
    Check which tracked hedge funds hold Trump-connected stocks.
    Shows potential smart money flow into Trump orbit.
    """
    return await get_trump_hedge_fund_overlap()


@router.get("/conflict-map")
async def get_conflict_of_interest_map():
    """
    Build a conflict-of-interest map showing:
    - Trump insiders → their financial interests → policy decisions that benefit them
    This is the core investigative tool.
    """
    conflicts = []

    for insider in TRUMP_INSIDERS:
        # Find policy connections that affect this insider's interests
        insider_tickers = set(insider.get("tickers", []))
        related_policies = []

        for policy in POLICY_CONNECTIONS:
            policy_tickers = set(policy.get("tickers_affected", []))
            overlap = insider_tickers & policy_tickers
            if overlap:
                related_policies.append({
                    "policy": policy["policy"],
                    "description": policy["description"],
                    "affected_tickers": list(overlap),
                    "insider_is_winner": any(
                        t in policy.get("winners", []) or t in [w for w in policy.get("winners", []) if isinstance(w, str)]
                        for t in overlap
                    ),
                })

        if related_policies or insider.get("tickers"):
            connected_companies = [
                c for c in TRUMP_CONNECTED_COMPANIES
                if insider["name"] in c.get("insiders", [])
            ]

            conflicts.append({
                "insider": insider["name"],
                "role": insider["role"],
                "category": insider["category"],
                "financial_interests": insider.get("known_interests", []),
                "connected_tickers": insider.get("tickers", []),
                "board_seats": insider.get("board_seats", []),
                "connected_companies": [c["name"] for c in connected_companies],
                "policy_conflicts": related_policies,
                "conflict_severity": (
                    "CRITICAL" if len(related_policies) >= 2
                    else "HIGH" if len(related_policies) == 1
                    else "MODERATE" if insider.get("tickers")
                    else "LOW"
                ),
            })

    conflicts.sort(
        key=lambda x: {"CRITICAL": 0, "HIGH": 1, "MODERATE": 2, "LOW": 3}.get(x["conflict_severity"], 4)
    )
    return conflicts


@router.post("/ingest")
async def trigger_trump_ingestion():
    """Manually trigger Trump data ingestion."""
    return await run_trump_data_ingestion()
