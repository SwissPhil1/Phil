#!/bin/bash
# Sync polymarket files from Phil to sharpwallet repo
# Usage: bash sync_to_sharpwallet.sh /path/to/sharpwallet

set -e

DEST="${1:-../sharpwallet}"

if [ ! -d "$DEST/.git" ]; then
    echo "ERROR: $DEST is not a git repo. Clone sharpwallet first:"
    echo "  git clone git@github.com:SwissPhil1/sharpwallet.git ../sharpwallet"
    exit 1
fi

echo "Syncing to $DEST..."

# Create directories
mkdir -p "$DEST/scripts" "$DEST/sql"

# Copy dashboard (at root for Vercel)
cp polymarket/dashboard/index.html "$DEST/index.html"

# Copy scripts
cp polymarket/scripts/apply_schema.py "$DEST/scripts/"
cp polymarket/scripts/batch_score.py "$DEST/scripts/"
cp polymarket/scripts/scheduler.py "$DEST/scripts/"
cp polymarket/scripts/seed_data.py "$DEST/scripts/"
cp polymarket/scripts/wallet_analyzer.py "$DEST/scripts/"
cp polymarket/scripts/ws_monitor.py "$DEST/scripts/"

# Copy SQL
cp polymarket/sql/001_schema.sql "$DEST/sql/"

# Copy config files
cp polymarket/requirements.txt "$DEST/requirements.txt"

# Write flat-structure Procfile
cat > "$DEST/Procfile" << 'EOF'
web: python scripts/ws_monitor.py
worker: python scripts/scheduler.py
EOF

# Write railway.json
cat > "$DEST/railway.json" << 'RJSON'
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "python scripts/scheduler.py",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
RJSON

# Write vercel.json
cat > "$DEST/vercel.json" << 'VJSON'
{
  "version": 2,
  "builds": [
    { "src": "index.html", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
VJSON

# Write .gitignore
cat > "$DEST/.gitignore" << 'GI'
.env
__pycache__/
*.pyc
.vercel/
node_modules/
GI

echo ""
echo "Done! Files synced to $DEST"
echo ""
echo "Now run:"
echo "  cd $DEST"
echo "  git add -A"
echo "  git diff --cached --stat"
echo "  git commit -m 'Sync latest from Phil: 26 scored wallets, Telegram alerts, dashboard'"
echo "  git push origin main"
