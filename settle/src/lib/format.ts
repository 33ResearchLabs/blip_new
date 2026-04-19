/**
 * Central number/currency formatters.
 *
 * ALL numeric UI values must route through these — see CLAUDE.md
 * "Number & Currency Formatting" for the precision & locale rules.
 *
 * - Locale is hard-coded to `en-US` (no `en-IN`, no browser default).
 * - Precision defaults match the rules table:
 *     crypto / fiat / balance / fee → 2 decimals
 *     exchange rate                  → 4 decimals
 *     percentage                     → 2 decimals + '%' suffix
 *     count (trades, orders, users)  → 0 decimals
 * - Every function is null/undefined/NaN-safe and returns `—` for
 *   missing values rather than rendering "NaN" or "0" and silently
 *   lying to the user.
 */

const FIAT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// NOTE: exchange rates are displayed with 2 decimals app-wide per product
// direction ("100.00, not 100.0000"). If you need a high-precision readout
// for debug or reconciliation, call `formatRate(v, { decimals: 4 })`.
const RATE_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PCT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COUNT_FORMATTER = new Intl.NumberFormat('en-US');

/** Displayed when the input value is missing/invalid. */
export const PLACEHOLDER = '—';

/**
 * Coerce an unknown value into a finite number, or null if it isn't one.
 * Accepts plain numbers and numeric strings (the DB driver often returns
 * `numeric` columns as strings).
 */
function safeNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Crypto amounts (USDT, USDC, etc.). Defaults to 2 decimals.
 *
 * Pass `{ decimals }` when an exception is truly needed (e.g. a debug
 * readout that wants 6-decimal precision). Prefer the default everywhere
 * else so the UI stays consistent.
 */
export function formatCrypto(
  value: unknown,
  opts?: { decimals?: number },
): string {
  const n = safeNumber(value);
  if (n == null) return PLACEHOLDER;
  if (opts?.decimals != null) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: opts.decimals,
      maximumFractionDigits: opts.decimals,
    }).format(n);
  }
  return FIAT_FORMATTER.format(n);
}

/**
 * Fiat amounts (INR, AED, USD). 2 decimals + a currency symbol prefix
 * when the currency is supplied. Unknown currencies fall back to a
 * "{CODE} " prefix (e.g. "EUR 1,234.00").
 */
export function formatFiat(value: unknown, currency?: string): string {
  const n = safeNumber(value);
  if (n == null) return PLACEHOLDER;
  const body = FIAT_FORMATTER.format(n);
  if (!currency) return body;
  const symbol =
    currency === 'INR' ? '₹'
    : currency === 'AED' ? 'AED '
    : currency === 'USD' ? '$'
    : `${currency} `;
  return `${symbol}${body}`;
}

/**
 * Exchange rates (e.g. USDT/INR 98.00). 2 decimals by default.
 * Pass `{ decimals: 4 }` when you explicitly need high precision (e.g. a
 * reconciliation report). UI should stick to the default.
 */
export function formatRate(
  value: unknown,
  opts?: { decimals?: number },
): string {
  const n = safeNumber(value);
  if (n == null) return PLACEHOLDER;
  if (opts?.decimals != null) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: opts.decimals,
      maximumFractionDigits: opts.decimals,
    }).format(n);
  }
  return RATE_FORMATTER.format(n);
}

/**
 * Percentages. Input is the literal percent (e.g. 2.5 → "2.50%"), not
 * the fractional form (0.025). 2 decimals + '%' suffix.
 */
export function formatPercentage(value: unknown): string {
  const n = safeNumber(value);
  if (n == null) return PLACEHOLDER;
  return `${PCT_FORMATTER.format(n)}%`;
}

/**
 * Integer counts (trades, orders, users). No decimals, thousand
 * separators preserved ("1,234 trades"). Non-integers are truncated
 * toward zero — rounding is wrong for "completed trades" etc.
 */
export function formatCount(value: unknown): string {
  const n = safeNumber(value);
  if (n == null) return PLACEHOLDER;
  return COUNT_FORMATTER.format(Math.trunc(n));
}
