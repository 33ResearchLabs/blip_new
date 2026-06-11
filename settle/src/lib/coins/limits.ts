/**
 * Effective trade limits — three-layer stack:
 *
 *   Layer 1 — KYC base tier (floor, always active):
 *     KYC 0 (none):   $25/trade,  $25/day
 *     KYC 1 (light):  $100/trade, $200/day
 *     KYC 2 (mid):    $500/trade, $1,000/day
 *     KYC 3 (full):   $2,000/trade, $5,000/day
 *
 *   Layer 2 — Coin unlock (buys a higher ceiling for 30 days):
 *     L1: $500 daily / $150/trade — costs 500 coins
 *     L2: $2,000 / $500           — costs 2,000 coins
 *     L3: $10,000 / $2,000        — costs 10,000 coins  (KYC 2+ required)
 *     L4: $50,000 / $10,000       — costs 50,000 coins  (KYC 3 required)
 *
 *   Layer 3 — Reputation multiplier (applied on top of whichever is higher):
 *     New/Newcomer: 1× · Bronze: 2× · Silver: 4× · Gold: 8× · Platinum: 12×
 *
 * The effective limit is max(KYC base, active coin unlock) × rep multiplier.
 * A coin unlock below the user's KYC base is silently ignored (KYC base wins).
 *
 * Reads run on every order create — keep it O(1) with two indexed lookups.
 */

import { query, queryOne } from '@/lib/db';
import type { WaitlistActorType } from '@/lib/types/database';
import { getStakeLimitFloor } from '@/lib/staking/economy';

/**
 * Two KYC states only (full KYC not available yet):
 *   0 = no KYC  — phone number not verified
 *   1 = light   — phone/email verified (all we check for now)
 *
 * KYC-0 accounts also have a time-based ramp:
 *   Days 1–2:  $25/trade,  $100/day
 *   Day 3+:    $100/trade, $300/day   (same as light KYC floor)
 */
export const KYC_BASE_LIMITS = {
  0: { dailyUsd: 100, perTradeUsd: 25  },   // days 1-2 (ramp applied in getEffectiveLimits)
  1: { dailyUsd: 300, perTradeUsd: 100 },
} as const;

/** No-KYC day-1/2 floor before the day-3 ramp kicks in. */
export const KYC0_INITIAL_LIMITS = { dailyUsd: 100, perTradeUsd: 25 } as const;
/** No-KYC day-3+ limits (same as KYC-1 floor intentionally). */
export const KYC0_RAMPED_LIMITS  = { dailyUsd: 300, perTradeUsd: 100 } as const;

/**
 * User-side base floor. Regular users start here regardless of KYC level or
 * account age — a flat $50/day, $25/trade. This is a *base*, not a ceiling:
 * the reputation multiplier, active coin unlocks, and approved limit-increase
 * requests still stack on top in getEffectiveLimits. Merchants are unaffected
 * and keep the KYC-derived base above.
 */
export const USER_BASE_LIMITS = { dailyUsd: 50, perTradeUsd: 25 } as const;

/**
 * Verification floors — raised by completing identity checks. Each is a *floor*
 * (like the KYC base): it lifts rawDaily/rawPerTrade before the reputation
 * multiplier and approved overrides stack on top. Liveness sits above phone, so
 * a user with both gets the liveness floor (we take the max). These apply to
 * users too — unlike the KYC base, which users bypass via USER_BASE_LIMITS — so
 * "Verify Phone / Verify Liveness" on the Trading Limits page actually moves the
 * cap. Read by getVerificationFloor from phone_verified / face_verified.
 */
export const VERIFY_LIMIT_FLOORS = {
  phone:    { dailyUsd: 300,  perTradeUsd: 100 },
  liveness: { dailyUsd: 1000, perTradeUsd: 300 },
} as const;

/**
 * Trailing-24h unsuccessful-order count (cancelled / disputed / expired) at or
 * above which the Trading Limits page shows an informational "limits may
 * decrease" warning. Display-only — no effect on the computed limits.
 */
export const LIMIT_DECREASE_ALERT_THRESHOLD = 2;

export type KycLevel = keyof typeof KYC_BASE_LIMITS;

/** Kept for backwards compat — equals KYC-0 floor */
export const BASE_LIMITS = KYC_BASE_LIMITS[0];

/**
 * Merchant per-side trade limits (USD, cumulative over the trailing 24h).
 * Single source of truth for both the Settings → Limits display AND the
 * enforcement on merchant order creation.
 *   buyUsd  — cap on volume where the merchant is the BUYER (sends fiat).
 *   sellUsd — cap on volume where the merchant is the SELLER (locks crypto).
 */
