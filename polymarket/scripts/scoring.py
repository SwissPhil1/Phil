"""
Shared scoring module — single source of truth for wallet scoring logic.

Used by: wallet_analyzer.py, batch_score.py, scheduler.py (job processor).
NOT used by: dashboard/api/rescore.py (which only creates jobs, no scoring).

Usage as CLI:
    python scoring.py 0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee
"""
import os
import re
import sys
import time
import json
from datetime import datetime, timezone
from collections import defaultdict

import requests

# ── API endpoints ──

GAMMA_URL = os.environ.get("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com")
DATA_API = "https://data-api.polymarket.com"
CLOB_URL = os.environ.get("POLYMARKET_API_URL", "https://clob.polymarket.com")


# ── Market categorization ──

def categorize_market(title, tags=None):
    """Categorize a market based on title and optional tags."""
    combined = ((title or "") + " " + " ".join(tags or [])).lower()

    if any(w in combined for w in [
        "trump", "biden", "election", "congress", "president",
        "democrat", "republican", "vote", "senate", "governor",
    ]):
        return "politics"
    if any(w in combined for w in [
        "bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "token", "defi",
    ]):
        return "crypto"
    if any(w in combined for w in [
        "nfl", "nba", "mlb", "nhl", "soccer", "football", "basketball",
        "ufc", "sports", "tennis", "boxing", "super bowl", "championship",
        "playoffs", "spread:", "moneyline", "over/under",
    ]):
        return "sports"
    # "Team vs. Team" pattern
    if re.search(r'\b\w+\s+vs\.?\s+\w+\b', combined):
        return "sports"
    # Team names
    if any(w in combined for w in [
        "oilers", "knights", "celtics", "cavaliers", "lakers", "warriors",
        "bears", "rams", "seahawks", "chiefs", "eagles", "hurricanes",
        "flames", "bruins", "penguins", "lightning", "sabres", "capitals",
        "devils", "islanders", "sharks", "blackhawks", "stars", "wild",
        "avalanche", "blues", "ducks", "pelicans", "hawks",
    ]):
        return "sports"
    if any(w in combined for w in ["movie", "oscar", "grammy", "celebrity", "entertainment"]):
        return "entertainment"
    if any(w in combined for w in ["ai", "openai", "climate", "nasa", "science", "spacex"]):
        return "science"
    return "other"


# ── Sharpness metrics ──

def compute_clv(entry_price, closing_price, side):
    """Closing Line Value — how much better was entry vs close."""
    if closing_price is None or entry_price is None:
        return 0
    if side == "BUY":
        return float(closing_price - entry_price)
    return float(entry_price - closing_price)


def compute_calibration(bets_with_prices):
    """Calibration score (lower = better calibrated)."""
    if not bets_with_prices:
        return 0.5
    buckets = defaultdict(list)
    for price, won in bets_with_prices:
        bucket = min(9, int(price * 10))
        buckets[bucket].append(1 if won else 0)
    total_error = 0
    count = 0
    for bucket, outcomes in buckets.items():
        implied = (bucket + 0.5) / 10
        actual = sum(outcomes) / len(outcomes)
        total_error += abs(actual - implied)
        count += 1
    return round(total_error / max(count, 1), 4) if count else 0.5


def assign_tier(clv, win_rate, total_bets):
    """Assign tier based on CLV + win rate + sample size."""
    if total_bets < 5:
        return "unknown"
    if clv > 0.05 and win_rate > 0.55:
        return "elite"
    if clv > 0.02 and win_rate > 0.52:
        return "sharp"
    if clv > 0 and win_rate > 0.48:
        return "moderate"
    return "noise"


# ── Data fetching ──

