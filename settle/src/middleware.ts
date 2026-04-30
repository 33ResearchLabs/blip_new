/**
 * Next.js Middleware — API Security Layer
 *
 * Runs on Edge Runtime for all /api/* routes.
 * Provides: rate limiting, auth enforcement, CSRF protection, security headers.
 *
 * NOTE: Cannot import Node.js modules (crypto, fs, pg) — Edge Runtime only.
 * Cannot import the existing rateLimit.ts or auth.ts (they use Node APIs).
 */

import { NextRequest, NextResponse } from 'next/server';

// =============================================================================
// Rate Limiter (Edge-compatible, in-memory)
// =============================================================================

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateBucket>();
const MAX_STORE_SIZE = 10_000;

// Periodic eviction — runs lazily on each request, not on a timer
// (Edge Runtime doesn't guarantee setInterval persistence across invocations)
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 30_000;

function cleanupIfNeeded() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, bucket] of rateLimitStore) {
    if (bucket.resetAt < now) rateLimitStore.delete(key);
  }
  // Hard cap eviction
  if (rateLimitStore.size > MAX_STORE_SIZE) {
    const excess = rateLimitStore.size - MAX_STORE_SIZE;
    const iter = rateLimitStore.keys();
    for (let i = 0; i < excess; i++) {
      const k = iter.next().value;
      if (k) rateLimitStore.delete(k);
    }
  }
}

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * Returns a 429 response if rate limit exceeded, otherwise null.
 */
function checkRate(ip: string, bucket: string, maxReqs: number, windowSec: number): NextResponse | null {
  cleanupIfNeeded();

  const key = `${ip}:${bucket}`;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  let entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + windowMs };
    rateLimitStore.set(key, entry);
    return null;
  }

  entry.count++;

  if (entry.count > maxReqs) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      {
        success: false,
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
        retryAfter,
      },
      {
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': maxReqs.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil(entry.resetAt / 1000).toString(),
        },
      }
    );
  }

  return null;
}

// =============================================================================
// Route Classification
// =============================================================================

const PUBLIC_EXACT = new Set([
  '/api/health',
  '/api/convert',
  '/api/pusher/auth',
  '/api/dev-unlock',
  // 2FA login challenge — caller has a one-time pendingToken in body, NOT a session yet
  '/api/2fa/verify-login',
  // Error-tracking ingest — often called from anonymous/pre-auth pages
  // (login crashes, public pages). Route itself is feature-gated, rate-limited
  // and body-capped; safe to accept without a session.
  '/api/client-errors',
  // Manual issue-reporter ingest — same pattern as /api/client-errors.
  // Users on login/public pages should still be able to file bug reports
  // without first authenticating. The endpoint itself is feature-gated
  // (ENABLE_ISSUE_REPORTING), STRICT rate-limited (10/min), and body-capped
  // (30MB for screenshot + attachments). Safe to accept without a session.
  '/api/issues/create',
  // CSP violation reports — sent automatically by the browser when a script/style
  // is blocked. Must be reachable anonymously and from any page (incl. login).
  // The route itself caps the body, returns 204, and never reflects content.
  '/api/csp-report',
  // Sentry tunnel route — created automatically by withSentryConfig to
  // bypass ad-blockers. Must be reachable anonymously or Sentry beacons fail.
  '/monitoring',
]);

function isPublicRoute(pathname: string, method: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  // GET-only public routes
  if (method === 'GET') {
    if (pathname === '/api/offers' || pathname.startsWith('/api/offers/')) return true;
    if (pathname.startsWith('/api/marketplace/')) return true;
    if (pathname === '/api/reputation') return true;
  }
  return false;
}

function isAdminRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/api/admin/') ||
    pathname.startsWith('/api/setup/') ||
    pathname.startsWith('/api/test/')
  );
}

// =============================================================================
// Auth Helpers
// =============================================================================

function hasActorIdentity(request: NextRequest): boolean {
  // Headers
  if (request.headers.get('x-user-id')) return true;
  if (request.headers.get('x-merchant-id')) return true;
  if (request.headers.get('x-compliance-id')) return true;

  // Query params (existing pattern used by frontend)
  const sp = request.nextUrl.searchParams;
  if (sp.get('user_id')) return true;
  if (sp.get('merchant_id')) return true;
  if (sp.get('compliance_id')) return true;

  return false;
}

