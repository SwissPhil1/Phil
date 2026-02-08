"""
Congress committee assignment data service.

Fetches politician -> committee mappings from the unitedstates/congress-legislators
GitHub repository (the most comprehensive free structured source).
Data files: legislators-current.json, committee-membership-current.json, committees-current.json
"""

import logging
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import PoliticianCommittee, async_session

logger = logging.getLogger(__name__)

# Raw GitHub URLs for congress-legislators data
GITHUB_RAW = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main"
LEGISLATORS_URL = f"{GITHUB_RAW}/legislators-current.json"
COMMITTEES_URL = f"{GITHUB_RAW}/committees-current.json"
MEMBERSHIP_URL = f"{GITHUB_RAW}/committee-membership-current.json"


async def fetch_legislators(client: httpx.AsyncClient) -> dict:
    """Fetch current legislators and build bioguide -> info map."""
    resp = await client.get(LEGISLATORS_URL, timeout=30.0)
    resp.raise_for_status()
    data = resp.json()

    legislators = {}
    for leg in data:
        bio_id = leg.get("id", {}).get("bioguide")
        if not bio_id:
            continue

        name = leg.get("name", {})
        full_name = name.get("official_full", f"{name.get('first', '')} {name.get('last', '')}")

        # Current term
        terms = leg.get("terms", [])
        current_term = terms[-1] if terms else {}

        legislators[bio_id] = {
            "name": full_name,
            "bioguide": bio_id,
            "party": current_term.get("party", ""),
            "state": current_term.get("state", ""),
            "chamber": "senate" if current_term.get("type") == "sen" else "house",
            "district": current_term.get("district"),
        }

    return legislators


async def fetch_committees(client: httpx.AsyncClient) -> dict:
    """Fetch committee metadata and build committee_id -> info map."""
    resp = await client.get(COMMITTEES_URL, timeout=30.0)
    resp.raise_for_status()
    data = resp.json()

    committees = {}
    for comm in data:
        comm_id = comm.get("thomas_id") or comm.get("id", "")
        committees[comm_id] = {
            "name": comm.get("name", ""),
            "type": comm.get("type", ""),  # house, senate, joint
            "url": comm.get("url", ""),
        }
        # Also index subcommittees
        for sub in comm.get("subcommittees", []):
            sub_id = f"{comm_id}{sub.get('thomas_id', sub.get('id', ''))}"
            committees[sub_id] = {
                "name": f"{comm.get('name', '')} - {sub.get('name', '')}",
                "type": comm.get("type", ""),
                "parent": comm_id,
                "parent_name": comm.get("name", ""),
            }

    return committees


async def fetch_memberships(client: httpx.AsyncClient) -> dict:
    """Fetch committee membership data: committee_id -> list of members."""
    resp = await client.get(MEMBERSHIP_URL, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


async def run_committee_ingestion() -> dict:
    """Fetch and store all committee assignments for current Congress members."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        legislators = await fetch_legislators(client)
        committees = await fetch_committees(client)
        memberships = await fetch_memberships(client)

    logger.info(f"Fetched {len(legislators)} legislators, {len(committees)} committees")

    new_count = 0
    updated_count = 0

    async with async_session() as session:
        for comm_id, members in memberships.items():
            comm_info = committees.get(comm_id, {})
            comm_name = comm_info.get("name", comm_id)

            for member in members:
                bio_id = member.get("bioguide")
                if not bio_id or bio_id not in legislators:
                    continue

                leg_info = legislators[bio_id]
                role = member.get("title", "Member")
                rank = member.get("rank")

                record = {
                    "bioguide_id": bio_id,
                    "politician_name": leg_info["name"],
                    "party": leg_info["party"],
                    "state": leg_info["state"],
                    "chamber": leg_info["chamber"],
                    "committee_id": comm_id,
                    "committee_name": comm_name,
                    "role": role,
                    "rank": rank,
                    "updated_at": datetime.utcnow(),
                }

                stmt = (
                    sqlite_insert(PoliticianCommittee)
                    .values(**record)
                    .on_conflict_do_update(
                        index_elements=["bioguide_id", "committee_id"],
                        set_={
                            "politician_name": record["politician_name"],
                            "role": record["role"],
                            "rank": record["rank"],
                            "updated_at": record["updated_at"],
                        },
                    )
                )
                result = await session.execute(stmt)
                if result.rowcount > 0:
                    new_count += 1

        await session.commit()

    logger.info(f"Committee ingestion complete: {new_count} records")
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "legislators_found": len(legislators),
        "committees_found": len(committees),
        "assignments_stored": new_count,
    }


async def get_politician_committees(name: str) -> list[dict]:
    """Get all committee assignments for a politician by name."""
    async with async_session() as session:
        stmt = (
            select(PoliticianCommittee)
            .where(PoliticianCommittee.politician_name.ilike(f"%{name}%"))
            .order_by(PoliticianCommittee.committee_name)
        )
        result = await session.execute(stmt)
        records = result.scalars().all()

        return [
            {
                "committee_id": r.committee_id,
                "committee_name": r.committee_name,
                "role": r.role,
                "rank": r.rank,
            }
            for r in records
        ]


async def get_committee_members(committee_name: str) -> list[dict]:
    """Get all members of a committee by name."""
    async with async_session() as session:
        stmt = (
            select(PoliticianCommittee)
            .where(PoliticianCommittee.committee_name.ilike(f"%{committee_name}%"))
            .order_by(PoliticianCommittee.rank)
        )
        result = await session.execute(stmt)
        records = result.scalars().all()

        return [
            {
                "politician_name": r.politician_name,
                "bioguide_id": r.bioguide_id,
                "party": r.party,
                "state": r.state,
                "chamber": r.chamber,
                "role": r.role,
                "rank": r.rank,
            }
            for r in records
        ]
