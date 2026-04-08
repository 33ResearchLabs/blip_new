/**
 * Session Management — DB-backed refresh tokens
 *
 * Features:
 *   - Token rotation: new refresh token on each use
 *   - Reuse detection: if old token is used, revoke ALL sessions (stolen)
 *   - Revocation: logout single device or all devices
 *   - Active devices: list all active sessions
 */

import { createHash } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { generateRefreshToken, verifyRefreshToken, TokenPayload, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from './sessionToken';

const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Hash a refresh token for safe DB storage */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Session {
  id: string;
  entity_id: string;
  entity_type: string;
  device_info: string | null;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string;
  is_revoked: boolean;
}

// Extended session with parsed device details for API responses
export interface SessionWithDetails extends Session {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceName: string | null;
  deviceType: 'mobile' | 'tablet' | 'desktop';
}

/**
 * Create a new session and return the refresh token.
 * Called on login.
 */
export async function createSession(
  payload: TokenPayload,
  request?: { headers?: { get: (name: string) => string | null }; ip?: string }
): Promise<{ refreshToken: string; sessionId: string } | null> {
  const refreshToken = generateRefreshToken(payload);
  if (!refreshToken) return null;

  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS).toISOString();

  // Extract device info from request
  const userAgent = request?.headers?.get?.('user-agent') || null;
  const ip = request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
    || request?.headers?.get?.('x-real-ip')
    || request?.ip
    || null;
  const deviceInfo = userAgent ? parseDeviceInfo(userAgent) : null;

  const session = await queryOne<{ id: string }>(
    `INSERT INTO sessions (entity_id, entity_type, refresh_token_hash, device_info, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [payload.actorId, payload.actorType, tokenHash, deviceInfo, ip, userAgent, expiresAt]
  );

  if (!session) return null;

  return { refreshToken, sessionId: session.id };
}

/**
 * Validate and rotate a refresh token.
 * Returns new tokens if valid, null if invalid.
 * Detects token reuse (stolen tokens).
 */
export async function rotateRefreshToken(
  oldToken: string,
  request?: { headers?: { get: (name: string) => string | null }; ip?: string }
): Promise<{ payload: TokenPayload; newRefreshToken: string; sessionId: string } | null> {
  // Verify the token signature/expiry first
  const payload = verifyRefreshToken(oldToken);
  if (!payload) return null;

  const oldHash = hashToken(oldToken);

  // Look up the session by token hash
  const session = await queryOne<Session & { replaced_by: string | null }>(
    `SELECT * FROM sessions WHERE refresh_token_hash = $1`,
    [oldHash]
  );

  if (!session) {
    // Token not found — could be an old rotated token being reused
    // Check if this hash appears in any revoked session (reuse detection)
    const revokedSession = await queryOne<{ entity_id: string; entity_type: string }>(
      `SELECT entity_id, entity_type FROM sessions WHERE refresh_token_hash = $1 AND is_revoked = true`,
      [oldHash]
    );

    if (revokedSession) {
      // TOKEN REUSE DETECTED — revoke ALL sessions for this user
      console.error('[SESSION] Token reuse detected! Revoking all sessions', {
        entityId: revokedSession.entity_id,
        entityType: revokedSession.entity_type,
      });
      await revokeAllSessions(revokedSession.entity_id, revokedSession.entity_type);
    }

    return null;
  }

  // Check if session is revoked or expired
  if (session.is_revoked || new Date(session.expires_at) < new Date()) {
    return null;
  }

  // Generate new refresh token
  const newRefreshToken = generateRefreshToken(payload);
  if (!newRefreshToken) return null;

  const newHash = hashToken(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS).toISOString();

  // Update IP/device info
  const userAgent = request?.headers?.get?.('user-agent') || session.user_agent;
  const ip = request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
    || request?.headers?.get?.('x-real-ip')
    || session.ip_address;

  // Create new session, revoke old one (atomic rotation)
  const newSession = await queryOne<{ id: string }>(
    `INSERT INTO sessions (entity_id, entity_type, refresh_token_hash, device_info, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [payload.actorId, payload.actorType, newHash, session.device_info, ip, userAgent, newExpiresAt]
  );

  if (!newSession) return null;

  // Revoke old session and link to new one
  await query(
    `UPDATE sessions SET is_revoked = true, revoked_at = NOW(), replaced_by = $1 WHERE id = $2`,
    [newSession.id, session.id]
  );

  return { payload, newRefreshToken, sessionId: newSession.id };
}

/**
 * Revoke a single session (logout one device)
 */
export async function revokeSession(sessionId: string): Promise<boolean> {
  const result = await query(
    `UPDATE sessions SET is_revoked = true, revoked_at = NOW() WHERE id = $1 AND is_revoked = false RETURNING id`,
    [sessionId]
  );
  if (result.length > 0) {
    invalidateSessionCache(sessionId);
  }
  return result.length > 0;
}

/**
 * Revoke ALL sessions for an entity (logout everywhere)
 */
export async function revokeAllSessions(entityId: string, entityType: string): Promise<number> {
  const result = await query(
    `UPDATE sessions SET is_revoked = true, revoked_at = NOW() WHERE entity_id = $1 AND entity_type = $2 AND is_revoked = false RETURNING id`,
    [entityId, entityType]
  );
  // Clear entire cache — all sessions for this entity are now invalid
  invalidateAllSessionCaches();
  return result.length;
}

/**
 * Get all active sessions for an entity (active devices)
 */
export async function getActiveSessions(entityId: string, entityType: string): Promise<Session[]> {
  return query<Session>(
    `SELECT id, entity_id, entity_type, device_info, ip_address, user_agent, expires_at, created_at, last_used_at, is_revoked
     FROM sessions
     WHERE entity_id = $1 AND entity_type = $2 AND is_revoked = false AND expires_at > NOW()
     ORDER BY last_used_at DESC`,
    [entityId, entityType]
  );
}

// ── Per-session validation with cache ─────────────────────────────────

// In-memory cache: sessionId → { valid: boolean, expiresAt: number }
// Avoids DB hit on every request. 30-second TTL ensures revocations propagate quickly.
const sessionValidityCache = new Map<string, { valid: boolean; cachedAt: number }>();
const SESSION_CACHE_TTL = 30_000; // 30 seconds

/**
 * Check if a specific session is valid (not revoked, not expired).
 * Used by auth middleware for v2 tokens that embed a sessionId.
 * Cached for 30 seconds to avoid DB hit on every request.
 */
export async function isSessionValid(sessionId: string): Promise<boolean> {
  // Check cache first
  const cached = sessionValidityCache.get(sessionId);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL) {
    return cached.valid;
  }

  const session = await queryOne<{ is_revoked: boolean; expires_at: string }>(
    'SELECT is_revoked, expires_at FROM sessions WHERE id = $1',
    [sessionId]
  );

  const valid = !!session && !session.is_revoked && new Date(session.expires_at) > new Date();

  // Cache the result (including negative results — invalid sessions stay invalid)
  sessionValidityCache.set(sessionId, { valid, cachedAt: Date.now() });

  // Prune cache if it grows too large (prevent memory leak from expired entries)
  if (sessionValidityCache.size > 10_000) {
    const now = Date.now();
    for (const [key, entry] of sessionValidityCache) {
      if (now - entry.cachedAt > SESSION_CACHE_TTL) sessionValidityCache.delete(key);
    }
  }

  return valid;
}

