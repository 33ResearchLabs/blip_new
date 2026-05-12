/**
 * App-Level Security Lock — 4-digit PIN.
 *
 * Scope: this PIN controls ONLY app entry / re-auth after lock. It is
 * fully independent of:
 *   - the user/merchant auth token system
 *   - the wallet password / encrypted keypair blob
 *   - the merchant/user isolation rules
 *
 * Storage model:
 *   - Verifier only (never the PIN itself): PBKDF2-SHA256(pin, salt,
 *     200k) → 32-byte hash. Keyed by userId so multiple accounts on a
 *     shared device do not share lock state.
 *   - Per-user namespace `blip_app_pin_v1:{userId}`.
 *   - Fallback path: when crypto.subtle is unavailable (plain-HTTP LAN
 *     dev), a deterministic iterated XOR-fold hash. Verifier records
 *     which version it was computed under so verify uses the matching
 *     function. Same pattern the wallet uses (embeddedWallet.ts).
 *
 * Failure handling:
 *   - 5 wrong attempts → temporary cooldown (escalating timeout).
 *   - 10 wrong attempts → verifier wiped; user re-sets after a fresh
 *     full login. PIN is a SOFT factor — wiping it never costs the
 *     user funds (wallet untouched).
 *
 * SSR-safe: every export branches on `typeof window`.
 */

const STORAGE_PREFIX = 'blip_app_pin_v1';
const VERIFIER_VERSION_SUBTLE = 1;
const VERIFIER_VERSION_FALLBACK = 2;
const PBKDF2_ITERATIONS = 200_000;
const FALLBACK_ROUNDS = 5_000;
const HASH_LEN_BYTES = 32;
const SALT_LEN_BYTES = 16;
export const APP_PIN_LENGTH = 4;

// Soft + hard attempt thresholds. Soft triggers an escalating cooldown;
// hard wipes the verifier. Both apply per-user.
export const SOFT_COOLDOWN_AFTER = 5;
export const MAX_PIN_FAILURES = 10;

// Cooldown ladder (seconds) keyed off the failure count, used by the
// UI to compute "try again in N seconds". 5..9 mapped here; 10 wipes.
const COOLDOWN_LADDER_SECONDS: Record<number, number> = {
  5: 30,
  6: 60,
  7: 120,
  8: 300,
  9: 600,
};

// Web Crypto requires a secure context. crypto.subtle is undefined on
// plain-HTTP LAN IPs. Probe once at load and branch every hash call.
const hasSubtleCrypto: boolean = typeof globalThis !== 'undefined'
  && typeof globalThis.crypto !== 'undefined'
  && typeof globalThis.crypto.subtle !== 'undefined';

interface AppPinVerifier {
  version: number;
  userId: string;
  salt: string;
  hash: string;
  iterations: number;
  createdAt: number;
}

interface FailureState {
  count: number;
  lastFailureAt: number;
}

function verifierKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function failuresKey(userId: string): string {
  return `${STORAGE_PREFIX}:failures:${userId}`;
}

