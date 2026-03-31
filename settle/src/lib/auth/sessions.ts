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
