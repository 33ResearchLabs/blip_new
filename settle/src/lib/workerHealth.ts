/**
 * Worker heartbeat helper — settle fleet.
 *
 * Settle twin of apps/core-api/src/workers/workerHealth.ts. Both write the
 * SAME `worker_health` table (migration 150) + the SAME Redis key scheme
 * (`worker_health:<name>`), so the health checker and the /admin/worker-health
 * dashboard see one unified view across both fleets. Keep the two in sync.
 *
 * Settle workers run as standalone `tsx` processes spawned by server.js, so
 * this module uses settle-native imports (@/lib/db, @/lib/cache,
 * @/lib/errorTracking/logger) rather than the settlement-core package.
 *
 * Zero-regression rules (identical to the core-api twin):
 *   - recordHeartbeat / Redis write NEVER throw into the worker loop.
 *   - Redis is a best-effort live mirror; Postgres is the durable truth.
 *   - Inert until a worker imports and calls runWorkerTick.
 */

import { hostname } from 'node:os';
import { query } from '@/lib/db';
import { safeLog } from '@/lib/errorTracking/logger';
import { redis } from '@/lib/cache';

export type Criticality = 'critical' | 'high' | 'medium' | 'low';

/** Return shape a wrapped tick may use to report how much work it did. */
export interface TickResult {
  items?: number;
}

export interface WorkerTickOpts {
  /** Declared cadence in ms — stored so the checker can derive stall thresholds. */
  intervalMs: number;
  /** Drives alert severity. Defaults to 'medium'. */
  criticality?: Criticality;
  /** Per-tick budget. Defaults to max(15s, intervalMs * 1.5). */
  timeoutMs?: number;
}

const HOST = hostname();
const PID = process.pid;

interface HeartbeatInput {
  worker: string;
  intervalMs: number;
  criticality: Criticality;
  ok: boolean;
  items?: number;
  batch?: number | null;
  error?: string;
}

/**
 * UPSERT one heartbeat row. Increments tick_seq + items_processed, refreshes
 * last_tick_at on every tick, last_ok_at only on success. Swallows all errors.
 */
async function recordHeartbeat(h: HeartbeatInput): Promise<void> {
  try {
    await query(
      `INSERT INTO worker_health
         (worker_name, fleet, criticality, expected_interval_ms,
          last_tick_at, last_ok_at, last_error, tick_seq, items_processed,
          last_batch_size, consecutive_errors, status, pid, host, updated_at)
       VALUES ($1, 'settle', $2, $3,
               NOW(),
               CASE WHEN $4 THEN NOW() ELSE NULL END,
               $5, 1, $6, $7,
               CASE WHEN $4 THEN 0 ELSE 1 END,
               CASE WHEN $4 THEN 'healthy' ELSE 'warning' END,
               $8, $9, NOW())
       ON CONFLICT (worker_name) DO UPDATE SET
         fleet                = 'settle',
         criticality          = EXCLUDED.criticality,
         expected_interval_ms = EXCLUDED.expected_interval_ms,
         last_tick_at         = NOW(),
         last_ok_at           = CASE WHEN $4 THEN NOW() ELSE worker_health.last_ok_at END,
         last_error           = CASE WHEN $4 THEN worker_health.last_error ELSE $5 END,
         tick_seq             = worker_health.tick_seq + 1,
         items_processed      = worker_health.items_processed + $6,
         last_batch_size      = COALESCE($7, worker_health.last_batch_size),
         consecutive_errors   = CASE WHEN $4 THEN 0 ELSE worker_health.consecutive_errors + 1 END,
         status               = CASE WHEN $4 THEN 'healthy' ELSE 'warning' END,
         pid                  = $8,
         host                 = $9,
         updated_at           = NOW()`,
      [
        h.worker,
        h.criticality,
        h.intervalMs,
        h.ok,
        h.error ?? null,
        h.items ?? 0,
        h.batch ?? null,
        PID,
        HOST,
      ],
    );
  } catch {
    /* heartbeat must never throw into the worker loop */
  }
  writeRedisHeartbeat(h);
}

/** Best-effort Redis "live" mirror with a TTL so a dead worker's key expires. */
function writeRedisHeartbeat(h: HeartbeatInput): void {
  try {
    if (!redis) return;
    const ttlSec = Math.max(120, Math.ceil((h.intervalMs * 4) / 1000));
    const payload = JSON.stringify({
      worker: h.worker,
      fleet: 'settle',
      status: h.ok ? 'healthy' : 'warning',
      ok: h.ok,
      lastTickAt: new Date().toISOString(),
      error: h.error ?? null,
      pid: PID,
      host: HOST,
    });
    void redis.set(`worker_health:${h.worker}`, payload, 'EX', ttlSec).catch(() => {});
  } catch {
    /* swallow — Redis is an optional live mirror, not the source of truth */
  }
}

/**
 * Run a worker tick with a timeout guard + heartbeat. Returns void and never
 * throws — see the core-api twin's docblock for the full contract. The wrapped
 * tick's own logic is unchanged; this only bounds the run and records liveness.
 */
export async function runWorkerTick(
  worker: string,
  opts: WorkerTickOpts,
  fn: () => Promise<TickResult | void>,
): Promise<void> {
  const intervalMs = opts.intervalMs;
  const criticality = opts.criticality ?? 'medium';
  const budget = opts.timeoutMs ?? Math.max(15_000, Math.round(intervalMs * 1.5));
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    const result = await Promise.race<TickResult | void>([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`tick exceeded ${budget}ms budget`)),
          budget,
        );
      }),
    ]);
    const items =
      result && typeof result === 'object' && typeof result.items === 'number'
        ? result.items
        : 0;
    await recordHeartbeat({
      worker,
      intervalMs,
      criticality,
      ok: true,
      items,
      batch: items,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      safeLog({
        type: `worker.tick_failed.${worker}`,
        severity: 'ERROR',
        source: 'worker',
        message: `Worker "${worker}" tick failed: ${msg}`,
        metadata: { worker, duration_ms: Date.now() - t0 },
      });
    } catch {
      /* swallow */
    }
    await recordHeartbeat({
      worker,
      intervalMs,
      criticality,
      ok: false,
      error: msg,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Mark a worker as cleanly stopped (call from graceful-shutdown handlers). */
export async function markWorkerStopped(worker: string): Promise<void> {
  try {
    await query(
      `UPDATE worker_health SET status = 'stopped', updated_at = NOW() WHERE worker_name = $1`,
      [worker],
    );
  } catch {
    /* swallow */
  }
}
