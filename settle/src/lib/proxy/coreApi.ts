/**
 * Core-API Proxy Helper
 *
 * Forwards all mutation requests from settle to core-api.
 * Settle handles validation, auth, and reads. Core-api handles all DB writes.
 * Actor headers are HMAC-signed to prevent forgery.
 */

import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { logger } from 'settlement-core';

interface ProxyOptions {
  method: string;
  body?: unknown;
  actorType?: string;
  actorId?: string;
  /**
   * Idempotency-Key to forward to core-api. Required for financial mutation
   * routes (create_order, payment_sent, release_escrow, cancel_order,
   * dispute open/confirm, cancel_request_respond). Settle's outer
   * withIdempotency already chose this value — we just propagate it so
   * core-api's idempotency_log keys off the same string.
   */
  idempotencyKey?: string;
}

/**
 * Compute timestamped HMAC-SHA256 signature for actor identity headers.
 *
 * Payload bound by the HMAC: `actorType:actorId:timestamp` (unix seconds).
 * Core-api rejects requests where the timestamp is outside the configured
 * skew window (default ±60s), making a captured signature usable only for
 * a brief replay window — drastically reducing the blast radius of a
 * leaked CORE_API_SECRET.
 *
 * `timestamp` may be passed in for deterministic tests; in production the
 * caller omits it and we use the current wall clock.
 *
 * Returns BOTH the signature and the timestamp it was computed against,
 * so the caller can place them in the matching headers (the verifier needs
 * the same timestamp it was signed with).
 */
export function signActorHeaders(
  secret: string,
  actorType: string,
  actorId: string,
  timestamp?: number,
): { signature: string; timestamp: number } {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret)
    .update(`${actorType}:${actorId}:${ts}`)
    .digest('hex');
  return { signature, timestamp: ts };
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
  if (!coreApiSecret) {
    logger.error('[Proxy] CORE_API_SECRET not configured — refusing to send unsigned request');
    return NextResponse.json(
      { success: false, error: 'Service misconfigured' },
      { status: 503 }
    );
  }
  headers['x-core-api-secret'] = coreApiSecret;

  // Extract actor identity from options or body
  const body = options.body as Record<string, unknown> | undefined;
  const actorType = options.actorType || (body?.actor_type as string | undefined);
  const actorId = options.actorId || (body?.actor_id as string | undefined);

  if (actorType) headers['x-actor-type'] = actorType;
  if (actorId) headers['x-actor-id'] = actorId;

  // HMAC-sign actor headers — bound to a fresh timestamp so a captured
  // signature is valid only for the configured skew window on the verifier.
  if (actorType && actorId) {
    const signed = signActorHeaders(coreApiSecret, actorType, actorId);
    headers['x-actor-signature'] = signed.signature;
    headers['x-actor-timestamp'] = String(signed.timestamp);
  }

  // Forward the Idempotency-Key. Core-api requires this header on every
  // financial mutation; if the settle caller forgot to pass it, we still
  // surface the failure as a clear 400 rather than ship an unsafe call.
  if (options.idempotencyKey) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  const controller = new AbortController();
  // 10s for normal mutations, 20s for escrow operations (on-chain can be slow)
  const timeoutMs = path.includes('escrow') || path.includes('release') || path.includes('refund') ? 20000 : 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    logger.error('[Proxy] Failed to reach core-api', {
      url,
      method: options.method,
      error,
    });
    return NextResponse.json(
      { success: false, error: 'Core API unavailable — retry later' },
      { status: 503 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
