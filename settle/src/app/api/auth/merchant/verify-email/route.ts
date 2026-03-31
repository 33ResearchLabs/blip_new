/**
 * GET /api/auth/merchant/verify-email?token=xxx&id=xxx
 *
 * Verifies merchant email address using the token from the verification email.
 * Sets email_verified = true on success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    const merchantId = request.nextUrl.searchParams.get('id');

    if (!token || !merchantId) {
      return NextResponse.json(
        { success: false, error: 'Missing token or merchant ID' },
        { status: 400 }
      );
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid token
    const tokenRow = await queryOne<{ id: string; merchant_id: string }>(
      `SELECT id, merchant_id FROM email_verification_tokens
       WHERE token_hash = $1 AND merchant_id = $2 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash, merchantId]
    );

    if (!tokenRow) {
      // Redirect to merchant page with error
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      return NextResponse.redirect(`${appUrl}/merchant?error=invalid_or_expired_token`);
    }

    // Mark token as used
    await query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenRow.id]
    );

    // Set email_verified = true
    await query(
      `UPDATE merchants SET email_verified = true WHERE id = $1`,
      [merchantId]
    );

    console.log('[Verify Email] Merchant email verified:', merchantId);

    // Redirect to login with success message
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}/merchant?verified=true`);
  } catch (error) {
    console.error('[Verify Email] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed' },
      { status: 500 }
    );
  }
}