export const MERCHANT_SIDE_LIMITS = {
  buyUsd: 50,
  sellUsd: 100,
} as const;

/**
 * Coin unlock tiers — no KYC gate on any tier (full KYC not shipped yet).
 * Light KYC (level 1) is still required for L3/L4 as a basic spam guard.
 */
export const COIN_LIMIT_TIERS = {
  L1: { dailyUsd: 500,    perTradeUsd: 150,   costCoins: 500,    requiresKyc: 0 },
  L2: { dailyUsd: 2_000,  perTradeUsd: 500,   costCoins: 2_000,  requiresKyc: 0 },
  L3: { dailyUsd: 10_000, perTradeUsd: 2_000, costCoins: 10_000, requiresKyc: 1 },
  L4: { dailyUsd: 50_000, perTradeUsd: 10_000, costCoins: 50_000, requiresKyc: 1 },
} as const;

export type CoinLimitTier = keyof typeof COIN_LIMIT_TIERS;

export interface EffectiveLimits {
  dailyUsd: number;
  perTradeUsd: number;
  /** Which layer is driving the limit: KYC base, a verification floor, a staking floor, or a coin unlock. */
  source: 'kyc' | 'verification' | 'staking' | CoinLimitTier;
  /** KYC level that was read (0 or 1). */
  kycLevel: KycLevel;
  /** Days since account creation — used to show "limits increase on day 3" */
  accountAgeDays: number;
  expiresAt: Date | null;
  reputationMultiplier: number;
  /** Reputation tier name (null when unscored) — drives the "Trader Program" row. */
  reputationTier: string | null;
  /** Active identity verifications that raise the limit floor. */
  verifications: { phone: boolean; liveness: boolean };
}

interface UnlockRow {
  tier: CoinLimitTier;
  daily_limit_usd: number;
  per_trade_usd: number;
  expires_at: Date;
}

/**
 * Compute the current effective limits for an actor.
 *
 * Stack (highest wins per field):
 *   1. KYC-base tier — always the floor (no coins needed).
 *   2. Active coin_limit_unlocks row — overrides KYC base when higher.
 *      A coin unlock below the user's KYC floor is ignored.
 *   3. Reputation multiplier — applied on top of whichever is higher.
 */
