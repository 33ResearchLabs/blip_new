/**
 * Embedded Wallet Crypto Service
 * Non-custodial keypair management with AES-GCM encryption
 * Keys never leave the browser — encrypted at rest in localStorage
 *
 * Requires Web Crypto API (`crypto.subtle`), which is available on every
 * HTTPS origin and on http://localhost. Any other context (plain-HTTP on
 * a non-localhost host) is refused: we will not silently downgrade to a
 * weaker cipher just to make the wallet "work" on an insecure transport.
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

// BIP39 mnemonic + HD derivation for Solana (Step 4 of wallet hardening).
//
// Standard Solana derivation path matches Phantom / Solflare / Sollet, so a
// mnemonic exported from this wallet can be imported into any of them and
// produce the same public key. 12 words = 128 bits of entropy — the industry
// default. We could offer 24-word (256 bits) as an option later; for the
// MVP we ship one consistent format.
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
const MNEMONIC_WORD_COUNT = 12;
const MNEMONIC_ENTROPY_BITS = 128; // 12 words = 128 bits
const MNEMONIC_STORAGE_KEY_PREFIX = 'blip_embedded_mnemonic';

function mnemonicStorageKey(actorId: string): string {
  return `${MNEMONIC_STORAGE_KEY_PREFIX}:${actorId}`;
}

// Storage is namespaced by actor (user.id / merchant.id) so multiple
// accounts on the same browser don't bleed into each other. Previously
// a single device-wide key meant signing up as User B on a device that
// once held User A's wallet showed an "Unlock Wallet" prompt for a blob
// User B has no password for.
//
// LEGACY_* are the pre-namespacing keys. `migrateLegacyWallet(actorId)`
// renames them into the per-actor slot the first time we see a known
// actor on a device with old data. Migration is one-way and idempotent.
const STORAGE_KEY_PREFIX = 'blip_embedded_wallet';
const SESSION_KEY_PREFIX = 'blip_wallet_session';
const FAILURES_KEY_PREFIX = 'blip_unlock_failures';
const LEGACY_STORAGE_KEY = 'blip_embedded_wallet';
const LEGACY_SESSION_KEY = 'blip_wallet_session';

// Blob version → (iterations, requires server-side unlock helper).
//
//   v1 = 100k PBKDF2, no helper.        — legacy mainnet wallets.
//   v2 = 600k PBKDF2, no helper.        — Step 2 hardening.
//   v3 = 600k PBKDF2, helper required.  — Step 3: per-actor server secret
//                                          mixed into the password. An
//                                          attacker with only the offline
//                                          blob CANNOT brute-force; the
//                                          server helper is needed too.
//
// Caller never picks the iteration count or version target — the version
// field on the EncryptedWallet fully determines decrypt behavior, and
// encrypt always uses the CURRENT_BLOB_VERSION.
const CURRENT_BLOB_VERSION = 3;

interface VersionParams {
  iterations: number;
  requiresHelper: boolean;
}

const VERSION_PARAMS: Record<number, VersionParams> = {
  1: { iterations: 100_000, requiresHelper: false },
  2: { iterations: 600_000, requiresHelper: false },
  3: { iterations: 600_000, requiresHelper: true },
};

function paramsForVersion(version: number): VersionParams {
  return VERSION_PARAMS[version] ?? VERSION_PARAMS[1];
}

function iterationsForVersion(version: number): number {
  return paramsForVersion(version).iterations;
}

/** Whether a given blob version needs a server-fetched unlock helper to
 *  decrypt. Used by the context to decide whether to fetch the helper
 *  before attempting decrypt. */
export function versionRequiresHelper(version: number): boolean {
  return paramsForVersion(version).requiresHelper;
}

/** Whether the CURRENT build's new wallets need a helper. Used by
 *  creation flows to decide whether to fetch the helper before generate. */
export function currentVersionRequiresHelper(): boolean {
  return paramsForVersion(CURRENT_BLOB_VERSION).requiresHelper;
}

/** Combine password + helper into the byte string fed to PBKDF2. Space
 *  separator (not in any base64-helper alphabet) prevents collisions
 *  between e.g. ("ab", "cd") and ("abcd", null). */
function passwordWithHelper(password: string, helper: string | null | undefined): string {
  return helper ? `${password} ${helper}` : password;
}

