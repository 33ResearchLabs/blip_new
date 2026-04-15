/**
 * Anomaly Sweeper
 *
 * Observability-only background process. Runs every 60 seconds and queries
 * the database for business-level invariants that should never be violated.
 * Each detected anomaly is written to the `error_logs` table via the
 * centralized error tracking system — we never fix, rollback, refund, or
 * notify anyone. Humans (admins) look at the dashboard and decide.
 *
 * Feature-flag gated via ENABLE_ERROR_TRACKING + ENABLE_ANOMALY_SWEEPER.
 * When either is off, the worker is a no-op.
 *
 * Safety:
 *   - ALL queries are read-only (SELECT only). No writes to orders / ledger /
 *     escrow / merchants / users / chats.
 *   - Queries are bounded (LIMIT) and time-scoped to avoid scanning the full
 *     table on every run.
 *   - We record a "last seen" set so the same anomaly isn't re-logged every
 *     minute — only when it first appears.
 *   - If a check itself throws, we swallow it and continue to the next check.
 */

import { query } from '../lib/db';
import { safeLog } from '../lib/errorTracking/logger';

const SWEEP_INTERVAL_MS = 60_000; // 1 minute
const DEDUPE_WINDOW_MS = 30 * 60_000; // don't re-log the same anomaly within 30 min

const ENABLED =
  (process.env.ENABLE_ERROR_TRACKING || '').toLowerCase() === 'true' &&
  (process.env.ENABLE_ANOMALY_SWEEPER || '').toLowerCase() !== 'false';

// ── Dedupe cache ──────────────────────────────────────────────────────
// Key: `${checkName}:${entityId}` → last-logged timestamp
const recentlyLogged = new Map<string, number>();

function alreadyLogged(key: string): boolean {
  const last = recentlyLogged.get(key);
  if (!last) return false;
  if (Date.now() - last > DEDUPE_WINDOW_MS) return false;
  return true;
}

function markLogged(key: string): void {
  recentlyLogged.set(key, Date.now());
  // Cap memory — drop oldest if > 10k entries
  if (recentlyLogged.size > 10_000) {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    for (const [k, ts] of recentlyLogged) {
      if (ts < cutoff) recentlyLogged.delete(k);
    }
  }
}

