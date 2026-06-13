/**
 * Blip.money Trust Score — constants (spec: Trust Score System Final v2).
 *
 * Trust Score is a 0–100 number measuring how trustworthy an account is. It is
 * computed automatically from identity verification + trading behaviour + age +
 * disputes (see ./score.ts). It buckets into tiers T0–T5, and each tier carries a
 * base trading limit (Trading Limit System spec) — the base that the stake
 * multiplier later multiplies.
 *
 * NOTE: this module is pure data + types. It is NOT yet wired into limit
 * enforcement — that is a later phase. Adding it changes no existing behaviour.
 */

export const TRUST_SCORE_MIN = 0;
export const TRUST_SCORE_MAX = 100;

/** Points granted on account registration — every account starts here. */
export const INITIAL_TRUST_SCORE = 20;

/** Score at/above which trading is allowed. Below this (T0) → restricted. */
export const TRADING_ALLOWED_MIN_SCORE = 20;

/* ───────────────────────── Tiers + base limits ─────────────────────────── */

export type TrustTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export interface TrustTierDef {
  tier: TrustTier;
  /** Inclusive score range [min, max]. */
  min: number;
  max: number;
  label: string;
  /** Trading allowed in this tier? Only T0 is restricted. */
  tradingAllowed: boolean;
  /** Base daily trading limit (USD) — the base the stake multiplier multiplies. */
  dailyUsd: number;
  /** Maximum single-order size (USD). */
  perOrderUsd: number;
  /** Maximum number of simultaneously-open orders. */
  maxOpenOrders: number;
}

/**
 * Trust-Tier base limits (Trading Limit System spec). Ordered high→low so a
 * simple scan returns the tier for a score. These are the BASE limits; the
 * stake multiplier and any automatic risk reductions apply on top (later phase).
 */
export const TRUST_TIERS: readonly TrustTierDef[] = [
  { tier: 'T5', min: 90, max: 100, label: 'Elite Trader',   tradingAllowed: true,  dailyUsd: 800, perOrderUsd: 500, maxOpenOrders: 20 },
  { tier: 'T4', min: 75, max: 89,  label: 'Excellent Trader',tradingAllowed: true,  dailyUsd: 500, perOrderUsd: 250, maxOpenOrders: 10 },
  { tier: 'T3', min: 60, max: 74,  label: 'Trusted Trader',  tradingAllowed: true,  dailyUsd: 250, perOrderUsd: 100, maxOpenOrders: 5  },
  { tier: 'T2', min: 40, max: 59,  label: 'Basic Trader',    tradingAllowed: true,  dailyUsd: 100, perOrderUsd: 50,  maxOpenOrders: 3  },
  { tier: 'T1', min: 20, max: 39,  label: 'New Trader',      tradingAllowed: true,  dailyUsd: 50,  perOrderUsd: 25,  maxOpenOrders: 2  },
  { tier: 'T0', min: 0,  max: 19,  label: 'Restricted',      tradingAllowed: false, dailyUsd: 0,   perOrderUsd: 0,   maxOpenOrders: 0  },
] as const;

/* ───────────────────────── Verification points ────────────────────────── */

export const VERIFICATION_POINTS = {
  email: 5,
  phone: 10,
  kyc: 15,
  face: 10,
  /** Per social platform verified. */
  socialPerPlatform: 2,
  /** Max social platforms that count. */
  socialMaxPlatforms: 3,
} as const;

/* ───────────────────────── Trading-activity points ────────────────────── */

/** Bonus for the first successful trade. */
export const FIRST_TRADE_POINTS = 2;

/**
 * Per-successful-trade reward, decaying by trade index to prevent trust farming.
 * Each band gives `points` for trades whose index falls in [fromTrade, toTrade].
 */
export const PER_TRADE_REWARD_BANDS = [
  { fromTrade: 1,   toTrade: 50,  points: 0.20 },
  { fromTrade: 51,  toTrade: 100, points: 0.10 },
  { fromTrade: 101, toTrade: 500, points: 0.02 },
  // trade 501+ → 0
] as const;

/** Milestone bonuses (cumulative as each threshold is reached). Max +15. */
export const TRADE_MILESTONE_BONUSES = [
  { trades: 10,  points: 2 },
  { trades: 50,  points: 3 },
  { trades: 100, points: 5 },
  { trades: 500, points: 5 },
] as const;
export const TRADE_MILESTONE_MAX = 15;

