/**
 * GET /api/admin/reconciliation
 *
 * Comprehensive ledger reconciliation check (TASK 5).
 *
 * Validates:
 * 1. merchants.balance == SUM(ledger_entries) per merchant
 * 2. users.balance == SUM(ledger_entries) per user
 * 3. platform_balance == SUM(platform_fee_transactions)
 * 4. Per-order integrity: completed orders have ESCROW_LOCK + ESCROW_RELEASE,
 *    cancelled orders with escrow have ESCROW_LOCK + ESCROW_REFUND
 * 5. No duplicate ledger entries per (order, entry_type, account)
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    // 1. Merchant balance vs ledger
    const merchantResults = await query<{
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

    const merchantMismatches = merchantResults.filter((r) => r.status === 'MISMATCH');

    // 2. User balance vs ledger
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

    // 3. Platform balance vs fee transactions
    const platformResults = await query<{
      platform_balance: number;
      fee_sum: number;
      drift: number;
      status: string;
    }>(`
      SELECT
        COALESCE(pb.balance, 0) as platform_balance,
        COALESCE(ft.fee_sum, 0) as fee_sum,
        ABS(COALESCE(pb.balance, 0) - COALESCE(ft.fee_sum, 0)) as drift,
        CASE
          WHEN ABS(COALESCE(pb.balance, 0) - COALESCE(ft.fee_sum, 0)) > 0.01 THEN 'MISMATCH'
          ELSE 'OK'
        END as status
      FROM (SELECT balance FROM platform_balance WHERE key = 'main') pb
      CROSS JOIN (SELECT SUM(fee_amount) as fee_sum FROM platform_fee_transactions) ft
    `);

    // 4. Per-order integrity: check completed/cancelled orders for missing entries
    const orderIntegrityIssues = await query<{
      order_id: string;
      order_number: number;
      status: string;
      has_escrow: boolean;
      has_lock: boolean;
      has_release: boolean;
      has_refund: boolean;
      issue: string;
    }>(`
      SELECT
        o.id as order_id,
        o.order_number,
        o.status,
        (o.escrow_tx_hash IS NOT NULL) as has_escrow,
        EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_LOCK') as has_lock,
        EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_RELEASE') as has_release,
        EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_REFUND') as has_refund,
        CASE
          WHEN o.status = 'completed' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_LOCK')
            THEN 'COMPLETED_MISSING_ESCROW_LOCK'
          WHEN o.status = 'completed' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_RELEASE')
            THEN 'COMPLETED_MISSING_ESCROW_RELEASE'
          WHEN o.status = 'cancelled' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_LOCK')
            THEN 'CANCELLED_MISSING_ESCROW_LOCK'
          WHEN o.status = 'cancelled' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_REFUND')
            THEN 'CANCELLED_MISSING_ESCROW_REFUND'
          ELSE NULL
        END as issue
      FROM orders o
      WHERE o.status IN ('completed', 'cancelled')
        AND o.escrow_tx_hash IS NOT NULL
      HAVING
        CASE
          WHEN o.status = 'completed' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_LOCK')
            THEN true
          WHEN o.status = 'completed' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_RELEASE')
            THEN true
          WHEN o.status = 'cancelled' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_LOCK')
            THEN true
          WHEN o.status = 'cancelled' AND o.escrow_tx_hash IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = o.id AND entry_type = 'ESCROW_REFUND')
            THEN true
          ELSE false
        END
      ORDER BY o.order_number DESC
      LIMIT 100
    `);

    // 5. Duplicate ledger entries check
    const duplicates = await query<{
      related_order_id: string;
      entry_type: string;
      account_id: string;
      entry_count: number;
    }>(`
      SELECT
        related_order_id,
        entry_type,
        account_id,
        COUNT(*) as entry_count
      FROM ledger_entries
      WHERE related_order_id IS NOT NULL
        AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE')
      GROUP BY related_order_id, entry_type, account_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);

    const totalMismatches =
      merchantMismatches.length +
      userMismatches.length +
      (platformResults[0]?.status === 'MISMATCH' ? 1 : 0) +
      orderIntegrityIssues.length +
      duplicates.length;

    return NextResponse.json({
      success: true,
      data: {
        overall_status: totalMismatches === 0 ? 'HEALTHY' : 'ISSUES_FOUND',
        total_issues: totalMismatches,
        checked_at: new Date().toISOString(),
        merchants: {
          total: merchantResults.length,
          mismatches: merchantMismatches.length,
          details: merchantResults,
        },
        users: {
          total: userResults.length,
          mismatches: userMismatches.length,
          details: userResults,
        },
        platform: {
          balance: platformResults[0]?.platform_balance ?? 0,
          fee_sum: platformResults[0]?.fee_sum ?? 0,
          drift: platformResults[0]?.drift ?? 0,
          status: platformResults[0]?.status ?? 'UNKNOWN',
        },
        order_integrity: {
          issues_found: orderIntegrityIssues.length,
          details: orderIntegrityIssues,
        },
        duplicate_ledger_entries: {
          found: duplicates.length,
          details: duplicates,
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
