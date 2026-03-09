/**
 * Core-API Proxy Helper
 *
 * Forwards all mutation requests from settle to core-api.
 * Settle handles validation, auth, and reads. Core-api handles all DB writes.
 * Actor headers are HMAC-signed to prevent forgery.
 * Circuit breaker protects against cascading failures.
 */

import { NextResponse } from 'next/server';
import { createHmac, randomUUID } from 'crypto';
import { logger } from 'settlement-core';
import { CircuitBreaker } from '@/lib/events/circuitBreaker';

interface ProxyOptions {
  method: string;
  body?: unknown;
  actorType?: string;
  actorId?: string;
  requestId?: string;
  idempotencyKey?: string;
}

// Circuit breaker: opens after 5 consecutive failures, resets after 30s
const coreApiCircuit = new CircuitBreaker({
  name: 'core-api',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

/**
 * Compute HMAC-SHA256 signature for actor identity headers.
 * Returns hex-encoded signature, or undefined if inputs are missing.
 */
export function signActorHeaders(
  secret: string,
  actorType: string,
  actorId: string
): string {
  return createHmac('sha256', secret)
    .update(`${actorType}:${actorId}`)
    .digest('hex');
}

/**
 * Proxy a request to core-api.
 * Returns a NextResponse with core-api's response.
 * Throws if CORE_API_URL is not configured.
 */
export async function proxyCoreApi(
  path: string,
  options: ProxyOptions
): Promise<NextResponse> {
  const baseUrl = process.env.CORE_API_URL;
  if (!baseUrl) {
    logger.error('[Proxy] CORE_API_URL not configured — blocking mutation');
    return NextResponse.json(
      { success: false, error: 'Escrow service not configured. Contact support.' },
      { status: 503 }
    );
  }

  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {};
  if (options.body) headers['Content-Type'] = 'application/json';

  const coreApiSecret = process.env.CORE_API_SECRET;
  if (coreApiSecret) headers['x-core-api-secret'] = coreApiSecret;

  // Extract actor identity from options or body
  const body = options.body as Record<string, unknown> | undefined;
  const actorType = options.actorType || (body?.actor_type as string | undefined);
  const actorId = options.actorId || (body?.actor_id as string | undefined);

  if (actorType) headers['x-actor-type'] = actorType;
  if (actorId) headers['x-actor-id'] = actorId;

  // HMAC-sign actor headers
  if (coreApiSecret && actorType && actorId) {
    headers['x-actor-signature'] = signActorHeaders(coreApiSecret, actorType, actorId);
  }

  // Forward or generate request ID for end-to-end tracing
  const requestId = options.requestId || randomUUID();
  headers['x-request-id'] = requestId;

  // Forward idempotency key for dedup
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  // Circuit breaker: fast-fail if core-api has been consistently failing
  if (!coreApiCircuit.canCall()) {
    const stats = coreApiCircuit.getStats();
    logger.warn('[Proxy] Circuit breaker OPEN — fast-failing', {
      url,
      method: options.method,
      failureCount: stats.failureCount,
    });
    return NextResponse.json(
      { success: false, error: 'Service temporarily unavailable — please retry' },
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const data = await response.json();

    // Record success/failure based on HTTP status
    if (response.status >= 500) {
      coreApiCircuit.execute(() => Promise.reject(new Error(`HTTP ${response.status}`)))
        .catch(() => {}); // side-effect only, we still return the response
    } else {
      coreApiCircuit.execute(() => Promise.resolve())
        .catch(() => {}); // should not fail
    }

    const res = NextResponse.json(data, { status: response.status });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (error) {
    // Record failure in circuit breaker
    coreApiCircuit.execute(() => Promise.reject(error)).catch(() => {});

    logger.error('[Proxy] Failed to reach core-api', {
      url,
      method: options.method,
      error,
      requestId,
      circuitState: coreApiCircuit.getState(),
    });
    const errRes = NextResponse.json(
      { success: false, error: 'Core API unavailable — retry later' },
      { status: 503 }
    );
    errRes.headers.set('x-request-id', requestId);
    return errRes;
  } finally {
    clearTimeout(timeout);
  }
}

/** Get circuit breaker stats for health checks */
export function getCoreApiCircuitStats() {
  return coreApiCircuit.getStats();
}
