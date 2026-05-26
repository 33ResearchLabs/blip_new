/**
 * Verify a Google Identity Services (GIS) ID token (a JWT) without pulling
 * in the google-auth-library dep. We only need a single function for a
 * single provider, so this is implemented against Node crypto + fetch.
 *
 * Used by /api/auth/google. The token comes from the GIS One Tap button
 * via window.google.accounts.id.callback (see GoogleSignInButton.tsx).
 *
 * What this validates:
 *   - JWT structure (header.payload.signature, all base64url)
 *   - alg === "RS256" (the algorithm Google currently uses)
 *   - RSA signature against the matching JWK from Google's public key set
 *   - iss in {"accounts.google.com", "https://accounts.google.com"}
 *   - aud === GOOGLE_CLIENT_ID (or NEXT_PUBLIC_GOOGLE_CLIENT_ID as fallback)
 *   - exp > now (with 60s skew)
 *   - email_verified === true (Google marks unverified emails — we refuse
 *     those because the whole point of OAuth signup is the verified email)
 *
 * Returns the verified identity, or null if anything fails. Errors are
 * logged but never thrown into the request handler — callers translate a
 * null return into a generic 401.
 */

import { createPublicKey, createVerify } from 'crypto';
import type { JsonWebKey } from 'crypto';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ALLOWED_ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;

interface JWK {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface GoogleIdTokenPayload {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

let jwksCache: { fetchedAt: number; keys: JWK[] } | null = null;

async function fetchJwks(force = false): Promise<JWK[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(GOOGLE_JWKS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch Google JWKS: ${res.status}`);
  const data = (await res.json()) as { keys: JWK[] };
  jwksCache = { fetchedAt: Date.now(), keys: data.keys };
  return data.keys;
}

async function findKey(kid: string): Promise<JWK | null> {
  let keys = await fetchJwks(false);
  let key = keys.find((k) => k.kid === kid) ?? null;
  if (!key) {
    keys = await fetchJwks(true);
    key = keys.find((k) => k.kid === kid) ?? null;
  }
  return key;
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(normalized, 'base64');
}

function jwkToPem(jwk: JWK): string {
  // Node's createPublicKey accepts a JWK directly; export as PEM for createVerify.
  const keyObject = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
  return keyObject.export({ type: 'spki', format: 'pem' }) as string;
}

function expectedAudience(): string | null {
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    null
  );
}

export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity | null> {
  const aud = expectedAudience();
  if (!aud) {
    console.error('[google-oauth] GOOGLE_CLIENT_ID is not configured');
    return null;
  }

  if (typeof credential !== 'string' || credential.length < 20) {
    return null;
  }

  const parts = credential.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: JwtHeader;
  let payload: GoogleIdTokenPayload;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const key = await findKey(header.kid).catch((err) => {
    console.error('[google-oauth] JWKS lookup failed:', err);
    return null;
  });
  if (!key) return null;

  const pem = jwkToPem(key);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = b64urlDecode(signatureB64);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  const valid = verifier.verify(pem, signature);
  if (!valid) return null;

  if (!payload.iss || !ALLOWED_ISS.has(payload.iss)) return null;
  if (payload.aud !== aud) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp + CLOCK_SKEW_SECONDS < now) return null;
  if (!payload.sub || !payload.email) return null;
  if (payload.email_verified !== true) return null;

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
}
