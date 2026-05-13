/**
 * GET /api/auth/user/verification-status?userId=<uuid>
 *
 * Lightweight poll-only endpoint used by the post-signup "check your inbox"
 * panel on the user-side LandingPage. The panel sits on the registration
 * tab; the verification link was sent to the user's email and is typically
 * clicked in a different tab — or on a different device entirely. The
 * original tab calls this endpoint on a short interval so it can
 * auto-advance to the sign-in form as soon as the backend flips
 * email_verified = true.
 *
 * Returns only { verified: boolean } — never reveals the user's email,
 * username, or whether the record exists at all (unknown IDs respond the
 * same as unverified known IDs). User IDs are UUIDs, so enumeration is
 * already impractical, but we additionally rate-limit on SEARCH_LIMIT to
 * cap the cost of any abusive polling.
 *
 * Mirrors the merchant-side endpoint at
 * /api/auth/merchant/verification-status — keep them in sync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { checkRateLimit, SEARCH_LIMIT } from '@/lib/middleware/rateLimit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:user:verification-status', SEARCH_LIMIT);
  if (rl) return rl;

  const userId = request.nextUrl.searchParams.get('userId');

  // Reject obviously malformed IDs before touching the DB. We do NOT
  // return a different shape than the not-found path — the caller learns
  // only "valid request, not verified yet".
  if (!userId || !UUID_REGEX.test(userId)) {
    return NextResponse.json({ success: true, verified: false });
  }

  try {
    const row = await queryOne<{ email_verified: boolean }>(
      `SELECT COALESCE(email_verified, false) AS email_verified
       FROM users
       WHERE id = $1`,
      [userId],
    );

    // Same response shape whether the user exists or not — no existence
    // signal leaks.
    return NextResponse.json({
      success: true,
      verified: !!row?.email_verified,
    });
  } catch (error) {
    console.error('[user verification-status] DB error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check verification status' },
      { status: 500 },
    );
  }
}
