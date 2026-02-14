#!/bin/bash
set -e

# Test Harness - Self-contained integration/flow testing
# Starts servers, waits for readiness, runs tests, cleans up

# Get absolute paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CORE_API_DIR="$(cd "$SETTLE_DIR/../apps/core-api" && pwd)"

# Default ports
CORE_API_PORT=${CORE_API_PORT:-4010}
SETTLE_PORT=${SETTLE_PORT:-3000}
CORE_API_URL="http://localhost:${CORE_API_PORT}"
SETTLE_URL="https://localhost:${SETTLE_PORT}"

# Allow self-signed HTTPS certs in Node child processes
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Test mode: integration, flow, or both
TEST_MODE=${1:-both}

# PIDs for cleanup
CORE_API_PID=""
SETTLE_PID=""

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up..."

  if [ -n "$CORE_API_PID" ]; then
    echo "  Stopping core-api (PID: $CORE_API_PID)"
    kill -TERM "$CORE_API_PID" 2>/dev/null || true
  fi

  if [ -n "$SETTLE_PID" ]; then
    echo "  Stopping settle (PID: $SETTLE_PID)"
    kill -TERM "$SETTLE_PID" 2>/dev/null || true
  fi

  # Wait briefly for graceful shutdown
  sleep 1

  # Force kill if still running
  if [ -n "$CORE_API_PID" ] && kill -0 "$CORE_API_PID" 2>/dev/null; then
    kill -9 "$CORE_API_PID" 2>/dev/null || true
  fi

  if [ -n "$SETTLE_PID" ] && kill -0 "$SETTLE_PID" 2>/dev/null; then
    kill -9 "$SETTLE_PID" 2>/dev/null || true
  fi

  echo "Cleanup complete"
}

# Register cleanup on exit
trap cleanup EXIT INT TERM

# Wait for endpoint to be ready
# Usage: wait_for_health <url> <service_name> <timeout_seconds> [--insecure]
wait_for_health() {
  local url=$1
  local service=$2
  local timeout=$3
  local insecure=$4
  local curl_flags="-s -f --connect-timeout 2"

  if [ "$insecure" = "--insecure" ]; then
    curl_flags="$curl_flags -k"
  fi

  local elapsed_ms=0
  local interval_ms=500
  local timeout_ms=$((timeout * 1000))
  local last_log_s=0

  echo "Waiting for $service at $url (timeout ${timeout}s)..."

  while [ $elapsed_ms -lt $timeout_ms ]; do
    if curl $curl_flags "$url" > /dev/null 2>&1; then
      local elapsed_s=$((elapsed_ms / 1000))
      echo "$service is ready (${elapsed_s}s)"
      return 0
    fi

    # Log every 5 seconds
    local current_s=$((elapsed_ms / 1000))
    if [ $current_s -ge $((last_log_s + 5)) ] && [ $current_s -gt 0 ]; then
      echo "waiting for $service... (${current_s}s)"
      last_log_s=$current_s
    fi

    sleep 0.5
    elapsed_ms=$((elapsed_ms + interval_ms))
  done

  echo "$service failed to start within ${timeout}s"
  echo "Last 20 lines of log:"
  if [ "$service" = "core-api" ]; then
    tail -20 /tmp/core-api-test.log 2>/dev/null || true
  else
    tail -20 /tmp/settle-test.log 2>/dev/null || true
  fi
  return 1
}

echo ""
echo "========================================="
echo "  Test Harness - Mode: $TEST_MODE"
echo "========================================="
echo "  Core API: $CORE_API_URL"
echo "  Settle:   $SETTLE_URL"
echo "========================================="
echo ""

# Step 1: Start core-api
echo "Starting core-api..."
cd "$CORE_API_DIR"
CORE_API_PORT=$CORE_API_PORT pnpm start > /tmp/core-api-test.log 2>&1 &
CORE_API_PID=$!
echo "  PID: $CORE_API_PID"

# Step 2: Start settle (Next.js, production mode to avoid dev lock conflicts)
echo "Starting settle..."
cd "$SETTLE_DIR"
NODE_ENV=production ALLOW_TEST_ENDPOINTS=1 PORT=$SETTLE_PORT pnpm start > /tmp/settle-test.log 2>&1 &
SETTLE_PID=$!
echo "  PID: $SETTLE_PID"

# Step 3: Wait for readiness (core-api 30s, settle 120s)
wait_for_health "${CORE_API_URL}/health" "core-api" 30 || exit 1
wait_for_health "${SETTLE_URL}/api/health" "settle" 120 --insecure || exit 1

echo ""
echo "Both servers ready"
echo ""

# Step 4: Run tests
EXIT_CODE=0

if [ "$TEST_MODE" = "integration" ] || [ "$TEST_MODE" = "both" ]; then
  echo "Running integration tests..."
  cd "$SETTLE_DIR"
  CORE_API_URL=$CORE_API_URL SETTLE_URL=$SETTLE_URL pnpm test:integration || EXIT_CODE=$?
  echo ""
fi

if [ "$TEST_MODE" = "flow" ] || [ "$TEST_MODE" = "both" ]; then
  echo "Running flow tests..."
  cd "$SETTLE_DIR"
  SETTLE_URL=$SETTLE_URL CORE_API_URL=$CORE_API_URL pnpm test:flow || EXIT_CODE=$?
  echo ""
fi

# Cleanup happens automatically via trap
exit $EXIT_CODE
