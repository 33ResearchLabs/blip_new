/**
 * GET /admin/worker-health — admin-only view of the worker_health table
 * (heartbeats written by both fleets via runWorkerTick).
 *
 * AUTH: admin only (HMAC token via requireAdminAuth).
 *
 * Unlike error-logs this is NOT gated behind ENABLE_ERROR_TRACKING — worker
 * liveness must be visible regardless. If migration 150 hasn't been applied
 * yet the table is absent; we return an empty list with a note rather than 500.
 *
 * `effective_status` is recomputed here from last_tick_at (independent of the
 * stored status column) so a dead health-checker can't make a dead worker look
 * healthy. Thresholds mirror apps/core-api/src/workers/workerHealthChecker.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';

interface WorkerHealthRow {
  worker_name: string;
  fleet: string;
  criticality: string;
  status: string;
  expected_interval_ms: number | null;
  last_tick_at: string | Date | null;
  last_ok_at: string | Date | null;
  last_error: string | null;
  tick_seq: string | number;
  items_processed: string | number;
  last_batch_size: number | null;
  consecutive_errors: number;
  pid: number | null;
  host: string | null;
  updated_at: string | Date;
}

type Freshness = 'healthy' | 'warning' | 'critical' | 'unknown';

function effectiveStatus(lastTickAt: string | Date | null, intervalMs: number | null): Freshness {
  if (!lastTickAt) return 'unknown';
  const ageMs = Date.now() - new Date(lastTickAt).getTime();
  const interval = intervalMs || 60_000;
  if (ageMs > Math.max(interval * 4, 180_000)) return 'critical';
  if (ageMs > Math.max(interval * 2, 75_000)) return 'warning';
  return 'healthy';
}

export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const rows = await query<WorkerHealthRow>(
      `SELECT worker_name, fleet, criticality, status, expected_interval_ms,
              last_tick_at, last_ok_at, last_error, tick_seq, items_processed,
              last_batch_size, consecutive_errors, pid, host, updated_at
         FROM worker_health
        ORDER BY
          CASE criticality
            WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3
          END,
          worker_name`,
    );

    const data = rows.map((r) => ({
      ...r,
      effective_status: effectiveStatus(r.last_tick_at, r.expected_interval_ms),
    }));

    return NextResponse.json({ success: true, data, count: data.length });
  } catch (err) {
    if ((err as { code?: string })?.code === '42P01') {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        note: 'worker_health table not present yet (migration 150 pending)',
      });
    }
    console.error('[admin/worker-health] query failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch worker health' },
      { status: 500 },
    );
  }
}
