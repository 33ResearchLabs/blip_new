/**
 * GET /api/limits/me
 *
 * Returns the effective daily + per-trade limits for the authenticated
 * actor, including the trailing 24h volume consumed. UI uses this to
 * render a "spend X coins to unlock" CTA when the user is near their cap.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getEffectiveLimits, getTrailing24hVolumeUsd, getLargestTrade24hUsd, getMerchant24hSideVolumeUsd, COIN_LIMIT_TIERS, BASE_LIMITS, MERCHANT_SIDE_LIMITS } from '@/lib/coins/limits';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Limits only apply to user/merchant accounts');
  }

  const limits = await getEffectiveLimits(auth.actorId, actorType);
  const trailing = await getTrailing24hVolumeUsd(auth.actorId, actorType);
  const largestTrade = await getLargestTrade24hUsd(auth.actorId, actorType);

  // Per-side (buy/sell) caps + trailing-24h usage — merchant-only. The cap
  // values come from MERCHANT_SIDE_LIMITS (single source of truth, also used
  // by the order-create enforcement), so changing those constants updates the
  // display and the block together.
  let buy: { limitUsd: number; usedUsd: number } | null = null;
  let sell: { limitUsd: number; usedUsd: number } | null = null;
  if (actorType === 'merchant') {
    const { buyUsd, sellUsd } = await getMerchant24hSideVolumeUsd(auth.actorId);
    buy = { limitUsd: MERCHANT_SIDE_LIMITS.buyUsd, usedUsd: buyUsd };
    sell = { limitUsd: MERCHANT_SIDE_LIMITS.sellUsd, usedUsd: sellUsd };
  }

  return successResponse({
    effective: limits,
    trailing_24h_usd: trailing,
    largest_trade_24h_usd: largestTrade,
    headroom_usd: Math.max(limits.dailyUsd - trailing, 0),
    base: BASE_LIMITS,
    tiers: COIN_LIMIT_TIERS,
    buy,
    sell,
  });
}
