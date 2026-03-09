#!/bin/bash
# Launch multiple core-api workers on ports 4010-4017
# Primary on 4010 runs WS + background workers, rest are pure HTTP workers

WORKERS=${1:-8}
BASE_PORT=4010
PIDS=()

cleanup() {
  echo -e "\nShutting down $WORKERS workers..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait
  echo "All workers stopped."
}
trap cleanup SIGINT SIGTERM

cd "$(dirname "$0")"

# Primary (port 4010) — runs WS + outbox + corridor workers
CORE_API_PORT=$BASE_PORT npx tsx src/index.ts &
PIDS+=($!)
echo "Primary started on :$BASE_PORT (pid $!)"

# Workers (ports 4011+) — HTTP only
for ((i=1; i<WORKERS; i++)); do
  port=$((BASE_PORT + i))
  CORE_API_PORT=$port WORKER_ID=$i npx tsx src/index.ts &
  PIDS+=($!)
  echo "Worker $i started on :$port (pid $!)"
done

echo -e "\n$WORKERS core-api processes running on ports $BASE_PORT-$((BASE_PORT + WORKERS - 1))"
echo "Press Ctrl+C to stop all"

wait
