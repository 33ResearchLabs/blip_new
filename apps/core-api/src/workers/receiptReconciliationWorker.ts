/**
 * Receipt Reconciliation Worker (Core API)
 *
 * Safety net for the primary async receipt-creation pipeline:
 *   order mutation → outbox_events → outboxEventWorker → orderBus
 *   → receiptListener → receiptQueue → receiptWorker → createOrderReceipt
 *
 * Any link in that chain can fail silently (Redis unavailable at enqueue,
 * outbox event marked 'failed' after max retries, listener exception
 * swallowed by safeOn, BullMQ jobId dedup skipping a retry). When that
 * happens the order sits in a post-accept status with no matching row in
 * order_receipts, and the gap is never noticed.
 *
 * This worker periodically scans for such orphans and calls
 * createOrderReceipt() directly. That function uses INSERT … ON CONFLICT
 * (order_id) DO NOTHING, so it is safe to run against the whole table
 * even if the primary path is healthy.
 *
 * Defensive invariants:
 *   - Only considers orders in receipt-eligible statuses.
 *   - Requires a grace period (RECEIPT_RECON_GRACE_SEC) since the last
 *     order update, so the normal async path has time to finish before
 *     we step in. Avoids racing the happy path.
 *   - Resolves the accepting actor deterministically from order columns
 *     using the role contract in settle/CLAUDE.md:
 *       merchant_id is seller, buyer_merchant_id is buyer (M2M);
 *       in U2M, merchant_id is always the acceptor (buyer or seller).
 *     The only flow where the acceptor is NOT merchant_id is M2M SELL,
 *     which is uniquely identifiable as type='SELL' AND
 *     buyer_merchant_id IS NOT NULL (U2M SELL has null buyer_merchant_id;
 *     M2M BUY is type='BUY'). No audit-trail lookup needed.
 *   - Small batch, low poll rate — this is a safety net, not the
 *     primary path.
 *   - Toggleable via RECEIPT_RECON_ENABLED=false.
 */
import { query, logger } from 'settlement-core';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createOrderReceipt } from '../receipts';

// ── Tuning (env-overridable) ────────────────────────────────────
const ENABLED = (process.env.RECEIPT_RECON_ENABLED ?? 'true').toLowerCase() !== 'false';
const POLL_INTERVAL_MS = parseInt(process.env.RECEIPT_RECON_POLL_MS || '300000', 10); // 5 min
const BATCH_SIZE = parseInt(process.env.RECEIPT_RECON_BATCH_SIZE || '50', 10);
// Grace period — only reconcile orders whose last state-changing event
// happened at least this long ago. 10 minutes is comfortably longer
// than outbox retry backoff + BullMQ retry backoff combined.
const GRACE_PERIOD_SEC = parseInt(process.env.RECEIPT_RECON_GRACE_SEC || '600', 10);
const SUMMARY_INTERVAL_TICKS = Math.max(1, Math.round(1800000 / POLL_INTERVAL_MS)); // ~30 min

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let tickCount = 0;
let totalCreated = 0;
let totalSkipped = 0;
let totalErrors = 0;

// Receipt-eligible statuses: once an order reaches any of these, a
// receipt should exist. 'pending' is excluded intentionally — no accept
// has happened yet, so no counterparty to snapshot. Terminal statuses
// (cancelled, expired) are excluded because receipts are only created
// at accept time; a late-arriving cancel without an accept means the
// receipt was correctly skipped.
const RECEIPT_ELIGIBLE_STATUSES = ['accepted', 'escrowed', 'payment_sent', 'completed'];

interface OrphanedOrder {
  id: string;
  order_number: string;
  type: string;
  payment_method: string;
  crypto_amount: string;
  crypto_currency: string;
  fiat_amount: string;
  fiat_currency: string;
  rate: string;
  platform_fee: string;
  protocol_fee_amount: string | null;
  status: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  acceptor_wallet_address: string | null;
  buyer_wallet_address: string | null;
  escrow_tx_hash: string | null;
  payment_details: Record<string, unknown> | null;
  accepted_at: Date | null;
  escrowed_at: Date | null;
}

/**
 * Resolve the acceptor merchant id deterministically from the order's
 * own columns, per the role contract in settle/CLAUDE.md:
 *
 *   Flow         creator                acceptor (= actorId)
 *   ─────────    ───────                ────────────────────
 *   U2M BUY      user (user_id)         merchant_id
 *   U2M SELL     user (user_id)         merchant_id
 *   M2M BUY      buyer_merchant_id      merchant_id   (seller, reassigned on accept)
 *   M2M SELL     merchant_id            buyer_merchant_id   (buyer, set on claim)
 *
 * So the acceptor is merchant_id in every flow EXCEPT M2M SELL, which
 * is uniquely identified by (type='SELL' AND buyer_merchant_id is set).
 *   - U2M SELL has buyer_merchant_id = null
 *   - M2M BUY has type = 'BUY'
 * …so the condition can't collide with any other flow.
 *
 * Returns null only when merchant_id itself is unset (guarded upstream
 * in the orphan query — defensive belt-and-braces).
 */
function resolveAcceptorActor(order: OrphanedOrder): string | null {
  const isM2MSell =
    order.type === 'SELL' && order.buyer_merchant_id !== null;
  return isM2MSell ? order.buyer_merchant_id : order.merchant_id ?? null;
}

