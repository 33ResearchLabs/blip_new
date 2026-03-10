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

const PUBLIC_EXACT = new Set(['/api/health', '/api/convert', '/api/pusher/auth']);

function isPublicRoute(pathname: string, method: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  // GET-only public routes
  if (method === 'GET') {
    if (pathname === '/api/offers' || pathname.startsWith('/api/offers/')) return true;
    if (pathname.startsWith('/api/marketplace/')) return true;
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

  // If neither origin nor referer was present, allow (some clients don't send them)
  if (!origin && !referer) return null;

  // Origin/Referer present but didn't match host → block
  return NextResponse.json(
    { success: false, error: 'CSRF validation failed' },
    { status: 403 }
  );
}

// =============================================================================
// Security Headers
// =============================================================================

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com; font-src 'self' data:; connect-src 'self' wss: https://devnet.helius-rpc.com https://*.pusher.com https://api.cloudinary.com; frame-ancestors 'none';",
};

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
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
    } else {
      rateLimitResult = checkRate(ip, 'standard', 100, 60);
    }

    if (rateLimitResult) {
      return applySecurityHeaders(rateLimitResult);
    }
  }

  // ── 2. CSRF Protection ────────────────────────────────────────────────
  if (!isMockMode) {
    const csrfResult = csrfCheck(request);
    if (csrfResult) {
      return applySecurityHeaders(csrfResult);
    }
  }

  // ── 3. Auth Enforcement ───────────────────────────────────────────────

  // Public routes — pass through
  if (isPublicRoute(pathname, method)) {
    const response = NextResponse.next();
    return applySecurityHeaders(response);
  }

  // Admin routes — need Bearer token
  if (isAdminRoute(pathname)) {
    if (!hasBearerToken(request)) {
      const res = NextResponse.json(
        { success: false, error: 'Admin authentication required' },
        { status: 401 }
      );
      return applySecurityHeaders(res);
    }
    // Token validity is checked by the route handler (needs Node crypto)
    const response = NextResponse.next();
    return applySecurityHeaders(response);
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
      return applySecurityHeaders(res);
    }
  }

  // ── 4. Pass Through with Security Headers ─────────────────────────────
  const response = NextResponse.next();
  return applySecurityHeaders(response);
}

// =============================================================================
// Matcher — only run on API routes
// =============================================================================

export const config = {
  matcher: '/api/:path*',
};
