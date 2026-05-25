// Graph-category signal detectors. Phase A scope: signals computable from
// existing referral data only. Community-density and wallet-graph signals
// land in Phase E (Louvain community detection).

import type { Signal, ScoringContext } from '../types';
import { categoryForSignal } from '../weights';

export interface GraphLookups {
  /** Total referrals the referee's referrer made in the last 24h. */
  referrerReferrals24h: number;
  /** Referee's own referrer chain length within a 1h window (BFS hop count). */
  referrerChainDepth1h: number;
  /** Tier 3 community anomaly score (0-100), 0 if not yet computed. */
  communityAnomaly: number;
  /** Member count of the actor's community. */
  communitySize: number;
  /** Edge density of the actor's community (0..1). */
  communityDensity: number;
}

export function detectGraphSignals(
  ctx: ScoringContext,
  lookups: GraphLookups,
): Signal[] {
  const out: Signal[] = [];

  // REFERRAL_RING_DIRECT — actor was referred by someone who has made ≥5
  // referrals in the last 24h. Strong farm signal.
  if (ctx.referredByRow && lookups.referrerReferrals24h >= 5) {
    out.push({
      type: 'REFERRAL_RING_DIRECT',
      category: categoryForSignal('REFERRAL_RING_DIRECT'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: {
        referrer_id: ctx.referredByRow.id,
        referrer_type: ctx.referredByRow.type,
        referrer_referrals_24h: lookups.referrerReferrals24h,
      },
    });
  }

  // SUSPICIOUS_REFERRER — referrer's own waitlist risk label is HIGH_RISK
  // or CRITICAL. Suspicion is transitive.
  if (
    ctx.referredByRow &&
    (ctx.referredByRow.wl_label === 'HIGH_RISK' ||
     ctx.referredByRow.wl_label === 'CRITICAL')
  ) {
    out.push({
      type: 'SUSPICIOUS_REFERRER',
      category: categoryForSignal('SUSPICIOUS_REFERRER'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: {
        referrer_id: ctx.referredByRow.id,
        referrer_label: ctx.referredByRow.wl_label,
        referrer_score: ctx.referredByRow.wl_score,
      },
    });
  }

  // REFERRAL_CHAIN_DEPTH_OUTLIER — actor sits in a referrer chain ≥3 hops
  // deep within a 1h window. Caps at 1 occurrence (chain itself is a single
  // structural signal — repeated chains don't double-count here).
  if (lookups.referrerChainDepth1h >= 3) {
    out.push({
      type: 'REFERRAL_CHAIN_DEPTH_OUTLIER',
      category: categoryForSignal('REFERRAL_CHAIN_DEPTH_OUTLIER'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: { chain_depth_within_1h: lookups.referrerChainDepth1h },
    });
  }

  // COMMUNITY_DENSITY_OUTLIER — Tier 3 community-anomaly score ≥40 (Phase E
  // graph rebuild marks this actor as part of a suspicious cluster).
  // Severity scales with the anomaly score so a marginal cluster contributes
  // less than a tight farm. Tier 3 anomaly is ALSO fed into the combiner
  // directly; this signal exists so the per-category breakdown surfaces it
  // and the Bayesian classifier can use it for REFERRAL_RING / BOT_FARM
  // hypotheses.
  if (lookups.communityAnomaly >= 40) {
    out.push({
      type: 'COMMUNITY_DENSITY_OUTLIER',
      category: categoryForSignal('COMMUNITY_DENSITY_OUTLIER'),
      severity_multiplier: Math.min(2, lookups.communityAnomaly / 50),
      occurrence_count: 1,
      evidence: {
        community_anomaly: lookups.communityAnomaly,
        community_size: lookups.communitySize,
        community_density: Math.round(lookups.communityDensity * 1000) / 1000,
      },
    });
  }

  return out;
}
