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

import { query, queryOne } from '@/lib/db';
import type { WaitlistActorType } from '@/lib/types/database';

export const BASE_LIMITS = {
  dailyUsd: 50,
  perTradeUsd: 25,
} as const;

/**
 * Merchant per-side trade limits (USD, cumulative over the trailing 24h).
 * Single source of truth for both the Settings → Limits display AND the
 * enforcement on merchant order creation. Change these two numbers to adjust
 * the caps everywhere — nothing else hardcodes them.
 *   buyUsd  — cap on volume where the merchant is the BUYER (sends fiat).
 *   sellUsd — cap on volume where the merchant is the SELLER (locks crypto).
 */
export const MERCHANT_SIDE_LIMITS = {
  buyUsd: 50,
  sellUsd: 100,
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
  // Three independent indexed reads — run concurrently to keep this O(1)-ish
  // on the order-create hot path.
  const [unlock, repMult, overrides] = await Promise.all([
    queryOne<UnlockRow>(
      `SELECT tier, daily_limit_usd, per_trade_usd, expires_at
         FROM coin_limit_unlocks
        WHERE actor_type = $1 AND actor_id = $2 AND expires_at > NOW()
     ORDER BY daily_limit_usd DESC
        LIMIT 1`,
      [actorType, actorId],
    ),
    getReputationMultiplier(actorId, actorType),
    getApprovedLimitOverrides(actorId, actorType),
  ]);

  // Base/tier cap, scaled by reputation. The admin-approved override (see
  // getApprovedLimitOverrides) then raises — never lowers — the result via
  // Math.max, so an approval grants the requested cap without disturbing
  // the coins/reputation math for anyone else.
  const baseDaily = unlock ? unlock.daily_limit_usd : BASE_LIMITS.dailyUsd;
  const basePerTrade = unlock ? unlock.per_trade_usd : BASE_LIMITS.perTradeUsd;

  return {
    dailyUsd: Math.max(Math.floor(baseDaily * repMult), overrides.dailyUsd ?? 0),
    perTradeUsd: Math.max(Math.floor(basePerTrade * repMult), overrides.perTradeUsd ?? 0),
    source: unlock ? unlock.tier : 'base',
    expiresAt: unlock ? unlock.expires_at : null,
    reputationMultiplier: repMult,
  };
}

/**
 * Per-actor limit override sourced from APPROVED limit-increase requests.
 * The latest approved request of each kind ('daily' / 'per_transaction')
 * is the granted cap for that dimension; null means no approved override.
 * An admin approving a request in the Support Tickets → Limit Requests
 * view is what creates these rows (PATCH /api/admin/limit-requests/:id).
 */
export async function getApprovedLimitOverrides(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<{ dailyUsd: number | null; perTradeUsd: number | null }> {
  const rows = await query<{ kind: string; requested_limit_usd: number }>(
    `SELECT DISTINCT ON (kind) kind, requested_limit_usd
       FROM limit_increase_requests
      WHERE actor_type = $1 AND actor_id = $2 AND status = 'approved'
   ORDER BY kind, reviewed_at DESC NULLS LAST`,
    [actorType, actorId],
  );
  let dailyUsd: number | null = null;
  let perTradeUsd: number | null = null;
  for (const r of rows) {
    if (r.kind === 'daily') dailyUsd = Number(r.requested_limit_usd);
    else if (r.kind === 'per_transaction') perTradeUsd = Number(r.requested_limit_usd);
  }
  return { dailyUsd, perTradeUsd };
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
 * the (USD-denominated) daily limit. Pulls from completed orders.
 *
 * Sums crypto_amount, NOT fiat_amount: the crypto leg is a USD stablecoin
 * (USDT ≈ $1), so crypto_amount is the USD notional. fiat_amount is stored
 * in each order's local currency (INR/AED), so summing it would (a) compare
 * a fiat number against a USD cap and (b) silently add INR + AED together
 * across corridors. crypto_amount normalizes both problems.
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
    `SELECT COALESCE(SUM(crypto_amount), 0) AS vol
       FROM orders
      WHERE ${actorCol}
        AND status IN ('completed','accepted','escrowed','payment_sent')
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [actorId],
  );
  return Number(row?.vol ?? 0);
}

/**
 * The largest single trade (USD notional) this actor made in the trailing
 * 24h. Used purely for display — the per-transaction limit isn't a
 * cumulative spend, so the "usage" we show against it is the biggest single
 * order, not a running total. Same crypto_amount / actor-role logic as
 * getTrailing24hVolumeUsd.
 */
export async function getLargestTrade24hUsd(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<number> {
  const actorCol =
    actorType === 'merchant'
      ? '(merchant_id = $1 OR buyer_merchant_id = $1)'
      : 'user_id = $1';
  const row = await queryOne<{ mx: number }>(
    `SELECT COALESCE(MAX(crypto_amount), 0) AS mx
       FROM orders
      WHERE ${actorCol}
        AND status IN ('completed','accepted','escrowed','payment_sent')
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [actorId],
  );
  return Number(row?.mx ?? 0);
}

