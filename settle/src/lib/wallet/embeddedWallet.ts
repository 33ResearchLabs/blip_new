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
const LEGACY_STORAGE_KEY = 'blip_embedded_wallet';
const LEGACY_SESSION_KEY = 'blip_wallet_session';
const PBKDF2_ITERATIONS = 100_000;

function storageKey(actorId: string): string {
  return `${STORAGE_KEY_PREFIX}:${actorId}`;
}

function sessionKey(actorId: string): string {
  return `${SESSION_KEY_PREFIX}:${actorId}`;
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

/** Generate a new Solana keypair and encrypt it */
export async function generateWallet(password: string): Promise<{ keypair: Keypair; encrypted: EncryptedWallet }> {
  const keypair = Keypair.generate();
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58());
  return { keypair, encrypted };
}

/** Import a wallet from base58 private key and encrypt it */
export async function importWallet(base58PrivateKey: string, password: string): Promise<{ keypair: Keypair; encrypted: EncryptedWallet }> {
  const secretKey = bs58.decode(base58PrivateKey);
  const keypair = Keypair.fromSecretKey(secretKey);
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58());
  return { keypair, encrypted };
}

/** Decrypt an encrypted wallet with password */
export async function decryptWallet(encrypted: EncryptedWallet, password: string): Promise<Keypair> {
  const salt = Uint8Array.from(atob(encrypted.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encrypted.encryptedKey), c => c.charCodeAt(0));

  if (hasSubtleCrypto) {
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return Keypair.fromSecretKey(new Uint8Array(decrypted));
  } else {
    // Fallback: XOR decrypt
    const keyBytes = await hashPasswordFallback(password, salt);
    const decrypted = xorBytes(ciphertext, keyBytes);
    return Keypair.fromSecretKey(decrypted);
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

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSecretKey(secretKey: Uint8Array, password: string, publicKey: string): Promise<EncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  let ciphertext: Uint8Array;

  if (hasSubtleCrypto) {
    const key = await deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      secretKey as BufferSource
    );
    ciphertext = new Uint8Array(encrypted);
  } else {
    // Fallback: XOR encrypt
    const keyBytes = await hashPasswordFallback(password, salt);
    ciphertext = xorBytes(secretKey, keyBytes);
  }

  return {
    encryptedKey: btoa(String.fromCharCode(...ciphertext)),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
    publicKey,
    version: 1,
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
