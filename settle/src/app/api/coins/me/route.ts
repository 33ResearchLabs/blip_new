/**
 * GET /api/coins/me
 *
 * Returns current coin balance, locked balance, lifetime earned/spent,
 * and headroom to the hard cap. Lazy-sweeps eligible unlocks first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getCoinBalance, HARD_CAP_COINS } from '@/lib/coins/economy';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Coins only apply to user/merchant accounts');
  }

  const snap = await getCoinBalance(auth.actorId, auth.actorType);
  return successResponse({
    ...snap,
    hard_cap: HARD_CAP_COINS,
  });
}
