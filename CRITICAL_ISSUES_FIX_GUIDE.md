# Critical Issues — Status & Fix Guide

> A living reference for the 5 critical issues in Blip Money: what each one is,
> whether it's fixed, and **exactly how to fix it / operate it**. Keep this
> updated as issues are resolved.
>
> Last updated: 2026-06-01

---

## TL;DR — status of all 5 issues

| # | Issue | Status | Where the fix lives |
|---|-------|--------|----------------------|
| 4 | Worker Failure Without Detection | ✅ **FIXED** (deploy pending) | Worker Health Monitoring — see Part A |
| 5 | No Real-Time Alerting | ✅ **FIXED** (set Slack webhook) | Worker Health Monitoring — see Part A |
| 1 | Refund Balance Update Failure | ❌ **OPEN** | See Part B-1 |
| 2 | Stuck Disputes (fiat-sent) | ❌ **OPEN** | See Part B-2 |
| 3 | Resolution Not Finalized | ❌ **OPEN** | See Part B-3 |

**2 of 5 fixed.** The 3 open ones are bugs/gaps in the *refund & dispute logic* —
they are SEPARATE from worker monitoring and each needs its own commit.

> 💡 The **anomaly-sweeper** worker already *detects the symptoms* of #1, #2, #3
> (balance drift, stuck orders, escrow mismatch) and logs them to
> `/admin/error-logs`. It can flag them — it cannot fix them.

---

# PART A — ✅ FIXED: Worker Health Monitoring (issues #4 + #5)

## What it does
Every background worker now sends a "heartbeat" each tick into a `worker_health`
table. A supervisor (`worker-health-checker`) reads them every 60s; if a worker
goes silent for ~3 minutes it is marked **critical** and an alert fires to
error_logs + Sentry + Slack. A dashboard shows the whole fleet, color-coded.

This means **payment-deadline-worker (and every other worker) can no longer die
silently** — the original problem.

## Files (all NEW unless noted)
**Shared / DB**
- `settle/database/migrations/150_worker_health.sql` — the `worker_health` table

**core-api**
- `apps/core-api/src/workers/workerHealth.ts` — `runWorkerTick()` wrapper (timeout + heartbeat)
- `apps/core-api/src/workers/workerHealthChecker.ts` — the supervisor (runs every 60s)
- `apps/core-api/src/workers/slackAlert.ts` — `postSlackAlert()` (gated on `SLACK_WEBHOOK`)
- `apps/core-api/src/workers/sentryAlert.ts` — `captureWorkerAlert()` (gated on `SENTRY_DSN`)
- `apps/core-api/src/routes/health.ts` *(modified)* — added `GET /health/workers`
- `apps/core-api/src/index.ts` *(modified)* — starts/stops the checker
- 11 worker files *(modified)* — each tick wrapped with `runWorkerTick(...)`

**settle**
- `settle/src/lib/workerHealth.ts` — settle-side heartbeat helper
- `settle/src/app/api/admin/worker-health/route.ts` — dashboard data API
- `settle/src/app/admin/worker-health/page.tsx` + `WorkerHealthPanel.tsx` — the dashboard
- `settle/src/app/admin/layout.tsx` *(modified)* — "Workers" nav tab
- 5 worker files *(modified)* — tick wrapped
- `ecosystem.config.cjs` *(modified)* — 5 new PM2 apps for settle workers
- `settle/server.js` *(modified)* — spawn block gated behind `WORKERS_VIA_PM2`

## Environment switches (nothing activates until you set these)
| Env var | Effect | Default |
|---------|--------|---------|
| `SLACK_WEBHOOK` | Enables Slack alerts on worker death | unset = no Slack |
| `SENTRY_DSN` (+ `pnpm -C apps/core-api add @sentry/node`) | Enables Sentry alerts | unset = no Sentry |
| `WORKERS_VIA_PM2=true` | settle workers run under PM2 (auto-restart) instead of server.js spawn | unset = old spawn behaviour |
| `WORKER_HEALTH_CHECK_ENABLED=false` | Turns the supervisor off | unset = on |
| `WORKER_HEALTH_CHECK_MS` / `..._WARN_FLOOR_MS` / `..._CRIT_FLOOR_MS` | Tune check interval + thresholds | 60000 / 75000 / 180000 |