/**
 * Find orders that are in a receipt-eligible status but have no
 * matching row in order_receipts. Older than GRACE_PERIOD_SEC so we
 * don't race the async happy path.
 */
async function findOrphanedOrders(): Promise<OrphanedOrder[]> {
  return query<OrphanedOrder>(
    `SELECT o.id, o.order_number, o.type, o.payment_method,
            o.crypto_amount, o.crypto_currency, o.fiat_amount, o.fiat_currency, o.rate,
            o.platform_fee, o.protocol_fee_amount, o.status,
            o.user_id, o.merchant_id, o.buyer_merchant_id,
            o.acceptor_wallet_address, o.buyer_wallet_address,
            o.escrow_tx_hash, o.payment_details,
            o.accepted_at, o.escrowed_at
       FROM orders o
       LEFT JOIN order_receipts r ON r.order_id = o.id
      WHERE r.id IS NULL
        AND o.status = ANY($1::text[])
        AND o.merchant_id IS NOT NULL
        AND o.updated_at < NOW() - ($2 || ' seconds')::interval
      ORDER BY o.updated_at ASC
      LIMIT $3`,
    [RECEIPT_ELIGIBLE_STATUSES, String(GRACE_PERIOD_SEC), BATCH_SIZE],
  );
}

async function processBatch(): Promise<void> {
  let orphans: OrphanedOrder[];
  try {
    orphans = await findOrphanedOrders();
  } catch (err) {
    totalErrors++;
    logger.error('[ReceiptRecon] Error querying orphaned orders', {
      errorCode: 'RECEIPT_RECON_QUERY_ERROR',
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (orphans.length === 0) {
    writeHeartbeat(0);
    return;
  }

  logger.info('[ReceiptRecon] Found orphaned orders missing receipts', {
    count: orphans.length,
  });

  let created = 0;
  let skipped = 0;

  for (const order of orphans) {
    try {
      const actorId = resolveAcceptorActor(order);
      if (!actorId) {
        // Shouldn't happen — the orphan query requires merchant_id to
        // be non-null, and M2M SELL orders with buyer_merchant_id null
        // are pre-claim and shouldn't be in a receipt-eligible status
        // yet. Log and move on just in case the invariant is violated.
        skipped++;
        logger.warn('[ReceiptRecon] Skipping — could not resolve acceptor from columns', {
          orderId: order.id,
          status: order.status,
          type: order.type,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id,
        });
        continue;
      }

      // createOrderReceipt uses INSERT … ON CONFLICT (order_id) DO NOTHING
      // so this is safe to run even if a concurrent path creates the
      // receipt between our SELECT and our INSERT.
      await createOrderReceipt(order.id, order, actorId);
      created++;
      logger.info('[ReceiptRecon] Reconciled missing receipt', {
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status,
        actorId,
      });
    } catch (err) {
      // createOrderReceipt already logged the error and re-threw for
      // BullMQ retries. Here we swallow so one bad order doesn't stop
      // the batch — the next tick will try the remaining orphans again.
      totalErrors++;
      logger.error('[ReceiptRecon] Failed to reconcile order', {
        errorCode: 'RECEIPT_RECON_INSERT_ERROR',
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  totalCreated += created;
  totalSkipped += skipped;
  writeHeartbeat(orphans.length);
}

function writeHeartbeat(batchSize: number): void {
  try {
    writeFileSync(
      '/tmp/bm-worker-receipt-recon.json',
      JSON.stringify({
        lastRun: new Date().toISOString(),
        totalCreated,
        totalSkipped,
        totalErrors,
        lastBatchSize: batchSize,
      }),
    );
  } catch {
    /* non-critical */
  }
}

export function startReceiptReconciliationWorker(): void {
  if (!ENABLED) {
    logger.info('[ReceiptRecon] Disabled via RECEIPT_RECON_ENABLED=false');
    return;
  }
  if (isRunning) {
    logger.warn('[ReceiptRecon] Worker already running');
    return;
  }

  isRunning = true;
  logger.info('[ReceiptRecon] Starting receipt reconciliation worker', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    gracePeriodSec: GRACE_PERIOD_SEC,
  });

  const poll = async () => {
    if (!isRunning) return;
    try {
      await processBatch();
      tickCount++;

      if (tickCount % SUMMARY_INTERVAL_TICKS === 0) {
        logger.info('[ReceiptRecon] Summary', {
          totalCreated,
          totalSkipped,
          totalErrors,
        });
      }
    } catch (err) {
      // Never let the poll loop die — always reschedule.
      totalErrors++;
      logger.error('[ReceiptRecon] Unhandled error in poll loop', {
        errorCode: 'RECEIPT_RECON_POLL_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (isRunning) {
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }
  };

  // First run after a short delay so we don't pile onto app startup.
  pollTimer = setTimeout(poll, 30000);
}

export function stopReceiptReconciliationWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[ReceiptRecon] Stopped');
}

// If running as a standalone script (manual backfill runs).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startReceiptReconciliationWorker();

  const shutdown = () => {
    logger.info('[ReceiptRecon] Shutting down...');
    stopReceiptReconciliationWorker();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
