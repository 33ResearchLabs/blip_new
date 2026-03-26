/**
 * Outbox Event Worker (Core API)
 *
 * Polls the outbox_events table for pending order events and emits them
 * through the existing orderBus. This guarantees reliable delivery even
 * if the process crashes between DB commit and event emission.
 *
 * Processing flow:
 *   1. Claim a batch of pending events (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED))
 *   2. For each event, emit via orderBus.emitOrderEvent()
 *   3. Mark as 'processed'
 *   4. On failure: increment retry_count, mark as 'failed' after max retries
 *
 * Recovery:
 *   - Events stuck in 'processing' for > 60s are reset to 'pending'
 *   - Processed events older than 7 days are cleaned up
 */
import { query, logger } from 'settlement-core';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { orderBus, type OrderEventPayload } from '../events';

interface OutboxEventRecord {
  id: string;
  event_type: string;
  payload: any;
  status: string;
  retry_count: number;
  max_retries: number;
  created_at: Date;
}

// ── Tuning ──────────────────────────────────────────────────────
const POLL_INTERVAL_MS = parseInt(process.env.OUTBOX_EVENT_POLL_MS || '2000', 10);
const BATCH_SIZE = parseInt(process.env.OUTBOX_EVENT_BATCH_SIZE || '50', 10);
const STUCK_TIMEOUT_SEC = parseInt(process.env.OUTBOX_EVENT_STUCK_SEC || '60', 10);
const SUMMARY_INTERVAL_TICKS = Math.max(1, Math.round(30000 / POLL_INTERVAL_MS));

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let tickCount = 0;
let totalProcessed = 0;

// DB-error backoff state
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60000;

/**
 * Process a single outbox event: parse payload → emit via orderBus.
 */
function processEvent(record: OutboxEventRecord): void {
  const payload: OrderEventPayload =
    typeof record.payload === 'string'
      ? JSON.parse(record.payload)
      : record.payload;

  orderBus.emitOrderEvent(payload);
}

/**
 * Recover events stuck in 'processing' for too long.
 * This handles the case where the worker crashed mid-processing.
 */
