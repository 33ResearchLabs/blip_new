import type { FastifyPluginAsync } from 'fastify';
import { query, queryOne } from 'settlement-core';

interface WorkerHealthRow {
  worker_name: string;
  fleet: string;
  criticality: string;
  status: string;
  expected_interval_ms: number | null;
  last_tick_at: string | Date | null;
  last_error: string | null;
}

/**
 * Recompute liveness from last_tick_at independently of the stored status, so
 * this endpoint stays accurate even if the health-checker worker itself is dead
 * (a dead checker stops updating worker_health.status, but last_tick_at still
 * ages). Thresholds mirror workerHealthChecker's defaults.
 */
function freshness(lastTickAt: string | Date | null, intervalMs: number | null): 'healthy' | 'warning' | 'critical' | 'unknown' {
  if (!lastTickAt) return 'unknown';
  const ageMs = Date.now() - new Date(lastTickAt).getTime();
  const interval = intervalMs || 60_000;
  if (ageMs > Math.max(interval * 4, 180_000)) return 'critical';
  if (ageMs > Math.max(interval * 2, 75_000)) return 'warning';
  return 'healthy';
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    return {
      ok: true,
      service: 'core-api',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/health/db', async (_request, reply) => {
    try {
      const start = Date.now();
      const result = await queryOne<{ db_name: string; migration_version: string }>(
        `SELECT current_database() AS db_name,
                COALESCE(
                  (SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1),
                  'unknown'
                ) AS migration_version`
      );
      const latencyMs = Date.now() - start;

      return {
        ok: true,
        service: 'core-api',
        database: result?.db_name ?? 'unknown',
        migration_version: result?.migration_version ?? 'unknown',
        latency_ms: latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      reply.status(503);
      return {
        ok: false,
        service: 'core-api',
        error: 'Database health check failed',
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Per-worker liveness for an EXTERNAL uptime monitor — the outermost net that
  // catches even a total core-api/checker death. Returns 503 if any worker is
  // critical so the monitor pages. Liveness is recomputed here from last_tick_at
  // (not the stored status) so a dead checker can't mask a dead worker.
  fastify.get('/health/workers', async (_request, reply) => {
    try {
      const rows = await query<WorkerHealthRow>(
        `SELECT worker_name, fleet, criticality, status, expected_interval_ms,
                last_tick_at, last_error
           FROM worker_health`,
      );
      const now = new Date().toISOString();
      const workers = rows.map((r) => ({
        worker: r.worker_name,
        fleet: r.fleet,
        criticality: r.criticality,
        status: freshness(r.last_tick_at, r.expected_interval_ms),
        lastError: r.last_error,
      }));
      const worst = workers.some((w) => w.status === 'critical')
        ? 'critical'
        : workers.some((w) => w.status === 'warning')
          ? 'warning'
          : workers.length === 0
            ? 'unknown'
            : 'healthy';

      if (worst === 'critical') reply.status(503);
      return { ok: worst !== 'critical', service: 'core-api', status: worst, count: workers.length, workers, timestamp: now };
    } catch (err) {
      // Pre-migration (table absent) is a deploy-ordering state, not a worker
      // outage — report ok so the uptime monitor doesn't false-alarm.
      if ((err as { code?: string })?.code === '42P01') {
        return { ok: true, service: 'core-api', status: 'unknown', count: 0, workers: [], note: 'worker_health table not yet present', timestamp: new Date().toISOString() };
      }
      reply.status(503);
      return { ok: false, service: 'core-api', status: 'error', error: 'Worker health check failed', timestamp: new Date().toISOString() };
    }
  });
};
