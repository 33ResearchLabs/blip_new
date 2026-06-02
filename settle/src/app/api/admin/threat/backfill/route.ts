/**
 * Threat-Score Backfill — Admin
 *
 * POST /api/admin/threat/backfill
 *   body (all optional): { type?: 'user' | 'merchant', limit?: number, offset?: number }
 *
 * Recomputes the algorithmic threat score (risk_profiles.wl_score / wl_label)
 * for EXISTING entities. The detector normally only runs on the waitlist /
 * registration paths, so accounts created before threat detection shipped — or
 * outside those flows — never got a wl_score and show "—" / "Unscored" in the
 * admin UI. This endpoint backfills them.
 *
 * Paginated and idempotent: call once per `type`, walking `offset` by the
 * returned `nextOffset` until `done` is true. Each entity is recomputed via the
 * same `recomputeAndPersist` used at signup, so re-running is always safe.
 *
 * Requires admin auth. Read-mostly: only writes the wl_* columns of
 * risk_profiles (no financial / evidentiary tables are touched).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query, queryOne } from '@/lib/db';
import { recomputeAndPersist } from '@/lib/threat/service';
import type { ActorType } from '@/lib/threat/types';

// Hard ceiling per request so a single call can't run unbounded work. Walk
// larger populations by paginating with `offset`.
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
// Recompute this many entities at a time. Keeps DB / external-reputation load
// bounded rather than firing the whole page at once.
const CONCURRENCY = 5;

interface BackfillBody {
  type?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export async function POST(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: BackfillBody = {};
  try {
    body = (await request.json()) as BackfillBody;
  } catch {
    // Empty / invalid body is fine — fall back to defaults.
  }

  const type: ActorType = body.type === 'user' ? 'user' : 'merchant';
  const limit = clampInt(body.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(body.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  try {
    // Total population for this type (so the caller knows when to stop).
    // Users exclude the synthetic ghost accounts (open_order_* / m2m_*) the
    // admin Users tab also hides.
    const totalRow =
      type === 'user'
        ? await queryOne<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM users
             WHERE username IS NOT NULL
               AND username NOT LIKE 'open_order_%'
               AND username NOT LIKE 'm2m_%'`
          )
        : await queryOne<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM merchants`
          );
    const total = parseInt(totalRow?.count || '0');

    // Fetch this page of ids. ORDER BY created_at so pagination is stable
    // across calls.
    const rows =
      type === 'user'
        ? await query<{ id: string }>(
            `SELECT id FROM users
             WHERE username IS NOT NULL
               AND username NOT LIKE 'open_order_%'
               AND username NOT LIKE 'm2m_%'
             ORDER BY created_at ASC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
          )
        : await query<{ id: string }>(
            `SELECT id FROM merchants
             ORDER BY created_at ASC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
          );

    let succeeded = 0;
    let failed = 0;

    // Process in small concurrent chunks. recomputeAndPersist never throws
    // (it catches internally and returns null), but we guard anyway.
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((r) =>
          recomputeAndPersist(type, r.id)
            .then((res) => res !== null)
            .catch(() => false)
        )
      );
      for (const ok of results) {
        if (ok) succeeded++;
        else failed++;
      }
    }

    const processed = rows.length;
    const nextOffset = offset + processed;
    const done = nextOffset >= total || processed === 0;

    return NextResponse.json({
      success: true,
      data: {
        type,
        total,
        processed,
        succeeded,
        failed,
        offset,
        nextOffset,
        done,
      },
    });
  } catch (error) {
    console.error('[API] POST /api/admin/threat/backfill error:', error);
    return NextResponse.json(
      { success: false, error: 'Backfill failed' },
      { status: 500 }
    );
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
