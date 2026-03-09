"""
Scheduler — runs the WebSocket monitor with periodic wallet refresh.
Designed for Railway / Heroku / any long-running process.

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

# Import the monitor
sys.path.insert(0, str(Path(__file__).parent))
from ws_monitor import load_tracked_wallets, monitor_trades

running = True


def signal_handler(sig, frame):
    global running
    print("\nShutting down...")
    running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


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


def main():
    print("=" * 60)
    print("POLYMARKET SHARP WALLET MONITOR")
    print(f"Started at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("=" * 60)

    # Load initial wallets
    print("\nLoading tracked wallets...")
    wallets = load_tracked_wallets()
    if not wallets:
        print("WARNING: No tracked wallets found. Monitor will start but won't match any trades.")
        print("         Run batch_score.py to populate wallets first.")

    # Start periodic refresh in background
    refresh_thread = threading.Thread(target=periodic_refresh, args=(300,), daemon=True)
    refresh_thread.start()

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
