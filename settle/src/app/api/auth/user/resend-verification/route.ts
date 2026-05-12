/**
 * POST /api/auth/user/resend-verification
 *
 * Resend the email-verification link to a user whose account is not yet
 * verified. Mirror of /api/auth/merchant/resend-verification scoped to
 * the users table.
 *
 * Accepts either { userId } or { email }. Always returns 200 with a
 * generic message — never reveals whether the account exists, mirroring
 * the merchant flow (avoids account-enumeration via this endpoint).
 *
 * Rate-limited with the same AUTH_LIMIT (5/min/IP) the rest of the auth
 * surface uses.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { sendEmail, emailVerificationEmail } from '@/lib/email/ses';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

interface UserVerifyRow {
  id: string;
  email: string | null;
  username: string | null;
  email_verified: boolean;
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:user-resend-verification', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const body = await request.json().catch(() => ({}));
    const userId: unknown = body?.userId;
    const email: unknown = body?.email;

    if (typeof userId !== 'string' && typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'userId or email is required' },
        { status: 400 }
      );
    }

    // Generic success response — sent regardless of whether the account
    // exists, so this endpoint can't be abused for enumeration. Matches
    // the merchant resend route exactly.
    const successResp = NextResponse.json({
      success: true,
      message: 'If the account exists and is unverified, a verification email has been sent.',
    });

    let user: UserVerifyRow | null = null;
    if (typeof userId === 'string' && userId) {
      user = await queryOne<UserVerifyRow>(
        `SELECT id, email, username, COALESCE(email_verified, false) AS email_verified
         FROM users WHERE id = $1`,
        [userId]
      );
    } else if (typeof email === 'string' && email) {
      user = await queryOne<UserVerifyRow>(
        `SELECT id, email, username, COALESCE(email_verified, false) AS email_verified
         FROM users WHERE LOWER(email) = $1`,
        [email.toLowerCase().trim()]
      );
    }

    // No-op branches all return the same body. We deliberately swallow
    // "user has no email" — wallet-only signups have nothing to verify
    // and shouldn't get a follow-up email either.
    if (!user || !user.email || user.email_verified) {
      return successResp;
    }

    // Invalidate any unused verification tokens this user already had,
    // so old links from a prior resend can't be reused.
    await query(
      `UPDATE user_email_verification_tokens
         SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // Issue a fresh token + 24h expiry.
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      `INSERT INTO user_email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [user.id, tokenHash]
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verifyLink = `${appUrl}/user/verify-email?token=${token}&id=${user.id}`;
    const emailContent = emailVerificationEmail(verifyLink, user.username || 'there');

    sendEmail({ to: user.email, ...emailContent }).catch((err) =>
      console.error('[user resend-verification] email send failed:', err)
    );

    return successResp;
  } catch (error) {
    console.error('[user resend-verification] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