async function runCheck(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // Don't let one broken check kill the sweep cycle
    console.error(`[anomaly-sweeper] Check "${name}" threw:`, err);
    try {
      safeLog({
        type: `anomaly.check_failed.${name}`,
        severity: 'WARN',
        message: `Anomaly check "${name}" itself threw: ${err instanceof Error ? err.message : String(err)}`,
        source: 'worker',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    } catch { /* swallow */ }
  }
}

// ── 1. Completed orders without an escrow funder ──────────────────────
// Should NEVER happen: CLAUDE.md explicitly forbids completion without an
// escrow lock. If we find one, some state-machine path bypassed the guard.
async function checkCompletedWithoutEscrowFunder(): Promise<void> {
  const rows = await query<{ id: string; completed_at: string; type: string; merchant_id: string | null; user_id: string }>(
    `SELECT id, completed_at, type, merchant_id, user_id
     FROM orders
     WHERE status = 'completed'
       AND escrow_debited_entity_id IS NULL
       AND completed_at > NOW() - INTERVAL '24 hours'
     LIMIT 50`
  );
  for (const r of rows) {
    const key = `completed_no_escrow:${r.id}`;
    if (alreadyLogged(key)) continue;
    markLogged(key);
    safeLog({
      type: 'escrow.state_mismatch',
      severity: 'CRITICAL',
      message: `Order completed without an escrow funder (should be impossible)`,
      source: 'worker',
      orderId: r.id,
      userId: r.user_id,
      merchantId: r.merchant_id,
      metadata: { orderType: r.type, completedAt: r.completed_at },
    });
  }
}

// ── 2. Orders stuck in payment_sent > 24h without a dispute ───────────
// The payment-deadline-worker is supposed to auto-dispute these. If any exist,
// the worker is either not running or is failing silently.
async function checkPaymentSentStuck(): Promise<void> {
  const rows = await query<{ id: string; payment_sent_at: string; user_id: string; merchant_id: string | null }>(
    `SELECT id, payment_sent_at, user_id, merchant_id
     FROM orders
     WHERE status = 'payment_sent'
       AND payment_sent_at < NOW() - INTERVAL '25 hours'
     LIMIT 50`
  );
  for (const r of rows) {
    const key = `payment_sent_stuck:${r.id}`;
    if (alreadyLogged(key)) continue;
    markLogged(key);
    safeLog({
      type: 'order.stuck',
      severity: 'ERROR',
      message: `Order stuck in payment_sent for >25h — payment-deadline-worker should have auto-disputed by 24h`,
      source: 'worker',
      orderId: r.id,
      userId: r.user_id,
      merchantId: r.merchant_id,
      metadata: { paymentSentAt: r.payment_sent_at },
    });
  }
}

// ── 3. Escrowed orders past expires_at that worker hasn't picked up ───
async function checkEscrowedExpired(): Promise<void> {
  const rows = await query<{ id: string; expires_at: string; user_id: string; merchant_id: string | null }>(
    `SELECT id, expires_at, user_id, merchant_id
     FROM orders
     WHERE status = 'escrowed'
       AND expires_at < NOW() - INTERVAL '5 minutes'
     LIMIT 50`
  );
  for (const r of rows) {
    const key = `escrowed_expired:${r.id}`;
    if (alreadyLogged(key)) continue;
    markLogged(key);
    safeLog({
      type: 'order.stuck',
      severity: 'ERROR',
      message: `Escrowed order is past expires_at by >5 min but not auto-cancelled+refunded`,
      source: 'worker',
      orderId: r.id,
      userId: r.user_id,
      merchantId: r.merchant_id,
      metadata: { expiresAt: r.expires_at },
    });
  }
}

// ── 4. Chat messages not delivered after 2 minutes ────────────────────
// Real-time push or WebSocket failure signal. Excludes system messages (they
// have no sender to deliver to).
async function checkUndeliveredChat(): Promise<void> {
  const rows = await query<{ id: string; order_id: string | null; sender_type: string; created_at: string }>(
    `SELECT id, order_id, sender_type, created_at
     FROM chat_messages
     WHERE delivered_at IS NULL
       AND message_type <> 'system'
       AND sender_type <> 'system'
       AND created_at < NOW() - INTERVAL '2 minutes'
       AND created_at > NOW() - INTERVAL '1 hour'
     LIMIT 50`
  );
  for (const r of rows) {
    const key = `chat_undelivered:${r.id}`;
    if (alreadyLogged(key)) continue;
    markLogged(key);
    safeLog({
      type: 'chat.undelivered',
      severity: 'WARN',
      message: `Chat message not delivered after 2 minutes`,
      source: 'worker',
      orderId: r.order_id,
      metadata: {
        messageId: r.id,
        senderType: r.sender_type,
        createdAt: r.created_at,
      },
    });
  }
}

// ── 5. Merchant balance drift vs ledger sum ───────────────────────────
// The balance column on merchants must equal the signed sum of its
// ledger_entries. Drift means an update skipped the ledger or vice-versa.
async function checkMerchantBalanceDrift(): Promise<void> {
  const rows = await query<{
    merchant_id: string;
    stored_balance: string;
    ledger_sum: string;
    drift: string;
  }>(
    `WITH ledger_totals AS (
       SELECT account_id AS merchant_id, SUM(
         CASE
           WHEN entry_type IN ('CREDIT','DEPOSIT','ESCROW_RELEASE','ESCROW_REFUND','REFUND') THEN amount
           WHEN entry_type IN ('DEBIT','WITHDRAWAL','ESCROW_LOCK','FEE','PAYMENT') THEN -amount
           ELSE 0
         END
       ) AS total
       FROM ledger_entries
       WHERE account_type = 'merchant'
       GROUP BY account_id
     )
     SELECT
       m.id AS merchant_id,
       m.balance::text AS stored_balance,
       COALESCE(lt.total, 0)::text AS ledger_sum,
       (m.balance - COALESCE(lt.total, 0))::text AS drift
     FROM merchants m
     LEFT JOIN ledger_totals lt ON lt.merchant_id = m.id
     WHERE ABS(m.balance - COALESCE(lt.total, 0)) > 0.0001
       AND EXISTS (SELECT 1 FROM ledger_entries WHERE account_id = m.id AND account_type = 'merchant')
     LIMIT 50`
  );
  for (const r of rows) {
    const key = `balance_drift:${r.merchant_id}`;
    if (alreadyLogged(key)) continue;
    markLogged(key);
    const drift = parseFloat(r.drift);
    safeLog({
      type: 'ledger.balance_drift',
      severity: Math.abs(drift) > 1 ? 'CRITICAL' : 'WARN',
      message: `Merchant balance drift: stored ${r.stored_balance} vs ledger sum ${r.ledger_sum} (drift ${r.drift})`,
      source: 'worker',
      merchantId: r.merchant_id,
      metadata: {
        storedBalance: r.stored_balance,
        ledgerSum: r.ledger_sum,
        drift: r.drift,
      },
    });
  }
}

// ── 6. Idempotency-log entries stuck in pending state ─────────────────
// Not all idempotency tables record a "pending" state, but if many keys for
// the same order in the last 10 min suggest a retry loop, flag it.
async function checkIdempotencyRetryStorm(): Promise<void> {
  const rows = await query<{ order_id: string; action: string; n: string }>(
    `SELECT order_id, action, COUNT(*)::text AS n
     FROM idempotency_log
     WHERE order_id IS NOT NULL
       AND created_at > NOW() - INTERVAL '10 minutes'
     GROUP BY order_id, action
     HAVING COUNT(*) > 5
     LIMIT 50`
  );
  for (const r of rows) {
    const key = `idempotency_storm:${r.order_id}:${r.action}`;
    if (alreadyLogged(key)) continue;
    markLogged(key);
    safeLog({
      type: 'idempotency.retry_storm',
      severity: 'WARN',
      message: `${r.n} idempotency keys for ${r.action} on same order in last 10 min — client is retrying aggressively`,
      source: 'worker',
      orderId: r.order_id,
      metadata: { action: r.action, attempts: r.n },
    });
  }
}

// ── Main tick ─────────────────────────────────────────────────────────
async function runSweep(): Promise<void> {
  const t0 = Date.now();
  await runCheck('completed_without_escrow_funder', checkCompletedWithoutEscrowFunder);
  await runCheck('payment_sent_stuck', checkPaymentSentStuck);
  await runCheck('escrowed_expired', checkEscrowedExpired);
  await runCheck('chat_undelivered', checkUndeliveredChat);
  await runCheck('merchant_balance_drift', checkMerchantBalanceDrift);
  await runCheck('idempotency_retry_storm', checkIdempotencyRetryStorm);
  const dt = Date.now() - t0;
  if (dt > 5000) {
    console.warn(`[anomaly-sweeper] Sweep took ${dt}ms — consider tuning queries`);
  }
}

async function start(): Promise<void> {
  if (!ENABLED) {
    console.log('[anomaly-sweeper] Disabled (ENABLE_ERROR_TRACKING or ENABLE_ANOMALY_SWEEPER not "true"/not set)');
    return;
  }
  console.log(`[anomaly-sweeper] Started (interval: ${SWEEP_INTERVAL_MS}ms)`);
  // Initial run after a short delay so DB pool is warm
  setTimeout(() => { runSweep().catch(() => {}); }, 5_000);
  setInterval(() => { runSweep().catch(() => {}); }, SWEEP_INTERVAL_MS);
}

process.on('SIGINT', () => {
  console.log('[anomaly-sweeper] Worker shutting down');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[anomaly-sweeper] Worker shutting down');
  process.exit(0);
});

if (require.main === module) {
  start().catch((err) => {
    console.error('[anomaly-sweeper] Fatal:', err);
    process.exit(1);
  });
}

export { start, runSweep };
