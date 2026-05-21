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
import { getReputationScore } from '@/lib/reputation/repository';
import { TIER_INFO } from '@/lib/reputation/types';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Reputation only applies to user/merchant accounts');
  }

  try {
    const rep = await getReputationScore(auth.actorId, actorType);
    if (!rep) {
      // Default for actors who haven't been scored yet — matches the
      // 500 default the rebase migration seeds.
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
    // Legacy rows can carry pre-rebase total_score values (0–1000).
    // Surface the 500 "New" default until the daily worker rescores
    // them properly. The DB row stays untouched here — onboarding
    // takes care of updating it on next login.
    const score = rep.total_score < 300 ? 500 : rep.total_score;
    const tier = rep.total_score < 300 ? 'newcomer' : rep.tier;
    return successResponse({
      ...rep,
      total_score: score,
      tier,
      tier_info: TIER_INFO[tier] ?? TIER_INFO.newcomer,
      is_default: rep.total_score < 300,
    });
  } catch (err) {
    console.error('[reputation/me] failed', err);
    return errorResponse('Failed to load reputation');
  }
}
