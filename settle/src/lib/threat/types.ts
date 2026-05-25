// Shared types for the waitlist threat-detection system. Kept in one file
// so frontend and backend can both import them.

export type ActorType = 'user' | 'merchant';

export type RiskLabel = 'TRUSTED' | 'CLEAN' | 'NEUTRAL' | 'SUSPECT' | 'HIGH_RISK' | 'CRITICAL';

export type ThreatHypothesis =
  | 'NORMAL'
  | 'BOT_FARM'
  | 'REFERRAL_RING'
  | 'SANCTIONED'
  | 'MONEY_MULE'
  | 'IDENTITY_FRAUD'
  | 'LOW_QUALITY';

export type Confidence = 'high' | 'medium' | 'low';

export type SignalCategory =
  | 'identity'
  | 'network'
  | 'device'
  | 'behavior'
  | 'graph'
  | 'profile';

export type SignalType =
  // identity
  | 'DISPOSABLE_EMAIL_DOMAIN'
  | 'PLUS_ALIASED_EMAIL'
  | 'EMAIL_BREACH_EXPOSURE'
  | 'EMAIL_BREACH_RECENT'
  | 'EMAIL_AGE_FRESH'
  | 'SHARED_WALLET'
  | 'WALLET_NO_ONCHAIN_HISTORY'
  | 'WALLET_MIXER_PROXIMITY'
  | 'MISSING_EMAIL_VERIFY_AFTER_24H'
  // network
  | 'IP_DATACENTER_ASN'
  | 'IP_VPN_DETECTED'
  | 'IP_TOR_EXIT'
  | 'IP_HIGH_FRAUD_SCORE'
  | 'IP_GEO_COUNTRY_MISMATCH'
  | 'IP_CLUSTER'
  | 'SIGNUP_BURST'
  // device
  | 'DEVICE_FP_REUSE'
  | 'DEVICE_FP_LOW_ENTROPY'
  | 'TLS_JA3_KNOWN_BOT'
  | 'TIMEZONE_GEO_MISMATCH'
  | 'USER_AGENT_INCONSISTENT'
  // behavior
  | 'FORM_FILL_INSTANT'
  | 'MOUSE_ENTROPY_ZERO'
  | 'KEYSTROKE_CADENCE_BOT'
  | 'COPY_PASTE_CRITICAL'
  | 'RAPID_TASK_COMPLETION'
  // graph
  | 'REFERRAL_RING_DIRECT'
  | 'SUSPICIOUS_REFERRER'
  | 'REFERRAL_CHAIN_DEPTH_OUTLIER'
  | 'COMMUNITY_DENSITY_OUTLIER'
  | 'WALLET_GRAPH_OVERLAP'
  // profile
  | 'EMPTY_DISPLAY_NAME'
  | 'LOW_NAME_ENTROPY'
  | 'IMPLAUSIBLE_VOLUME'
  | 'MISSING_BUSINESS_NAME'
  | 'LOW_BIZNAME_ENTROPY'
  | 'MISSING_COUNTRY';

export interface Signal {
  type: SignalType;
  category: SignalCategory;
  /** Multiplied with the type's weight. Lets a single signal type scale with
   *  intensity (e.g. IP_HIGH_FRAUD_SCORE uses fraud_score/100 as multiplier). */
  severity_multiplier: number;
  /** How many times this signal has fired for this actor in the window. Drives
   *  diminishing-returns decay. Default 1. */
  occurrence_count: number;
  /** Human-readable evidence shown in the admin Risk-Factors tab. */
  evidence: Record<string, unknown>;
}

export type Tier1RuleType =
  | 'OFAC_WALLET'
  | 'SANCTIONED_COUNTRY'
  | 'PLATFORM_BLACKLIST'
  | 'DISPOSABLE_VPN_NO_TASKS'
  | 'HONEYPOT_TRIPPED'
  | 'REPLAY_SIGNUP'
  | 'DEVICE_FP_REUSE_THRESHOLD';

export interface Tier1Flag {
  rule: Tier1RuleType;
  hypothesis: ThreatHypothesis;
  evidence: Record<string, unknown>;
}

export interface CategoryScores {
  identity: number;
  network: number;
  device: number;
  behavior: number;
  graph: number;
  profile: number;
}

export interface ThreatScoreResult {
  score: number;                 // 0–100 (post-combiner, post-clamp)
  label: RiskLabel;
  hypothesis: ThreatHypothesis;
  hypothesis_confidence: number; // 0–1, top posterior probability
  /** Phase F: top posterior − second-place posterior. >0.5 confident,
   *  0.2–0.5 leaning, <0.2 ambiguous. Lets the UI distinguish a strong
   *  call from a coin-flip between two hypotheses. */
  hypothesis_margin: number;
  /** Phase F: full posterior breakdown across all hypotheses. */
  per_hypothesis: Record<ThreatHypothesis, number>;
  /** Phase F: signals whose log-likelihood-ratio most pushed toward the
   *  winning hypothesis. Used by the admin Risk Factors tab. */
  hypothesis_contributors: Array<{ signal: SignalType; contribution: number }>;
  confidence: Confidence;        // signal density
  by_category: CategoryScores;
  signals: Signal[];
  tier1_flags: Tier1Flag[];
  tier2_score: number;           // pre-combiner Tier 2 raw
  tier3_anomaly: number;         // 0 in Phase A
  community_id: string | null;
  model_version: string;
  computed_at: string;           // ISO timestamp
}

/** Context passed into the scoring engine — wraps everything the signal
 *  detectors need so each one stays a pure function over the context. */
export interface ScoringContext {
  actor: ActorRow;
  // Counts pre-fetched once per scoring call to avoid N+1 in signal detectors.
  tasks: TaskRow[];
  referralsMade: ReferralRow[];
  referredByRow: ReferrerSummary | null;
}

export interface ActorRow {
  id: string;
  type: ActorType;
  email: string | null;
  email_verified: boolean | null;
  wallet_address: string | null;
  name: string | null;            // 'name' on users, 'display_name' on merchants
  business_name: string | null;   // merchants only
  business_category: string | null;
  expected_monthly_volume_usd: number | null;
  country_code: string | null;
  waitlist_joined_at: string | null;
  referred_by_user_id: string | null;
  referred_by_merchant_id: string | null;
}

export interface TaskRow {
  id: string;
  task_type: string;
  status: string;
  completed_at: string | null;
}

export interface ReferralRow {
  referred_id: string;
  referred_type: ActorType;
  created_at: string;
}

export interface ReferrerSummary {
  id: string;
  type: ActorType;
  wl_score: number | null;
  wl_label: RiskLabel | null;
  // Total referrals made by this referrer in any window (used for ring signal).
  total_referrals_24h: number;
}
