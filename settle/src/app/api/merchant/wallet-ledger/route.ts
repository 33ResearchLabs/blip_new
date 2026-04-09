import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  verifyMerchant,
  successResponse,
  errorResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

interface WalletLedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string | null;
  related_order_id: string | null;
  order_number: string | null;
  order_type: 'buy' | 'sell' | null;
  counterparty_name: string | null;
  created_at: string;
}

interface WalletLedgerSummary {
  current_balance: number;
  total_credits: number;
  total_debits: number;
  total_transactions: number;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const entryType = searchParams.get('type'); // ESCROW_LOCK, ESCROW_RELEASE, etc.
    const days = searchParams.get('days'); // 1, 7, 30, 90

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Auth check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden('GET /api/merchant/wallet-ledger', auth.actorId, 'Not merchant owner');
      return forbiddenResponse('You can only access your own wallet ledger');
    }

    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found or not active']);
    }

    // --- Build shared filter fragments ---
    // We build filter params for 3 queries (summary, entries, count) using a helper.
    function buildFilters(baseParams: (string | number)[]) {
      let dateFilter = '';
      let typeFilter = '';

      if (days) {
        baseParams.push(parseInt(days, 10));
        dateFilter = ` AND le.created_at >= NOW() - ($${baseParams.length} || ' days')::interval`;
      }
      if (entryType) {
        baseParams.push(entryType.toUpperCase());
        typeFilter = ` AND le.entry_type = $${baseParams.length}`;
      }

      return { dateFilter, typeFilter };
    }

    // --- Summary ---
    const summaryParams: (string | number)[] = [merchantId];
    const sf = buildFilters([...summaryParams]); // clone to count params
    // Re-build for summary (need fresh param indices)
    const sp: (string | number)[] = [merchantId];
    let summaryDateFilter = '';
    let summaryTypeFilter = '';
    if (days) {
      sp.push(parseInt(days, 10));
      summaryDateFilter = ` AND le.created_at >= NOW() - ($${sp.length} || ' days')::interval`;
    }
    if (entryType) {
      sp.push(entryType.toUpperCase());
      summaryTypeFilter = ` AND le.entry_type = $${sp.length}`;
    }

    const balanceRows = await query<{ balance: number }>(
      'SELECT balance FROM merchants WHERE id = $1::uuid',
      [merchantId]
    );

    const summaryRows = await query<{ total_credits: string; total_debits: string; total_transactions: string }>(
      `SELECT
        COALESCE(SUM(CASE WHEN le.amount > 0 THEN le.amount ELSE 0 END), 0) as total_credits,
        COALESCE(SUM(CASE WHEN le.amount < 0 THEN ABS(le.amount) ELSE 0 END), 0) as total_debits,
        COUNT(*) as total_transactions
       FROM ledger_entries le
       WHERE le.account_type = 'merchant'
         AND le.account_id = $1::uuid
         AND le.entry_type NOT IN ('FEE', 'FEE_EARNING')${summaryDateFilter}${summaryTypeFilter}`,
      sp
    );

    const summary: WalletLedgerSummary = {
      current_balance: parseFloat(String(balanceRows[0]?.balance ?? 0)),
      total_credits: parseFloat(summaryRows[0]?.total_credits || '0'),
      total_debits: parseFloat(summaryRows[0]?.total_debits || '0'),
      total_transactions: parseInt(summaryRows[0]?.total_transactions || '0'),
    };

    // --- Entries ---
    const ep: (string | number)[] = [merchantId];
    let entriesDateFilter = '';
    let entriesTypeFilter = '';
    if (days) {
      ep.push(parseInt(days, 10));
      entriesDateFilter = ` AND le.created_at >= NOW() - ($${ep.length} || ' days')::interval`;
    }
    if (entryType) {
      ep.push(entryType.toUpperCase());
      entriesTypeFilter = ` AND le.entry_type = $${ep.length}`;
    }
    ep.push(limit);
    const limitIdx = ep.length;
    ep.push(offset);
    const offsetIdx = ep.length;

    const entries = await query<WalletLedgerEntry>(
      `SELECT
        le.id,
        le.entry_type,
        le.amount,
        le.balance_before,
        le.balance_after,
        le.description,
        le.related_order_id,
        o.order_number,
        o.type AS order_type,
        COALESCE(u.username, bm.business_name) AS counterparty_name,
        le.created_at
       FROM ledger_entries le
       LEFT JOIN orders o ON le.related_order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
       WHERE le.account_type = 'merchant'
         AND le.account_id = $1::uuid
         AND le.entry_type NOT IN ('FEE', 'FEE_EARNING')${entriesDateFilter}${entriesTypeFilter}
       ORDER BY le.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ep
    );

    // --- Count ---
    const cp: (string | number)[] = [merchantId];
    let countDateFilter = '';
    let countTypeFilter = '';
    if (days) {
      cp.push(parseInt(days, 10));
      countDateFilter = ` AND le.created_at >= NOW() - ($${cp.length} || ' days')::interval`;
    }
    if (entryType) {
      cp.push(entryType.toUpperCase());
      countTypeFilter = ` AND le.entry_type = $${cp.length}`;
    }

    const countRows = await query<{ total: string }>(
      `SELECT COUNT(*) as total
       FROM ledger_entries le
       WHERE le.account_type = 'merchant'
         AND le.account_id = $1::uuid
         AND le.entry_type NOT IN ('FEE', 'FEE_EARNING')${countDateFilter}${countTypeFilter}`,
      cp
    );

    const total = parseInt(countRows[0]?.total || '0');

    return successResponse({
      summary,
      entries,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  } catch (error) {
    logger.api.error('GET', '/api/merchant/wallet-ledger', error as Error);
    return errorResponse('Internal server error');
  }
}
