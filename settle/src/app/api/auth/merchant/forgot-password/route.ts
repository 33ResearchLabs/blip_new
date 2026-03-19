import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { sendEmail, passwordResetEmail } from '@/lib/email/ses';
import crypto from 'crypto';

const TOKEN_EXPIRY_MINUTES = 15;

interface MerchantRow {
  id: string;
  display_name: string;
  email: string;
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(request, 'auth:forgot-password', AUTH_LIMIT);
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

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });

    // Look up merchant by email
    const merchants = await query<MerchantRow>(
      `SELECT id, display_name, email FROM merchants WHERE LOWER(email) = $1 AND password_hash IS NOT NULL`,
      [normalizedEmail]
    );

    if (merchants.length === 0) {
      return successResponse;
    }

    const merchant = merchants[0];

    // Invalidate any existing unused tokens for this merchant
    await query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE merchant_id = $1 AND used_at IS NULL`,
      [merchant.id]
    );

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Store token hash — use SQL NOW() + INTERVAL for consistent timezone handling
    await query(
      `INSERT INTO password_reset_tokens (merchant_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${TOKEN_EXPIRY_MINUTES} minutes')`,
      [merchant.id, tokenHash]
    );

    // Build reset link
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/merchant/reset-password?token=${token}&id=${merchant.id}`;

    // Send email (fire-and-forget — don't block the response)
    const emailContent = passwordResetEmail(resetLink, merchant.display_name);
    sendEmail({
      to: merchant.email,
      ...emailContent,
    }).catch(err => console.error('[forgot-password] Email send failed:', err));

    return successResponse;
  } catch (error) {
    console.error('[forgot-password] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
