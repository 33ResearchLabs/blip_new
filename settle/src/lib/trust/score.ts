/**
 * Blip.money Trust Score — pure computation (no I/O).
 *
 * `computeTrustScore` is a deterministic function of an account's current state
 * (inputs gathered in ./repository.ts). It returns the 0–100 score, the tier it
 * falls into, and a line-item breakdown so the UI/admin can show *why* a score is
 * what it is. Keeping it pure makes it trivially unit-testable and side-effect
 * free — importing this module changes no runtime behaviour anywhere.
 */

import {
  INITIAL_TRUST_SCORE,
  TRUST_SCORE_MIN,
  TRUST_SCORE_MAX,
  TRUST_TIERS,
  type TrustTier,
  type TrustTierDef,
  VERIFICATION_POINTS,
  FIRST_TRADE_POINTS,
  PER_TRADE_REWARD_BANDS,
  TRADE_MILESTONE_BONUSES,
  TRADE_MILESTONE_MAX,
  VOLUME_BONUSES,
  VOLUME_BONUS_MAX,
  AGE_BONUSES,
  AGE_BONUS_MAX,
  COMPLETION_RATE_MIN_SAMPLE,
  COMPLETION_RATE_BANDS,
  CANCELLATION_POINTS,
  CANCELLATION_5_IN_30D_EXTRA,
  CANCELLATION_10_IN_30D_EXTRA,
  TIMEOUT_EXPIRED_POINTS,
  DISPUTE_OPENED_AGAINST_POINTS,
  DISPUTE_LOST_POINTS,
  DISPUTE_LOST_3_IN_90D_EXTRA,
  DISPUTE_LOST_5_IN_180D_EXTRA,
  INACTIVITY_DECAY,
} from './constants';

/** Everything needed to compute a Trust Score. Gathered from existing tables. */
export interface TrustScoreInputs {
  // Identity verification
  emailVerified: boolean;
  phoneVerified: boolean;
  kycVerified: boolean;
  faceVerified: boolean;
  /** Number of distinct social platforms verified (capped in scoring). */
  socialVerifiedCount: number;

  // Trading activity (lifetime)
  completedTrades: number;
  totalOrders: number;
  lifetimeVolumeUsd: number;
  accountAgeDays: number;

  // Behaviour (rolling windows — see constants.ts)
  cancelledInWindow: number;        // cancelled orders in last 30d
  expiredInWindow: number;          // expired/timed-out orders in last 30d
  disputesOpenedAgainstInWindow: number; // disputes opened against, last 90d
  disputesLostIn90d: number;
  disputesLostIn180d: number;

  /** Days since the account's most recent activity (for inactivity decay). */
  daysSinceLastActivity: number;

  /**
   * Sum of persisted manual/severe adjustments (fraud, fake-proof, chargeback,
   * abuse, admin recovery, …). 0 until the events ledger lands (later phase).
   */
  manualAdjustments: number;
}

export interface TrustScoreBreakdownItem {
  key: string;
  label: string;
  points: number;
}

