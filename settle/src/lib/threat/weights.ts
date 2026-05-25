// All scoring constants in one place so they're trivial to tune without
// hunting through the codebase. Constants here ship as the cold-start config;
// Phase G's nightly calibration job will produce a `weights_overrides.json`
// that this module reads in production to apply learned adjustments.

import type { CategoryScores, SignalCategory, SignalType, RiskLabel } from './types';

export const MODEL_VERSION = 'phase-a-1.0.0';

/** Per-signal base weights. Multi-tier system favours small additive weights
 *  with category caps over single dominant signals — keeps any one detector
 *  from over-driving the score. */
export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  // identity
  DISPOSABLE_EMAIL_DOMAIN: 30,
  PLUS_ALIASED_EMAIL: 8,
  EMAIL_BREACH_EXPOSURE: -5,     // mild positive — addresses in breaches are real-world
  EMAIL_BREACH_RECENT: 10,
  EMAIL_AGE_FRESH: 12,
  SHARED_WALLET: 35,
  WALLET_NO_ONCHAIN_HISTORY: 10,
  WALLET_MIXER_PROXIMITY: 40,
  MISSING_EMAIL_VERIFY_AFTER_24H: 5,
  // network
  IP_DATACENTER_ASN: 20,
  IP_VPN_DETECTED: 15,
  IP_TOR_EXIT: 35,
  IP_HIGH_FRAUD_SCORE: 30,       // multiplier comes from IPQS fraud_score/100
  IP_GEO_COUNTRY_MISMATCH: 12,
  IP_CLUSTER: 25,
  SIGNUP_BURST: 18,
  // device
  DEVICE_FP_REUSE: 30,
  DEVICE_FP_LOW_ENTROPY: 15,
  TLS_JA3_KNOWN_BOT: 25,
  TIMEZONE_GEO_MISMATCH: 10,
  USER_AGENT_INCONSISTENT: 8,
  // behavior
  FORM_FILL_INSTANT: 20,
  MOUSE_ENTROPY_ZERO: 18,
  KEYSTROKE_CADENCE_BOT: 15,
  COPY_PASTE_CRITICAL: 6,
  RAPID_TASK_COMPLETION: 12,
  // graph
  REFERRAL_RING_DIRECT: 40,
  SUSPICIOUS_REFERRER: 15,
  REFERRAL_CHAIN_DEPTH_OUTLIER: 10,
  COMMUNITY_DENSITY_OUTLIER: 20,
  WALLET_GRAPH_OVERLAP: 12,
  // profile
  EMPTY_DISPLAY_NAME: 4,
  LOW_NAME_ENTROPY: 6,
  IMPLAUSIBLE_VOLUME: 15,
  MISSING_BUSINESS_NAME: 12,
  LOW_BIZNAME_ENTROPY: 8,
  MISSING_COUNTRY: 6,
};

/** Per-category caps. Once a category's accumulated contribution reaches the
 *  cap, additional signals in that category do nothing. Prevents one fraud
 *  vector from saturating the overall score. */
export const CATEGORY_CAPS: CategoryScores = {
  identity: 50,
  network: 40,
  device: 40,
  behavior: 25,
  graph: 50,
  profile: 20,
};

/** Positive credits subtracted after categories are summed. Total negative
 *  contribution is capped at POSITIVE_CREDIT_CAP so even a perfectly-engaged
 *  account can't drop a genuinely suspicious score to 0 from credits alone. */
export const POSITIVE_CREDIT_CAP = 30;
export const POSITIVE_CREDITS = {
  EMAIL_VERIFIED: 8,
  PER_VERIFIED_TASK: 2,
  PER_VERIFIED_TASK_CAP: 20,
  PHONE_VERIFIED: 5,                  // applied only if phone column populated
  WALLET_HAS_ONCHAIN_HISTORY: 5,      // Phase B+ when we have Solana RPC integration
  EMAIL_AGE_AGED: 5,                  // Phase B+ when we hook Gmail API / breach DB
};

/** Logistic-regression combiner cold-start coefficients. Phase G recalibrates. */
export const COMBINER_COEFFS = {
  beta0: -3,
  beta1_tier1_flags: 4,
  beta2_tier2_score: 3.5,
  beta3_tier3_anomaly: 2.8,
  beta4_interaction: 1.5,
};

/** Label bands. Score is already 0–100. Adaptive thresholds (Phase G) will
 *  shift these up or down based on platform base rate. */
export const LABEL_BANDS: Array<{ min: number; label: RiskLabel }> = [
  { min: 85, label: 'CRITICAL' },
  { min: 65, label: 'HIGH_RISK' },
  { min: 45, label: 'SUSPECT' },
  { min: 25, label: 'NEUTRAL' },
  { min: 10, label: 'CLEAN' },
  { min: 0,  label: 'TRUSTED' },
];

export function labelForScore(score: number): RiskLabel {
  for (const band of LABEL_BANDS) {
    if (score >= band.min) return band.label;
  }
  return 'TRUSTED';
}

export function categoryForSignal(type: SignalType): SignalCategory {
  if (type.startsWith('IP_') || type === 'SIGNUP_BURST') return 'network';
  if (type.startsWith('DEVICE_') || type === 'TLS_JA3_KNOWN_BOT'
      || type === 'TIMEZONE_GEO_MISMATCH' || type === 'USER_AGENT_INCONSISTENT') return 'device';
  if (type === 'FORM_FILL_INSTANT' || type === 'MOUSE_ENTROPY_ZERO'
      || type === 'KEYSTROKE_CADENCE_BOT' || type === 'COPY_PASTE_CRITICAL'
      || type === 'RAPID_TASK_COMPLETION') return 'behavior';
  if (type.startsWith('REFERRAL_') || type === 'SUSPICIOUS_REFERRER'
      || type === 'COMMUNITY_DENSITY_OUTLIER' || type === 'WALLET_GRAPH_OVERLAP') return 'graph';
  if (type === 'EMPTY_DISPLAY_NAME' || type === 'LOW_NAME_ENTROPY'
      || type === 'IMPLAUSIBLE_VOLUME' || type === 'MISSING_BUSINESS_NAME'
      || type === 'LOW_BIZNAME_ENTROPY' || type === 'MISSING_COUNTRY') return 'profile';
  return 'identity';
}

/** Confidence based on how many distinct signal categories fired. A score
 *  computed from 1 weak signal in 1 category is `low`; broad coverage is `high`. */
export function confidenceForSignalDensity(distinctCategoriesFired: number, totalSignalsFired: number): 'high' | 'medium' | 'low' {
  if (distinctCategoriesFired >= 4 || totalSignalsFired >= 6) return 'high';
  if (distinctCategoriesFired >= 2 || totalSignalsFired >= 3) return 'medium';
  return 'low';
}
