import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  requireAdminAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';

interface LedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  asset: string;
  related_order_id: string | null;
  related_tx_hash: string | null;
  description: string | null;
  order_number: string | null;
  order_type: 'buy' | 'sell' | null;
  order_status: string | null;
  created_at: string;
}

// GET /api/ledger - Get ledger entries for merchant or user
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const userId = searchParams.get('user_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const cursor = searchParams.get('cursor') || undefined;
    const entryType = searchParams.get('entry_type'); // Optional filter

    if (!merchantId && !userId) {
      return validationErrorResponse(['merchant_id or user_id is required']);
    }

    // Verify the requester is authorized (DB-verified)
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Users can only view their own ledger, merchants can only view their own
    if (merchantId && auth.actorType === 'merchant' && auth.actorId !== merchantId) {
      return forbiddenResponse('You can only view your own ledger');
    }
    if (userId && auth.actorType === 'user' && auth.actorId !== userId) {
      return forbiddenResponse('You can only view your own ledger');
    }

    let sql: string;
    const params: any[] = [];

    if (merchantId) {
      // UNION ledger entries with cancelled/expired orders that have no ledger entry
      // so they appear in the activity feed even without fund movement
      sql = `
        SELECT vml.*, NULL::text AS counterparty_name
        FROM v_merchant_ledger vml WHERE merchant_id = $1
        UNION ALL
        SELECT
          o.id,
          $1::uuid AS merchant_id,
          'ORDER_CANCELLED' AS entry_type,
          o.crypto_amount AS amount,
          'USDT' AS asset,
          o.id AS related_order_id,
          NULL AS related_tx_hash,
          COALESCE(o.cancellation_reason, 'Order cancelled') AS description,
          '{}'::jsonb AS metadata,
          COALESCE(o.cancelled_at, o.created_at) AS created_at,
          o.order_number,
          o.type AS order_type,
          o.status AS order_status,
          COALESCE(u.username, bm.business_name) AS counterparty_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
        WHERE (o.merchant_id = $1 OR o.buyer_merchant_id = $1)
          AND o.status IN ('cancelled', 'expired')
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries le
            WHERE le.related_order_id = o.id
              AND le.account_id = $1
          )
      `;
      params.push(merchantId);
    } else {
      sql = `SELECT * FROM v_user_ledger WHERE user_id = $1`;
      params.push(userId);
    }

    // Add entry type filter if provided
    if (entryType) {
      params.push(entryType);
      sql += ` AND entry_type = $${params.length}`;
    }

    // Cursor-based pagination (preferred) or offset fallback
    if (cursor) {
      params.push(cursor);
      sql = `SELECT * FROM (${sql}) _sub WHERE created_at < $${params.length}::timestamptz`;
    } else if (offset > 0) {
      params.push(offset);
      sql += ` OFFSET $${params.length}`;
    }

    params.push(limit);
    sql = `SELECT * FROM (${sql}) _paged ORDER BY created_at DESC LIMIT $${params.length}`;

    const entries = await query<LedgerEntry>(sql, params);

    const lastEntry = entries[entries.length - 1];
    const nextCursor = entries.length >= limit && lastEntry?.created_at
      ? lastEntry.created_at
      : null;

    return successResponse({
      entries,
      pagination: {
        limit,
        count: entries.length,
        next_cursor: nextCursor,
        has_more: entries.length >= limit,
      },
    });
  } catch (error) {
    console.error('Error fetching ledger:', error);
    return errorResponse('Internal server error');
  }
}

// POST /api/ledger - Manually log a ledger entry (admin only)
export async function POST(request: NextRequest) {
  // Always require admin auth for manual ledger entries
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      account_type,
      account_id,
      entry_type,
      amount,
      asset = 'USDT',
      related_order_id,
      related_tx_hash,
      description,
      metadata = {},
    } = body;

    if (!account_type || !account_id || !entry_type || amount === undefined) {
      return validationErrorResponse([
        'account_type, account_id, entry_type, and amount are required',
      ]);
    }

    // Validate account_type
    if (!['merchant', 'user'].includes(account_type)) {
      return validationErrorResponse(['account_type must be merchant or user']);
    }

    // Validate entry_type
    const validEntryTypes = [
      'DEPOSIT',
      'WITHDRAWAL',
      'ESCROW_LOCK',
      'ESCROW_RELEASE',
      'ESCROW_REFUND',
      'FEE',
      'FEE_EARNING',
      'ADJUSTMENT',
      'ORDER_PAYMENT',
      'ORDER_RECEIPT',
    ];

    if (!validEntryTypes.includes(entry_type)) {
      return validationErrorResponse([`entry_type must be one of: ${validEntryTypes.join(', ')}`]);
    }

    // Log the entry
    const result = await query<{ id: string }>(
      `SELECT log_ledger_entry($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      [
        account_type,
        account_id,
        entry_type,
        amount,
        asset,
        related_order_id || null,
        related_tx_hash || null,
        description || null,
        JSON.stringify(metadata),
      ]
    );

    const entryId = result[0]?.id;

    if (!entryId) {
      throw new Error('Failed to create ledger entry');
    }

    return successResponse({ id: entryId }, 201);
  } catch (error) {
    console.error('Error creating ledger entry:', error);
    return errorResponse('Internal server error');
  }
}