export async function getEffectiveLimits(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<EffectiveLimits> {
  // Read KYC level, account age, verification flags, unlock, reputation, and
  // admin overrides concurrently.
  const { kycLevel, accountAgeDays, phoneVerified, faceVerified } =
    await getKycInfo(actorId, actorType);

  // Users get a flat base floor ($50/day, $25/trade) — reputation, coin
  // unlocks, and approved increases still raise it below. Merchants keep the
  // KYC-derived base with the KYC-0 time ramp (days 1–2 → lower, day 3+ →
  // same as KYC-1).
  const kycBase = actorType === 'user'
    ? USER_BASE_LIMITS
    : kycLevel === 0
      ? (accountAgeDays < 3 ? KYC0_INITIAL_LIMITS : KYC0_RAMPED_LIMITS)
      : KYC_BASE_LIMITS[kycLevel];

  // Verification floor — phone and/or liveness lift the base. Liveness sits
  // above phone, so take the max of whichever checks are complete.
  const verifyFloor = {
    dailyUsd: Math.max(
      phoneVerified ? VERIFY_LIMIT_FLOORS.phone.dailyUsd : 0,
      faceVerified  ? VERIFY_LIMIT_FLOORS.liveness.dailyUsd : 0,
    ),
    perTradeUsd: Math.max(
      phoneVerified ? VERIFY_LIMIT_FLOORS.phone.perTradeUsd : 0,
      faceVerified  ? VERIFY_LIMIT_FLOORS.liveness.perTradeUsd : 0,
    ),
  };

  const [unlock, stakeFloor, rep, overrides] = await Promise.all([
    queryOne<UnlockRow>(
      `SELECT tier, daily_limit_usd, per_trade_usd, expires_at
         FROM coin_limit_unlocks
        WHERE actor_type = $1 AND actor_id = $2 AND expires_at > NOW()
     ORDER BY daily_limit_usd DESC
        LIMIT 1`,
      [actorType, actorId],
    ),
    getStakeLimitFloor(actorType, actorId),
    getReputationInfo(actorId, actorType),
    getApprovedLimitOverrides(actorId, actorType),
  ]);
  const repMult = rep.multiplier;

  // Highest floor wins per field: KYC base vs verification floor vs staking
  // floor vs coin unlock. Then the reputation multiplier scales it, and an
  // approved override floors it.
  const unlockDaily    = unlock?.daily_limit_usd ?? 0;
  const unlockPerTrade = unlock?.per_trade_usd ?? 0;
  const rawDaily    = Math.max(kycBase.dailyUsd, verifyFloor.dailyUsd, stakeFloor.dailyUsd, unlockDaily);
  const rawPerTrade = Math.max(kycBase.perTradeUsd, verifyFloor.perTradeUsd, stakeFloor.perTradeUsd, unlockPerTrade);

  // Label the driving layer (by daily): coin unlock > staking > verification > kyc.
  let source: 'kyc' | 'verification' | 'staking' | CoinLimitTier = 'kyc';
  if (verifyFloor.dailyUsd > kycBase.dailyUsd) source = 'verification';
  if (stakeFloor.dailyUsd > Math.max(kycBase.dailyUsd, verifyFloor.dailyUsd)) {
    source = 'staking';
  }
  if (unlock && unlockDaily > Math.max(kycBase.dailyUsd, verifyFloor.dailyUsd, stakeFloor.dailyUsd)) {
    source = unlock.tier;
  }

  return {
    dailyUsd:    Math.max(Math.floor(rawDaily * repMult),    overrides.dailyUsd ?? 0),
    perTradeUsd: Math.max(Math.floor(rawPerTrade * repMult), overrides.perTradeUsd ?? 0),
    source,
    kycLevel,
    accountAgeDays,
    expiresAt: unlock && source === unlock.tier ? unlock.expires_at : null,
    reputationMultiplier: repMult,
    reputationTier: rep.tier,
    verifications: { phone: phoneVerified, liveness: faceVerified },
  };
}

/**
 * Per-actor limit override sourced from APPROVED limit-increase requests.
 * The latest approved request of each kind ('daily' / 'per_transaction')
 * is the granted cap for that dimension; null means no approved override.
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

async function getKycInfo(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<{
  kycLevel: KycLevel;
  accountAgeDays: number;
  phoneVerified: boolean;
  faceVerified: boolean;
}> {
  const table = actorType === 'merchant' ? 'merchants' : 'users';
  const col   = actorType === 'merchant' ? 'verification_level' : 'kyc_level';
  // phone_verified (users: 154, merchants: 149) and face_verified (users: 163,
  // merchants: 164) exist on both tables — COALESCE guards pre-migration rows.
  const row   = await queryOne<{
    lvl: number;
    created_at: Date;
    phone_verified: boolean | null;
    face_verified: boolean | null;
  }>(
    `SELECT COALESCE(${col}, 0) AS lvl, created_at,
            COALESCE(phone_verified, FALSE) AS phone_verified,
            COALESCE(face_verified, FALSE)  AS face_verified
       FROM ${table} WHERE id = $1`,
    [actorId],
  );
  const raw = row?.lvl ?? 0;
  const kycLevel = Math.min(1, Math.max(0, raw)) as KycLevel;
  const accountAgeDays = row?.created_at
    ? Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000)
    : 0;
  return {
    kycLevel,
    accountAgeDays,
    phoneVerified: !!row?.phone_verified,
    faceVerified: !!row?.face_verified,
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

async function getReputationInfo(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<{ tier: string | null; multiplier: number }> {
  const row = await queryOne<{ tier: string | null }>(
    `SELECT tier FROM reputation_scores
      WHERE entity_id = $1 AND entity_type = $2`,
    [actorId, actorType],
  );
  const tier = row?.tier ?? null;
  if (!tier) return { tier: null, multiplier: 1.0 };
  return { tier, multiplier: REP_TIER_MULTIPLIER[tier.toLowerCase()] ?? 1.0 };
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
 * Count of unsuccessful orders (cancelled / disputed / expired) for this actor
 * in the trailing 24h. Drives the informational "limits may decrease" warning
 * on the Trading Limits page — DISPLAY ONLY, it does not change any limit.
 * Same actor-role SQL as getTrailing24hVolumeUsd.
 */
export async function getUnsuccessful24hCount(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<number> {
  const actorCol =
    actorType === 'merchant'
      ? '(merchant_id = $1 OR buyer_merchant_id = $1)'
      : 'user_id = $1';
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM orders
      WHERE ${actorCol}
        AND status IN ('cancelled','disputed','expired')
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [actorId],
  );
  return Number(row?.n ?? 0);
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
