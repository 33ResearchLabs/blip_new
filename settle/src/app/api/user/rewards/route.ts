/**
 * GET /api/user/rewards
 *
 * Returns the authenticated user's reward totals split by lifecycle state:
 *   - pending:   granted but not yet claimable (trade still in flight)
 *   - claimable: trade completed; reward is withdrawable
 *   - voided rows are excluded from both totals (kept for audit only).
 *
 * Source of truth is the `user_rewards` table (migrations 123 + 124).
 * Pending rewards are inserted at order creation for QR/UPI sells
 * (orderCreate.ts); claimable_at is flipped on `completed` (orders.ts);
 * voided_at is set on cancel/expire/dispute-refund (atomicCancel*).
 *
 * Response: {
 *   claimable_total_usdt: number,
 *   pending_total_usdt:   number,
 *   pending_count:        number,
 *   claimable_count:      number,
 *   unrevealed_count:     number,
 *   // Back-compat: callers that haven't migrated still see the legacy
 *   // single-total + count. Returns claimable totals only.
 *   total_usdt:           number,
 *   count:                number,
 *   recent: [{ id, order_id, amount_usdt, reward_bps,
 *              granted_at, revealed_at, claimable_at, voided_at }]
 * }
 *
 * Any future withdrawal endpoint MUST filter to
 *   claimable_at IS NOT NULL AND voided_at IS NULL
 * — voided/pending rewards are NOT withdrawable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

interface RewardRow {
  id: string;
  order_id: string;
  amount_usdt: string;
  reward_bps: number;
  granted_at: string;
  revealed_at: string | null;
  claimable_at: string | null;
  voided_at: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('Rewards are user-only');

  try {
    const rows = await query<RewardRow>(
      `SELECT id, order_id, amount_usdt, reward_bps,
              granted_at, revealed_at, claimable_at, voided_at
         FROM user_rewards
        WHERE user_id = $1
        ORDER BY granted_at DESC
        LIMIT 50`,
      [auth.actorId],
    );

    let claimableTotal = 0;
    let pendingTotal = 0;
    let claimableCount = 0;
    let pendingCount = 0;
    let unrevealedCount = 0;
    for (const r of rows) {
      if (r.voided_at) continue;
      const amt = Number(r.amount_usdt);
      if (r.claimable_at) {
        claimableTotal += amt;
        claimableCount++;
      } else {
        pendingTotal += amt;
        pendingCount++;
      }
      if (!r.revealed_at) unrevealedCount++;
    }

    return successResponse({
      claimable_total_usdt: +claimableTotal.toFixed(6),
      pending_total_usdt: +pendingTotal.toFixed(6),
      pending_count: pendingCount,
      claimable_count: claimableCount,
      unrevealed_count: unrevealedCount,
      // Legacy fields — preserve old callers' contract. They see claimable only.
      total_usdt: +claimableTotal.toFixed(6),
      count: claimableCount,
      recent: rows,
    });
  } catch (e) {
    console.error('[API] GET /api/user/rewards error:', e);
    return errorResponse('Failed to fetch rewards');
  }
}

export async function POST(request: NextRequest) {
  // POST /api/user/rewards — body: { id } — mark a reward as revealed (after
  // the user has tapped/scratched the card in the UI). Voided rewards cannot
  // be revealed (DB guard).
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('Rewards are user-only');

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON');
  }
  if (!body.id || typeof body.id !== 'string') return errorResponse('id required');

  const result = await query<{ id: string }>(
    `UPDATE user_rewards
        SET revealed_at = NOW()
      WHERE id = $1 AND user_id = $2
        AND revealed_at IS NULL
        AND voided_at IS NULL
      RETURNING id`,
    [body.id, auth.actorId],
  );
  return successResponse({ updated: result.length });
}
