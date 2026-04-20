/**
 * Platform Fee Deduction — on order completion
 *
 * Deducts the protocol fee from the seller's balance, credits the
 * platform_balance, and records in platform_fee_transactions +
 * merchant_transactions — all within the existing DB transaction.
 */

import { createTransactionInTx } from '@/lib/db/repositories/transactions';
import { logger } from '@/lib/logger';

interface DeductFeeOrder {
  id: string;
  order_number: string;
  type: 'buy' | 'sell';
  crypto_amount: number;
  protocol_fee_percentage: number | null;
  spread_preference: string | null;
  escrow_debited_entity_type: 'merchant' | 'user' | null;
  escrow_debited_entity_id: string | null;
  merchant_id: string;
}

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Deduct platform fee on order completion.
 * Called inside the same DB transaction as the status update to 'completed'.
 */
export async function deductPlatformFee(
  client: PgClient,
  order: DeductFeeOrder
): Promise<{ feeAmount: number; feePercentage: number }> {
  const feePercentage = order.protocol_fee_percentage ?? 2.50;
  const feeAmount = order.crypto_amount * feePercentage / 100;

  if (feeAmount <= 0) {
    return { feeAmount: 0, feePercentage };
  }

  // Determine who pays the fee (seller = whoever locked escrow)
  // Fallback uses order structure if escrow tracking fields are missing
  let fallbackPayerType: 'merchant' | 'user' = 'merchant';
  let fallbackPayerId = order.merchant_id;
  if (!order.escrow_debited_entity_id) {
    if (order.type === 'sell' && !('buyer_merchant_id' in order && (order as any).buyer_merchant_id)) {
      // User sell: user is the seller
      fallbackPayerType = 'user';
      fallbackPayerId = (order as any).user_id || order.merchant_id;
    }
  }
  const payerType = order.escrow_debited_entity_type || fallbackPayerType;
  const payerId = order.escrow_debited_entity_id || fallbackPayerId;
  const payerTable = payerType === 'merchant' ? 'merchants' : 'users';

  // Deduct fee from seller's balance
  await client.query(
    `UPDATE ${payerTable} SET balance = balance - $1 WHERE id = $2`,
    [feeAmount, payerId]
  );

  // Credit platform_balance — atomic upsert so a missing 'main' row
  // (fresh install, dropped row) doesn't silently swallow the fee, and
  // concurrent increments from two parallel order completions both
  // serialize via the row lock inside the UPDATE expression. The
  // `RETURNING balance` comes back as the post-increment value regardless
  // of whether this was an INSERT or an UPDATE.
  const platformResult = await client.query(
    `INSERT INTO platform_balance (key, balance, total_fees_collected, updated_at)
     VALUES ('main', $1, $1, NOW())
     ON CONFLICT (key) DO UPDATE
       SET balance = platform_balance.balance + EXCLUDED.balance,
           total_fees_collected = platform_balance.total_fees_collected + EXCLUDED.total_fees_collected,
           updated_at = NOW()
     RETURNING balance`,
    [feeAmount]
  );

  if (platformResult.rows.length === 0) {
    // This branch is unreachable in normal operation — ON CONFLICT DO
    // UPDATE always returns the row. Guard keeps the invariant loud if
    // someone later changes the conflict target to ON CONFLICT DO NOTHING.
    throw new Error('[PlatformFee] platform_balance upsert returned no row — invariant broken');
  }
  const platformBalanceAfter = parseFloat(String(platformResult.rows[0]?.balance));

  // Insert platform_fee_transactions record
  await client.query(
    `INSERT INTO platform_fee_transactions
     (order_id, fee_amount, fee_percentage, spread_preference, platform_balance_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      order.id,
      feeAmount,
      feePercentage,
      order.spread_preference || 'fastest',
      platformBalanceAfter,
    ]
  );

  // Insert merchant_transactions record for the fee
  await createTransactionInTx(client, {
    ...(payerType === 'merchant'
      ? { merchant_id: payerId }
      : { user_id: payerId }),
    order_id: order.id,
    type: 'fee_deduction',
    amount: -feeAmount,
    description: `Platform fee (${feePercentage}%) for order #${order.order_number}`,
  });

  logger.info('[PlatformFee] Fee deducted on completion', {
    orderId: order.id,
    payerType,
    payerId,
    feeAmount,
    feePercentage,
    platformBalanceAfter,
  });

  return { feeAmount, feePercentage };
}
