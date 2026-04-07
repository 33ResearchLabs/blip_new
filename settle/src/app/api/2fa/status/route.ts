/**
 * GET /api/2fa/status
 *
 * Check if 2FA is enabled for the current actor.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, errorResponse } from '@/lib/middleware/auth';
import { getTotpStatus } from '@/lib/auth/totp';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' && auth.actorType !== 'user') {
      return successResponse({ enabled: false });
    }

    const status = await getTotpStatus(auth.actorId, auth.actorType as 'merchant' | 'user');

    return successResponse({
      enabled: status.enabled,
      verifiedAt: status.verifiedAt,
    });
  } catch (error) {
    console.error('[2FA Status] Error:', error);
    return errorResponse('Failed to get 2FA status');
  }
}
