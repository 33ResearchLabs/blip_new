/**
 * POST /api/cron/reconcile-disputes
 *
 * Manual / scheduled trigger for the dispute reconciler — completes DB
 * finalization for disputes that already settled on-chain (Released/Refunded)
 * but whose finalize never committed (blockchain-success + DB-failure window).
 *
 * Auth (mirrors /api/cron/reconcile-escrow):
 *   - Admin HMAC bearer token, OR
 *   - shared `x-cron-secret` header matching CRON_SECRET (for plain cron runners).
 *
 * This endpoint runs the reconciliation regardless of DISPUTE_RECONCILER_ENABLED
 * (that flag only governs the in-process polling worker) — so ops always has a
 * manual recovery lever. It is idempotent and never double-pays: the underlying
 * reconcileOneDispute reads on-chain state and defers to atomicFinalizeDispute's
 * lock + status guard + idempotent ledger.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { runDisputeReconciliation } from '@/workers/disputeReconciler';
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
  const adminErr = await requireAdminAuth(request);
  const authed = !adminErr || acceptsCronSecret(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { limit?: unknown } = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const limit =
    typeof body.limit === 'number' && body.limit > 0 && body.limit <= 1_000
      ? body.limit
      : 100;

  try {
    const result = await runDisputeReconciliation({ limit });
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    logger.error('[cron/reconcile-disputes] run failed', { err: (err as Error).message });
    return NextResponse.json(
      { success: false, error: 'reconcile_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
