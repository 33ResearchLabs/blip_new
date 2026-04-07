/**
 * POST /api/2fa/disable
 *
 * Disable 2FA. Requires password + current TOTP code for security.
 * Removes secret and sets totp_enabled = false.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, errorResponse } from '@/lib/middleware/auth';
import { getTotpStatus, verifyTotpEncrypted, disableTotp, recordAttempt, isRateLimited } from '@/lib/auth/totp';
import { query, queryOne } from '@/lib/db';
import { timingSafeEqual, pbkdf2Sync } from 'crypto';

function verifyPasswordHash(password: string, hash: string): boolean {
  const parts = hash.split(':');
  if (parts.length < 3) return false;
  const iterations = parseInt(parts[0], 10);
  const salt = parts[1];
  const storedKey = parts[2];
  const derivedKey = pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  if (derivedKey.length !== storedKey.length) return false;
  return timingSafeEqual(Buffer.from(derivedKey), Buffer.from(storedKey));
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' && auth.actorType !== 'user') {
      return errorResponse('2FA is only available for merchants and users', 400);
    }

    const body = await request.json();
    const { password, code } = body;

    if (!password || !code) {
      return errorResponse('Password and 6-digit code are required', 400);
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return errorResponse('A valid 6-digit code is required', 400);
    }

    const actorType = auth.actorType as 'merchant' | 'user';

    // Rate limit
    if (await isRateLimited(auth.actorId, actorType)) {
      return errorResponse('Too many attempts. Please wait 15 minutes.', 429);
    }

    // Check 2FA is enabled
    const status = await getTotpStatus(auth.actorId, actorType);
    if (!status.enabled || !status.secret) {
      return errorResponse('2FA is not enabled', 400);
    }

    // Verify password
    const table = actorType === 'merchant' ? 'merchants' : 'users';
    const row = await queryOne<{ password_hash: string | null }>(
      `SELECT password_hash FROM ${table} WHERE id = $1`,
      [auth.actorId]
    );

    if (!row?.password_hash) {
      return errorResponse('Password verification not available for wallet-only accounts. Contact support.', 400);
    }

    if (!verifyPasswordHash(password, row.password_hash)) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      await recordAttempt(auth.actorId, actorType, false, ip);
      return errorResponse('Invalid password', 401);
    }

    // Verify TOTP code
    const valid = verifyTotpEncrypted(code, status.secret);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    await recordAttempt(auth.actorId, actorType, valid, ip);

    if (!valid) {
      return errorResponse('Invalid authenticator code', 401);
    }

    // Disable 2FA
    await disableTotp(auth.actorId, actorType);

    return successResponse({ enabled: false, message: '2FA has been disabled.' });
  } catch (error) {
    console.error('[2FA Disable] Error:', error);
    return errorResponse('Failed to disable 2FA');
  }
}
