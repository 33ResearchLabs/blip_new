/**
 * Reputation Calculator — Merchant + User
 *
 * Computes reputation, persists to:
 *   - reputation_scores (full breakdown)
 *   - merchants.reputation_score / users.reputation_score (fast access)
 *   - reputation_history (snapshot)
 *
 * Core API's matching engine reads merchants.reputation_score directly — zero joins.
 */

import { ReputationResult } from './types';
import { MERCHANT_WEIGHTS, USER_WEIGHTS, MERCHANT_COLD_START, USER_COLD_START } from './constants';
import { cacheGet, cacheSet } from './cache';
import {
  resolveMerchant, resolveUser,
  fetchMerchantTrades, fetchUserTrades,
  fetchRatings, fetchPenaltyEvents,
  persistReputationScore,
} from './queries';
import {
  calcCompletionScore, calcVolumeScore, calcSpeedScore, calcPaymentSpeedScore,
  calcLiquidityScore, calcTrustScore, calcActivityScore, calcConsistencyScore,
  detectWashTrading, applyColdStart, assignTier,
} from './scoring';

// ============================================
// MERCHANT REPUTATION
// ============================================

export async function calculateMerchantReputation(merchantId: string): Promise<ReputationResult | null> {
  const cached = cacheGet(`m:${merchantId}`);
  if (cached) return cached;

  const merchant = await resolveMerchant(merchantId);
  if (!merchant) return null;

  const [trades, ratings, events] = await Promise.all([
    fetchMerchantTrades(merchant.id, merchant.wallet_address),
    fetchRatings(merchant.id, 'merchant'),
    fetchPenaltyEvents(merchant.id, 'merchant'),
  ]);

  const wash = detectWashTrading(trades);
  const { raw: reliabilityRaw, penalties } = calcCompletionScore(trades, 'merchant');
  const volumeRaw = calcVolumeScore(trades);
  const speedRaw = calcSpeedScore(trades, merchant.avg_response_time_mins);
  const liquidityRaw = calcLiquidityScore(merchant.balance, trades, merchant.is_online);
  const trustRaw = calcTrustScore(ratings, events);

  const W = MERCHANT_WEIGHTS;
  // Sub-scores are 0-1000. Weighted sum / 100 gives 0-1000 total.
  let total = (reliabilityRaw * W.reliability + volumeRaw * W.volume + speedRaw * W.speed + liquidityRaw * W.liquidity + trustRaw * W.trust) / 100;
  total *= wash.penalty_factor;

  const { score, isColdStart } = applyColdStart(total, trades.length, MERCHANT_COLD_START.threshold, MERCHANT_COLD_START.baseline);
  const { tier, badges } = assignTier(score, { speed: speedRaw, volume: volumeRaw, totalTrades: trades.length }, 'merchant');

  const result: ReputationResult = {
    entity_id: merchant.id,
    entity_type: 'merchant',
    wallet_address: merchant.wallet_address,
    total_score: Math.round(score),
    tier, badges,
    breakdown: {
      reliability: { raw: Math.round(reliabilityRaw), weighted: Math.round(reliabilityRaw * W.reliability / 100), weight: W.reliability },
      volume: { raw: Math.round(volumeRaw), weighted: Math.round(volumeRaw * W.volume / 100), weight: W.volume },
      speed: { raw: Math.round(speedRaw), weighted: Math.round(speedRaw * W.speed / 100), weight: W.speed },
      liquidity: { raw: Math.round(liquidityRaw), weighted: Math.round(liquidityRaw * W.liquidity / 100), weight: W.liquidity },
      trust: { raw: Math.round(trustRaw), weighted: Math.round(trustRaw * W.trust / 100), weight: W.trust },
    },
    penalties, abuse_flags: wash.flags, wash_trading_detected: wash.flags.length > 0,
    trade_count: trades.length, cold_start: isColdStart,
    calculated_at: new Date().toISOString(),
  };

  // Persist to DB (writes to reputation_scores + merchants.reputation_score)
  persistReputationScore(merchant.id, 'merchant', result).catch(() => {});

  cacheSet(`m:${merchantId}`, result);
  cacheSet(`m:${merchant.wallet_address}`, result);
  return result;
}

// ============================================
// USER REPUTATION
// ============================================

export async function calculateUserReputation(userId: string): Promise<ReputationResult | null> {
  const cached = cacheGet(`u:${userId}`);
  if (cached) return cached;

  const user = await resolveUser(userId);
  if (!user) return null;

  const [trades, ratings, events] = await Promise.all([
    fetchUserTrades(user.id, user.wallet_address),
    fetchRatings(user.id, 'user'),
    fetchPenaltyEvents(user.id, 'user'),
  ]);

  const wash = detectWashTrading(trades);
  const { raw: completionRaw, penalties } = calcCompletionScore(trades, 'user');
  const paymentSpeedRaw = calcPaymentSpeedScore(trades);
  const trustRaw = calcTrustScore(ratings, events, trades);
  const activityRaw = calcActivityScore(trades);
  const consistencyRaw = calcConsistencyScore(trades);

  const W = USER_WEIGHTS;
  let total = (completionRaw * W.completion + paymentSpeedRaw * W.payment_speed + trustRaw * W.trust + activityRaw * W.activity + consistencyRaw * W.consistency) / 100;
  total *= wash.penalty_factor;

  const { score, isColdStart } = applyColdStart(total, trades.length, USER_COLD_START.threshold, USER_COLD_START.baseline);
  const { tier, badges } = assignTier(score, { paymentSpeed: paymentSpeedRaw, activity: activityRaw, totalTrades: trades.length }, 'user');

  const result: ReputationResult = {
    entity_id: user.id,
    entity_type: 'user',
    wallet_address: user.wallet_address,
    total_score: Math.round(score),
    tier, badges,
    breakdown: {
      completion: { raw: Math.round(completionRaw), weighted: Math.round(completionRaw * W.completion / 100), weight: W.completion },
      payment_speed: { raw: Math.round(paymentSpeedRaw), weighted: Math.round(paymentSpeedRaw * W.payment_speed / 100), weight: W.payment_speed },
      trust: { raw: Math.round(trustRaw), weighted: Math.round(trustRaw * W.trust / 100), weight: W.trust },
      activity: { raw: Math.round(activityRaw), weighted: Math.round(activityRaw * W.activity / 100), weight: W.activity },
      consistency: { raw: Math.round(consistencyRaw), weighted: Math.round(consistencyRaw * W.consistency / 100), weight: W.consistency },
    },
    penalties, abuse_flags: wash.flags, wash_trading_detected: wash.flags.length > 0,
    trade_count: trades.length, cold_start: isColdStart,
    calculated_at: new Date().toISOString(),
  };

  persistReputationScore(user.id, 'user', result).catch(() => {});

  cacheSet(`u:${userId}`, result);
  if (user.wallet_address) cacheSet(`u:${user.wallet_address}`, result);
  return result;
}
