// Device-category signal detectors (Phase C). Operate over the actor's
// most recent fingerprint + reuse count + the bundled bot-signature list.

import type { Signal, ScoringContext } from '../types';
import { categoryForSignal } from '../weights';
import { matchBotSignature, type BotSignature } from '../botFingerprints';
import type { IpqsResult } from '../external/ipqs';

export interface DeviceLookups {
  /** Most recent fp_hash captured for this actor, or null. */
  fpHash: string | null;
  /** Canonical components blob for the most recent fp, or null. */
  componentsJson: string | null;
  /** Browser timezone string from the fingerprint, e.g. 'America/New_York'. */
  timezone: string | null;
  /** Distinct OTHER actors sharing this fp_hash (excluding self). */
  fpReuseCount: number;
  /** Latest IPQS result for the actor's signup IP (passed in to avoid a
   *  duplicate external call here). Used for timezone-geo cross-check. */
  ipqs: IpqsResult | null;
}

// Country code → expected IANA timezone region prefix. We only need broad
// regional matching (continent) — comparing 'America/New_York' against
// 'America/Los_Angeles' is fine, both share 'America'. The mismatch fires
// only when the continents differ — keeps false-positives low.
const COUNTRY_TZ_REGION: Record<string, string> = {
  US: 'America', CA: 'America', MX: 'America', BR: 'America', AR: 'America',
  CL: 'America', PE: 'America', CO: 'America', VE: 'America',
  GB: 'Europe',  IE: 'Europe',  DE: 'Europe',  FR: 'Europe',  IT: 'Europe',
  ES: 'Europe',  PT: 'Europe',  NL: 'Europe',  BE: 'Europe',  CH: 'Europe',
  AT: 'Europe',  SE: 'Europe',  NO: 'Europe',  DK: 'Europe',  FI: 'Europe',
  PL: 'Europe',  CZ: 'Europe',  HU: 'Europe',  RO: 'Europe',  BG: 'Europe',
  GR: 'Europe',  UA: 'Europe',  RU: 'Europe',
  JP: 'Asia',    CN: 'Asia',    KR: 'Asia',    IN: 'Asia',    ID: 'Asia',
  TH: 'Asia',    VN: 'Asia',    PH: 'Asia',    MY: 'Asia',    SG: 'Asia',
  TR: 'Asia',    IL: 'Asia',    SA: 'Asia',    AE: 'Asia',    PK: 'Asia',
  BD: 'Asia',
  AU: 'Australia', NZ: 'Pacific',
  ZA: 'Africa',  EG: 'Africa',  NG: 'Africa',  KE: 'Africa',  MA: 'Africa',
};

function tzRegion(tz: string | null): string | null {
  if (!tz) return null;
  const slash = tz.indexOf('/');
  return slash > 0 ? tz.slice(0, slash) : null;
}

export function detectDeviceSignals(
  ctx: ScoringContext,
  lookups: DeviceLookups,
): Signal[] {
  const out: Signal[] = [];

  // DEVICE_FP_REUSE — fingerprint linked to 2+ other actors. Severity scales
  // with reuse count (capped at 3× so cluster-of-100 doesn't explode the
  // score after the category cap).
  if (lookups.fpHash && lookups.fpReuseCount >= 2) {
    out.push({
      type: 'DEVICE_FP_REUSE',
      category: categoryForSignal('DEVICE_FP_REUSE'),
      severity_multiplier: Math.min(3, lookups.fpReuseCount / 2),
      occurrence_count: 1,
      evidence: {
        fp_hash: lookups.fpHash.slice(0, 12),  // prefix only — full hash in DB
        other_actors_sharing: lookups.fpReuseCount,
      },
    });
  }

  // DEVICE_FP_LOW_ENTROPY — components blob contains a known bot signature.
  // Strong "this is automation" indicator.
  if (lookups.componentsJson) {
    const sig: BotSignature | null = matchBotSignature(lookups.componentsJson);
    if (sig) {
      out.push({
        type: 'DEVICE_FP_LOW_ENTROPY',
        category: categoryForSignal('DEVICE_FP_LOW_ENTROPY'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: {
          bot_signature: sig.id,
          description: sig.description,
        },
      });
    }
  }

  // TIMEZONE_GEO_MISMATCH — browser timezone region (continent) differs from
  // IPQS-detected country region. Requires both inputs.
  if (lookups.timezone && lookups.ipqs?.country_code) {
    const tzReg = tzRegion(lookups.timezone);
    const expectedReg = COUNTRY_TZ_REGION[lookups.ipqs.country_code.toUpperCase()];
    if (tzReg && expectedReg && tzReg !== expectedReg) {
      out.push({
        type: 'TIMEZONE_GEO_MISMATCH',
        category: categoryForSignal('TIMEZONE_GEO_MISMATCH'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: {
          browser_tz: lookups.timezone,
          ip_country: lookups.ipqs.country_code,
          tz_region: tzReg,
          expected_region: expectedReg,
        },
      });
    }
  }

  return out;
}
