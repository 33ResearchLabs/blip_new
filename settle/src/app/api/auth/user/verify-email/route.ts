/**
 * GET /api/auth/user/verify-email?token=xxx&id=xxx
 *
 * Verifies a user's email address using the token issued by the register
 * or resend-verification flow. Mirrors the merchant verify-email route but
 * scoped to the `users` table + `user_email_verification_tokens`.
 *
 * Returns JSON so the /user/verify-email page can render proper success /
 * error states. Single-use tokens: `used_at` is stamped on success so the
 * same link can't be replayed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    const userId = request.nextUrl.searchParams.get('id');

    if (!token || !userId) {
      return NextResponse.json(
        { success: false, error: 'Missing token or user ID' },
        { status: 400 }
      );
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenRow = await queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM user_email_verification_tokens
        WHERE token_hash = $1
          AND user_id = $2
          AND used_at IS NULL
          AND expires_at > NOW()`,
      [tokenHash, userId]
    );

    if (!tokenRow) {
      // Already-verified accounts should still see a friendly success, not
      // an "invalid link" error — re-clicking the email after verification
      // shouldn't look broken.
      const alreadyVerified = await queryOne<{ email_verified: boolean }>(
        `SELECT COALESCE(email_verified, false) AS email_verified
           FROM users WHERE id = $1`,
        [userId]
      );
      if (alreadyVerified?.email_verified) {
        return NextResponse.json({
          success: true,
          data: { alreadyVerified: true, message: 'Email already verified.' },
        });
      }

      return NextResponse.json(
        { success: false, error: 'This verification link is invalid or has expired.' },
        { status: 400 }
      );
    }

    // Mark token as used + flip email_verified in a single round-trip. Two
    // separate updates is fine here: the token row only matters as a one-
    // shot, and email_verified is idempotent.
    await query(
      `UPDATE user_email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenRow.id]
    );

    await query(
      `UPDATE users SET email_verified = true WHERE id = $1`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: { message: 'Your email has been verified.' },
    });
  } catch (error) {
    console.error('[user verify-email] error:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed. Please try again.' },
      { status: 500 }
    );
  }
}
