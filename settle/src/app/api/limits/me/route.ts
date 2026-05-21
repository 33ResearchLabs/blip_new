/**
 * GET /api/limits/me
 *
 * Returns the effective daily + per-trade limits for the authenticated
 * actor, including the trailing 24h volume consumed. UI uses this to
 * render a "spend X coins to unlock" CTA when the user is near their cap.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getEffectiveLimits, getTrailing24hVolumeUsd, COIN_LIMIT_TIERS, BASE_LIMITS } from '@/lib/coins/limits';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Limits only apply to user/merchant accounts');
  }

  const limits = await getEffectiveLimits(auth.actorId, actorType);
  const trailing = await getTrailing24hVolumeUsd(auth.actorId, actorType);

  return successResponse({
    effective: limits,
    trailing_24h_usd: trailing,
    headroom_usd: Math.max(limits.dailyUsd - trailing, 0),
    base: BASE_LIMITS,
    tiers: COIN_LIMIT_TIERS,
  });
}
