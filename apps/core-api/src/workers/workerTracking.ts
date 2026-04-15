/**
 * Worker tracking helper — wrap any `async () => void` tick function so
 * uncaught errors are logged to error_logs with the worker name, without
 * changing the worker's behavior.
 *
 * Usage:
 *   setInterval(() => runTickTracked('outbox', async () => { ... }), 5000);
 *
 * Or wrap in-place:
 *   setInterval(trackedTick('outbox', async () => { ... }), 5000);
 */

import { safeLog } from 'settlement-core';

/**
 * Execute `fn` once; on throw, log the error and re-throw so existing
 * monitoring / retry logic still sees it. Returns the result of fn().
 */
export async function runTickTracked<T>(
  workerName: string,
  fn: () => Promise<T>,
  extraMeta?: Record<string, unknown>,
): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } catch (err) {
    try {
      const e = err as { message?: string; stack?: string; name?: string };
      safeLog({
        type: `worker.tick_failed.${workerName}`,
        severity: 'ERROR',
        message: `Worker "${workerName}" tick failed: ${e?.message || String(err)}`,
        source: 'worker',
        metadata: {
          worker: workerName,
          duration_ms: Date.now() - t0,
          errorName: e?.name,
          stack: e?.stack?.slice(0, 4000),
          ...(extraMeta || {}),
        },
      });
    } catch { /* swallow */ }
    throw err;
  }
}

/** Sync wrapper for setInterval / setTimeout callers — catches and logs, never re-throws. */
export function trackedTick(
  workerName: string,
  fn: () => Promise<void>,
  extraMeta?: Record<string, unknown>,
): () => void {
  return () => {
    void (async () => {
      try {
        await runTickTracked(workerName, fn, extraMeta);
      } catch {
        // runTickTracked already logged it; swallow here so setInterval
        // doesn't see an unhandled rejection.
      }
    })();
  };
}
