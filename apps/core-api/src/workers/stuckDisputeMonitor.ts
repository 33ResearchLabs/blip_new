/**
 * Stuck-Dispute Monitor — DETECTION + ALERTING only (critical issues #2 + #3).
 *
 * Surfaces disputes that are silently stuck in status='disputed' with no
 * resolution reaching them, and pages whoever is on call. It mirrors the
 * read-only detector settle/scripts/stuck-disputes-verify.js, but instead of
 * printing it fans alerts through the SAME monitoring infra the worker-health
 * checker uses: error_logs (safeLog) + Slack (postSlackAlert) + Sentry
 * (captureWorkerAlert). Compliance resolves the surfaced disputes via the
 * existing /api/compliance/disputes/[id]/finalize endpoint.
 *
 * Buckets it pages on (HIGH — real stuck funds):
 *   A. never_scheduled  — disputed but dispute_auto_resolve_at IS NULL → the
 *      auto-resolve worker can never pick it up.
 *   B. overdue_unworked — past the 24h deadline, still disputed (worker missed it).
 *   E. proposed_unfinal — a compliance resolution was proposed but the 2-party
 *      confirm deadlocked and nothing auto-finalises it (issue #3).
 * Buckets it records but does NOT page on (MEDIUM):
 *   C. needs_compliance — payment_sent disputes, excluded from auto-resolve by
 *      the fund-safety guard; they need a human but that's by design.
 *   D. state_mismatch   — order resolved but the dispute row left open (cosmetic).
 *
 * Safety / zero-regression:
 *   - READ-ONLY against orders/disputes. It NEVER mutates a dispute or order;
 *     it only reads, then emits alerts. Not on any order code path.
 *   - OFF by default: the poller only runs when STUCK_DISPUTE_ALERTS_ENABLED=true.
 *   - All three alert channels are independently no-op until configured
 *     (ENABLE_ERROR_TRACKING / SLACK_WEBHOOK / SENTRY_DSN), exactly like the
 *     worker-health checker — so this is safe to ship before any are set up.
 *   - Never throws.
 *
 * Run a one-shot by hand (ignores the ENABLE flag):
 *   npx tsx src/workers/stuckDisputeMonitor.ts
 */

import { fileURLToPath } from 'node:url';
import { query, safeLog, logger } from 'settlement-core';
import { postSlackAlert } from './slackAlert';
import { captureWorkerAlert } from './sentryAlert';

const ENABLED = (process.env.STUCK_DISPUTE_ALERTS_ENABLED || '').toLowerCase() === 'true';
const INTERVAL_MS = parseInt(process.env.STUCK_DISPUTE_POLL_MS || '600000', 10); // 10 min
const OVERDUE_GRACE_HOURS = parseInt(process.env.STUCK_OVERDUE_GRACE_HOURS || '1', 10);
const PROPOSED_STALE_HOURS = parseInt(process.env.STUCK_PROPOSED_STALE_HOURS || '24', 10);
const SAMPLE_LIMIT = parseInt(process.env.STUCK_DISPUTE_SAMPLE_LIMIT || '10', 10);

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

export interface StuckDisputeCounts {
  a_never_scheduled: number;
  b_overdue_unworked: number;
  c_needs_compliance: number;
  d_state_mismatch: number;
  e_proposed_unfinal: number;
  highTotal: number; // A + B + E — the page-worthy ones
  samples: string[]; // a few order_numbers from the HIGH buckets, for the alert
}

const n = (v: unknown): number => Number(v ?? 0) || 0;