function hasBearerToken(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  return !!auth && auth.startsWith('Bearer ');
}

// =============================================================================
// CSRF Protection
// =============================================================================

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfCheck(request: NextRequest): NextResponse | null {
  if (!STATE_CHANGING_METHODS.has(request.method)) return null;

  // Skip if api-key present (server-to-server)
  if (request.headers.get('x-api-key')) return null;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  if (!host) return null; // Can't verify without host

  // At least one of origin/referer must be present and match
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return null;
    } catch {
      // bad URL, fall through
    }
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost === host) return null;
    } catch {
      // bad URL, fall through
    }
  }

  // Block state-changing requests with no origin AND no referer — prevents CSRF via curl/forms
  if (!origin && !referer) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed — missing Origin header' },
      { status: 403 }
    );
  }

  // Origin/Referer present but didn't match host → block
  return NextResponse.json(
    { success: false, error: 'CSRF validation failed' },
    { status: 403 }
  );
}

// =============================================================================
// Security Headers
// =============================================================================

const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  // Reporting API v2 endpoint, paired with `report-to` directive in CSP below.
  'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
};

/**
 * Generate a base64-encoded 128-bit nonce using Web Crypto (Edge-compatible).
 * 128 bits is the CSP3 recommended minimum; 16 random bytes → 24-char base64.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  // btoa is available in the Edge runtime
  return btoa(str);
}

/**
 * Build the Content-Security-Policy string.
 *
 * script-src is nonce-only: 'unsafe-inline' is REMOVED. Any inline script must
 * carry the per-request nonce or the browser will block it. style-src keeps
 * 'unsafe-inline' on purpose — Tailwind/styled-jsx emit inline style attributes
 * that React doesn't currently nonce; locking that down is a separate task.
 *
 * `report-uri` covers older browsers; `report-to csp-endpoint` is the modern
 * Reporting API v2 mechanism (matches the `Reporting-Endpoints` header).
 */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self' data:",
    "connect-src 'self' wss: https://*.helius-rpc.com https://*.pusher.com https://api.cloudinary.com",
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ].join('; ');
}

function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  return response;
}

// =============================================================================
// Middleware Entry Point
// =============================================================================

