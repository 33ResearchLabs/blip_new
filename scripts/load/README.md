# Load Test Script

Tests HTTP throughput, WS broadcast delivery, and outbox drain rate against a running dev-local stack.

## Prerequisites

1. Start the local stack in another terminal:
   ```bash
   bash scripts/dev-local.sh
   ```
2. The script auto-seeds test data via `/api/test/reset` + `/api/test/seed`.

## Usage

```bash
tsx scripts/load/run.ts [--rps 50] [--duration 10] [--ws-clients 5]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--rps` | 50 | Target requests per second |
| `--duration` | 10 | Test duration in seconds |
| `--ws-clients` | 5 | Number of WebSocket clients to connect |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SETTLE_URL` | `http://localhost:3000` | Settle Next.js app URL |
| `CORE_API_URL` | `http://localhost:4010` | Core API URL |
| `CORE_API_SECRET` | (empty) | Shared secret for auth |

## Test Phases

1. **Seed** — Resets and seeds test data (user, merchant, offers)
2. **HTTP throughput** — Creates orders at target RPS, transitions half to accepted. Reports req/sec, p50, p95.
3. **WS broadcast** — Connects WS clients, creates orders, counts broadcast messages received.
4. **Outbox drain** — Polls outbox pending count until 0, measures drain rate.

## Output

```
=== Load Test Results ===
HTTP:   500 reqs, 0 errors, 47.6 rps, p50=42ms, p95=128ms
WS:     6 clients, 120 msgs received
Outbox: 500 rows drained in 12.3s (40.7 rows/sec)
```

Exit code 0 if error rate < 10%, exit code 1 otherwise.
