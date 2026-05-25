// Tier 1 — deterministic hard rules. Any match short-circuits to CRITICAL
// label with a deterministic hypothesis. Phase A scope: only rules that work
// with existing tables (blacklist + waitlist data). Sanctioned-wallet rule
// (which needs sanctioned_wallets table) and device-fingerprint reuse rule
// (which needs device_fingerprints table) land in Phases B/C.

import type { Tier1Flag, ScoringContext } from './types';

// US Treasury OFAC sanctioned countries. Conservative list — easy to expand
// or shrink without touching code by maintaining a config table later.
const SANCTIONED_COUNTRIES = new Set<string>([
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
  'CU', // Cuba
  'RU', // Russia (broad sanctions)
  'BY', // Belarus
]);

export interface Tier1Lookups {
  /** True if the actor's email, wallet, or id appears in the active blacklist. */
  blacklistMatch: { matched: boolean; entity_type?: string; reason?: string };
  /** Count of other accounts created within 24h with same email+wallet but
   *  different display name. */
  replayCandidateCount: number;
  /** Distinct OTHER actors sharing this actor's most recent device fingerprint. */
  deviceFpReuseCount: number;
}

const DEVICE_FP_REUSE_HARD_THRESHOLD = 10;

export function evaluateTier1(
  ctx: ScoringContext,
  lookups: Tier1Lookups,
): Tier1Flag[] {
  const flags: Tier1Flag[] = [];
  const a = ctx.actor;

  // SANCTIONED_COUNTRY — declared country in OFAC list. Merchants always have
  // a country_code field; users currently don't, so this is merchant-only in
  // Phase A.
  if (a.country_code && SANCTIONED_COUNTRIES.has(a.country_code.toUpperCase())) {
    flags.push({
      rule: 'SANCTIONED_COUNTRY',
      hypothesis: 'SANCTIONED',
      evidence: { country_code: a.country_code },
    });
  }

  // PLATFORM_BLACKLIST — already-blacklisted entity. Source of truth is the
  // existing `blacklist` table from migration 069.
  if (lookups.blacklistMatch.matched) {
    flags.push({
      rule: 'PLATFORM_BLACKLIST',
      hypothesis: 'IDENTITY_FRAUD',
      evidence: {
        entity_type: lookups.blacklistMatch.entity_type,
        reason: lookups.blacklistMatch.reason,
      },
    });
  }

  // REPLAY_SIGNUP — same (email, wallet) registered ≥1 other account within
  // 24h under a different name. Catches the classic identity-recycling pattern.
  if (lookups.replayCandidateCount > 0) {
    flags.push({
      rule: 'REPLAY_SIGNUP',
      hypothesis: 'IDENTITY_FRAUD',
      evidence: {
        other_account_count: lookups.replayCandidateCount,
        email: a.email,
        wallet_address: a.wallet_address,
      },
    });
  }

  // DEVICE_FP_REUSE_THRESHOLD — same device fingerprint linked to >10 OTHER
  // accounts. By the time you hit this threshold there is essentially no
  // legitimate explanation (shared family device caps at 4-5; even a public
  // library kiosk wouldn't see 10+ waitlist signups). Hard rule → CRITICAL.
  if (lookups.deviceFpReuseCount >= DEVICE_FP_REUSE_HARD_THRESHOLD) {
    flags.push({
      rule: 'DEVICE_FP_REUSE_THRESHOLD',
      hypothesis: 'BOT_FARM',
      evidence: {
        other_actors_sharing: lookups.deviceFpReuseCount,
        threshold: DEVICE_FP_REUSE_HARD_THRESHOLD,
      },
    });
  }

  return flags;
}
