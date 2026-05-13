/**
 * GET /api/auth/merchant/verification-status?merchantId=<uuid>
 *
 * Lightweight poll-only endpoint used by the post-signup "check your inbox"
 * panel. The panel sits on the merchant signup tab; the verification link
 * was sent to the user's email and is typically clicked in a different tab.
 * The original tab calls this endpoint on a short interval so it can
 * auto-advance to the sign-in form as soon as the backend flips
 * email_verified = true.
 *
 * Returns only { verified: boolean } — never reveals the merchant's email,
 * username, or whether the record exists at all (unknown IDs respond the
 * same as unverified known IDs). Merchant IDs are UUIDs, so enumeration is
 * already impractical, but we additionally rate-limit on SEARCH_LIMIT to
 * cap the cost of any abusive polling.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { checkRateLimit, SEARCH_LIMIT } from '@/lib/middleware/rateLimit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:merchant:verification-status', SEARCH_LIMIT);
  if (rl) return rl;

  const merchantId = request.nextUrl.searchParams.get('merchantId');

  // Reject obviously malformed IDs before touching the DB. We do NOT
  // return a different shape than the not-found path — the caller learns
  // only "valid request, not verified yet".
  if (!merchantId || !UUID_REGEX.test(merchantId)) {
    return NextResponse.json({ success: true, verified: false });
  }

  try {
    const row = await queryOne<{ email_verified: boolean }>(
      `SELECT COALESCE(email_verified, false) AS email_verified
       FROM merchants
       WHERE id = $1`,
      [merchantId],
    );

    // Same response shape whether the merchant exists or not — no
    // existence signal leaks.
    return NextResponse.json({
      success: true,
      verified: !!row?.email_verified,
    });
  } catch (error) {
    console.error('[verification-status] DB error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check verification status' },
      { status: 500 },
    );
  }
}
