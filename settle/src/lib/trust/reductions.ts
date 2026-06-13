/**
 * Blip.money Trust limits — automatic risk reductions (pure computation).
 *
 * Given an account's current risk signals, returns how much its Trust-Tier limit
 * should be cut. The most severe applicable reduction wins (reductions do NOT
 * compound). Fraud investigation is a hard freeze (limits → 0). All inputs are
 * read from existing data (completion rate, windowed lost-dispute counts) except
 * `confirmedChargeback` / `fraudInvestigation`, which come from the severe-event
 * ledger / risk holds wired in a later phase (default false → no effect).
 *
 * Pure and side-effect free.
 */

import {
  LIMIT_REDUCTIONS,
  COMPLETION_RATE_MIN_SAMPLE,
  COMPLETION_RATE_REDUCTION_90,
  COMPLETION_RATE_REDUCTION_80,
} from './constants';

export interface LimitReductionInputs {
  totalOrders: number;
  completedTrades: number;
  disputesLost90d: number;
  disputesLost180d: number;
  /** Confirmed chargeback on record (severe-event ledger — later phase). */
  confirmedChargeback: boolean;
  /** Active fraud investigation (risk holds — later phase). */
  fraudInvestigation: boolean;
}

export interface LimitReduction {
  /** True when limits are fully frozen (fraud investigation). */
  frozen: boolean;
  /** Fraction in [0,1] to cut from the granted limit (0 = no reduction). */
  fraction: number;
  /** Human-readable reasons for the reduction(s) detected. */
  reasons: string[];
}

export function computeLimitReduction(i: LimitReductionInputs): LimitReduction {
  // Hard freeze beats any percentage reduction.
  if (i.fraudInvestigation) {
    return { frozen: true, fraction: 1, reasons: ['Active fraud investigation — limits frozen'] };
  }

  const candidates: { fraction: number; reason: string }[] = [];

  if (i.confirmedChargeback) {
    candidates.push({ fraction: LIMIT_REDUCTIONS.confirmedChargeback, reason: 'Confirmed chargeback' });
  }

  if (i.totalOrders >= COMPLETION_RATE_MIN_SAMPLE) {
    const rate = i.completedTrades / i.totalOrders;
    if (rate < COMPLETION_RATE_REDUCTION_80) {
      candidates.push({ fraction: LIMIT_REDUCTIONS.completionRateBelow80, reason: 'Completion rate below 80%' });
    } else if (rate < COMPLETION_RATE_REDUCTION_90) {
      candidates.push({ fraction: LIMIT_REDUCTIONS.completionRateBelow90, reason: 'Completion rate below 90%' });
    }
  }

  if (i.disputesLost180d >= 5) {
    candidates.push({ fraction: LIMIT_REDUCTIONS.lostDisputes5In180d, reason: '5+ lost disputes in 180 days' });
  } else if (i.disputesLost90d >= 3) {
    candidates.push({ fraction: LIMIT_REDUCTIONS.lostDisputes3In90d, reason: '3+ lost disputes in 90 days' });
  }

  if (candidates.length === 0) return { frozen: false, fraction: 0, reasons: [] };

  // Most severe single reduction applies (no compounding).
  const worst = candidates.reduce((a, b) => (b.fraction > a.fraction ? b : a));
  return { frozen: false, fraction: worst.fraction, reasons: candidates.map((c) => c.reason) };
}
