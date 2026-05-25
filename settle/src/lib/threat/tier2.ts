// Tier 2 — heuristic weighted-score model. Pure function over a list of
// already-detected Signals + the positive-credit breakdown. Implements:
//   * weighted-sum with diminishing returns: factor = 1 / (1 + 0.5 * (n - 1))
//   * per-category caps (no single category can saturate the score)
//   * positive credits subtracted after caps, with their own cap
//   * clamp to [0, 100]
//
// This file is deliberately small and pure so it's straightforward to unit-test
// without any DB / IO setup.

import type { Signal, CategoryScores } from './types';
import { SIGNAL_WEIGHTS, CATEGORY_CAPS } from './weights';
import type { PositiveCreditBreakdown } from './positiveCredits';

export interface Tier2Result {
  score: number;
  by_category: CategoryScores;
  raw_contributions: Array<{ type: string; raw: number }>;
}

export function computeTier2(
  signals: Signal[],
  positive: PositiveCreditBreakdown,
): Tier2Result {
  const by_category: CategoryScores = {
    identity: 0, network: 0, device: 0, behavior: 0, graph: 0, profile: 0,
  };
  const raw_contributions: Array<{ type: string; raw: number }> = [];

  for (const sig of signals) {
    const weight = SIGNAL_WEIGHTS[sig.type];
    const occurrenceFactor = 1 / (1 + 0.5 * Math.max(0, sig.occurrence_count - 1));
    const contribution = weight * sig.severity_multiplier * occurrenceFactor;
    by_category[sig.category] += contribution;
    raw_contributions.push({ type: sig.type, raw: contribution });
  }

  // Apply caps per category — clamp on the high side only. Negative weights
  // (e.g. EMAIL_BREACH_EXPOSURE = -5) can pull a category below 0; we keep
  // that signed value so engagement-style signals shave the category score.
  let score = 0;
  for (const key of Object.keys(by_category) as Array<keyof CategoryScores>) {
    const capped = Math.min(CATEGORY_CAPS[key], by_category[key]);
    by_category[key] = capped;
    score += capped;
  }

  // Subtract positive credits AFTER caps (per design — engagement signals
  // shouldn't be eaten by a saturated category cap).
  score -= positive.total;

  // Final clamp to [0, 100].
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, by_category, raw_contributions };
}