def fetch_user_trades(address, limit=2000):
    """Fetch trades from Polymarket data API with pagination and dedup."""
    all_trades = []
    max_pages = max(1, limit // 200)

    offset = 0
    for page in range(max_pages):
        params = {"user": address, "limit": 200, "offset": offset}
        try:
            r = requests.get(f"{DATA_API}/trades", params=params, timeout=15)
            if not r.ok:
                break
            data = r.json()
            if not isinstance(data, list) or not data:
                break
            all_trades.extend(data)
            offset += len(data)
            if len(data) < 200:
                break
        except Exception:
            break
        time.sleep(0.3)

    # Deduplicate by transaction hash + asset + timestamp
    seen = set()
    unique = []
    for t in all_trades:
        tid = t.get("transactionHash", "") + t.get("asset", "") + str(t.get("timestamp", ""))
        if tid not in seen:
            seen.add(tid)
            unique.append(t)
    return unique


def fetch_user_positions(address):
    """Fetch current open positions from data API."""
    try:
        r = requests.get(
            f"{DATA_API}/positions",
            params={"user": address, "sizeThreshold": 0},
            timeout=15,
        )
        if r.ok:
            data = r.json()
            return data if isinstance(data, list) else []
    except Exception:
        pass
    return []


def resolve_username(address):
    """Try to resolve a Polymarket username for a wallet address."""
    try:
        r = requests.get(f"{GAMMA_URL}/profiles/{address}", timeout=10)
        if r.ok:
            p = r.json()
            return p.get("username") or p.get("name") or None
    except Exception:
        pass
    return None


# ── Core scoring ──

def score_wallet(address, existing_label=None, trade_limit=2000):
    """
    Score a single wallet. Returns a result dict or None if insufficient data.
    Does NOT write to the database — caller decides persistence.
    """
    trades = fetch_user_trades(address, limit=trade_limit)
    if not trades or len(trades) < 3:
        return None

    positions = fetch_user_positions(address)
    position_pnl = {}
    for p in positions:
        cid = p.get("conditionId", "")
        position_pnl[cid] = {
            "cashPnl": float(p.get("cashPnl", 0) or 0),
            "percentPnl": float(p.get("percentPnl", 0) or 0),
            "curPrice": float(p.get("curPrice", 0) or 0),
            "avgPrice": float(p.get("avgPrice", 0) or 0),
            "initialValue": float(p.get("initialValue", 0) or 0),
        }

    bets = []
    by_cat = defaultdict(list)

    for t in trades:
        price = float(t.get("price", 0) or 0)
        size = float(t.get("size", 0) or 0)
        side = t.get("side", "BUY")
        title = t.get("title", "")
        condition_id = t.get("conditionId", "")
        category = categorize_market(title)

        pos = position_pnl.get(condition_id, {})
        closing_price = pos.get("curPrice") if pos else None
        won = None
        if pos and pos.get("percentPnl", 0) != 0:
            won = pos["cashPnl"] > 0

        clv = compute_clv(price, closing_price, side) if closing_price else None
        amount_usd = round(price * size, 2)

        bet = {
            "address": address,
            "market_slug": t.get("slug", t.get("eventSlug", ""))[:200],
            "market_title": title[:500],
            "category": category,
            "outcome": t.get("outcome", "Yes"),
            "side": side,
            "price": price,
            "size": size,
            "amount_usd": amount_usd,
            "timestamp": t.get("timestamp"),
            "resolved": closing_price is not None and closing_price in (0, 1),
            "won": won,
            "closing_price": closing_price,
            "clv": clv,
        }
        bets.append(bet)
        by_cat[category].append(bet)

    # Aggregate metrics
    resolved = [b for b in bets if b["resolved"] and b["won"] is not None]
    wins = sum(1 for b in resolved if b["won"])
    win_rate = wins / max(len(resolved), 1) if resolved else 0

    clvs = [b["clv"] for b in bets if b["clv"] is not None]
    avg_clv = sum(clvs) / max(len(clvs), 1) if clvs else 0

    total_wagered = sum(b["amount_usd"] for b in bets if b["amount_usd"])
    total_pnl = sum(
        (1 - b["price"]) * b["size"] if b["won"] else -b["price"] * b["size"]
        for b in resolved if b["won"] is not None
    )
    realized_roi = total_pnl / max(total_wagered, 1) if total_wagered else 0

    # Current ROI includes unrealized position PnL
    total_pos_pnl = sum(p.get("cashPnl", 0) for p in position_pnl.values())
    current_roi = (total_pnl + total_pos_pnl) / max(total_wagered, 1)

    cal_data = [(b["price"], b["won"]) for b in resolved if b["won"] is not None and b["price"] > 0]
    calibration = compute_calibration(cal_data)
    avg_edge = avg_clv * 0.7 + (win_rate - 0.5) * 0.3
    sharpe = realized_roi / max(0.01, calibration) if calibration > 0 else 0
    kelly = max(0, (win_rate * (1 + avg_clv) - 1) / max(avg_clv, 0.01))
    tier = assign_tier(avg_clv, win_rate, len(bets))

    # Resolve label
    username = existing_label
    if not username or username.startswith(("elite_", "sharp_", "moderate_", "noise_", "unknown_")):
        username = resolve_username(address)
    label = username or f"{tier}_{address[:6]}"

    # Category breakdown
    cat_scores = {}
    for cat, cat_bets in by_cat.items():
        cat_resolved = [b for b in cat_bets if b["resolved"] and b["won"] is not None]
        cat_wins = sum(1 for b in cat_resolved if b["won"])
        cat_wr = cat_wins / max(len(cat_resolved), 1) if cat_resolved else 0
        cat_clvs = [b["clv"] for b in cat_bets if b["clv"] is not None]
        cat_avg_clv = sum(cat_clvs) / max(len(cat_clvs), 1) if cat_clvs else 0
        cat_wagered = sum(b["amount_usd"] for b in cat_bets if b["amount_usd"])
        cat_pnl = sum(
            (1 - b["price"]) * b["size"] if b["won"] else -b["price"] * b["size"]
            for b in cat_resolved if b["won"] is not None
        )
        cat_roi = cat_pnl / max(cat_wagered, 1)
        cat_scores[cat] = {
            "category": cat,
            "total_bets": len(cat_bets),
            "win_rate": round(cat_wr, 4),
            "clv": round(cat_avg_clv, 4),
            "roi": round(cat_roi, 4),
        }

    return {
        "address": address,
        "label": label,
        "username": username,
        "tier": tier,
        "total_bets": len(bets),
        "total_volume": round(total_wagered, 2),
        "resolved_bets": len(resolved),
        "wins": wins,
        "win_rate": round(win_rate, 4),
        "clv": round(avg_clv, 4),
        "roi": round(realized_roi, 4),
        "current_roi": round(current_roi, 4),
        "calibration": round(calibration, 4),
        "avg_edge": round(avg_edge, 4),
        "sharpe_ratio": round(sharpe, 4),
        "kelly_fraction": round(kelly, 4),
        "categories": cat_scores,
        "open_positions": len(positions),
        "bets": bets,
    }


# ── Supabase persistence (REST-based, no supabase-py dependency) ──

def save_scores_to_supabase(result, supabase_url, supabase_key):
    """Save scoring results to Supabase via REST API. Returns True on success."""
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    now = datetime.now(timezone.utc).isoformat()
    addr = result["address"]

    def upsert(table, data):
        r = requests.post(
            f"{supabase_url}/rest/v1/{table}",
            headers=headers, json=data, timeout=10,
        )
        return r.ok

    # Wallet
    upsert("wallets", {
        "address": addr,
        "label": result["label"],
        "total_bets": result["total_bets"],
        "total_volume": result["total_volume"],
        "is_tracked": result["tier"] in ("elite", "sharp"),
        "updated_at": now,
    })

    # Scores
    upsert("wallet_scores", {
        "address": addr,
        "total_bets": result["total_bets"],
        "win_rate": result["win_rate"],
        "clv": result["clv"],
        "roi": result["roi"],
        "current_roi": result["current_roi"],
        "calibration": result["calibration"],
        "avg_edge": result["avg_edge"],
        "kelly_fraction": result["kelly_fraction"],
        "sharpe_ratio": result["sharpe_ratio"],
        "tier": result["tier"],
        "updated_at": now,
    })

    # Category scores
    for cat, cs in result.get("categories", {}).items():
        upsert("wallet_category_scores", {
            "address": addr,
            "category": cat,
            "total_bets": cs["total_bets"],
            "win_rate": cs["win_rate"],
            "clv": cs["clv"],
            "roi": cs["roi"],
            "updated_at": now,
        })

    return True


# ── CLI entry point ──

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scoring.py <wallet_address>")
        sys.exit(1)

    address = sys.argv[1].strip().lower()
    print(f"Scoring {address}...")
    result = score_wallet(address)
    if result:
        print(json.dumps({k: v for k, v in result.items() if k != "bets"}, indent=2))
    else:
        print("Insufficient data to score this wallet.")
