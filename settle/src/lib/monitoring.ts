import { cacheMetrics } from '@/lib/cache/redis';
import { pool } from '@/lib/db';
import { query } from '@/lib/db';

export function captureError(error: unknown, context?: Record<string, unknown>) {
  console.error('[Error]', error, context);
  try {
    const Sentry = require('@sentry/nextjs');
    Sentry.captureException(error, { extra: context });
  } catch {
    // Sentry not installed — console.error is sufficient
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  console.log(`[${level.toUpperCase()}]`, message);
  try {
    const Sentry = require('@sentry/nextjs');
    Sentry.captureMessage(message, level);
  } catch {
    // Sentry not installed
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Production Metrics — Lightweight observability
//
// Tracks: cache hit/miss, DB latency percentiles, pool pressure,
// outbox queue depth, worker failures.
//
// Emits structured JSON every 60s — works with any log aggregator.
// Expose via GET /api/health/metrics for Prometheus scraping.
// ═══════════════════════════════════════════════════════════════════════

// ── DB Query Latency Tracking ───────────────────────────────────────────

const LATENCY_WINDOW = 1000;
const queryLatencies: number[] = [];

/** Call this from the DB query wrapper to record latency. */
export function recordQueryLatency(durationMs: number): void {
  queryLatencies.push(durationMs);
  if (queryLatencies.length > LATENCY_WINDOW) {
    queryLatencies.shift();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getLatencyStats() {
  if (queryLatencies.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...queryLatencies].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    count: sorted.length,
  };
}

// ── Worker Queue Metrics ────────────────────────────────────────────────

async function getOutboxQueueDepth() {
  try {
    const rows = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count
       FROM notification_outbox
       WHERE status IN ('pending', 'failed', 'processing')
       GROUP BY status`
    );
    const counts = { pending: 0, failed: 0, processing: 0 };
    for (const row of rows) {
      if (row.status === 'pending') counts.pending = parseInt(row.count);
      else if (row.status === 'failed') counts.failed = parseInt(row.count);
      else if (row.status === 'processing') counts.processing = parseInt(row.count);
    }
    return counts;
  } catch {
    return { pending: -1, failed: -1, processing: -1 };
  }
}

// ── Full Metrics Snapshot ───────────────────────────────────────────────

export interface MetricsSnapshot {
  timestamp: string;
  cache: {
    hits: number;
    misses: number;
    errors: number;
    hitRate: string;
    stampedeLockWaits: number;
  };
  db: {
    latency: { p50: number; p95: number; p99: number; queriesTracked: number };
    pool: { total: number; idle: number; waiting: number };
  };
  outboxQueue: { pending: number; failed: number; processing: number };
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const cacheSnap = cacheMetrics.snapshot();
  const totalOps = cacheSnap.hits + cacheSnap.misses;
  const hitRate = totalOps > 0
    ? ((cacheSnap.hits / totalOps) * 100).toFixed(1)
    : 'N/A';

  return {
    timestamp: new Date().toISOString(),
    cache: {
      hits: cacheSnap.hits,
      misses: cacheSnap.misses,
      errors: cacheSnap.errors,
      hitRate: `${hitRate}%`,
      stampedeLockWaits: cacheSnap.stampedeLockWaits,
    },
    db: {
      latency: { ...getLatencyStats(), queriesTracked: getLatencyStats().count },
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    },
    outboxQueue: await getOutboxQueueDepth(),
  };
}

// ── Periodic Reporter ───────────────────────────────────────────────────

let reporterTimer: NodeJS.Timeout | null = null;

export function startMetricsReporter(intervalMs = 60_000): void {
  if (reporterTimer) return;

  reporterTimer = setInterval(async () => {
    try {
      const m = await getMetricsSnapshot();
      console.log(JSON.stringify({ level: 'info', msg: '[Metrics]', ...m }));

      if (m.db.pool.waiting > 5) {
        console.warn(JSON.stringify({ level: 'warn', msg: '[Metrics] DB pool contention', waiting: m.db.pool.waiting }));
      }
      if (m.outboxQueue.failed > 10) {
        console.warn(JSON.stringify({ level: 'warn', msg: '[Metrics] Outbox failures high', failed: m.outboxQueue.failed }));
      }
      if (m.db.latency.p99 > 500) {
        console.warn(JSON.stringify({ level: 'warn', msg: '[Metrics] DB p99 latency high', p99_ms: m.db.latency.p99 }));
      }
    } catch (err) {
      console.error('[Metrics] Reporter error:', err);
    }
  }, intervalMs);

  reporterTimer.unref();
  console.log(`[Metrics] Reporter started (${intervalMs}ms interval)`);
}

export function stopMetricsReporter(): void {
  if (reporterTimer) {
    clearInterval(reporterTimer);
    reporterTimer = null;
  }
}
