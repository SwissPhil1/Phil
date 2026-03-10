"""
Wallet Analyzer — analyze a specific Polymarket wallet by username or address.

Usage:
    python wallet_analyzer.py kch123              # by Polymarket username
    python wallet_analyzer.py 0xabc123...         # by wallet address
    python wallet_analyzer.py kch123 --save       # analyze + save to Supabase
"""
import os
import sys
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_ANON_KEY"]
GAMMA_URL = os.environ.get("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com")
CLOB_URL = os.environ.get("POLYMARKET_API_URL", "https://clob.polymarket.com")

# Import shared scoring functions
sys.path.insert(0, str(Path(__file__).parent))
from scoring import (
    score_wallet, categorize_market, compute_clv, compute_calibration,
    assign_tier, fetch_user_trades, fetch_user_positions, save_scores_to_supabase,
)

# Lazy-init Supabase client (only if --save)
_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


# ── Address resolution (CLI-specific, richer than scoring.resolve_username) ──

def resolve_address(identifier):
    """Resolve a username or address to a wallet address + profile info."""
    # Already an address
    if identifier.startswith("0x") and len(identifier) >= 40:
        return identifier, {"username": None, "address": identifier}

    # Look up by username via Gamma API
    try:
        r = requests.get(f"{GAMMA_URL}/users", params={"username": identifier}, timeout=10)
        if r.ok:
            users = r.json()
            if isinstance(users, list) and users:
                u = users[0]
                return u.get("proxyWallet") or u.get("address") or u.get("id"), u
            elif isinstance(users, dict) and users.get("address"):
                return users.get("proxyWallet") or users["address"], users
    except Exception as e:
        print(f"  Warning: Gamma user lookup failed: {e}")

    # Try profile endpoint
    try:
        r = requests.get(f"{GAMMA_URL}/profiles/{identifier}", timeout=10)
        if r.ok:
            u = r.json()
            addr = u.get("proxyWallet") or u.get("address") or u.get("id")
            if addr:
                return addr, u
    except Exception:
        pass

    # Try CLOB API user lookup
    try:
        r = requests.get(f"{CLOB_URL}/profile/{identifier}", timeout=10)
        if r.ok:
            u = r.json()
            addr = u.get("proxyWallet") or u.get("address")
            if addr:
                return addr, u
    except Exception:
        pass

    # Try scraping the Polymarket profile page
    try:
        import re
        r = requests.get(f"https://polymarket.com/@{identifier}", timeout=10, allow_redirects=True)
        if r.ok:
            match = re.search(r'"proxyWallet"\s*:\s*"(0x[a-fA-F0-9]{40})"', r.text)
            if match:
                addr = match.group(1)
                return addr, {"username": identifier, "address": addr}
            addrs = re.findall(r'0x[a-fA-F0-9]{40}', r.text)
            if addrs:
                return addrs[0], {"username": identifier, "address": addrs[0]}
    except Exception:
        pass

    return identifier, {"username": identifier, "address": identifier}


# ── CLI report printing ──

def print_report(r):
    """Pretty-print the analysis report."""
    tier_colors = {"elite": "\033[92m", "sharp": "\033[96m", "moderate": "\033[93m", "noise": "\033[90m", "unknown": "\033[90m"}
    reset = "\033[0m"
    tc = tier_colors.get(r["tier"], "")

    print(f"\n{'=' * 60}")
    print(f"  SHARPNESS REPORT")
    print(f"{'=' * 60}")
    print(f"  Address:    {r['address']}")
    if r.get("username"):
        print(f"  Username:   {r['username']}")
    print(f"  Tier:       {tc}{r['tier'].upper()}{reset}")
    print(f"{'─' * 60}")
    print(f"  Total Bets:      {r['total_bets']}")
    print(f"  Total Volume:    ${r['total_volume']:,.2f}")
    print(f"  Resolved Bets:   {r.get('resolved_bets', 'N/A')}")
    print(f"  Wins:            {r.get('wins', 'N/A')}")
    print(f"{'─' * 60}")
    clv_sign = "+" if r["clv"] > 0 else ""
    roi_sign = "+" if r["roi"] > 0 else ""
    print(f"  Win Rate:        {r['win_rate'] * 100:.1f}%")
    print(f"  CLV:             {clv_sign}{r['clv'] * 100:.2f}%")
    print(f"  ROI (realized):  {roi_sign}{r['roi'] * 100:.1f}%")
    current_roi_sign = "+" if r.get("current_roi", 0) > 0 else ""
    print(f"  ROI (current):   {current_roi_sign}{r.get('current_roi', 0) * 100:.1f}%")
    print(f"  Calibration:     {r['calibration']:.4f}")
    print(f"  Avg Edge:        {r['avg_edge'] * 100:.2f}%")
    print(f"  Sharpe Ratio:    {r['sharpe_ratio']:.2f}")
    print(f"  Kelly Fraction:  {r['kelly_fraction']:.4f}")
    print(f"  Open Positions:  {r.get('open_positions', 'N/A')}")

    if r.get("categories"):
        print(f"\n{'─' * 60}")
        print(f"  CATEGORY BREAKDOWN")
        print(f"  {'Category':<15} {'Bets':>5} {'Win%':>7} {'CLV':>8} {'ROI':>8}")
        for cat, cs in sorted(r["categories"].items(), key=lambda x: x[1]["clv"], reverse=True):
            clv_s = f"{'+' if cs['clv'] > 0 else ''}{cs['clv'] * 100:.1f}%"
            roi_s = f"{'+' if cs['roi'] > 0 else ''}{cs['roi'] * 100:.1f}%"
            print(f"  {cat:<15} {cs['total_bets']:>5} {cs['win_rate'] * 100:>6.1f}% {clv_s:>8} {roi_s:>8}")

    print(f"\n{'=' * 60}")


