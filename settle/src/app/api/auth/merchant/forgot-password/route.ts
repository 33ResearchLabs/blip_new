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
  const rl = await checkRateLimit(request, 'auth:forgot-password', AUTH_LIMIT);
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
    // Diagnostic-only hash — see user/forgot-password/route.ts for rationale.
    const emailLogHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 12);

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });

    // Lookup BOTH password-bearing AND alt-auth merchants so we can log
    // WHICH case we hit. Anti-enumeration preserved — response shape is
    // identical in all branches; only the server log differs.
    const allMerchants = await query<MerchantRow & { password_hash: string | null; google_sub: string | null }>(
      `SELECT id, display_name, email, password_hash, google_sub FROM merchants WHERE LOWER(email) = $1`,
      [normalizedEmail]
    );

    if (allMerchants.length === 0) {

      return successResponse;
    }

    const candidate = allMerchants[0];
    // Skip wallet-only merchants (no password, no Google) — they truly
    // have nothing to reset. Google-signed-up merchants with NULL
    // password_hash legitimately use this flow to set their FIRST
    // password so they can sign in via email/password too; the existing
    // reset-password endpoint already handles writing the first hash.
    if (!candidate.password_hash && !candidate.google_sub) {

      return successResponse;
    }

    const merchant = candidate;

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
