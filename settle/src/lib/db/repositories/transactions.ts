/**
 * Transaction Log Repository
 * Tracks all balance changes for merchants and users
 */

import { query } from '@/lib/db';
import { logger } from '@/lib/logger';

export type TransactionType =
  | 'escrow_lock'        // Balance deducted when locking escrow
  | 'escrow_release'     // Balance credited when escrow released
  | 'escrow_refund'      // Balance credited when escrow refunded
  | 'order_completed'    // Balance credited when order completed (without explicit release)
  | 'order_cancelled'    // Balance refunded when order cancelled
  | 'fee_deduction'      // Platform fee deducted on completion
  | 'manual_adjustment'; // Manual balance adjustment

export interface Transaction {
  id: string;
  merchant_id: string | null;
  user_id: string | null;
  order_id: string | null;
  type: TransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  created_at: Date;
}

export interface CreateTransactionInput {
  merchant_id?: string;
  user_id?: string;
  order_id?: string;
  type: TransactionType;
  amount: number; // Positive for credit, negative for debit
  description: string;
}

/**
 * Create a transaction log entry
 */
export async function createTransaction(data: CreateTransactionInput): Promise<Transaction> {
  const { merchant_id, user_id, order_id, type, amount, description } = data;

  // Get current balance - query() returns rows array directly
  let balanceBefore = 0;
  if (merchant_id) {
    const rows = await query<{ balance: number }>('SELECT balance FROM merchants WHERE id = $1', [merchant_id]);
    balanceBefore = parseFloat(String(rows[0]?.balance ?? 0));
  } else if (user_id) {
    const rows = await query<{ balance: number }>('SELECT balance FROM users WHERE id = $1', [user_id]);
    balanceBefore = parseFloat(String(rows[0]?.balance ?? 0));
  }

  const balanceAfter = balanceBefore + amount;

  // query() returns rows array directly (not the pg Result object)
  const rows = await query<Transaction>(
    `INSERT INTO merchant_transactions
     (merchant_id, user_id, order_id, type, amount, balance_before, balance_after, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [merchant_id || null, user_id || null, order_id || null, type, amount, balanceBefore, balanceAfter, description]
  );

  logger.info('Transaction logged', {
    id: rows[0].id,
    type,
    amount,
    merchantId: merchant_id,
    userId: user_id,
    orderId: order_id,
  });

  return rows[0];
}

/**
 * Get transaction history for a merchant
 */
export async function getMerchantTransactions(
  merchantId: string,
  limit: number = 50,
  offset: number = 0
): Promise<Transaction[]> {
  // query() returns rows array directly
  return query<Transaction>(
    `SELECT * FROM merchant_transactions
     WHERE merchant_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [merchantId, limit, offset]
  );
}

/**
 * Get transaction history for an order
 */
export async function getOrderTransactions(orderId: string): Promise<Transaction[]> {
  return query<Transaction>(
    `SELECT * FROM merchant_transactions
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [orderId]
  );
}

/**
 * Get merchant balance summary
 */
export async function getMerchantBalanceSummary(merchantId: string): Promise<{
  current_balance: number;
  total_credits: number;
  total_debits: number;
  total_transactions: number;
}> {
  // query() returns rows array directly
  const balanceRows = await query<{ balance: number }>(
    'SELECT balance FROM merchants WHERE id = $1::uuid',
    [merchantId]
  );

  const summaryRows = await query<{ total_credits: string; total_debits: string; total_transactions: string }>(
    `SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_credits,
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_debits,
      COUNT(*) as total_transactions
     FROM merchant_transactions
     WHERE merchant_id = $1::uuid`,
    [merchantId]
  );

  return {
    current_balance: parseFloat(String(balanceRows[0]?.balance ?? 0)),
    total_credits: parseFloat(summaryRows[0]?.total_credits || '0'),
    total_debits: parseFloat(summaryRows[0]?.total_debits || '0'),
    total_transactions: parseInt(summaryRows[0]?.total_transactions || '0'),
  };
}

/**
 * Create a transaction log entry inside an existing DB transaction.
 * Reads balance from the already-locked row to avoid stale reads.
 */
export async function createTransactionInTx(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  data: CreateTransactionInput
): Promise<void> {
  const { merchant_id, user_id, order_id, type, amount, description } = data;

  const table = merchant_id ? 'merchants' : 'users';
  const entityId = merchant_id || user_id;
  if (!entityId) return;

  const balanceResult = await client.query(
    `SELECT balance FROM ${table} WHERE id = $1`,
    [entityId]
  );
  const balanceBefore = parseFloat(String(balanceResult.rows[0]?.balance ?? 0));
  const balanceAfter = balanceBefore + amount;

  await client.query(
    `INSERT INTO merchant_transactions
     (merchant_id, user_id, order_id, type, amount, balance_before, balance_after, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [merchant_id || null, user_id || null, order_id || null, type, amount, balanceBefore, balanceAfter, description]
  );
}
