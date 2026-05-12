/**
 * POST   /api/auth/ops/unlock — exchange the shared ADMIN_SECRET for an
 *                              httpOnly `blip_ops_session` cookie that
 *                              proves "this caller knew the secret" for
 *                              the next 8 hours.
 * DELETE /api/auth/ops/unlock — clear the cookie (lock the ops session).
 *
 * Why this endpoint exists:
 *   The `/ops` debug page is localhost-only (production renders 404).
 *   It used to keep the operator-typed secret in `sessionStorage` and
 *   replay it as `x-admin-secret` on every API call. That made the
 *   secret readable from any same-origin script, browser extension, or
 *   open DevTools. The migration here moves the secret to an httpOnly
 *   cookie carrying an HMAC token — the raw secret crosses the wire
 *   exactly once (on this POST) and never reaches JS-accessible storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import {
  OPS_COOKIE_NAME,
  OPS_TOKEN_TTL_SECONDS,
  generateOpsToken,
  opsCookieOptions,
} from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Same auth limiter the rest of /api/auth uses — 5 / min / IP.
  const rl = await checkRateLimit(request, 'auth:ops-unlock', AUTH_LIMIT);
  if (rl) return rl;

  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json(
      { success: false, error: 'Ops auth not configured — set ADMIN_SECRET env var' },
      { status: 500 }
    );
  }

  let body: { secret?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const provided = typeof body.secret === 'string' ? body.secret : '';
  if (!provided) {
    return NextResponse.json(
      { success: false, error: 'secret is required' },
      { status: 400 }
    );
  }

  // Timing-safe compare. Length-prefix avoids early-return on length
  // mismatch leaking secret length to the caller.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'Invalid secret' },
      { status: 401 }
    );
  }

  const token = generateOpsToken();
  const response = NextResponse.json({ success: true });
  response.cookies.set(OPS_COOKIE_NAME, token, opsCookieOptions(OPS_TOKEN_TTL_SECONDS));
  return response;
}

/** Clear the ops session cookie. Idempotent — always returns 200. */
export async function DELETE(_request: NextRequest) {
  const response = NextResponse.json({ success: true });
  // Max-Age=0 with matching attributes is the explicit delete contract.
  response.cookies.set(OPS_COOKIE_NAME, '', opsCookieOptions(0));
  return response;
}
