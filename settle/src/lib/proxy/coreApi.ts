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
}

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

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
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
  }
}