/**
 * The merchant's trailing-24h USD volume, split by the side the merchant
 * played in each order. Crypto is a USD stablecoin (USDT ≈ $1), so
 * crypto_amount is the USD notional (see getTrailing24hVolumeUsd).
 *
 * Role rules mirror resolveTradeRole (handleOrderAction.ts):
 *   - SELLER (sell volume): merchant_id = M, AND (it's M2M OR a BUY order).
 *       · M2M: merchant_id is ALWAYS the seller.
 *       · non-M2M BUY order: the merchant is the seller (locks crypto). This
 *         also covers merchant self-broadcast SELL, stored as type='buy'.
 *   - BUYER (buy volume): buyer_merchant_id = M (M2M buyer / self-broadcast
 *       BUY), OR a non-M2M SELL order where merchant_id = M (merchant buys).
 */
export async function getMerchant24hSideVolumeUsd(
  merchantId: string,
): Promise<{ buyUsd: number; sellUsd: number }> {
  const row = await queryOne<{ buy_usd: number; sell_usd: number }>(
    `SELECT
        COALESCE(SUM(crypto_amount) FILTER (
          WHERE buyer_merchant_id = $1
             OR (merchant_id = $1 AND buyer_merchant_id IS NULL AND type = 'sell')
        ), 0) AS buy_usd,
        COALESCE(SUM(crypto_amount) FILTER (
          WHERE merchant_id = $1
            AND (buyer_merchant_id IS NOT NULL OR type = 'buy')
        ), 0) AS sell_usd
       FROM orders
      WHERE (merchant_id = $1 OR buyer_merchant_id = $1)
        AND status IN ('completed','accepted','escrowed','payment_sent')
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [merchantId],
  );
  return {
    buyUsd: Number(row?.buy_usd ?? 0),
    sellUsd: Number(row?.sell_usd ?? 0),
  };
}

/**
 * Check a proposed merchant trade against the per-side (buy/sell) cap.
 * Cumulative over 24h: blocks when existing side volume + this order would
 * exceed the cap. Called from the merchant order-create guard.
 */
export async function checkMerchantSideLimit(args: {
  merchantId: string;
  side: 'buy' | 'sell';
  orderAmountUsd: number;
}): Promise<{
  allowed: boolean;
  reason?: 'BUY_LIMIT_EXCEEDED' | 'SELL_LIMIT_EXCEEDED';
  limitUsd: number;
  usedUsd: number;
}> {
  const { buyUsd, sellUsd } = await getMerchant24hSideVolumeUsd(args.merchantId);
  const limitUsd =
    args.side === 'buy' ? MERCHANT_SIDE_LIMITS.buyUsd : MERCHANT_SIDE_LIMITS.sellUsd;
  const usedUsd = args.side === 'buy' ? buyUsd : sellUsd;

  if (usedUsd + args.orderAmountUsd > limitUsd) {
    return {
      allowed: false,
      reason: args.side === 'buy' ? 'BUY_LIMIT_EXCEEDED' : 'SELL_LIMIT_EXCEEDED',
      limitUsd,
      usedUsd,
    };
  }
  return { allowed: true, limitUsd, usedUsd };
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
