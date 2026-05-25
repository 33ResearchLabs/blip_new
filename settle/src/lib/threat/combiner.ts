// Combiner — logistic regression mapping (tier1_flag_count, tier2_score,
// tier3_anomaly) to a calibrated P(fraud) ∈ [0, 1]. Final score = round(P*100).
// Cold-start coefficients in `weights.ts`; Phase G's nightly job swaps them
// with calibrated learned values once enough admin labels accumulate.

import { COMBINER_COEFFS } from './weights';

function sigmoid(x: number): number {
  // Numerically-stable sigmoid: avoids overflow for large negative x.
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  } else {
    const z = Math.exp(x);
    return z / (1 + z);
  }
}

export interface CombinerInputs {
  tier1FlagCount: number;
  tier2Score: number;      // 0–100
  tier3Anomaly: number;    // 0–100; 0 in Phase A
}

export interface CombinerOutput {
  p_fraud: number;         // 0..1 calibrated probability
  score: number;           // 0..100 final score
}

export function combine(inputs: CombinerInputs): CombinerOutput {
  // Any Tier 1 hard rule short-circuits to 100. This is intentional: hard
  // rules are by definition things we never want to soft-score around.
  if (inputs.tier1FlagCount > 0) {
    return { p_fraud: 1, score: 100 };
  }

  const x =
    COMBINER_COEFFS.beta0
    + COMBINER_COEFFS.beta1_tier1_flags * inputs.tier1FlagCount
    + COMBINER_COEFFS.beta2_tier2_score * (inputs.tier2Score / 100)
    + COMBINER_COEFFS.beta3_tier3_anomaly * (inputs.tier3Anomaly / 100)
    + COMBINER_COEFFS.beta4_interaction * (inputs.tier2Score * inputs.tier3Anomaly / 10_000);

  const p = sigmoid(x);
  return { p_fraud: p, score: Math.round(p * 100) };
}