/** Lifetime volume bonuses (cumulative). Max +10. */
export const VOLUME_BONUSES = [
  { volumeUsd: 1_000,   points: 1 },
  { volumeUsd: 10_000,  points: 2 },
  { volumeUsd: 50_000,  points: 3 },
  { volumeUsd: 100_000, points: 4 },
] as const;
export const VOLUME_BONUS_MAX = 10;

/** Account-age bonuses (cumulative). Max +10. */
export const AGE_BONUSES = [
  { days: 30,  points: 1 },
  { days: 90,  points: 2 },
  { days: 180, points: 3 },
  { days: 365, points: 4 },
] as const;
export const AGE_BONUS_MAX = 10;

/**
 * Completion-rate impact (completed ÷ total orders). Evaluated only once the
 * account has at least COMPLETION_RATE_MIN_SAMPLE total orders, so a single
 * early cancellation doesn't crater a new account's score.
 */
export const COMPLETION_RATE_MIN_SAMPLE = 5;
export const COMPLETION_RATE_BANDS = [
  { minRate: 0.98,  points: 5 },
  { minRate: 0.95,  points: 3 },
  { minRate: 0.90,  points: 0 },
  { minRate: 0.80,  points: -5 },
  { minRate: 0.0,   points: -10 },
] as const;

/* ───────────────────────── Behavioural deductions ─────────────────────── */
/**
 * Behavioural penalties are evaluated over ROLLING WINDOWS (30/90/180 days), not
 * over all history. This is a deliberate, spec-aligned interpretation: the spec's
 * thresholds ("5 cancellations within 30 days", "3 lost disputes within 90 days")
 * are windowed, and a rolling window means penalties naturally heal as old
 * incidents age out — which is exactly what the spec's "recovery" rules intend,
 * without needing a stateful ledger. Severe/fraud penalties do NOT age out; they
 * are applied as persisted manual adjustments (later phase).
 */
export const CANCELLATION_POINTS = -1;              // per cancelled order in window
export const CANCELLATION_WINDOW_DAYS = 30;
export const CANCELLATION_5_IN_30D_EXTRA = -3;
export const CANCELLATION_10_IN_30D_EXTRA = -5;

export const TIMEOUT_EXPIRED_POINTS = -2;           // per expired/timed-out order in window
export const TIMEOUT_WINDOW_DAYS = 30;

export const DISPUTE_OPENED_AGAINST_POINTS = -1;    // per dispute opened against, in 90d window
export const DISPUTE_OPENED_WINDOW_DAYS = 90;

export const DISPUTE_LOST_POINTS = -5;              // per lost dispute in 180d window
export const DISPUTE_LOST_WINDOW_DAYS = 180;
export const DISPUTE_LOST_3_IN_90D_EXTRA = -5;
export const DISPUTE_LOST_5_IN_180D_EXTRA = -10;

/* ───────────────────────── Inactivity decay ───────────────────────────── */
/** Single applicable tier by days since last activity (highest that applies). */
export const INACTIVITY_DECAY = [
  { days: 365, points: -10 },
  { days: 180, points: -5 },
  { days: 90,  points: -2 },
] as const;

/* ──────────────── Automatic trading-limit reductions ──────────────────── */
/**
 * Limit reductions (Trading Limit System spec). Applied to the Trust-Tier ×
 * stake limit AFTER the stake multiplier. The MOST SEVERE applicable reduction
 * wins — they do NOT compound (a single account hitting two rules takes the
 * larger cut, not the product). Recovery is implicit: completion rate and the
 * dispute counts are evaluated over rolling windows, so as behaviour improves or
 * old incidents age out, the reduction shrinks on its own — matching the spec's
 * "90 days without disputes removes dispute reductions" recovery rule.
 *
 * Fraud investigation is a hard freeze (limits → 0), handled separately.
 */
export const LIMIT_REDUCTIONS = {
  completionRateBelow90: 0.25,
  completionRateBelow80: 0.50,
  lostDisputes3In90d: 0.25,
  lostDisputes5In180d: 0.50,
  confirmedChargeback: 0.75,
} as const;

/** Completion-rate thresholds for limit reductions. */
export const COMPLETION_RATE_REDUCTION_90 = 0.90;
export const COMPLETION_RATE_REDUCTION_80 = 0.80;
