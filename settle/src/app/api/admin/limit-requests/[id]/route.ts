/**
 * PATCH /api/admin/limit-requests/:id — approve or reject a limit-increase
 * request (Support Tickets → Limit Requests).
 *
 * Body: { action: 'approve' | 'reject', reviewedBy?: string }
 *
 * Only acts on a request that is still `pending` (single-shot — concurrent
 * reviewers can't double-resolve). Approving flips status → 'approved',
 * which is ALL that's needed to raise the actor's cap: getEffectiveLimits()
 * reads the latest approved request per kind and applies it (see
 * getApprovedLimitOverrides). No separate "apply" write.
 *
 * AUTH: admin only (HMAC token via requireAdminAuth). The admin identity is
 * not exposed by requireAdminAuth, so `reviewedBy` is passed from the client
 * (mirrors `resolvedBy` on /api/admin/issues); defaults to 'admin'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }

  let body: { action?: string; reviewedBy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json(
      { success: false, error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }
  const status = body.action === 'approve' ? 'approved' : 'rejected';
  const reviewedBy =
    typeof body.reviewedBy === 'string' && body.reviewedBy.trim()
      ? body.reviewedBy.trim().slice(0, 100)
      : 'admin';

  try {
    const rows = await query(
      `UPDATE limit_increase_requests
          SET status = $1, reviewed_by = $2, reviewed_at = NOW()
        WHERE id = $3 AND status = 'pending'
      RETURNING id, actor_type, actor_id, kind, current_limit_usd,
                requested_limit_usd, status, reviewed_by, reviewed_at, created_at`,
      [status, reviewedBy, id],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Request not found or already reviewed' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[admin/limit-requests] update failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update limit request' },
      { status: 500 },
    );
  }
}
