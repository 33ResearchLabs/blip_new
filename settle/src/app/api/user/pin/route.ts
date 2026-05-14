/**
 * GET    /api/user/pin → does the authenticated user have a PIN set?
 * POST   /api/user/pin → set / replace Payment PIN.
 *                        Body: { pin: string, current_password?: string }
 *                        First-time set (no existing PIN) does NOT require
 *                        the password — the session itself authenticates.
 *                        Replacement (existing PIN present) REQUIRES
 *                        `current_password` — otherwise a hijacked session
 *                        could silently overwrite the PIN.
 * DELETE /api/user/pin → clear Payment PIN ("I forgot it").
 *                        Body: { current_password: string }. Always requires
 *                        the password. Resets failed-attempt counter and
 *                        lockout. Next POST sets a fresh PIN as first-time.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
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
import { hashPin } from '@/lib/auth/pin';

export const dynamic = 'force-dynamic';

// Mirror of repositories/users.ts `verifyPassword` — duplicated here to
// avoid widening that file's export surface for one route. Supports both
// the current PBKDF2 format (`salt:iterations:hash`) and the legacy
// plain-SHA256 fallback, same as the login path.
const PBKDF2_ITERATIONS = 100_000;
function verifyAccountPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length === 3) {
    const [salt, , hash] = parts;
    const iterations = parseInt(parts[1], 10);
    const verifyHash = crypto
      .pbkdf2Sync(password, salt, iterations, 64, 'sha512')
      .toString('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(verifyHash, 'hex'),
      );
    } catch {
      return false;
    }
  }
  if (storedHash.length === 64 && !storedHash.includes(':')) {
    const legacy = crypto.createHash('sha256').update(password).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(legacy, 'hex'),
        Buffer.from(storedHash, 'hex'),
      );
    } catch {
      return false;
    }
  }
  return false;
}

function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // all same digit
  if (
    pin === '1234' || pin === '12345' || pin === '123456' ||
    pin === '4321' || pin === '54321' || pin === '654321'
  ) {
    return true;
  }
  return false;
}

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

  const { pin, current_password } = body;
  if (typeof pin !== 'string' || !/^[0-9]{4,6}$/.test(pin)) {
    return validationErrorResponse(['PIN must be 4-6 numeric digits']);
  }
  if (isWeakPin(pin)) {
    return validationErrorResponse(['That PIN is too common — pick something less predictable']);
  }

  try {
    // Replacement gate: if a PIN already exists, require current_password.
    // Reading the user row also gives us password_hash for the rotation check.
    const existing = await queryOne<{ user_pin_hash: string | null; password_hash: string }>(
      'SELECT user_pin_hash, password_hash FROM users WHERE id = $1',
      [auth.actorId],
    );
    if (!existing) return errorResponse('User not found');

    if (existing.user_pin_hash) {
      // Rotation — must prove possession of the account password.
      if (typeof current_password !== 'string' || current_password.length === 0) {
        return validationErrorResponse(['current_password is required to change an existing PIN']);
      }
      if (!verifyAccountPassword(current_password, existing.password_hash)) {
        return unauthorizedResponse('Incorrect account password');
      }
    }

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

export async function DELETE(request: NextRequest) {
  // Always password-gated. We deliberately rate-limit this tighter than POST
  // — repeated DELETE attempts with wrong passwords look like an attack.
  const rate = await checkRateLimit(request, 'user_pin_reset', { maxRequests: 3, windowSeconds: 300 });
  if (rate) return rate;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user') return forbiddenResponse('PIN endpoints are user-only');

  let body: { current_password?: string };
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }
  const { current_password } = body;
  if (typeof current_password !== 'string' || current_password.length === 0) {
    return validationErrorResponse(['current_password is required']);
  }

  try {
    const existing = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [auth.actorId],
    );
    if (!existing) return errorResponse('User not found');
    if (!verifyAccountPassword(current_password, existing.password_hash)) {
      return unauthorizedResponse('Incorrect account password');
    }

    await query(
      `UPDATE users
         SET user_pin_hash = NULL,
             user_pin_set_at = NULL,
             user_pin_failed_attempts = 0,
             user_pin_locked_until = NULL
       WHERE id = $1`,
      [auth.actorId],
    );
    return successResponse({ ok: true });
  } catch (e) {
    console.error('[API] DELETE /api/user/pin error:', e);
    return errorResponse('Failed to reset PIN');
  }
}
