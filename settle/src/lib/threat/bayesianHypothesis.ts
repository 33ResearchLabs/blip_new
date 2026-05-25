// Bayesian hypothesis classifier — given the signals and tier1 flags, surface
// the most likely fraud TYPE (not just degree). Computes P(H | signals) for
// each hypothesis using Naive-Bayes with hand-tuned per-hypothesis priors
// and likelihoods.
//
// Phase F polish:
//   * Expanded HYPOTHESIS_AFFINITIES to cover every signal that Phases B–E
//     wired up — IP/device/behavior/community signals now contribute to the
//     right hypotheses with conservative tuning.
//   * Returns `margin` (top posterior − second-place posterior) so the UI
//     can distinguish "confident BOT_FARM 87%" from "ambiguous 38%-vs-32%".
//   * Returns per-hypothesis top-contributing signals so the admin Risk
//     Factors tab can explain WHY the classifier picked a hypothesis.
//
// Likelihoods stay hand-tuned in Phase F. Phase G's calibration job can
// replace them with values learned from admin-confirmed labels.

import type { Signal, SignalType, Tier1Flag, ThreatHypothesis } from './types';

// Hand-tuned priors. Sum to 1.0. NORMAL dominates by design — we want a high
// bar to assert a fraud type. Less common fraud types get smaller priors so
// they only surface when their characteristic signals fire.
const PRIORS: Record<ThreatHypothesis, number> = {
  NORMAL: 0.80,
  LOW_QUALITY: 0.07,
  IDENTITY_FRAUD: 0.05,
  REFERRAL_RING: 0.03,
  BOT_FARM: 0.025,
  SANCTIONED: 0.01,
  MONEY_MULE: 0.005,
};

// P(signal fires | hypothesis). For each hypothesis we list signals with
// elevated probability vs the BASELINE_LIKELIHOOD. Signals not listed inherit
// BASELINE_LIKELIHOOD when present, or 1 - BASELINE when absent.
const BASELINE_LIKELIHOOD = 0.05;

const HYPOTHESIS_AFFINITIES: Record<ThreatHypothesis, Partial<Record<SignalType, number>>> = {
  // NORMAL prefers absence of negative signals — implicitly captured by
  // the "1 - BASELINE when absent" rule. We do flag known positive-evidence
  // signals (e.g. EMAIL_BREACH_EXPOSURE = real-person heuristic) so a normal
  // account with mild signals leans NORMAL more strongly.
  NORMAL: {
    EMAIL_BREACH_EXPOSURE: 0.45,    // real-person signal — boosts NORMAL
  },

  // BOT_FARM — automation + multi-account + IP/device sharing patterns.
  BOT_FARM: {
    // Behavioural (Phase D)
    FORM_FILL_INSTANT: 0.85,
    MOUSE_ENTROPY_ZERO: 0.85,
    KEYSTROKE_CADENCE_BOT: 0.80,
    RAPID_TASK_COMPLETION: 0.75,
    // Device (Phase C)
    DEVICE_FP_REUSE: 0.78,
    DEVICE_FP_LOW_ENTROPY: 0.65,
    TLS_JA3_KNOWN_BOT: 0.85,
    USER_AGENT_INCONSISTENT: 0.55,
    // Network (Phase B)
    IP_DATACENTER_ASN: 0.60,
    SIGNUP_BURST: 0.65,
    IP_CLUSTER: 0.55,
    // Graph (Phase E) — bot farms also cluster
    COMMUNITY_DENSITY_OUTLIER: 0.55,
  },

  // REFERRAL_RING — graph + referral patterns dominate.
  REFERRAL_RING: {
    REFERRAL_RING_DIRECT: 0.90,
    COMMUNITY_DENSITY_OUTLIER: 0.85,
    SUSPICIOUS_REFERRER: 0.75,
    REFERRAL_CHAIN_DEPTH_OUTLIER: 0.70,
    SHARED_WALLET: 0.45,
    IP_CLUSTER: 0.60,
    DEVICE_FP_REUSE: 0.55,
    SIGNUP_BURST: 0.50,
  },

  // SANCTIONED — wallet/IP/geo evasion patterns.
  // Tier 1 hard rule (OFAC_WALLET / SANCTIONED_COUNTRY) sets this directly;
  // Bayesian still computes for cases where soft signals exist without a
  // hard match (e.g. VPN + geo mismatch + mixer proximity → likely evading).
  SANCTIONED: {
    WALLET_MIXER_PROXIMITY: 0.55,
    IP_TOR_EXIT: 0.55,
    IP_VPN_DETECTED: 0.40,
    IP_GEO_COUNTRY_MISMATCH: 0.40,
    TIMEZONE_GEO_MISMATCH: 0.35,
  },

  // MONEY_MULE — wallet patterns + identity-obscuring infrastructure.
  MONEY_MULE: {
    WALLET_MIXER_PROXIMITY: 0.78,
    WALLET_GRAPH_OVERLAP: 0.70,
    WALLET_NO_ONCHAIN_HISTORY: 0.55,
    SHARED_WALLET: 0.60,
    IP_VPN_DETECTED: 0.45,
    EMAIL_AGE_FRESH: 0.40,
  },

  // IDENTITY_FRAUD — fake / recycled identities, signup data forgery.
  IDENTITY_FRAUD: {
    DISPOSABLE_EMAIL_DOMAIN: 0.70,
    PLUS_ALIASED_EMAIL: 0.35,
    SHARED_WALLET: 0.55,
    EMAIL_AGE_FRESH: 0.50,
    EMAIL_BREACH_RECENT: 0.50,        // recent-breach correlates with cred-stuffing
    MISSING_EMAIL_VERIFY_AFTER_24H: 0.50,
    EMPTY_DISPLAY_NAME: 0.50,
    LOW_NAME_ENTROPY: 0.45,
    USER_AGENT_INCONSISTENT: 0.45,
    DEVICE_FP_REUSE: 0.40,
  },

  // LOW_QUALITY — incomplete or marginal profile, not fraud per se but
  // not worth activating before higher-priority signups.
  LOW_QUALITY: {
    MISSING_BUSINESS_NAME: 0.60,
    LOW_BIZNAME_ENTROPY: 0.50,
    MISSING_COUNTRY: 0.45,
    IMPLAUSIBLE_VOLUME: 0.55,
    EMPTY_DISPLAY_NAME: 0.50,
    LOW_NAME_ENTROPY: 0.40,
    MISSING_EMAIL_VERIFY_AFTER_24H: 0.40,
    COPY_PASTE_CRITICAL: 0.30,
  },
};

