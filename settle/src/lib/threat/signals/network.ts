// Network-category signal detectors (Phase B). All require IP data — either
// fresh from IPQS (network reputation) or aggregated from the local ip_logs
// table (clustering + bursts).
//
// Skipped at score time when no signup IP exists for the actor — keeps the
// score honest about confidence rather than guessing.

import type { Signal, ScoringContext } from '../types';
import { categoryForSignal } from '../weights';
import type { IpqsResult } from '../external/ipqs';

export interface NetworkLookups {
  /** Most recent signup IP for this actor (from ip_logs, action='signup'),
   *  null if we never captured it. */
  signupIp: string | null;
  /** IPQS reputation for that IP, or null if API key missing / unreachable. */
  ipqs: IpqsResult | null;
  /** Distinct actor count in ip_logs sharing this signup IP within 24h. */
  ipClusterCount24h: number;
  /** Total signup-action ip_logs entries from this IP within 10 min. */
  signupBurstCount10m: number;
}

export function detectNetworkSignals(
  ctx: ScoringContext,
  lookups: NetworkLookups,
): Signal[] {
  const out: Signal[] = [];
  if (!lookups.signupIp) return out;

  // --- IPQS-derived signals --------------------------------------------
  if (lookups.ipqs) {
    const ipqs = lookups.ipqs;

    if (ipqs.is_datacenter) {
      out.push({
        type: 'IP_DATACENTER_ASN',
        category: categoryForSignal('IP_DATACENTER_ASN'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { asn: ipqs.asn, organization: ipqs.organization, ip: lookups.signupIp },
      });
    }
    if (ipqs.is_vpn && !ipqs.is_tor) {
      out.push({
        type: 'IP_VPN_DETECTED',
        category: categoryForSignal('IP_VPN_DETECTED'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { ip: lookups.signupIp },
      });
    }
    if (ipqs.is_tor) {
      out.push({
        type: 'IP_TOR_EXIT',
        category: categoryForSignal('IP_TOR_EXIT'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { ip: lookups.signupIp },
      });
    }
    // Fraud score scales the weight — 100 → 1.0 multiplier, 50 → 0.5, etc.
    // Anything below 25 is too low-signal to fire.
    if (ipqs.fraud_score >= 25) {
      out.push({
        type: 'IP_HIGH_FRAUD_SCORE',
        category: categoryForSignal('IP_HIGH_FRAUD_SCORE'),
        severity_multiplier: Math.min(1, ipqs.fraud_score / 100),
        occurrence_count: 1,
        evidence: {
          fraud_score: ipqs.fraud_score,
          recent_abuse: ipqs.recent_abuse,
          ip: lookups.signupIp,
        },
      });
    }
    // Geo-mismatch — declared country (merchants only) ≠ IPQS country.
    if (
      ctx.actor.type === 'merchant' &&
      ctx.actor.country_code &&
      ipqs.country_code &&
      ctx.actor.country_code.toUpperCase() !== ipqs.country_code.toUpperCase()
    ) {
      out.push({
        type: 'IP_GEO_COUNTRY_MISMATCH',
        category: categoryForSignal('IP_GEO_COUNTRY_MISMATCH'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: {
          declared_country: ctx.actor.country_code,
          ip_country: ipqs.country_code,
        },
      });
    }
  }

  // --- Local-data signals (no external API) ----------------------------
  // IP cluster: 5+ distinct actors sharing this IP within 24h. Severity
  // scales with cluster size (capped at 3× for sanity).
  if (lookups.ipClusterCount24h >= 5) {
    out.push({
      type: 'IP_CLUSTER',
      category: categoryForSignal('IP_CLUSTER'),
      severity_multiplier: Math.min(3, lookups.ipClusterCount24h / 5),
      occurrence_count: 1,
      evidence: {
        distinct_actors_24h: lookups.ipClusterCount24h,
        ip: lookups.signupIp,
      },
    });
  }

  // Signup burst: 4+ signups from this IP within a 10-minute window.
  if (lookups.signupBurstCount10m >= 4) {
    out.push({
      type: 'SIGNUP_BURST',
      category: categoryForSignal('SIGNUP_BURST'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: {
        signups_10m: lookups.signupBurstCount10m,
        ip: lookups.signupIp,
      },
    });
  }

  return out;
}