// Failed-unlock counter threshold. After this many consecutive wrong
// passwords, the local encrypted blob is wiped and the user must recover
// via their previously-exported private key. Funds are NEVER at risk —
// the keypair still exists on-chain; only the device cache is removed.
//
// 5 is the standard "too many tries" threshold. Lower = more annoying for
// forgetful users. Higher = more bites at the apple for an attacker.
export const MAX_UNLOCK_FAILURES = 5;

function storageKey(actorId: string): string {
  return `${STORAGE_KEY_PREFIX}:${actorId}`;
}

function sessionKey(actorId: string): string {
  return `${SESSION_KEY_PREFIX}:${actorId}`;
}

function failuresKey(actorId: string): string {
  return `${FAILURES_KEY_PREFIX}:${actorId}`;
}

// ---- Password strength ----
//
// Validation runs ONLY at wallet creation (generate or import-with-new-
// password). Never at unlock — that would lock out existing mainnet
// users whose original wallet was created with a weaker password.
//
// The blocklist is intentionally short (top common passwords); a full
// rockyou-sized list (~14M entries) is not practical to ship to the
// browser. The first line of defence is the 12-char minimum length.

const COMMON_PASSWORDS = new Set<string>([
  '123456', '123456789', 'qwerty', 'password', '12345678', '111111', '123123',
  '1234567890', '1234567', 'qwerty123', '000000', '1q2w3e', 'aa12345678',
  'abc123', 'password1', '1234', '12345', 'iloveyou', '7777777', 'monkey',
  'dragon', 'letmein', 'sunshine', 'princess', 'admin', 'welcome', '666666',
  'shadow', 'master', 'football', 'baseball', 'superman', 'qazwsx', 'michael',
  'jordan23', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwerty12345',
  'password123', 'admin123', 'root', 'toor', 'pass', 'test', 'guest',
  'changeme', 'login', 'starwars', 'whatever', 'trustno1', 'hello123',
  'freedom', 'computer', 'matrix', 'qwer1234', 'asdf1234', 'qweqweqwe',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwertyui', 'zaq12wsx', 'q1w2e3r4',
  'q1w2e3r4t5', 'samsung', 'google', 'apple123', 'iphone', 'android',
  'facebook', 'twitter', 'instagram', 'youtube', 'gmail', 'yahoo',
  'hotmail', 'outlook', 'paypal', 'amazon', 'netflix', 'spotify',
  'bitcoin', 'crypto', 'ethereum', 'solana', 'wallet', 'wallet123',
  'satoshi', 'blockchain', 'metamask', 'phantom', 'binance', 'coinbase',
  'usdt', 'usdc', 'tether', 'blip', 'blipmoney', 'blip123', 'blip2026',
  'money', 'cash', 'bank', 'qwerty1', '654321', '987654', '111222',
  '987654321', 'asdasd', 'asdfgh', 'asdf', 'qwer', '0987654321',
]);

export interface PasswordStrengthResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a wallet password at CREATION time. Returns ok=true if the
 * password is acceptable. Run from `generateWallet` / `importWallet`
 * callers — do NOT run at unlock (existing wallets may have weaker
 * passwords that we cannot retroactively reject without locking the
 * user out of their funds).
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, reason: 'Password is required' };
  }
  // Short numeric PINs (4-6 digits) are explicitly allowed here because new
  // (v3+) wallet blobs mix the password with a 256-bit server-side
  // unlock_helper before deriving the AES key. An offline attacker with only
  // the localStorage blob cannot brute-force — they need the helper, which
  // is only released after an authenticated server roundtrip that's rate-
  // limited at the route level. So a 4-digit PIN here is cryptographically
  // equivalent to a long passphrase against an offline attacker.
  if (/^[0-9]{4,6}$/.test(password)) {
    return { ok: true };
  }
  // 12 is the minimum length where a passphrase or a random 8-char
  // password + a few words starts to become brute-force-resistant
  // given the 600k PBKDF2 we now use. Shorter passwords fall to
  // dictionary + GPU-accelerated attacks even with strong KDF params.
  if (password.length < 12) {
    return { ok: false, reason: 'Password must be at least 12 characters' };
  }
  if (password.length > 256) {
    return { ok: false, reason: 'Password is too long (max 256 characters)' };
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, reason: 'That password is too common — pick something unique' };
  }
  return { ok: true };
}

