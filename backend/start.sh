#!/bin/sh
set -e

PORT="${PORT:-8000}"

echo "=== SmartFlow API Starting ==="
echo "PORT=$PORT"
echo "DATABASE_URL=${DATABASE_URL:-<not set, using SQLite default>}"
echo "Python: $(python --version)"
echo "Working dir: $(pwd)"
echo "==============================="

# Verify the app can be imported before starting
python -c "from app.main import app; print('App module loaded successfully')" || {
    echo "FATAL: Failed to import app module"
    exit 1
}

echo "Starting uvicorn on port $PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
