"""AI-powered natural language search endpoint."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import get_db
from app.services.ai_search import ai_search

router = APIRouter(prefix="/ai", tags=["AI Search"])


@router.get("/search")
async def search(
    q: str = Query(..., min_length=3, max_length=500, description="Natural language search query"),
    db: AsyncSession = Depends(get_db),
):
    """Search the database using natural language.

    Converts plain English questions into SQL queries using AI,
    then executes them and returns structured results.

    Examples:
    - "Politicians with highest win rate who traded tech stocks"
    - "Top 10 trades with best returns in the last year"
    - "Which politicians sit on the finance committee and traded bank stocks?"
    - "Show me insider buys over $1M in the last 6 months"
    """
    return await ai_search(q, db)