// Check if Web Crypto API is available (requires HTTPS or localhost).
// All real wallet operations refuse to proceed without it — see
// requireSubtleCrypto() below.
const hasSubtleCrypto = typeof globalThis !== 'undefined'
  && typeof globalThis.crypto !== 'undefined'
  && typeof globalThis.crypto.subtle !== 'undefined';

/** Thrown when a wallet crypto operation is attempted on an insecure
 *  origin (plain-HTTP non-localhost). Surfaced to the user as a clear
 *  "HTTPS required" message rather than a silent crypto downgrade. */
function requireSubtleCrypto(): void {
  if (!hasSubtleCrypto) {
    throw new Error(
      'Wallet crypto unavailable: this page must be served over HTTPS ' +
      '(or localhost). Insecure-origin fallbacks have been removed to ' +
      'prevent weakening the wallet encryption.'
    );
  }
}

export interface EncryptedWallet {
  encryptedKey: string; // base64
  iv: string;           // base64
  salt: string;         // base64
  publicKey: string;    // base58
  version: number;
}

// ---- BIP39 mnemonic helpers (Step 4) ----

/** Generate a fresh BIP39 mnemonic phrase (12 words). The same phrase
 *  can be imported into Phantom / Solflare / Sollet under the standard
 *  Solana derivation path and will yield the same public key. */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(MNEMONIC_ENTROPY_BITS);
}

/** Whether the given input is a valid BIP39 mnemonic phrase. Used by
 *  the import flow to distinguish between mnemonic input and base58
 *  private-key input. */
export function isValidMnemonic(phrase: string): boolean {
  // Normalize: trim, collapse whitespace, lowercase. BIP39 word list is all
  // lowercase, so users who paste "Apple banana …" from a backup card would
  // otherwise fail validation. Phantom / Solflare also lowercase on import.
  const trimmed = phrase.trim().split(/\s+/).join(' ').toLowerCase();
  const wordCount = trimmed.split(' ').length;
  // BIP39 standard: 12, 15, 18, 21, or 24 words.
  if (![12, 15, 18, 21, 24].includes(wordCount)) return false;
  return bip39.validateMnemonic(trimmed);
}

/** Derive a Solana Keypair from a BIP39 mnemonic using the standard
 *  Phantom-compatible derivation path m/44'/501'/0'/0'. Returns the
 *  same keypair every call for the same mnemonic. */
export function mnemonicToKeypair(phrase: string): Keypair {
  const seed = bip39.mnemonicToSeedSync(phrase.trim());
  const { key } = derivePath(SOLANA_DERIVATION_PATH, Buffer.from(seed).toString('hex'));
  return Keypair.fromSeed(key);
}

/** Generate a new mnemonic-derived wallet and encrypt both the secret
 *  key and the mnemonic itself. The mnemonic ciphertext is stored
 *  separately (caller passes the returned `encryptedMnemonic` to
 *  saveEncryptedMnemonic). This gives the user a recoverable backup
 *  via the standard 12-word phrase — losing the device but having the
 *  phrase = funds recoverable in any Solana wallet.
 *
 *  Backward compat: regular `generateWallet` (random keypair, no
 *  mnemonic) still works and is used for code paths that don't yet
 *  support mnemonic backup. */
export async function generateMnemonicWallet(
  password: string,
  unlockHelper?: string | null,
): Promise<{
  keypair: Keypair;
  mnemonic: string;
  encrypted: EncryptedWallet;
  encryptedMnemonic: EncryptedWallet;
}> {
  const mnemonic = generateMnemonic();
  const keypair = mnemonicToKeypair(mnemonic);
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58(), unlockHelper);
  // Encrypt the mnemonic under the same KDF as the secret key, but use a
  // fresh IV (and a separate ciphertext) so the two blobs are independent
  // — losing one doesn't reveal the other.
  const mnemonicBytes = new TextEncoder().encode(mnemonic);
  const encryptedMnemonic = await encryptSecretKey(mnemonicBytes, password, keypair.publicKey.toBase58(), unlockHelper);
  return { keypair, mnemonic, encrypted, encryptedMnemonic };
}

/** Generate a new Solana keypair and encrypt it (random keypair, no mnemonic).
 *  Retained for callers that don't (yet) surface mnemonic backup. New code
 *  should prefer generateMnemonicWallet so users get a recoverable phrase.
 *  @param unlockHelper - REQUIRED when the current blob version requires
 *    one (v3+). Throws if missing. Callers fetch from /api/wallet/unlock-helper. */
