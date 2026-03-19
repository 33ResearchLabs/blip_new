import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import crypto from 'crypto';

// PBKDF2 config — must match merchant auth route
const PBKDF2_ITERATIONS = 100_000;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  return `${salt}:${PBKDF2_ITERATIONS}:${hash}`;
}

interface TokenRow {
  id: string;
  merchant_id: string;
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, 'auth:reset-password', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const { token, merchantId, newPassword } = await request.json();

    if (!token || !merchantId || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Token, merchant ID, and new password are required' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Hash the token to compare against stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid, unused, non-expired token
    const tokens = await query<TokenRow>(
      `SELECT id, merchant_id FROM password_reset_tokens
       WHERE token_hash = $1
         AND merchant_id = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash, merchantId]
    );

    if (tokens.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired reset link. Please request a new one.' },
        { status: 400 }
      );
    }

    const resetToken = tokens[0];

    // Hash new password
    const passwordHash = hashPassword(newPassword);

    // Update password and mark token as used — in a transaction
    await query('BEGIN');
    try {
      await query(
        `UPDATE merchants SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, merchantId]
      );

      await query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [resetToken.id]
      );

      // Invalidate all other tokens for this merchant
      await query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE merchant_id = $1 AND used_at IS NULL`,
        [merchantId]
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
    console.error('[reset-password] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
