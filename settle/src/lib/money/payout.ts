/**
 * Deterministic payout math. Mirrors the Anchor program's
 * `utils/fees.rs::calculate_fee` exactly (truncating integer division on
 * base units) so the UI, the core-api, and the on-chain program all agree
 * on the same number down to the last lamport.
 *
 *   fee    = floor(amount * fee_bps / 10_000)      [base units, u64]
 *   payout = amount - fee
 *
 * Everything in this module operates on BigInt base units (e.g. for USDT
 * with 6 decimals, 1 USDT == 1_000_000 base units). Never pass floats.
 */

import { formatCrypto, formatFiat, formatRate, formatPercentage } from '@/lib/format';

export const USDT_DECIMALS = 6;
export const FEE_BPS_MAX = 10_000;

export type Phase = 'indicative' | 'locked' | 'realised';

export interface AmountInput {
  /** Which lifecycle phase we're rendering for — controls labels + guarantees. */
  phase: Phase;
  /** Gross crypto amount in smallest units (u64). 100 USDT = 100_000_000n. */
  grossCryptoBase: bigint;
  /** Mint decimals — 6 for USDT. */
  mintDecimals?: number;
  /** Protocol fee in basis points, [0, 10_000]. */
  feeBps: number;
  /** Fiat-per-1-token rate. Snapshot (locked/realised) or live (indicative). */
  rate: number;
  /** ISO currency code of `rate`'s fiat leg ('AED' | 'INR' | 'USD' | ...). */
  fiatCurrency: string;
  /** On-chain realised payout in base units. Required in phase='realised'. */
  finalPayoutBase?: bigint;
  /** On-chain realised fee in base units. Required in phase='realised'. */
  finalFeeBase?: bigint;
}

export interface AmountParts {
  grossCryptoBase: bigint;
  feeCryptoBase: bigint;
  netCryptoBase: bigint;
  grossCrypto: number;
  feeCrypto: number;
  netCrypto: number;
  fiatGross: number;
  fiatNet: number;
  feeBps: number;
  rate: number;
}

export interface AmountView extends AmountParts {
  // Pre-formatted display strings (always go through @/lib/format).
  grossCryptoLabel: string;
  feeCryptoLabel: string;
  netCryptoLabel: string;
  feePercentLabel: string;
  fiatGrossLabel: string;
  fiatNetLabel: string;
  rateLabel: string;
  effectivePriceLabel: string;
  phase: Phase;
  priceSourceLabel: 'Indicative' | 'Locked rate' | 'Realised';
  disclaimer: string | null;
  fiatCurrency: string;
}

/**
 * Bigint-safe, base-unit floor division matching the on-chain fee formula.
 */
const BPS_DENOMINATOR = BigInt(10_000);
const ZERO = BigInt(0);

export function calculateFeeBase(
  amountBase: bigint,
  feeBps: number,
): { payoutBase: bigint; feeBase: bigint } {
  if (amountBase <= ZERO) throw new Error('amount_zero');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > FEE_BPS_MAX) {
    throw new Error('fee_bps_range');
  }
  const fee = (amountBase * BigInt(feeBps)) / BPS_DENOMINATOR; // truncated == Rust u128 checked_div
  const payout = amountBase - fee;
  if (payout < ZERO) throw new Error('insufficient');
  return { payoutBase: payout, feeBase: fee };
}

/**
 * Convert base units → decimal number for display. Safe for USDT supply
 * under 2^53 smallest units (>9B USDT), which is fine for this app.
 */
export function baseToFloat(base: bigint, decimals: number): number {
  const div = 10 ** decimals;
  return Number(base) / div;
}

/**
 * Convert a user-entered decimal string → base units (BigInt), clamped to
 * the mint's decimals. Rejects non-numeric input.
 */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('invalid_amount');
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const mult = BigInt(10) ** BigInt(decimals);
  return BigInt(whole) * mult + BigInt(fracPadded || '0');
}

/**
 * Primary entry point. Returns deterministic display parts + formatted
 * labels ready to drop into JSX. All renderers must call this; never do
 * ad-hoc crypto/fiat math in components.
 */
export function computeAmountView(input: AmountInput): AmountView {
  const decimals = input.mintDecimals ?? USDT_DECIMALS;

  const feeBase =
    input.phase === 'realised' && input.finalFeeBase !== undefined
      ? input.finalFeeBase
      : calculateFeeBase(input.grossCryptoBase, input.feeBps).feeBase;

  const payoutBase =
    input.phase === 'realised' && input.finalPayoutBase !== undefined
      ? input.finalPayoutBase
      : input.grossCryptoBase - feeBase;

  const grossCrypto = baseToFloat(input.grossCryptoBase, decimals);
  const feeCrypto = baseToFloat(feeBase, decimals);
  const netCrypto = baseToFloat(payoutBase, decimals);

  const fiatGross = grossCrypto * input.rate;
  const fiatNet = netCrypto * input.rate;

  const priceSourceLabel: AmountView['priceSourceLabel'] =
    input.phase === 'indicative'
      ? 'Indicative'
      : input.phase === 'locked'
        ? 'Locked rate'
        : 'Realised';

  const disclaimer =
    input.phase === 'indicative'
      ? 'Estimate. Final rate is locked at order placement.'
      : null;

  // Effective price realised by the recipient after fees.
  const effectivePrice = netCrypto > 0 ? fiatNet / netCrypto : 0;

  return {
    // Raw (base + float)
    grossCryptoBase: input.grossCryptoBase,
    feeCryptoBase: feeBase,
    netCryptoBase: payoutBase,
    grossCrypto,
    feeCrypto,
    netCrypto,
    fiatGross,
    fiatNet,
    feeBps: input.feeBps,
    rate: input.rate,
    // Formatted
    grossCryptoLabel: `${formatCrypto(grossCrypto)} USDT`,
    feeCryptoLabel: `${formatCrypto(feeCrypto)} USDT`,
    netCryptoLabel: `${formatCrypto(netCrypto)} USDT`,
    feePercentLabel: formatPercentage(input.feeBps / 100),
    fiatGrossLabel: formatFiat(fiatGross, input.fiatCurrency),
    fiatNetLabel: formatFiat(fiatNet, input.fiatCurrency),
    rateLabel: formatRate(input.rate),
    effectivePriceLabel: formatRate(effectivePrice),
    phase: input.phase,
    priceSourceLabel,
    disclaimer,
    fiatCurrency: input.fiatCurrency,
  };
}
