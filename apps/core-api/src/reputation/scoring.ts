/**
 * Pure scoring functions — no DB access.
 * Used by both merchant and user reputation calculators.
 */

import { TradeRecord } from './types';
import { PENALTIES, VOLUME_TIERS } from './constants';

// ============================================
// TIME DECAY
// ============================================

export function timeDecayFactor(date: Date): number {
  const days = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.5;
  if (days <= 90) return 0.2;
  return 0.1;
}

// ============================================
// RELIABILITY / COMPLETION
// ============================================

export function calcCompletionScore(
  trades: TradeRecord[],
  cancelledByField: 'merchant' | 'user'
): { raw: number; penalties: { type: string; points: number; count: number }[] } {
  if (trades.length === 0) return { raw: 0, penalties: [] };

  let completedWeighted = 0;
  let totalWeighted = 0;
  const penaltyCounts: Record<string, number> = {
    cancel_after_match: 0, dispute_lost: 0, refund: 0, timeout: 0, mark_paid_not_paid: 0,
  };

  for (const t of trades) {
    const decay = timeDecayFactor(t.created_at);
    const isCompleted = t.status === 'released' || t.status === 'completed';

    totalWeighted += decay;
    if (isCompleted) completedWeighted += decay;

    if (t.status === 'cancelled' && t.cancelled_by === cancelledByField) penaltyCounts.cancel_after_match++;
    if (t.dispute_lost) penaltyCounts.dispute_lost++;
    if (t.was_refunded) penaltyCounts.refund++;
    if (t.timed_out) penaltyCounts.timeout++;
    if (t.disputed && t.payment_sent_at && !t.dispute_raised_by_user && t.dispute_lost) {
      penaltyCounts.mark_paid_not_paid++;
    }
  }

  const completionRate = totalWeighted > 0 ? (completedWeighted / totalWeighted) * 1000 : 0;

  let penaltyPoints = 0;
  const penaltyList: { type: string; points: number; count: number }[] = [];
  for (const [type, count] of Object.entries(penaltyCounts)) {
    if (count > 0 && type in PENALTIES) {
      const pts = PENALTIES[type as keyof typeof PENALTIES] * count;
      penaltyPoints += pts;
      penaltyList.push({ type, points: pts, count });
    }
  }

  return { raw: Math.max(0, Math.min(1000, completionRate + penaltyPoints)), penalties: penaltyList };
}

// ============================================
// VOLUME
// ============================================

export function calcVolumeScore(trades: TradeRecord[]): number {
  let weightedVolume = 0;

  for (const t of trades) {
    if (t.status !== 'released' && t.status !== 'completed') continue;
    const decay = timeDecayFactor(t.created_at);
    const tier = VOLUME_TIERS.find(v => t.amount_usd < v.max) || VOLUME_TIERS[2];
    weightedVolume += t.amount_usd * tier.weight * decay;
  }

  if (weightedVolume <= 0) return 0;
  // Logarithmic: $100 = ~500, $10k = ~800, $100k = ~1000
  return Math.max(0, Math.min(1000, Math.log10(weightedVolume / 10 + 1) * 250));
}

// ============================================
// SPEED
// ============================================

export function calcSpeedScore(trades: TradeRecord[], avgResponseTimeMins: number): number {
  const completed = trades.filter(
    t => (t.status === 'released' || t.status === 'completed') && t.completed_at && t.created_at
  );

  if (completed.length === 0) return 500; // neutral

  const releaseTimes = completed
    .map(t => (t.completed_at!.getTime() - t.created_at.getTime()) / (1000 * 60))
    .filter(m => m > 0)
    .sort((a, b) => a - b);

  if (releaseTimes.length === 0) return 500;

  const median = releaseTimes[Math.floor(releaseTimes.length / 2)];
  // 0 min = 1000, 120 min = 0
  const releaseScore = Math.max(0, 1000 - (median / 0.12));
  const responseScore = Math.max(0, 1000 - (avgResponseTimeMins / 0.06));

  return Math.min(1000, releaseScore * 0.7 + responseScore * 0.3);
}

