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

/**
 * Extract actor context from request headers or body
 * In production, this would verify JWT/session tokens
 * For now, we trust the actor_type and actor_id from request
 */
export function getAuthContext(request: NextRequest): AuthContext | null {
  // 1. Check headers first (set by middleware, most trusted)
  // Detect merchant context from URL path to resolve correct actor when both headers are present
  const headerUserId = request.headers.get('x-user-id');
  const headerMerchantId = request.headers.get('x-merchant-id');
  const headerComplianceId = request.headers.get('x-compliance-id');
  const isMerchantRoute = request.nextUrl.pathname.includes('/merchant');

  if (headerComplianceId) {
    return { actorType: 'compliance', actorId: headerComplianceId, complianceId: headerComplianceId };
  }
  // If both user and merchant headers exist, disambiguate using route context
  // Also store both IDs so downstream checks can reference either identity
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

  // Body and query param fallbacks removed — actor identity must come from headers only.
  // This prevents actor spoofing via crafted POST bodies.
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
    // Compliance officers are stored as users — verify they exist
    exists = await verifyUser(auth.complianceId);
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
  return exists ? auth : null;
}

/**
 * One-liner auth gate for routes.
 * Returns an AuthContext on success or a 401 NextResponse on failure.
 *
 * Usage:
 *   const auth = await requireAuth(request, body);
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

    // Compliance can access orders they're assigned to or orders with disputes assigned to them
    if (auth.actorType === 'compliance') {
      // Check if compliance is directly assigned to the order
      if (order.assigned_compliance_id === auth.actorId) {
        return true;
      }
      // Check if order has a dispute assigned to this compliance officer
      // Note: getDisputeByOrderId would need to be imported and checked here
      // For now, compliance can access any disputed order
      if (order.status === 'disputed') {
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
