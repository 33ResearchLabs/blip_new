/**
 * Unhappy Path Worker (Core API)
 *
 * Runs on a polling loop and handles three escalation tiers:
 *
 * 1. INACTIVITY WARNING (15 min)
 *    - Order is post-acceptance but no activity for 15 min
 *    - Sends notification: "Complete this order or cancel"
 *    - Sets inactivity_warned_at
 *
 * 2. INACTIVITY ESCALATION (1 hr)
 *    - Order is post-acceptance, no activity for 1 hr
 *    - If escrow exists → move to disputed (protects funds)
 *    - If no escrow → auto-cancel
 *
 * 3. DISPUTE AUTO-RESOLVE (24 hr)
 *    - Order has been disputed for 24 hours with no resolution
 *    - Auto-refund crypto to whoever funded the escrow
 *    - Order → cancelled
 */

import { query, queryOne, logger, MOCK_MODE, normalizeStatus } from 'settlement-core';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { broadcastOrderEvent } from '../ws/broadcast';

config({ path: '../../settle/.env.local' });
config({ path: '../../settle/.env' });

const POLL_INTERVAL_MS = parseInt(process.env.UNHAPPY_POLL_MS || '15000', 10);
const BATCH_SIZE = parseInt(process.env.UNHAPPY_BATCH_SIZE || '20', 10);

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60000;

// Stats
let totalWarnings = 0;
let totalEscalations = 0;
let totalDisputeAutoResolves = 0;