export async function generateWallet(
  password: string,
  unlockHelper?: string | null,
): Promise<{ keypair: Keypair; encrypted: EncryptedWallet }> {
  const keypair = Keypair.generate();
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58(), unlockHelper);
  return { keypair, encrypted };
}

/** Import a wallet from EITHER a BIP39 mnemonic phrase OR a base58 private
 *  key. The function auto-detects the input format (word-count + BIP39 word-
 *  list check → mnemonic; else → base58). When a mnemonic is supplied we
 *  also return the encrypted-mnemonic blob so the caller can persist it
 *  and offer recovery later. */
export async function importWallet(
  secretInput: string,
  password: string,
  unlockHelper?: string | null,
): Promise<{
  keypair: Keypair;
  encrypted: EncryptedWallet;
  // Present only when the input was a mnemonic. Base58-imported wallets
  // have no mnemonic to store.
  mnemonic?: string;
  encryptedMnemonic?: EncryptedWallet;
}> {
  const trimmed = secretInput.trim();

  if (isValidMnemonic(trimmed)) {
    // Normalize spacing + case so the derived seed matches the canonical
    // phrase regardless of how the user typed it. BIP39 seed derivation is
    // case-sensitive, so "Apple Banana" and "apple banana" produce
    // different keypairs — only the lowercase form is canonical.
    const canonical = trimmed.split(/\s+/).join(' ').toLowerCase();
    const keypair = mnemonicToKeypair(canonical);
    const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58(), unlockHelper);
    const mnemonicBytes = new TextEncoder().encode(canonical);
    const encryptedMnemonic = await encryptSecretKey(mnemonicBytes, password, keypair.publicKey.toBase58(), unlockHelper);
    return { keypair, encrypted, mnemonic: canonical, encryptedMnemonic };
  }

  // Fall back to base58 private-key path (legacy import — no mnemonic).
  const secretKey = bs58.decode(trimmed);
  const keypair = Keypair.fromSecretKey(secretKey);
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58(), unlockHelper);
  return { keypair, encrypted };
}

/** Decrypt an encrypted wallet with password (+ helper for v3 blobs).
 *  Uses the iteration count and helper-requirement recorded on the blob,
 *  so v1 (100k, no helper) / v2 (600k, no helper) / v3 (600k, helper)
 *  all unlock under their original parameters.
 *
 *  Callers MUST fetch `unlockHelper` from /api/wallet/unlock-helper when
 *  the blob is v3 (use `versionRequiresHelper(encrypted.version)`). */
export async function decryptWallet(
  encrypted: EncryptedWallet,
  password: string,
  unlockHelper?: string | null,
): Promise<Keypair> {
  const salt = Uint8Array.from(atob(encrypted.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encrypted.encryptedKey), c => c.charCodeAt(0));
  const effectiveSecret = versionRequiresHelper(encrypted.version)
    ? passwordWithHelper(password, unlockHelper ?? null)
    : password;

  requireSubtleCrypto();
  const key = await deriveKey(effectiveSecret, salt, iterationsForVersion(encrypted.version));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return Keypair.fromSecretKey(new Uint8Array(decrypted));
}

/** Re-encrypt a successfully-decrypted wallet at the CURRENT blob version.
 *  Used by the unlock path to silently upgrade older blobs (v1/v2 → v3)
 *  without surfacing a re-password prompt.
 *
 *  Returns null if the blob is already at current version, OR if the
 *  upgrade target requires a helper the caller couldn't supply. When null
 *  is returned the original blob is untouched and remains valid. */
export async function reencryptIfStale(
  encrypted: EncryptedWallet,
  password: string,
  keypair: Keypair,
  unlockHelper?: string | null,
): Promise<EncryptedWallet | null> {
  if (encrypted.version >= CURRENT_BLOB_VERSION) return null;
  if (currentVersionRequiresHelper() && !unlockHelper) return null;
  try {
    return await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58(), unlockHelper);
  } catch {
    return null;
  }
}

/** Export keypair as base58 private key */
export function exportPrivateKey(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}

/** Save encrypted wallet to localStorage under the given actor's slot. */
export function saveEncryptedWallet(actorId: string, encrypted: EncryptedWallet): void {
  localStorage.setItem(storageKey(actorId), JSON.stringify(encrypted));
}

