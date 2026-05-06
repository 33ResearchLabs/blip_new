/**
 * POST /api/auth/user/reset-password
 *
 * Body: { token: string, userId: string, newPassword: string }
 *
 * Validates the reset token (hashed lookup), enforces a minimum password
 * length, hashes the new password with the same PBKDF2 settings the user
 * auth uses, and atomically (a) updates the password, (b) burns the token
 * being consumed, (c) invalidates any other unused tokens for this user.
 *
 * Mirror of /api/auth/merchant/reset-password scoped to the users table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import crypto from 'crypto';

// Must match the iteration count + format used by the rest of the user auth
// stack (see hashPassword in src/lib/db/repositories/users.ts).
const PBKDF2_ITERATIONS = 100_000;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512')
    .toString('hex');
  return `${salt}:${PBKDF2_ITERATIONS}:${hash}`;
}

interface TokenRow {
  id: string;
  user_id: string;
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:user-reset-password', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const { token, userId, newPassword } = await request.json();

    if (!token || !userId || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Token, user ID, and new password are required' },
        { status: 400 }
      );
    }

    // Min length matches the registration flow.
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokens = await query<TokenRow>(
      `SELECT id, user_id FROM user_password_reset_tokens
       WHERE token_hash = $1
         AND user_id = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash, userId]
    );

    if (tokens.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired reset link. Please request a new one.' },
        { status: 400 }
      );
    }

    const resetToken = tokens[0];
    const passwordHash = hashPassword(newPassword);

    // Atomic — password update + token burn must succeed or fail together.
    await query('BEGIN');
    try {
      await query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, userId]
      );
      await query(
        `UPDATE user_password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [resetToken.id]
      );
      // Invalidate every other unused token for this user — defence in
      // depth in case the user requested several resets back-to-back.
      await query(
        `UPDATE user_password_reset_tokens SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
      );
      await query('COMMIT');
    } catch (txError) {
      await query('ROLLBACK');
      throw txError;
    }

    return NextResponse.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('[user reset-password] error:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
