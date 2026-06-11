/**
 * GET /api/staking/history
 *
 * Recent staking events (stake / unstake / claim) for the current actor.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { query } from '@/lib/db';
import type { StakingEventRow } from '@/lib/staking/economy';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Staking only applies to user/merchant accounts');
  }

  const rows = await query<StakingEventRow>(
    `SELECT id, event_type, amount, principal_after, rewards_after, created_at
       FROM staking_events
      WHERE account_type = $1 AND account_id = $2
   ORDER BY created_at DESC
      LIMIT 50`,
    [auth.actorType, auth.actorId],
  );

  return successResponse(rows);
}
