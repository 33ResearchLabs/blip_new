#!/bin/bash
# Dev Local Orchestrator
# Starts core-api (HTTP+WS), workers, and settle (Next.js dev)
# One command: everything runs, health-checked, logs tailed.
#
# Usage: ./scripts/dev-local.sh

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CORE_API_PORT=${CORE_API_PORT:-4010}
SETTLE_PORT=${PORT:-3000}

# Worker tuning (passed through to core-api workers)
export OUTBOX_BATCH_SIZE=${OUTBOX_BATCH_SIZE:-50}
export OUTBOX_POLL_MS=${OUTBOX_POLL_MS:-5000}
export EXPIRY_BATCH_SIZE=${EXPIRY_BATCH_SIZE:-20}
export EXPIRY_POLL_MS=${EXPIRY_POLL_MS:-10000}

CORE_API_PID=""
WORKER_PID=""
SETTLE_PID=""

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "Shutting down..."

  for pid in $SETTLE_PID $WORKER_PID $CORE_API_PID; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done

  sleep 1

  for pid in $SETTLE_PID $WORKER_PID $CORE_API_PID; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done

  rm -f /tmp/bm-worker-outbox.json /tmp/bm-worker-expiry.json
  echo "All services stopped."
}

trap cleanup EXIT INT TERM

wait_for_health() {
  local url=$1
  local name=$2
  local timeout=$3
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    if curl -s -f --connect-timeout 2 "$url" > /dev/null 2>&1; then
      echo "  + $name ready (${elapsed}s)"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "  x $name failed to start within ${timeout}s"
  echo "    Check /tmp/bm-*.log for details"
  return 1
}

# Pre-flight: kill stale processes on our ports + remove Next.js lock
for port in $CORE_API_PORT $SETTLE_PORT; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Killing stale process on port $port (PID $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi
done
rm -f "$ROOT_DIR/settle/.next/dev/lock"

echo ""
echo "==========================================="
echo "  Blip Money - Local Dev"
echo "==========================================="
echo "  Core API:  http://localhost:$CORE_API_PORT"
echo "  Settle:    http://localhost:$SETTLE_PORT"
echo "  WS:        ws://localhost:$CORE_API_PORT/ws/orders"
echo "==========================================="
echo ""

# 1. Core API (Fastify + WS)
echo "Starting core-api..."
cd "$ROOT_DIR"
pnpm -C apps/core-api dev > /tmp/bm-core-api.log 2>&1 &
CORE_API_PID=$!

# 2. Workers (outbox + expiry)
echo "Starting workers..."
pnpm -C apps/core-api workers > /tmp/bm-workers.log 2>&1 &
WORKER_PID=$!

# 3. Settle (Next.js dev)
echo "Starting settle..."
pnpm -C settle dev > /tmp/bm-settle.log 2>&1 &
SETTLE_PID=$!

echo ""
echo "Waiting for services..."
wait_for_health "http://localhost:$CORE_API_PORT/health" "core-api" 15 || exit 1
wait_for_health "http://localhost:$SETTLE_PORT/api/health" "settle" 60 || exit 1

echo ""
echo "=========== READY ==========="
echo ""
echo "Logs:"
echo "  tail -f /tmp/bm-core-api.log"
echo "  tail -f /tmp/bm-workers.log"
echo "  tail -f /tmp/bm-settle.log"
echo ""
echo "Debug:"
echo "  curl http://localhost:$CORE_API_PORT/debug/ws"
echo "  curl http://localhost:$CORE_API_PORT/debug/workers"
echo "  curl http://localhost:$CORE_API_PORT/debug/outbox"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for any child to exit (keeps script alive)
wait