// ────────────────────────────────────────────────
// 1. INACTIVITY WARNING (15 min no activity)
// ────────────────────────────────────────────────
async function processInactivityWarnings(): Promise<number> {
  const rows = await query<{
    id: string; order_number: string; status: string;
    user_id: string; merchant_id: string; last_activity_at: Date;
  }>(
    `SELECT id, order_number, status, user_id, merchant_id, last_activity_at
     FROM orders
     WHERE status IN ('accepted', 'escrowed', 'payment_pending', 'payment_sent')
       AND last_activity_at IS NOT NULL
       AND last_activity_at < NOW() - INTERVAL '15 minutes'
       AND inactivity_warned_at IS NULL
       AND cancel_requested_by IS NULL
       AND extension_requested_by IS NULL
     ORDER BY last_activity_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const order of rows) {
    try {
      // Mark warned
      await query(
        `UPDATE orders SET inactivity_warned_at = NOW(), order_version = order_version + 1 WHERE id = $1`,
        [order.id]
      );

      // Notification to both parties
      await query(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status)
         VALUES ($1, 'INACTIVITY_WARNING', $2, 'pending')`,
        [
          order.id,
          JSON.stringify({
            orderId: order.id,
            userId: order.user_id,
            merchantId: order.merchant_id,
            status: order.status,
            message: 'No activity for 15 minutes. Please complete the order or it may be cancelled/disputed.',
            lastActivityAt: order.last_activity_at,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      // Event
      await query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'inactivity_warning', 'system', NULL, $2)`,
        [order.id, JSON.stringify({
          lastActivityAt: order.last_activity_at,
          minutesSinceActivity: Math.round((Date.now() - new Date(order.last_activity_at).getTime()) / 60000),
        })]
      );

      broadcastOrderEvent({
        event_type: 'INACTIVITY_WARNING',
        order_id: order.id,
        status: order.status,
        minimal_status: normalizeStatus(order.status as any),
        order_version: 0,
        userId: order.user_id,
        merchantId: order.merchant_id,
      });

      totalWarnings++;
      logger.info('[UnhappyPath] Inactivity warning sent', {
        orderId: order.id, orderNumber: order.order_number, status: order.status,
      });
    } catch (err) {
      logger.error('[UnhappyPath] Error sending inactivity warning', {
        orderId: order.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return rows.length;
}

// ────────────────────────────────────────────────
// 2. INACTIVITY ESCALATION (1 hr no activity)
// ────────────────────────────────────────────────
async function processInactivityEscalations(): Promise<number> {
  const rows = await query<{
    id: string; order_number: string; status: string;
    user_id: string; merchant_id: string; type: string;
    crypto_amount: string; escrow_tx_hash: string | null;
    escrow_debited_entity_type: string | null;
    escrow_debited_entity_id: string | null;
    offer_id: string | null;
    last_activity_at: Date;
  }>(
    `SELECT id, order_number, status, user_id, merchant_id, type,
            crypto_amount, escrow_tx_hash, escrow_debited_entity_type,
            escrow_debited_entity_id, offer_id, last_activity_at
     FROM orders
     WHERE status IN ('accepted', 'escrowed', 'payment_pending', 'payment_sent')
       AND last_activity_at IS NOT NULL
       AND last_activity_at < NOW() - INTERVAL '1 hour'
       AND inactivity_warned_at IS NOT NULL
     ORDER BY last_activity_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const order of rows) {
    try {
      const hasEscrow = !!order.escrow_tx_hash;
      const isEscrowedPhase = ['escrowed', 'payment_pending', 'payment_sent'].includes(order.status);

      if (hasEscrow && isEscrowedPhase) {
        // DISPUTE — money is locked, need manual resolution
        await query(
          `UPDATE orders
           SET status = 'disputed',
               order_version = order_version + 1
           WHERE id = $1`,
          [order.id]
        );

        await query(
          `INSERT INTO disputes (order_id, reason, description, raised_by, raiser_id, status, user_confirmed, merchant_confirmed, created_at)
           VALUES ($1, 'non_responsive'::dispute_reason, $2, 'system'::actor_type, NULL, 'open'::dispute_status, false, false, NOW())
           ON CONFLICT (order_id) DO NOTHING`,
          [order.id, `Auto-escalated: no activity for 1 hour in ${order.status} status with escrow locked`]
        );

        await query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'status_changed_to_disputed', 'system', NULL, $2, 'disputed', $3)`,
          [order.id, order.status, JSON.stringify({
            reason: 'inactivity_escalation',
            lastActivityAt: order.last_activity_at,
          })]
        );

        await query(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status)
           VALUES ($1, 'ORDER_DISPUTED', $2, 'pending')`,
          [
            order.id,
            JSON.stringify({
              orderId: order.id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: 'disputed',
              previousStatus: order.status,
              reason: 'Inactivity escalation — no activity for 1 hour',
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        broadcastOrderEvent({
          event_type: 'ORDER_DISPUTED',
          order_id: order.id,
          status: 'disputed',
          minimal_status: normalizeStatus('disputed' as any),
          order_version: 0,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        logger.info('[UnhappyPath] Inactivity escalation → disputed', {
          orderId: order.id, orderNumber: order.order_number, previousStatus: order.status,
        });
      } else {
        // CANCEL — no escrow at risk, just cancel
        const amount = parseFloat(String(order.crypto_amount));

        // Restore offer liquidity
        if (order.offer_id) {
          await query(
            `UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2`,
            [amount, order.offer_id]
          );
        }

        await query(
          `UPDATE orders
           SET status = 'cancelled',
               cancelled_at = NOW(),
               cancelled_by = 'system',
               cancellation_reason = 'Auto-cancelled: no activity for 1 hour',
               order_version = order_version + 1
           WHERE id = $1`,
          [order.id]
        );

        await query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'status_changed_to_cancelled', 'system', NULL, $2, 'cancelled', $3)`,
          [order.id, order.status, JSON.stringify({ reason: 'inactivity_auto_cancel' })]
        );

        await query(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status)
           VALUES ($1, 'ORDER_CANCELLED', $2, 'pending')`,
          [
            order.id,
            JSON.stringify({
              orderId: order.id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: 'cancelled',
              previousStatus: order.status,
              reason: 'Auto-cancelled: no activity for 1 hour',
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        broadcastOrderEvent({
          event_type: 'ORDER_CANCELLED',
          order_id: order.id,
          status: 'cancelled',
          minimal_status: normalizeStatus('cancelled' as any),
          order_version: 0,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        logger.info('[UnhappyPath] Inactivity auto-cancel', {
          orderId: order.id, orderNumber: order.order_number,
        });
      }

      totalEscalations++;
    } catch (err) {
      logger.error('[UnhappyPath] Error processing inactivity escalation', {
        orderId: order.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return rows.length;
}

// ────────────────────────────────────────────────
// 3. DISPUTE AUTO-RESOLVE (24 hr)
//    Refund to whoever funded the escrow.
// ────────────────────────────────────────────────
async function processDisputeAutoResolves(): Promise<number> {
  const rows = await query<{
    id: string; order_number: string; status: string;
    user_id: string; merchant_id: string; type: string;
    crypto_amount: string; escrow_tx_hash: string | null;
    escrow_debited_entity_type: string | null;
    escrow_debited_entity_id: string | null;
    offer_id: string | null;
    dispute_auto_resolve_at: Date;
  }>(
    `SELECT id, order_number, status, user_id, merchant_id, type,
            crypto_amount, escrow_tx_hash, escrow_debited_entity_type,
            escrow_debited_entity_id, offer_id, dispute_auto_resolve_at
     FROM orders
     WHERE status = 'disputed'
       AND dispute_auto_resolve_at IS NOT NULL
       AND dispute_auto_resolve_at < NOW()
     ORDER BY dispute_auto_resolve_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const order of rows) {
    try {
      const amount = parseFloat(String(order.crypto_amount));
      const hasEscrow = !!order.escrow_tx_hash;

      // Determine who funded escrow → refund to them
      let refundTo: string;
      let refundTable: string;

      if (order.escrow_debited_entity_type && order.escrow_debited_entity_id) {
        // Use tracked entity
        refundTable = order.escrow_debited_entity_type === 'user' ? 'users' : 'merchants';
        refundTo = order.escrow_debited_entity_id;
      } else {
        // Fallback: sell → user funded, buy → merchant funded
        const isSellOrder = order.type === 'sell';
        refundTo = isSellOrder ? order.user_id : order.merchant_id;
        refundTable = isSellOrder ? 'users' : 'merchants';
      }

      // Refund in mock mode
      if (hasEscrow && MOCK_MODE) {
        await query(
          `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
          [amount, refundTo]
        );

        logger.info('[UnhappyPath] Dispute auto-resolve refund', {
          orderId: order.id, amount, refundTo, table: refundTable,
        });
      }

      // Restore offer liquidity
      if (order.offer_id) {
        await query(
          `UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2`,
          [amount, order.offer_id]
        );
      }

      // Update order → cancelled (refund to escrow funder)
      await query(
        `UPDATE orders
         SET status = 'cancelled',
             cancelled_at = NOW(),
             cancelled_by = 'system',
             cancellation_reason = 'Dispute auto-resolved: 24hr timeout — refunded to escrow funder',
             order_version = order_version + 1
         WHERE id = $1`,
        [order.id]
      );

      // Resolve dispute
      await query(
        `UPDATE disputes
         SET status = 'resolved'::dispute_status,
             resolution = 'escrow_funder',
             resolution_notes = 'Auto-resolved after 24hr timeout. Refunded to escrow funder.',
             resolved_at = NOW()
         WHERE order_id = $1`,
        [order.id]
      );

      // Event
      await query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'dispute_auto_resolved', 'system', NULL, 'disputed', 'cancelled', $2)`,
        [order.id, JSON.stringify({
          reason: '24hr_auto_resolve',
          refundTo,
          refundTable,
          amount,
        })]
      );

      // Notification
      await query(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status)
         VALUES ($1, 'DISPUTE_AUTO_RESOLVED', $2, 'pending')`,
        [
          order.id,
          JSON.stringify({
            orderId: order.id,
            userId: order.user_id,
            merchantId: order.merchant_id,
            status: 'cancelled',
            previousStatus: 'disputed',
            reason: 'Dispute auto-resolved after 24 hours. Funds returned to escrow funder.',
            refundTo,
            amount,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      broadcastOrderEvent({
        event_type: 'DISPUTE_AUTO_RESOLVED',
        order_id: order.id,
        status: 'cancelled',
        minimal_status: normalizeStatus('cancelled' as any),
        order_version: 0,
        userId: order.user_id,
        merchantId: order.merchant_id,
        previousStatus: 'disputed',
      });

      totalDisputeAutoResolves++;
      logger.info('[UnhappyPath] Dispute auto-resolved', {
        orderId: order.id, orderNumber: order.order_number, refundTo,
      });
    } catch (err) {
      logger.error('[UnhappyPath] Error auto-resolving dispute', {
        orderId: order.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return rows.length;
}

// ────────────────────────────────────────────────
// MAIN POLL LOOP
// ────────────────────────────────────────────────
async function processBatch(): Promise<void> {
  try {
    const warnings = await processInactivityWarnings();
    const escalations = await processInactivityEscalations();
    const autoResolves = await processDisputeAutoResolves();

    consecutiveErrors = 0;
    writeHeartbeat(warnings + escalations + autoResolves);
  } catch (error) {
    consecutiveErrors++;
    const backoff = Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
    logger.error('[UnhappyPath] Batch error', {
      consecutiveErrors,
      backoffMs: backoff,
      error: error instanceof Error ? error.message : String(error),
    });
    await new Promise(resolve => setTimeout(resolve, backoff - POLL_INTERVAL_MS));
  }
}

function writeHeartbeat(batchSize: number): void {
  try {
    writeFileSync('/tmp/bm-worker-unhappy-path.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      totalWarnings,
      totalEscalations,
      totalDisputeAutoResolves,
      lastBatchSize: batchSize,
    }));
  } catch { /* non-critical */ }
}

export function startUnhappyPathWorker(): void {
  if (isRunning) {
    logger.warn('[UnhappyPath] Worker already running');
    return;
  }

  isRunning = true;
  logger.info('[UnhappyPath] Starting unhappy path worker', {
    pollInterval: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  const poll = async () => {
    if (!isRunning) return;
    await processBatch();
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

export function stopUnhappyPathWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[UnhappyPath] Stopped unhappy path worker');
}

// Standalone entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startUnhappyPathWorker();

  process.on('SIGINT', () => {
    stopUnhappyPathWorker();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopUnhappyPathWorker();
    process.exit(0);
  });
}