/** Load encrypted wallet for the given actor, or null if none exists. */
export function loadEncryptedWallet(actorId: string): EncryptedWallet | null {
  const raw = localStorage.getItem(storageKey(actorId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EncryptedWallet;
  } catch {
    return null;
  }
}

/** Clear encrypted wallet for the given actor. */
export function clearEncryptedWallet(actorId: string): void {
  localStorage.removeItem(storageKey(actorId));
}

/** Whether an encrypted wallet exists for the given actor. */
export function hasEncryptedWallet(actorId: string): boolean {
  return localStorage.getItem(storageKey(actorId)) !== null;
}

/**
 * Ask the browser to KEEP this origin's storage so the encrypted wallet
 * survives automatic eviction — e.g. Safari/WebKit's 7-day cap on
 * script-writable storage, or low-disk cleanup. Without this, an imported
 * wallet can silently vanish after a few days even though our own code
 * never deletes it.
 *
 * Security & regression notes:
 *   - This changes NOTHING about where/how the wallet is stored. Storage
 *     persistence applies to the whole origin bucket, so the existing
 *     localStorage blob (still encrypted with the user's PIN) is covered
 *     as-is. No data is moved, re-keyed, or exposed.
 *   - It only affects the ENCRYPTED blob's lifetime. The decrypted session
 *     key (`blip_wallet_session:*`) is untouched and is still wiped on
 *     logout / auto-lock exactly as before.
 *   - Best-effort and side-effect-free: never throws, and no-ops if the
 *     API is unavailable, on the server, or persistence is already granted.
 *
 * Returns whether storage is persisted after the call (for diagnostics
 * only — callers may ignore it).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return false;
    if (typeof navigator.storage.persisted === 'function') {
      // Already granted — nothing to do.
      if (await navigator.storage.persisted()) return true;
    }
    if (typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
    return false;
  } catch {
    // Storage API can throw in private/embedded contexts — never let a
    // best-effort durability request break wallet flows.
    return false;
  }
}

/** Save the decrypted keypair for the given actor.
 *
 *  SECURITY (P1): the decrypted secret key is the most sensitive value in
 *  the app. It is stored in **sessionStorage**, NOT localStorage, so the
 *  browser clears it automatically when the tab/window closes — shrinking
 *  the XSS/device-theft exposure window from days down to a single tab
 *  session. The ENCRYPTED wallet blob still lives in localStorage (and is
 *  kept across browser eviction via requestPersistentStorage), so funds
 *  are never lost; only the "stay unlocked without re-typing the PIN"
 *  convenience resets when the tab closes. Any decrypted copy left in
 *  durable localStorage by an older build is purged here. */
export function saveSessionKeypair(actorId: string, keypair: Keypair): void {
  const encoded = bs58.encode(keypair.secretKey);
  try {
    sessionStorage.setItem(sessionKey(actorId), encoded);
  } catch {
    // sessionStorage unavailable (private mode / disabled). Fail closed:
    // the wallet simply re-locks on next load rather than persisting the
    // plaintext key somewhere durable.
  }
  // Never leave the decrypted key in durable storage.
  localStorage.removeItem(sessionKey(actorId));
}

/** Load the decrypted keypair for the given actor, or null if no live
 *  session. Reads sessionStorage (the current home). If a legacy copy is
 *  found in localStorage — from an older build, or just written by the
 *  legacy-wallet migration — it is moved into sessionStorage and deleted
 *  from localStorage, so a previously-unlocked user stays unlocked across
 *  this upgrade while the durable plaintext copy is purged. */
export function loadSessionKeypair(actorId: string): Keypair | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(sessionKey(actorId));
  } catch {
    raw = null;
  }
  if (!raw) {
    const legacy = localStorage.getItem(sessionKey(actorId));
    if (legacy) {
      raw = legacy;
      try {
        sessionStorage.setItem(sessionKey(actorId), legacy);
      } catch {
        // Couldn't move it — still return the key below; the durable copy
        // is removed regardless so it doesn't linger.
      }
      localStorage.removeItem(sessionKey(actorId));
    }
  }
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    clearSessionKeypair(actorId);
    return null;
  }
}

/** Clear the session keypair for the given actor — from BOTH sessionStorage
 *  (current location) and localStorage (legacy), so no decrypted key
 *  survives a lock or logout in either store. */
export function clearSessionKeypair(actorId: string): void {
  try {
    sessionStorage.removeItem(sessionKey(actorId));
  } catch {
    // ignore — best-effort
  }
  localStorage.removeItem(sessionKey(actorId));
}

