/**
 * POST /api/client-errors
 *
 * Ingest endpoint for the frontend error logger (clientLogger.ts).
 * Completely additive — no other route depends on it and it writes ONLY
 * to the new error_logs table.
 *
 * SAFETY:
 *   - Feature-flagged via ENABLE_ERROR_TRACKING (returns 204 when off)
 *   - Auth is OPTIONAL (we still accept anonymous UI crashes pre-login)
 *   - Rate limited per IP (STANDARD_LIMIT: 100 req/min)
 *   - Never blocks — logger errors are swallowed
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { ERROR_TRACKING_ENABLED } from '@/lib/errorTracking/featureFlag';
import { safeLog } from '@/lib/errorTracking/logger';

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: NextRequest) {
  // Feature flag — respond success but do nothing when disabled.
  if (!ERROR_TRACKING_ENABLED) {
    return new NextResponse(null, { status: 204 });
  }

  const rateLimitResponse = await checkRateLimit(request, 'client-errors', STANDARD_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return new NextResponse(null, { status: 400 });
    }

    // Only pass through the fields we care about — never spread arbitrary
    // client-provided keys into the DB insert.
    safeLog({
      type: String(body.type || 'client.unknown'),
      message: String(body.message || ''),
      severity: (body.severity as 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL') || 'ERROR',
      orderId: typeof body.orderId === 'string' ? body.orderId : null,
      userId: typeof body.userId === 'string' ? body.userId : null,
      merchantId: typeof body.merchantId === 'string' ? body.merchantId : null,
      source: 'frontend',
      metadata:
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : {},
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    // Never reveal internals — a failing ingest endpoint must not crash
    // the caller's page either.
    return new NextResponse(null, { status: 204 });
  }
}