/** One read-only detection pass. Returns counts; never throws. */
export async function runStuckDisputeCheckOnce(): Promise<StuckDisputeCounts> {
  const empty: StuckDisputeCounts = {
    a_never_scheduled: 0, b_overdue_unworked: 0, c_needs_compliance: 0,
    d_state_mismatch: 0, e_proposed_unfinal: 0, highTotal: 0, samples: [],
  };
  try {
    const orderBuckets = await query<{ a: string; b: string; c: string }>(
      `SELECT
          COUNT(*) FILTER (WHERE o.status='disputed' AND o.dispute_auto_resolve_at IS NULL) AS a,
          COUNT(*) FILTER (WHERE o.status='disputed' AND o.dispute_auto_resolve_at IS NOT NULL
                            AND o.dispute_auto_resolve_at < NOW() - ($1 || ' hours')::interval
                            AND o.payment_sent_at IS NULL) AS b,
          COUNT(*) FILTER (WHERE o.status='disputed' AND o.payment_sent_at IS NOT NULL) AS c
         FROM orders o`,
      [String(OVERDUE_GRACE_HOURS)],
    );

    const eRows = await query<{ e: string }>(
      `SELECT COUNT(*) AS e
         FROM orders o
         JOIN disputes d ON d.order_id = o.id
        WHERE o.status='disputed' AND d.status='investigating'
          AND d.proposed_resolution IS NOT NULL
          AND d.proposed_at < NOW() - ($1 || ' hours')::interval`,
      [String(PROPOSED_STALE_HOURS)],
    );

    const dRows = await query<{ d: string }>(
      `SELECT COUNT(*) AS d
         FROM disputes d
         JOIN orders o ON o.id = d.order_id
        WHERE d.status IN ('open','investigating','pending_confirmation','escalated')
          AND o.status <> 'disputed'`,
    );

    const a = n(orderBuckets[0]?.a);
    const b = n(orderBuckets[0]?.b);
    const c = n(orderBuckets[0]?.c);
    const e = n(eRows[0]?.e);
    const d = n(dRows[0]?.d);
    const highTotal = a + b + e;

    let samples: string[] = [];
    if (highTotal > 0) {
      const sampleRows = await query<{ order_number: string }>(
        `SELECT DISTINCT o.order_number
           FROM orders o
           LEFT JOIN disputes d ON d.order_id = o.id
          WHERE o.status='disputed'
            AND (
              o.dispute_auto_resolve_at IS NULL
              OR (o.dispute_auto_resolve_at < NOW() - ($1 || ' hours')::interval AND o.payment_sent_at IS NULL)
              OR (d.status='investigating' AND d.proposed_resolution IS NOT NULL
                  AND d.proposed_at < NOW() - ($2 || ' hours')::interval)
            )
          LIMIT $3`,
        [String(OVERDUE_GRACE_HOURS), String(PROPOSED_STALE_HOURS), String(SAMPLE_LIMIT)],
      );
      samples = sampleRows.map((r) => r.order_number).filter(Boolean);
    }

    return { a_never_scheduled: a, b_overdue_unworked: b, c_needs_compliance: c, d_state_mismatch: d, e_proposed_unfinal: e, highTotal, samples };
  } catch (err) {
    logger.error('[StuckDisputeMonitor] detection query failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

/** Fan alerts for the current counts. Each channel is independently no-op until configured. */
async function emitAlerts(counts: StuckDisputeCounts): Promise<void> {
  const { a_never_scheduled, b_overdue_unworked, e_proposed_unfinal, c_needs_compliance, d_state_mismatch, highTotal, samples } = counts;

  if (highTotal > 0) {
    const msg = `Stuck disputes detected: ${highTotal} (A never-scheduled=${a_never_scheduled}, B overdue=${b_overdue_unworked}, E proposed-unfinalized=${e_proposed_unfinal}). Orders: ${samples.join(', ') || 'n/a'}. Resolve via /api/compliance/disputes/[id]/finalize.`;
    safeLog({
      type: 'dispute.stuck',
      severity: 'ERROR',
      source: 'worker',
      message: msg,
      metadata: { ...counts },
    });
    await postSlackAlert(`:rotating_light: ${msg}`);
    await captureWorkerAlert(msg, { ...counts });
    logger.warn('[StuckDisputeMonitor] HIGH stuck disputes', { ...counts });
  }

  // MEDIUM buckets — recorded for the dashboard, but no page.
  if (c_needs_compliance > 0 || d_state_mismatch > 0) {
    safeLog({
      type: 'dispute.attention',
      severity: 'WARN',
      source: 'worker',
      message: `Disputes needing attention: C needs-compliance=${c_needs_compliance}, D state-mismatch=${d_state_mismatch}.`,
      metadata: { c_needs_compliance, d_state_mismatch },
    });
  }
}

export async function runStuckDisputeMonitorOnce(): Promise<StuckDisputeCounts> {
  const counts = await runStuckDisputeCheckOnce();
  await emitAlerts(counts);
  return counts;
}

export async function startStuckDisputeMonitor(): Promise<void> {
  if (!ENABLED) {
    logger.info('[StuckDisputeMonitor] disabled (set STUCK_DISPUTE_ALERTS_ENABLED=true to run)');
    return;
  }
  if (isRunning) return;
  isRunning = true;
  logger.info('[StuckDisputeMonitor] started', { intervalMs: INTERVAL_MS });

  const poll = async () => {
    if (!isRunning) return;
    try {
      const res = await runStuckDisputeMonitorOnce();
      if (res.highTotal > 0 || res.c_needs_compliance > 0 || res.d_state_mismatch > 0) {
        logger.info('[StuckDisputeMonitor] pass complete', { ...res });
      }
    } catch (err) {
      logger.error('[StuckDisputeMonitor] pass failed', { error: err instanceof Error ? err.message : String(err) });
    }
    pollTimer = setTimeout(poll, INTERVAL_MS);
  };
  await poll();
}

export function stopStuckDisputeMonitor(): void {
  isRunning = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

// One-shot manual run (ignores the ENABLE flag). core-api is ESM, so `require`
// is undefined — use an ESM-safe main-module check that can never throw at import
// (a throw here would crash core-api boot, since index.ts imports this module).
//   npx tsx src/workers/stuckDisputeMonitor.ts
const isCliRun = (() => {
  try { return !!process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url); }
  catch { return false; }
})();
if (isCliRun) {
  (async () => {
    const res = await runStuckDisputeMonitorOnce();
    // eslint-disable-next-line no-console
    console.log('[StuckDisputeMonitor] one-shot complete:', res);
    process.exit(0);
  })().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[StuckDisputeMonitor] failed:', e);
    process.exit(1);
  });
}
