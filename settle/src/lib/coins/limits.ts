/**
 * Effective trade limits — combines:
 *   - Base limits (default for accounts with no rep/coins/KYC)
 *   - Reputation tier multiplier (300–900 CIBIL scale, post-Phase-4)
 *   - Active coin_limit_unlocks row (L1/L2/L3/L4)
 *   - KYC gate (L4+ requires KYC)
 *
 * Reads run on every order create — keep it O(1) with one or two
 * indexed lookups.
 */

import { queryOne } from '@/lib/db';
import type { WaitlistActorType } from '@/lib/types/database';

export const BASE_LIMITS = {
  dailyUsd: 200,
  perTradeUsd: 50,
} as const;

export const COIN_LIMIT_TIERS = {
  L1: { dailyUsd: 500,    perTradeUsd: 150,   costCoins: 500,    requiresKyc: false },
  L2: { dailyUsd: 2_000,  perTradeUsd: 500,   costCoins: 2_000,  requiresKyc: false },
  L3: { dailyUsd: 10_000, perTradeUsd: 2_000, costCoins: 10_000, requiresKyc: false },
  L4: { dailyUsd: 50_000, perTradeUsd: 10_000, costCoins: 50_000, requiresKyc: true },
} as const;

export type CoinLimitTier = keyof typeof COIN_LIMIT_TIERS;

export interface EffectiveLimits {
  dailyUsd: number;
  perTradeUsd: number;
  source: 'base' | CoinLimitTier;
  expiresAt: Date | null;
  reputationMultiplier: number;
}

interface UnlockRow {
  tier: CoinLimitTier;
  daily_limit_usd: number;
  per_trade_usd: number;
  expires_at: Date;
}

/**
 * Compute the current effective limits for an actor. Combines:
 *   1. The most generous active coin_limit_unlocks row (or base).
 *   2. The reputation tier multiplier (looked up if a reputation_scores
 *      row exists; otherwise 1.0).
 *
 * NOTE: until Phase 4 lands the rebase, reputation tier names are the
 * legacy newcomer/bronze/.../diamond set. The multiplier table below
 * maps both legacy and new names so we can ship Phase 3 + 4 in any order.
 */
export async function getEffectiveLimits(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<EffectiveLimits> {
  const unlock = await queryOne<UnlockRow>(
    `SELECT tier, daily_limit_usd, per_trade_usd, expires_at
       FROM coin_limit_unlocks
      WHERE actor_type = $1 AND actor_id = $2 AND expires_at > NOW()
   ORDER BY daily_limit_usd DESC
      LIMIT 1`,
    [actorType, actorId],
  );

  const repMult = await getReputationMultiplier(actorId, actorType);

  if (!unlock) {
    return {
      dailyUsd: Math.floor(BASE_LIMITS.dailyUsd * repMult),
      perTradeUsd: Math.floor(BASE_LIMITS.perTradeUsd * repMult),
      source: 'base',
      expiresAt: null,
      reputationMultiplier: repMult,
    };
  }

  return {
    dailyUsd: Math.floor(unlock.daily_limit_usd * repMult),
    perTradeUsd: Math.floor(unlock.per_trade_usd * repMult),
    source: unlock.tier,
    expiresAt: unlock.expires_at,
    reputationMultiplier: repMult,
  };
}

/** Reputation tier → daily/per-trade multiplier. Tier name compatible
 *  with both legacy and new scale (see Phase 4 notes). */
const REP_TIER_MULTIPLIER: Record<string, number> = {
  // Legacy 0–1000 tiers
  risky: 0.25,
  newcomer: 1.0,
  bronze: 2.0,
  silver: 4.0,
  gold: 8.0,
  platinum: 12.0,
  diamond: 15.0,
  // Post-rebase 300–900 tiers
  restricted: 0.25,
  new: 1.0,
  // (bronze/silver/gold/platinum collide with the legacy names — same
  // multipliers apply, so we don't need to disambiguate.)
};

async function getReputationMultiplier(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<number> {
  const row = await queryOne<{ tier: string | null }>(
    `SELECT tier FROM reputation_scores
      WHERE entity_id = $1 AND entity_type = $2`,
    [actorId, actorType],
  );
  if (!row?.tier) return 1.0;
  return REP_TIER_MULTIPLIER[row.tier.toLowerCase()] ?? 1.0;
}

/**
 * USD volume traded by this actor in the trailing 24h, used to enforce
 * the daily limit. Pulls from completed orders.
 */
export async function getTrailing24hVolumeUsd(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<number> {
  const actorCol =
    actorType === 'merchant'
      ? '(merchant_id = $1 OR buyer_merchant_id = $1)'
      : 'user_id = $1';
  const row = await queryOne<{ vol: number }>(
    `SELECT COALESCE(SUM(fiat_amount), 0) AS vol
       FROM orders
      WHERE ${actorCol}
        AND status IN ('completed','accepted','escrowed','payment_sent')
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [actorId],
  );
  return Number(row?.vol ?? 0);
}

/**
 * Check whether a proposed trade is allowed under current limits.
 * Called from the order-create guard.
 */
export async function checkTradeAgainstLimits(args: {
  actorId: string;
  actorType: WaitlistActorType;
  fiatAmountUsd: number;
}): Promise<{
  allowed: boolean;
  reason?: 'PER_TRADE_EXCEEDED' | 'DAILY_EXCEEDED' | 'KYC_REQUIRED';
  limits: EffectiveLimits;
  trailing24hUsd: number;
}> {
  const limits = await getEffectiveLimits(args.actorId, args.actorType);

  if (args.fiatAmountUsd > limits.perTradeUsd) {
    return {
      allowed: false,
      reason: 'PER_TRADE_EXCEEDED',
      limits,
      trailing24hUsd: 0,
    };
  }

  const trailing = await getTrailing24hVolumeUsd(args.actorId, args.actorType);
  if (trailing + args.fiatAmountUsd > limits.dailyUsd) {
    return {
      allowed: false,
      reason: 'DAILY_EXCEEDED',
      limits,
      trailing24hUsd: trailing,
    };
  }

  return { allowed: true, limits, trailing24hUsd: trailing };
}