// ============================================
// PAYMENT SPEED (user-specific)
// ============================================

export function calcPaymentSpeedScore(trades: TradeRecord[]): number {
  const withPayment = trades.filter(
    t => t.source === 'offchain' && t.payment_sent_at && t.created_at &&
    ['completed', 'released', 'payment_sent', 'payment_confirmed'].includes(t.status)
  );

  if (withPayment.length === 0) {
    const onchain = trades.filter(t => (t.status === 'released' || t.status === 'completed') && t.completed_at);
    if (onchain.length === 0) return 500;
    const times = onchain.map(t => (t.completed_at!.getTime() - t.created_at.getTime()) / (1000 * 60)).filter(m => m > 0).sort((a, b) => a - b);
    if (times.length === 0) return 500;
    return Math.max(0, Math.min(1000, 1000 - (times[Math.floor(times.length / 2)] * 16.67)));
  }

  const times = withPayment.map(t => (t.payment_sent_at!.getTime() - t.created_at.getTime()) / (1000 * 60)).filter(m => m > 0).sort((a, b) => a - b);
  if (times.length === 0) return 500;
  // 0 min = 1000, 60 min = 0
  return Math.max(0, Math.min(1000, 1000 - (times[Math.floor(times.length / 2)] * 16.67)));
}

// ============================================
// LIQUIDITY (merchant-specific)
// ============================================

export function calcLiquidityScore(balance: number, trades: TradeRecord[], isOnline: boolean): number {
  const completed = trades.filter(t => t.status === 'released' || t.status === 'completed');
  if (completed.length === 0) return isOnline ? 300 : 100;

  const avgTradeSize = completed.reduce((sum, t) => sum + t.amount_usd, 0) / completed.length;
  if (avgTradeSize <= 0) return isOnline ? 30 : 10;

  let raw = Math.min(1000, (balance / avgTradeSize) * 200);
  if (isOnline) raw = Math.min(1000, raw + 200);
  return Math.max(0, raw);
}

// ============================================
// TRUST
// ============================================

export function calcTrustScore(
  ratings: { rating: number; created_at: Date }[],
  penaltyEvents: { score_change: number; created_at: Date }[],
  trades?: TradeRecord[]
): number {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const r of ratings) {
    const decay = timeDecayFactor(r.created_at);
    weightedSum += ((r.rating - 1) / 4) * 1000 * decay;
    weightTotal += decay;
  }

  const ratingScore = weightTotal > 0 ? weightedSum / weightTotal : 700;

  let penaltySum = 0;
  for (const e of penaltyEvents) {
    penaltySum += Math.abs(e.score_change) * timeDecayFactor(e.created_at);
  }

  // Frivolous dispute penalty (user-specific)
  let frivolousPenalty = 0;
  if (trades) {
    const raised = trades.filter(t => t.dispute_raised_by_user).length;
    const lost = trades.filter(t => t.dispute_lost).length;
    if (raised > 0) {
      const ratio = lost / raised;
      if (ratio > 0.5) frivolousPenalty = (ratio - 0.5) * 400;
    }
  }

  return Math.max(0, Math.min(1000, ratingScore - penaltySum - frivolousPenalty));
}

// ============================================
// ACTIVITY (user-specific)
// ============================================

export function calcActivityScore(trades: TradeRecord[]): number {
  if (trades.length === 0) return 0;
  let recentScore = 0;
  for (const t of trades) recentScore += timeDecayFactor(t.created_at);
  return Math.min(1000, Math.log10(recentScore + 1) * 600);
}

// ============================================
// CONSISTENCY (user-specific)
// ============================================

export function calcConsistencyScore(trades: TradeRecord[]): number {
  const completed = trades.filter(t => (t.status === 'released' || t.status === 'completed') && t.completed_at);
  if (completed.length < 3) return 500;

  const times = completed.map(t => (t.completed_at!.getTime() - t.created_at.getTime()) / (1000 * 60)).filter(m => m > 0);
  if (times.length < 3) return 500;

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 0;

  return Math.max(0, Math.min(1000, 1000 - (cv * 500)));
}

