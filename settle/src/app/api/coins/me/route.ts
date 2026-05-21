/**
 * GET /api/coins/me
 *
 * Returns current coin balance, locked balance, lifetime earned/spent,
 * and headroom to the hard cap. Lazy-sweeps eligible unlocks first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getCoinBalance, HARD_CAP_COINS } from '@/lib/coins/economy';
import { queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Coins only apply to user/merchant accounts');
  }

  // Try the rich path first (locks + lifetime aggregates). Fall back
  // to a denormalized read if the locks / source_ref columns aren't
  // there yet — the UI still gets a balance + zero locks.
  try {
    const snap = await getCoinBalance(auth.actorId, auth.actorType);
    return successResponse({ ...snap, hard_cap: HARD_CAP_COINS });
  } catch (err) {
    console.error('[coins/me] fallback path', err);
    const table = auth.actorType === 'merchant' ? 'merchants' : 'users';
    const row = await queryOne<{ blip_points: number }>(
      `SELECT blip_points FROM ${table} WHERE id = $1`,
      [auth.actorId],
    );
    return successResponse({
      balance: row?.blip_points ?? 0,
      locked: 0,
      lifetimeEarned: row?.blip_points ?? 0,
      lifetimeSpent: 0,
      headroomToHardCap: HARD_CAP_COINS - (row?.blip_points ?? 0),
      hard_cap: HARD_CAP_COINS,
    });
  }
}
