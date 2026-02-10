"""Startup wrapper that catches and logs any import/startup errors."""
import os
import sys
import threading
import time
import traceback
import urllib.request


def health_check(port, retries=10, delay=2):
    """Poll health endpoint to verify the app is actually responding."""
    url = f"http://127.0.0.1:{port}/health"
    for i in range(retries):
        time.sleep(delay)
        try:
            resp = urllib.request.urlopen(url, timeout=5)
            body = resp.read().decode()
            print(f"SELF-TEST OK (attempt {i+1}): {resp.status} {body}", flush=True)
            return
        except Exception as e:
            print(f"SELF-TEST attempt {i+1}/{retries}: {e}", flush=True)
    print("SELF-TEST FAILED: App never responded to health check!", flush=True)


def main():
    port = int(os.environ.get("PORT", "8000"))
    print(f"=== SmartFlow Launcher ===", flush=True)
    print(f"PORT={port}", flush=True)
    print(f"Python={sys.version}", flush=True)
    print(f"CWD={os.getcwd()}", flush=True)
    print(f"Contents: {os.listdir('.')}", flush=True)
    print(f"App dir exists: {os.path.isdir('app')}", flush=True)

    # Phase 1: Test imports
    try:
        print("Importing app...", flush=True)
        from app.main import app  # noqa: F401
        print("Import OK", flush=True)
    except Exception:
        print("FATAL: Import failed!", flush=True)
        traceback.print_exc()
        sys.exit(1)

    # Phase 2: Start self-test in background thread
    t = threading.Thread(target=health_check, args=(port,), daemon=True)
    t.start()

    # Phase 3: Start uvicorn (blocks forever)
    try:
        import uvicorn
        print(f"Starting uvicorn on 0.0.0.0:{port}", flush=True)
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
    except Exception:
        print("FATAL: Uvicorn failed!", flush=True)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
