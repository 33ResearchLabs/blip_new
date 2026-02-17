/**
 * Corridor Settlement — Atomic sAED lock, transfer, and refund
 *
 * lockBuyerSaed: Lock buyer's sAED when accepting with corridor payment
 * atomicCorridorSettlement: Transfer sAED to LP on order completion (runs inside caller's TX)
 * refundBuyerSaed: Return locked sAED on cancellation (runs inside caller's TX)
 */

import { transaction } from '@/lib/db';
import { createTransactionInTx } from '@/lib/db/repositories/transactions';
import { logger } from '@/lib/logger';

type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export interface SaedLockResult {
  success: boolean;
  saedLocked?: number;
  corridorFee?: number;
  error?: string;
}

/**
 * Lock buyer's sAED when they accept an order via corridor bridge.
 * Total locked = fiat amount in fils + corridor fee in fils.
 * Runs in its own transaction.
 */
export async function lockBuyerSaed(
  buyerMerchantId: string,
  orderId: string,
  fiatAmountAed: number,
  corridorFeePercentage: number,
): Promise<SaedLockResult> {
  try {
    const result = await transaction(async (client) => {
      // 1. Lock buyer row
      const buyerResult = await client.query(
        'SELECT sinr_balance FROM merchants WHERE id = $1 FOR UPDATE',
        [buyerMerchantId]
      );
      if (buyerResult.rows.length === 0) throw new Error('BUYER_NOT_FOUND');

      const currentSaed = parseInt(String(buyerResult.rows[0].sinr_balance));

      // 2. Calculate amounts
      const fiatFils = Math.round(fiatAmountAed * 100); // AED to fils
      const corridorFeeFils = Math.round(fiatFils * corridorFeePercentage / 100);
      const totalLock = fiatFils + corridorFeeFils;

      // 3. Validate balance
      if (currentSaed < totalLock) {
        throw new Error('INSUFFICIENT_SAED');
      }

      // 4. Deduct sAED
      await client.query(
        'UPDATE merchants SET sinr_balance = sinr_balance - $1 WHERE id = $2',
        [totalLock, buyerMerchantId]
      );

      const balanceAfter = currentSaed - totalLock;

      // 5. Ledger entry
      await client.query(
        `INSERT INTO ledger_entries
         (account_type, account_id, entry_type, amount, asset,
          related_order_id, description, metadata, balance_before, balance_after)
         VALUES ('merchant', $1, 'CORRIDOR_SAED_LOCK', $2, 'sAED', $3, $4, $5, $6, $7)`,
        [
          buyerMerchantId,
          -totalLock,
          orderId,
          `Corridor sAED lock: ${totalLock} fils (${fiatAmountAed} AED + ${corridorFeeFils} fils fee)`,
          JSON.stringify({ fiat_fils: fiatFils, fee_fils: corridorFeeFils, fee_pct: corridorFeePercentage }),
          currentSaed,
          balanceAfter,
        ]
      );

      // 6. Transaction log
      await createTransactionInTx(client, {
        merchant_id: buyerMerchantId,
        order_id: orderId,
        type: 'synthetic_conversion',
        amount: -totalLock,
        description: `Corridor sAED lock for order`,
      });

      logger.info('[Corridor] Buyer sAED locked', {
        buyerMerchantId, orderId, totalLock, fiatFils, corridorFeeFils,
        balanceBefore: currentSaed, balanceAfter,
      });

      return { saedLocked: totalLock, corridorFee: corridorFeeFils };
    });

    return { success: true, ...result };
  } catch (error) {
    const msg = (error as Error).message;
    if (msg === 'BUYER_NOT_FOUND') return { success: false, error: 'Buyer merchant not found' };
    if (msg === 'INSUFFICIENT_SAED') return { success: false, error: 'Insufficient sAED balance' };
    logger.error('[Corridor] Lock sAED failed', { buyerMerchantId, orderId, error: msg });
    return { success: false, error: `Failed to lock sAED: ${msg}` };
  }
}

/**
 * Transfer locked sAED to LP on order completion.
 * MUST be called inside the caller's transaction (receives client).
 */
