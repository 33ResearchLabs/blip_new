/**
 * withErrorTracking — a non-invasive wrapper for Next.js App Router route
 * handlers that captures unhandled exceptions into the error_logs table
 * without altering the response format.
 *
 * USAGE (optional, additive — existing routes untouched):
 *
 *   // before
 *   export async function POST(request: NextRequest) { ... }
 *
 *   // after (wrap only if you want tracking for this route)
 *   export const POST = withErrorTracking(async (request: NextRequest) => {
 *     ...
 *   }, { routeName: 'orders.create' });
 *
 * BEHAVIOR:
 *  - When ENABLE_ERROR_TRACKING is off: returns the handler unchanged
 *  - When on: wraps with try/catch, logs any thrown error, RE-THROWS so the
 *    caller (Next.js) returns its standard 500 response — we DO NOT invent
 *    a new response shape
 *  - If `captureResponse` is true: also logs 5xx responses returned normally
 */

import type { NextRequest, NextResponse } from 'next/server';
import { ERROR_TRACKING_ENABLED } from './featureFlag';
import { safeLog } from './logger';

type Handler<Ctx = unknown> = (
  request: NextRequest,
  ctx: Ctx,
) => Promise<Response | NextResponse> | Response | NextResponse;

interface WrapOptions {
  /** Short identifier for dashboards, e.g. "orders.create" */
  routeName?: string;
  /** If true, ALSO log normal 5xx responses, not just thrown errors */
  captureResponse?: boolean;
}

export function withErrorTracking<Ctx = unknown>(
  handler: Handler<Ctx>,
  options: WrapOptions = {},
): Handler<Ctx> {
  if (!ERROR_TRACKING_ENABLED) return handler;

  const routeName = options.routeName || 'unknown_route';

  return async (request, ctx) => {
    let response: Response | NextResponse;
    try {
      response = await handler(request, ctx);
    } catch (err) {
      // Capture + re-throw so Next.js's standard error response is unchanged
      safeLog({
        type: `api.exception.${routeName}`,
        severity: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
        source: 'backend',
        metadata: {
          route: routeName,
          url: request.url,
          method: request.method,
          stack: err instanceof Error ? err.stack : undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        },
      });
      throw err;
    }

    if (options.captureResponse && response.status >= 500) {
      safeLog({
        type: `api.5xx.${routeName}`,
        severity: response.status === 500 ? 'ERROR' : 'WARN',
        message: `Route ${routeName} returned ${response.status}`,
        source: 'backend',
        metadata: {
          route: routeName,
          url: request.url,
          method: request.method,
          status: response.status,
        },
      });
    }

    return response;
  };
}
