/**
 * Wallet unlock-credential format marker.
 *
 * Tracks per-actor whether the wallet was created/imported under the new
 * 6-digit-PIN format ('pin') or the legacy free-form password format
 * (absent / 'password'). The unlock UI reads this to pick between a PIN
 * keypad and a password input.
 *
 * Pure localStorage. No DB column, no migration. Existing wallets predate
 * this file and have no marker → the unlock UI defaults to the password
 * input, preserving zero-regression for everyone who already has a wallet.
 *
 * Scope: USER actor only. Merchant flow is unchanged and never writes a
 * marker, so a merchant unlocking on the same device sees the legacy
 * password input as before.
 */

const STORAGE_PREFIX = 'blip_wallet_format_v1';

export type WalletFormat = 'pin' | 'password';

function key(actorId: string): string {
  return `${STORAGE_PREFIX}:${actorId}`;
}

/** SSR-safe. Returns 'pin' when the actor created/imported their wallet
 *  under the PIN flow, otherwise null (caller treats null as legacy
 *  password format — never assume 'pin' from a missing marker). */
export function getWalletFormat(actorId: string | null): WalletFormat | null {
  if (!actorId || typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(key(actorId));
    return v === 'pin' || v === 'password' ? v : null;
  } catch {
    return null;
  }
}

/** Write the marker. Called after a successful wallet create or import on
 *  the user side. Never blocks the flow — quota / disabled storage just
 *  means the unlock UI will fall back to the legacy password input on the
 *  next mount, which is acceptable (the wallet itself still works). */
export function setWalletFormat(actorId: string | null, format: WalletFormat): void {
  if (!actorId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(key(actorId), format);
  } catch { /* non-fatal */ }
}

/** Clear the marker — for cases where the user deletes their wallet and
 *  starts fresh. Pairs with the existing clearEncryptedWallet path. */
export function clearWalletFormat(actorId: string | null): void {
  if (!actorId || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key(actorId));
  } catch { /* non-fatal */ }
}
