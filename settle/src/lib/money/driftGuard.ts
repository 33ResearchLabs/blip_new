/**
 * Rate + fee drift guard for order creation.
 *
 * Client sends the price + fee_bps it displayed to the user; server
 * re-fetches the authoritative values and rejects the order if either
 * drifted beyond the configured threshold. The UX hint attached to the
 * 409 tells the client to refresh and re-confirm.
 */

/** Max fractional rate drift tolerated (0.005 = 0.5%). */
const RATE_DRIFT_MAX = 0.005;

export interface DriftInput {
  actualRate: number;
  actualFeeBps: number;
  expectedRate?: number;
  expectedFeeBps?: number;
}

export interface DriftResult {
  ok: boolean;
  /** Populated when !ok; a JSON-serialisable 409 payload. */
  conflict?: {
    error: 'price_drift';
    message: string;
    reason: 'rate' | 'fee_bps';
    actual: { rate: number; feeBps: number };
    expected: { rate?: number; feeBps?: number };
    drift_bps?: number;
  };
}

export function checkDrift(input: DriftInput): DriftResult {
  const { actualRate, actualFeeBps, expectedRate, expectedFeeBps } = input;

  if (expectedRate != null && expectedRate > 0) {
    const drift = Math.abs(actualRate - expectedRate) / expectedRate;
    if (drift > RATE_DRIFT_MAX) {
      return {
        ok: false,
        conflict: {
          error: 'price_drift',
          reason: 'rate',
          message: `The rate moved (${(drift * 100).toFixed(2)}%) between quote and submit. Please refresh and confirm the new price.`,
          actual: { rate: actualRate, feeBps: actualFeeBps },
          expected: { rate: expectedRate, feeBps: expectedFeeBps },
          drift_bps: Math.round(drift * 10_000),
        },
      };
    }
  }

  if (expectedFeeBps != null && expectedFeeBps !== actualFeeBps) {
    return {
      ok: false,
      conflict: {
        error: 'price_drift',
        reason: 'fee_bps',
        message: `The protocol fee changed (${expectedFeeBps} → ${actualFeeBps} bps). Please refresh and confirm.`,
        actual: { rate: actualRate, feeBps: actualFeeBps },
        expected: { rate: expectedRate, feeBps: expectedFeeBps },
      },
    };
  }

  return { ok: true };
}
