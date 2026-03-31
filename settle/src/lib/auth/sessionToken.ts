/**
 * Session Token — signed HMAC-based stateless tokens for actor identity.
 *
 * Token types:
 *   - Access token (15 min): sent as Authorization: Bearer <token>
 *   - Refresh token (7 days): set as httpOnly cookie
 *   - Legacy token (7 days, no kind): still accepted for backward compatibility
 *
 * Access token format:  base64( access:actorType:actorId:issuedAt:hmacSignature )
 * Refresh token format: base64( refresh:actorType:actorId:issuedAt:hmacSignature )
 * Legacy token format:  base64( actorType:actorId:issuedAt:hmacSignature )
 */

import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_SECRET = process.env.ADMIN_SECRET || process.env.SESSION_TOKEN_SECRET || '';
const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
const LEGACY_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days (backward compat)

export interface TokenPayload {
  actorId: string;
  actorType: 'user' | 'merchant' | 'compliance';
}

// ── Access Token (short-lived, sent in Authorization header) ──────────

/**
 * Generate a short-lived access token (15 minutes).
 * This is the primary auth token sent with every request.
 */
export function generateAccessToken(payload: TokenPayload): string | null {
  if (!TOKEN_SECRET) return null;

  const ts = Math.floor(Date.now() / 1000);
  const data = `access:${payload.actorType}:${payload.actorId}:${ts}`;
  const sig = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
  return Buffer.from(`${data}:${sig}`).toString('base64');
}

/**
 * Verify an access token. Returns null if invalid or expired.
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  return verifyTokenInternal(token, 'access', ACCESS_TOKEN_MAX_AGE);
}

// ── Refresh Token (long-lived, httpOnly cookie) ──────────────────────

/**
 * Generate a long-lived refresh token (7 days).
 * Stored as httpOnly cookie — never exposed to JavaScript.
 */
export function generateRefreshToken(payload: TokenPayload): string | null {
  if (!TOKEN_SECRET) return null;

  const ts = Math.floor(Date.now() / 1000);
  const data = `refresh:${payload.actorType}:${payload.actorId}:${ts}`;
  const sig = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
  return Buffer.from(`${data}:${sig}`).toString('base64');
}

/**
 * Verify a refresh token. Returns null if invalid or expired.
 */
export function verifyRefreshToken(token: string): TokenPayload | null {
  return verifyTokenInternal(token, 'refresh', REFRESH_TOKEN_MAX_AGE);
}

// ── Legacy compatibility ─────────────────────────────────────────────

/**
 * Generate a session token using the legacy format (7-day, no kind prefix).
 * Used by existing login endpoints — callers will be migrated to generateAccessToken.
 *
 * @deprecated Use generateAccessToken() for new code
 */
export function generateSessionToken(payload: TokenPayload): string | null {
  if (!TOKEN_SECRET) return null;

  const ts = Math.floor(Date.now() / 1000);
  const data = `${payload.actorType}:${payload.actorId}:${ts}`;
  const sig = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
  return Buffer.from(`${data}:${sig}`).toString('base64');
}

/**
 * Verify a session token — accepts ALL formats:
 *   1. New access tokens (access:type:id:ts:sig)
 *   2. New refresh tokens (refresh:type:id:ts:sig) — rejected here, use verifyRefreshToken
 *   3. Legacy tokens (type:id:ts:sig) — accepted for backward compatibility
 *
 * This is called by the auth middleware for Bearer tokens.
 */
export function verifySessionToken(token: string): TokenPayload | null {
  if (!TOKEN_SECRET || !token) return null;

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');

    // New format: kind:actorType:actorId:ts:sig (5 parts)
    if (parts.length === 5) {
      const [kind] = parts;
      if (kind === 'access') return verifyTokenInternal(token, 'access', ACCESS_TOKEN_MAX_AGE);
      if (kind === 'refresh') return null; // Refresh tokens must NOT be used as access tokens
      return null;
    }

    // Legacy format: actorType:actorId:ts:sig (4 parts)
    if (parts.length === 4) {
      return verifyTokenInternal(token, 'legacy', LEGACY_TOKEN_MAX_AGE);
    }

    return null;
  } catch {
    return null;
  }
}

// ── Internal verification ────────────────────────────────────────────

function verifyTokenInternal(
  token: string,
  expectedKind: 'access' | 'refresh' | 'legacy',
  maxAge: number
): TokenPayload | null {
  if (!TOKEN_SECRET || !token) return null;

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');

    let actorType: string, actorId: string, tsStr: string, sig: string, signedData: string;

    if (expectedKind === 'legacy') {
      // Legacy: actorType:actorId:ts:sig
      if (parts.length !== 4) return null;
      [actorType, actorId, tsStr, sig] = parts;
      signedData = `${actorType}:${actorId}:${tsStr}`;
    } else {
      // New: kind:actorType:actorId:ts:sig
      if (parts.length !== 5) return null;
      const kind = parts[0];
      if (kind !== expectedKind) return null;
      [, actorType, actorId, tsStr, sig] = parts;
      signedData = `${kind}:${actorType}:${actorId}:${tsStr}`;
    }

    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return null;

    // Check expiry
    const age = Math.floor(Date.now() / 1000) - ts;
    if (age > maxAge || age < 0) return null;

    // Validate actorType
    if (!['user', 'merchant', 'compliance'].includes(actorType)) return null;

    // Verify signature
    const expected = createHmac('sha256', TOKEN_SECRET).update(signedData).digest('hex');
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;

    return {
      actorId,
      actorType: actorType as TokenPayload['actorType'],
    };
  } catch {
    return null;
  }
}

// ── Cookie helpers ───────────────────────────────────────────────────

/** Cookie name for refresh token */
export const REFRESH_TOKEN_COOKIE = 'blip_refresh_token';

/** Cookie options for refresh token */
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_MAX_AGE,
};

/**
 * Helper for login endpoints: create DB session + set cookie on response.
 * Falls back to stateless cookie if DB session creation fails (zero regression).
 */
export async function setSessionOnResponse(
  response: import('next/server').NextResponse,
  payload: TokenPayload,
  request?: any
): Promise<void> {
  try {
    const { createSession } = await import('./sessions');
    const session = await createSession(payload, request);
    if (session) {
      response.cookies.set(REFRESH_TOKEN_COOKIE, session.refreshToken, REFRESH_COOKIE_OPTIONS);
      return;
    }
  } catch {
    // DB not ready or sessions table doesn't exist — fall back to stateless
  }
  // Fallback: stateless refresh token (no DB tracking)
  const refreshToken = generateRefreshToken(payload);
  if (refreshToken) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
  }
}
