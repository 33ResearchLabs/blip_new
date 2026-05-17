'use client';

/**
 * PaymentPinRow — DEPRECATED.
 *
 * The Payment PIN row now lives inside the unified Security card in
 * `src/components/app-lock/AppLockSettingsCard.tsx`, which absorbs the
 * server-side PIN management (set / change / reset) alongside App Lock
 * PIN, Biometric Unlock, Payment Methods, Trusted Devices and Change
 * Password rows.
 *
 * This file is kept as a stub for any external importer; the rendered
 * row returns `null`. New code should not import from here — render the
 * Security card directly.
 */

interface Props {
  userId: string | null;
}

export function PaymentPinRow(_props: Props) {
  return null;
}
