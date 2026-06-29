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

const CORRIDOR_ID_SET = new Set<string>(TRADE_CORRIDORS.map((c) => c.id));
const PAYMENT_METHOD_SET = new Set<string>(PAYMENT_METHOD_OPTIONS.map((p) => p.value));

// id/value -> label helpers for read-only admin display. Unknown ids fall
// back to the raw value so we never hide data we can't pretty-print.
export function corridorLabel(id: string): string {
  return TRADE_CORRIDORS.find((c) => c.id === id)?.label ?? id;
}

export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHOD_OPTIONS.find((p) => p.value === value)?.label ?? value;
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
