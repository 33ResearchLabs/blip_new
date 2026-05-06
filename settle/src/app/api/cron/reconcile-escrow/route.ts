/**
 * POST /api/cron/reconcile-escrow
 *
 * Triggers a single escrow reconciliation run. Designed for an external
 * scheduler (Railway cron, GitHub Actions, a plain `curl` in a cron
 * container) to call every N minutes.
 *
 * Auth: ADMIN_SECRET via the standard admin bearer-token HMAC contract.
 *   - In Railway this is set via env; the scheduler posts
 *     `Authorization: Bearer <admin_token>`.
 *   - Alternatively a shared `CRON_SECRET` header is accepted as a
 *     lower-surface-area fallback (so a cron box without HMAC code can
 *     still call in). Both must match `process.env` values.
 *
 * Body (all optional):
 *   {
 *     "dryRun": false,
 *     "limit":  1000,
 *     "statusFilter": [1]    // 0=Created, 1=Locked, 2=Released, 3=Refunded
 *   }
 *
 * Response: reconciliation summary (see ReconcileSummary).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { runReconciliation } from '@/workers/reconcileEscrow';
import { logger } from 'settlement-core';
import crypto from 'node:crypto';

function acceptsCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const given = req.headers.get('x-cron-secret') ?? '';
  if (given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Primary path: admin HMAC bearer token.
  const adminErr = await requireAdminAuth(request);
  // Fallback path: shared CRON_SECRET header (for plain cron runners).
  const authed = !adminErr || acceptsCronSecret(request);
  if (!authed) {
    return NextResponse.json(
      { success: false, error: 'unauthorized' },
      { status: 401 },
    );
  }

  let body: {
    dryRun?: unknown;
    limit?: unknown;
    statusFilter?: unknown;
  } = {};
  try {
    // Body is optional. Empty body → defaults.
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { success: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun === true;
  const limit =
    typeof body.limit === 'number' && body.limit > 0 && body.limit <= 100_000
      ? body.limit
      : undefined;
  const statusFilter = Array.isArray(body.statusFilter)
    ? body.statusFilter.filter(
        (b): b is number => typeof b === 'number' && b >= 0 && b <= 3,
      )
    : undefined;

  try {
    const summary = await runReconciliation({ dryRun, limit, statusFilter });
    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (err) {
    logger.error('[cron/reconcile-escrow] run failed', {
      err: (err as Error).message,
    });
    return NextResponse.json(
      { success: false, error: 'reconcile_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
