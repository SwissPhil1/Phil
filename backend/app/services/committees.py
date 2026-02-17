"""Committee ingestion service — fetches congressional committee assignments.

Data source: unitedstates/congress GitHub repo (public domain).
Populates the PoliticianCommittee table used by the suspicion scoring engine
for committee-sector overlap detection.
"""

import logging
import re

import httpx
import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    PoliticianCommittee,
    Trade,
    async_session,
    dialect_insert,
)

logger = logging.getLogger(__name__)

# Public domain committee data from @unitedstates project
COMMITTEES_URL = (
    "https://raw.githubusercontent.com/unitedstates/congress-legislators/"
    "main/committee-membership-current.yaml"
)
COMMITTEES_NAMES_URL = (
    "https://raw.githubusercontent.com/unitedstates/congress-legislators/"
    "main/committees-current.yaml"
)
LEGISLATORS_URL = (
    "https://raw.githubusercontent.com/unitedstates/congress-legislators/"
    "main/legislators-current.yaml"
)


async def _fetch_yaml(client: httpx.AsyncClient, url: str) -> list | dict | None:
    """Fetch and parse a YAML file from GitHub."""
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning(f"Failed to fetch {url}: {resp.status_code}")
            return None
        return yaml.safe_load(resp.text)
    except Exception as e:
        logger.warning(f"Error fetching {url}: {e}")
        return None


def _build_name(leg: dict) -> str:
    """Build display name from legislator data."""
    name_info = leg.get("name", {})
    first = name_info.get("nickname") or name_info.get("first", "")
    last = name_info.get("last", "")
    return f"{first} {last}".strip()


async def ingest_committees() -> dict:
    """Fetch committee assignments and store in PoliticianCommittee table.

    Returns stats about the ingestion.
    """
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # Fetch all three data files
        membership_data = await _fetch_yaml(client, COMMITTEES_URL)
        committees_data = await _fetch_yaml(client, COMMITTEES_NAMES_URL)
        legislators_data = await _fetch_yaml(client, LEGISLATORS_URL)

    if not membership_data or not committees_data or not legislators_data:
        return {"error": "Failed to fetch committee data from GitHub"}

    # Build committee name lookup
    committee_names: dict[str, str] = {}
    for comm in committees_data:
        cid = comm.get("thomas_id", "")
        name = comm.get("name", "")
        committee_names[cid] = name

    # Build bioguide -> legislator info lookup
    leg_info: dict[str, dict] = {}
    for leg in legislators_data:
        ids = leg.get("id", {})
        bioguide = ids.get("bioguide", "")
        if not bioguide:
            continue
        terms = leg.get("terms", [])
        latest = terms[-1] if terms else {}
        leg_info[bioguide] = {
            "name": _build_name(leg),
            "party": latest.get("party", "")[0] if latest.get("party") else None,
            "state": latest.get("state"),
            "chamber": "senate" if latest.get("type") == "sen" else "house",
        }

    # Also get all politician names from our trades DB for fuzzy matching
    async with async_session() as session:
        trade_names_result = await session.execute(
            select(Trade.politician).distinct()
        )
        trade_names = {r[0] for r in trade_names_result.all() if r[0]}

    # Build name matching index for fuzzy matching
    def _normalize(name: str) -> str:
        return re.sub(r"[^a-z]", "", name.lower())

    trade_name_index: dict[str, str] = {}
    for tn in trade_names:
        trade_name_index[_normalize(tn)] = tn
        # Also index by last name for fallback
        parts = tn.split()
        if parts:
            trade_name_index[_normalize(parts[-1])] = tn

    def _match_to_trade_name(leg_name: str) -> str:
        """Try to match a legislator name to a trade politician name."""
        norm = _normalize(leg_name)
        if norm in trade_name_index:
            return trade_name_index[norm]
        # Try last name only
        parts = leg_name.split()
        if parts:
            last_norm = _normalize(parts[-1])
            if last_norm in trade_name_index:
                return trade_name_index[last_norm]
        return leg_name

    # Process membership data
    rows = []
    for committee_id, members in membership_data.items():
        # committee_id might be like "SSAS" (Senate Armed Services) or "HSAS" (House Armed Services)
        base_id = committee_id.split("/")[0]  # Handle subcommittees
        committee_name = committee_names.get(base_id, committee_id)

        for member in members:
            bioguide = member.get("bioguide", "")
            info = leg_info.get(bioguide, {})
            if not info:
                continue

            politician_name = _match_to_trade_name(info["name"])

            rows.append({
                "bioguide_id": bioguide,
                "politician_name": politician_name,
                "party": info.get("party"),
                "state": info.get("state"),
                "chamber": info.get("chamber"),
                "committee_id": committee_id,
                "committee_name": committee_name,
                "role": member.get("title"),
                "rank": member.get("rank"),
            })

    # Bulk upsert
    inserted = 0
    async with async_session() as session:
        for row in rows:
            stmt = dialect_insert(PoliticianCommittee).values(**row)
            stmt = stmt.on_conflict_do_update(
                index_elements=["bioguide_id", "committee_id"],
                set_={
                    "politician_name": row["politician_name"],
                    "committee_name": row["committee_name"],
                    "role": row["role"],
                    "rank": row["rank"],
                },
            )
            await session.execute(stmt)
            inserted += 1

        await session.commit()

    logger.info(f"Ingested {inserted} committee assignments")
    return {
        "total_committees": len(committee_names),
        "total_legislators": len(leg_info),
        "assignments_stored": inserted,
    }


async def run_committee_ingestion() -> dict:
    """Entry point for committee ingestion."""
    return await ingest_committees()
