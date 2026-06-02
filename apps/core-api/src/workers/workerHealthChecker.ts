/**
 * Worker Health Checker (core-api).
 *
 * Runs every ~60s. Reads the shared `worker_health` table (written by both
 * fleets via runWorkerTick) and, for each worker, derives a status from how
 * stale its last heartbeat is:
 *
 *   healthy   — last_tick_at within warn threshold
 *   warning   — last_tick_at older than warn threshold (2x interval, ≥75s)
 *   critical  — last_tick_at older than crit threshold (4x interval, ≥180s)
 *
 * On a transition into `critical` (or once per cooldown while it stays
 * critical) it fans out an alert to three independently-gated, best-effort
 * channels, and posts a recovery notice when a critical worker heartbeats again:
 *   1. error_logs via safeLog  → /admin dashboard (gated by ENABLE_ERROR_TRACKING)
 *   2. Sentry                  → captureWorkerAlert (gated by @sentry/node + SENTRY_DSN)
 *   3. Slack                   → postSlackAlert (gated by SLACK_WEBHOOK)
 * All three no-op until configured, so this stays inert on an unconfigured box.
 * The checker itself never touches orders/escrow — only worker_health.status,
 * error_logs, and the outbound alert channels.
 *
 * Self-monitoring: the checker heartbeats itself (worker name
 * 'worker-health-checker') so a dead checker is itself visible. The outermost
 * net (a /health/workers endpoint + external uptime ping) comes in a later phase.
 *
 * Gating: set WORKER_HEALTH_CHECK_ENABLED=false to disable the start call
 * (the worker is read-only, so it is safe to leave enabled).
 */

import { query, safeLog, logger } from 'settlement-core';
import { runWorkerTick } from './workerHealth';
import { postSlackAlert } from './slackAlert';
import { captureWorkerAlert } from './sentryAlert';

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_HEALTH_CHECK_MS || '60000', 10);
const WARN_FLOOR_MS = parseInt(process.env.WORKER_HEALTH_WARN_FLOOR_MS || '75000', 10);
const CRIT_FLOOR_MS = parseInt(process.env.WORKER_HEALTH_CRIT_FLOOR_MS || '180000', 10);
const ALERT_COOLDOWN_MS = parseInt(process.env.WORKER_HEALTH_ALERT_COOLDOWN_MS || '900000', 10); // 15m

type Status = 'healthy' | 'warning' | 'critical' | 'stopped' | 'unknown';

interface HealthRow {
  worker_name: string;
  fleet: string;
  criticality: string;
  status: Status;
  expected_interval_ms: number | null;
  last_tick_at: string | null;
  alerted_at: string | null;
  last_error: string | null;
}

/**
 * Human-readable blast radius per worker, attached to the alert metadata so an
 * on-call responder immediately knows what stopped. Workers not listed here
 * still alert, just without the bullet list.
 */
const IMPACT: Record<string, string[]> = {
  'payment-deadline-worker': [
    'Auto refunds stopped',
    'Auto disputes (payment-sent → disputed) stopped',
    'Escrow + order expiries stopped',
    'Stuck on-chain escrow refunds stopped',
  ],
  'escrow-reconciler': [
    'On-chain ↔ DB escrow reconciliation stopped',
    'Confirmed escrow locks may never reflect as escrowed → funds appear locked',
  ],
  'corridorTimeoutWorker': [
    'Overdue corridor fulfillments not failed → buyer sAED stays locked',
  ],
  'unhappyPathWorker': [
    'Inactivity escalations stopped',
    '24h dispute auto-resolve + refund stopped',
  ],
};

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let tableMissingWarned = false;

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

