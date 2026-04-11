/**
 * POST /api/2fa/verify-login
 *
 * Complete login after 2FA challenge.
 * Called when login returns requires2FA: true with a pendingToken.
 * Verifies the TOTP code, then issues real access/refresh tokens.
 */

import { NextRequest, NextResponse } from 'next/server';
import { successResponse, errorResponse } from '@/lib/middleware/auth';
import {
  consumePendingLoginToken,
  getTotpStatus,
  verifyTotpEncrypted,
  recordAttempt,
  isRateLimited,
  consumeBackupCode,
} from '@/lib/auth/totp';
import { generateSessionToken, generateAccessToken, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from '@/lib/auth/sessionToken';
import { createSession } from '@/lib/auth/sessions';
import { queryOne } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pendingToken, code } = body;

    if (!pendingToken || !code || typeof code !== 'string') {
      return errorResponse('pendingToken and code are required', 400);
    }

    // Code can be either a 6-digit TOTP or a backup code (XXXX-XXXX-XX format).
    const isOtp = /^\d{6}$/.test(code);
    const isBackup = /^[a-zA-Z0-9-]{10,14}$/.test(code) && !isOtp;
    if (!isOtp && !isBackup) {
      return errorResponse('Provide a 6-digit code or a backup recovery code', 400);
    }

    // Consume the pending login token (one-time use)
    const pending = await consumePendingLoginToken(pendingToken);
    if (!pending) {
      return errorResponse('Invalid or expired login token. Please log in again.', 401);
    }

    const { actorId, actorType } = pending;

    // Rate limit
    if (await isRateLimited(actorId, actorType)) {
      return errorResponse('Too many attempts. Please wait 15 minutes.', 429);
    }

    // Get TOTP secret
    const status = await getTotpStatus(actorId, actorType);
    if (!status.enabled || !status.secret) {
      return errorResponse('2FA is not enabled for this account', 400);
    }

    // Verify OTP or backup code
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    let valid = false;
    if (isOtp) {
      valid = verifyTotpEncrypted(code, status.secret);
    } else {
      valid = await consumeBackupCode(actorId, actorType, code);
    }
    await recordAttempt(actorId, actorType, valid, ip);

    if (!valid) {
      return errorResponse(
        isBackup
          ? 'Invalid or already-used backup code.'
          : 'Invalid authenticator code. Please try again.',
        401
      );
    }

    // Issue real tokens with session tracking
    const payload = { actorId, actorType: actorType as 'user' | 'merchant' };

    // Create session first to get sessionId for v2 token
    let sessionId: string | undefined;
    let refreshToken: string | null = null;
    try {
      const sess = await createSession(payload, request as any);
      if (sess) { sessionId = sess.sessionId; refreshToken = sess.refreshToken; }
    } catch { /* proceed without session tracking */ }

    const token = generateSessionToken(payload);
    const accessToken = generateAccessToken({ ...payload, sessionId });

    // Get actor profile for response
    let actorData: Record<string, unknown> | null = null;
    if (actorType === 'merchant') {
      actorData = await queryOne(
        `SELECT id, username, display_name, business_name, wallet_address, avatar_url, bio, email,
                rating, total_trades, is_online, balance, has_ops_access,
                COALESCE(has_compliance_access, false) as has_compliance_access
         FROM merchants WHERE id = $1 AND status = 'active'`,
        [actorId]
      );
    } else {
      actorData = await queryOne(
        `SELECT id, username, wallet_address FROM users WHERE id = $1`,
        [actorId]
      );
    }

    const response = NextResponse.json({
      success: true,
      data: {
        [actorType]: actorData,
        ...(token && { token }),
        ...(accessToken && { accessToken }),
      },
    });

    if (refreshToken) response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    console.error('[2FA Login Verify] Error:', error);
    return errorResponse('Failed to verify 2FA login');
  }
}
