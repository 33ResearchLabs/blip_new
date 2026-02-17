/**
 * Corridor Timeout Worker
 *
 * Runs every 60s. Finds overdue fulfillments (pending past send_deadline)
 * and marks them as failed. In the future, could try replacement LP or
 * auto-refund buyer sAED.
 *
 * Currently: mark failed + notify order parties
 */

import { transaction, logger } from 'settlement-core';

const POLL_INTERVAL_MS = parseInt(process.env.CORRIDOR_POLL_MS || '60000', 10);

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

async function processOverdueFulfillments(): Promise<number> {
  try {
    const count = await transaction(async (client: PgClient) => {
      // Find overdue pending fulfillments
      const result = await client.query(
        `SELECT cf.*, o.buyer_merchant_id
         FROM corridor_fulfillments cf
         JOIN orders o ON cf.order_id = o.id
         WHERE cf.provider_status = 'pending'
           AND cf.send_deadline < NOW()
         FOR UPDATE OF cf
         LIMIT 10`
      );

      if (result.rows.length === 0) return 0;

      let processed = 0;

      for (const row of result.rows) {
        const ff = row as Record<string, unknown>;
        const fulfillmentId = ff.id as string;
        const orderId = ff.order_id as string;
        const providerMerchantId = ff.provider_merchant_id as string;
        const buyerMerchantId = ff.buyer_merchant_id as string;
        const saedAmount = parseInt(String(ff.saed_amount_locked));

        // Mark fulfillment as failed
        await client.query(
          `UPDATE corridor_fulfillments
           SET provider_status = 'failed', failed_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [fulfillmentId]
        );

        // Refund buyer's sAED
        if (buyerMerchantId && saedAmount > 0) {
          await client.query(
            'UPDATE merchants SET sinr_balance = sinr_balance + $1 WHERE id = $2',
            [saedAmount, buyerMerchantId]
          );

          // Ledger entry for refund
          await client.query(
            `INSERT INTO ledger_entries
             (account_type, account_id, entry_type, amount, asset,
              related_order_id, description, metadata, balance_before, balance_after)
             SELECT 'merchant', $1, 'CORRIDOR_SAED_TRANSFER', $2, 'sAED', $3,
                    'Corridor timeout sAED refund: ' || $2 || ' fils',
                    $4::jsonb, sinr_balance - $2, sinr_balance
             FROM merchants WHERE id = $1`,
            [
              buyerMerchantId,
              saedAmount,
              orderId,
              JSON.stringify({ refund: true, reason: 'LP_TIMEOUT' }),
            ]
          );
        }

        // Clear corridor link on order (revert to bank payment)
        await client.query(
          `UPDATE orders
           SET payment_via = 'bank', corridor_fulfillment_id = NULL
           WHERE id = $1 AND corridor_fulfillment_id = $2`,
          [orderId, fulfillmentId]
        );

        // Notify about the timeout
        await client.query(
          `INSERT INTO notification_outbox
           (order_id, event_type, merchant_id, payload)
           VALUES ($1, 'CORRIDOR_TIMEOUT', $2, $3)`,
          [
            orderId,
            providerMerchantId,
            JSON.stringify({
              fulfillment_id: fulfillmentId,
              reason: 'LP failed to send payment before deadline',
            }),
          ]
        );

        logger.info('[CorridorTimeout] Fulfillment timed out, sAED refunded', {
          fulfillmentId, orderId, providerMerchantId, buyerMerchantId, saedAmount,
        });

        processed++;
      }

      return processed;
    });

    return count;
  } catch (error) {
    logger.error('[CorridorTimeout] Error processing overdue fulfillments', { error });
    return 0;
  }
}

async function tick() {
  if (!isRunning) return;

  const count = await processOverdueFulfillments();
  if (count > 0) {
    logger.info(`[CorridorTimeout] Processed ${count} overdue fulfillments`);
  }

  if (isRunning) {
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  }
}

export function startCorridorTimeoutWorker() {
  if (isRunning) return;
  isRunning = true;
  logger.info(`[CorridorTimeout] Worker started (poll every ${POLL_INTERVAL_MS}ms)`);
  // First tick after a short delay
  pollTimer = setTimeout(tick, 5000);
}

export function stopCorridorTimeoutWorker() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[CorridorTimeout] Worker stopped');
}
