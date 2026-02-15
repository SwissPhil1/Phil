"""AI-powered natural language search over the SmartFlow database.

Uses Anthropic Claude to convert plain English queries into safe SQL,
then executes the query and returns structured results.
"""

import logging
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ANTHROPIC_API_KEY

logger = logging.getLogger(__name__)

DB_SCHEMA = """
You have access to these tables in a SQLite / PostgreSQL database:

1. trades — Congressional STOCK Act disclosures (~110K rows)
   - id, chamber (house/senate), politician, party (R/D/I), state, district
   - ticker, asset_description, asset_type, tx_type (purchase/sale/exchange)
   - tx_date (datetime), disclosure_date (datetime)
   - amount_low (float $), amount_high (float $)
   - price_at_disclosure, price_current, price_30d_after, price_90d_after
   - return_since_disclosure (float %)

2. politicians — Pre-computed stats per politician
   - id, name, chamber, party, state, district
   - total_trades, total_buys, total_sells
   - avg_return (float %), win_rate (float 0-100)
   - portfolio_return (%), portfolio_cagr (%), conviction_return (%), conviction_cagr (%)
   - priced_buy_count, years_active (float)
   - last_trade_date

3. politician_committees — Committee assignments
   - id, bioguide_id, politician_name, party, state, chamber
   - committee_id, committee_name, role (Chair/Ranking Member/Member), rank

4. insider_trades — SEC Form 4 corporate insider trades
   - id, insider_name, insider_title, is_director, is_officer, is_ten_pct_owner
   - issuer_name, ticker
   - tx_date, filing_date, tx_type (purchase/sale/exercise/award/gift)
   - shares, price_per_share, total_value, shares_after
   - price_current, return_since_filing (%)

5. hedge_funds — 13F fund managers
   - id, name, manager_name, cik
   - total_value ($), num_holdings, last_filing_date

6. hedge_fund_holdings — Individual 13F holdings
   - id, fund_cik, report_date, issuer_name, ticker
   - value ($), shares, share_type
   - prev_shares, shares_change, shares_change_pct
   - is_new_position (bool), is_closed_position (bool)
   - price_current, return_since_report (%)

7. trump_insiders — Trump inner circle tracking
   - id, name, role, category (family/associate/appointee/donor)
   - known_interests, board_seats, tickers (comma-separated)

8. trump_connections — Trump-connected companies
   - id, company_name, ticker, connection_description, category, sector

IMPORTANT RELATIONSHIPS:
- trades.politician links to politicians.name
- trades.ticker can be joined with insider_trades.ticker or hedge_fund_holdings.ticker
- politician_committees.politician_name links to politicians.name / trades.politician
- To find politicians trading stocks in sectors they oversee, JOIN trades with politician_committees
"""

SYSTEM_PROMPT = f"""You are a SQL query generator for the SmartFlow political trade tracking database.
Given a natural language question, generate a single safe SQL SELECT query.

{DB_SCHEMA}

RULES:
1. ONLY generate SELECT statements. Never INSERT, UPDATE, DELETE, DROP, ALTER, or any DDL/DML.
2. Always LIMIT results to at most 100 rows.
3. Use standard SQL compatible with PostgreSQL.
4. For text matching use LIKE with % wildcards (case-insensitive: use LOWER()).
5. Return useful columns — include names, tickers, dates, amounts, returns when relevant.
6. For date filtering use PostgreSQL syntax: CURRENT_DATE - INTERVAL '1 year', CURRENT_DATE - INTERVAL '30 days', etc. NEVER use date('now', ...) which is SQLite-only.
7. When rounding floats, ALWAYS cast to numeric first: ROUND(column::NUMERIC, 1). Never call ROUND() directly on a float/double precision column.
8. When asked about "win rate" or "best performers", use the politicians table.
9. When asked about committee overlap or conflicts of interest, JOIN trades with politician_committees.
10. Order results by the most relevant metric (returns, trade count, etc.) DESC.

Respond with ONLY the SQL query, nothing else. No markdown, no explanation, no backticks."""


async def ai_search(query: str, db: AsyncSession) -> dict[str, Any]:
    """Convert a natural language query to SQL, execute it, and return results."""
    if not ANTHROPIC_API_KEY:
        return {
            "error": "Inv_API_Key not configured. Set it in your environment variables.",
            "query": query,
            "sql": None,
            "results": [],
            "summary": None,
        }

    try:
        import anthropic
    except ImportError:
        return {
            "error": "anthropic package not installed. Run: pip install anthropic",
            "query": query,
            "sql": None,
            "results": [],
            "summary": None,
        }

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Step 1: Generate SQL from natural language
    try:
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": query}],
        )
        sql = response.content[0].text.strip()
    except Exception as e:
        logger.error(f"AI search - Claude API error: {e}")
        return {
            "error": f"AI service error: {str(e)}",
            "query": query,
            "sql": None,
            "results": [],
            "summary": None,
        }

    # Step 2: Safety checks
    sql_upper = sql.upper().strip()
    # Remove markdown fences if Claude added them
    if sql.startswith("```"):
        sql = re.sub(r"^```(?:sql)?\n?", "", sql)
        sql = re.sub(r"\n?```$", "", sql)
        sql = sql.strip()
        sql_upper = sql.upper().strip()

    forbidden = ["INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER ", "CREATE ",
                  "TRUNCATE ", "EXEC ", "EXECUTE ", "GRANT ", "REVOKE ",
                  "--", ";--", "PRAGMA ", "ATTACH "]
    for word in forbidden:
        if word in sql_upper:
            return {
                "error": f"Query blocked: contains forbidden keyword '{word.strip()}'",
                "query": query,
                "sql": sql,
                "results": [],
                "summary": None,
            }

    if not sql_upper.startswith("SELECT"):
        return {
            "error": "Query blocked: only SELECT statements are allowed",
            "query": query,
            "sql": sql,
            "results": [],
            "summary": None,
        }

    # Ensure LIMIT exists
    if "LIMIT" not in sql_upper:
        sql = sql.rstrip(";") + " LIMIT 100"

    # Step 3: Execute the query
    try:
        result = await db.execute(text(sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    except Exception as e:
        logger.error(f"AI search - SQL execution error: {e}\nSQL: {sql}")
        return {
            "error": f"Query execution failed: {str(e)}",
            "query": query,
            "sql": sql,
            "results": [],
            "summary": None,
        }

    # Step 4: Generate a human-readable summary
    summary = None
    if rows:
        try:
            # Build a concise data preview for the summary
            preview = str(rows[:5]) if len(rows) <= 5 else str(rows[:5]) + f"... ({len(rows)} total rows)"
            if len(preview) > 2000:
                preview = preview[:2000] + "..."

            summary_response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": f"The user asked: \"{query}\"\n\nHere are the SQL results ({len(rows)} rows):\n{preview}\n\nWrite a 1-3 sentence summary of the key findings. Be specific with numbers. No markdown."
                }],
            )
            summary = summary_response.content[0].text.strip()
        except Exception as e:
            logger.warning(f"AI search - summary generation failed: {e}")
            summary = f"Found {len(rows)} results."

    # Convert datetime objects to strings for JSON serialization
    for row in rows:
        for key, val in row.items():
            if hasattr(val, "isoformat"):
                row[key] = val.isoformat()

    return {
        "error": None,
        "query": query,
        "sql": sql,
        "columns": columns if rows else [],
        "results": rows,
        "total": len(rows),
        "summary": summary or (f"No results found for: {query}" if not rows else None),
    }