async function recoverStuckEvents(): Promise<void> {
  try {
    const result = await query(
      `UPDATE outbox_events
       SET status = 'pending'
       WHERE status = 'processing'
         AND last_attempt_at < NOW() - INTERVAL '${STUCK_TIMEOUT_SEC} seconds'
       RETURNING id`,
      []
    );
    if (result.length > 0) {
      logger.info('[OutboxEvent] Recovered stuck events', { count: result.length });
    }
  } catch (err) {
    logger.error('[OutboxEvent] Error recovering stuck events', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Process a batch of pending outbox events.
 */
async function processBatch(): Promise<void> {
  try {
    // Claim a batch: atomically mark as 'processing' using a CTE
    const records = await query<OutboxEventRecord>(
      `WITH claimed AS (
         SELECT id FROM outbox_events
         WHERE status = 'pending'
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events e
       SET status = 'processing', last_attempt_at = NOW()
       FROM claimed c
       WHERE e.id = c.id
       RETURNING e.*`,
      [BATCH_SIZE]
    );

    if (records.length === 0) {
      consecutiveErrors = 0;
      writeHeartbeat(0);
      return;
    }

    logger.info(`[OutboxEvent] Processing ${records.length} pending events`);

    for (const record of records) {
      try {
        processEvent(record);

        // Mark as processed
        await query(
          `UPDATE outbox_events
           SET status = 'processed', processed_at = NOW()
           WHERE id = $1`,
          [record.id]
        );
      } catch (err) {
        // Increment retry count, mark failed if max retries exceeded
        const newRetryCount = record.retry_count + 1;
        const newStatus = newRetryCount >= record.max_retries ? 'failed' : 'pending';
        const errorMsg = err instanceof Error ? err.message : String(err);

        await query(
          `UPDATE outbox_events
           SET status = $1, retry_count = $2, last_error = $3, last_attempt_at = NOW()
           WHERE id = $4`,
          [newStatus, newRetryCount, errorMsg, record.id]
        );

        if (newStatus === 'failed') {
          logger.error('[OutboxEvent] Event permanently failed after max retries', {
            errorCode: 'OUTBOX_EVENT_FAILED',
            outboxId: record.id,
            eventType: record.event_type,
            retryCount: newRetryCount,
            error: errorMsg,
          });
        } else {
          logger.warn('[OutboxEvent] Event processing failed, will retry', {
            outboxId: record.id,
            eventType: record.event_type,
            retryCount: newRetryCount,
            error: errorMsg,
          });
        }
      }
    }

    totalProcessed += records.length;
    consecutiveErrors = 0;
    writeHeartbeat(records.length);
  } catch (error) {
    consecutiveErrors++;
    const backoff = Math.min(
      POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors),
      MAX_BACKOFF_MS
    );
    logger.error('[OutboxEvent] Error processing batch', {
      errorCode: 'OUTBOX_EVENT_BATCH_ERROR',
      consecutiveErrors,
      backoffMs: backoff,
      error: error instanceof Error ? error.message : String(error),
    });
    await new Promise((resolve) => setTimeout(resolve, backoff - POLL_INTERVAL_MS));
  }
}

function writeHeartbeat(batchSize: number): void {
  try {
    writeFileSync(
      '/tmp/bm-worker-outbox-event.json',
      JSON.stringify({
        lastRun: new Date().toISOString(),
        totalProcessed,
        lastBatchSize: batchSize,
      })
    );
  } catch {
    /* non-critical */
  }
}

/**
 * Start the outbox event worker.
 */
export function startOutboxEventWorker(): void {
  if (isRunning) {
    logger.warn('[OutboxEvent] Worker already running');
    return;
  }

  isRunning = true;
  logger.info('[OutboxEvent] Starting outbox event worker', {
    pollInterval: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    stuckTimeoutSec: STUCK_TIMEOUT_SEC,
  });

  const poll = async () => {
    if (!isRunning) return;

    await processBatch();
    tickCount++;

    // Periodic recovery + summary (every ~30s)
    if (tickCount % SUMMARY_INTERVAL_TICKS === 0) {
      await recoverStuckEvents();

      try {
        const stats = await query<{
          pending: string;
          processing: string;
          failed: string;
          oldest_age_sec: string | null;
        }>(
          `SELECT
             count(*) FILTER (WHERE status = 'pending')::text    AS pending,
             count(*) FILTER (WHERE status = 'processing')::text AS processing,
             count(*) FILTER (WHERE status = 'failed')::text     AS failed,
             EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))::int::text AS oldest_age_sec
           FROM outbox_events
           WHERE status IN ('pending', 'processing', 'failed')`
        );
        const s = stats[0];
        logger.info('[OutboxEvent] Summary', {
          totalProcessed,
          pending: parseInt(s?.pending || '0', 10),
          processing: parseInt(s?.processing || '0', 10),
          failed: parseInt(s?.failed || '0', 10),
          oldestPendingAgeSec: s?.oldest_age_sec
            ? parseInt(s.oldest_age_sec, 10)
            : null,
        });
      } catch {
        /* non-critical */
      }
    }

    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

/**
 * Stop the outbox event worker.
 */
export function stopOutboxEventWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[OutboxEvent] Stopped outbox event worker');
}

/**
 * Cleanup old processed events (keep last 7 days).
 */
export async function cleanupProcessedEvents(): Promise<void> {
  try {
    const result = await query(
      `DELETE FROM outbox_events
       WHERE status = 'processed'
         AND processed_at < NOW() - INTERVAL '7 days'
       RETURNING id`,
      []
    );
    if (result.length > 0) {
      logger.info('[OutboxEvent] Cleaned up old processed events', {
        deleted: result.length,
      });
    }
  } catch (error) {
    logger.error('[OutboxEvent] Error cleaning up events', {
      errorCode: 'OUTBOX_EVENT_CLEANUP_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// If running as standalone script
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startOutboxEventWorker();

  const cleanupInterval = setInterval(cleanupProcessedEvents, 60 * 60 * 1000);

  const shutdownStandalone = () => {
    logger.info('[OutboxEvent] Shutting down...');
    clearInterval(cleanupInterval);
    stopOutboxEventWorker();
    process.exit(0);
  };

  process.on('SIGINT', shutdownStandalone);
  process.on('SIGTERM', shutdownStandalone);
}
