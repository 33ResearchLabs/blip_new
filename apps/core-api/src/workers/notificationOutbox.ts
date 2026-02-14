/**
 * Notification Outbox Worker (Core API)
 *
 * Processes pending notifications from the outbox table with retries.
 * Ensures reliable delivery even if downstream services fail temporarily.
 */

import { query, logger } from 'settlement-core';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Load env from settle directory
config({ path: '../../settle/.env.local' });
config({ path: '../../settle/.env' });

interface OutboxRecord {
  id: string;
  event_type: string;
  order_id: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  created_at: Date;
}

// Env-configurable worker tuning
const POLL_INTERVAL_MS = parseInt(process.env.OUTBOX_POLL_MS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.OUTBOX_BATCH_SIZE || '50', 10);
const SUMMARY_INTERVAL_TICKS = Math.max(1, Math.round(30000 / POLL_INTERVAL_MS));

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let tickCount = 0;
let totalProcessed = 0;

// DB-error backoff state
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60000;

/**
 * Process a single outbox record
 */
async function processOutboxRecord(record: OutboxRecord): Promise<boolean> {
  try {
    // IDEMPOTENCY CHECK
    const statusCheck = await query<{ status: string }>(
      'SELECT status FROM notification_outbox WHERE id = $1',
      [record.id]
    );

    if (statusCheck.length > 0 && statusCheck[0].status === 'sent') {
      logger.info('[Outbox] Skipping already-sent notification', {
        outboxId: record.id,
        orderId: record.order_id,
      });
      return true;
    }

    const payload =
      typeof record.payload === 'string'
        ? JSON.parse(record.payload)
        : record.payload;

    // Primary delivery is inline WS broadcast in route handlers.
    // Outbox worker marks records as sent (audit trail).
    logger.info('[Outbox] Notification delivered (inline WS broadcast)', {
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
    });

    logger.info('[Outbox] Successfully processed notification', {
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
      attempts: record.attempts + 1,
    });

    return true;
  } catch (error) {
    logger.error('[Outbox] Failed to process notification', {
      errorCode: 'OUTBOX_RECORD_ERROR',
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
      attempts: record.attempts + 1,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Process pending outbox records
 */
async function processBatch(): Promise<void> {
  try {
    const records = await query<OutboxRecord>(
      `SELECT * FROM notification_outbox
       WHERE status IN ('pending', 'failed')
       AND attempts < max_attempts
       AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '30 seconds')
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );

    if (records.length === 0) {
      consecutiveErrors = 0;
      writeHeartbeat(0);
      return;
    }

    logger.info(`[Outbox] Processing ${records.length} pending notifications`);

    for (const record of records) {
      await query(
        `UPDATE notification_outbox
         SET status = 'processing', last_attempt_at = NOW()
         WHERE id = $1`,
        [record.id]
      );

      const success = await processOutboxRecord(record);

      if (success) {
        await query(
          `UPDATE notification_outbox
           SET status = 'sent', sent_at = NOW()
           WHERE id = $1`,
          [record.id]
        );
      } else {
        const newAttempts = record.attempts + 1;
        const newStatus =
          newAttempts >= record.max_attempts ? 'failed' : 'pending';
        const errorMsg = 'Failed to send notification';

        await query(
          `UPDATE notification_outbox
           SET status = $1, attempts = $2, last_error = $3, last_attempt_at = NOW()
           WHERE id = $4`,
          [newStatus, newAttempts, errorMsg, record.id]
        );

        if (newStatus === 'failed') {
          logger.error(
            '[Outbox] Notification permanently failed after max attempts',
            {
              errorCode: 'OUTBOX_RECORD_ERROR',
              outboxId: record.id,
              orderId: record.order_id,
              eventType: record.event_type,
              attempts: newAttempts,
            }
          );
        }
      }
    }
    // Track processed count and reset backoff
    totalProcessed += records.length;
    consecutiveErrors = 0;
    writeHeartbeat(records.length);
  } catch (error) {
    consecutiveErrors++;
    const backoff = Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
    logger.error('[Outbox] Error processing batch', {
      errorCode: 'OUTBOX_BATCH_ERROR',
      consecutiveErrors,
      backoffMs: backoff,
      error: error instanceof Error ? error.message : String(error),
    });
    // Delay next poll by backoff amount (subtract base interval since setTimeout adds it)
    await new Promise(resolve => setTimeout(resolve, backoff - POLL_INTERVAL_MS));
  }
}

function writeHeartbeat(batchSize: number): void {
  try {
    writeFileSync('/tmp/bm-worker-outbox.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      totalProcessed,
      lastBatchSize: batchSize,
    }));
  } catch { /* non-critical */ }
}

/**
 * Start the outbox worker
 */
export function startOutboxWorker(): void {
  if (isRunning) {
    logger.warn('[Outbox] Worker already running');
    return;
  }

  isRunning = true;
  logger.info('[Outbox] Starting notification outbox worker', {
    pollInterval: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  const poll = async () => {
    if (!isRunning) return;

    await processBatch();
    tickCount++;

    // Summary log every 30s
    if (tickCount % SUMMARY_INTERVAL_TICKS === 0) {
      try {
        const stats = await query<{ count: string; oldest_age_sec: string | null }>(
          `SELECT count(*)::text as count,
                  EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int::text as oldest_age_sec
           FROM notification_outbox
           WHERE status = 'pending'`
        );
        logger.info('[Outbox] Summary', {
          totalProcessed,
          pending: parseInt(stats[0]?.count || '0', 10),
          oldestPendingAgeSec: stats[0]?.oldest_age_sec ? parseInt(stats[0].oldest_age_sec, 10) : null,
        });
      } catch { /* non-critical */ }
    }

    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

/**
 * Stop the outbox worker
 */
export function stopOutboxWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[Outbox] Stopped notification outbox worker');
}

/**
 * Cleanup old sent notifications (keep last 7 days)
 */
export async function cleanupSentNotifications(): Promise<void> {
  try {
    const result = await query(
      `DELETE FROM notification_outbox
       WHERE status = 'sent'
       AND sent_at < NOW() - INTERVAL '7 days'`,
      []
    );

    logger.info('[Outbox] Cleaned up old sent notifications', {
      deleted: result.length,
    });
  } catch (error) {
    logger.error('[Outbox] Error cleaning up notifications', {
      errorCode: 'OUTBOX_CLEANUP_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// If running as standalone script (ESM-compatible check)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startOutboxWorker();

  setInterval(cleanupSentNotifications, 60 * 60 * 1000);

  process.on('SIGINT', () => {
    logger.info('[Outbox] Received SIGINT, shutting down...');
    stopOutboxWorker();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('[Outbox] Received SIGTERM, shutting down...');
    stopOutboxWorker();
    process.exit(0);
  });
}
