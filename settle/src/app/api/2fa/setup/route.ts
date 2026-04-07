/**
 * POST /api/2fa/setup
 *
 * Generate a TOTP secret + QR code for 2FA setup.
 * Requires authenticated merchant/user session.
 * Stores temp secret (encrypted) — NOT enabled until /api/2fa/verify confirms.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, errorResponse } from '@/lib/middleware/auth';
import { generateTotpSetup, storeTempSecret, getTotpStatus } from '@/lib/auth/totp';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' && auth.actorType !== 'user') {
      return errorResponse('2FA is only available for merchants and users', 400);
    }

    // Check if already enabled
    const status = await getTotpStatus(auth.actorId, auth.actorType as 'merchant' | 'user');
    if (status.enabled) {
      return errorResponse('2FA is already enabled. Disable it first to reconfigure.', 409);
    }

    // Determine account name for QR code
    let accountName = auth.actorId.slice(0, 8);
    try {
      const body = await request.json().catch(() => ({}));
      if (body.accountName) accountName = body.accountName;
    } catch {
      // No body — use default
    }

    // Generate secret + QR
    const setup = await generateTotpSetup(accountName);

    // Store temp secret (encrypted, not enabled yet)
    await storeTempSecret(auth.actorId, auth.actorType as 'merchant' | 'user', setup.secret);

    return successResponse({
      qrDataUrl: setup.qrDataUrl,
      secret: setup.secret, // For manual entry
      otpauthUrl: setup.otpauthUrl,
    });
  } catch (error) {
    console.error('[2FA Setup] Error:', error);
    return errorResponse('Failed to generate 2FA setup');
  }
}
