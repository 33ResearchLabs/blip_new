/**
 * GET /api/staking/me
 *
 * USDT staking snapshot for the current actor (user/merchant): staked principal,
 * pending/lifetime rewards, APY, spendable balance, total value, daily/monthly
 * estimates, plus the active-staker count for the "Staked users N+" badge.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getStakingSnapshot, getActiveStakerCount } from '@/lib/staking/economy';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Staking only applies to user/merchant accounts');
  }

  const [snapshot, stakedUsers] = await Promise.all([
    getStakingSnapshot(auth.actorType, auth.actorId),
    getActiveStakerCount(),
  ]);

  return successResponse({ ...snapshot, stakedUsers });
}