const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  const ip = getClientIP(request);

  // ── Skip static assets (catch-all matcher can't exclude them) ─────────
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next();
  }

  // ── Per-request CSP nonce ─────────────────────────────────────────────
  // Generated once per request; threaded through every response that flows
  // out of this middleware. Forwarded to downstream server components via
  // the `x-nonce` request header so RootLayout can stamp it onto inline
  // <script> tags. Next.js also reads this header to nonce its own scripts.
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // ── 0. Development Access Lock ────────────────────────────────────────
  // When DEV_ACCESS_PASSWORD is set, gate ALL routes behind a shared password.
  // Opt-in: if the env var is empty/missing, this layer is completely skipped.
  // Note: DEV_LOCK_ENABLED is a non-secret flag exposed via next.config.ts env{}
  // because Edge Runtime (Turbopack) can't read raw process.env vars at runtime.
  const devLockEnabled = process.env.DEV_LOCK_ENABLED === 'true';
  if (devLockEnabled) {
    const isDevExempt =
      pathname === '/dev-lock' ||
      pathname === '/api/dev-unlock' ||
      // Error-tracking ingest must be reachable without the dev cookie so
      // client-side errors (often happening on pages that never hit dev-lock,
      // like login pages or pre-auth screens) can still be captured. The
      // endpoint itself is feature-flagged, rate-limited, and body-capped.
      pathname === '/api/client-errors' ||
      // Sentry tunnel route — used to bypass ad-blockers; must be anonymous.
      pathname === '/monitoring' ||
      pathname.startsWith('/monitoring/');

    if (!isDevExempt) {
      const devCookie = request.cookies.get('dev_access_granted');
      if (!devCookie || devCookie.value !== 'true') {
        // API routes get a 401; page routes redirect to /dev-lock
        if (pathname.startsWith('/api/')) {
          return applySecurityHeaders(
            NextResponse.json(
              { success: false, error: 'Dev access required' },
              { status: 401 }
            ),
            nonce
          );
        }
        const url = request.nextUrl.clone();
        url.pathname = '/dev-lock';
        return NextResponse.redirect(url);
      }
    }
  }

  // Non-API routes — apply CSP + forward nonce to server components.
  // (Previously short-circuited without security headers, so pages got NO CSP.
  //  That's the very surface XSS lives on — it must carry the strict CSP.)
  if (!pathname.startsWith('/api/')) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return applySecurityHeaders(response, nonce);
  }

  // ── 1. Rate Limiting ──────────────────────────────────────────────────
  if (!isMockMode) {
    let rateLimitResult: NextResponse | null = null;

    if (pathname.startsWith('/api/auth/')) {
      rateLimitResult = checkRate(ip, 'auth', 10, 60);
    } else if (
      method === 'POST' &&
      (pathname === '/api/orders' || pathname === '/api/merchant/orders')
    ) {
      rateLimitResult = checkRate(ip, 'order-mutation', 30, 60);
    } else if (pathname.startsWith('/api/admin/')) {
      // Admin routes are HMAC-authenticated (requireAdminAuth) and used by
      // real human operators hitting dashboards that poll every ~10s. The
      // 100/min standard bucket is easy to exhaust with 3–4 admin tabs open.
      // Give them a much higher ceiling per IP — abuse is already blocked
      // by the HMAC auth requirement.
      rateLimitResult = checkRate(ip, 'admin', 1000, 60);
    } else {
      rateLimitResult = checkRate(ip, 'standard', 100, 60);
    }

    if (rateLimitResult) {
      return applySecurityHeaders(rateLimitResult, nonce);
    }
  }

  // ── 1b. Body size guard (100KB max for non-upload routes) ────────────
  // /api/client-errors carries an optional base64 JPEG screenshot from the
  // ErrorBoundary — those reports can hit ~200KB legitimately. The endpoint
  // itself enforces its own 256KB cap before processing.
  // /api/issues/create carries a full-page annotated screenshot PLUS up to
  // 5 file attachments (25MB each per spec). The route enforces its own
  // 30MB cap internally.
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  const isLargeBodyRoute =
    pathname.startsWith('/api/upload') ||
    pathname === '/api/client-errors' ||
    pathname === '/api/issues/create';
  if (contentLength > 100_000 && !isLargeBodyRoute) {
    return applySecurityHeaders(NextResponse.json(
      { success: false, error: 'Request body too large' },
      { status: 413 }
    ), nonce);
  }

  // ── 2. CSRF Protection ────────────────────────────────────────────────
  if (!isMockMode) {
    const csrfResult = csrfCheck(request);
    if (csrfResult) {
      return applySecurityHeaders(csrfResult, nonce);
    }
  }

  // ── 3. Auth Enforcement ───────────────────────────────────────────────

  // Public routes — pass through
  if (isPublicRoute(pathname, method)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return applySecurityHeaders(response, nonce);
  }

  // Hard-block test/seed routes in production regardless of auth
  if (process.env.NODE_ENV === 'production' && (pathname.startsWith('/api/test/') || pathname.startsWith('/api/setup/'))) {
    return applySecurityHeaders(NextResponse.json(
      { success: false, error: 'Not found' },
      { status: 404 }
    ), nonce);
  }

  // Admin routes — need Bearer token
  if (isAdminRoute(pathname)) {
    if (!hasBearerToken(request)) {
      const res = NextResponse.json(
        { success: false, error: 'Admin authentication required' },
        { status: 401 }
      );
      return applySecurityHeaders(res, nonce);
    }
    // Token validity is checked by the route handler (needs Node crypto)
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return applySecurityHeaders(response, nonce);
  }

  // Protected routes — need actor identity
  if (!hasActorIdentity(request)) {
    // Also accept Bearer token as valid identity (some routes use it)
    if (!hasBearerToken(request)) {
      const res = NextResponse.json(
        {
          success: false,
          error: 'Authentication required. Provide user_id, merchant_id, or compliance_id.',
        },
        { status: 401 }
      );
      return applySecurityHeaders(res, nonce);
    }
  }

  // ── 4. Pass Through with Security Headers ─────────────────────────────
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, nonce);
}

// =============================================================================
// Matcher — only run on API routes
// =============================================================================

// No matcher — middleware runs on every request.
// Static assets are skipped early in the function body.
// This avoids Turbopack issues with complex regex matchers.
