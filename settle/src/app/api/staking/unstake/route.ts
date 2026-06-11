/**
 * POST /api/staking/unstake  { amount }
 *
 * Moves `amount` USDT from the actor's staking position back into their
 * spendable balance. Cannot exceed the staked principal. Atomic + row-locked.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireTokenAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { unstake, StakingError } from '@/lib/staking/economy';
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
    const result = await unstake(auth.actorType, auth.actorId, parsed.data.amount);
    return successResponse(result);
  } catch (err) {
    if (err instanceof StakingError && err.code === 'INSUFFICIENT_STAKE') {
      return errorResponse('Cannot unstake more than you have staked', 400);
    }
    console.error('[staking/unstake] failed', err);
    return errorResponse('Unstaking failed');
  }
}
