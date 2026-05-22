// Admin endpoints for beta-access requests.
//
// GET    /api/admin/beta-requests              — list (with optional ?status= filter)
// PATCH  /api/admin/beta-requests/[id]         — see [id]/route.ts (status updates)
//
// Pure read here — mutations live in the dynamic-id route so the URL
// shape matches REST expectations (one resource per id) and the admin
// nav can deep-link to /admin/beta-requests/<id> later if needed.

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

interface ListRow {
  id: string;
  actor_id: string;
  actor_type: 'user' | 'merchant';
  email: string | null;
  display_name: string | null;
  business_name: string | null;
  country_code: string | null;
  expected_trading_amount_usd: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'contacted';
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_notes: string | null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const allowedStatus = ['pending', 'approved', 'rejected', 'contacted'];
  const filter = status && allowedStatus.includes(status) ? status : null;

  // Pagination keeps the response cheap once the table fills up. Default
  // limit covers the typical "first page" admin view; cap at 200 so a
  // malformed query doesn't dump the whole table.
  const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);

  const rows = filter
    ? await query<ListRow>(
        `SELECT * FROM beta_access_requests
          WHERE status = $1
          ORDER BY requested_at DESC
          LIMIT $2`,
        [filter, limit],
      )
    : await query<ListRow>(
        `SELECT * FROM beta_access_requests
          ORDER BY
            CASE status WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END,
            requested_at DESC
          LIMIT $1`,
        [limit],
      );

  // Surface per-status counts so the admin UI can render tab counters
  // without a second roundtrip.
  const counts = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n
       FROM beta_access_requests
      GROUP BY status`,
    [],
  );

  return NextResponse.json({
    success: true,
    data: {
      requests: rows,
      counts: Object.fromEntries(counts.map((r) => [r.status, parseInt(r.n, 10)])),
    },
  });
}
