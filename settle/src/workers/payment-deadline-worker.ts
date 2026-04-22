/**
 * Payment Deadline, Escrow Expiry, Dispute Auto-Resolve & On-Chain Refund Worker
 *
 * Four jobs in one worker:
 *
 * 1. Payment Deadline Expiry:
 *    Moves orders stuck in 'payment_sent' past their payment_deadline to 'disputed'.
 *
 * 2. Escrow Expiry (FUND SAFETY):
 *    Auto-cancels + refunds orders in 'escrowed' past their expires_at.
 *    Prevents funds from being locked indefinitely when both parties go inactive.
 *
 * 3. Dispute Auto-Resolve:
 *    Auto-cancels + refunds orders in 'disputed' past their dispute_auto_resolve_at.
 *
 * 4. Stuck On-Chain Escrow Refund (FUND SAFETY):
 *    For orders that expired/cancelled with USDT still locked on-chain,
 *    auto-submits a refundEscrow transaction using the backend signer.
 *    Requires BACKEND_SIGNER_KEYPAIR env var.
 *
 * Distribution-safe: uses FOR UPDATE SKIP LOCKED inside a transaction
 * so multiple worker instances never process the same orders.
 */

import { transaction } from '@/lib/db';
import { logger } from '@/lib/logger';
import { invalidateOrderCache } from '@/lib/cache';
import { atomicCancelWithRefund } from '@/lib/orders/atomicCancel';

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

// ── Job 1b: Pending expiry → expired (no escrow involved) ───────────────
//
// Mirrors the /v1/orders/expire cron behaviour for the simple pending case
// so the worker is self-sufficient and we don't depend on an external cron
// hitting the endpoint. Only handles the pending → expired transition; the
// 120-min accepted/escrowed timeout is still left to the cron route since
// it overlaps with our escrow-expiry + payment-deadline jobs below.

