/**
 * GET /api/reputation/me
 *
 * Thin wrapper over the existing /api/reputation endpoint that resolves
 * entityId + entityType from the auth context — saves clients from
 * having to pass identity in a query param when calling on their own
 * behalf.
 *
 * Returns the same payload shape: reputation score, tier, component
 * breakdown, badges, flags.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse, notFoundResponse, errorResponse } from '@/lib/middleware/auth';
import { getReputationWithBreakdown } from '@/lib/reputation/repository';
import { TIER_INFO } from '@/lib/reputation/types';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Reputation only applies to user/merchant accounts');
  }

  try {
    // Recompute live from the same source the per-entity endpoint
    // (`/api/reputation?entityId=…`) uses — `getReputationWithBreakdown`
    // calls the calculator, which already emits CIBIL-rebased 300–900
    // scores. Reading the cached `reputation_scores` row used to drift
    // from the live computation on production (legacy pre-rebase rows
    // weren't yet rescored by the daily worker), so the merchant
    // dashboard and the waitlist dashboard would show different tiers
    // for the same actor.
    const result = await getReputationWithBreakdown(auth.actorId, actorType);
    if (!result) {
      // Actor row not found at all — surface the 500 "New" default.
      return successResponse({
        total_score: 500,
        tier: 'newcomer',
        tier_info: TIER_INFO.newcomer,
        review_score: 50,
        execution_score: 0,
        volume_score: 0,
        consistency_score: 0,
        trust_score: 50,
        badges: [],
        flags: [],
        is_default: true,
      });
    }
    const { score } = result;
    return successResponse({
      ...score,
      tier_info: TIER_INFO[score.tier] ?? TIER_INFO.newcomer,
      is_default: false,
    });
  } catch (err) {
    console.error('[reputation/me] failed', err);
    return errorResponse('Failed to load reputation');
  }
}
