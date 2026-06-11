/**
 * POST /api/staking/claim
 *
 * Materializes and credits all accrued staking rewards into the actor's
 * spendable balance, zeroing accrued_rewards. Atomic + row-locked.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireTokenAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { claim, StakingError } from '@/lib/staking/economy';

export async function POST(request: NextRequest) {
  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Staking requires a user or merchant token');
  }

  try {
    const result = await claim(auth.actorType, auth.actorId);
    return successResponse(result);
  } catch (err) {
    if (err instanceof StakingError && err.code === 'NOTHING_TO_CLAIM') {
      return errorResponse('No rewards to claim yet', 400);
    }
    console.error('[staking/claim] failed', err);
    return errorResponse('Claim failed');
  }
}
