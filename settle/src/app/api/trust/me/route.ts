/**
 * GET /api/trust/me
 *
 * Returns the authenticated account's Trust Score (0–100), its tier (T0–T5), the
 * tier's base trading limits, and a line-item breakdown of how the score was
 * reached. Read-only — computed live from existing data, writes nothing, and is
 * not yet wired into limit enforcement.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getTrustScore } from '@/lib/trust/repository';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Trust Score only applies to user/merchant accounts');
  }

  const { score, tier, tierDef, tradingAllowed, breakdown, inputs } = await getTrustScore(
    actorType,
    auth.actorId,
  );

  return successResponse({
    score,
    tier,
    tierLabel: tierDef.label,
    tradingAllowed,
    baseLimits: {
      dailyUsd: tierDef.dailyUsd,
      perOrderUsd: tierDef.perOrderUsd,
      maxOpenOrders: tierDef.maxOpenOrders,
    },
    breakdown,
    inputs,
  });
}
