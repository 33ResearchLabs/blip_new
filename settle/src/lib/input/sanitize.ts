/**
 * Input sanitizers shared by the amount/rate fields in offer + corridor
 * forms. Guarantees:
 *   - Only digits and at most one decimal point survive.
 *   - Integer part capped at `maxInt` digits, decimal part at `maxDec`.
 *   - Empty string stays empty so the placeholder can still show.
 *
 * Callers should still run a business-bound check on submit
 * (e.g. amount ≤ 1,000,000 USDT, rate within [0.01, 10000]).
 */

export interface ClampDecimalOpts {
  maxInt: number;
  maxDec: number;
}

export function clampDecimal(raw: string, opts: ClampDecimalOpts): string {
  // Strip anything that isn't a digit or dot.
  let s = raw.replace(/[^0-9.]/g, "");
  if (!s) return "";

  // Keep only the first dot; any further dots are dropped.
  const firstDot = s.indexOf(".");
  if (firstDot >= 0) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }

  // Leading zeros like "0005" → "5". Preserve "0." and "0".
  if (firstDot !== 0 && /^0\d/.test(s)) s = s.replace(/^0+/, "");
  if (s === "" || s.startsWith(".")) s = "0" + s;

  const [intPart, decPart = ""] = s.split(".");
  const intClamped = intPart.slice(0, opts.maxInt);
  if (firstDot < 0) return intClamped;
  return `${intClamped}.${decPart.slice(0, opts.maxDec)}`;
}

/** Conventional presets so callers don't re-derive the limits each time. */
export const DECIMAL_PRESETS = {
  /** Fiat-per-crypto rate, e.g. 3.6700 AED/USDT or 83.2500 INR/USDT. */
  rate: { maxInt: 5, maxDec: 4 },
  /** USDT amounts. 10 integer digits = up to 9,999,999,999 USDT. */
  amount: { maxInt: 10, maxDec: 2 },
  /** Percentage (premium / fee). 2 int digits = 99%, 2 decimals. */
  percent: { maxInt: 2, maxDec: 2 },
} as const;
