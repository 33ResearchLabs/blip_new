/**
 * GET /api/limits/me
 *
 * Returns the effective daily + per-trade limits for the authenticated
 * actor, including the trailing 24h volume consumed. UI uses this to
 * render a "spend X coins to unlock" CTA when the user is near their cap.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getEffectiveLimits, getTrustBasedLimits, getTrailing24hVolumeUsd, getLargestTrade24hUsd, getDailyLimitResetInfo, getMerchant24hSideVolumeUsd, getMerchantSideResetInfo, getUnsuccessful24hCount, COIN_LIMIT_TIERS, BASE_LIMITS, MERCHANT_SIDE_LIMITS, LIMIT_DECREASE_ALERT_THRESHOLD } from '@/lib/coins/limits';
import { getXVerification } from '@/lib/db/repositories/xAccountVerifications';

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
  // When the daily cap is a rolling 24h window, tell the UI WHEN it frees up:
  // nextTradeableAt (used drops below the cap) + fullResetAt (used hits 0).
  const reset = await getDailyLimitResetInfo(auth.actorId, actorType, limits.dailyUsd);

  // Trust Score system preview (Phase 2): what limits WOULD be under the
  // Trust-Tier × stake model. Opt-in via ?preview=trust so we don't add the
  // extra reads to every limits-page load. Read-only; never breaks the endpoint.
  let trustPreview: Awaited<ReturnType<typeof getTrustBasedLimits>> | null = null;
  if (request.nextUrl.searchParams.get('preview') === 'trust') {
    try {
      trustPreview = await getTrustBasedLimits(auth.actorId, actorType);
    } catch (e) {
      console.error('[limits/me] trust preview failed', e);
    }
  }

  // Inputs for the "Unlock Higher Limits" rows + the informational decrease
  // alert. X verification is self-attested (display-only); phone/liveness come
  // from the effective-limits computation and actually move the cap.
  const [unsuccessful24h, xRow] = await Promise.all([
    getUnsuccessful24hCount(auth.actorId, actorType),
    getXVerification(actorType, auth.actorId),
  ]);

  // Per-side (buy/sell) caps + trailing-24h usage — merchant-only. The cap
  // values come from MERCHANT_SIDE_LIMITS (single source of truth, also used
  // by the order-create enforcement), so changing those constants updates the
  // display and the block together.
  type SideCap = {
    limitUsd: number;
    usedUsd: number;
    reset: { nextTradeableAt: string | null; fullResetAt: string | null; headroomAfterResetUsd: number };
  };
  let buy: SideCap | null = null;
  let sell: SideCap | null = null;
  if (actorType === 'merchant') {
    const { buyUsd, sellUsd } = await getMerchant24hSideVolumeUsd(auth.actorId);
    // Per-side reset times — when each maxed side frees up (rolling 24h).
    const [buyReset, sellReset] = await Promise.all([
      getMerchantSideResetInfo(auth.actorId, 'buy', MERCHANT_SIDE_LIMITS.buyUsd),
      getMerchantSideResetInfo(auth.actorId, 'sell', MERCHANT_SIDE_LIMITS.sellUsd),
    ]);
    buy = { limitUsd: MERCHANT_SIDE_LIMITS.buyUsd, usedUsd: buyUsd, reset: buyReset };
    sell = { limitUsd: MERCHANT_SIDE_LIMITS.sellUsd, usedUsd: sellUsd, reset: sellReset };
  }

  return successResponse({
    effective: limits,
    trailing_24h_usd: trailing,
    largest_trade_24h_usd: largestTrade,
    headroom_usd: Math.max(limits.dailyUsd - trailing, 0),
    reset,
    base: BASE_LIMITS,
    tiers: COIN_LIMIT_TIERS,
    buy,
    sell,
    // Verification state for the "Unlock Higher Limits" rows + header badge.
    // phone/liveness raise the cap; x is self-attested (display-only).
    verifications: {
      phone: limits.verifications.phone,
      liveness: limits.verifications.liveness,
      x: !!xRow,
    },
    reputation: {
      tier: limits.reputationTier,
      multiplier: limits.reputationMultiplier,
    },
    unsuccessful_24h: unsuccessful24h,
    decrease_alert: unsuccessful24h >= LIMIT_DECREASE_ALERT_THRESHOLD,
    trust_mode_enabled: limits.source === 'trust',
    trust_preview: trustPreview,
  });
}
