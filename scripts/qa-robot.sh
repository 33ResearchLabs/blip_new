#!/bin/bash
# QA Robot Runner
#
# Starts core-api + settle in TEST_MODE, seeds fixtures,
# runs Playwright tests, and outputs report + screenshots.
#
# Usage:
#   pnpm qa:robot           # run all tests
#   pnpm qa:robot -- --grep "State Matrix"  # run specific test
#
# Requirements:
#   - PostgreSQL running locally
#   - pnpm installed
#   - Playwright browsers installed (npx playwright install chromium)

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Configuration
export TEST_MODE=1
export ALLOW_TEST_ENDPOINTS=1
export NODE_ENV=development
CORE_API_PORT=${CORE_API_PORT:-4010}
SETTLE_PORT=${PORT:-3000}

# Force Next.js to use our exact port (prevents auto-switching)
export PORT=$SETTLE_PORT

CORE_API_PID=""
SETTLE_PID=""

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "[qa:robot] Shutting down services..."

  for pid in $SETTLE_PID $CORE_API_PID; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done

  sleep 1

  for pid in $SETTLE_PID $CORE_API_PID; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done

  echo "[qa:robot] All services stopped."
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
  return 1
}

# Pre-flight: aggressively kill stale processes on our ports
for port in $CORE_API_PORT $SETTLE_PORT; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[qa:robot] Killing stale processes on port $port (PIDs: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
done

# Wait for ports to be fully released
for port in $CORE_API_PORT $SETTLE_PORT; do
  retries=0
  while lsof -ti:"$port" > /dev/null 2>&1 && [ $retries -lt 5 ]; do
    echo "[qa:robot] Waiting for port $port to be released..."
    sleep 1
    retries=$((retries + 1))
  done
done

rm -f "$ROOT_DIR/settle/.next/dev/lock"

echo ""
echo "==========================================="
echo "  QA Robot - Playwright Test Runner"
echo "==========================================="
echo "  Core API:  http://localhost:$CORE_API_PORT"
echo "  Settle:    http://localhost:$SETTLE_PORT"
echo "  TEST_MODE: enabled"
echo "==========================================="
echo ""

# 1. Start Core API
echo "[qa:robot] Starting core-api..."
cd "$ROOT_DIR"
pnpm -C apps/core-api dev > /tmp/bm-qa-core-api.log 2>&1 &
CORE_API_PID=$!

# 2. Start Settle (Next.js dev)
echo "[qa:robot] Starting settle..."
pnpm -C settle dev > /tmp/bm-qa-settle.log 2>&1 &
SETTLE_PID=$!

echo ""
echo "[qa:robot] Waiting for services..."
wait_for_health "http://localhost:$CORE_API_PORT/health" "core-api" 20 || {
  echo "Core API logs:"
  tail -20 /tmp/bm-qa-core-api.log
  exit 1
}
wait_for_health "http://localhost:$SETTLE_PORT/api/health" "settle" 60 || {
  echo "Settle logs:"
  tail -20 /tmp/bm-qa-settle.log
  exit 1
}

# Warm up settle by hitting a test endpoint to trigger Turbopack compilation
echo "[qa:robot] Warming up settle..."
curl -s -X POST "http://localhost:$SETTLE_PORT/api/test/reset" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}' > /dev/null 2>&1 || true
sleep 2

echo ""
echo "[qa:robot] Services ready. Running Playwright tests..."
echo ""

# 3. Clean previous results
rm -rf "$ROOT_DIR/settle/e2e/results"/*.png "$ROOT_DIR/settle/e2e/results/report.json" 2>/dev/null || true
mkdir -p "$ROOT_DIR/settle/e2e/results"

# 4. Run Playwright
cd "$ROOT_DIR/settle"
SETTLE_URL="http://localhost:$SETTLE_PORT" \
CORE_API_URL="http://localhost:$CORE_API_PORT" \
npx playwright test "$@"
TEST_EXIT=$?

echo ""
echo "==========================================="
echo "  QA Robot Results"
echo "==========================================="

if [ $TEST_EXIT -eq 0 ]; then
  echo "  Status: ALL TESTS PASSED"
else
  echo "  Status: SOME TESTS FAILED (exit code: $TEST_EXIT)"
fi

echo "  Report: settle/e2e/results/report.json"
echo "  HTML:   settle/playwright-report/index.html"
echo "  Screenshots: settle/e2e/results/*.png"
echo "==========================================="
echo ""

exit $TEST_EXIT