/** One pass over worker_health. Returns the number of workers flagged critical. */
async function checkOnce(): Promise<{ items: number }> {
  let rows: HealthRow[];
  try {
    rows = await query<HealthRow>(
      `SELECT worker_name, fleet, criticality, status,
              expected_interval_ms, last_tick_at, alerted_at, last_error
         FROM worker_health`,
    );
  } catch (err) {
    // On a box where migration 150 hasn't been applied yet (e.g. local dev with
    // SKIP_PREFLIGHT=1) the table won't exist — degrade quietly, don't spam.
    if (isUndefinedTable(err)) {
      if (!tableMissingWarned) {
        tableMissingWarned = true;
        logger.warn('[WorkerHealthChecker] worker_health table not found — skipping until migration 150 is applied');
      }
      return { items: 0 };
    }
    throw err;
  }

  const now = Date.now();
  let flagged = 0;

  for (const r of rows) {
    if (!r.last_tick_at) continue;
    const ageMs = now - new Date(r.last_tick_at).getTime();
    const interval = r.expected_interval_ms || 60_000;
    const warnMs = Math.max(interval * 2, WARN_FLOOR_MS);
    const critMs = Math.max(interval * 4, CRIT_FLOOR_MS);

    let next: Status = 'healthy';
    if (ageMs > critMs) next = 'critical';
    else if (ageMs > warnMs) next = 'warning';

    const recovered = r.status === 'critical' && next !== 'critical';

    if (next !== r.status) {
      await query(
        `UPDATE worker_health SET status = $2, updated_at = NOW() WHERE worker_name = $1`,
        [r.worker_name, next],
      ).catch(() => {});
    }

    if (next === 'critical') {
      flagged++;
      const alertedAgeMs = r.alerted_at ? now - new Date(r.alerted_at).getTime() : Infinity;
      const isNewlyCritical = r.status !== 'critical';
      if (isNewlyCritical || alertedAgeMs > ALERT_COOLDOWN_MS) {
        await dispatchWorkerAlert(r, ageMs);
        await query(
          `UPDATE worker_health SET alerted_at = NOW() WHERE worker_name = $1`,
          [r.worker_name],
        ).catch(() => {});
      }
    } else if (recovered) {
      await dispatchWorkerRecovered(r);
    }
  }

  return { items: flagged };
}

/**
 * Fan out a worker-down alert to all configured channels. Each is independently
 * gated and best-effort — a failure in one never blocks the others or throws
 * into the checker loop.
 */
async function dispatchWorkerAlert(r: HealthRow, ageMs: number): Promise<void> {
  const mins = Math.round((ageMs / 60_000) * 10) / 10;
  const impact = IMPACT[r.worker_name] ?? [];
  const headline = `Worker "${r.worker_name}" has no heartbeat for ~${mins}m (criticality=${r.criticality}, fleet=${r.fleet})`;

  // 1. error_logs / admin dashboard (gated by ENABLE_ERROR_TRACKING inside safeLog)
  try {
    safeLog({
      type: `worker.down.${r.worker_name}`,
      severity: 'CRITICAL',
      source: 'worker',
      message: `🚨 ${headline}`,
      metadata: {
        worker: r.worker_name,
        fleet: r.fleet,
        criticality: r.criticality,
        ageMs,
        lastError: r.last_error,
        impact,
      },
    });
  } catch {
    /* swallow */
  }

  // 2. Sentry (no-op unless @sentry/node installed + SENTRY_DSN set)
  await captureWorkerAlert(`🚨 ${headline}`, {
    worker: r.worker_name,
    fleet: r.fleet,
    criticality: r.criticality,
    ageMinutes: mins,
    lastError: r.last_error,
    impact,
  });

  // 3. Slack (no-op unless SLACK_WEBHOOK set)
  const impactLines = impact.length ? `\nImpact:\n• ${impact.join('\n• ')}` : '';
  const errLine = r.last_error ? `\nLast error: ${r.last_error}` : '';
  await postSlackAlert(
    `🚨 *CRITICAL* — \`${r.worker_name}\` (${r.fleet}) no heartbeat for ~${mins}m${impactLines}${errLine}`,
  );
}

/** Notify (error_logs INFO + Slack) that a previously-critical worker recovered. */
async function dispatchWorkerRecovered(r: HealthRow): Promise<void> {
  try {
    safeLog({
      type: `worker.recovered.${r.worker_name}`,
      severity: 'INFO',
      source: 'worker',
      message: `✅ Worker "${r.worker_name}" (${r.fleet}) resumed heartbeating`,
      metadata: { worker: r.worker_name, fleet: r.fleet },
    });
  } catch {
    /* swallow */
  }
  await postSlackAlert(`✅ Recovered — \`${r.worker_name}\` (${r.fleet}) is heartbeating again`);
}

export function startWorkerHealthChecker(): void {
  if (process.env.WORKER_HEALTH_CHECK_ENABLED === 'false') {
    logger.info('[WorkerHealthChecker] disabled via WORKER_HEALTH_CHECK_ENABLED=false');
    return;
  }
  if (isRunning) return;
  isRunning = true;

  const poll = async () => {
    if (!isRunning) return;
    try {
      await runWorkerTick(
        'worker-health-checker',
        { intervalMs: POLL_INTERVAL_MS, criticality: 'high' },
        checkOnce,
      );
    } finally {
      if (isRunning) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  // Delay the first pass so freshly-started workers get a chance to heartbeat once.
  pollTimer = setTimeout(poll, 30_000);
  logger.info(`[WorkerHealthChecker] started (every ${POLL_INTERVAL_MS}ms)`);
}

export function stopWorkerHealthChecker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[WorkerHealthChecker] stopped');
}
