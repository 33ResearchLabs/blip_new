/**
 * Payment Deadline & Dispute Auto-Resolve Worker
 *
 * Two jobs in one worker:
 *
 * 1. Payment Deadline Expiry:
 *    Moves orders stuck in 'payment_sent' past their payment_deadline to 'disputed'.
 *    Prevents orders from staying in payment_sent forever.
 *
 * 2. Dispute Auto-Resolve:
 *    Auto-cancels orders that have been in 'disputed' past their dispute_auto_resolve_at.
 *    Prevents disputes from stalling indefinitely — escrow is refunded to seller.
 *
 * Distribution-safe: uses FOR UPDATE SKIP LOCKED inside a transaction
 * so multiple worker instances never process the same orders.
 */

import { transaction } from '@/lib/db';
import { logger } from '@/lib/logger';
import { invalidateOrderCache } from '@/lib/cache';

const WORKER_INTERVAL_MS = 30000; // Check every 30 seconds
const BATCH_SIZE = 20;

// ── Job 1: Payment deadline → auto-dispute ──────────────────────────────

async function processDeadlineExpiries(): Promise<void> {
  try {
    const expired = await transaction(async (client) => {
      // Claim overdue payment_sent orders with SKIP LOCKED
      const lockResult = await client.query(
        `SELECT id, order_version, user_id, merchant_id, buyer_merchant_id,
                order_number, crypto_amount, crypto_currency, fiat_amount, fiat_currency, type
         FROM orders
         WHERE status = 'payment_sent'
           AND payment_deadline IS NOT NULL
           AND payment_deadline < NOW()
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [BATCH_SIZE]
      );

      if (lockResult.rows.length === 0) {
        return [];
      }

      const results: string[] = [];

      for (const order of lockResult.rows) {
        // Move to disputed with version + status guard
        const updateResult = await client.query(
          `UPDATE orders
           SET status = 'disputed',
               disputed_at = NOW(),
               dispute_auto_resolve_at = NOW() + INTERVAL '24 hours',
               order_version = order_version + 1
           WHERE id = $1
             AND order_version = $2
             AND status = 'payment_sent'
             AND status NOT IN ('completed', 'cancelled', 'expired')
           RETURNING id`,
          [order.id, order.order_version]
        );

        if (updateResult.rows.length === 0) {
          logger.warn('[PaymentDeadline] Skipped order (concurrent update)', { orderId: order.id });
          continue;
        }

        // Create audit event
        await client.query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'payment_deadline_expired', 'system', $1, 'payment_sent', 'disputed', $2)`,
          [
            order.id,
            JSON.stringify({ reason: 'Payment deadline exceeded', auto_disputed: true }),
          ]
        );

        // Queue notification
        await client.query(
          `INSERT INTO notification_outbox (event_type, order_id, payload)
           VALUES ('ORDER_DISPUTED', $1, $2)`,
          [
            order.id,
            JSON.stringify({
              orderId: order.id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              buyerMerchantId: order.buyer_merchant_id,
              status: 'disputed',
              previousStatus: 'payment_sent',
              orderNumber: order.order_number,
              cryptoAmount: order.crypto_amount,
              cryptoCurrency: order.crypto_currency,
              fiatAmount: order.fiat_amount,
              fiatCurrency: order.fiat_currency,
              orderType: order.type,
              reason: 'Payment deadline exceeded',
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        // System chat message
        await client.query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
           VALUES ($1, 'system', $1, $2, 'system')`,
          [
            order.id,
            '⚠️ Payment deadline has passed. Order moved to dispute for review. If you have sent the payment, please share proof in the chat.',
          ]
        );

        // Invalidate cache
        invalidateOrderCache(order.id);

        results.push(order.id);
      }

      return results;
    });

    if (expired.length > 0) {
      logger.info('[PaymentDeadline] Expired orders moved to disputed', {
        count: expired.length,
        orderIds: expired,
      });
    }
  } catch (error) {
    logger.error('[PaymentDeadline] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Job 2: Dispute auto-resolve → auto-cancel with refund ───────────────

async function processDisputeAutoResolve(): Promise<void> {
  try {
    const resolved = await transaction(async (client) => {
      // Claim disputed orders past their auto-resolve deadline
      const lockResult = await client.query(
        `SELECT id, order_version, user_id, merchant_id, buyer_merchant_id,
                order_number, crypto_amount, crypto_currency, fiat_amount, fiat_currency, type
         FROM orders
         WHERE status = 'disputed'
           AND dispute_auto_resolve_at IS NOT NULL
           AND dispute_auto_resolve_at < NOW()
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [BATCH_SIZE]
      );

      if (lockResult.rows.length === 0) {
        return [];
      }

      const results: string[] = [];

      for (const order of lockResult.rows) {
        // Auto-cancel — escrow refund handled by atomicCancelWithRefund called separately
        // Here we just transition to cancelled for unresolved disputes
        const updateResult = await client.query(
          `UPDATE orders
           SET status = 'cancelled',
               cancelled_at = NOW(),
               cancelled_by = 'system',
               cancellation_reason = 'Dispute auto-resolved: no resolution within 24 hours. Escrow refunded to seller.',
               order_version = order_version + 1
           WHERE id = $1
             AND order_version = $2
             AND status = 'disputed'
           RETURNING id`,
          [order.id, order.order_version]
        );

        if (updateResult.rows.length === 0) {
          logger.warn('[DisputeAutoResolve] Skipped order (concurrent update)', { orderId: order.id });
          continue;
        }

        // Create audit event
        await client.query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'dispute_auto_resolved', 'system', $1, 'disputed', 'cancelled', $2)`,
          [
            order.id,
            JSON.stringify({
              reason: 'Dispute auto-resolved after 24 hours',
              auto_cancelled: true,
            }),
          ]
        );

        // Queue notification
        await client.query(
          `INSERT INTO notification_outbox (event_type, order_id, payload)
           VALUES ('ORDER_CANCELLED', $1, $2)`,
          [
            order.id,
            JSON.stringify({
              orderId: order.id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              buyerMerchantId: order.buyer_merchant_id,
              status: 'cancelled',
              previousStatus: 'disputed',
              orderNumber: order.order_number,
              reason: 'Dispute auto-resolved after 24 hours. Escrow refunded.',
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        // System chat message
        await client.query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
           VALUES ($1, 'system', $1, $2, 'system')`,
          [
            order.id,
            '⚠️ This dispute was not resolved within 24 hours. The order has been automatically cancelled and escrow will be refunded to the seller.',
          ]
        );

        // Invalidate cache
        invalidateOrderCache(order.id);

        results.push(order.id);
      }

      return results;
    });

    if (resolved.length > 0) {
      logger.info('[DisputeAutoResolve] Disputes auto-resolved (cancelled)', {
        count: resolved.length,
        orderIds: resolved,
      });
    }
  } catch (error) {
    logger.error('[DisputeAutoResolve] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Worker lifecycle ────────────────────────────────────────────────────

async function runCycle(): Promise<void> {
  await processDeadlineExpiries();
  await processDisputeAutoResolve();
}

async function start() {
  console.log('[payment-deadline] Worker started');
  console.log(`[payment-deadline] Checking every ${WORKER_INTERVAL_MS}ms`);
  console.log('[payment-deadline] Jobs: payment deadline expiry + dispute auto-resolve');

  // Initial run
  await runCycle();

  // Schedule periodic runs
  setInterval(runCycle, WORKER_INTERVAL_MS);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[payment-deadline] Worker shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[payment-deadline] Worker shutting down');
  process.exit(0);
});

// Start worker if run directly
if (require.main === module) {
  start().catch((error) => {
    console.error('[payment-deadline] Failed to start worker:', error);
    process.exit(1);
  });
}

export { start, processDeadlineExpiries, processDisputeAutoResolve };
