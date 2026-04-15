/**
 * GET /admin/error-logs — admin-only browsing of error_logs.
 *
 * Filters (all optional, combine freely):
 *   ?orderId=<uuid>
 *   ?userId=<uuid>
 *   ?merchantId=<uuid>
 *   ?severity=INFO|WARN|ERROR|CRITICAL
 *   ?type=<prefix>        (e.g. "api." matches api.500, api.exception.foo, ...)
 *   ?source=frontend|backend|worker
 *   ?since=<ISO8601>      (returns logs created_at >= since)
 *   ?limit=<1..500>       (default 100)
 *
 * AUTH: admin only (HMAC token via requireAdminAuth).
 * FLAG: returns 404 when ENABLE_ERROR_TRACKING is off, so the endpoint is
 * effectively invisible until tracking is turned on.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { ERROR_TRACKING_ENABLED } from '@/lib/errorTracking/featureFlag';
import { query } from '@/lib/db';

interface ErrorLogRow {
  id: string;
  type: string;
  message: string;
  severity: string;
  order_id: string | null;
  user_id: string | null;
  merchant_id: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SEVERITIES = new Set(['INFO', 'WARN', 'ERROR', 'CRITICAL']);
const VALID_SOURCES = new Set(['frontend', 'backend', 'worker']);

export async function GET(request: NextRequest) {
  if (!ERROR_TRACKING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const sp = request.nextUrl.searchParams;

  const clauses: string[] = [];
  const params: unknown[] = [];

  const orderId = sp.get('orderId');
  if (orderId) {
    if (!UUID_RE.test(orderId)) {
      return NextResponse.json({ success: false, error: 'Invalid orderId' }, { status: 400 });
    }
    params.push(orderId);
    clauses.push(`order_id = $${params.length}`);
  }

  const userId = sp.get('userId');
  if (userId) {
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }
    params.push(userId);
    clauses.push(`user_id = $${params.length}`);
  }

  const merchantId = sp.get('merchantId');
  if (merchantId) {
    if (!UUID_RE.test(merchantId)) {
      return NextResponse.json({ success: false, error: 'Invalid merchantId' }, { status: 400 });
    }
    params.push(merchantId);
    clauses.push(`merchant_id = $${params.length}`);
  }

  const severity = sp.get('severity');
  if (severity) {
    if (!VALID_SEVERITIES.has(severity)) {
      return NextResponse.json({ success: false, error: 'Invalid severity' }, { status: 400 });
    }
    params.push(severity);
    clauses.push(`severity = $${params.length}`);
  }

  const type = sp.get('type');
  if (type) {
    if (type.length > 100 || /[^a-zA-Z0-9._-]/.test(type)) {
      return NextResponse.json({ success: false, error: 'Invalid type filter' }, { status: 400 });
    }
    params.push(`${type}%`);
    clauses.push(`type LIKE $${params.length}`);
  }

  const source = sp.get('source');
  if (source) {
    if (!VALID_SOURCES.has(source)) {
      return NextResponse.json({ success: false, error: 'Invalid source' }, { status: 400 });
    }
    params.push(source);
    clauses.push(`source = $${params.length}`);
  }

  const since = sp.get('since');
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid since' }, { status: 400 });
    }
    params.push(d.toISOString());
    clauses.push(`created_at >= $${params.length}`);
  }

  // ?include_resolved=true → show resolved rows too. Default: hide them.
  const includeResolved = sp.get('include_resolved') === 'true';
  if (!includeResolved) {
    clauses.push('resolved_at IS NULL');
  }

  const rawLimit = parseInt(sp.get('limit') || '100', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 100;

  // ?grouped=true → Sentry-style issue grouping: one row per unique
  // (type, message) with occurrence count + first/last seen. Recent
  // example row's id + metadata are returned so clicking still opens a
  // detail modal.
  const grouped = sp.get('grouped') === 'true';
  params.push(limit);
  const limitIdx = params.length;

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    if (grouped) {
      // Postgres MIN()/MAX() don't support uuid — aggregate each uuid as text
      // and pick the most-recent occurrence's value via array_agg ordering.
      const groupedSql = `
        SELECT
          (array_agg(id::text ORDER BY created_at DESC))[1] AS id,
          type,
          -- Sentry groups by fingerprint — we approximate with (type, message)
          MAX(message) AS message,
          MAX(severity) AS severity,
          (array_agg(order_id::text ORDER BY created_at DESC) FILTER (WHERE order_id IS NOT NULL))[1] AS order_id,
          (array_agg(user_id::text ORDER BY created_at DESC) FILTER (WHERE user_id IS NOT NULL))[1] AS user_id,
          (array_agg(merchant_id::text ORDER BY created_at DESC) FILTER (WHERE merchant_id IS NOT NULL))[1] AS merchant_id,
          MAX(source) AS source,
          (array_agg(metadata ORDER BY created_at DESC))[1] AS metadata,
          MAX(created_at) AS last_seen_at,
          MIN(created_at) AS first_seen_at,
          MAX(created_at) AS created_at,
          COUNT(*)::int AS occurrence_count,
          (array_agg(id::text ORDER BY created_at DESC))[1] AS latest_id
        FROM error_logs
        ${where}
        GROUP BY type, message
        ORDER BY MAX(created_at) DESC
        LIMIT $${limitIdx}
      `;
      const rows = await query(groupedSql, params);
      return NextResponse.json({ success: true, data: rows, count: rows.length, grouped: true });
    }

    const sql = `
      SELECT id, type, message, severity, order_id, user_id, merchant_id, source, metadata, created_at
      FROM error_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${limitIdx}
    `;
    const rows = await query<ErrorLogRow>(sql, params);
    return NextResponse.json({ success: true, data: rows, count: rows.length, grouped: false });
  } catch (err) {
    // Don't let a logging query take the admin dashboard down.
    console.error('[admin/error-logs] query failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch error logs' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /admin/error-logs?scope=test | all
 *   scope=test  (default) → remove only diagnostic/test rows
 *                           (type like 'test.%', 'errorTracking.%', 'manual.%')
 *   scope=all             → wipe the whole table (destructive)
 */