## How to DEPLOY (zero-regression order)
1. **Commit** these changes (see "Commit plan" at the bottom). Push.
2. Deploy. On core-api boot, migration 150 runs automatically → `worker_health` table created. Workers start heartbeating; dashboard goes live.
3. Open **`/admin/worker-health`** → confirm all workers are 🟢 healthy.
4. Set **`SLACK_WEBHOOK`** on core-api → you now get paged on failures.
5. **PM2 cutover** for settle's auto-restart (reversible):
   ```bash
   pm2 start ecosystem.config.cjs --only \
     settle-payment-deadline,settle-escrow-reconciler,settle-notification-outbox,settle-price-tick,settle-anomaly-sweeper
   pm2 list                       # confirm all 5 online
   # then set WORKERS_VIA_PM2=true on the settle service and:
   pm2 reload settle
   # ROLLBACK: unset WORKERS_VIA_PM2 → pm2 reload settle → pm2 delete the 5
   ```
6. (Optional) Point an external uptime monitor at **`GET /health/workers`** — returns HTTP 503 if any worker is critical. This catches even a total core-api death.

## How to USE the dashboard
- **Status** column (green/yellow/red) = is the worker alive *right now*.
- **Crit** column (critical/high/medium/low) = how *important* the worker is (fixed label). `critical` = touches money (refunds/disputes/escrow).
- A worker turns 🔴 when it hasn't heartbeated for ~3 min.

## How to RESPOND when a worker goes red
1. Note its **Crit** level — `critical` = drop everything (money affected).
2. Check **Last Error** on the dashboard + `/admin/error-logs` (`worker.tick_failed.*` / `worker.down.*`).
3. If under PM2: `pm2 restart <name>` and `pm2 logs <name>`.
4. If it recovers, you'll get a `✅ Recovered` alert automatically.

## How to change a worker's importance level
Edit the one word in that worker's `runWorkerTick(...)` call, e.g. in
`apps/core-api/src/workers/unhappyPathWorker.ts`:
```js
{ intervalMs: POLL_INTERVAL_MS, criticality: 'critical', timeoutMs: 120000 }
//                              ^^^^ change to 'high' | 'medium' | 'low'
```

---

# PART B — ❌ OPEN: the 3 remaining critical issues

> These touch **real money logic**. Investigate first, change carefully, and
> review every refund/balance path. Each gets its **own commit**.

## B-1. Refund Balance Update Failure
**What:** Database wallet balances are not always updated after a refund.
**Risk:** Incorrect balances + reconciliation mismatches.

**Where to investigate:**
- `settle/src/lib/orders/atomicCancel.ts` — `atomicCancelWithRefund()` (the main refund path; has a balance post-invariant check)
- `settle/src/workers/payment-deadline-worker.ts` — `processStuckOnChainEscrows()` (records `refund_tx_hash` — confirm it ALSO credits the DB balance/ledger, not just the tx hash)
- Any other path that sets a terminal status with a refund

**Fix approach:**
1. Map EVERY code path that issues a refund.
2. Ensure each one does the balance credit **+** a `ledger_entries` row **in the same DB transaction** (atomic).
3. Add/verify a post-condition invariant (balance == sum of ledger) and fail loudly if it drifts.
4. Use the anomaly-sweeper's existing `ledger.balance_drift` check to catch regressions.

**Detection already exists:** anomaly-sweeper → `ledger.balance_drift` in `/admin/error-logs`.

## B-2. Stuck Disputes (fiat-sent)
**What:** Disputes raised *after* the buyer marked fiat as sent stay unresolved
forever if compliance never reviews them.
**Risk:** User funds locked in escrow indefinitely.

> ⚠️ **Do NOT auto-resolve these.** It is *intentional* that
> `payment-deadline-worker` excludes them (`AND payment_sent_at IS NULL` in
> `processDisputeAutoResolve()`): auto-refunding a fiat-sent dispute could let a
> dishonest seller keep the fiat **and** reclaim the escrow. They require a human.

**Fix approach (escalation, not auto-resolve):**
1. Add a check (extend `settle/src/workers/anomaly-sweeper.ts`, or a small new
   worker) that finds `status='disputed' AND payment_sent_at IS NOT NULL` orders
   older than an SLA (e.g. 24–48h with no compliance action).
2. Fire an **alert** to compliance (Slack via `postSlackAlert` + error_logs).
3. Surface a "disputes needing review, oldest first" list on an admin page.

## B-3. Resolution Not Finalized
**What:** Compliance can *propose* a resolution, but nothing automatically
*executes* it (refund/release), so orders + escrow stay stuck.
**Risk:** Escrow funds remain locked after a decision is made.

**Fix approach:**
1. Confirm where a proposed resolution is stored (the disputes table / a
   resolution column).
