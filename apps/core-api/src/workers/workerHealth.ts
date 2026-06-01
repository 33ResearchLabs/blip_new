/**
 * Worker heartbeat helper — core-api fleet.
 *
 * Wraps a worker tick so that, WITHOUT changing the tick's behaviour, every
 * run:
 *   1. is bounded by a timeout (so a hung await can never freeze the loop's
 *      re-arm — runWorkerTick always resolves within budget), and
 *   2. records a durable heartbeat into the shared `worker_health` table
 *      (migration 150) plus a best-effort Redis "live" key.
 *
 * This is the core-api twin of settle/src/lib/workerHealth.ts. Both write the
 * SAME table + Redis key scheme so the health checker and the admin dashboard
 * see one unified view across both fleets. Keep the two in sync.
 *
 * Design rules (zero-regression):
 *   - recordHeartbeat / writeRedisHeartbeat NEVER throw — a heartbeat failure
 *     must never propagate into a money-critical worker loop.
 *   - The Redis write is fire-and-forget and optional; Postgres is the durable
 *     source of truth.
 *   - This module is inert until a worker imports and calls runWorkerTick.
 */

import { hostname } from 'node:os';
import { query, safeLog } from 'settlement-core';
import { getRedisConnection } from '../queues/receiptQueue';

export type Fleet = 'core-api' | 'settle';
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
  fleet: Fleet;
  intervalMs: number;
  criticality: Criticality;
  ok: boolean;
  items?: number;
  batch?: number | null;
  error?: string;
}

/**
 * UPSERT one heartbeat row. Increments tick_seq + items_processed, refreshes
 * last_tick_at on every tick, and last_ok_at only on success. Swallows all
 * errors — callers in worker loops must never see a throw from here.
 */
async function recordHeartbeat(h: HeartbeatInput): Promise<void> {
  try {
    await query(
      `INSERT INTO worker_health
         (worker_name, fleet, criticality, expected_interval_ms,
          last_tick_at, last_ok_at, last_error, tick_seq, items_processed,
          last_batch_size, consecutive_errors, status, pid, host, updated_at)
       VALUES ($1, $2, $3, $4,
               NOW(),
               CASE WHEN $5 THEN NOW() ELSE NULL END,
               $6, 1, $7, $8,
               CASE WHEN $5 THEN 0 ELSE 1 END,
               CASE WHEN $5 THEN 'healthy' ELSE 'warning' END,
               $9, $10, NOW())
       ON CONFLICT (worker_name) DO UPDATE SET
         fleet                = EXCLUDED.fleet,
         criticality          = EXCLUDED.criticality,
         expected_interval_ms = EXCLUDED.expected_interval_ms,
         last_tick_at         = NOW(),
         last_ok_at           = CASE WHEN $5 THEN NOW() ELSE worker_health.last_ok_at END,
         last_error           = CASE WHEN $5 THEN worker_health.last_error ELSE $6 END,
         tick_seq             = worker_health.tick_seq + 1,
         items_processed      = worker_health.items_processed + $7,
         last_batch_size      = COALESCE($8, worker_health.last_batch_size),
         consecutive_errors   = CASE WHEN $5 THEN 0 ELSE worker_health.consecutive_errors + 1 END,
         status               = CASE WHEN $5 THEN 'healthy' ELSE 'warning' END,
         pid                  = $9,
         host                 = $10,
         updated_at           = NOW()`,
      [
        h.worker,
        h.fleet,
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
    const r = getRedisConnection();
    if (!r) return;
    const ttlSec = Math.max(120, Math.ceil((h.intervalMs * 4) / 1000));
    const payload = JSON.stringify({
      worker: h.worker,
      fleet: h.fleet,
      status: h.ok ? 'healthy' : 'warning',
      ok: h.ok,
      lastTickAt: new Date().toISOString(),
      error: h.error ?? null,
      pid: PID,
      host: HOST,
    });
    void r.set(`worker_health:${h.worker}`, payload, 'EX', ttlSec).catch(() => {});
  } catch {
    /* swallow — Redis is an optional live mirror, not the source of truth */
  }
}

/**
 * Run a worker tick with a timeout guard + heartbeat. Returns void and never
 * throws: the wrapped `fn` keeps its own behaviour, but a hang is bounded
 * (records a failure heartbeat after `timeoutMs`) and a thrown error is logged
 * + recorded instead of escaping into the caller's loop. The wrapped worker's
 * existing setInterval / recursive-setTimeout re-arm therefore always fires.
 *
 * NOTE: the timeout bounds *detection*, not the underlying I/O — a wrapped
 * worker that can genuinely hang should still add per-call AbortSignals
 * (handled per-worker in a later phase). All money-critical workers here use
 * FOR UPDATE SKIP LOCKED + order_version guards, so an overlapping tick after
 * a timeout cannot double-process.
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
      fleet: 'core-api',
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
      fleet: 'core-api',
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
