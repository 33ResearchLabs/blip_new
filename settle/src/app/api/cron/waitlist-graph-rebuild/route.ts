/**
 * POST /api/cron/waitlist-graph-rebuild
 *
 * Rebuilds the actor graph + community-membership table used by Tier 3 of
 * the waitlist threat-detection pipeline. Designed to be called every 5
 * minutes by an external scheduler (Railway cron / GitHub Actions).
 *
 * Auth: standard admin HMAC bearer token, OR shared CRON_SECRET header.
 * (Mirrors /api/cron/reconcile-escrow exactly.)
 *
 * Pipeline:
 *   1. buildActorGraph()         — nodes = waitlisted actors, edges from
 *                                   referrals + shared IPs + shared FPs
 *   2. detectCommunities()       — weighted label propagation
 *   3. computeAnomaly()          — per-community metrics + per-actor score
 *   4. persistCommunityAssignments() — bulk upsert + prune stale rows
 *
 * Returns a small summary suitable for monitoring dashboards.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import crypto from 'node:crypto';
import { buildActorGraph } from '@/lib/threat/graph/builder';
import { detectCommunities } from '@/lib/threat/graph/labelPropagation';
import { computeAnomaly } from '@/lib/threat/graph/anomaly';
import { persistCommunityAssignments } from '@/lib/threat/graph/persist';

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

  const startedAt = Date.now();
  try {
    const graph = await buildActorGraph();
    const buildMs = Date.now() - startedAt;

    const assignment = detectCommunities(graph);
    const detectMs = Date.now() - startedAt - buildMs;

    const { perCommunity, perActor } = computeAnomaly(graph, assignment);
    const scoreMs = Date.now() - startedAt - buildMs - detectMs;

    const persistSummary = await persistCommunityAssignments(perActor);
    const totalMs = Date.now() - startedAt;

    // Summary stats that the monitoring dashboard can chart.
    const highAnomaly = perActor.filter(a => a.anomaly_score >= 60).length;
    const largestCommunity = perCommunity.reduce((m, c) => Math.max(m, c.size), 0);

    return NextResponse.json({
      success: true,
      summary: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        communities: assignment.byCommunity.size,
        iterations: assignment.iterations,
        converged: assignment.converged,
        largest_community: largestCommunity,
        actors_high_anomaly: highAnomaly,
        upserted: persistSummary.upserted,
        pruned: persistSummary.pruned,
        timings_ms: {
          build: buildMs,
          detect: detectMs,
          score: scoreMs,
          total: totalMs,
        },
      },
    });
  } catch (err) {
    console.error('[cron/waitlist-graph-rebuild] failed', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message ?? 'rebuild_failed' },
      { status: 500 },
    );
  }
}

// GET handler returns the last-run timestamp for ops debugging without
// requiring a write or re-run. Same auth.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminErr = await requireAdminAuth(request);
  const authed = !adminErr || acceptsCronSecret(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }
  const { queryOne } = await import('@/lib/db');
  const row = await queryOne<{ last: string | null; rows: string }>(
    `SELECT MAX(last_computed_at)::text AS last, COUNT(*)::text AS rows
       FROM waitlist_community_membership`,
  );
  return NextResponse.json({
    success: true,
    last_computed_at: row?.last ?? null,
    row_count: row ? parseInt(row.rows, 10) : 0,
  });
}
