/**
 * Rate Limiting Middleware
 *
 * Protects API endpoints from abuse with configurable rate limits.
 * Uses in-memory storage (suitable for single-instance deployments).
 * For multi-instance deployments, replace with Redis-based storage.
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Custom identifier function (default: IP-based) */
  getIdentifier?: (request: NextRequest) => string;
  /** Skip rate limiting for certain requests */
  skip?: (request: NextRequest) => boolean;
}

// In-memory store for rate limit tracking
// Key format: `${identifier}:${endpoint}`
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup interval (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Start the cleanup timer to remove expired entries
 */
function startCleanupTimer() {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  // Don't prevent process exit
  cleanupTimer.unref();
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For header (for proxied requests) or falls back to a default
 */
function getDefaultIdentifier(request: NextRequest): string {
  // Try X-Forwarded-For first (for proxied requests)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Try X-Real-IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Try actor identification from query params or headers
  const actorId = request.nextUrl.searchParams.get('user_id') ||
                  request.nextUrl.searchParams.get('merchant_id') ||
                  request.headers.get('x-actor-id');
  if (actorId) {
    return `actor:${actorId}`;
  }

  // Fallback to a generic identifier (in development)
  return 'unknown';
}

/**
 * Create rate limit response with appropriate headers
 */
function createRateLimitResponse(
  resetAt: number,
  maxRequests: number,
  remaining: number
): NextResponse {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);

  return NextResponse.json(
    {
      success: false,
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
      retryAfter,
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, remaining).toString(),
        'X-RateLimit-Reset': Math.ceil(resetAt / 1000).toString(),
        'Retry-After': retryAfter.toString(),
      },
    }
  );
}

/**
 * Add rate limit headers to a response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  maxRequests: number,
  remaining: number,
  resetAt: number
): NextResponse {
  response.headers.set('X-RateLimit-Limit', maxRequests.toString());
  response.headers.set('X-RateLimit-Remaining', Math.max(0, remaining).toString());
  response.headers.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());
  return response;
}

/**
 * Check rate limit for a request
 * Returns null if within limits, or a 429 response if exceeded
 */
export function checkRateLimit(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig
): NextResponse | null {
  // Skip rate limiting entirely in mock mode
  if (process.env.NEXT_PUBLIC_MOCK_MODE === 'true') {
    return null;
  }

  // Start cleanup timer if not already running
  startCleanupTimer();

  // Check if we should skip rate limiting
  if (config.skip?.(request)) {
    return null;
  }

  const { maxRequests, windowSeconds, getIdentifier = getDefaultIdentifier } = config;
  const identifier = getIdentifier(request);
  const key = `${identifier}:${endpoint}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // Get or create entry
  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    // Create new window
    entry = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
    return null;
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > maxRequests) {
    const remaining = 0;
    return createRateLimitResponse(entry.resetAt, maxRequests, remaining);
  }

  return null;
}

/**
 * Rate limit middleware wrapper
 * Use this to wrap API route handlers
 */
export function withRateLimit<T>(
  handler: (request: NextRequest, context?: T) => Promise<NextResponse>,
  endpoint: string,
  config: RateLimitConfig
) {
  return async (request: NextRequest, context?: T): Promise<NextResponse> => {
    const rateLimitResponse = checkRateLimit(request, endpoint, config);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    return handler(request, context);
  };
}

// =====================
// Preset Configurations
// =====================

/** Standard API rate limit: 100 requests per minute */
export const STANDARD_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowSeconds: 60,
};

/** Strict rate limit for sensitive operations: 10 requests per minute */
export const STRICT_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60,
};

/** Auth rate limit: 5 attempts per minute (prevent brute force) */
/** In mock mode, relaxed to 50 attempts per minute for easier testing */
export const AUTH_LIMIT: RateLimitConfig = {
  maxRequests: process.env.NEXT_PUBLIC_MOCK_MODE === 'true' ? 50 : 5,
  windowSeconds: 60,
};

/** Order creation rate limit: 20 per minute */
export const ORDER_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowSeconds: 60,
};

/** Message rate limit: 30 messages per minute */
export const MESSAGE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowSeconds: 60,
};

/** Search/listing rate limit: 60 per minute */
export const SEARCH_LIMIT: RateLimitConfig = {
  maxRequests: 60,
  windowSeconds: 60,
};

/** Webhook rate limit: 200 per minute (higher for automated systems) */
export const WEBHOOK_LIMIT: RateLimitConfig = {
  maxRequests: 200,
  windowSeconds: 60,
};

// =====================
// Utility Functions
// =====================

/**
 * Get current rate limit status for an identifier/endpoint
 */
export function getRateLimitStatus(
  identifier: string,
  endpoint: string,
  maxRequests: number
): { remaining: number; resetAt: number | null } {
  const key = `${identifier}:${endpoint}`;
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < Date.now()) {
    return { remaining: maxRequests, resetAt: null };
  }

  return {
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Clear rate limit for a specific identifier/endpoint
 * Useful for admin operations or after successful verification
 */
export function clearRateLimit(identifier: string, endpoint: string): void {
  const key = `${identifier}:${endpoint}`;
  rateLimitStore.delete(key);
}

/**
 * Clear all rate limits (use with caution)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}
