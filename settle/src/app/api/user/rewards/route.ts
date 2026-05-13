/**
 * GET /api/user/rewards
 *
 * Returns the authenticated user's reward total + recent grants. Source of
 * truth is the `user_rewards` table (migration 123). Granted in core-api
 * when a sell order completes — see routes/orders.ts.
 *
 * Response: {
 *   total_usdt: number,
 *   count: number,
 *   recent: [{ id, order_id, amount_usdt, reward_bps, granted_at, revealed_at }]
 * }
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
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('Rewards are user-only');

  try {
    const rows = await query<RewardRow>(
      `SELECT id, order_id, amount_usdt, reward_bps, granted_at, revealed_at
         FROM user_rewards
        WHERE user_id = $1
        ORDER BY granted_at DESC
        LIMIT 50`,
      [auth.actorId],
    );
    const total = rows.reduce((s, r) => s + Number(r.amount_usdt), 0);
    const unrevealed = rows.filter((r) => !r.revealed_at);
    return successResponse({
      total_usdt: +total.toFixed(6),
      count: rows.length,
      unrevealed_count: unrevealed.length,
      recent: rows,
    });
  } catch (e) {
    console.error('[API] GET /api/user/rewards error:', e);
    return errorResponse('Failed to fetch rewards');
  }
}

export async function POST(request: NextRequest) {
  // POST /api/user/rewards — body: { id } — mark a reward as revealed (after
  // the user has tapped/scratched the card in the UI).
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

  const result = await query(
    `UPDATE user_rewards
        SET revealed_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revealed_at IS NULL`,
    [body.id, auth.actorId],
  );
  return successResponse({ updated: result.rowCount ?? 0 });
}
