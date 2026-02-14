/**
 * GET /api/admin/reconciliation
 *
 * Compares merchants.balance against the derived sum of ledger_entries
 * for each merchant. Reports mismatches so operators can investigate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

export async function GET(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const results = await query<{
      merchant_id: string;
      display_name: string;
      db_balance: number;
      ledger_sum: number;
      tx_sum: number;
      drift_ledger: number;
      drift_tx: number;
      status: string;
    }>(`
      SELECT
        m.id as merchant_id,
        m.display_name,
        m.balance as db_balance,
        COALESCE(le.ledger_sum, 0) as ledger_sum,
        COALESCE(tx.tx_sum, 0) as tx_sum,
        ABS(m.balance - COALESCE(le.ledger_sum, 0)) as drift_ledger,
        ABS(m.balance - COALESCE(tx.tx_sum, 0)) as drift_tx,
        CASE
          WHEN ABS(m.balance - COALESCE(le.ledger_sum, 0)) > 0.01 THEN 'MISMATCH'
          ELSE 'OK'
        END as status
      FROM merchants m
      LEFT JOIN (
        SELECT account_id, SUM(amount) as ledger_sum
        FROM ledger_entries
        WHERE account_type = 'merchant'
        GROUP BY account_id
      ) le ON le.account_id = m.id
      LEFT JOIN (
        SELECT merchant_id, SUM(amount) as tx_sum
        FROM merchant_transactions
        WHERE merchant_id IS NOT NULL
        GROUP BY merchant_id
      ) tx ON tx.merchant_id = m.id
      WHERE m.balance != 0 OR le.ledger_sum IS NOT NULL OR tx.tx_sum IS NOT NULL
      ORDER BY drift_ledger DESC
    `);

    const mismatches = results.filter((r) => r.status === 'MISMATCH');

    // Also check users
    const userResults = await query<{
      user_id: string;
      username: string;
      db_balance: number;
      ledger_sum: number;
      drift: number;
      status: string;
    }>(`
      SELECT
        u.id as user_id,
        u.username,
        u.balance as db_balance,
        COALESCE(le.ledger_sum, 0) as ledger_sum,
        ABS(u.balance - COALESCE(le.ledger_sum, 0)) as drift,
        CASE
          WHEN ABS(u.balance - COALESCE(le.ledger_sum, 0)) > 0.01 THEN 'MISMATCH'
          ELSE 'OK'
        END as status
      FROM users u
      LEFT JOIN (
        SELECT account_id, SUM(amount) as ledger_sum
        FROM ledger_entries
        WHERE account_type = 'user'
        GROUP BY account_id
      ) le ON le.account_id = u.id
      WHERE u.balance != 0 OR le.ledger_sum IS NOT NULL
      ORDER BY drift DESC
    `);

    const userMismatches = userResults.filter((r) => r.status === 'MISMATCH');

    return NextResponse.json({
      success: true,
      data: {
        merchants: {
          total: results.length,
          mismatches: mismatches.length,
          details: results,
        },
        users: {
          total: userResults.length,
          mismatches: userMismatches.length,
          details: userResults,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Reconciliation failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
