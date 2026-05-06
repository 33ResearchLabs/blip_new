/**
 * POST /api/auth/user/forgot-password
 *
 * Body: { email: string }
 *
 * Generates a password-reset token bound to the matching user, stores its
 * SHA-256 hash, and emails the user a link with the plaintext token. Always
 * returns success to prevent email enumeration. Mirrors the merchant flow,
 * scoped to the users table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { sendEmail, passwordResetEmail } from '@/lib/email/ses';
import crypto from 'crypto';

const TOKEN_EXPIRY_MINUTES = 15;

interface UserRow {
  id: string;
  username: string | null;
  name: string | null;
  email: string;
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:user-forgot-password', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Always return success — prevents email enumeration via response shape.
    const successResponse = NextResponse.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });

    // Lookup — only password-bearing accounts can reset. Wallet-only
    // accounts have no password to overwrite.
    const users = await query<UserRow>(
      `SELECT id, username, name, email FROM users
       WHERE LOWER(email) = $1 AND password_hash IS NOT NULL`,
      [normalizedEmail]
    );

    if (users.length === 0) return successResponse;

    const user = users[0];

    // Invalidate any existing unused tokens for this user — prevents
    // multiple in-flight reset links sitting in inboxes.
    await query(
      `UPDATE user_password_reset_tokens SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await query(
      `INSERT INTO user_password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${TOKEN_EXPIRY_MINUTES} minutes')`,
      [user.id, tokenHash]
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/user/reset-password?token=${token}&id=${user.id}`;

    const displayName = user.username || user.name || 'there';
    const emailContent = passwordResetEmail(resetLink, displayName);
    sendEmail({ to: user.email, ...emailContent }).catch(err =>
      console.error('[user forgot-password] email send failed:', err)
    );

    return successResponse;
  } catch (error) {
    console.error('[user forgot-password] error:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