export interface PerHypothesisContribution {
  signal: SignalType;
  contribution: number;   // log-likelihood-ratio contribution (signed)
}

export interface HypothesisResult {
  hypothesis: ThreatHypothesis;
  /** Top posterior probability — 0..1. */
  confidence: number;
  /** Top posterior − second-place posterior. Use to judge how decisive the
   *  top-pick was: >0.5 confident, 0.2–0.5 leaning, <0.2 ambiguous. */
  margin: number;
  /** Full posterior breakdown across all hypotheses. Sums to ~1. */
  per_hypothesis: Record<ThreatHypothesis, number>;
  /** Top contributing signals for the WINNING hypothesis: signals whose
   *  log-likelihood-ratio (vs other hypotheses) most pushed toward it.
   *  Useful for explaining "why BOT_FARM" in the admin UI. */
  top_contributors: PerHypothesisContribution[];
}

export function classifyHypothesis(
  signals: Signal[],
  tier1Flags: Tier1Flag[],
): HypothesisResult {
  // Tier 1 short-circuit: any hard rule fired → use its hypothesis with
  // confidence 1.0 directly. Hard rules are deterministic.
  if (tier1Flags.length > 0) {
    const fired = tier1Flags[0].hypothesis;
    const per_hypothesis = emptyPerHypothesis();
    per_hypothesis[fired] = 1;
    return {
      hypothesis: fired,
      confidence: 1,
      margin: 1,
      per_hypothesis,
      top_contributors: [{
        signal: 'DISPOSABLE_EMAIL_DOMAIN' as SignalType,   // placeholder
        contribution: 1,
      }],
    };
  }

  const firedTypes = new Set(signals.map(s => s.type));
  const allSignalTypes = collectKnownSignalTypes();

  // Log-space accumulation to avoid underflow with many signals.
  const logPosteriors: Record<ThreatHypothesis, number> = emptyPerHypothesis();
  for (const h of Object.keys(PRIORS) as ThreatHypothesis[]) {
    let logP = Math.log(PRIORS[h]);
    for (const sigType of allSignalTypes) {
      const pFired = HYPOTHESIS_AFFINITIES[h][sigType] ?? BASELINE_LIKELIHOOD;
      const pNotFired = 1 - pFired;
      if (firedTypes.has(sigType)) {
        logP += Math.log(Math.max(pFired, 1e-9));
      } else {
        logP += Math.log(Math.max(pNotFired, 1e-9));
      }
    }
    logPosteriors[h] = logP;
  }

  // Convert to normalised probabilities (softmax-style).
  const maxLogP = Math.max(...Object.values(logPosteriors));
  const expVals: Record<ThreatHypothesis, number> = emptyPerHypothesis();
  let sumExp = 0;
  for (const h of Object.keys(logPosteriors) as ThreatHypothesis[]) {
    const e = Math.exp(logPosteriors[h] - maxLogP);
    expVals[h] = e;
    sumExp += e;
  }
  const posteriors: Record<ThreatHypothesis, number> = emptyPerHypothesis();
  for (const h of Object.keys(expVals) as ThreatHypothesis[]) {
    posteriors[h] = expVals[h] / sumExp;
  }

  // Find top + second-place to compute margin.
  let topH: ThreatHypothesis = 'NORMAL';
  let topP = -Infinity;
  let secondP = -Infinity;
  for (const h of Object.keys(posteriors) as ThreatHypothesis[]) {
    const p = posteriors[h];
    if (p > topP) {
      secondP = topP;
      topP = p;
      topH = h;
    } else if (p > secondP) {
      secondP = p;
    }
  }
  const margin = topP - (secondP === -Infinity ? 0 : secondP);

  // Top contributing signals for the winning hypothesis. Compute the
  // log-likelihood-ratio contribution of each fired signal vs the per-
  // hypothesis baseline. Higher = more this signal pushed toward winner.
  const contributors: PerHypothesisContribution[] = [];
  for (const sig of signals) {
    const pFiredWinner = HYPOTHESIS_AFFINITIES[topH][sig.type] ?? BASELINE_LIKELIHOOD;
    // LLR vs the SECOND-best hypothesis — explains why the winner won.
    const secondHypothesis = secondBestHypothesis(posteriors, topH);
    const pFiredSecond = HYPOTHESIS_AFFINITIES[secondHypothesis][sig.type] ?? BASELINE_LIKELIHOOD;
    const llr = Math.log(Math.max(pFiredWinner, 1e-9))
              - Math.log(Math.max(pFiredSecond, 1e-9));
    if (llr > 0.05) {
      contributors.push({ signal: sig.type, contribution: round3(llr) });
    }
  }
  contributors.sort((a, b) => b.contribution - a.contribution);

  return {
    hypothesis: topH,
    confidence: round3(topP),
    margin: round3(margin),
    per_hypothesis: roundPerHypothesis(posteriors),
    top_contributors: contributors.slice(0, 5),
  };
}

