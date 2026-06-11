/**
 * POST /api/staking/stake  { amount }
 *
 * Moves `amount` USDT from the actor's spendable balance into their staking
 * position. Atomic + row-locked in lib/staking/economy.stake; the non-negative
 * balance CHECK is the final guard against overdraw.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireTokenAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { stake, StakingError } from '@/lib/staking/economy';
import { z } from 'zod';

const BodySchema = z.object({
  amount: z.number().positive().finite().max(100_000_000),
});

export async function POST(request: NextRequest) {
  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Staking requires a user or merchant token');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues.map((i) => i.message));
  }

  try {
    const result = await stake(auth.actorType, auth.actorId, parsed.data.amount);
    return successResponse(result);
  } catch (err) {
    if (err instanceof StakingError && err.code === 'INSUFFICIENT_BALANCE') {
      return errorResponse('Not enough available USDT to stake', 402);
    }
    console.error('[staking/stake] failed', err);
    return errorResponse('Staking failed');
  }
}
