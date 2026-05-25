/**
 * Biometric layer for the App-Lock PIN.
 *
 * Web platform → WebAuthn is the only secure biometric API. The OS
 * provides the actual biometric/passcode prompt and stores the
 * credential inside iOS Keychain / Android Keystore / Windows TPM —
 * matching the spec's requirement of native secure-element storage
 * without us touching device-specific code from the browser.
 *
 * Trust shape: the App PIN plaintext is wrapped with an AES-GCM key
 * derived (HKDF) from the WebAuthn PRF extension output. Without a
 * successful biometric assertion the ciphertext is unrecoverable, even
 * if the device's localStorage is exfiltrated.
 *
 * Per-user namespacing keeps multi-account devices isolated. PRF is
 * required — without it we refuse to enroll rather than fall back to a
 * weaker key derivation. Devices that lack PRF stay on PIN-only.
 */

const STORAGE_PREFIX = 'blip_app_biometric_v1';
const TRUST_VERSION = 1;
const RP_NAME = 'Blip Market';
const PRF_INFO = 'blip:app-lock:pin:v1';

export const MAX_BIOMETRIC_FAILURES = 3;

interface TrustRecord {
  version: number;
  userId: string;
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

function trustKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}
function failuresKey(userId: string): string {
  return `${STORAGE_PREFIX}:failures:${userId}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined';
}

function rpId(): string {
  return isBrowser() ? window.location.hostname : '';
}

function hasWebAuthn(): boolean {
  return isBrowser()
    && typeof PublicKeyCredential !== 'undefined'
    && typeof navigator.credentials !== 'undefined'
    && typeof navigator.credentials.create === 'function'
    && typeof navigator.credentials.get === 'function'
    // WebAuthn + Web Crypto share the secure-context gate. On plain
    // HTTP LAN, navigator.credentials exists but throws SecurityError;
    // crypto.subtle is also undefined. Check both up-front.
    && typeof globalThis.crypto !== 'undefined'
    && typeof globalThis.crypto.subtle !== 'undefined';
}

let _platformAvailable: boolean | null = null;
export async function isBiometricSupported(): Promise<boolean> {
  if (!hasWebAuthn()) return false;
  if (_platformAvailable !== null) return _platformAvailable;
  try {
    const fn = (PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable;
    _platformAvailable = typeof fn === 'function' ? !!(await fn.call(PublicKeyCredential)) : false;
  } catch {
    _platformAvailable = false;
  }
  return _platformAvailable;
}

export function hasBiometricEnrolled(userId: string | null | undefined): boolean {
  if (!isBrowser() || !userId) return false;
  try {
    return localStorage.getItem(trustKey(userId)) !== null;
  } catch {
    return false;
  }
}

function loadTrust(userId: string): TrustRecord | null {
  try {
    const raw = localStorage.getItem(trustKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrustRecord;
    if (parsed.version !== TRUST_VERSION || parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTrust(record: TrustRecord): void {
  try {
    localStorage.setItem(trustKey(record.userId), JSON.stringify(record));
  } catch {
    // ignore
  }
}

export function clearBiometricTrust(userId: string | null | undefined): void {
  if (!isBrowser() || !userId) return;
  try {
    localStorage.removeItem(trustKey(userId));
    localStorage.removeItem(failuresKey(userId));
  } catch {
    // ignore
  }
}

function recordFailure(userId: string): number {
  try {
    const n = parseInt(localStorage.getItem(failuresKey(userId)) ?? '0', 10) + 1;
    localStorage.setItem(failuresKey(userId), String(n));
    return n;
  } catch {
    return 0;
  }
}

function clearFailures(userId: string): void {
  try {
    localStorage.removeItem(failuresKey(userId));
  } catch {
    // ignore
  }
}

export function biometricFailureCount(userId: string | null | undefined): number {
  if (!isBrowser() || !userId) return 0;
  try {
    return parseInt(localStorage.getItem(failuresKey(userId)) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

// ---- encoding ----

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
function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return b64decode(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}
function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

async function deriveKeyFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0) as BufferSource,
      info: new TextEncoder().encode(PRF_INFO) as BufferSource,
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface PrfExtensionResult {
  prf?: { results?: { first?: ArrayBuffer } };
}

function readPrf(cred: PublicKeyCredential): ArrayBuffer | null {
  const exts = (cred.getClientExtensionResults?.() ?? {}) as PrfExtensionResult;
  return exts?.prf?.results?.first ?? null;
}

// ---- enroll ----

export interface EnrollBiometricResult {
  ok: boolean;
  reason?: 'unsupported' | 'no-prf' | 'cancelled' | 'failed';
  message?: string;
}

/** Enroll biometric for this user, wrapping the supplied App PIN. The
 *  caller must have just verified the PIN — that's how we know the
 *  plaintext to wrap. PIN never persists in plaintext. */
export async function enrollBiometric(userId: string, pin: string): Promise<EnrollBiometricResult> {
  if (!hasWebAuthn()) return { ok: false, reason: 'unsupported' };
  if (!(await isBiometricSupported())) return { ok: false, reason: 'unsupported' };
  if (!userId || !pin) return { ok: false, reason: 'failed' };

  const userHandle = randomBytes(16);
  const challenge = randomBytes(32);
  const prfSalt = randomBytes(32);

  let cred: PublicKeyCredential;
  try {
    const created = await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId(), name: RP_NAME },
        user: {
          id: userHandle as BufferSource,
          name: `blip-app-${userId.slice(0, 8)}`,
          displayName: 'Blip',
        },
        challenge: challenge as BufferSource,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 60_000,
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        extensions: {
          prf: { eval: { first: prfSalt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
        attestation: 'none',
      },
    }) as PublicKeyCredential | null;
    if (!created) return { ok: false, reason: 'cancelled' };
    cred = created;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', message: (e as Error)?.message };
  }

  // PRF eval at create time is supported by Chrome / Edge; Safari needs
  // a follow-up get() with allowCredentials to actually return it.
  let prfOutput = readPrf(cred);
  if (!prfOutput) {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32) as BufferSource,
          rpId: rpId(),
          timeout: 60_000,
          userVerification: 'required',
          allowCredentials: [{ type: 'public-key', id: cred.rawId }],
          extensions: {
            prf: { eval: { first: prfSalt as BufferSource } },
          } as AuthenticationExtensionsClientInputs,
        },
      }) as PublicKeyCredential | null;
      if (!assertion) return { ok: false, reason: 'cancelled' };
      prfOutput = readPrf(assertion);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'failed', message: (e as Error)?.message };
    }
  }
  if (!prfOutput) return { ok: false, reason: 'no-prf' };

  const key = await deriveKeyFromPrf(prfOutput);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(pin) as BufferSource,
  );

  saveTrust({
    version: TRUST_VERSION,
    userId,
    credentialId: b64urlEncode(cred.rawId),
    prfSalt: b64encode(prfSalt),
    iv: b64encode(iv),
    ciphertext: b64encode(ciphertext),
    createdAt: Date.now(),
  });
  clearFailures(userId);
  return { ok: true };
}

// ---- assert ----

export interface AssertBiometricResult {
  ok: boolean;
  pin?: string;
  reason?: 'not-enrolled' | 'unsupported' | 'cancelled' | 'no-prf' | 'failed';
  message?: string;
}

/** Prompt for biometric and return the wrapped PIN on success. The
 *  caller must verify the returned PIN with `verifyAppPin` — if that
 *  fails, drop the trust (the user changed/cleared their PIN after
 *  enrollment, so the trust is stale). */
export async function assertBiometric(userId: string): Promise<AssertBiometricResult> {
  if (!hasWebAuthn()) return { ok: false, reason: 'unsupported' };
  const trust = loadTrust(userId);
  if (!trust) return { ok: false, reason: 'not-enrolled' };

  const credId = b64urlDecode(trust.credentialId);
  const prfSalt = b64decode(trust.prfSalt);

  let assertion: PublicKeyCredential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        rpId: rpId(),
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
        extensions: {
          prf: { eval: { first: prfSalt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    }) as PublicKeyCredential | null;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      recordFailure(userId);
      return { ok: false, reason: 'cancelled' };
    }
    if (name === 'InvalidStateError' || name === 'NotSupportedError') {
      clearBiometricTrust(userId);
      return { ok: false, reason: 'not-enrolled' };
    }
    recordFailure(userId);
    return { ok: false, reason: 'failed', message: (e as Error)?.message };
  }

  if (!assertion) {
    recordFailure(userId);
    return { ok: false, reason: 'cancelled' };
  }

  const prfOutput = readPrf(assertion);
  if (!prfOutput) {
    clearBiometricTrust(userId);
    return { ok: false, reason: 'no-prf' };
  }

  try {
    const key = await deriveKeyFromPrf(prfOutput);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(trust.iv) as BufferSource },
      key,
      b64decode(trust.ciphertext) as BufferSource,
    );
    clearFailures(userId);
    return { ok: true, pin: new TextDecoder().decode(plain) };
  } catch {
    clearBiometricTrust(userId);
    return { ok: false, reason: 'failed' };
  }
}
