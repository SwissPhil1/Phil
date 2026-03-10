"""
Batch wallet scorer — discover active traders from Polymarket data API
and score them using the shared scoring module.

Usage:
    python batch_score.py              # discover + score top 30 traders
    python batch_score.py --limit 50   # score top 50
"""
import os
import sys
import time
from pathlib import Path
from collections import defaultdict

# Ensure imports work
sys.path.insert(0, str(Path(__file__).parent))
from scoring import score_wallet, save_scores_to_supabase, resolve_username, GAMMA_URL

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_ANON_KEY"]
DATA_API = "https://data-api.polymarket.com"

# Lazy-init Supabase client
_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


def get_existing_labels():
    """Fetch existing wallet labels from Supabase so we don't overwrite them."""
    sb = get_supabase()
    try:
        resp = sb.table("wallets").select("address,label").execute()
        return {row["address"]: row["label"] for row in (resp.data or []) if row.get("label")}
    except Exception:
        return {}


def discover_active_traders(min_trades=5, pages=8):
    """Pull recent trades from data-api to find active wallets."""
    trader_stats = defaultdict(lambda: {"trades": 0, "volume": 0.0, "markets": set()})

    for offset in range(0, pages * 500, 500):
        try:
            r = requests.get(
                f"{DATA_API}/trades",
                params={"limit": 500, "offset": offset},
                timeout=15,
            )
            if not r.ok:
                break
            trades = r.json()
            if not trades:
                break
            for t in trades:
                addr = (t.get("proxyWallet") or "").lower()
                if not addr or not addr.startswith("0x"):
                    continue
                trader_stats[addr]["trades"] += 1
                trader_stats[addr]["volume"] += float(t.get("size", 0)) * float(t.get("price", 0))
                trader_stats[addr]["markets"].add(t.get("conditionId", ""))
            print(f"  Page {offset // 500 + 1}: {len(trades)} trades, {len(trader_stats)} wallets")
            time.sleep(0.3)
        except Exception as e:
            print(f"  Page error: {e}")
            break

    # Convert sets to counts and filter
    results = []
    for addr, s in trader_stats.items():
        if s["trades"] >= min_trades:
            results.append({
                "address": addr,
                "trades": s["trades"],
                "volume": s["volume"],
                "markets": len(s["markets"]),
            })
    results.sort(key=lambda x: x["trades"], reverse=True)
    return results


def main():
    limit = 30
    if "--limit" in sys.argv:
        idx = sys.argv.index("--limit")
        limit = int(sys.argv[idx + 1])

    print("=" * 60)
    print(f"BATCH WALLET SCORER — targeting {limit} wallets")
    print("=" * 60)

    # Step 1: Discover traders
    print("\n[1] Discovering active traders from recent trades...")
    candidates = discover_active_traders(min_trades=5, pages=8)
    print(f"  Found {len(candidates)} candidates with 5+ trades")

    # Step 1b: Load existing labels so we don't overwrite Polymarket names
    print("\n  Loading existing wallet labels...")
    existing_labels = get_existing_labels()
    print(f"  Found {len(existing_labels)} existing labels")

    # Step 2: Score each one
    print(f"\n[2] Scoring top {limit} wallets...")
    scored = 0
    failed = 0

    for i, c in enumerate(candidates[:limit + 10]):  # extra buffer for failures
        if scored >= limit:
            break
        addr = c["address"]
        print(f"\n  [{scored + 1}/{limit}] {addr[:16]}... ({c['trades']} trades, ${c['volume']:.0f} vol)")

        try:
            # Preserve existing label or try to resolve username
            existing = existing_labels.get(addr)
            if existing and not existing.startswith(("elite_", "sharp_", "moderate_", "noise_", "unknown_")):
                username = existing
            else:
                username = resolve_username(addr)
                if username:
                    print(f"    Resolved username: {username}")

            report = score_wallet(addr, existing_label=username)
            if report and report["total_bets"] >= 3:
                save_scores_to_supabase(report, SUPABASE_URL, SUPABASE_KEY)
                print(f"    -> {report['tier'].upper()} | CLV={report['clv']:+.4f} | WR={report['win_rate']:.1%} | ROI={report['roi']:+.1%} | {report['total_bets']} bets")
                scored += 1
            else:
                print(f"    -> skipped (insufficient data)")
                failed += 1
        except Exception as e:
            print(f"    -> error: {e}")
            failed += 1

        time.sleep(0.5)  # rate limit

    print(f"\n{'=' * 60}")
    print(f"BATCH COMPLETE: {scored} scored, {failed} failed")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
