/**
 * JWT Auth Module — HS256, zero external dependencies
 *
 * Issues and verifies JWTs using Node's built-in crypto.
 * Tokens are short-lived (15 minutes) with refresh token support.
 *
 * Token flow:
 *   1. Wallet signs server-issued nonce (from auth_nonces table)
 *   2. Server verifies signature, issues access JWT + refresh token
 *   3. Access JWT is sent as httpOnly cookie + response body
 *   4. requireAuth() middleware verifies JWT on protected routes
 *
 * SAFETY: Feature-flagged behind FEATURES.JWT_AUTH. When disabled,
 * the legacy getAuthContext() body-param trust path is used.
 */

import { createHmac, randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';

// ── Types ─────────────────────────────────────────────────────────

export interface JWTPayload {
  /** Subject — actor ID (user or merchant UUID) */
  sub: string;
  /** Actor type: 'user' | 'merchant' | 'compliance' */
  typ: 'user' | 'merchant' | 'compliance';
  /** Wallet address (for wallet-authed actors) */
  wal?: string;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Expiry (Unix seconds) */
  exp: number;
  /** JWT ID (for revocation) */
  jti: string;
}

export interface AuthClaims {
  actorId: string;
  actorType: 'user' | 'merchant' | 'compliance';
  walletAddress?: string;
  jti: string;
}

// ── Configuration ────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || process.env.CORE_API_SECRET || '';
const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const NONCE_TTL_MIN = 5; // 5-minute nonce window

// ── Base64url helpers (no padding) ───────────────────────────────

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString();
}

// ── JWT Sign / Verify ────────────────────────────────────────────

/**
 * Sign a JWT with HS256.
 * Returns the compact JWT string (header.payload.signature).
 */
export function signJWT(payload: JWTPayload): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }

  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const signature = createHmac('sha256', JWT_SECRET)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64urlEncode(signature)}`;
}

/**
 * Verify and decode a JWT.
 * Returns the payload if valid, or null if invalid/expired.
 */
export function verifyJWT(token: string): JWTPayload | null {
  if (!JWT_SECRET) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const signingInput = `${header}.${body}`;

    // Recompute signature
    const expected = createHmac('sha256', JWT_SECRET)
      .update(signingInput)
      .digest();

    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;

    // Decode payload
    const payload: JWTPayload = JSON.parse(base64urlDecode(body));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract AuthClaims from a verified JWT payload.
 */
export function claimsFromPayload(payload: JWTPayload): AuthClaims {
  return {
    actorId: payload.sub,
    actorType: payload.typ,
    walletAddress: payload.wal,
    jti: payload.jti,
  };
}

// ── Token Issuance ───────────────────────────────────────────────

/**
 * Issue an access token (short-lived JWT).
 */
export function issueAccessToken(params: {
  actorId: string;
  actorType: 'user' | 'merchant' | 'compliance';
  walletAddress?: string;
}): { token: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();

  const payload: JWTPayload = {
    sub: params.actorId,
    typ: params.actorType,
    wal: params.walletAddress,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SEC,
    jti,
  };

  return {
    token: signJWT(payload),
    expiresIn: ACCESS_TOKEN_TTL_SEC,
  };
}

/**
 * Issue a refresh token and persist its hash in the DB.
 * The raw token is returned to the client; we only store the hash.
 */
export async function issueRefreshToken(params: {
  actorId: string;
  actorType: 'user' | 'merchant' | 'compliance';
}): Promise<{ token: string; expiresAt: Date }> {
  const rawToken = randomBytes(48).toString('base64url');
  const tokenHash = createHmac('sha256', JWT_SECRET)
    .update(rawToken)
    .digest('hex');

  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

  await query(
    `INSERT INTO refresh_tokens (actor_id, actor_type, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [params.actorId, params.actorType, tokenHash, expiresAt.toISOString()]
  );

  return { token: rawToken, expiresAt };
}

/**
 * Validate a refresh token and return the actor info.
 * Revokes the old token and issues a new one (rotation).
 */
export async function rotateRefreshToken(rawToken: string): Promise<{
  actorId: string;
  actorType: 'user' | 'merchant' | 'compliance';
  newRefreshToken: string;
  newRefreshExpiresAt: Date;
} | null> {
  const tokenHash = createHmac('sha256', JWT_SECRET)
    .update(rawToken)
    .digest('hex');

  // Find and revoke in one step
  const rows = await query<{ actor_id: string; actor_type: string }>(
    `UPDATE refresh_tokens
     SET revoked = true
     WHERE token_hash = $1
       AND revoked = false
       AND expires_at > NOW()
     RETURNING actor_id, actor_type`,
    [tokenHash]
  );

  if (rows.length === 0) return null;

  const { actor_id, actor_type } = rows[0];

  // Issue new refresh token
  const newRefresh = await issueRefreshToken({
    actorId: actor_id,
    actorType: actor_type as 'user' | 'merchant' | 'compliance',
  });

  return {
    actorId: actor_id,
    actorType: actor_type as 'user' | 'merchant' | 'compliance',
    newRefreshToken: newRefresh.token,
    newRefreshExpiresAt: newRefresh.expiresAt,
  };
}

/**
 * Revoke all refresh tokens for an actor (logout everywhere).
 */
export async function revokeAllRefreshTokens(actorId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked = true WHERE actor_id = $1 AND revoked = false`,
    [actorId]
  );
}

// ── Nonce Management ─────────────────────────────────────────────

/**
 * Generate a server-side nonce for wallet authentication.
 * Stored in auth_nonces table with 5-minute TTL.
 * Replaces the insecure client-side Math.random() nonce.
 */
export async function generateNonce(walletAddress: string): Promise<string> {
  const nonce = randomBytes(32).toString('hex');

  // Clean up expired nonces for this wallet first
  await query(
    `DELETE FROM auth_nonces WHERE wallet_address = $1 AND (expires_at < NOW() OR used = true)`,
    [walletAddress]
  );

  await query(
    `INSERT INTO auth_nonces (wallet_address, nonce, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${NONCE_TTL_MIN} minutes')`,
    [walletAddress, nonce]
  );

  return nonce;
}

/**
 * Consume a nonce — marks it as used and returns true if valid.
 * Each nonce can only be used once (replay protection).
 */
export async function consumeNonce(
  walletAddress: string,
  nonce: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE auth_nonces
     SET used = true
     WHERE wallet_address = $1
       AND nonce = $2
       AND used = false
       AND expires_at > NOW()
     RETURNING id`,
    [walletAddress, nonce]
  );

  if (rows.length === 0) {
    logger.warn('[JWT] Invalid or expired nonce', { walletAddress });
    return false;
  }

  return true;
}

// ── Cookie helpers ───────────────────────────────────────────────

/**
 * Build Set-Cookie header value for the access token.
 * httpOnly, Secure, SameSite=Lax, path=/
 */
export function buildAccessTokenCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `blip_access=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ACCESS_TOKEN_TTL_SEC}`,
  ];
  if (isProduction) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Build Set-Cookie header value for the refresh token.
 */
export function buildRefreshTokenCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `blip_refresh=${token}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${REFRESH_TOKEN_TTL_SEC}`,
  ];
  if (isProduction) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Build Set-Cookie header to clear auth cookies (logout).
 */
export function buildClearAuthCookies(): string[] {
  return [
    'blip_access=; Path=/; HttpOnly; Max-Age=0',
    'blip_refresh=; Path=/api/auth; HttpOnly; Max-Age=0',
  ];
}

/**
 * Extract a named cookie from a Cookie header string.
 */
export function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
