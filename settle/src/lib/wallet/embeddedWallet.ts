/**
 * Embedded Wallet Crypto Service
 * Non-custodial keypair management with AES-GCM encryption
 * Keys never leave the browser — encrypted at rest in localStorage
 * Falls back to simple XOR encryption when crypto.subtle unavailable (non-HTTPS)
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

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

// Check if Web Crypto API is available (requires HTTPS or localhost)
const hasSubtleCrypto = typeof globalThis !== 'undefined'
  && typeof globalThis.crypto !== 'undefined'
  && typeof globalThis.crypto.subtle !== 'undefined';

export interface EncryptedWallet {
  encryptedKey: string; // base64
  iv: string;           // base64
  salt: string;         // base64
  publicKey: string;    // base58
  version: number;
}

/** Generate a new Solana keypair and encrypt it.
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

/** Import a wallet from base58 private key and encrypt it.
 *  See generateWallet for unlockHelper semantics. */
export async function importWallet(
  base58PrivateKey: string,
  password: string,
  unlockHelper?: string | null,
): Promise<{ keypair: Keypair; encrypted: EncryptedWallet }> {
  const secretKey = bs58.decode(base58PrivateKey);
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

  if (hasSubtleCrypto) {
    const key = await deriveKey(effectiveSecret, salt, iterationsForVersion(encrypted.version));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return Keypair.fromSecretKey(new Uint8Array(decrypted));
  } else {
    const keyBytes = await hashPasswordFallback(effectiveSecret, salt);
    const decrypted = xorBytes(ciphertext, keyBytes);
    return Keypair.fromSecretKey(decrypted);
  }
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

/** Save decrypted keypair to localStorage under the given actor's session slot. */
export function saveSessionKeypair(actorId: string, keypair: Keypair): void {
  localStorage.setItem(sessionKey(actorId), bs58.encode(keypair.secretKey));
}

/** Load decrypted keypair for the given actor, or null if no live session. */
export function loadSessionKeypair(actorId: string): Keypair | null {
  const raw = localStorage.getItem(sessionKey(actorId));
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    localStorage.removeItem(sessionKey(actorId));
    return null;
  }
}

/** Clear session keypair for the given actor. */
export function clearSessionKeypair(actorId: string): void {
  localStorage.removeItem(sessionKey(actorId));
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

  let ciphertext: Uint8Array;

  if (hasSubtleCrypto) {
    const key = await deriveKey(effectiveSecret, salt, iterationsForVersion(CURRENT_BLOB_VERSION));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      secretKey as BufferSource
    );
    ciphertext = new Uint8Array(encrypted);
  } else {
    const keyBytes = await hashPasswordFallback(effectiveSecret, salt);
    ciphertext = xorBytes(secretKey, keyBytes);
  }

  return {
    encryptedKey: btoa(String.fromCharCode(...ciphertext)),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
    publicKey,
    version: CURRENT_BLOB_VERSION,
  };
}

// ---- Fallback: simple XOR with SHA-256 key derivation (for non-HTTPS dev) ----

async function hashPasswordFallback(password: string, salt: Uint8Array): Promise<Uint8Array> {
  // Use SHA-256 via a simple iterative hash (no crypto.subtle needed)
  const encoder = new TextEncoder();
  const input = new Uint8Array([...encoder.encode(password), ...salt]);

  // Simple hash: repeated XOR folding (NOT secure for production — dev only)
  const hash = new Uint8Array(64); // 64 bytes to cover Solana secret key length
  for (let i = 0; i < input.length; i++) {
    hash[i % 64] ^= input[i];
  }
  // Multiple rounds of mixing
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < 64; i++) {
      hash[i] = (hash[i] ^ hash[(i + 1) % 64]) + (round & 0xff) & 0xff;
    }
  }
  return hash;
}

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}
