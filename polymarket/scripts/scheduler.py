"""
Scheduler — runs the WebSocket monitor, rescore job processor,
and periodic auto-rescore. Designed for Railway / any long-running process.

Usage:
    python scheduler.py
"""
import os
import sys
import time
import threading
import signal
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# Verify required env vars
required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"ERROR: Missing environment variables: {', '.join(missing)}")
    sys.exit(1)

# Import modules
sys.path.insert(0, str(Path(__file__).parent))
from ws_monitor import load_tracked_wallets, monitor_trades
from scoring import score_wallet, save_scores_to_supabase

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

running = True


def signal_handler(sig, frame):
    global running
    print("\nShutting down...")
    running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ── Supabase REST helpers ──

import requests

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}


def sb_query(table, params=""):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=10,
    )
    return r.json() if r.ok else []


def sb_update(table, match_params, data):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?{match_params}",
        headers=SB_HEADERS,
        json=data,
        timeout=10,
    )
    return r.ok


def sb_delete(table, params):
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        timeout=10,
    )
    return r.ok


# ── Job processor ──

def process_one_job(job):
    """Process a single rescore job."""
    job_id = job["id"]
    job_type = job.get("job_type", "full")
    now = datetime.now(timezone.utc).isoformat()

    print(f"  Processing job {job_id} (type={job_type})")

    # Mark as running
    sb_update("rescore_jobs", f"id=eq.{job_id}", {"status": "running", "updated_at": now})

    try:
        if job_type == "single":
            address = job.get("address", "")
            if not address:
                sb_update("rescore_jobs", f"id=eq.{job_id}",
                          {"status": "failed", "error": "No address", "updated_at": now})
                return
            sb_update("rescore_jobs", f"id=eq.{job_id}", {"total": 1, "updated_at": now})
            result = score_wallet(address)
            if result:
                save_scores_to_supabase(result, SUPABASE_URL, SUPABASE_KEY)
                sb_update("rescore_jobs", f"id=eq.{job_id}",
                          {"status": "completed", "progress": 1, "updated_at": now})
                print(f"    {address[:12]}... -> {result['tier']}")
            else:
                sb_update("rescore_jobs", f"id=eq.{job_id}",
                          {"status": "completed", "progress": 0, "error": "Insufficient data", "updated_at": now})

        elif job_type in ("full", "stale"):
            # Get wallet list
            if job_type == "stale":
                # Only wallets not updated in the last 6 hours
                wallets = sb_query("wallet_scores",
                                   "select=address&updated_at=lt." + _hours_ago(6) + "&limit=500")
            else:
                wallets = sb_query("wallets", "select=address,label&order=created_at.desc&limit=500")

            total = len(wallets)
            sb_update("rescore_jobs", f"id=eq.{job_id}", {"total": total, "updated_at": now})

            if not total:
                sb_update("rescore_jobs", f"id=eq.{job_id}",
                          {"status": "completed", "progress": 0, "updated_at": now})
                return

            scored = 0
            for i, w in enumerate(wallets):
                if not running:
                    sb_update("rescore_jobs", f"id=eq.{job_id}",
                              {"status": "failed", "error": "Shutdown", "progress": scored, "updated_at": now})
                    return

                address = w.get("address", "")
                label = w.get("label")
                try:
                    result = score_wallet(address, existing_label=label)
                    if result:
                        save_scores_to_supabase(result, SUPABASE_URL, SUPABASE_KEY)
                        scored += 1
                        print(f"    [{scored}/{total}] {address[:12]}... -> {result['tier']}")
                except Exception as e:
                    print(f"    [{i+1}/{total}] {address[:12]}... error: {e}")

                # Update progress every 5 wallets
                if (i + 1) % 5 == 0 or i == total - 1:
                    sb_update("rescore_jobs", f"id=eq.{job_id}",
                              {"progress": scored, "updated_at": datetime.now(timezone.utc).isoformat()})

                # Rate limit: ~1 wallet/second
                time.sleep(1.0)

            sb_update("rescore_jobs", f"id=eq.{job_id}",
                      {"status": "completed", "progress": scored, "updated_at": datetime.now(timezone.utc).isoformat()})
            print(f"  Job {job_id} complete: {scored}/{total} scored")

    except Exception as e:
        print(f"  Job {job_id} failed: {e}")
        sb_update("rescore_jobs", f"id=eq.{job_id}",
                  {"status": "failed", "error": str(e)[:200], "updated_at": now})


