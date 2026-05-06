/**
 * Admin token revocation list — Redis-backed.
 *
 * Each admin token now embeds a `jti` (random unique id) inside its
 * HMAC-protected payload. To revoke a token before its 24h expiry —
 * e.g. on logout, on credential rotation, on incident response — we
 * write `admin:revoked:<jti>` to Redis with a TTL matching the token's
 * remaining lifetime. Every authenticated request checks this set.
 *
 * Failure mode — IMPORTANT:
 *   If Redis is unreachable, isAdminJtiRevoked() THROWS rather than
 *   returns `false`. Admin auth is high-trust; we cannot certify that a
 *   token wasn't revoked, so we fail CLOSED. The caller (requireAdminAuth)
 *   maps the throw to a 503-style "auth temporarily unavailable" response.
 *
 *   If the operator explicitly accepts the risk (e.g. Redis maintenance
 *   window), set ADMIN_AUTH_REVOCATION_FAIL_OPEN=true to allow tokens to
 *   pass when the revocation check is unreachable. This must NEVER be the
 *   default in production.
 *
 * Legacy tokens (issued before this migration) carry no jti. They
 * cannot be revoked individually but expire normally within 24h. The
 * verifier returns `legacyNoJti: true` for those; callers MUST decide
 * how to treat that — by default we still admit them (they signed
 * correctly) but warn loudly via the logger.
 */

import { redis } from '@/lib/cache/redis';
import { logger } from '@/lib/logger';

const KEY = (jti: string): string => `admin:revoked:${jti}`;

const FAIL_OPEN = process.env.ADMIN_AUTH_REVOCATION_FAIL_OPEN === 'true';

/**
 * Mark a jti as revoked. TTL is clamped to >=60s so the marker
 * outlives any in-flight requests still holding the cached signature.
 */
export async function revokeAdminJti(jti: string, ttlSeconds: number): Promise<void> {
  if (!redis) {
    logger.warn('[adminRevocation] revoke called but Redis unavailable — token cannot be force-killed', {
      jti,
    });
    return;
  }
  try {
    const ttl = Math.max(60, Math.floor(ttlSeconds));
    await redis.set(KEY(jti), '1', 'EX', ttl);
    logger.info('[adminRevocation] token revoked', { jti, ttl });
  } catch (err) {
    logger.error('[adminRevocation] revoke write failed', {
      jti,
      error: (err as Error).message,
    });
    // Re-throw so the caller (logout endpoint) can surface a 500 — a
    // logout that didn't actually revoke is misleading.
    throw err;
  }
}

/**
 * Returns true if the jti is in the revocation set, false otherwise.
 * Throws if the lookup itself failed (caller MUST fail-closed).
 */
export async function isAdminJtiRevoked(jti: string): Promise<boolean> {
  if (!redis) {
    if (FAIL_OPEN) {
      logger.warn('[adminRevocation] Redis unavailable + FAIL_OPEN=true — admitting token', { jti });
      return false;
    }
    logger.error('[adminRevocation] Redis unavailable — failing CLOSED on admin auth');
    throw new Error('REVOCATION_CHECK_UNAVAILABLE');
  }
  try {
    const v = await redis.get(KEY(jti));
    return v === '1';
  } catch (err) {
    if (FAIL_OPEN) {
      logger.warn('[adminRevocation] Redis check failed + FAIL_OPEN=true — admitting token', {
        jti,
        error: (err as Error).message,
      });
      return false;
    }
    logger.error('[adminRevocation] Redis check failed — failing CLOSED', {
      jti,
      error: (err as Error).message,
    });
    throw new Error('REVOCATION_CHECK_UNAVAILABLE');
  }
}
