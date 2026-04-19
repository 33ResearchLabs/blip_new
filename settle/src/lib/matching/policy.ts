/**
 * Tunable policy constants for the hybrid auction engine.
 * Every knob that could change behaviour lives here — not sprinkled in
 * scoring/filters.
 */

import type { SelectionMode } from './types';

/** Minimum success rate for a merchant to even be scored. */
export const MIN_SUCCESS_THRESHOLD = 0.90;       // 90 %

/** Maximum dispute rate a merchant can carry and still be eligible. */
export const MAX_DISPUTE_RATE = 0.10;            // 10 %

/** Maximum rate improvement over base before we treat the bid as bait. */
export const MAX_IMPROVEMENT_BPS = 200;          // 2 %

/** Worst-case rate (vs base) still allowed. Bids outside [-MAX, +MAX] reject. */
export const MAX_WORSE_BPS = 50;                 // 0.5 % — a bid WORSE than base by > 0.5% is dropped

/** Range used to normalise payout_score: 0 at base, 1 at this improvement. */
export const PAYOUT_NORMALIZE_BPS = 200;         // match MAX_IMPROVEMENT_BPS

/** Speed normalisation: etaSeconds ≤ FAST_ETA → 1, ≥ SLOW_ETA → 0. */
export const FAST_ETA_SECONDS = 30;
export const SLOW_ETA_SECONDS = 600;

/** Dispute penalty ramp: 1.0 penalty at this rate (0.1 = 10 %). */
export const DISPUTE_SATURATE_RATE = 0.20;

/** Trust-level gate. Only these tiers can bid. */
export const ALLOWED_TRUST_LEVELS: Array<
  'untrusted' | 'probation' | 'standard' | 'trusted'
> = ['probation', 'standard', 'trusted'];

/** Probation requires stricter success rate than standard. */
export const PROBATION_MIN_SUCCESS = 0.95;

/** Default bidding window in ms. */
export const DEFAULT_WINDOW_MS = 3000;
export const MIN_WINDOW_MS = 1000;
export const MAX_WINDOW_MS = 15_000;

/** Weights per user-selected mode. Each set sums semantically to how the
 *  final score uses them: the first 4 multiply positive components; the
 *  5th (dispute) subtracts. Always keep dispute weight heavy. */
export interface Weights {
  payout: number;
  rating: number;
  success: number;
  speed: number;
  dispute: number;     // penalty weight (subtracted)
}

export const MODE_WEIGHTS: Record<SelectionMode, Weights> = {
  fastest: {
    payout:  0.05,
    rating:  0.15,
    success: 0.20,
    speed:   0.55,
    dispute: 0.50,
  },
  recommended: {
    payout:  0.25,
    rating:  0.20,
    success: 0.30,
    speed:   0.15,
    dispute: 0.50,
  },
  best_value: {
    payout:  0.45,
    rating:  0.15,
    success: 0.25,
    speed:   0.10,
    dispute: 0.50,
  },
};
