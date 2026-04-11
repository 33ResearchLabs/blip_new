/**
 * POST /api/2fa/regenerate-codes
 *
 * Regenerate the backup recovery codes for an account that already has 2FA
 * enabled. The user must confirm with their current TOTP to prove they still
 * own the second factor (so a stolen session can't quietly rotate codes).
 *
 * Returns the new plaintext codes ONCE — old codes are invalidated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, errorResponse } from '@/lib/middleware/auth';
import {
  getTotpStatus,
  verifyTotpEncrypted,
  recordAttempt,
  isRateLimited,
  generateBackupCodes,
  storeBackupCodes,
} from '@/lib/auth/totp';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' && auth.actorType !== 'user') {
      return errorResponse('2FA is only available for merchants and users', 400);
    }

    const body = await request.json().catch(() => ({}));
    const { code } = body;
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return errorResponse('A 6-digit authenticator code is required', 400);
    }

    const actorType = auth.actorType as 'merchant' | 'user';

    if (await isRateLimited(auth.actorId, actorType)) {
      return errorResponse('Too many attempts. Please wait 15 minutes.', 429);
    }

    const status = await getTotpStatus(auth.actorId, actorType);
    if (!status.enabled || !status.secret) {
      return errorResponse('2FA is not enabled for this account', 400);
    }

    const valid = verifyTotpEncrypted(code, status.secret);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    await recordAttempt(auth.actorId, actorType, valid, ip);
    if (!valid) {
      return errorResponse('Invalid authenticator code', 401);
    }

    const { plaintext, hashes } = generateBackupCodes();
    await storeBackupCodes(auth.actorId, actorType, hashes);

    return successResponse({
      backupCodes: plaintext,
      message: 'New recovery codes generated. Save them now — old codes are no longer valid.',
    });
  } catch (error) {
    console.error('[2FA Regenerate Codes] Error:', error);
    return errorResponse('Failed to regenerate backup codes');
  }
}