// ============================================
// WASH TRADING DETECTION
// ============================================

export function detectWashTrading(trades: TradeRecord[]): { penalty_factor: number; flags: string[] } {
  const flags: string[] = [];
  let penalty_factor = 1.0;

  const completed = trades.filter(t => t.status === 'released' || t.status === 'completed');
  if (completed.length < 5) return { penalty_factor: 1.0, flags: [] };

  // Repeated counterparties
  const pairCounts = new Map<string, number>();
  for (const t of completed) {
    if (!t.counterparty) continue;
    pairCounts.set(t.counterparty, (pairCounts.get(t.counterparty) || 0) + 1);
  }

  for (const [cp, count] of pairCounts) {
    const pct = count / completed.length;
    if (pct > 0.5 && count > 5) {
      flags.push(`Repeated counterparty ${cp.slice(0, 8)}... (${(pct * 100).toFixed(0)}%)`);
      penalty_factor = Math.min(penalty_factor, 1 - (pct - 0.3) * 0.6);
    }
  }

  // Small trade farming
  const smallFast = completed.filter(t => {
    if (t.amount_usd >= 10 || !t.completed_at) return false;
    return (t.completed_at.getTime() - t.created_at.getTime()) / (1000 * 60) < 5;
  });

  if (smallFast.length / completed.length > 0.6 && smallFast.length > 8) {
    flags.push(`Small trade farming (${smallFast.length} trades <$10 in <5min)`);
    penalty_factor = Math.min(penalty_factor, 0.5);
  }

  // Circular trading
  for (const [cp, count] of pairCounts) {
    if (count > 3) {
      flags.push(`Circular trading with ${cp.slice(0, 8)}...`);
      penalty_factor = Math.min(penalty_factor, 0.7);
      break;
    }
  }

  return { penalty_factor: Math.max(0.3, penalty_factor), flags };
}

// ============================================
// COLD START & TIER
// ============================================

export function applyColdStart(rawScore: number, totalTrades: number, threshold: number, baseline: number): { score: number; isColdStart: boolean } {
  if (totalTrades >= threshold) return { score: rawScore, isColdStart: false };
  const blend = totalTrades / threshold;
  return { score: baseline * (1 - blend) + rawScore * blend, isColdStart: true };
}

/**
 * Tier assignment — uses settle's 0-1000 scale tiers.
 * Our raw score is 0-100, so we multiply by 10 for the total_score stored in DB.
 * Tiers: newcomer(0-199), bronze(200-399), silver(400-599), gold(600-799), platinum(800-899), diamond(900+)
 */
export function assignTier(score: number, extraBadgeChecks?: { speed?: number; volume?: number; paymentSpeed?: number; activity?: number; totalTrades?: number }, entityType?: 'merchant' | 'user'): { tier: string; badges: string[]; score1000: number } {
  const badges: string[] = [];
  const score1000 = Math.round(score * 10); // Convert 0-100 → 0-1000

  let tier: string;
  if (score1000 >= 900) { tier = 'diamond'; }
  else if (score1000 >= 800) { tier = 'platinum'; }
  else if (score1000 >= 600) { tier = 'gold'; }
  else if (score1000 >= 400) { tier = 'silver'; }
  else if (score1000 >= 200) { tier = 'bronze'; }
  else { tier = 'newcomer'; }

  if (extraBadgeChecks) {
    if ((extraBadgeChecks.speed ?? 0) >= 900) badges.push('fast_trader');
    if ((extraBadgeChecks.paymentSpeed ?? 0) >= 900) badges.push('fast_trader');
    if ((extraBadgeChecks.volume ?? 0) >= 850) badges.push('high_volume');
    if ((extraBadgeChecks.totalTrades ?? 0) >= 100) badges.push('veteran');
    if ((extraBadgeChecks.totalTrades ?? 0) >= 50) badges.push('consistent');
  }

  return { tier, badges, score1000 };
}
