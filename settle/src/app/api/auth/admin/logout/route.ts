/**
 * POST /api/auth/admin/logout
 *
 * Idempotent admin logout. Three responsibilities:
 *   1. Clear the `blip_admin_session` cookie (Max-Age=0).
 *   2. Add the token's `jti` to the Redis revocation list so the same
 *      token cannot be replayed if it was already exfiltrated.
 *   3. Audit-log the event.
 *
 * Always returns 200 — even if the caller had no cookie, no jti, or
 * Redis is unavailable. A 4xx/5xx on logout would leave clients in a
 * worse state than just clearing local UI auth flags.
 *
 * Legacy 3-part tokens carry no jti → can't be revoked individually.
 * The cookie still gets cleared, and the legacy token will expire in
 * <=24h; we warn so the on-call can see migration progress.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  adminCookieOptions,
  readAdminTokenFromRequest,
  verifyAdminToken,
  ADMIN_TOKEN_TTL_SECONDS,
} from '@/lib/middleware/auth';
import { revokeAdminJti } from '@/lib/auth/adminRevocation';
import { logger } from '@/lib/logger';
import { auditLog } from '@/lib/auditLog';

export async function POST(request: NextRequest) {
  const token = readAdminTokenFromRequest(request);

  // Always build the response with the cookie cleared, regardless of
  // what we find. Cookie clear == set value to "" with Max-Age=0.
  const response = NextResponse.json({ success: true, data: { loggedOut: true } });
  response.cookies.set(ADMIN_COOKIE_NAME, '', { ...adminCookieOptions(0), maxAge: 0 });

  if (!token) {
    // No token presented — still 200 (idempotent logout).
    return response;
  }

  const verified = verifyAdminToken(token);
  if (!verified.valid) {
    // Token unparseable / expired — cookie still cleared, just no
    // revocation needed.
    return response;
  }

  if (verified.legacyNoJti) {
    logger.warn('[admin] logout: legacy token has no jti — cannot revoke individually (will expire in <=24h)', {
      username: verified.username,
    });
    auditLog('admin.logout', verified.username || 'unknown', 'admin');
    return response;
  }

  if (verified.jti && verified.issuedAt) {
    const elapsed = Math.floor(Date.now() / 1000) - verified.issuedAt;
    const remaining = Math.max(60, ADMIN_TOKEN_TTL_SECONDS - elapsed);
    try {
      await revokeAdminJti(verified.jti, remaining);
    } catch (err) {
      // Redis write failed. We can't stop the token's reuse — but the
      // cookie IS cleared on this device. Log loudly; do NOT 500 the
      // logout (better to clear local state than leave the user stuck).
      logger.error('[admin] logout: revocation write failed — cookie cleared but token still valid until expiry', {
        jti: verified.jti,
        username: verified.username,
        error: (err as Error).message,
      });
    }
  }

  auditLog('admin.logout', verified.username || 'unknown', 'admin');
  return response;
}
