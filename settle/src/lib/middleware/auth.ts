/**
 * Authorization Middleware
 *
 * Helpers for verifying identity and access rights in API routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getOrderById } from '../db/repositories/orders';
import { getUserById } from '../db/repositories/users';
import { getMerchantById } from '../db/repositories/merchants';
import { verifySessionToken } from '../auth/sessionToken';

// Admin auth secret - MUST be configured via environment variable
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Generate a signed admin token (HMAC-based, stateless)
 * Token format: base64(username:timestamp:hmac_signature)
 * Valid for 24 hours.
 */
export function generateAdminToken(username: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${username}:${ts}`;
  const sig = createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

/**
 * Verify a signed admin token
 */
export function verifyAdminToken(token: string): { valid: boolean; username?: string } {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');
    if (parts.length !== 3) return { valid: false };

    const [username, tsStr, sig] = parts;
    const ts = parseInt(tsStr);
    if (isNaN(ts)) return { valid: false };

    // Token expires after 24 hours
    if (Math.floor(Date.now() / 1000) - ts > 86400) return { valid: false };

    const expected = createHmac('sha256', ADMIN_SECRET).update(`${username}:${tsStr}`).digest('hex');
    if (sig.length !== expected.length) return { valid: false };

    if (timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return { valid: true, username };
    }
  } catch {
    // Invalid token format
  }
  return { valid: false };
}

/**
 * Require admin authentication on a route.
 * Returns null if auth passes, or a 401 response if it fails.
 *
 * Usage: const authErr = requireAdminAuth(request); if (authErr) return authErr;
 */
export function requireAdminAuth(request: NextRequest): NextResponse | null {
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { success: false, error: 'Admin auth not configured — set ADMIN_SECRET env var' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }

  const result = verifyAdminToken(authHeader.slice(7));
  if (!result.valid) {
    return NextResponse.json(
      { success: false, error: 'Invalid or expired admin token' },
      { status: 401 }
    );
  }

  return null;
}

export interface AuthContext {
  userId?: string;
  merchantId?: string;
  complianceId?: string;
  actorType: 'user' | 'merchant' | 'system' | 'compliance';
  actorId: string;
}

// Production mode: token is the ONLY trusted identity source
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Extract actor context from request.
 *
 * PRODUCTION:
 *   - Token (Authorization: Bearer) is the ONLY trusted identity source
 *   - Supplementary headers (x-merchant-id, x-user-id) are read AFTER
 *     token validation for actor-matching context only — never for identity
 *   - No token → returns null (request will be rejected)
 *
 * DEVELOPMENT:
 *   - Token preferred, but header fallback allowed for easier testing
 *   - Fallback usage is logged as a warning
 */
export function getAuthContext(request: NextRequest): AuthContext | null {
  // ── Token-based auth (trusted, cryptographically verified) ──
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const tokenPayload = verifySessionToken(authHeader.slice(7));
    if (tokenPayload) {
      const ctx: AuthContext = {
        actorType: tokenPayload.actorType,
        actorId: tokenPayload.actorId,
      };
      if (tokenPayload.actorType === 'user') ctx.userId = tokenPayload.actorId;
      if (tokenPayload.actorType === 'merchant') ctx.merchantId = tokenPayload.actorId;
      if (tokenPayload.actorType === 'compliance') ctx.complianceId = tokenPayload.actorId;

      // Supplementary headers for dual-login context (NOT identity trust).
      // Only accept supplementary IDs that match the token's actor type:
      //   - Merchant token → can populate userId from header (dual-login)
      //   - User token → can populate merchantId ONLY if token is merchant type
      // This prevents a user from injecting x-merchant-id to access merchant orders.
      const headerMerchantId = request.headers.get('x-merchant-id');
      const headerUserId = request.headers.get('x-user-id');
      if (headerMerchantId && !ctx.merchantId && tokenPayload.actorType === 'merchant') {
        ctx.merchantId = headerMerchantId;
      }
      if (headerUserId && !ctx.userId) ctx.userId = headerUserId;

      return ctx;
    }
    // Token present but invalid — in production, do NOT fall through to headers
    if (IS_PRODUCTION) return null;
  }

  // ── No valid token ──
  // In production: reject — token is required
  if (IS_PRODUCTION) {
    return null;
  }

  // ── Development-only: header fallback for testing ──
  console.warn('[AUTH] Dev-mode header fallback used — would be rejected in production', {
    route: request.nextUrl.pathname,
  });

  const headerUserId = request.headers.get('x-user-id');
  const headerMerchantId = request.headers.get('x-merchant-id');
  const headerComplianceId = request.headers.get('x-compliance-id');
  const isMerchantRoute = request.nextUrl.pathname.includes('/merchant');

  const isComplianceRoute = request.nextUrl.pathname.includes('/compliance');
  const isOrderRoute = request.nextUrl.pathname.includes('/orders/') && (
    request.nextUrl.pathname.includes('/messages') || request.nextUrl.pathname.includes('/dispute')
  );
  if (headerComplianceId && (isComplianceRoute || isOrderRoute) && !headerMerchantId) {
    return { actorType: 'compliance', actorId: headerComplianceId, complianceId: headerComplianceId };
  }
  if (headerComplianceId && headerMerchantId && (isComplianceRoute || isOrderRoute)) {
    return { actorType: 'compliance', actorId: headerComplianceId, complianceId: headerComplianceId, merchantId: headerMerchantId };
  }
  if (headerMerchantId && headerUserId) {
    if (isMerchantRoute) {
      return { actorType: 'merchant', actorId: headerMerchantId, merchantId: headerMerchantId, userId: headerUserId };
    }
    return { actorType: 'user', actorId: headerUserId, userId: headerUserId, merchantId: headerMerchantId };
  }
  if (headerMerchantId) {
    return { actorType: 'merchant', actorId: headerMerchantId, merchantId: headerMerchantId };
  }
  if (headerUserId) {
    return { actorType: 'user', actorId: headerUserId, userId: headerUserId };
  }

  return null;
}

// ── Verified auth context with DB lookup + cache ──────────────────────

interface CacheEntry {
  exists: boolean;
  ts: number;
}

const VERIFY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const verifyCache = new Map<string, CacheEntry>();

function getCached(key: string): boolean | null {
  const entry = verifyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > VERIFY_CACHE_TTL_MS) {
    verifyCache.delete(key);
    return null;
  }
  return entry.exists;
}

function setCache(key: string, exists: boolean): void {
  // Evict stale entries periodically (keep map bounded)
  if (verifyCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of verifyCache) {
      if (now - v.ts > VERIFY_CACHE_TTL_MS) verifyCache.delete(k);
    }
  }
  verifyCache.set(key, { exists, ts: Date.now() });
}

async function actorExistsInDb(auth: AuthContext): Promise<boolean> {
  const cacheKey = `${auth.actorType}:${auth.actorId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  let exists = false;
  if (auth.actorType === 'user' && auth.userId) {
    exists = await verifyUser(auth.userId);
    // If user ID is stale but merchant ID is valid, flip to merchant context
    if (!exists && auth.merchantId) {
      const merchantExists = await verifyMerchant(auth.merchantId);
      if (merchantExists) {
        auth.actorType = 'merchant';
        auth.actorId = auth.merchantId;
        exists = true;
      }
    }
  } else if (auth.actorType === 'merchant' && auth.merchantId) {
    exists = await verifyMerchant(auth.merchantId);
  } else if (auth.actorType === 'system') {
    // System actors are always valid (internal calls)
    exists = true;
  } else if (auth.actorType === 'compliance' && auth.complianceId) {
    // Compliance officers are in compliance_team table
    exists = await verifyComplianceMember(auth.complianceId);
    // Fallback: merchant with compliance access may have their merchant ID
    // stored as compliance_member — verify as merchant instead
    if (!exists && auth.merchantId) {
      const merchantExists = await verifyMerchant(auth.merchantId);
      if (merchantExists) {
        exists = true;
      }
    }
  }

  setCache(cacheKey, exists);
  return exists;
}

/**
 * Like getAuthContext() but also confirms the actor exists in the DB.
 * Returns null if extraction fails OR the actor doesn't exist.
 */
export async function getVerifiedAuthContext(
  request: NextRequest,
): Promise<AuthContext | null> {
  const auth = getAuthContext(request);
  if (!auth) return null;

  const exists = await actorExistsInDb(auth);
  if (!exists) return null;

  // Phase 2 migration metrics: track token vs header auth usage
  const usedToken = request.headers.get('authorization')?.startsWith('Bearer ');
  if (usedToken) {
    authMigrationMetrics.tokenAuth++;
  } else {
    authMigrationMetrics.headerAuth++;
    // Throttled log — only emit once per actor per 60s to avoid log spam
    const logKey = `${auth.actorType}:${auth.actorId}`;
    const now = Date.now();
    const lastLog = legacyAuthLogTimestamps.get(logKey) || 0;
    if (now - lastLog > 60_000) {
      legacyAuthLogTimestamps.set(logKey, now);
      console.warn('[AUTH_MIGRATION] Legacy header auth used', {
        actorId: auth.actorId,
        actorType: auth.actorType,
        route: request.nextUrl.pathname,
      });
    }
  }

  // Log metrics summary every 500 requests
  const totalRequests = authMigrationMetrics.tokenAuth + authMigrationMetrics.headerAuth;
  if (totalRequests > 0 && totalRequests % 500 === 0) {
    const tokenPct = ((authMigrationMetrics.tokenAuth / totalRequests) * 100).toFixed(1);
    const sensitiveTotal = authMigrationMetrics.sensitiveTokenAuth + authMigrationMetrics.sensitiveHeaderAuth;
    const sensitiveTokenPct = sensitiveTotal > 0
      ? ((authMigrationMetrics.sensitiveTokenAuth / sensitiveTotal) * 100).toFixed(1)
      : 'N/A';
    console.log('[AUTH_MIGRATION] Metrics', {
      totalRequests,
      tokenAuth: authMigrationMetrics.tokenAuth,
      headerAuth: authMigrationMetrics.headerAuth,
      tokenPct: `${tokenPct}%`,
      sensitiveRoutes: {
        total: sensitiveTotal,
        tokenAuth: authMigrationMetrics.sensitiveTokenAuth,
        headerAuth: authMigrationMetrics.sensitiveHeaderAuth,
        tokenPct: `${sensitiveTokenPct}%`,
      },
      enforcement: AUTH_TOKEN_REQUIRED ? 'STRICT' : 'SOFT',
    });
  }

  return auth;
}

// Throttle map for legacy auth migration logs (bounded, auto-evicts)
const legacyAuthLogTimestamps = new Map<string, number>();

// In-memory counters for auth method adoption tracking
const authMigrationMetrics = { tokenAuth: 0, headerAuth: 0, sensitiveTokenAuth: 0, sensitiveHeaderAuth: 0 };

// Phase 3 env flag — when true, sensitive routes REQUIRE a valid token
const AUTH_TOKEN_REQUIRED = process.env.AUTH_TOKEN_REQUIRED === 'true';

/**
 * One-liner auth gate for routes.
 * Returns an AuthContext on success or a 401 NextResponse on failure.
 *
 * Phase 3 behavior:
 *   - If token present → validates and uses it (preferred)
 *   - If token absent → falls back to headers (still works)
 *   - Logs warning when headers are used (soft enforcement)
 *
 * Usage:
 *   const auth = await requireAuth(request);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is AuthContext here
 */
export async function requireAuth(
  request: NextRequest,
): Promise<AuthContext | NextResponse> {
  const auth = await getVerifiedAuthContext(request);
  if (!auth) return unauthorizedResponse('Authentication required');
  return auth;
}

/**
 * Strict auth gate for sensitive routes (financial operations).
 *
 * When AUTH_TOKEN_REQUIRED=true:
 *   - Requires a valid signed session token
 *   - Rejects requests using only legacy headers with 401
 *
 * When AUTH_TOKEN_REQUIRED=false (default):
 *   - Same as requireAuth() but logs louder warnings
 *   - Tracks separate metrics for sensitive route adoption
 *
 * Use this for: payment_sent, completed, cancelled, escrow lock/release
 */
export async function requireTokenAuth(
  request: NextRequest,
): Promise<AuthContext | NextResponse> {
  const auth = await getVerifiedAuthContext(request);
  if (!auth) return unauthorizedResponse('Authentication required');

  const hasValidToken = !!request.headers.get('authorization')?.startsWith('Bearer ');

  if (hasValidToken) {
    authMigrationMetrics.sensitiveTokenAuth++;
  } else {
    authMigrationMetrics.sensitiveHeaderAuth++;

    if (AUTH_TOKEN_REQUIRED) {
      console.error('[AUTH_ENFORCEMENT] Token required but missing on sensitive route', {
        actorId: auth.actorId,
        actorType: auth.actorType,
        route: request.nextUrl.pathname,
      });
      return unauthorizedResponse(
        'Session token required for this action. Please re-login to continue.'
      );
    }

    // Soft enforcement: allow but warn
    console.warn('[AUTH_ENFORCEMENT] Sensitive route using legacy headers — token preferred', {
      actorId: auth.actorId,
      actorType: auth.actorType,
      route: request.nextUrl.pathname,
    });
  }

  return auth;
}

/**
 * Verify that a user exists and is valid
 */
export async function verifyUser(userId: string): Promise<boolean> {
  try {
    const user = await getUserById(userId);
    return user !== null;
  } catch {
    return false;
  }
}

/**
 * Verify that a merchant exists and is active
 */
export async function verifyMerchant(merchantId: string): Promise<boolean> {
  try {
    const merchant = await getMerchantById(merchantId);
    return merchant !== null && merchant.status === 'active';
  } catch {
    return false;
  }
}

/**
 * Verify that a compliance team member exists and is active
 */
async function verifyComplianceMember(complianceId: string): Promise<boolean> {
  try {
    const { queryOne: qOne } = await import('../db');
    const member = await qOne<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM compliance_team WHERE id = $1',
      [complianceId]
    );
    return member !== null && member.is_active !== false;
  } catch (err) {
    // Table may not exist — fail closed for security
    console.error('[AUTH] Compliance verification failed — denying access:', err);
    return false;
  }
}

