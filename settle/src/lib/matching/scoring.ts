/**
 * Pure scoring functions for the auction engine.
 *
 * Every function here is deterministic and side-effect-free so it can be
 * unit-tested in isolation and re-run offline for dispute review.
 */

import {
  MODE_WEIGHTS,
  PAYOUT_NORMALIZE_BPS,
  FAST_ETA_SECONDS,
  SLOW_ETA_SECONDS,
  DISPUTE_SATURATE_RATE,
} from './policy';
import type {
  AuctionContext,
  MerchantMetrics,
  RawBid,
  ScoreBreakdown,
  ScoredBid,
  OrderType,
} from './types';

/** Clamp a float into [0, 1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/**
 * Rate improvement relative to base, expressed in basis points.
 * Positive = better for the user, negative = worse.
 *
 *   SELL: user sells USDT → higher fiat per USDT is better
 *   BUY:  user buys USDT  → lower fiat per USDT is better
 */
export function rateImprovementBps(
  bidRate: number,
  baseRate: number,
  type: OrderType,
): number {
  if (baseRate <= 0) return 0;
  const delta = type === 'sell'
    ? (bidRate - baseRate) / baseRate
    : (baseRate - bidRate) / baseRate;
  return Math.round(delta * 10_000);
}

export function payoutScore(
  bidRate: number,
  baseRate: number,
  type: OrderType,
): number {
  const improvementBps = rateImprovementBps(bidRate, baseRate, type);
  if (improvementBps <= 0) return 0;                 // at base or worse
  return clamp01(improvementBps / PAYOUT_NORMALIZE_BPS);
}

export function ratingScore(avgRating: number | null, ratingCount: number): number {
  if (avgRating == null) return 0.5;                 // neutral until data exists
  // Dampen raters with < 10 reviews so 1 five-star bid can't spike scoring.
  const confidence = clamp01(ratingCount / 10);
  const raw = clamp01(avgRating / 5);
  // Pull toward 0.5 (neutral) when confidence is low.
  return 0.5 + (raw - 0.5) * confidence;
}

export function successScore(successRate: number, totalOrders: number): number {
  // Cold-start merchants get 0.5 until they have a few orders on record.
  if (totalOrders < 5) return 0.5;
  return clamp01(successRate);
}

export function speedScore(etaSeconds: number): number {
  if (!Number.isFinite(etaSeconds) || etaSeconds <= 0) return 0;
  if (etaSeconds <= FAST_ETA_SECONDS) return 1;
  if (etaSeconds >= SLOW_ETA_SECONDS) return 0;
  return 1 - (etaSeconds - FAST_ETA_SECONDS) / (SLOW_ETA_SECONDS - FAST_ETA_SECONDS);
}

export function disputePenalty(disputeRate: number): number {
  // Saturates at DISPUTE_SATURATE_RATE.
  return clamp01(disputeRate / DISPUTE_SATURATE_RATE);
}

export function scoreBid(
  raw: RawBid,
  metrics: MerchantMetrics,
  ctx: AuctionContext,
): ScoredBid {
  const breakdown: ScoreBreakdown = {
    payout:  payoutScore(raw.rate, ctx.baseRate, ctx.orderType),
    rating:  ratingScore(metrics.avgRating, metrics.ratingCount),
    success: successScore(metrics.successRate, metrics.totalOrders),
    speed:   speedScore(raw.etaSeconds),
    dispute: disputePenalty(metrics.disputeRate),
  };

  const w = MODE_WEIGHTS[ctx.mode];
  const score =
      breakdown.payout  * w.payout
    + breakdown.rating  * w.rating
    + breakdown.success * w.success
    + breakdown.speed   * w.speed
    - breakdown.dispute * w.dispute;

  return { raw, metrics, score, breakdown };
}

/** Sort desc by score with deterministic tiebreak (merchantId asc). */
export function rankBids(bids: ScoredBid[]): ScoredBid[] {
  return [...bids].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.metrics.merchantId.localeCompare(b.metrics.merchantId);
  });
}