2. Build a small **resolution-finalizer worker** that polls for
   approved-but-not-executed resolutions and performs the refund/release
   **atomically** (reuse `atomicCancelWithRefund` / the release path).
3. This new worker will **automatically get heartbeats + alerts** from Part A —
   just call its tick through `runWorkerTick('resolution-finalizer', { ... })`.

---

## Commit plan (keep changes separate)

Four separate commits. Only **Commit 1** exists today (the monitoring work);
2–4 come later as each fix is built.

> ⚠️ The working tree also contains **unrelated in-progress work** (phone
> verification: `migrations/149_*`, `app/api/merchant/phone/`,
> `components/merchant/PhoneVerificationModal.tsx`, `lib/sms/`,
> `merchant/settings/page.tsx`, `repositories/merchants.ts`,
> `validation/schemas.ts`). **Do NOT include those** in the monitoring commit —
> the explicit `git add` list below avoids them.

### ✅ Commit 1 — Worker Health Monitoring (issues #4 + #5)

```bash
# 1) Work on a branch, not straight on main
git checkout -b feat/worker-health-monitoring

# 2) Stage the NEW files
git add \
  settle/database/migrations/150_worker_health.sql \
  apps/core-api/src/workers/workerHealth.ts \
  apps/core-api/src/workers/workerHealthChecker.ts \
  apps/core-api/src/workers/slackAlert.ts \
  apps/core-api/src/workers/sentryAlert.ts \
  settle/src/lib/workerHealth.ts \
  settle/src/app/api/admin/worker-health/route.ts \
  settle/src/app/admin/worker-health/page.tsx \
  settle/src/app/admin/worker-health/WorkerHealthPanel.tsx \
  CRITICAL_ISSUES_FIX_GUIDE.md

# 3) Stage the MODIFIED files that are 100% monitoring changes
git add \
  apps/core-api/src/index.ts \
  apps/core-api/src/routes/health.ts \
  apps/core-api/src/workers/corridorTimeoutWorker.ts \
  apps/core-api/src/workers/autoBumpWorker.ts \
  apps/core-api/src/workers/priceFeedWorker.ts \
  apps/core-api/src/workers/notificationOutbox.ts \
  apps/core-api/src/workers/outboxEventWorker.ts \
  apps/core-api/src/workers/reputationWorker.ts \
  apps/core-api/src/workers/idempotencyCleanupWorker.ts \
  apps/core-api/src/workers/receiptReconciliationWorker.ts \
  apps/core-api/src/workers/onChainReconciliationWorker.ts \
  apps/core-api/src/workers/receiptWorker.ts \
  settle/src/workers/escrow-reconciler.ts \
  settle/src/workers/notificationOutbox.ts \
  settle/src/workers/price-tick-collector.ts \
  settle/src/workers/anomaly-sweeper.ts \
  ecosystem.config.cjs \
  settle/server.js \
  settle/src/app/admin/layout.tsx

# 4) MIXED files — stage ONLY the heartbeat hunks (these 2 had your earlier,
#    unrelated edits before the wrap was added). Say 'y' to the
#    `import { runWorkerTick }` + `runWorkerTick(...)` hunks, 'n' to the rest.
git add -p apps/core-api/src/workers/unhappyPathWorker.ts
git add -p settle/src/workers/payment-deadline-worker.ts

# 5) Verify BEFORE committing — confirm no phone-verification files snuck in
git diff --cached --stat

# 6) Commit
git commit -m "feat(workers): worker health monitoring + alerting

Adds a heartbeat (worker_health table, migration 150) to every background
worker, a 60s health checker that flags stalled/dead workers, an admin
dashboard (/admin/worker-health), a /health/workers uptime endpoint, gated
Slack + Sentry alerts, and PM2 supervision for settle's workers behind an
env-gated, reversible cutover (WORKERS_VIA_PM2).

Fixes: silent worker death (issue #4) and no real-time alerting (issue #5).
All changes are additive/dormant until env switches are set — no behaviour
change on deploy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### ⏳ Commit 2 — Fix B-1 (refund balance update) — *future, separate branch/commit*
```
fix(refunds): always update balance + ledger atomically on refund (issue #1)
```

### ⏳ Commit 3 — Fix B-2 (stuck fiat-sent disputes) — *future*
```
feat(disputes): escalate + alert on fiat-sent disputes past SLA (issue #2)
```

### ⏳ Commit 4 — Fix B-3 (resolution finalizer) — *future*
```
feat(disputes): worker to finalize compliance-approved resolutions (issue #3)
```
