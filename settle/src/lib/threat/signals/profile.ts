// Profile-completeness signals. Phase A scope: all profile signals — they all
// run against existing columns.

import type { Signal, ScoringContext } from '../types';
import { categoryForSignal } from '../weights';
import { isLowEntropy } from '../lowEntropy';

const IMPLAUSIBLE_VOLUME_THRESHOLD_USD = 10_000_000;

// Categories that legitimately handle >10M monthly volume — flag is suppressed
// for these to avoid false-positives on real exchanges / payment processors.
const HIGH_VOLUME_CATEGORIES = new Set<string>([
  'exchange',
  'payment_processor',
  'remittance',
  'institutional_trading',
  'otc_desk',
]);

export function detectProfileSignals(ctx: ScoringContext): Signal[] {
  const out: Signal[] = [];
  const a = ctx.actor;

  // EMPTY_DISPLAY_NAME — null or all-whitespace name. Applies to both segments
  // (users.name + merchants.display_name).
  const nameTrimmed = (a.name ?? '').trim();
  if (nameTrimmed.length === 0) {
    out.push({
      type: 'EMPTY_DISPLAY_NAME',
      category: categoryForSignal('EMPTY_DISPLAY_NAME'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: { name: a.name },
    });
  } else if (isLowEntropy(nameTrimmed)) {
    out.push({
      type: 'LOW_NAME_ENTROPY',
      category: categoryForSignal('LOW_NAME_ENTROPY'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: { name: nameTrimmed },
    });
  }

  // MISSING_COUNTRY — applies to merchants (they have country_code). Users
  // don't have a country column so the signal is skipped for them.
  if (a.type === 'merchant' && !a.country_code) {
    out.push({
      type: 'MISSING_COUNTRY',
      category: categoryForSignal('MISSING_COUNTRY'),
      severity_multiplier: 1,
      occurrence_count: 1,
      evidence: {},
    });
  }

  // Merchant-only signals below.
  if (a.type === 'merchant') {
    const biz = (a.business_name ?? '').trim();
    if (biz.length === 0) {
      out.push({
        type: 'MISSING_BUSINESS_NAME',
        category: categoryForSignal('MISSING_BUSINESS_NAME'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: {},
      });
    } else if (isLowEntropy(biz)) {
      out.push({
        type: 'LOW_BIZNAME_ENTROPY',
        category: categoryForSignal('LOW_BIZNAME_ENTROPY'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { business_name: biz },
      });
    }

    // IMPLAUSIBLE_VOLUME — declared expected_monthly_volume_usd > 10M without
    // a category that justifies it.
    if (
      a.expected_monthly_volume_usd !== null &&
      a.expected_monthly_volume_usd > IMPLAUSIBLE_VOLUME_THRESHOLD_USD &&
      !HIGH_VOLUME_CATEGORIES.has((a.business_category ?? '').toLowerCase())
    ) {
      out.push({
        type: 'IMPLAUSIBLE_VOLUME',
        category: categoryForSignal('IMPLAUSIBLE_VOLUME'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: {
          declared_usd: a.expected_monthly_volume_usd,
          business_category: a.business_category,
        },
      });
    }
  }

  return out;
}
