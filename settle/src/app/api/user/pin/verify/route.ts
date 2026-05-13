/**
 * POST /api/user/pin/verify
 *
 * Body: { pin: string }
 *
 * Verifies the user's app PIN. Rate-limited at the API layer AND tracked in
 * the DB via user_pin_failed_attempts / user_pin_locked_until so a fresh IP
 * doesn't reset the budget. After 5 failed attempts → 15-min lockout.
 *
 * Returns 200 { success: true } on match, 401 on miss, 423 on lockout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
  unauthorizedResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { verifyPin } from '@/lib/auth/pin';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  // Belt-and-braces: per-IP rate limit on top of per-actor DB counter.
  const rate = await checkRateLimit(request, 'user_pin_verify', { maxRequests: 10, windowSeconds: 300 });
  if (rate) return rate;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('PIN endpoints are user-only');

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }
  const { pin } = body;
  if (typeof pin !== 'string' || !/^[0-9]{4,6}$/.test(pin)) {
    return validationErrorResponse(['PIN must be 4-6 numeric digits']);
  }

  const row = await queryOne<{
    user_pin_hash: string | null;
    user_pin_failed_attempts: number;
    user_pin_locked_until: Date | null;
  }>(
    `SELECT user_pin_hash, user_pin_failed_attempts, user_pin_locked_until
       FROM users WHERE id = $1`,
    [auth.actorId],
  );
  if (!row) return errorResponse('User not found');
  if (!row.user_pin_hash) {
    return NextResponse.json(
      { success: false, error: 'PIN not set' },
      { status: 409 },
    );
  }

  if (row.user_pin_locked_until && row.user_pin_locked_until.getTime() > Date.now()) {
    const retryAfterSec = Math.ceil((row.user_pin_locked_until.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { success: false, error: `PIN locked. Try again in ${Math.ceil(retryAfterSec / 60)} min.` },
      { status: 423, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  const ok = verifyPin(pin, row.user_pin_hash);

  if (!ok) {
    const next = (row.user_pin_failed_attempts || 0) + 1;
    const willLock = next >= MAX_ATTEMPTS;
    await query(
      `UPDATE users
          SET user_pin_failed_attempts = $2,
              user_pin_locked_until = CASE WHEN $3::boolean THEN NOW() + INTERVAL '${LOCKOUT_MS} milliseconds' ELSE user_pin_locked_until END
        WHERE id = $1`,
      [auth.actorId, next, willLock],
    );
    return unauthorizedResponse(
      willLock ? 'Too many wrong attempts. PIN locked for 15 minutes.' : 'Incorrect PIN',
    );
  }

  // Success — reset counters.
  await query(
    `UPDATE users
        SET user_pin_failed_attempts = 0,
            user_pin_locked_until = NULL
      WHERE id = $1`,
    [auth.actorId],
  );
  return successResponse({ ok: true });
}