function unlockedFlagKey(userId: string): string {
  return `${STORAGE_PREFIX}:unlocked:${userId}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

// ---- encoding helpers ----

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---- shape + strength ----

export function isValidAppPinShape(pin: string): boolean {
  if (typeof pin !== 'string') return false;
  if (pin.length !== APP_PIN_LENGTH) return false;
  for (let i = 0; i < pin.length; i++) {
    const c = pin.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// Reject obviously weak 4-digit PINs. The list is explicit and short
// (top-N most common): any digit-repeat (0000, 1111, ..., 9999), any
// strict ascending/descending run (1234, 4321, 0123, etc.), and a
// handful of well-known weak codes (1212, 2580, 1004 etc. are skipped
// for now — adding them is one-line if needed). Returns null when ok,
// otherwise a human-readable reason.
export function validateAppPinStrength(pin: string): string | null {
  if (!isValidAppPinShape(pin)) return 'PIN must be 4 digits';
  // All same digit: 0000, 1111, ..., 9999
  if (/^(\d)\1{3}$/.test(pin)) return 'Avoid repeated digits like 1111 or 0000';
  // Strict ascending / descending sequences
  const digits = pin.split('').map(Number);
  const asc = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const desc = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (asc || desc) return 'Avoid sequential digits like 1234 or 4321';
  return null;
}

// ---- hashing ----

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    HASH_LEN_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function fallbackHash(pin: string, salt: Uint8Array, rounds: number): Uint8Array {
  const enc = new TextEncoder();
  const pinBytes = enc.encode(pin);
  const input = new Uint8Array(pinBytes.length + salt.length);
  input.set(pinBytes, 0);
  input.set(salt, pinBytes.length);
  const hash = new Uint8Array(HASH_LEN_BYTES);
  for (let i = 0; i < input.length; i++) hash[i % HASH_LEN_BYTES] ^= input[i];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < HASH_LEN_BYTES; i++) {
      hash[i] = (hash[i] ^ hash[(i + 1) % HASH_LEN_BYTES]) + (r & 0xff) & 0xff;
    }
  }
  return hash;
}

async function hashPin(pin: string, salt: Uint8Array, version: number, iterations: number): Promise<Uint8Array> {
  if (version === VERIFIER_VERSION_FALLBACK) return fallbackHash(pin, salt, iterations);
  return pbkdf2(pin, salt, iterations);
}

// ---- storage ----

export function hasAppPin(userId: string | null | undefined): boolean {
  if (!isBrowser() || !userId) return false;
  try {
    return localStorage.getItem(verifierKey(userId)) !== null;
  } catch {
    return false;
  }
}

function loadVerifier(userId: string): AppPinVerifier | null {
  try {
    const raw = localStorage.getItem(verifierKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppPinVerifier;
    if (parsed.version !== VERIFIER_VERSION_SUBTLE && parsed.version !== VERIFIER_VERSION_FALLBACK) return null;
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveVerifier(v: AppPinVerifier): void {
  localStorage.setItem(verifierKey(v.userId), JSON.stringify(v));
}

/** Remove the PIN verifier AND its failure counter. Called from
 *  setup-flow re-set, "Remove PIN" in settings, and on logout. */
export function clearAppPin(userId: string | null | undefined): void {
  if (!isBrowser() || !userId) return;
  try {
    localStorage.removeItem(verifierKey(userId));
    localStorage.removeItem(failuresKey(userId));
    localStorage.removeItem(unlockedFlagKey(userId));
  } catch {
    // ignore
  }
}

function loadFailures(userId: string): FailureState {
  try {
    const raw = localStorage.getItem(failuresKey(userId));
    if (!raw) return { count: 0, lastFailureAt: 0 };
    return JSON.parse(raw) as FailureState;
  } catch {
    return { count: 0, lastFailureAt: 0 };
  }
}

function saveFailures(userId: string, state: FailureState): void {
  try {
    localStorage.setItem(failuresKey(userId), JSON.stringify(state));
  } catch {
    // ignore
  }
}

function clearFailures(userId: string): void {
  try {
    localStorage.removeItem(failuresKey(userId));
  } catch {
    // ignore
  }
}

/** Seconds remaining in the current cooldown window, or 0 if the user
 *  may attempt right now. Computed on read so re-renders pick up the
 *  countdown without explicit tickers. */
export function cooldownSecondsRemaining(userId: string | null | undefined): number {
  if (!isBrowser() || !userId) return 0;
  const f = loadFailures(userId);
  const window = COOLDOWN_LADDER_SECONDS[f.count];
  if (!window) return 0;
  const elapsed = Math.floor((Date.now() - f.lastFailureAt) / 1000);
  return Math.max(0, window - elapsed);
}

export function appPinFailureCount(userId: string | null | undefined): number {
  if (!isBrowser() || !userId) return 0;
  return loadFailures(userId).count;
}

// ---- set / verify / change ----

export interface SetAppPinResult {
  ok: boolean;
  reason?: 'invalid-shape' | 'weak' | 'failed';
  message?: string;
}

/** Set or replace the App PIN. Caller must hold an authenticated
 *  session — there is no other gate here (e.g. signup flow → set, or
 *  Settings → re-auth → change). */
export async function setAppPin(userId: string, pin: string): Promise<SetAppPinResult> {
  if (!isBrowser() || !userId) return { ok: false, reason: 'failed' };
  if (!isValidAppPinShape(pin)) return { ok: false, reason: 'invalid-shape' };
  const weak = validateAppPinStrength(pin);
  if (weak) return { ok: false, reason: 'weak', message: weak };

  const salt = randomBytes(SALT_LEN_BYTES);
  const version = hasSubtleCrypto ? VERIFIER_VERSION_SUBTLE : VERIFIER_VERSION_FALLBACK;
  const iterations = hasSubtleCrypto ? PBKDF2_ITERATIONS : FALLBACK_ROUNDS;
  const hash = await hashPin(pin, salt, version, iterations);
  saveVerifier({
    version,
    userId,
    salt: b64encode(salt),
    hash: b64encode(hash),
    iterations,
    createdAt: Date.now(),
  });
  clearFailures(userId);
  return { ok: true };
}

export interface VerifyAppPinResult {
  ok: boolean;
  failures: number;
  cooldownSeconds: number;
  wiped: boolean;
  reason?: 'not-set' | 'wrong' | 'cooldown' | 'wiped' | 'failed';
}

/** Verify a PIN attempt. Applies the cooldown ladder and the hard wipe
 *  at MAX_PIN_FAILURES. On success the failure counter is cleared. */
export async function verifyAppPin(userId: string, pin: string): Promise<VerifyAppPinResult> {
  if (!isBrowser() || !userId) {
    return { ok: false, failures: 0, cooldownSeconds: 0, wiped: false, reason: 'failed' };
  }
  const cooldown = cooldownSecondsRemaining(userId);
  if (cooldown > 0) {
    return { ok: false, failures: loadFailures(userId).count, cooldownSeconds: cooldown, wiped: false, reason: 'cooldown' };
  }
  const v = loadVerifier(userId);
  if (!v) {
    return { ok: false, failures: 0, cooldownSeconds: 0, wiped: false, reason: 'not-set' };
  }

  if (!isValidAppPinShape(pin)) {
    return recordFailureAndReport(userId, 'wrong');
  }

  const salt = b64decode(v.salt);
  const expected = b64decode(v.hash);
  const candidate = await hashPin(pin, salt, v.version, v.iterations);
  if (constantTimeEqual(candidate, expected)) {
    clearFailures(userId);
    return { ok: true, failures: 0, cooldownSeconds: 0, wiped: false };
  }
  return recordFailureAndReport(userId, 'wrong');
}

function recordFailureAndReport(userId: string, reason: VerifyAppPinResult['reason']): VerifyAppPinResult {
  const prev = loadFailures(userId);
  const next: FailureState = { count: prev.count + 1, lastFailureAt: Date.now() };
  saveFailures(userId, next);
  if (next.count >= MAX_PIN_FAILURES) {
    clearAppPin(userId);
    return { ok: false, failures: next.count, cooldownSeconds: 0, wiped: true, reason: 'wiped' };
  }
  const cooldown = COOLDOWN_LADDER_SECONDS[next.count] ?? 0;
  return {
    ok: false,
    failures: next.count,
    cooldownSeconds: cooldown,
    wiped: false,
    reason: cooldown > 0 ? 'cooldown' : reason,
  };
}

/** Change PIN — requires the current PIN. Same cooldown/wipe policy as
 *  verifyAppPin. */
export async function changeAppPin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<SetAppPinResult & { failures?: number; cooldownSeconds?: number; wiped?: boolean }> {
  if (!isBrowser() || !userId) return { ok: false, reason: 'failed' };
  const verification = await verifyAppPin(userId, currentPin);
  if (!verification.ok) {
    return {
      ok: false,
      reason: 'failed',
      message: verification.wiped
        ? 'Too many wrong tries — PIN cleared. Log in again to set a new one.'
        : verification.cooldownSeconds > 0
          ? `Too many wrong tries. Try again in ${verification.cooldownSeconds}s.`
          : 'Wrong current PIN',
      failures: verification.failures,
      cooldownSeconds: verification.cooldownSeconds,
      wiped: verification.wiped,
    };
  }
  return setAppPin(userId, newPin);
}

// ---- session unlock flag ----

/** Mark the current PIN-bound session as unlocked. The flag is a
 *  sessionStorage entry so it does NOT survive tab close / app restart
 *  / explicit logout — every restart re-locks the app. */
export function markSessionUnlocked(userId: string): void {
  if (!isBrowser() || !userId) return;
  try {
    sessionStorage.setItem(unlockedFlagKey(userId), '1');
  } catch {
    // ignore
  }
}

export function isSessionUnlocked(userId: string | null | undefined): boolean {
  if (!isBrowser() || !userId) return false;
  try {
    return sessionStorage.getItem(unlockedFlagKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function clearSessionUnlock(userId: string | null | undefined): void {
  if (!isBrowser() || !userId) return;
  try {
    sessionStorage.removeItem(unlockedFlagKey(userId));
  } catch {
    // ignore
  }
}
