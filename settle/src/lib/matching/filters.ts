/**
 * Hard filters run BEFORE scoring. A bid that fails any filter is dropped
 * — not penalised — so a merchant with a perfect reputation doesn't rescue
 * a bait rate, and vice versa.
 *
 * All predicates are pure.
 */

import {
  MIN_SUCCESS_THRESHOLD,
  MAX_DISPUTE_RATE,
  MAX_IMPROVEMENT_BPS,
  MAX_WORSE_BPS,
  ALLOWED_TRUST_LEVELS,
  PROBATION_MIN_SUCCESS,
} from './policy';
import { rateImprovementBps } from './scoring';
import type {
  AuctionContext,
  FilterDecision,
  MerchantMetrics,
  RawBid,
} from './types';

export function filterBid(
  bid: RawBid,
  metrics: MerchantMetrics,
  ctx: AuctionContext,
): FilterDecision {
  const now = Date.now();

  // 1. Trust tier.
  if (!ALLOWED_TRUST_LEVELS.includes(metrics.trustLevel)) {
    return { ok: false, reason: 'trust', detail: `trust_level=${metrics.trustLevel}` };
  }
  if (metrics.suspendedUntil && metrics.suspendedUntil.getTime() > now) {
    return { ok: false, reason: 'trust', detail: 'suspended' };
  }

  // 2. Merchant row must be active + online (bidder must be reachable to execute).
  if (metrics.merchantStatus !== 'active') {
    return { ok: false, reason: 'status', detail: metrics.merchantStatus };
  }
  if (!metrics.isOnline) {
    return { ok: false, reason: 'offline' };
  }

  // 3. Success rate gates (stricter on probation).
  const successFloor = metrics.trustLevel === 'probation'
    ? PROBATION_MIN_SUCCESS
    : MIN_SUCCESS_THRESHOLD;
  if (metrics.totalOrders >= 5 && metrics.successRate < successFloor) {
    return {
      ok: false,
      reason: 'success_rate',
      detail: `${(metrics.successRate * 100).toFixed(1)}% < ${(successFloor * 100).toFixed(0)}%`,
    };
  }

  // 4. Dispute ceiling.
  if (metrics.disputeRate > MAX_DISPUTE_RATE) {
    return {
      ok: false,
      reason: 'dispute_rate',
      detail: `${(metrics.disputeRate * 100).toFixed(1)}% > ${(MAX_DISPUTE_RATE * 100).toFixed(0)}%`,
    };
  }

  // 5. Merchant cap must cover the order.
  if (bid.maxAmount < ctx.cryptoAmount) {
    return {
      ok: false,
      reason: 'max_amount',
      detail: `cap=${bid.maxAmount} < order=${ctx.cryptoAmount}`,
    };
  }

  // 6. Liquidity — merchant must hold enough USDT to deliver.
  if (metrics.balance < ctx.cryptoAmount) {
    return {
      ok: false,
      reason: 'liquidity',
      detail: `balance=${metrics.balance} < ${ctx.cryptoAmount}`,
    };
  }

  // 7. Rate sanity — reject bait (too good) AND too-worse.
  const improvementBps = rateImprovementBps(bid.rate, ctx.baseRate, ctx.orderType);
  if (improvementBps > MAX_IMPROVEMENT_BPS) {
    return {
      ok: false,
      reason: 'deviation',
      detail: `improvement=${improvementBps}bps > ${MAX_IMPROVEMENT_BPS}bps (bait)`,
    };
  }
  if (improvementBps < -MAX_WORSE_BPS) {
    return {
      ok: false,
      reason: 'deviation_worse',
      detail: `improvement=${improvementBps}bps < -${MAX_WORSE_BPS}bps (worse than base)`,
    };
  }

  return { ok: true };
}
