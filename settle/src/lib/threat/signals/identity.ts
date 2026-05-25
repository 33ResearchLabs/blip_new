// Identity-category signal detectors. Pure functions over the scoring
// context + a small set of pre-fetched lookups. No DB inside these detectors
// other than the explicit lookups the orchestrator supplies — keeps them
// fast and easy to unit-test.

import type { Signal, ScoringContext } from '../types';
import { categoryForSignal } from '../weights';
import { isDisposableDomain, getDomainFromEmail } from '../disposableDomains';
import type { HibpResult } from '../external/hibp';

export interface IdentityLookups {
  /** Count of other accounts (across users + merchants) sharing this wallet. */
  walletShareCount: number;
  /** HIBP breach lookup for the actor's email, or null if unavailable. */
  hibp?: HibpResult | null;
}

export function detectIdentitySignals(
  ctx: ScoringContext,
  lookups: IdentityLookups,
): Signal[] {
  const out: Signal[] = [];
  const a = ctx.actor;

  // DISPOSABLE_EMAIL_DOMAIN — bundled curated list match
  if (a.email) {
    const domain = getDomainFromEmail(a.email);
    if (domain && isDisposableDomain(domain)) {
      out.push({
        type: 'DISPOSABLE_EMAIL_DOMAIN',
        category: categoryForSignal('DISPOSABLE_EMAIL_DOMAIN'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { domain },
      });
    }

    // PLUS_ALIASED_EMAIL — '+' in local-part. Mild signal — many legit users
    // use plus-aliasing, but it correlates with multi-account abuse.
    const at = a.email.indexOf('@');
    const local = at > 0 ? a.email.slice(0, at) : a.email;
    if (local.includes('+')) {
      out.push({
        type: 'PLUS_ALIASED_EMAIL',
        category: categoryForSignal('PLUS_ALIASED_EMAIL'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { local_part: local },
      });
    }
  }

  // SHARED_WALLET — same wallet across multiple waitlist signups. Strong
  // multi-account signal. Severity scales with reuse count.
  if (a.wallet_address && lookups.walletShareCount > 0) {
    out.push({
      type: 'SHARED_WALLET',
      category: categoryForSignal('SHARED_WALLET'),
      severity_multiplier: Math.min(2, 1 + lookups.walletShareCount * 0.2),
      occurrence_count: 1,
      evidence: {
        wallet_address: a.wallet_address,
        other_accounts_sharing: lookups.walletShareCount,
      },
    });
  }

  // MISSING_EMAIL_VERIFY_AFTER_24H — parked-account / fake-email indicator.
  // We can only fire this for actors joined >24h ago.
  if (a.waitlist_joined_at && a.email_verified === false) {
    const joinedMs = Date.parse(a.waitlist_joined_at);
    const ageHours = (Date.now() - joinedMs) / 3_600_000;
    if (!Number.isNaN(joinedMs) && ageHours > 24) {
      out.push({
        type: 'MISSING_EMAIL_VERIFY_AFTER_24H',
        category: categoryForSignal('MISSING_EMAIL_VERIFY_AFTER_24H'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { hours_since_signup: Math.floor(ageHours) },
      });
    }
  }

  // EMAIL_BREACH_EXPOSURE / EMAIL_BREACH_RECENT — HIBP-derived. The exposure
  // signal has NEGATIVE weight (a known-real address is more legit, not
  // less). The recent-breach signal has positive weight — fresh exposure
  // means credential-stuffing target.
  if (lookups.hibp && a.email) {
    const h = lookups.hibp;
    if (h.breach_count > 0) {
      out.push({
        type: 'EMAIL_BREACH_EXPOSURE',
        category: categoryForSignal('EMAIL_BREACH_EXPOSURE'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { breach_count: h.breach_count, most_recent: h.most_recent_breach_iso },
      });
    }
    if (h.most_recent_breach_iso) {
      const breachMs = Date.parse(h.most_recent_breach_iso);
      if (!Number.isNaN(breachMs)) {
        const ageDays = (Date.now() - breachMs) / 86_400_000;
        if (ageDays >= 0 && ageDays <= 30) {
          out.push({
            type: 'EMAIL_BREACH_RECENT',
            category: categoryForSignal('EMAIL_BREACH_RECENT'),
            severity_multiplier: 1,
            occurrence_count: 1,
            evidence: { days_since_breach: Math.floor(ageDays), most_recent: h.most_recent_breach_iso },
          });
        }
      }
    }
  }

  return out;
}
