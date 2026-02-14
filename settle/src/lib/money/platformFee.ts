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
  const payerType = order.escrow_debited_entity_type || 'merchant';
  const payerId = order.escrow_debited_entity_id || order.merchant_id;
  const payerTable = payerType === 'merchant' ? 'merchants' : 'users';

  // Deduct fee from seller's balance
  await client.query(
    `UPDATE ${payerTable} SET balance = balance - $1 WHERE id = $2`,
    [feeAmount, payerId]
  );

  // Credit platform_balance
  const platformResult = await client.query(
    `UPDATE platform_balance
     SET balance = balance + $1,
         total_fees_collected = total_fees_collected + $1,
         updated_at = NOW()
     WHERE key = 'main'
     RETURNING balance`,
    [feeAmount]
  );

  const platformBalanceAfter = parseFloat(String(platformResult.rows[0]?.balance || 0));

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