export async function DELETE(request: NextRequest) {
  if (!ERROR_TRACKING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const scope = request.nextUrl.searchParams.get('scope') || 'test';

  try {
    if (scope === 'all') {
      const result = await query<{ id: string }>(`DELETE FROM error_logs RETURNING id`);
      return NextResponse.json({ success: true, deleted: result.length });
    }
    // scope=test — only remove rows that look like diagnostic noise
    const result = await query<{ id: string }>(
      `DELETE FROM error_logs
       WHERE type LIKE 'test.%'
          OR type LIKE 'errorTracking.%'
          OR type LIKE 'manual.%'
       RETURNING id`
    );
    return NextResponse.json({ success: true, deleted: result.length });
  } catch (err) {
    console.error('[admin/error-logs] delete failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete error logs' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /admin/error-logs — mark errors as resolved (or unresolved).
 *
 * Body: { ids: string[], resolved: boolean, type?: string, message?: string }
 *
 * Modes:
 *   - Single/list: pass `ids` with one or more UUIDs.
 *   - Group resolve: pass `type` + `message` to mark ALL rows matching that
 *     group as resolved (used when clicking "Resolve" on a grouped row).
 *
 * Resolved rows remain in the table (for audit history) but are hidden
 * from the default list view.
 */
export async function PATCH(request: NextRequest) {
  if (!ERROR_TRACKING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  let body: { ids?: string[]; resolved?: boolean; type?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const resolved = body.resolved !== false; // default: resolve (true)
  const resolvedAt = resolved ? 'NOW()' : 'NULL';
  const resolvedBy = resolved ? 'admin' : null; // could be improved with actual admin identity

  try {
    // Group mode: resolve all rows matching a (type, message) fingerprint
    if (body.type && body.message !== undefined) {
      const result = await query<{ id: string }>(
        `UPDATE error_logs
         SET resolved_at = ${resolvedAt},
             resolved_by = $1
         WHERE type = $2 AND message = $3
           AND ${resolved ? 'resolved_at IS NULL' : 'resolved_at IS NOT NULL'}
         RETURNING id`,
        [resolvedBy, body.type, body.message]
      );
      return NextResponse.json({ success: true, updated: result.length });
    }

    // List mode: resolve specific IDs
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const invalid = body.ids.find((id) => !UUID_RE.test(id));
      if (invalid) {
        return NextResponse.json({ success: false, error: 'Invalid id format' }, { status: 400 });
      }
      const result = await query<{ id: string }>(
        `UPDATE error_logs
         SET resolved_at = ${resolvedAt},
             resolved_by = $1
         WHERE id = ANY($2::uuid[])
         RETURNING id`,
        [resolvedBy, body.ids]
      );
      return NextResponse.json({ success: true, updated: result.length });
    }

    return NextResponse.json(
      { success: false, error: 'Provide either {ids: [...]} or {type, message}' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[admin/error-logs] resolve failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update error logs' },
      { status: 500 }
    );
  }
}
