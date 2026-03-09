# CI: Nightly Launch Simulation

The **Nightly Launch Simulation** workflow (`nightly-launch-sim.yml`) drives the full
order lifecycle end-to-end against a live core-api + real Postgres, then uploads a
JSON report as a CI artifact.

## Workflow

| Property | Value |
|---|---|
| File | `.github/workflows/nightly-launch-sim.yml` |
| Trigger | `cron: 0 2 * * *` (02:00 UTC) + `workflow_dispatch` |
| Timeout | 30 minutes |
| Artifact | `launch-sim-report-<run_number>` (retained 30 days) |

### Manual trigger

Via GitHub UI: **Actions → Nightly Launch Simulation → Run workflow**

Optional inputs:

| Input | Default | Description |
|---|---|---|
| `orders` | `200` | Number of orders to simulate |
| `seed` | `1337` | RNG seed (same seed = same path distribution) |
| `concurrency` | `10` | Max parallel orders |

Via CLI (requires `gh` CLI):

```bash
gh workflow run nightly-launch-sim.yml \
  -f orders=50 \
  -f seed=42 \
  -f concurrency=5
```

## Required secrets

Set these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `CORE_API_SECRET` | Shared secret for `x-core-api-secret` header + HMAC actor signing |

The DB connection uses the Postgres service container; no DB secret is needed.

## Environment variables (set by workflow)

| Variable | Value in CI | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://blip:blip@localhost:5432/blip` | Used by settlement-core pool + migrate script |
| `NEXT_PUBLIC_MOCK_MODE` | `true` | Skips real blockchain calls in stored procedures |
| `CORE_API_SECRET` | `ci_secret_only` (hardcoded) | Auth for every HTTP request + HMAC signing |
| `NEXT_PUBLIC_MOCK_MODE` | `true` | Skips blockchain verification in stored procs |
| `NODE_ENV` | `test` | Prevents dotenv loading `settle/.env.local` |

## Running locally (identical to CI)

```bash
# 1. Start a fresh Postgres instance (or use the existing local one)
#    If using local DB, skip the DATABASE_URL export below.

# 2. Apply schema + migrations
DATABASE_URL=postgresql://zeus@localhost:5432/settle_test \
  pnpm --filter @bm/core-api db:migrate:ci

# 3. Start core-api with mock mode + same secret
CORE_API_SECRET=local-secret \
NEXT_PUBLIC_MOCK_MODE=true \
DATABASE_URL=postgresql://zeus@localhost:5432/settle_test \
NODE_ENV=test \
  pnpm --filter @bm/core-api start &

# Wait for it to be ready
curl -sf http://localhost:4010/health

# 4. Run the simulation
CORE_API_SECRET=local-secret \
DATABASE_URL=postgresql://zeus@localhost:5432/settle_test \
  pnpm --filter @bm/core-api sim:launch \
    --orders 50 --seed 1337 --retryRate 0.2 --noCleanup

# Report written to apps/core-api/reports/launchSim_<ts>.json
```

Or from the `apps/core-api/` directory directly:

```bash
cd apps/core-api
CORE_API_SECRET=local-secret tsx scripts/launchSim.ts \
  --orders 50 --seed 1337 --retryRate 0.2
```

## What the simulation tests

Each order follows one of four paths, chosen by seeded RNG:

| Path | Lifecycle |
|---|---|
| `completed` | create → accept → escrow → payment_sent → payment_confirmed → release |
| `cancelled_pre_escrow` | create → cancel |
| `cancelled_post_escrow` | create → accept → escrow → cancel (triggers `atomicCancelWithRefund`) |
| `disputed` | create → accept → escrow → payment_sent → dispute |

On top of that, the harness injects:
- **Retries** (~20% of steps): same `Idempotency-Key` replayed once
- **Collisions** (~5% of creates): two concurrent identical requests via `Promise.all`

## DB invariants checked at end of run

| Invariant | Expected |
|---|---|
| Duplicate `ledger_entries.idempotency_key` | 0 |
| `order_events` with NULL `request_id` | 0 |
| Orphan ledger entries | 0 |
| Merchants with negative balance | 0 |

The workflow exits with code 1 and marks the run as failed if any invariant is violated.

## Artifacts

- **`launch-sim-report-<N>.json`** — full report with per-order steps, debug snapshots, and DB validation summary (always uploaded, 30-day retention)
- **`core-api-log-<N>`** — raw server stdout/stderr (uploaded only on failure, 7-day retention)

## Updating migrations in CI

Migrations in `settle/database/migrations/*.sql` are applied in sorted filename order
by `apps/core-api/scripts/migrate-ci.sh`. When a new migration file is added, CI picks
it up automatically on the next run — no workflow changes needed.
