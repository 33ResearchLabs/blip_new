/**
 * Debug Authentication Helper
 *
 * Provides dev-only authentication for debug endpoints.
 * IMPORTANT: These endpoints must NEVER be accessible in production.
 */

import { NextRequest } from 'next/server';

/**
 * Check if debug access is allowed
 *
 * Requirements:
 * 1. NODE_ENV must not be 'production'
 * 2. DEV_DEBUG_KEY must match (from env or query/header)
 *
 * @returns true if access is allowed, false otherwise
 */
export function isDebugAccessAllowed(request?: NextRequest): boolean {
  // CRITICAL: Block in production
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // If no request provided (for server components), just check env
  if (!request) {
    return true;
  }

  // Get expected key from environment
  const expectedKey = process.env.DEV_DEBUG_KEY;

  // If no key configured, deny access in staging/dev
  if (!expectedKey) {
    return false;
  }

  // Check query parameter
  const queryKey = request.nextUrl.searchParams.get('debug_key');
  if (queryKey === expectedKey) {
    return true;
  }

  // Check header
  const headerKey = request.headers.get('x-debug-key');
  if (headerKey === expectedKey) {
    return true;
  }

  return false;
}

/**
 * Validate debug access or return 404
 *
 * Returns null if access is allowed, or a 404 Response if denied.
 * Using 404 instead of 401/403 to not reveal the endpoint exists.
 */
export function validateDebugAccess(request?: NextRequest): Response | null {
  if (!isDebugAccessAllowed(request)) {
    return new Response('Not Found', { status: 404 });
  }
  return null;
}

/**
 * Get debug key from environment (for constructing URLs)
 */
export function getDebugKey(): string | undefined {
  return process.env.DEV_DEBUG_KEY;
}

/**
 * Check if we're in a non-production environment
 */
export function isDevEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production';
}
