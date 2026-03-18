#!/bin/bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════
# Blip Money — Deploy Script
# ══════════════════════════════════════════════════════════════
# Usage:
#   ./scripts/deploy.sh           # Full deploy (pull + build + migrate + restart)
#   ./scripts/deploy.sh --skip-db # Skip database migrations
#   ./scripts/deploy.sh --build   # Build only, no restart
# ══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

SKIP_DB=false
BUILD_ONLY=false

for arg in "$@"; do
  case $arg in
    --skip-db) SKIP_DB=true ;;
    --build) BUILD_ONLY=true ;;
  esac
done

echo "═══════════════════════════════════════"
echo "  Blip Money — Deploy"
echo "═══════════════════════════════════════"
echo ""

# ── 1. Pull latest code ──
echo "→ Pulling latest code..."
git pull origin main

# ── 2. Install dependencies ──
echo "→ Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── 3. Run database migrations ──
if [ "$SKIP_DB" = false ]; then
  echo "→ Running database migrations..."

  # Source env vars for DB connection
  if [ -f settle/.env.local ]; then
    export $(grep -E '^DB_(HOST|PORT|NAME|USER|PASSWORD)=' settle/.env.local | xargs)
  fi

  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-settle}"
  DB_USER="${DB_USER:-zeus}"

  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW());" 2>/dev/null

  for migration in settle/database/migrations/*.sql; do
    name=$(basename "$migration")
    already=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -tAc "SELECT 1 FROM _migrations WHERE name='$name'" 2>/dev/null || echo "")
    if [ "$already" != "1" ]; then
      echo "  Applying: $name"
      PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration" -q
      PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "INSERT INTO _migrations (name) VALUES ('$name') ON CONFLICT DO NOTHING;" -q
    fi
  done

  # Also apply root migrations/ folder
  for migration in migrations/*.sql; do
    [ -f "$migration" ] || continue
    name=$(basename "$migration")
    already=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -tAc "SELECT 1 FROM _migrations WHERE name='$name'" 2>/dev/null || echo "")
    if [ "$already" != "1" ]; then
      echo "  Applying: $name"
      PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration" -q
      PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "INSERT INTO _migrations (name) VALUES ('$name') ON CONFLICT DO NOTHING;" -q
    fi
  done

  echo "  ✓ Migrations complete"
else
  echo "→ Skipping database migrations (--skip-db)"
fi

# ── 4. Build Next.js ──
echo "→ Building settle (Next.js)..."
cd settle
pnpm build
cd "$ROOT_DIR"

# ── 5. Type-check core-api ──
echo "→ Type-checking core-api..."
cd apps/core-api
npx tsc --noEmit
cd "$ROOT_DIR"

if [ "$BUILD_ONLY" = true ]; then
  echo ""
  echo "✓ Build complete (--build mode, no restart)"
  exit 0
fi

# ── 6. Restart services ──
echo "→ Restarting services with PM2..."
mkdir -p logs

if pm2 list 2>/dev/null | grep -q "settle\|core-api"; then
  pm2 restart ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi

pm2 save

echo ""
echo "═══════════════════════════════════════"
echo "  ✓ Deploy complete"
echo "═══════════════════════════════════════"
echo ""
echo "  settle:   http://localhost:3000"
echo "  core-api: http://localhost:4010"
echo ""
echo "  pm2 logs     — view logs"
echo "  pm2 monit    — monitor"
echo "  pm2 status   — check status"