async function processPendingExpiries(): Promise<void> {
  try {
    const { query } = await import('@/lib/db');
    const pendingRows = await query<{
      id: string;
      user_id: string;
      merchant_id: string;
      buyer_merchant_id: string | null;
      order_number: string;
      type: string;
      order_version: number;
    }>(
      `SELECT id, user_id, merchant_id, buyer_merchant_id, order_number, type, order_version
       FROM orders
       WHERE status = 'pending'
         AND payment_sent_at IS NULL
         AND created_at < NOW() - INTERVAL '15 minutes'
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (pendingRows.length === 0) return;

    let expiredCount = 0;

    for (const order of pendingRows) {
      try {
        // Status + version guard prevents racing with a concurrent ACCEPT.
        const updateResult = await transaction(async (client) => {
          const upd = await client.query(
            `UPDATE orders
             SET status = 'expired',
                 cancelled_at = NOW(),
                 cancelled_by = 'system',
                 cancellation_reason = 'Order expired - no one accepted within 15 minutes',
                 order_version = order_version + 1
             WHERE id = $1
               AND status = 'pending'
               AND order_version = $2
             RETURNING id`,
            [order.id, order.order_version]
          );
          if (upd.rows.length === 0) return false;

          await client.query(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'pending_expired', 'system', $1, 'pending', 'expired', $2)`,
            [
              order.id,
              JSON.stringify({ reason: 'Order expired - no merchant accepted', auto_expired: true }),
            ]
          );

          await client.query(
            `INSERT INTO notification_outbox (event_type, order_id, payload)
             VALUES ('ORDER_EXPIRED', $1, $2)`,
            [
              order.id,
              JSON.stringify({
                orderId: order.id,
                userId: order.user_id,
                merchantId: order.merchant_id,
                buyerMerchantId: order.buyer_merchant_id,
                status: 'expired',
                previousStatus: 'pending',
                orderNumber: order.order_number,
                orderType: order.type,
                reason: 'Order expired - no merchant accepted',
                updatedAt: new Date().toISOString(),
              }),
            ]
          );

          return true;
        });

        if (updateResult) {
          invalidateOrderCache(order.id);
          expiredCount++;
        }
      } catch (orderErr) {
        logger.error('[PendingExpiry] Failed to expire order', {
          orderId: order.id,
          error: orderErr instanceof Error ? orderErr.message : String(orderErr),
        });
      }
    }

    if (expiredCount > 0) {
      logger.info('[PendingExpiry] Pending orders expired', {
        count: expiredCount,
        total: pendingRows.length,
      });
    }
  } catch (error) {
    logger.error('[PendingExpiry] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Job 2: Escrow expiry → auto-cancel with refund (FUND SAFETY) ──────

async function processEscrowExpiries(): Promise<void> {
  try {
    // Find escrowed orders past their expires_at
    const { query } = await import('@/lib/db');
    const expiredRows = await query<{
      id: string; status: string; user_id: string; merchant_id: string;
      buyer_merchant_id: string | null; order_number: number;
      crypto_amount: number; crypto_currency: string;
      fiat_amount: number; fiat_currency: string; type: string;
    }>(
      `SELECT id, status, user_id, merchant_id, buyer_merchant_id,
              order_number, crypto_amount, crypto_currency, fiat_amount, fiat_currency, type
       FROM orders
       WHERE status = 'escrowed'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (expiredRows.length === 0) return;

    let refundedCount = 0;

    for (const order of expiredRows) {
      try {
        const result = await atomicCancelWithRefund(
          order.id,
          order.status,
          'system' as any,
          'system',
          'Escrow expired: no payment within time limit. Funds refunded.',
          {
            type: order.type as 'buy' | 'sell',
            crypto_amount: order.crypto_amount,
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: order.order_number,
            crypto_currency: order.crypto_currency,
            fiat_amount: order.fiat_amount,
            fiat_currency: order.fiat_currency,
          }
        );

        if (result.success) {
          invalidateOrderCache(order.id);
          refundedCount++;
          logger.info('[EscrowExpiry] Order expired — cancelled with refund', {
            orderId: order.id,
            orderNumber: order.order_number,
            refundedAmount: order.crypto_amount,
          });
        } else {
          logger.warn('[EscrowExpiry] atomicCancel returned failure', {
            orderId: order.id,
            error: result.error,
          });
        }
      } catch (orderErr) {
        // Log but continue processing other orders
        logger.error('[EscrowExpiry] Failed to cancel expired order', {
          orderId: order.id,
          error: orderErr instanceof Error ? orderErr.message : String(orderErr),
        });
      }
    }

    if (refundedCount > 0) {
      logger.info('[EscrowExpiry] Expired escrowed orders refunded', {
        count: refundedCount,
        total: expiredRows.length,
      });
    }
  } catch (error) {
    logger.error('[EscrowExpiry] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Job 3: Dispute auto-resolve → auto-cancel with refund ─────────────

async function processDisputeAutoResolve(): Promise<void> {
  try {
    // Find disputed orders past their auto-resolve deadline
    const { query } = await import('@/lib/db');
    const expiredDisputes = await query<{
      id: string; status: string; user_id: string; merchant_id: string;
      buyer_merchant_id: string | null; order_number: number;
      crypto_amount: number; crypto_currency: string;
      fiat_amount: number; fiat_currency: string; type: string;
    }>(
      `SELECT id, status, user_id, merchant_id, buyer_merchant_id,
              order_number, crypto_amount, crypto_currency, fiat_amount, fiat_currency, type
       FROM orders
       WHERE status = 'disputed'
         AND dispute_auto_resolve_at IS NOT NULL
         AND dispute_auto_resolve_at < NOW()
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (expiredDisputes.length === 0) return;

    let resolvedCount = 0;

    for (const order of expiredDisputes) {
      try {
        const result = await atomicCancelWithRefund(
          order.id,
          order.status,
          'system' as any,
          'system',
          'Dispute auto-resolved: no resolution within 24 hours. Escrow refunded to seller.',
          {
            type: order.type as 'buy' | 'sell',
            crypto_amount: order.crypto_amount,
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: order.order_number,
            crypto_currency: order.crypto_currency,
            fiat_amount: order.fiat_amount,
            fiat_currency: order.fiat_currency,
          }
        );

        if (result.success) {
          invalidateOrderCache(order.id);
          resolvedCount++;
          logger.info('[DisputeAutoResolve] Dispute auto-resolved with refund', {
            orderId: order.id,
            orderNumber: order.order_number,
          });
        } else {
          logger.warn('[DisputeAutoResolve] atomicCancel returned failure', {
            orderId: order.id,
            error: result.error,
          });
        }
      } catch (orderErr) {
        logger.error('[DisputeAutoResolve] Failed to auto-resolve dispute', {
          orderId: order.id,
          error: orderErr instanceof Error ? orderErr.message : String(orderErr),
        });
      }
    }

    if (resolvedCount > 0) {
      logger.info('[DisputeAutoResolve] Disputes auto-resolved', {
        count: resolvedCount,
        total: expiredDisputes.length,
      });
    }
  } catch (error) {
    logger.error('[DisputeAutoResolve] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Job 4: Stuck on-chain escrow refund (FUND SAFETY) ─────────────────

async function processStuckOnChainEscrows(): Promise<void> {
  try {
    const { query } = await import('@/lib/db');
    const { getBackendKeypair } = await import('@/lib/solana/backendSigner');

    // Skip if backend signer is not configured
    if (!getBackendKeypair()) return;

    // Find expired/cancelled/disputed orders that have on-chain escrow but
    // no refund tx recorded, AND whose backoff window has elapsed. Orders
    // that just failed get skipped until refund_retry_after passes — this
    // stops a single chronically-failing row from burning the whole batch
    // every 30s. See migration 107.
    const stuckOrders = await query<{
      id: string; order_number: string; status: string;
      escrow_creator_wallet: string; escrow_trade_id: string;
      refund_retry_count: number;
    }>(
      `SELECT id, order_number, status, escrow_creator_wallet, escrow_trade_id, refund_retry_count
       FROM orders
       WHERE status IN ('expired', 'cancelled', 'disputed')
         AND escrow_tx_hash IS NOT NULL
         AND release_tx_hash IS NULL
         AND escrow_creator_wallet IS NOT NULL
         AND escrow_trade_id IS NOT NULL
         AND (refund_retry_after IS NULL OR refund_retry_after <= NOW())
       ORDER BY refund_retry_after NULLS FIRST
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (stuckOrders.length === 0) return;

    const { refundEscrowFromBackend } = await import('@/lib/solana/backendRefund');

    let refundedCount = 0;

    for (const order of stuckOrders) {
      try {
        const result = await refundEscrowFromBackend(
          order.escrow_creator_wallet,
          Number(order.escrow_trade_id),
        );

        if (result.success && result.txHash) {
          // Record the refund tx hash + clear retry state.
          await query(
            `UPDATE orders
             SET release_tx_hash = $1,
                 refund_retry_after = NULL,
                 refund_last_error = NULL
             WHERE id = $2`,
            [result.txHash, order.id]
          );
          invalidateOrderCache(order.id);
          refundedCount++;

          logger.info('[OnChainRefund] Escrow refunded automatically', {
            orderId: order.id,
            orderNumber: order.order_number,
            txHash: result.txHash,
          });
        } else {
          // Exponential backoff: 30s * 2^count, capped at 1h.
          // count 0 →   30s, 1 →   60s, 2 →  2m, 3 →  4m,
          //       4 →    8m, 5 →  16m, 6 → 32m, 7+ → 60m.
          const nextCount = order.refund_retry_count + 1;
          const delaySeconds = Math.min(
            30 * Math.pow(2, order.refund_retry_count),
            3600,
          );
          await query(
            `UPDATE orders
             SET refund_retry_count = $1,
                 refund_retry_after = NOW() + ($2 || ' seconds')::INTERVAL,
                 refund_last_error  = $3
             WHERE id = $4`,
            [nextCount, String(delaySeconds), result.error || 'unknown', order.id]
          );
          logger.warn('[OnChainRefund] Auto-refund failed — backing off', {
            orderId: order.id,
            orderNumber: order.order_number,
            error: result.error,
            retryCount: nextCount,
            nextAttemptInSeconds: delaySeconds,
          });
        }
      } catch (orderErr) {
        // Thrown errors (e.g. Anchor IDL decode failures inside
        // `getBackendProgram`, malformed RPC responses) also need to
        // stamp backoff — otherwise the same row gets picked up again
        // every 30s and the whole batch thrashes.
        const errMsg =
          orderErr instanceof Error ? orderErr.message : String(orderErr);
        const nextCount = order.refund_retry_count + 1;
        const delaySeconds = Math.min(
          30 * Math.pow(2, order.refund_retry_count),
          3600,
        );
        try {
          await query(
            `UPDATE orders
             SET refund_retry_count = $1,
                 refund_retry_after = NOW() + ($2 || ' seconds')::INTERVAL,
                 refund_last_error  = $3
             WHERE id = $4`,
            [nextCount, String(delaySeconds), errMsg, order.id]
          );
        } catch (stampErr) {
          logger.error('[OnChainRefund] Failed to stamp backoff after throw', {
            orderId: order.id,
            error: stampErr instanceof Error ? stampErr.message : String(stampErr),
          });
        }
        logger.error('[OnChainRefund] Failed to process stuck escrow', {
          orderId: order.id,
          error: errMsg,
          retryCount: nextCount,
          nextAttemptInSeconds: delaySeconds,
        });
      }
    }

    if (refundedCount > 0) {
      logger.info('[OnChainRefund] Stuck escrows refunded', {
        count: refundedCount,
        total: stuckOrders.length,
      });
    }
  } catch (error) {
    logger.error('[OnChainRefund] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Worker lifecycle ────────────────────────────────────────────────────

async function runCycle(): Promise<void> {
  await processPendingExpiries();
  await processDeadlineExpiries();
  await processEscrowExpiries();
  await processDisputeAutoResolve();
  await processStuckOnChainEscrows();
}

async function start() {
  console.log('[payment-deadline] Worker started');
  console.log(`[payment-deadline] Checking every ${WORKER_INTERVAL_MS}ms`);
  console.log('[payment-deadline] Jobs: pending expiry + payment deadline expiry + escrow expiry + dispute auto-resolve + on-chain escrow refund');

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

export { start, processPendingExpiries, processDeadlineExpiries, processEscrowExpiries, processDisputeAutoResolve, processStuckOnChainEscrows };
