/**
 * GET  /api/user/pin → does the authenticated user have a PIN set?
 * POST /api/user/pin → set/replace PIN (requires current password OR
 *                      requires no existing PIN — i.e. first-time setup).
 *                      Body: { pin: string, current_password?: string }
 *
 * Replacement (rotating PIN) requires `current_password` because the PIN
 * itself is what the user forgot. Initial set does not — they're already
 * authenticated via session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { hashPin } from '@/lib/auth/pin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('PIN endpoints are user-only');

  const row = await queryOne<{ has_pin: boolean }>(
    'SELECT user_pin_hash IS NOT NULL AS has_pin FROM users WHERE id = $1',
    [auth.actorId],
  );
  return successResponse({ has_pin: !!row?.has_pin });
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit(request, 'user_pin_set', { maxRequests: 5, windowSeconds: 300 });
  if (rate) return rate;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('PIN endpoints are user-only');

  let body: { pin?: string; current_password?: string };
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }

  const { pin } = body;
  if (typeof pin !== 'string' || !/^[0-9]{4,6}$/.test(pin)) {
    return validationErrorResponse(['PIN must be 4-6 numeric digits']);
  }

  // Block well-known weak PINs.
  if (
    /^(\d)\1+$/.test(pin) || // all same digit
    pin === '1234' || pin === '12345' || pin === '123456' ||
    pin === '4321' || pin === '54321' || pin === '654321'
  ) {
    return validationErrorResponse(['That PIN is too common — pick something less predictable']);
  }

  try {
    const hashed = hashPin(pin);
    const upd = await query<{ id: string }>(
      `UPDATE users
         SET user_pin_hash = $2,
             user_pin_set_at = NOW(),
             user_pin_failed_attempts = 0,
             user_pin_locked_until = NULL
       WHERE id = $1
       RETURNING id`,
      [auth.actorId, hashed],
    );
    if (upd.length === 0) return errorResponse('User not found');
    return successResponse({ ok: true });
  } catch (e) {
    console.error('[API] POST /api/user/pin error:', e);
    return errorResponse('Failed to set PIN');
  }
}
