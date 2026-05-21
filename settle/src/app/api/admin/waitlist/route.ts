// GET /api/admin/waitlist?segment=user|merchant|all&status=waitlisted|active|rejected&q=&page=&limit=
//
// Paginated admin list of waitlist signups across users and merchants.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query, queryOne } from '@/lib/db';

interface ListRow {
  id: string;
  actor_type: 'user' | 'merchant';
  email: string | null;
  display_name: string | null;
  username: string | null;
  waitlist_status: 'waitlisted' | 'active' | 'rejected';
  waitlist_joined_at: string | null;
  waitlist_source: string | null;
  blip_points: number | null;
  referral_code: string | null;
  business_name: string | null;
}

export async function GET(request: NextRequest) {
  const adminAuth = await requireAdminAuth(request);
  if (adminAuth) return adminAuth;

  const sp = request.nextUrl.searchParams;
  const segment = sp.get('segment') ?? 'all';
  const status = sp.get('status') ?? 'waitlisted';
  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  const segmentValid = ['user', 'merchant', 'all'].includes(segment);
  const statusValid = ['waitlisted', 'active', 'rejected', 'all'].includes(status);
  if (!segmentValid || !statusValid) {
    return NextResponse.json({ success: false, error: 'Invalid filter' }, { status: 400 });
  }

  const statusClause = status === 'all' ? '' : `AND waitlist_status = '${status}'`;

  const userSelect = `
    SELECT
      id, 'user'::text AS actor_type,
      email,
      name AS display_name,
      username,
      waitlist_status,
      waitlist_joined_at::text AS waitlist_joined_at,
      waitlist_source,
      blip_points,
      referral_code,
      NULL::text AS business_name
    FROM users
    WHERE 1=1
      ${statusClause}
      ${q ? `AND (LOWER(email) LIKE $Q OR LOWER(username) LIKE $Q OR LOWER(name) LIKE $Q)` : ''}
  `;

  const merchantSelect = `
    SELECT
      id, 'merchant'::text AS actor_type,
      email,
      display_name,
      username,
      waitlist_status,
      waitlist_joined_at::text AS waitlist_joined_at,
      waitlist_source,
      blip_points,
      referral_code,
      business_name
    FROM merchants
    WHERE 1=1
      ${statusClause}
      ${q ? `AND (LOWER(email) LIKE $Q OR LOWER(username) LIKE $Q OR LOWER(business_name) LIKE $Q OR LOWER(display_name) LIKE $Q)` : ''}
  `;

  let unionSql: string;
  if (segment === 'user') unionSql = userSelect;
  else if (segment === 'merchant') unionSql = merchantSelect;
  else unionSql = `${userSelect} UNION ALL ${merchantSelect}`;

  // Parameterize: $1 limit, $2 offset, (optional $3 q-pattern)
  const params: unknown[] = [limit, offset];
  let finalSql = `${unionSql} ORDER BY waitlist_joined_at DESC NULLS LAST LIMIT $1 OFFSET $2`;
  if (q) {
    params.push(`%${q}%`);
    finalSql = finalSql.replace(/\$Q/g, '$3');
  }

  const rows = await query<ListRow>(finalSql, params);

  // Total (re-runs the same WHERE conditions without LIMIT/OFFSET).
  let totalSql: string;
  if (segment === 'user' || segment === 'merchant') {
    const t = segment === 'user' ? 'users' : 'merchants';
    totalSql = `SELECT COUNT(*)::text AS n FROM ${t} WHERE 1=1 ${statusClause}`;
  } else {
    totalSql = `
      SELECT (
        (SELECT COUNT(*) FROM users    WHERE 1=1 ${statusClause}) +
        (SELECT COUNT(*) FROM merchants WHERE 1=1 ${statusClause})
      )::text AS n
    `;
  }
  const totalRow = await queryOne<{ n: string }>(totalSql, []);
  const total = totalRow ? parseInt(totalRow.n, 10) : 0;

  return NextResponse.json({
    success: true,
    data: {
      rows,
      page,
      limit,
      total,
    },
  });
}
