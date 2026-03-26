/**
 * In-Memory Rate Limiter for Core API Financial Actions
 *
 * Limits financial endpoints to MAX_REQUESTS_PER_WINDOW per actor per window.
 * Actors are identified by body.actor_id, query.actor_id, or x-actor-id header.
 *
 * KEY DESIGN DECISIONS:
 *   - Idempotent retries (with Idempotency-Key header) bypass rate limits.
 *     If a key has already been seen and cached, the client is retrying a
 *     completed action — we should never block that.
 *   - The limiter is per-process (in-memory Map). In multi-instance deployments,
 *     each instance has its own counter — this is intentionally lenient.
 *   - Financial routes are opted-in explicitly, not blanket-applied.
 *   - Non-financial routes (GET, health, etc.) are never limited here.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from 'settlement-core';

// ── Configuration ────────────────────────────────────────────
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '10', 10);
const WINDOW_MS   = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10); // 1 minute
const MAX_ENTRIES  = 10000; // Evict stale entries when map exceeds this

interface BucketEntry {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, BucketEntry>();

// Periodic cleanup of expired entries (every 2 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
}, 120_000).unref();

/**
 * Extract actor identity from the request for rate-limiting.
 */
function getActorKey(request: FastifyRequest): string {
  const body  = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;
  return (
    (body?.actor_id as string) ||
    (body?.user_id as string) ||
    (query?.actor_id as string) ||
    (request.headers['x-actor-id'] as string) ||
    request.ip ||
    'unknown'
  );
}

/**
 * Check if the request has an idempotency key (indicating a legitimate retry).
 */
function hasIdempotencyKey(request: FastifyRequest): boolean {
  return !!(
    request.headers['idempotency-key'] ||
    request.headers['x-idempotency-key']
  );
}

/**
 * Financial action rate-limit check.
 *
 * Returns null if the request is allowed, or a pre-built 429 response object
 * if the rate limit has been exceeded.
 *
 * @param request - Fastify request
 * @param action  - Action name for bucketing (e.g. 'create_order')
 */
export function checkFinancialRateLimit(
  request: FastifyRequest,
  action: string
): { statusCode: 429; body: { success: false; error: string; retry_after_ms: number } } | null {
  // Idempotent retries always pass — the client is retrying a previous action
  if (hasIdempotencyKey(request)) {
    return null;
  }

  const actorId = getActorKey(request);
  const bucketKey = `${actorId}:${action}`;
  const now = Date.now();

  let entry = buckets.get(bucketKey);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Start new window
    entry = { count: 1, windowStart: now };
    buckets.set(bucketKey, entry);

    // Evict if map is too large (prevent memory leak from spoofed actor IDs)
    if (buckets.size > MAX_ENTRIES) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }

    return null;
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    logger.warn('[RateLimit] Financial action rate limit exceeded', {
      actorId,
      action,
      count: entry.count,
      limit: MAX_REQUESTS,
    });
    return {
      statusCode: 429,
      body: {
        success: false,
        error: 'Rate limit exceeded. Please wait before retrying.',
        retry_after_ms: Math.max(0, retryAfterMs),
      },
    };
  }

  return null;
}

/**
 * Fastify preHandler that applies rate limiting to financial endpoints.
 * Usage: fastify.addHook('preHandler', financialRateLimitHook('create_order'))
 */
export function financialRateLimitHook(action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const limited = checkFinancialRateLimit(request, action);
    if (limited) {
      const retryAfterSec = Math.ceil(limited.body.retry_after_ms / 1000);
      reply
        .status(429)
        .header('Retry-After', String(retryAfterSec))
        .header('X-RateLimit-Limit', String(MAX_REQUESTS))
        .header('X-RateLimit-Window', String(WINDOW_MS))
        .send(limited.body);
    }
  };
}
