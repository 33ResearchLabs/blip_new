/**
 * GET /api/auth/user/verify-email?token=xxx&id=xxx
 *
 * Verifies a user's email address using the token from the verification
 * email. Sets email_verified = true on success and redirects back to the
 * user landing page with a success / error flag in the query string.
 *
 * Mirror of /api/auth/merchant/verify-email scoped to the users table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import crypto from 'crypto';

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

    // Find a valid (unused, non-expired) token bound to this user.
    const tokenRow = await queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM user_email_verification_tokens
       WHERE token_hash = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash, userId]
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (!tokenRow) {
      return NextResponse.redirect(`${appUrl}/?error=invalid_or_expired_token`);
    }

    // Burn the token + flip the user's email_verified flag.
    await query(
      `UPDATE user_email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenRow.id]
    );
    await query(
      `UPDATE users SET email_verified = true WHERE id = $1`,
      [userId]
    );

    return NextResponse.redirect(`${appUrl}/?verified=true`);
  } catch (error) {
    console.error('[user verify-email] error:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed' },
      { status: 500 }
    );
  }
}
