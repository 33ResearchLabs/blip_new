#!/bin/bash
# ===========================================
#  Blip Money - Start All Services
# ===========================================
# Starts: Core API, Workers, Settle (Next.js), BlipScan, Telegram Bot
# Usage:  ./start-all.sh [--skip-bot] [--skip-install]

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --------------- Config ---------------
CORE_API_PORT=${CORE_API_PORT:-4010}
SETTLE_PORT=${PORT:-3000}
BLIPSCAN_PORT=${BLIPSCAN_PORT:-3001}

export OUTBOX_BATCH_SIZE=${OUTBOX_BATCH_SIZE:-50}
export OUTBOX_POLL_MS=${OUTBOX_POLL_MS:-5000}
export EXPIRY_BATCH_SIZE=${EXPIRY_BATCH_SIZE:-20}
export EXPIRY_POLL_MS=${EXPIRY_POLL_MS:-10000}

SKIP_BOT=false
SKIP_INSTALL=false

for arg in "$@"; do
  case $arg in
    --skip-bot) SKIP_BOT=true ;;
    --skip-install) SKIP_INSTALL=true ;;
  esac
done

# --------------- PIDs ---------------
CORE_API_PID=""
WORKER_PID=""
SETTLE_PID=""
BLIPSCAN_WEB_PID=""
BLIPSCAN_INDEXER_PID=""
BOT_PID=""

# --------------- Cleanup ---------------
CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "Shutting down all services..."

  for pid in $SETTLE_PID $WORKER_PID $CORE_API_PID $BLIPSCAN_WEB_PID $BLIPSCAN_INDEXER_PID $BOT_PID; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done

  sleep 1

  for pid in $SETTLE_PID $WORKER_PID $CORE_API_PID $BLIPSCAN_WEB_PID $BLIPSCAN_INDEXER_PID $BOT_PID; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done

  rm -f /tmp/bm-worker-outbox.json /tmp/bm-worker-expiry.json
  echo "All services stopped."
}

trap cleanup EXIT INT TERM

# --------------- Helpers ---------------
wait_for_health() {
  local url=$1
  local name=$2
  local timeout=$3
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    if curl -s -f --connect-timeout 2 "$url" > /dev/null 2>&1; then
      echo "  [OK] $name ready (${elapsed}s)"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "  [FAIL] $name failed to start within ${timeout}s"
  echo "         Check logs below for details"
  return 1
}

# --------------- Pre-flight ---------------
echo ""
echo "==========================================="
echo "  Blip Money - Starting All Services"
echo "==========================================="
echo ""

# Kill stale processes on our ports
for port in $CORE_API_PORT $SETTLE_PORT $BLIPSCAN_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Killing stale process on port $port (PID $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi
done

# Remove Next.js dev lock
rm -f "$ROOT_DIR/settle/.next/dev/lock"

# --------------- Install deps ---------------
if [ "$SKIP_INSTALL" = false ]; then
  echo "Installing dependencies..."
  cd "$ROOT_DIR"
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  echo ""
fi

# --------------- Start Services ---------------

# 1. Core API (Fastify + WebSocket)
echo "Starting Core API..."
cd "$ROOT_DIR"
pnpm -C apps/core-api dev > /tmp/bm-core-api.log 2>&1 &
CORE_API_PID=$!

# 2. Workers (outbox + expiry)
echo "Starting Workers..."
pnpm -C apps/core-api workers > /tmp/bm-workers.log 2>&1 &
WORKER_PID=$!

# 3. Settle (Next.js frontend)
echo "Starting Settle (Next.js)..."
pnpm -C settle dev > /tmp/bm-settle.log 2>&1 &
SETTLE_PID=$!

# 4. BlipScan Web (Next.js explorer)
echo "Starting BlipScan Web..."
cd "$ROOT_DIR"
pnpm -C blipscan/web dev > /tmp/bm-blipscan-web.log 2>&1 &
BLIPSCAN_WEB_PID=$!

# 5. BlipScan Indexer (Solana transaction indexer)
echo "Starting BlipScan Indexer..."
cd "$ROOT_DIR/blipscan/indexer"
npx ts-node src/index.ts > /tmp/bm-blipscan-indexer.log 2>&1 &
BLIPSCAN_INDEXER_PID=$!
cd "$ROOT_DIR"

# 6. Telegram Bot (optional)
if [ "$SKIP_BOT" = false ] && [ -f "$ROOT_DIR/telegram-bot/bot.js" ]; then
  echo "Starting Telegram Bot..."
  cd "$ROOT_DIR/telegram-bot"
  node bot.js > /tmp/bm-telegram-bot.log 2>&1 &
  BOT_PID=$!
fi

# --------------- Health Checks ---------------
echo ""
echo "Waiting for services to be ready..."
wait_for_health "http://localhost:$CORE_API_PORT/health" "Core API" 15 || true
wait_for_health "http://localhost:$SETTLE_PORT/api/health" "Settle" 120 || true
wait_for_health "http://localhost:$BLIPSCAN_PORT/api/stats" "BlipScan" 30 || true

echo ""
echo "==========================================="
echo "  All Services Started!"
echo "==========================================="
echo ""
echo "  URLs:"
echo "    App:          http://localhost:$SETTLE_PORT"
echo "    Merchant:     http://localhost:$SETTLE_PORT/merchant"
echo "    Compliance:   http://localhost:$SETTLE_PORT/compliance"
echo "    Core API:     http://localhost:$CORE_API_PORT"
echo "    WebSocket:    ws://localhost:$CORE_API_PORT/ws/orders"
echo "    BlipScan:     http://localhost:$BLIPSCAN_PORT"
echo ""
echo "  PIDs:"
echo "    Core API:     $CORE_API_PID"
echo "    Workers:      $WORKER_PID"
echo "    Settle:       $SETTLE_PID"
echo "    BlipScan Web: $BLIPSCAN_WEB_PID"
echo "    BlipScan Idx: $BLIPSCAN_INDEXER_PID"
[ -n "$BOT_PID" ] && echo "    Telegram Bot: $BOT_PID"
echo ""
echo "  Logs:"
echo "    tail -f /tmp/bm-core-api.log"
echo "    tail -f /tmp/bm-workers.log"
echo "    tail -f /tmp/bm-settle.log"
echo "    tail -f /tmp/bm-blipscan-web.log"
echo "    tail -f /tmp/bm-blipscan-indexer.log"
[ -n "$BOT_PID" ] && echo "    tail -f /tmp/bm-telegram-bot.log"
echo ""
echo "  Debug:"
echo "    curl http://localhost:$CORE_API_PORT/debug/ws"
echo "    curl http://localhost:$CORE_API_PORT/debug/workers"
echo "    curl http://localhost:$CORE_API_PORT/debug/outbox"
echo ""
echo "  Press Ctrl+C to stop all services"
echo ""
echo "==========================================="

# Keep script alive until a child exits
wait
