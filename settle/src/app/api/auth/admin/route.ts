import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import {
  generateAdminToken,
  verifyAdminToken,
  ADMIN_COOKIE_NAME,
  ADMIN_TOKEN_TTL_SECONDS,
  adminCookieOptions,
  readAdminTokenFromRequest,
} from '@/lib/middleware/auth';
import { isAdminJtiRevoked } from '@/lib/auth/adminRevocation';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import { auditLog } from '@/lib/auditLog';

// Admin credentials from env vars (no fallbacks — must be configured)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/**
 * POST /api/auth/admin — admin login.
 *
 * On success the response sets a `blip_admin_session` cookie:
 *   httpOnly + Secure (prod) + SameSite=Strict + Path=/ + Max-Age=86400
 *
 * The token is NOT returned in the JSON body any more — it is only
 * issued via Set-Cookie. JS code MUST NOT try to read or store it.
 *
 * Backward-compat note: existing clients pre-migration looked for
 * `data.token` in the response. Returning it would defeat the XSS fix
 * (script could still read it from the response). It is intentionally
 * omitted; clients now derive "is logged in" from the cookie's effect
 * on subsequent /api/auth/admin GET calls.
 */
export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'auth:admin', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { username, password } = await request.json();

    if (!ADMIN_PASSWORD) {
      return NextResponse.json(
        { success: false, error: 'Admin auth not configured — set ADMIN_PASSWORD env var' },
        { status: 500 }
      );
    }

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const usernameMatch = username.length === ADMIN_USERNAME.length &&
      crypto.timingSafeEqual(Buffer.from(username), Buffer.from(ADMIN_USERNAME));
    const passwordMatch = password.length === ADMIN_PASSWORD.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
    if (!usernameMatch || !passwordMatch) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const token = generateAdminToken(username);
    auditLog('admin.login', username, 'admin');

    const response = NextResponse.json({
      success: true,
      data: {
        admin: {
          username: ADMIN_USERNAME,
          role: 'super_admin',
          authenticated_at: new Date().toISOString(),
        },
      },
    });
    response.cookies.set(ADMIN_COOKIE_NAME, token, adminCookieOptions(ADMIN_TOKEN_TTL_SECONDS));
    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/admin — validate the current admin session.
 *
 * Reads the cookie OR a legacy Bearer header (transitional — see
 * readAdminTokenFromRequest). When a valid Bearer token is presented
 * and no cookie exists, we Set-Cookie the same token so the next
 * request migrates to the cookie path automatically. The client is
 * expected to clear localStorage on its end.
 *
 * Body always returns { valid, username? } — the actual token is never
 * leaked to JS.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'auth:admin:check', { maxRequests: 100, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const token = readAdminTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ success: true, data: { valid: false } });
  }

  const result = verifyAdminToken(token);
  if (!result.valid) {
    return NextResponse.json({ success: true, data: { valid: false } });
  }

  // Revocation check for jti'd tokens. Legacy tokens bypass — they age
  // out within 24h and are warned about below.
  if (result.jti) {
    try {
      const revoked = await isAdminJtiRevoked(result.jti);
      if (revoked) {
        // Mirror requireAdminAuth: return valid:false (do NOT include
        // jti or any token-derived data).
        return NextResponse.json({ success: true, data: { valid: false } });
      }
    } catch {
      // Redis unavailable. Fail closed for jti'd tokens — same as
      // requireAdminAuth — to avoid certifying a session we cannot
      // verify is current.
      return NextResponse.json(
        { success: false, error: 'Admin auth temporarily unavailable — try again shortly' },
        { status: 503 }
      );
    }
  }

  // Token validated. If it came in via Bearer (legacy storage) but no
  // cookie was set, migrate by issuing the same token as a cookie. The
  // 24h Max-Age effectively gives the legacy session 24h MORE in cookie
  // form — that's intentional, otherwise we'd cut their session short.
  const response = NextResponse.json({
    success: true,
    data: { valid: true, username: result.username },
  });

  const hasCookie = !!request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!hasCookie) {
    if (result.legacyNoJti) {
      logger.warn('[admin] migrating legacy localStorage Bearer token → httpOnly cookie', {
        username: result.username,
      });
    }
    response.cookies.set(ADMIN_COOKIE_NAME, token, adminCookieOptions(ADMIN_TOKEN_TTL_SECONDS));
  }

  return response;
}
