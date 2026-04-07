/**
 * POST /api/auth/merchant/resend-verification
 *
 * Resend email verification link. Rate limited to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { sendEmail, emailVerificationEmail } from '@/lib/email/ses';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:resend-verification', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const body = await request.json();
    const { merchantId, email } = body;

    if (!merchantId && !email) {
      return NextResponse.json(
        { success: false, error: 'merchantId or email is required' },
        { status: 400 }
      );
    }

    // Find merchant
    let merchant;
    if (merchantId) {
      merchant = await queryOne<{ id: string; email: string; display_name: string; email_verified: boolean }>(
        `SELECT id, email, display_name, COALESCE(email_verified, false) as email_verified FROM merchants WHERE id = $1`,
        [merchantId]
      );
    } else {
      merchant = await queryOne<{ id: string; email: string; display_name: string; email_verified: boolean }>(
        `SELECT id, email, display_name, COALESCE(email_verified, false) as email_verified FROM merchants WHERE LOWER(email) = $1`,
        [email.toLowerCase()]
      );
    }

    // Always return success to prevent enumeration
    const successResp = NextResponse.json({
      success: true,
      message: 'If the account exists and is unverified, a verification email has been sent.',
    });

    if (!merchant || merchant.email_verified) {
      return successResp;
    }

    // Invalidate old tokens
    await query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE merchant_id = $1 AND used_at IS NULL`,
      [merchant.id]
    );

    // Generate new token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await query(
      `INSERT INTO email_verification_tokens (merchant_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [merchant.id, tokenHash]
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verifyLink = `${appUrl}/merchant/verify-email?token=${token}&id=${merchant.id}`;

    const emailContent = emailVerificationEmail(verifyLink, merchant.display_name);
    sendEmail({ to: merchant.email, ...emailContent })
      .catch(err => console.error('[Resend Verification] Email failed:', err));

    return successResp;
  } catch (error) {
    console.error('[Resend Verification] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
