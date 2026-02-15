"""Saved AI search segments — store queries and refresh results automatically."""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import SavedSegment, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/segments", tags=["Segments"])


class SegmentCreate(BaseModel):
    name: str
    query: str
    sql: str
    columns: list[str]
    results: list[dict]
    summary: str | None = None


class SegmentOut(BaseModel):
    id: int
    name: str
    query: str
    sql: str
    columns: list[str]
    results: list[dict]
    result_count: int
    summary: str | None
    created_at: str
    refreshed_at: str


def _row_to_out(seg: SavedSegment) -> dict:
    return {
        "id": seg.id,
        "name": seg.name,
        "query": seg.query,
        "sql": seg.sql,
        "columns": json.loads(seg.columns_json) if seg.columns_json else [],
        "results": json.loads(seg.results_json) if seg.results_json else [],
        "result_count": seg.result_count or 0,
        "summary": seg.summary,
        "created_at": seg.created_at.isoformat() if seg.created_at else "",
        "refreshed_at": seg.refreshed_at.isoformat() if seg.refreshed_at else "",
    }


@router.get("")
async def list_segments(db: AsyncSession = Depends(get_db)):
    """List all saved segments, newest first."""
    result = await db.execute(
        select(SavedSegment).order_by(SavedSegment.created_at.desc())
    )
    segments = result.scalars().all()
    return [_row_to_out(s) for s in segments]


@router.post("")
async def create_segment(body: SegmentCreate, db: AsyncSession = Depends(get_db)):
    """Save a new segment from an AI search result."""
    seg = SavedSegment(
        name=body.name,
        query=body.query,
        sql=body.sql,
        columns_json=json.dumps(body.columns),
        results_json=json.dumps(body.results),
        result_count=len(body.results),
        summary=body.summary,
        created_at=datetime.utcnow(),
        refreshed_at=datetime.utcnow(),
    )
    db.add(seg)
    await db.commit()
    await db.refresh(seg)
    return _row_to_out(seg)


@router.delete("/{segment_id}")
async def delete_segment(segment_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a saved segment."""
    result = await db.execute(select(SavedSegment).where(SavedSegment.id == segment_id))
    seg = result.scalar_one_or_none()
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found")
    await db.execute(delete(SavedSegment).where(SavedSegment.id == segment_id))
    await db.commit()
    return {"status": "deleted"}


@router.post("/{segment_id}/refresh")
async def refresh_segment(segment_id: int, db: AsyncSession = Depends(get_db)):
    """Re-execute the segment's SQL and update cached results."""
    from sqlalchemy import text

    result = await db.execute(select(SavedSegment).where(SavedSegment.id == segment_id))
    seg = result.scalar_one_or_none()
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Safety: only allow SELECT
    sql_upper = seg.sql.upper().strip()
    if not sql_upper.startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Saved SQL is not a SELECT statement")

    try:
        qr = await db.execute(text(seg.sql))
        columns = list(qr.keys())
        rows = [dict(zip(columns, row)) for row in qr.fetchall()]

        # Convert datetime objects for JSON
        for row in rows:
            for key, val in row.items():
                if hasattr(val, "isoformat"):
                    row[key] = val.isoformat()

        seg.columns_json = json.dumps(columns)
        seg.results_json = json.dumps(rows)
        seg.result_count = len(rows)
        seg.refreshed_at = datetime.utcnow()
        await db.commit()
        await db.refresh(seg)

        return _row_to_out(seg)
    except Exception as e:
        logger.error(f"Segment refresh failed (id={segment_id}): {e}")
        raise HTTPException(status_code=400, detail=f"Query execution failed: {str(e)}")