export async function atomicCorridorSettlement(
  client: TxClient,
  orderId: string,
  fulfillmentId: string,
): Promise<void> {
  // 1. Lock fulfillment row
  const ffResult = await client.query(
    'SELECT * FROM corridor_fulfillments WHERE id = $1 FOR UPDATE',
    [fulfillmentId]
  );
  if (ffResult.rows.length === 0) throw new Error('FULFILLMENT_NOT_FOUND');

  const ff = ffResult.rows[0] as Record<string, unknown>;
  if (ff.provider_status === 'completed') return; // idempotent

  const saedAmount = parseInt(String(ff.saed_amount_locked));
  const corridorFee = parseInt(String(ff.corridor_fee));
  const providerMerchantId = ff.provider_merchant_id as string;
  const providerId = ff.provider_id as string;
  const fiatAmount = parseFloat(String(ff.fiat_amount));

  // 2. Lock LP row and credit sAED
  const lpResult = await client.query(
    'SELECT sinr_balance FROM merchants WHERE id = $1 FOR UPDATE',
    [providerMerchantId]
  );
  if (lpResult.rows.length === 0) throw new Error('LP_NOT_FOUND');

  const lpBalanceBefore = parseInt(String(lpResult.rows[0].sinr_balance));

  await client.query(
    'UPDATE merchants SET sinr_balance = sinr_balance + $1 WHERE id = $2',
    [saedAmount, providerMerchantId]
  );

  const lpBalanceAfter = lpBalanceBefore + saedAmount;

  // 3. Update fulfillment status
  await client.query(
    `UPDATE corridor_fulfillments
     SET provider_status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [fulfillmentId]
  );

  // 4. Ledger entry: sAED transfer to LP
  await client.query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset,
      related_order_id, description, metadata, balance_before, balance_after)
     VALUES ('merchant', $1, 'CORRIDOR_SAED_TRANSFER', $2, 'sAED', $3, $4, $5, $6, $7)`,
    [
      providerMerchantId,
      saedAmount,
      orderId,
      `Corridor LP payout: ${saedAmount} fils (incl ${corridorFee} fils fee)`,
      JSON.stringify({ total_saed: saedAmount, fee_fils: corridorFee, fiat_amount: fiatAmount }),
      lpBalanceBefore,
      lpBalanceAfter,
    ]
  );

  // 5. Transaction log for LP
  await createTransactionInTx(client, {
    merchant_id: providerMerchantId,
    order_id: orderId,
    type: 'synthetic_conversion',
    amount: saedAmount,
    description: `Corridor LP payout (${corridorFee} fils fee earned)`,
  });

  // 6. Update provider stats
  const assignedAt = new Date(ff.assigned_at as string).getTime();
  const fulfillmentTimeSec = Math.floor((Date.now() - assignedAt) / 1000);

  await client.query(
    `UPDATE corridor_providers
     SET total_fulfillments = total_fulfillments + 1,
         total_volume = total_volume + $1,
         avg_fulfillment_time_sec = CASE
           WHEN avg_fulfillment_time_sec IS NULL THEN $2
           ELSE (avg_fulfillment_time_sec + $2) / 2
         END,
         last_fulfillment_at = NOW(),
         updated_at = NOW()
     WHERE id = $3`,
    [fiatAmount, fulfillmentTimeSec, providerId]
  );

  logger.info('[Corridor] Settlement complete', {
    orderId, fulfillmentId, providerMerchantId,
    saedTransferred: saedAmount, corridorFee, fiatAmount,
  });
}

/**
 * Refund locked sAED to buyer on order cancellation.
 * MUST be called inside the caller's transaction (receives client).
 */
export async function refundBuyerSaed(
  client: TxClient,
  orderId: string,
  fulfillmentId: string,
): Promise<void> {
  // 1. Lock fulfillment
  const ffResult = await client.query(
    'SELECT * FROM corridor_fulfillments WHERE id = $1 FOR UPDATE',
    [fulfillmentId]
  );
  if (ffResult.rows.length === 0) return; // nothing to refund

  const ff = ffResult.rows[0] as Record<string, unknown>;
  if (ff.provider_status === 'cancelled' || ff.provider_status === 'completed') return; // already handled

  const saedAmount = parseInt(String(ff.saed_amount_locked));

  // 2. Find buyer from the order
  const orderResult = await client.query(
    'SELECT buyer_merchant_id FROM orders WHERE id = $1',
    [orderId]
  );
  const buyerMerchantId = orderResult.rows[0]?.buyer_merchant_id as string;
  if (!buyerMerchantId) throw new Error('NO_BUYER_MERCHANT');

  // 3. Credit buyer's sAED back
  const buyerResult = await client.query(
    'SELECT sinr_balance FROM merchants WHERE id = $1 FOR UPDATE',
    [buyerMerchantId]
  );
  const balanceBefore = parseInt(String(buyerResult.rows[0]?.sinr_balance ?? 0));

  await client.query(
    'UPDATE merchants SET sinr_balance = sinr_balance + $1 WHERE id = $2',
    [saedAmount, buyerMerchantId]
  );

  const balanceAfter = balanceBefore + saedAmount;

  // 4. Mark fulfillment cancelled
  await client.query(
    `UPDATE corridor_fulfillments
     SET provider_status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [fulfillmentId]
  );

  // 5. Ledger entry
  await client.query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset,
      related_order_id, description, metadata, balance_before, balance_after)
     VALUES ('merchant', $1, 'CORRIDOR_SAED_TRANSFER', $2, 'sAED', $3, $4, $5, $6, $7)`,
    [
      buyerMerchantId,
      saedAmount,
      orderId,
      `Corridor sAED refund: ${saedAmount} fils`,
      JSON.stringify({ refund: true }),
      balanceBefore,
      balanceAfter,
    ]
  );

  // 6. Transaction log
  await createTransactionInTx(client, {
    merchant_id: buyerMerchantId,
    order_id: orderId,
    type: 'synthetic_conversion',
    amount: saedAmount,
    description: `Corridor sAED refund`,
  });

  logger.info('[Corridor] Buyer sAED refunded', {
    orderId, fulfillmentId, buyerMerchantId, saedRefunded: saedAmount,
  });
}
