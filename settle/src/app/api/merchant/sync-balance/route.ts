import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';

/**
 * POST /api/merchant/sync-balance
 *
 * Syncs the merchant's DB balance from the on-chain Solana wallet balance.
 * Called by the frontend after trade completion so that future ledger entries
 * have accurate balance_before/balance_after values.
 *
 * Body: { merchant_id: string, balance: number }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { merchant_id, balance } = body;

    if (!merchant_id || balance == null || typeof balance !== 'number' || balance < 0) {
      return validationErrorResponse(['merchant_id and balance (non-negative number) required']);
    }

    // Only the merchant themselves can sync their balance
    const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only sync your own balance');
    }

    await query(
      'UPDATE merchants SET balance = $1 WHERE id = $2',
      [balance, merchant_id]
    );

    return successResponse({ synced: true, balance });
  } catch (error) {
    console.error('Error syncing balance:', error);
    return errorResponse('Internal server error');
  }
}
