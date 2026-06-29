// Option catalogues for the merchant waitlist onboarding "intent" fields
// (trade_corridors + intended_payment_methods, migration 176). Single source
// of truth shared by the capture UI (UpgradeModal on the waitlist dashboard)
// and the admin waitlist Overview tab, so a stored id always renders with a
// friendly label and the server validates against the same allow-list the UI
// offers.

import type { PaymentMethod } from '@/lib/types/database';

export interface CorridorOption {
  id: string;          // stored value, e.g. 'USDT_INR'
  label: string;       // 'USDT / INR'
  fiat: string;
  country: string;
  flag: string;
  available?: boolean; // live now vs. "coming soon" — intent capture allows all
}

// USDT<->fiat corridor catalogue. Mirrors the merchant dashboard catalogue
// (components/merchant/MobileHomeView.tsx); kept here as the canonical list
// for waitlist intent capture + admin display.
export const TRADE_CORRIDORS: CorridorOption[] = [
  { id: 'USDT_INR', label: 'USDT / INR', fiat: 'INR', country: 'India', flag: '🇮🇳', available: true },
  { id: 'USDT_AED', label: 'USDT / AED', fiat: 'AED', country: 'United Arab Emirates', flag: '🇦🇪' },
  { id: 'USDT_USD', label: 'USDT / USD', fiat: 'USD', country: 'United States', flag: '🇺🇸' },
  { id: 'USDT_EUR', label: 'USDT / EUR', fiat: 'EUR', country: 'Eurozone', flag: '🇪🇺' },
  { id: 'USDT_GBP', label: 'USDT / GBP', fiat: 'GBP', country: 'United Kingdom', flag: '🇬🇧' },
  { id: 'USDT_PKR', label: 'USDT / PKR', fiat: 'PKR', country: 'Pakistan', flag: '🇵🇰' },
  { id: 'USDT_NGN', label: 'USDT / NGN', fiat: 'NGN', country: 'Nigeria', flag: '🇳🇬' },
  { id: 'USDT_BRL', label: 'USDT / BRL', fiat: 'BRL', country: 'Brazil', flag: '🇧🇷' },
  { id: 'USDT_PHP', label: 'USDT / PHP', fiat: 'PHP', country: 'Philippines', flag: '🇵🇭' },
  { id: 'USDT_KES', label: 'USDT / KES', fiat: 'KES', country: 'Kenya', flag: '🇰🇪' },
  { id: 'USDT_TRY', label: 'USDT / TRY', fiat: 'TRY', country: 'Turkey', flag: '🇹🇷' },
  { id: 'USDT_VND', label: 'USDT / VND', fiat: 'VND', country: 'Vietnam', flag: '🇻🇳' },
  { id: 'USDT_THB', label: 'USDT / THB', fiat: 'THB', country: 'Thailand', flag: '🇹🇭' },
  { id: 'USDT_IDR', label: 'USDT / IDR', fiat: 'IDR', country: 'Indonesia', flag: '🇮🇩' },
  { id: 'USDT_ZAR', label: 'USDT / ZAR', fiat: 'ZAR', country: 'South Africa', flag: '🇿🇦' },
  { id: 'USDT_MXN', label: 'USDT / MXN', fiat: 'MXN', country: 'Mexico', flag: '🇲🇽' },
];

export interface PaymentMethodOption {
  value: PaymentMethod;
  label: string;
}

// Payment-method types a merchant can commit to supporting. Mirrors the
// PaymentMethod union in lib/types/database.ts.
export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { value: 'upi',    label: 'UPI' },
  { value: 'bank',   label: 'Bank transfer' },
  { value: 'card',   label: 'Card' },
  { value: 'cash',   label: 'Cash' },
  { value: 'mobile', label: 'Mobile money' },
  { value: 'other',  label: 'Other' },
];