// ---- BIP39 mnemonic storage (Step 4) ----
//
// Mnemonic ciphertext lives in a separate localStorage entry from the
// wallet itself so the wallet blob format is unchanged (no migration
// needed for v1/v2/v3 blobs). Loss of either blob doesn't compromise
// the other: an attacker who gets the mnemonic blob still needs the
// password (+ server helper for v3) to decrypt it.
//
// Recoverability story: if the device is lost / browser data wiped /
// password forgotten, the user can import the 12-word phrase into ANY
// Solana wallet (Phantom, Solflare, etc.) under the standard
// m/44'/501'/0'/0' path and regain access to their funds. The mnemonic
// blob in localStorage is just a UX convenience for "show recovery
// phrase" — the phrase the user wrote down on paper at creation is the
// real backup.

export function saveEncryptedMnemonic(actorId: string, encrypted: EncryptedWallet): void {
  localStorage.setItem(mnemonicStorageKey(actorId), JSON.stringify(encrypted));
}

export function loadEncryptedMnemonic(actorId: string): EncryptedWallet | null {
  const raw = localStorage.getItem(mnemonicStorageKey(actorId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EncryptedWallet;
  } catch {
    return null;
  }
}

export function hasEncryptedMnemonic(actorId: string): boolean {
  return localStorage.getItem(mnemonicStorageKey(actorId)) !== null;
}

export function clearEncryptedMnemonic(actorId: string): void {
  localStorage.removeItem(mnemonicStorageKey(actorId));
}

/** Decrypt a previously-saved mnemonic. Same crypto path as decryptWallet
 *  but returns the plaintext mnemonic phrase instead of a Keypair. Used by
 *  the "Show Recovery Phrase" UI — requires the user to re-enter their
 *  password (and fetches the server helper for v3 blobs). */
export async function decryptMnemonic(
  encrypted: EncryptedWallet,
  password: string,
  unlockHelper?: string | null,
): Promise<string> {
  const salt = Uint8Array.from(atob(encrypted.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encrypted.encryptedKey), c => c.charCodeAt(0));
  const effectiveSecret = versionRequiresHelper(encrypted.version)
    ? passwordWithHelper(password, unlockHelper ?? null)
    : password;

  requireSubtleCrypto();
  const key = await deriveKey(effectiveSecret, salt, iterationsForVersion(encrypted.version));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new TextDecoder().decode(new Uint8Array(decrypted));
}

/** Re-encrypt the wallet (and mnemonic, if present) under a new password.
 *  Used by the password→PIN migration UI: caller decrypts with the old
 *  password, then calls this to persist a new blob keyed off the new
 *  password. No-ops the mnemonic if there isn't one stored.
 *
 *  Caller is responsible for: (a) ensuring the keypair came from a
 *  successful decrypt with `oldPassword`, and (b) supplying a valid
 *  `unlockHelper` (mandatory at v3+). On any failure the original blobs
 *  are left untouched. */
export async function changeWalletPassword(
  actorId: string,
  oldPassword: string,
  newPassword: string,
  keypair: Keypair,
  unlockHelper?: string | null,
): Promise<void> {
  if (currentVersionRequiresHelper() && !unlockHelper) {
    throw new Error('Server helper unavailable — cannot re-encrypt');
  }

  // Re-encrypt the secret key under the new password at the current
  // blob version. saveEncryptedWallet only writes after the encrypt
  // succeeds, so a thrown error leaves the old blob in place.
  const newEncrypted = await encryptSecretKey(
    keypair.secretKey,
    newPassword,
    keypair.publicKey.toBase58(),
    unlockHelper,
  );
  saveEncryptedWallet(actorId, newEncrypted);

  // Mnemonic blob is optional — only re-encrypt if one already exists
  // (i.e. wallet was created via the new mnemonic path, not a base58
  // import). Failure here doesn't void the wallet itself: user can
  // still recover via the written 12 words.
  const oldMnemonicBlob = loadEncryptedMnemonic(actorId);
  if (oldMnemonicBlob) {
    try {
      const phrase = await decryptMnemonic(oldMnemonicBlob, oldPassword, unlockHelper);
      const mnemonicBytes = new TextEncoder().encode(phrase);
      const newMnemonic = await encryptSecretKey(
        mnemonicBytes,
        newPassword,
        keypair.publicKey.toBase58(),
        unlockHelper,
      );
      saveEncryptedMnemonic(actorId, newMnemonic);
    } catch {
      // Old mnemonic blob couldn't be re-encrypted — leave it; the
      // wallet's main key is already updated. User retains paper backup.
    }
  }
}

// ---- Failed-unlock counter ----
//
// Tracks consecutive wrong-password attempts per actor. The unlock path
// in EmbeddedWalletContext increments this on every failure and clears
// it on success. When the count reaches MAX_UNLOCK_FAILURES, the local
// encrypted blob is wiped — the user must then recover via the private
// key they exported during setup (Export Key UI is mandatory at
// creation, so every user has this). Funds are never at risk.

export function getUnlockFailureCount(actorId: string): number {
  const raw = localStorage.getItem(failuresKey(actorId));
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Increment the per-actor failure counter and return the new count. */
export function recordUnlockFailure(actorId: string): number {
  const next = getUnlockFailureCount(actorId) + 1;
  localStorage.setItem(failuresKey(actorId), String(next));
  return next;
}

/** Reset the per-actor failure counter (call on successful unlock). */
export function clearUnlockFailures(actorId: string): void {
  localStorage.removeItem(failuresKey(actorId));
}

/**
 * One-time migration: if a legacy (non-namespaced) wallet exists on this
 * device AND the given actor doesn't already have a per-actor blob, copy
 * the legacy blob into the actor's slot and delete the legacy entries.
 *
 * Ordering matters for crash-safety:
 *   1. Read legacy
 *   2. Write to new slot
 *   3. Verify the new slot reads back the same value
 *   4. Delete the legacy slot
 *
 * If the tab is killed between (3) and (4) the device ends up with both
 * keys present — the next mount picks the per-actor key (correct) and
 * the migration re-runs, deleting the legacy on retry. Never ends up with
 * neither key present, so funds are never orphaned.
 *
 * Returns whether a migration was performed (useful for telemetry / tests).
 */
export function migrateLegacyWallet(actorId: string): boolean {
  const legacyWallet = localStorage.getItem(LEGACY_STORAGE_KEY);
  const legacySession = localStorage.getItem(LEGACY_SESSION_KEY);

  // Nothing to migrate.
  if (!legacyWallet && !legacySession) return false;

  // Don't clobber an existing per-actor wallet — that's almost certainly
  // the correct one for this user. Just delete the legacy leftovers so
  // a stray prompt can't fire for a future user on this device.
  const newSlotKey = storageKey(actorId);
  const newSlotSession = sessionKey(actorId);
  const alreadyMigrated = localStorage.getItem(newSlotKey) !== null;

  if (alreadyMigrated) {
    if (legacyWallet) localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (legacySession) localStorage.removeItem(LEGACY_SESSION_KEY);
    return false;
  }

  if (legacyWallet) {
    localStorage.setItem(newSlotKey, legacyWallet);
    // Verify the copy landed before deleting the source.
    if (localStorage.getItem(newSlotKey) === legacyWallet) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      // Storage anomaly (quota? eviction?). Leave legacy intact so the
      // user can still unlock; we'll retry on next mount.
      return false;
    }
  }

  if (legacySession) {
    localStorage.setItem(newSlotSession, legacySession);
    if (localStorage.getItem(newSlotSession) === legacySession) {
      localStorage.removeItem(LEGACY_SESSION_KEY);
    }
  }

  return true;
}

// ---- Internal helpers: Web Crypto (preferred) ----

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSecretKey(
  secretKey: Uint8Array,
  password: string,
  publicKey: string,
  unlockHelper?: string | null,
): Promise<EncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Current blob version dictates whether a helper is required. If the
  // caller didn't supply one, throw — we never silently downgrade.
  if (currentVersionRequiresHelper() && !unlockHelper) {
    throw new Error('Wallet unlock helper is required but was not provided');
  }
  const effectiveSecret = passwordWithHelper(password, unlockHelper);

  requireSubtleCrypto();
  const key = await deriveKey(effectiveSecret, salt, iterationsForVersion(CURRENT_BLOB_VERSION));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    secretKey as BufferSource
  );
  const ciphertext = new Uint8Array(encrypted);

  return {
    encryptedKey: btoa(String.fromCharCode(...ciphertext)),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
    publicKey,
    version: CURRENT_BLOB_VERSION,
  };
}

// Insecure-origin XOR fallback helpers were removed; see requireSubtleCrypto().
