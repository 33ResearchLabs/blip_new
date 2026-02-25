/**
 * Notification Outbox Worker
 *
 * Processes pending notifications from the outbox table with retries.
 * Ensures reliable delivery even if Pusher/WebSocket fails temporarily.
 *
 * Usage:
 * - Start: node -r esbuild-register src/workers/notificationOutbox.ts
 * - Or: import and call startOutboxWorker() from server startup
 */

import { query } from '../lib/db';
import { notifyOrderStatusUpdated } from '../lib/pusher/server';
import { wsBroadcastOrderUpdate } from '../lib/websocket/broadcast';
import { logger } from 'settlement-core';

/**
 * Export helper for monitoring stuck notifications
 * This is used in tests and can be called by monitoring scripts
 */
export { findStuckOutboxNotifications } from 'settlement-core/finalization';

interface OutboxRecord {
  id: string;
  event_type: string;
  order_id: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  created_at: Date;
}

const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const BATCH_SIZE = 50; // Process up to 50 notifications per batch
const BASE_RETRY_DELAY_S = 5; // Exponential backoff base: 5 seconds
const MAX_RETRY_DELAY_S = 300; // Cap at 5 minutes
const JITTER_FACTOR = 0.2; // 20% randomized jitter

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

/**
 * Calculate exponential backoff delay in seconds with jitter.
 * Schedule: 5s → 10s → 20s → 40s → 80s → 160s → 300s → 300s
 */
function getBackoffDelaySec(attempt: number): number {
  const delay = Math.min(BASE_RETRY_DELAY_S * Math.pow(2, attempt), MAX_RETRY_DELAY_S);
  const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1); // ±20%
  return Math.max(1, Math.round(delay + jitter));
}

/**
 * Move a permanently failed record to the dead letter queue for post-mortem analysis.
 */
async function moveToDeadLetterQueue(
  record: OutboxRecord,
  lastError: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO notification_dead_letters
       (original_outbox_id, event_type, order_id, payload, attempts,
        last_error, first_attempt_at, last_attempt_at, dead_lettered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        record.id,
        record.event_type,
        record.order_id,
        typeof record.payload === 'string' ? record.payload : JSON.stringify(record.payload),
        record.attempts + 1,
        lastError,
        record.created_at,
      ]
    );
    logger.warn('[Outbox] Moved to dead letter queue', {
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
      attempts: record.attempts + 1,
    });
  } catch (dlqError) {
    // DLQ insert failed — log but don't crash the worker
    logger.error('[Outbox] Failed to write to dead letter queue', {
      outboxId: record.id,
      orderId: record.order_id,
      error: dlqError instanceof Error ? dlqError.message : String(dlqError),
    });
  }
}

/**
 * Process a single outbox record
 */
async function processOutboxRecord(record: OutboxRecord): Promise<boolean> {
  try {
    // IDEMPOTENCY CHECK: Do not re-send if already marked as sent
    // This prevents duplicate notifications if the record status is corrupted
    // or if the worker is restarted during processing
    const statusCheck = await query<{ status: string }>(
      'SELECT status FROM notification_outbox WHERE id = $1',
      [record.id]
    );

    if (statusCheck.length > 0 && statusCheck[0].status === 'sent') {
      logger.info('[Outbox] Skipping already-sent notification', {
        outboxId: record.id,
        orderId: record.order_id,
      });
      return true; // Already sent, consider it successful
    }

    const payload = typeof record.payload === 'string'
      ? JSON.parse(record.payload)
      : record.payload;

    // Send Pusher notification
    await notifyOrderStatusUpdated(payload);

    // Send WebSocket broadcast
    if (payload.data) {
      await wsBroadcastOrderUpdate({
        orderId: payload.orderId,
        status: payload.status,
        minimalStatus: payload.minimalStatus || payload.status,
        previousStatus: payload.previousStatus,
        orderVersion: payload.orderVersion,
        updatedAt: payload.updatedAt,
        data: payload.data,
      });
    }

    // Handle M2M buyer merchant notification
    if (payload.buyerMerchantId && payload.buyerMerchantId !== payload.merchantId) {
      await notifyOrderStatusUpdated({
        ...payload,
        merchantId: payload.buyerMerchantId,
      });
    }

    logger.info('[Outbox] Successfully processed notification', {
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
      attempts: record.attempts + 1,
    });

    return true;
  } catch (error) {
    logger.error('[Outbox] Failed to process notification', {
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
    // Fetch pending records with exponential backoff:
    // Only retry records whose backoff delay has elapsed.
    // Backoff: 5s * 2^attempts, capped at 300s.
    const records = await query<OutboxRecord>(
      `SELECT * FROM notification_outbox
       WHERE status IN ('pending', 'failed')
       AND attempts < max_attempts
       AND (
         last_attempt_at IS NULL
         OR last_attempt_at < NOW() - (LEAST(${BASE_RETRY_DELAY_S} * POW(2, attempts), ${MAX_RETRY_DELAY_S}) || ' seconds')::INTERVAL
       )
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );

    if (records.length === 0) {
      return; // No work to do
    }

    logger.info(`[Outbox] Processing ${records.length} pending notifications`);

    for (const record of records) {
      // Mark as processing
      await query(
        `UPDATE notification_outbox
         SET status = 'processing', last_attempt_at = NOW()
         WHERE id = $1`,
        [record.id]
      );

      const success = await processOutboxRecord(record);

      if (success) {
        // Mark as sent
        await query(
          `UPDATE notification_outbox
           SET status = 'sent', sent_at = NOW()
           WHERE id = $1`,
          [record.id]
        );
      } else {
        // Increment attempts, check if permanently failed
        const newAttempts = record.attempts + 1;
        const isPermanentFailure = newAttempts >= record.max_attempts;
        const newStatus = isPermanentFailure ? 'failed' : 'pending';
        const errorMsg = 'Failed to send notification';
        const nextRetryDelay = getBackoffDelaySec(newAttempts);

        await query(
          `UPDATE notification_outbox
           SET status = $1, attempts = $2, last_error = $3, last_attempt_at = NOW()
           WHERE id = $4`,
          [newStatus, newAttempts, errorMsg, record.id]
        );

        if (isPermanentFailure) {
          // Move to dead letter queue for post-mortem analysis
          await moveToDeadLetterQueue(record, errorMsg);
          logger.error('[Outbox] Notification permanently failed — moved to DLQ', {
            outboxId: record.id,
            orderId: record.order_id,
            eventType: record.event_type,
            attempts: newAttempts,
          });
        } else {
          logger.info('[Outbox] Will retry notification', {
            outboxId: record.id,
            orderId: record.order_id,
            attempt: newAttempts,
            nextRetryInSec: nextRetryDelay,
          });
        }
      }
    }
  } catch (error) {
    logger.error('[Outbox] Error processing batch', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

    // Schedule next poll
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  // Start polling
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
       AND sent_at < NOW() - INTERVAL '7 days'
       RETURNING id`,
      []
    );

    logger.info('[Outbox] Cleaned up old sent notifications', {
      deleted: result.length,
    });
  } catch (error) {
    logger.error('[Outbox] Error cleaning up notifications', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// If running as standalone script
if (require.main === module) {
  startOutboxWorker();

  // Cleanup every hour
  setInterval(cleanupSentNotifications, 60 * 60 * 1000);

  // Graceful shutdown
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
