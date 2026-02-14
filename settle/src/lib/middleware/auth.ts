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

// Admin auth secret - MUST be set in production
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-only-admin-secret-change-in-production';

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
export function getAuthContext(request: NextRequest, body?: Record<string, unknown>): AuthContext | null {
  // Try to get from body first (for POST/PATCH requests)
  if (body) {
    const actorType = body.actor_type as string;
    const actorId = body.actor_id as string || body.sender_id as string || body.user_id as string;

    if (actorType && actorId) {
      return {
        actorType: actorType as 'user' | 'merchant' | 'system' | 'compliance',
        actorId,
        userId: actorType === 'user' ? actorId : undefined,
        merchantId: actorType === 'merchant' ? actorId : undefined,
        complianceId: actorType === 'compliance' ? actorId : undefined,
      };
    }
  }

  // Try query params
  const userId = request.nextUrl.searchParams.get('user_id');
  const merchantId = request.nextUrl.searchParams.get('merchant_id');
  const complianceId = request.nextUrl.searchParams.get('compliance_id');

  if (userId) {
    return {
      actorType: 'user',
      actorId: userId,
      userId,
    };
  }

  if (merchantId) {
    return {
      actorType: 'merchant',
      actorId: merchantId,
      merchantId,
    };
  }

  if (complianceId) {
    return {
      actorType: 'compliance',
      actorId: complianceId,
      complianceId,
    };
  }

  return null;
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
 */
export async function canMerchantAccessOrder(
  merchantId: string,
  orderId: string
): Promise<boolean> {
  try {
    const order = await getOrderById(orderId);
    if (!order) return false;
    // Allow access if merchant is the seller OR the buyer (M2M trades)
    return order.merchant_id === merchantId || order.buyer_merchant_id === merchantId;
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
      return order.user_id === auth.actorId;
    }

    if (auth.actorType === 'merchant') {
      // Allow access if merchant is the seller OR the buyer (M2M trades)
      return order.merchant_id === auth.actorId || order.buyer_merchant_id === auth.actorId;
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
