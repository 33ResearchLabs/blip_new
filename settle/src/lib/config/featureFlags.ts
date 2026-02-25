/**
 * Feature Flags
 *
 * Simple env-var-based feature flags for incremental rollout.
 * Phase 1: environment variables only.
 * Phase 2: DB-backed flags with percentage rollout (uses feature_flags table).
 */

export const FEATURES = {
  /** JWT-based auth replacing body-param trust */
  JWT_AUTH: process.env.FF_JWT_AUTH === '1',
  /** Redis-backed rate limiting for multi-instance */
  REDIS_RATE_LIMIT: process.env.FF_REDIS_RATE_LIMIT === '1',
  /** Auto-generate system chat messages on status change via OrderEventEmitter */
  SYSTEM_CHAT_MESSAGES: process.env.FF_SYSTEM_CHAT === '1',
  /** Route read queries to PG read replica */
  READ_REPLICA: process.env.FF_READ_REPLICA === '1',
  /** Crypto-to-crypto trading support */
  C2C_TRADING: process.env.FF_C2C_TRADING === '1',
} as const;

export type FeatureFlag = keyof typeof FEATURES;

/**
 * Check if a feature flag is enabled.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag] ?? false;
}
