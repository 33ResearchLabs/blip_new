/**
 * GET /api/admin/limit-requests — admin listing + filtering of merchant/user
 * limit-increase requests (surfaced in Support Tickets → Limit Requests).
 *
 * Query params (all optional):
 *   ?status=pending|approved|rejected
 *   ?kind=daily|per_transaction
 *   ?actor_type=user|merchant
 *   ?limit=1..500 (default 200)
 *
 * Each row is enriched with the actor's username + email (from merchants or
 * users depending on actor_type) for display.
 *
 * AUTH: admin only (HMAC token via requireAdminAuth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';

const VALID_STATUS = ['pending', 'approved', 'rejected'];
const VALID_KIND = ['daily', 'per_transaction'];
const VALID_ACTOR = ['user', 'merchant'];

function badRequest(field: string) {
  return NextResponse.json(
    { success: false, error: `Invalid ${field}` },
    { status: 400 },
  );
}

export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const sp = request.nextUrl.searchParams;
  const status = sp.get('status');
  const kind = sp.get('kind');
  const actorType = sp.get('actor_type');
  const rawLimit = parseInt(sp.get('limit') || '200', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 200;

  if (status && !VALID_STATUS.includes(status)) return badRequest('status');
  if (kind && !VALID_KIND.includes(kind)) return badRequest('kind');
  if (actorType && !VALID_ACTOR.includes(actorType)) return badRequest('actor_type');

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    clauses.push(`lr.status = $${params.length}`);
  }
  if (kind) {
    params.push(kind);
    clauses.push(`lr.kind = $${params.length}`);
  }
  if (actorType) {
    params.push(actorType);
    clauses.push(`lr.actor_type = $${params.length}`);
  }
  params.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const rows = await query(
      `SELECT lr.id, lr.actor_type, lr.actor_id, lr.kind,
              lr.current_limit_usd, lr.requested_limit_usd, lr.reason,
              lr.status, lr.reviewed_by, lr.reviewed_at, lr.created_at,
              COALESCE(m.username, u.username) AS actor_username,
              COALESCE(m.email, u.email)       AS actor_email
         FROM limit_increase_requests lr
         LEFT JOIN merchants m ON lr.actor_type = 'merchant' AND m.id = lr.actor_id
         LEFT JOIN users u     ON lr.actor_type = 'user'     AND u.id = lr.actor_id
         ${where}
     ORDER BY lr.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    console.error('[admin/limit-requests] list failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch limit requests' },
      { status: 500 },
    );
  }
}
