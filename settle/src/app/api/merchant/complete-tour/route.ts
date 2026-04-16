import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';

/**
 * POST /api/merchant/complete-tour
 *
 * Marks the merchant's onboarding tour as completed. Called by the frontend
 * when the user dismisses or finishes the merchant tour so the tour does
 * not re-run on new browsers / incognito windows / cleared site data.
 *
 * Idempotent: once tour_completed_at is set, subsequent calls are no-ops
 * (COALESCE preserves the earlier timestamp).
 *
 * Auth: merchant token required. A merchant can only mark their own tour
 * as complete — we use the authenticated actor id, ignoring any merchant_id
 * in the body. This prevents a merchant from writing to another merchant's
 * row by spoofing the payload.
 *
 * Body: none required
 * Response: { success: true, data: { tour_completed_at: ISO } }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants can mark their tour complete');
    }

    // COALESCE keeps the original completion timestamp if already set.
    // RETURNING gives the canonical value the client should trust.
    const rows = await query<{ tour_completed_at: string }>(
      `UPDATE merchants
         SET tour_completed_at = COALESCE(tour_completed_at, NOW())
       WHERE id = $1
       RETURNING tour_completed_at`,
      [auth.actorId]
    );

    if (rows.length === 0) {
      // Merchant record not found — shouldn't happen post-auth, but handle safely.
      return errorResponse('Merchant not found', 404);
    }

    return successResponse({ tour_completed_at: rows[0].tour_completed_at });
  } catch (error) {
    console.error('Error marking tour complete:', error);
    return errorResponse('Internal server error');
  }
}