# ── Supabase save (uses supabase-py client for richer operations) ──

def save_to_supabase(report):
    """Save the analysis results to Supabase using supabase-py client."""
    sb = get_supabase()
    addr = report["address"]
    now = datetime.now(timezone.utc).isoformat()

    print("\nSaving to Supabase...")

    # 1. Upsert wallet
    wallet_row = {
        "address": addr,
        "label": report.get("label") or report.get("username") or f"{report['tier']}_{addr[:6]}",
        "total_bets": report["total_bets"],
        "total_volume": report["total_volume"],
        "is_tracked": report["tier"] in ("elite", "sharp"),
        "updated_at": now,
    }
    try:
        sb.table("wallets").upsert(wallet_row, on_conflict="address").execute()
        print(f"  Wallet saved")
    except Exception as e:
        print(f"  Warning: wallet upsert failed: {e}")

    # 2. Upsert wallet_scores
    score_row = {
        "address": addr,
        "total_bets": report["total_bets"],
        "win_rate": report["win_rate"],
        "clv": report["clv"],
        "roi": report["roi"],
        "current_roi": report.get("current_roi", report["roi"]),
        "calibration": report["calibration"],
        "avg_edge": report["avg_edge"],
        "kelly_fraction": report["kelly_fraction"],
        "sharpe_ratio": report["sharpe_ratio"],
        "tier": report["tier"],
        "updated_at": now,
    }
    try:
        sb.table("wallet_scores").upsert(score_row, on_conflict="address").execute()
        print(f"  Scores saved")
    except Exception as e:
        if "current_roi" in str(e):
            score_row.pop("current_roi", None)
            try:
                sb.table("wallet_scores").upsert(score_row, on_conflict="address").execute()
                print(f"  Scores saved (without current_roi)")
            except Exception as e2:
                print(f"  Warning: scores upsert failed: {e2}")
        else:
            print(f"  Warning: scores upsert failed: {e}")

    # 3. Upsert category scores
    for cat, cs in report.get("categories", {}).items():
        cat_row = {
            "address": addr,
            "category": cat,
            "total_bets": cs["total_bets"],
            "win_rate": cs["win_rate"],
            "clv": cs["clv"],
            "roi": cs["roi"],
            "updated_at": now,
        }
        try:
            sb.table("wallet_category_scores").upsert(cat_row, on_conflict="address,category").execute()
        except Exception as e:
            print(f"  Warning: category score upsert ({cat}): {e}")
    print(f"  Category scores saved ({len(report.get('categories', {}))} categories)")

    # 4. Insert bets (cap at 100)
    bet_rows = []
    for b in report.get("bets", [])[:100]:
        bet_rows.append({
            "address": b["address"],
            "market_slug": b.get("market_slug", ""),
            "market_title": b.get("market_title", ""),
            "category": b["category"],
            "outcome": b.get("outcome", "Yes"),
            "side": b["side"],
            "price": b["price"],
            "size": b["size"],
            "amount_usd": b["amount_usd"],
            "timestamp": b.get("timestamp"),
            "resolved": b["resolved"],
            "won": b["won"],
            "closing_price": b["closing_price"],
            "clv": b["clv"],
        })

    if bet_rows:
        batch_size = 50
        saved = 0
        for i in range(0, len(bet_rows), batch_size):
            batch = bet_rows[i:i + batch_size]
            try:
                sb.table("bets").insert(batch).execute()
                saved += len(batch)
            except Exception as e:
                print(f"  Warning: bets batch {i}: {e}")
        print(f"  Bets saved ({saved}/{len(bet_rows)})")

    print(f"\n  Done! View at dashboard or query Supabase.")


# ── CLI entry point ──

def main():
    if len(sys.argv) < 2:
        print("Usage: python wallet_analyzer.py <username_or_address> [--save]")
        print()
        print("Examples:")
        print("  python wallet_analyzer.py kch123")
        print("  python wallet_analyzer.py 0xabc123... --save")
        print()
        print("Flags:")
        print("  --save    Save results to Supabase")
        sys.exit(1)

    identifier = sys.argv[1]
    save = "--save" in sys.argv

    # Resolve address
    print(f"\nResolving '{identifier}'...")
    address, profile = resolve_address(identifier)
    print(f"  Address: {address}")
    if profile.get("username"):
        print(f"  Username: {profile['username']}")

    # Run analysis using shared scoring module
    print(f"\nScoring wallet...")
    report = score_wallet(address, existing_label=profile.get("username"))

    if report:
        print_report(report)
        if save:
            save_to_supabase(report)
        else:
            print(f"\n  Tip: run with --save to store results in Supabase")
    else:
        print("\n  No trades found or insufficient data for this wallet.")


if __name__ == "__main__":
    main()
