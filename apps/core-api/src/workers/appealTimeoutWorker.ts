/**
 * Appeal Timeout Worker (Core API)
 *
 * An appeal (the peer-resolution stage) carries an `appeal_deadline`. If the
 * counterparty neither agrees nor rejects before that deadline, this worker
 * auto-escalates the appeal to a formal dispute — exactly the same outcome as a
 * manual "reject", driven by the `system` actor.
 *
 * Deadline is short by design (APPEAL_TIMEOUT_MINUTES, default 10 min), so this
 * polls frequently (~30s) — a slow poll would make "10 min" really "10–13 min".
 *
 * Per-row transactional with FOR UPDATE SKIP LOCKED so multiple core-api
 * instances never double-escalate the same appeal. Escrow is never touched —
 * escalation only moves the order to `disputed` for compliance to resolve.
 */
import { query, transaction, logger } from 'settlement-core';
import { runWorkerTick } from './workerHealth';
import { escalateAppealToDispute } from '../appeals/escalate';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const POLL_INTERVAL_MS = parseInt(process.env.APPEAL_TIMEOUT_POLL_MS || '30000', 10); // 30s
const BATCH_SIZE = parseInt(process.env.APPEAL_TIMEOUT_BATCH_SIZE || '20', 10);

// Raw order statuses on which an appeal can legitimately be open and escalated.
const ESCALATABLE_STATUSES = ['accepted', 'escrowed', 'payment_sent'];

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let totalEscalated = 0;

interface DueAppealRow {
  appeal_id: string;
  issue_key: string;
  order_id: string;
}

/**
 * Escalate one due appeal in its own transaction. Returns true if escalated.
 * Swallows per-row errors (logged) so one bad row never stalls the batch.
 */
async function escalateOne(row: DueAppealRow): Promise<boolean> {
  try {
    return await transaction(async (client) => {
      // Lock the appeal; SKIP LOCKED so a parallel instance/endpoint that is
      // already resolving it is simply skipped this tick.
      const appealLock = await client.query(
        `SELECT id, issue_key, status
           FROM appeals
          WHERE id = $1 AND status IN ('open', 'proposed')
          FOR UPDATE SKIP LOCKED`,
        [row.appeal_id],
      );
      if (appealLock.rows.length === 0) return false; // resolved or locked elsewhere
      const appeal = appealLock.rows[0] as { id: string; issue_key: string };

      // Lock the order row.
      const orderLock = await client.query(
        `SELECT id, status, user_id, merchant_id, order_version
           FROM orders
          WHERE id = $1
          FOR UPDATE`,
        [row.order_id],
      );
      if (orderLock.rows.length === 0) return false;
      const order = orderLock.rows[0] as {
        id: string; status: string; user_id: string;
        merchant_id: string | null; order_version: number;
      };

      // The order may have moved on (cancelled/completed/already disputed)
      // between the scan and the lock — skip if no longer escalatable.
      if (!ESCALATABLE_STATUSES.includes(order.status)) return false;

      await escalateAppealToDispute(client, {
        appeal: { id: appeal.id, issue_key: appeal.issue_key },
        order: {
          id: order.id, status: order.status, user_id: order.user_id,
          merchant_id: order.merchant_id, order_version: order.order_version,
        },
        actor: { type: 'system', id: null },
        reason: 'appeal_timeout',
      });
      return true;
    });
  } catch (error) {
    logger.error('[AppealTimeout] Failed to escalate appeal', {
      orderId: row.order_id,
      appealId: row.appeal_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function processDueAppeals(): Promise<number> {
  const due = await query<DueAppealRow>(
    `SELECT a.id AS appeal_id, a.issue_key, a.order_id
       FROM appeals a
       JOIN orders o ON o.id = a.order_id
      WHERE a.status IN ('open', 'proposed')
        AND a.appeal_deadline < NOW()
        AND o.status IN ('accepted', 'escrowed', 'payment_sent')
      ORDER BY a.appeal_deadline ASC
      LIMIT $1`,
    [BATCH_SIZE],
  );

  let escalated = 0;
  for (const row of due) {
    if (await escalateOne(row)) {
      escalated += 1;
      totalEscalated += 1;
      logger.info('[AppealTimeout] Auto-escalated appeal → disputed', { orderId: row.order_id });
    }
  }
  return escalated;
}

function writeHeartbeat(escalated: number): void {
  try {
    writeFileSync('/tmp/bm-worker-appeal-timeout.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      totalEscalated,
      lastBatchEscalated: escalated,
    }));
  } catch { /* non-critical */ }
}

async function tick(): Promise<void> {
  if (!isRunning) return;

  await runWorkerTick(
    'appealTimeoutWorker',
    { intervalMs: POLL_INTERVAL_MS, criticality: 'medium', timeoutMs: 60_000 },
    async () => {
      const escalated = await processDueAppeals();
      writeHeartbeat(escalated);
      return { items: escalated };
    },
  );

  if (isRunning) {
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  }
}

export function startAppealTimeoutWorker(): void {
  if (isRunning) {
    logger.warn('[AppealTimeout] Worker already running');
    return;
  }
  isRunning = true;
  logger.info('[AppealTimeout] Starting appeal-timeout worker', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });
  // First tick after 30s (let other workers start first).
  pollTimer = setTimeout(tick, 30000);
}

export function stopAppealTimeoutWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[AppealTimeout] Stopped appeal-timeout worker');
}

// Standalone entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startAppealTimeoutWorker();
  const shutdown = () => {
    stopAppealTimeoutWorker();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