export interface TrustScoreResult {
  score: number;          // clamped 0–100, rounded to 1 dp
  tier: TrustTier;
  tierDef: TrustTierDef;
  tradingAllowed: boolean;
  breakdown: TrustScoreBreakdownItem[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to 1 decimal place (per-trade rewards use fractional points). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Map a 0–100 score to its tier definition. */
export function scoreToTier(score: number): TrustTierDef {
  const s = clamp(score, TRUST_SCORE_MIN, TRUST_SCORE_MAX);
  // TRUST_TIERS is ordered high→low; first whose min the score meets wins.
  for (const t of TRUST_TIERS) {
    if (s >= t.min) return t;
  }
  return TRUST_TIERS[TRUST_TIERS.length - 1]; // T0 fallback
}

/** Sum cumulative-threshold bonuses (each threshold reached adds its points). */
function cumulative(
  value: number,
  bands: readonly { points: number }[],
  thresholds: readonly number[],
  cap: number,
): number {
  let total = 0;
  for (let i = 0; i < bands.length; i++) {
    if (value >= thresholds[i]) total += bands[i].points;
  }
  return Math.min(total, cap);
}

/**
 * Compute the Trust Score from gathered inputs. Pure; deterministic.
 */
export function computeTrustScore(inputs: TrustScoreInputs): TrustScoreResult {
  const items: TrustScoreBreakdownItem[] = [];
  const add = (key: string, label: string, points: number) => {
    if (points !== 0) items.push({ key, label, points: round1(points) });
  };

  // Base
  add('registration', 'Account registration', INITIAL_TRUST_SCORE);

  // ── Verification ──
  if (inputs.emailVerified) add('email', 'Email verified', VERIFICATION_POINTS.email);
  if (inputs.phoneVerified) add('phone', 'Phone verified', VERIFICATION_POINTS.phone);
  if (inputs.kycVerified)   add('kyc', 'KYC verified', VERIFICATION_POINTS.kyc);
  if (inputs.faceVerified)  add('face', 'Face verified', VERIFICATION_POINTS.face);
  const socials = clamp(inputs.socialVerifiedCount, 0, VERIFICATION_POINTS.socialMaxPlatforms);
  if (socials > 0) add('social', `Social verified (${socials})`, socials * VERIFICATION_POINTS.socialPerPlatform);

  // ── Trading rewards ──
  if (inputs.completedTrades >= 1) add('first_trade', 'First successful trade', FIRST_TRADE_POINTS);

  let perTrade = 0;
  for (const band of PER_TRADE_REWARD_BANDS) {
    const inBand = clamp(inputs.completedTrades - (band.fromTrade - 1), 0, band.toTrade - band.fromTrade + 1);
    perTrade += inBand * band.points;
  }
  add('trade_rewards', 'Successful-trade rewards', perTrade);

  add(
    'milestones',
    'Trade milestones',
    cumulative(
      inputs.completedTrades,
      TRADE_MILESTONE_BONUSES,
      TRADE_MILESTONE_BONUSES.map((b) => b.trades),
      TRADE_MILESTONE_MAX,
    ),
  );

  add(
    'volume',
    'Lifetime volume',
    cumulative(
      inputs.lifetimeVolumeUsd,
      VOLUME_BONUSES,
      VOLUME_BONUSES.map((b) => b.volumeUsd),
      VOLUME_BONUS_MAX,
    ),
  );

  add(
    'age',
    'Account age',
    cumulative(
      inputs.accountAgeDays,
      AGE_BONUSES,
      AGE_BONUSES.map((b) => b.days),
      AGE_BONUS_MAX,
    ),
  );

  // ── Completion rate (needs a minimum sample) ──
  if (inputs.totalOrders >= COMPLETION_RATE_MIN_SAMPLE) {
    const rate = inputs.completedTrades / inputs.totalOrders;
    const band = COMPLETION_RATE_BANDS.find((b) => rate >= b.minRate);
    if (band && band.points !== 0) add('completion_rate', `Completion rate ${(rate * 100).toFixed(1)}%`, band.points);
  }

  // ── Behavioural deductions (rolling windows) ──
  if (inputs.cancelledInWindow > 0) {
    add('cancellations', `Cancellations (30d): ${inputs.cancelledInWindow}`, inputs.cancelledInWindow * CANCELLATION_POINTS);
    if (inputs.cancelledInWindow >= 10) add('cancellations_10', '10+ cancellations in 30d', CANCELLATION_10_IN_30D_EXTRA);
    else if (inputs.cancelledInWindow >= 5) add('cancellations_5', '5+ cancellations in 30d', CANCELLATION_5_IN_30D_EXTRA);
  }
  if (inputs.expiredInWindow > 0) {
    add('timeouts', `Order timeouts (30d): ${inputs.expiredInWindow}`, inputs.expiredInWindow * TIMEOUT_EXPIRED_POINTS);
  }
  if (inputs.disputesOpenedAgainstInWindow > 0) {
    add('disputes_opened', `Disputes opened against (90d): ${inputs.disputesOpenedAgainstInWindow}`, inputs.disputesOpenedAgainstInWindow * DISPUTE_OPENED_AGAINST_POINTS);
  }
  if (inputs.disputesLostIn180d > 0) {
    add('disputes_lost', `Disputes lost (180d): ${inputs.disputesLostIn180d}`, inputs.disputesLostIn180d * DISPUTE_LOST_POINTS);
    if (inputs.disputesLostIn90d >= 3) add('disputes_lost_3', '3+ lost disputes in 90d', DISPUTE_LOST_3_IN_90D_EXTRA);
    if (inputs.disputesLostIn180d >= 5) add('disputes_lost_5', '5+ lost disputes in 180d', DISPUTE_LOST_5_IN_180D_EXTRA);
  }

  // ── Inactivity decay (single applicable tier) ──
  const decay = INACTIVITY_DECAY.find((d) => inputs.daysSinceLastActivity >= d.days);
  if (decay) add('inactivity', `Inactive ${inputs.daysSinceLastActivity}d`, decay.points);

  // ── Persisted manual/severe adjustments ──
  if (inputs.manualAdjustments !== 0) add('manual', 'Manual/severe adjustments', inputs.manualAdjustments);

  const raw = items.reduce((sum, i) => sum + i.points, 0);
  const score = round1(clamp(raw, TRUST_SCORE_MIN, TRUST_SCORE_MAX));
  const tierDef = scoreToTier(score);

  return {
    score,
    tier: tierDef.tier,
    tierDef,
    tradingAllowed: tierDef.tradingAllowed,
    breakdown: items,
  };
}