/**
 * Check if user can access a specific order
 */
export async function canUserAccessOrder(
  userId: string,
  orderId: string
): Promise<boolean> {
  try {
    const order = await getOrderById(orderId);
    if (!order) return false;
    return order.user_id === userId;
  } catch {
    return false;
  }
}

/**
 * Check if merchant can access a specific order
 * Merchants can access orders where they are either the seller (merchant_id) or buyer (buyer_merchant_id for M2M trades)
 * Also allows read-only access to unclaimed escrowed orders (broadcast model)
 */
export async function canMerchantAccessOrder(
  merchantId: string,
  orderId: string
): Promise<boolean> {
  try {
    const order = await getOrderById(orderId);
    if (!order) return false;
    // Allow access if merchant is the seller OR the buyer (M2M trades)
    if (order.merchant_id === merchantId || order.buyer_merchant_id === merchantId) {
      return true;
    }
    // Broadcast model: allow viewing unclaimed escrowed orders
    // (buyer_merchant_id is NULL means no one has claimed it yet)
    if (order.status === 'escrowed' && !order.buyer_merchant_id) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if actor can access order (user, merchant, or compliance)
 */
export async function canAccessOrder(
  auth: AuthContext,
  orderId: string
): Promise<boolean> {
  try {
    const order = await getOrderById(orderId);
    if (!order) return false;

    if (auth.actorType === 'user') {
      if (order.user_id === auth.actorId) return true;
      // When both user and merchant headers are present on a non-merchant route,
      // auth resolves to 'user' — but the caller may be acting as merchant.
      // Check merchantId as fallback to prevent false "access denied".
      if (auth.merchantId) {
        if (order.merchant_id === auth.merchantId || order.buyer_merchant_id === auth.merchantId) {
          return true;
        }
      }
      return false;
    }

    if (auth.actorType === 'merchant') {
      // Allow access if merchant is the seller OR the buyer (M2M trades)
      if (order.merchant_id === auth.actorId || order.buyer_merchant_id === auth.actorId) {
        return true;
      }
      // Broadcast model: allow viewing unclaimed escrowed orders
      if (order.status === 'escrowed' && !order.buyer_merchant_id) {
        return true;
      }
      return false;
    }

    // Compliance can access orders they're assigned to or orders with disputes
    if (auth.actorType === 'compliance') {
      // Check if compliance is directly assigned to the order
      if (order.assigned_compliance_id === auth.actorId) {
        return true;
      }
      // Compliance can access any disputed order
      if (order.status === 'disputed') {
        return true;
      }
      // Fallback: compliance officer may also be a merchant on this order
      if (auth.merchantId && (order.merchant_id === auth.merchantId || order.buyer_merchant_id === auth.merchantId)) {
        return true;
      }
      return false;
    }

    // System can access all
    if (auth.actorType === 'system') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json(
    { success: false, error: message },
    { status: 401 }
  );
}

/**
 * Create forbidden response
 */
export function forbiddenResponse(message = 'Access denied'): NextResponse {
  return NextResponse.json(
    { success: false, error: message },
    { status: 403 }
  );
}

/**
 * Create validation error response
 */
export function validationErrorResponse(errors: string[]): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Validation failed', details: errors },
    { status: 400 }
  );
}

/**
 * Create not found response
 */
export function notFoundResponse(resource = 'Resource'): NextResponse {
  return NextResponse.json(
    { success: false, error: `${resource} not found` },
    { status: 404 }
  );
}

/**
 * Create success response
 */
export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status }
  );
}

/**
 * Create error response
 */
export function errorResponse(message: string, status = 500): NextResponse {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}
