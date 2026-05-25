// Top-level scoring orchestrator. Composes the pure scoring layers (Tier 1,
// Tier 2, combiner, Bayesian) and produces a `ThreatScoreResult` from a fully
// hydrated `ScoringContext` + pre-fetched lookups. Pure-ish — all the DB I/O
// is done by the caller (the service layer in `service.ts`) so this stays
// easy to unit-test.

import type {
  ScoringContext,
  ThreatScoreResult,
  Signal,
  Tier1Flag,
} from './types';
import { evaluateTier1, type Tier1Lookups } from './tier1';
import { detectIdentitySignals, type IdentityLookups } from './signals/identity';
import { detectNetworkSignals, type NetworkLookups } from './signals/network';
import { detectDeviceSignals, type DeviceLookups } from './signals/device';
import { detectBehaviorSignals, type BehaviorLookups } from './signals/behavior';
import { detectGraphSignals, type GraphLookups } from './signals/graph';
import { detectProfileSignals } from './signals/profile';
import { computePositiveCredits } from './positiveCredits';
import { computeTier2 } from './tier2';
import { combine } from './combiner';
import { classifyHypothesis } from './bayesianHypothesis';
import { labelForScore, confidenceForSignalDensity, MODEL_VERSION } from './weights';

export interface ScoringLookups {
  tier1: Tier1Lookups;
  identity: IdentityLookups;
  network: NetworkLookups;
  device: DeviceLookups;
  behavior: BehaviorLookups;
  graph: GraphLookups;
  // tier3Anomaly placeholder — Phase A always 0. Wired in Phase E.
  tier3Anomaly: number;
  communityId: string | null;
}

export function computeThreatScore(
  ctx: ScoringContext,
  lookups: ScoringLookups,
): ThreatScoreResult {
  // 1. Tier 1 — hard rules.
  const tier1_flags: Tier1Flag[] = evaluateTier1(ctx, lookups.tier1);

  // 2. Tier 2 — detect all per-actor signals across enabled categories.
  //    Phase A enabled identity/behavior/graph/profile; Phase B added network
  //    + email-breach; Phase C adds device (fingerprint reuse, bot-signature
  //    detection, timezone-geo mismatch).
  const signals: Signal[] = [
    ...detectIdentitySignals(ctx, lookups.identity),
    ...detectNetworkSignals(ctx, lookups.network),
    ...detectDeviceSignals(ctx, lookups.device),
    ...detectBehaviorSignals(ctx, lookups.behavior),
    ...detectGraphSignals(ctx, lookups.graph),
    ...detectProfileSignals(ctx),
  ];

  const positive = computePositiveCredits(ctx);
  const tier2 = computeTier2(signals, positive);

  // 3. Combiner — calibrated logistic regression.
  const combiner = combine({
    tier1FlagCount: tier1_flags.length,
    tier2Score: tier2.score,
    tier3Anomaly: lookups.tier3Anomaly,
  });

  // 4. Bayesian hypothesis classifier — surface fraud TYPE.
  const hypothesisResult = classifyHypothesis(signals, tier1_flags);

  // 5. Confidence from signal density across categories.
  const distinctCategoriesFired = new Set(signals.map(s => s.category)).size;
  const confidence = confidenceForSignalDensity(distinctCategoriesFired, signals.length);

  // 6. Label band.
  const label = labelForScore(combiner.score);

  return {
    score: combiner.score,
    label,
    hypothesis: hypothesisResult.hypothesis,
    hypothesis_confidence: hypothesisResult.confidence,
    hypothesis_margin: hypothesisResult.margin,
    per_hypothesis: hypothesisResult.per_hypothesis,
    hypothesis_contributors: hypothesisResult.top_contributors,
    confidence,
    by_category: tier2.by_category,
    signals,
    tier1_flags,
    tier2_score: tier2.score,
    tier3_anomaly: lookups.tier3Anomaly,
    community_id: lookups.communityId,
    model_version: MODEL_VERSION,
    computed_at: new Date().toISOString(),
  };
}
