// PATCH /api/admin/beta-requests/[id]
//
// Admin status updates for a beta-access request. Allowed transitions:
//   pending     → approved | rejected | contacted
//   contacted   → approved | rejected | pending
//   approved    → (terminal)
//   rejected    → (terminal — but the actor can submit a fresh request,
//                 since the partial unique index only blocks duplicates
//                 while status='pending')
//
// We also accept an optional `admin_notes` field so reviewers can log
// "DMed via X on 2026-05-22" alongside the status change.

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

const STATUS_FLOW: Record<string, Set<string>> = {
  pending: new Set(['approved', 'rejected', 'contacted']),
  contacted: new Set(['approved', 'rejected', 'pending']),
  approved: new Set([]),
  rejected: new Set([]),
};

interface BetaRequestRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'contacted';
  admin_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing request id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const nextStatus = typeof body.status === 'string' ? body.status : null;
  const adminNotes =
    typeof body.admin_notes === 'string' ? body.admin_notes.trim().slice(0, 2000) : null;

  if (!nextStatus && adminNotes === null) {
    return NextResponse.json(
      { success: false, error: 'Provide status and/or admin_notes' },
      { status: 400 },
    );
  }

  const existing = await queryOne<BetaRequestRow>(
    `SELECT id, status, admin_notes, reviewed_at, reviewed_by
       FROM beta_access_requests WHERE id = $1`,
    [id],
  );
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 });
  }

  if (nextStatus && nextStatus !== existing.status) {
    const allowed = STATUS_FLOW[existing.status];
    if (!allowed || !allowed.has(nextStatus)) {
      return NextResponse.json(
        { success: false, error: `Cannot transition from '${existing.status}' to '${nextStatus}'` },
        { status: 409 },
      );
    }
  }

  // Reviewer identity: requireAdminAuth has already validated the token,
  // but it doesn't return the decoded payload from this signature. We
  // can pull the admin username from the cookie-decoded payload via the
  // existing auth helper export — but for now we accept it from the
  // header set by the admin layout (x-admin-username), which is what the
  // admin pages already attach to their fetches. Defaults to 'admin'.
  const reviewedBy = request.headers.get('x-admin-username') || 'admin';

  const updated = await queryOne<BetaRequestRow>(
    `UPDATE beta_access_requests
        SET status      = COALESCE($1, status),
            admin_notes = COALESCE($2, admin_notes),
            reviewed_at = CASE WHEN $1::text IS NOT NULL THEN NOW() ELSE reviewed_at END,
            reviewed_by = CASE WHEN $1::text IS NOT NULL THEN $3 ELSE reviewed_by END
      WHERE id = $4
      RETURNING id, status, admin_notes, reviewed_at, reviewed_by`,
    [nextStatus, adminNotes, reviewedBy, id],
  );

  return NextResponse.json({ success: true, data: { request: updated } });
}
