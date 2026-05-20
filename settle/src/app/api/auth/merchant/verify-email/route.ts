/**
 * GET /api/auth/merchant/verify-email?token=xxx&id=xxx
 *
 * Verifies a merchant's email address using the token from the verification
 * email (issued at register or by resend-verification). Single-use:
 * `used_at` is stamped on success so the same link can't be replayed.
 *
 * Returns JSON so the /merchant/verify-email page can render proper
 * success / error / already-verified states (rather than chasing an
 * opaque-redirect — which the previous implementation did and would treat
 * even invalid tokens as success).
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

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

    const tokenRow = await queryOne<{ id: string; merchant_id: string }>(
      `SELECT id, merchant_id FROM email_verification_tokens
        WHERE token_hash = $1
          AND merchant_id = $2
          AND used_at IS NULL
          AND expires_at > NOW()`,
      [tokenHash, merchantId]
    );

    if (!tokenRow) {
      // If the merchant is already verified, treat a stale link as success
      // — the merchant clicked an old email but the underlying state is
      // correct. Avoids showing a scary error after a successful verify.
      const alreadyVerified = await queryOne<{ email_verified: boolean }>(
        `SELECT COALESCE(email_verified, false) AS email_verified
           FROM merchants WHERE id = $1`,
        [merchantId]
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

    await query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenRow.id]
    );

    await query(
      `UPDATE merchants SET email_verified = true WHERE id = $1`,
      [merchantId]
    );

    return NextResponse.json({
      success: true,
      data: { message: 'Your business email has been verified.' },
    });
  } catch (error) {
    console.error('[merchant verify-email] error:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed. Please try again.' },
      { status: 500 }
    );
  }
}
