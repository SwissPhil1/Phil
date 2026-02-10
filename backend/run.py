"""Startup wrapper that catches and logs any import/startup errors."""
import os
import sys
import traceback


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

    # Phase 2: Start uvicorn
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