/** Invalidate a session from the cache (call after revocation) */
export function invalidateSessionCache(sessionId: string): void {
  sessionValidityCache.delete(sessionId);
}

/** Invalidate all cached sessions for an entity (call after revokeAll) */
export function invalidateAllSessionCaches(): void {
  sessionValidityCache.clear();
}

/**
 * Look up a session by refresh token hash (for check_session flow).
 * Returns the session_id if found and valid, null otherwise.
 */
export async function getSessionIdFromRefreshCookie(refreshToken: string): Promise<string | null> {
  const tokenHash = hashToken(refreshToken);
  const session = await queryOne<{ id: string; is_revoked: boolean; expires_at: string }>(
    'SELECT id, is_revoked, expires_at FROM sessions WHERE refresh_token_hash = $1',
    [tokenHash]
  );
  if (!session || session.is_revoked || new Date(session.expires_at) < new Date()) {
    return null;
  }
  return session.id;
}

/**
 * Check if ALL sessions for an entity are revoked (no active sessions remain).
 * Used by auth middleware as fallback for old tokens without sessionId.
 * Returns true if the entity has ZERO active sessions → token should be rejected.
 *
 * Uses EXISTS instead of COUNT so Postgres can short-circuit on the first
 * matching row. On a merchant with many historical (revoked/expired)
 * sessions, COUNT had to visit every row in the partial index; EXISTS
 * stops after the first hit. Observed improvement: 750ms → sub-5ms.
 */