def _hours_ago(hours):
    """Return ISO timestamp for N hours ago."""
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def process_rescore_jobs(interval=30):
    """Poll for pending rescore jobs and process them."""
    print("[Job Processor] Started")
    while running:
        try:
            jobs = sb_query("rescore_jobs", "status=eq.pending&order=created_at.asc&limit=1")
            if jobs:
                process_one_job(jobs[0])

            # Clean up completed jobs older than 24h
            sb_delete("rescore_jobs",
                       f"status=in.(completed,failed)&created_at=lt.{_hours_ago(24)}")

        except Exception as e:
            print(f"[Job Processor] Error: {e}")

        # Sleep in 1s increments so we can respond to shutdown
        for _ in range(interval):
            if not running:
                break
            time.sleep(1)


def scheduled_rescore(interval=14400):
    """Every 4 hours, create a 'stale' rescore job for wallets not updated recently."""
    print("[Auto-Rescore] Started (every 4h)")
    # Wait 5 minutes before first auto-rescore to let system stabilize
    for _ in range(300):
        if not running:
            return
        time.sleep(1)

    while running:
        try:
            print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Creating scheduled stale-wallet rescore job...")
            import requests as req
            r = req.post(
                f"{SUPABASE_URL}/rest/v1/rescore_jobs",
                headers={**SB_HEADERS, "Prefer": "return=representation"},
                json={"job_type": "stale", "status": "pending"},
                timeout=10,
            )
            if r.ok:
                print("  Stale rescore job created")
            else:
                print(f"  Failed to create job: {r.status_code}")
        except Exception as e:
            print(f"  Auto-rescore error: {e}")

        for _ in range(interval):
            if not running:
                break
            time.sleep(1)


# ── Periodic wallet list refresh ──

def periodic_refresh(interval=300):
    """Refresh the tracked wallet list every N seconds."""
    while running:
        try:
            print(f"\n[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Refreshing wallet watchlist...")
            load_tracked_wallets()
        except Exception as e:
            print(f"  Refresh error: {e}")
        for _ in range(interval):
            if not running:
                break
            time.sleep(1)


# ── Main ──

def main():
    print("=" * 60)
    print("POLYMARKET SHARP WALLET MONITOR + JOB PROCESSOR")
    print(f"Started at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("=" * 60)

    # Load initial wallets
    print("\nLoading tracked wallets...")
    wallets = load_tracked_wallets()
    if not wallets:
        print("WARNING: No tracked wallets found. Run batch_score.py first.")

    # Start background threads
    threads = [
        threading.Thread(target=periodic_refresh, args=(300,), daemon=True, name="refresh"),
        threading.Thread(target=process_rescore_jobs, args=(30,), daemon=True, name="jobs"),
        threading.Thread(target=scheduled_rescore, args=(14400,), daemon=True, name="auto-rescore"),
    ]
    for t in threads:
        t.start()
        print(f"  Started thread: {t.name}")

    # Run the WebSocket monitor (blocking)
    print("\nStarting WebSocket trade monitor...")
    import asyncio
    try:
        asyncio.run(monitor_trades())
    except KeyboardInterrupt:
        print("\nMonitor stopped.")
    except Exception as e:
        print(f"\nMonitor error: {e}")
        print("Restarting in 10 seconds...")
        time.sleep(10)
        main()  # Auto-restart


if __name__ == "__main__":
    main()