function emptyPerHypothesis(): Record<ThreatHypothesis, number> {
  return {
    NORMAL: 0,
    BOT_FARM: 0,
    REFERRAL_RING: 0,
    SANCTIONED: 0,
    MONEY_MULE: 0,
    IDENTITY_FRAUD: 0,
    LOW_QUALITY: 0,
  };
}

function collectKnownSignalTypes(): Set<SignalType> {
  const out = new Set<SignalType>();
  for (const aff of Object.values(HYPOTHESIS_AFFINITIES)) {
    for (const k of Object.keys(aff) as SignalType[]) out.add(k);
  }
  return out;
}

function secondBestHypothesis(
  posteriors: Record<ThreatHypothesis, number>,
  topH: ThreatHypothesis,
): ThreatHypothesis {
  let best: ThreatHypothesis = 'NORMAL';
  let bestP = -Infinity;
  for (const h of Object.keys(posteriors) as ThreatHypothesis[]) {
    if (h === topH) continue;
    if (posteriors[h] > bestP) { bestP = posteriors[h]; best = h; }
  }
  return best;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function roundPerHypothesis(p: Record<ThreatHypothesis, number>): Record<ThreatHypothesis, number> {
  const out = emptyPerHypothesis();
  for (const h of Object.keys(p) as ThreatHypothesis[]) {
    out[h] = round3(p[h]);
  }
  return out;
}