export async function hasNoActiveSessions(entityId: string, entityType: string): Promise<boolean> {
  const result = await queryOne<{ has_active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM sessions
       WHERE entity_id = $1
         AND entity_type = $2
         AND is_revoked = false
         AND expires_at > NOW()
     ) AS has_active`,
    [entityId, entityType]
  );
  return !result?.has_active;
}

/**
 * Clean up expired sessions (call from worker/cron)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await query(
    `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '30 days' RETURNING id`
  );
  return result.length;
}

/** Parse user-agent into a readable device string */
function parseDeviceInfo(ua: string): string {
  if (ua.includes('Mobile')) {
    if (ua.includes('Android')) return 'Android Mobile';
    if (ua.includes('iPhone')) return 'iPhone';
    if (ua.includes('iPad')) return 'iPad';
    return 'Mobile';
  }
  if (ua.includes('Chrome')) return 'Chrome Desktop';
  if (ua.includes('Firefox')) return 'Firefox Desktop';
  if (ua.includes('Safari')) return 'Safari Desktop';
  return 'Desktop';
}

/** Parse user-agent into detailed device info */
export function parseDeviceDetails(ua: string): {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  device: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
} {
  let browser = 'Unknown';
  let browserVersion = '';
  let os = 'Unknown';
  let osVersion = '';
  let device = 'Desktop';
  let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';

  // Browser detection (order matters — Chrome includes Safari in UA)
  if (ua.includes('Edg/')) {
    browser = 'Edge';
    browserVersion = ua.match(/Edg\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('OPR/') || ua.includes('Opera')) {
    browser = 'Opera';
    browserVersion = ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('Firefox/')) {
    browser = 'Firefox';
    browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
    browser = 'Chrome';
    browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] || '';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    browser = 'Safari';
    browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] || '';
  }

  // OS detection
  if (ua.includes('iPhone')) {
    os = 'iOS';
    osVersion = ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '';
    device = 'iPhone';
    deviceType = 'mobile';
  } else if (ua.includes('iPad')) {
    os = 'iPadOS';
    osVersion = ua.match(/CPU OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '';
    device = 'iPad';
    deviceType = 'tablet';
  } else if (ua.includes('Android')) {
    os = 'Android';
    osVersion = ua.match(/Android ([\d.]+)/)?.[1] || '';
    device = ua.match(/;\s*([^;)]+)\s*Build/)?.[1]?.trim() || 'Android Device';
    deviceType = ua.includes('Mobile') ? 'mobile' : 'tablet';
  } else if (ua.includes('Mac OS X')) {
    os = 'macOS';
    osVersion = ua.match(/Mac OS X ([\d_.]+)/)?.[1]?.replace(/_/g, '.') || '';
    device = 'Mac';
  } else if (ua.includes('Windows NT')) {
    os = 'Windows';
    const ntVersion = ua.match(/Windows NT ([\d.]+)/)?.[1] || '';
    const winVersions: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    osVersion = winVersions[ntVersion] || ntVersion;
    device = 'PC';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
    device = 'PC';
  }

  // Shorten browser version to major.minor
  if (browserVersion.includes('.')) {
    browserVersion = browserVersion.split('.').slice(0, 2).join('.');
  }

  return { browser, browserVersion, os, osVersion, device, deviceType };
}
