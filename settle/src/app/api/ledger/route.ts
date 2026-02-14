import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  getAuthContext,
  successResponse,
  errorResponse,
  validationErrorResponse,
  unauthorizedResponse,
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
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const entryType = searchParams.get('entry_type'); // Optional filter

    if (!merchantId && !userId) {
      return validationErrorResponse(['merchant_id or user_id is required']);
    }

    // Verify the requester is authorized to view this ledger
    const auth = getAuthContext(request);
    if (!auth) {
      return unauthorizedResponse('Authentication required to view ledger');
    }
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
      sql = `SELECT * FROM v_merchant_ledger WHERE merchant_id = $1`;
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

    // Add pagination
    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    params.push(offset);
    sql += ` OFFSET $${params.length}`;

    const entries = await query<LedgerEntry>(sql, params);

    return successResponse({ entries });
  } catch (error) {
    console.error('Error fetching ledger:', error);
    return errorResponse('Internal server error');
  }
}

// POST /api/ledger - Manually log a ledger entry (admin/testing only)
export async function POST(request: NextRequest) {
  // Block manual ledger entries in production unless admin-authenticated
  if (process.env.NODE_ENV === 'production') {
    const { requireAdminAuth } = await import('@/lib/middleware/auth');
    const authError = requireAdminAuth(request);
    if (authError) return authError;
  }

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
