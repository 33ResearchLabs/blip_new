/**
 * Session Token — signed HMAC-based tokens for actor identity.
 *
 * Token types:
 *   - Access token v2 (15 min): access:actorType:actorId:sessionId:ts:sig (6 parts, with session tracking)
 *   - Access token v1 (15 min): access:actorType:actorId:ts:sig (5 parts, legacy — still accepted)
 *   - Refresh token (7 days): httpOnly cookie, DB-backed
 *   - Legacy token (7 days): actorType:actorId:ts:sig (4 parts — deprecated)
 */

import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_SECRET = process.env.ADMIN_SECRET || process.env.SESSION_TOKEN_SECRET;
if (!TOKEN_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: Set ADMIN_SECRET or SESSION_TOKEN_SECRET — token signing disabled without it');
}
const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
const LEGACY_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days (backward compat)

export interface TokenPayload {
  actorId: string;
  actorType: 'user' | 'merchant' | 'compliance';
  sessionId?: string; // Present in v2 tokens, absent in v1/legacy
}

// ── Access Token (short-lived, sent in Authorization header) ──────────

/**
 * Generate a short-lived access token (15 minutes).
 * If sessionId is provided, generates v2 format (6 parts) with session tracking.
 * Otherwise generates v1 format (5 parts) for backward compatibility.
 */
export function generateAccessToken(payload: TokenPayload): string | null {
  if (!TOKEN_SECRET) return null;

  const ts = Math.floor(Date.now() / 1000);

  // v2 format with sessionId: access:actorType:actorId:sessionId:ts:sig
  if (payload.sessionId) {
    const data = `access:${payload.actorType}:${payload.actorId}:${payload.sessionId}:${ts}`;
    const sig = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    return Buffer.from(`${data}:${sig}`).toString('base64');
  }

  // v1 format without sessionId: access:actorType:actorId:ts:sig
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

    // v2 format: access:actorType:actorId:sessionId:ts:sig (6 parts)
    if (parts.length === 6) {
      const [kind] = parts;
      if (kind === 'access') return verifyTokenInternal(token, 'access-v2', ACCESS_TOKEN_MAX_AGE);
      return null;
    }

    // v1 format: kind:actorType:actorId:ts:sig (5 parts)
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
  expectedKind: 'access' | 'access-v2' | 'refresh' | 'legacy',
  maxAge: number
): TokenPayload | null {
  if (!TOKEN_SECRET || !token) return null;

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');

    let actorType: string, actorId: string, tsStr: string, sig: string, signedData: string;
    let sessionId: string | undefined;

    if (expectedKind === 'legacy') {
      // Legacy: actorType:actorId:ts:sig (4 parts)
      if (parts.length !== 4) return null;
      [actorType, actorId, tsStr, sig] = parts;
      signedData = `${actorType}:${actorId}:${tsStr}`;
    } else if (expectedKind === 'access-v2') {
      // v2: access:actorType:actorId:sessionId:ts:sig (6 parts)
      if (parts.length !== 6) return null;
      const kind = parts[0];
      if (kind !== 'access') return null;
      [, actorType, actorId, sessionId, tsStr, sig] = parts;
      signedData = `access:${actorType}:${actorId}:${sessionId}:${tsStr}`;
    } else {
      // v1: kind:actorType:actorId:ts:sig (5 parts)
      if (parts.length !== 5) return null;
      const kind = parts[0];
      if (kind !== expectedKind && kind !== 'access' && kind !== 'refresh') return null;
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
      ...(sessionId && { sessionId }),
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
 * Returns the sessionId so callers can embed it in access tokens.
 * Falls back to stateless cookie if DB session creation fails (zero regression).
 */
export async function setSessionOnResponse(
  response: import('next/server').NextResponse,
  payload: TokenPayload,
  request?: any
): Promise<string | null> {
  try {
    const { createSession } = await import('./sessions');
    const session = await createSession(payload, request);
    if (session) {
      response.cookies.set(REFRESH_TOKEN_COOKIE, session.refreshToken, REFRESH_COOKIE_OPTIONS);
      return session.sessionId;
    }
  } catch {
    // DB not ready or sessions table doesn't exist — fall back to stateless
  }
  // Fallback: stateless refresh token (no DB tracking)
  const refreshToken = generateRefreshToken(payload);
  if (refreshToken) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
  }
  return null;
}