// ── Country catalogue ───────────────────────────────────────────────
// Stored as merchants.country_code (ISO-3166 alpha-2, uppercase). Mirrors
// the countries represented by the corridor catalogue above so the two
// dropdowns stay consistent.
export interface CountryOption {
  code: string;   // stored value, e.g. 'IN'
  label: string;  // 'India'
  flag: string;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'IN', label: 'India', flag: '🇮🇳' },
  { code: 'AE', label: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'US', label: 'United States', flag: '🇺🇸' },
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
  { code: 'EU', label: 'Eurozone', flag: '🇪🇺' },
  { code: 'PK', label: 'Pakistan', flag: '🇵🇰' },
  { code: 'NG', label: 'Nigeria', flag: '🇳🇬' },
  { code: 'BR', label: 'Brazil', flag: '🇧🇷' },
  { code: 'PH', label: 'Philippines', flag: '🇵🇭' },
  { code: 'KE', label: 'Kenya', flag: '🇰🇪' },
  { code: 'TR', label: 'Turkey', flag: '🇹🇷' },
  { code: 'VN', label: 'Vietnam', flag: '🇻🇳' },
  { code: 'TH', label: 'Thailand', flag: '🇹🇭' },
  { code: 'ID', label: 'Indonesia', flag: '🇮🇩' },
  { code: 'ZA', label: 'South Africa', flag: '🇿🇦' },
  { code: 'MX', label: 'Mexico', flag: '🇲🇽' },
];

// ── Commit-volume buckets ───────────────────────────────────────────
// The UI offers ranges; we persist a single representative USD figure in
// the existing merchants.expected_monthly_volume_usd numeric column (no
// migration). `usd` is the bucket's upper bound — the top bucket is
// open-ended and stored as a sentinel high figure.
export interface VolumeBucketOption {
  id: string;     // stored selection id (UI only)
  label: string;
  usd: number;    // representative USD written to expected_monthly_volume_usd
}

export const COMMIT_VOLUME_OPTIONS: VolumeBucketOption[] = [
  { id: 'lt_10k',   label: 'Under $10k',   usd: 10_000 },
  { id: '10k_50k',  label: '$10k – $50k',  usd: 50_000 },
  { id: '50k_250k', label: '$50k – $250k', usd: 250_000 },
  { id: '250k_1m',  label: '$250k – $1M',  usd: 1_000_000 },
  { id: 'gt_1m',    label: '$1M+',         usd: 5_000_000 },
];

const CORRIDOR_ID_SET = new Set<string>(TRADE_CORRIDORS.map((c) => c.id));
const PAYMENT_METHOD_SET = new Set<string>(PAYMENT_METHOD_OPTIONS.map((p) => p.value));
const COUNTRY_CODE_SET = new Set<string>(COUNTRY_OPTIONS.map((c) => c.code));

// id/value -> label helpers for read-only admin display. Unknown ids fall
// back to the raw value so we never hide data we can't pretty-print.
export function corridorLabel(id: string): string {
  return TRADE_CORRIDORS.find((c) => c.id === id)?.label ?? id;
}

export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHOD_OPTIONS.find((p) => p.value === value)?.label ?? value;
}

export function countryLabel(code: string): string {
  return COUNTRY_OPTIONS.find((c) => c.code === code)?.label ?? code;
}

// Validate a country code against the allow-list; null if unknown/empty.
export function sanitizeCountryCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return COUNTRY_CODE_SET.has(code) ? code : null;
}

// Bucket id -> representative USD for storage. null if unknown/empty.
export function volumeBucketToUsd(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  return COMMIT_VOLUME_OPTIONS.find((b) => b.id === input)?.usd ?? null;
}

// USD number -> bucket id, for prefilling the dropdown from a stored value.
// Exact match first; otherwise the smallest bucket whose upper bound is
// >= the stored value (so a legacy free-text number still lands in a
// sensible range). null if no value.
export function volumeUsdToBucket(usd: number | null | undefined): string | null {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return null;
  const exact = COMMIT_VOLUME_OPTIONS.find((b) => b.usd === usd);
  if (exact) return exact.id;
  const fit = COMMIT_VOLUME_OPTIONS.find((b) => usd <= b.usd);
  return (fit ?? COMMIT_VOLUME_OPTIONS[COMMIT_VOLUME_OPTIONS.length - 1]).id;
}

// Server-side sanitizers: keep only known values, de-dupe, cap length, and
// collapse an empty/absent selection to null so the DB stores NULL (admin
// then shows "—") rather than an empty array. Shared by both register paths.
export function sanitizeCorridorIds(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = Array.from(
    new Set(input.filter((v): v is string => typeof v === 'string' && CORRIDOR_ID_SET.has(v))),
  ).slice(0, TRADE_CORRIDORS.length);
  return out.length ? out : null;
}

export function sanitizePaymentMethodValues(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = Array.from(
    new Set(input.filter((v): v is string => typeof v === 'string' && PAYMENT_METHOD_SET.has(v))),
  ).slice(0, PAYMENT_METHOD_OPTIONS.length);
  return out.length ? out : null;
}
