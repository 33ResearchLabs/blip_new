/**
 * Idempotency Log Cleanup Worker (Core API)
 *
 * Periodically purges expired entries from the idempotency_log table
 * to prevent unbounded table growth.
 *
 * Runs every 60 minutes by default (configurable via IDEMPOTENCY_CLEANUP_INTERVAL_MS).
 * Deletes in batches to avoid long-running deletes that block other queries.
 */

import { query, logger } from 'settlement-core';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const CLEANUP_INTERVAL_MS = parseInt(process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS || '3600000', 10); // 1 hour
const BATCH_SIZE = parseInt(process.env.IDEMPOTENCY_CLEANUP_BATCH_SIZE || '500', 10);

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let totalCleaned = 0;

/**
 * Delete expired idempotency records in batches.
 * Returns the total number of deleted rows.
 */
async function cleanupBatch(): Promise<number> {
  try {
    // Delete a batch of expired entries (uses idx_idempotency_log_expires_at)
    const result = await query<{ id: string }>(
      `DELETE FROM idempotency_log
       WHERE id IN (
         SELECT id FROM idempotency_log
         WHERE expires_at < NOW()
         LIMIT $1
       )
       RETURNING id`,
      [BATCH_SIZE]
    );

    const deleted = result.length;

    if (deleted > 0) {
      totalCleaned += deleted;
      logger.info('[IdempotencyCleanup] Purged expired entries', {
        deleted,
        totalCleaned,
      });
    }

    // If we deleted a full batch, there might be more — recurse
    if (deleted >= BATCH_SIZE) {
      const more = await cleanupBatch();
      return deleted + more;
    }

    return deleted;
  } catch (error) {
    logger.error('[IdempotencyCleanup] Error during cleanup', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

function writeHeartbeat(deleted: number): void {
  try {
    writeFileSync('/tmp/bm-worker-idempotency-cleanup.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      totalCleaned,
      lastBatchDeleted: deleted,
    }));
  } catch { /* non-critical */ }
}

async function tick(): Promise<void> {
  if (!isRunning) return;

  const deleted = await cleanupBatch();
  writeHeartbeat(deleted);

  if (isRunning) {
    pollTimer = setTimeout(tick, CLEANUP_INTERVAL_MS);
  }
}

export function startIdempotencyCleanupWorker(): void {
  if (isRunning) {
    logger.warn('[IdempotencyCleanup] Worker already running');
    return;
  }

  isRunning = true;
  logger.info('[IdempotencyCleanup] Starting cleanup worker', {
    intervalMs: CLEANUP_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  // First tick after 30 seconds (let other workers start first)
  pollTimer = setTimeout(tick, 30000);
}

export function stopIdempotencyCleanupWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[IdempotencyCleanup] Stopped cleanup worker');
}

// Standalone entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startIdempotencyCleanupWorker();

  const shutdown = () => {
    stopIdempotencyCleanupWorker();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
