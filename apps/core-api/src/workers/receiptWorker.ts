/**
 * Receipt Worker (BullMQ)
 *
 * Processes CREATE_RECEIPT and UPDATE_RECEIPT jobs from the receiptQueue.
 * Handles retries (3 attempts, exponential backoff) and logs all failures
 * with the orderId for traceability.
 */
import { Worker } from 'bullmq';
import { getRedisConnection, type ReceiptJobData } from '../queues/receiptQueue';
import { createOrderReceipt, updateOrderReceipt } from '../receipts';
import { logger } from 'settlement-core';
import { runWorkerTick } from './workerHealth';

let worker: Worker<ReceiptJobData> | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let processedCount = 0;
let lastReportedCount = 0;
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function startReceiptWorker() {
  const redis = getRedisConnection();
  if (!redis) {
    logger.warn('[ReceiptWorker] Redis unavailable — worker not started');
    // Surface the silent non-start: record one failed heartbeat so the worker
    // appears in worker_health and the checker flags it, instead of it simply
    // never existing.
    await runWorkerTick(
      'receiptWorker',
      { intervalMs: HEARTBEAT_INTERVAL_MS, criticality: 'medium', timeoutMs: 15_000 },
      async () => { throw new Error('Redis unavailable at boot — receipt worker not started'); },
    );
    return;
  }
  // Test connectivity before creating the worker
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    logger.warn('[ReceiptWorker] Redis not reachable — worker not started');
    await runWorkerTick(
      'receiptWorker',
      { intervalMs: HEARTBEAT_INTERVAL_MS, criticality: 'medium', timeoutMs: 15_000 },
      async () => { throw new Error('Redis not reachable at boot — receipt worker not started'); },
    );
    return;
  }
  worker = new Worker<ReceiptJobData>(
    'receiptQueue',
    async (job) => {
      const { data } = job;

      switch (data.type) {
        case 'CREATE_RECEIPT': {
          logger.info('[ReceiptWorker] Processing CREATE_RECEIPT', {
            orderId: data.orderId,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
          });
          // Dates arrive as ISO strings from the queue — convert back
          const order = {
            ...data.order,
            accepted_at: data.order.accepted_at ? new Date(data.order.accepted_at) : null,
            escrowed_at: data.order.escrowed_at ? new Date(data.order.escrowed_at) : null,
          };
          await createOrderReceipt(data.orderId, order, data.actorId);
          break;
        }

        case 'UPDATE_RECEIPT': {
          logger.info('[ReceiptWorker] Processing UPDATE_RECEIPT', {
            orderId: data.orderId,
            newStatus: data.newStatus,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
          });
          const updated = await updateOrderReceipt(data.orderId, data.newStatus, data.fields);
          if (!updated) {
            // Guard rejected the write (terminal status or not a forward transition).
            // This is expected — not a failure, so don't retry.
            logger.info('[ReceiptWorker] Update was a no-op (guard rejected)', {
              orderId: data.orderId,
              newStatus: data.newStatus,
            });
          }
          break;
        }

        default:
          logger.error('[ReceiptWorker] Unknown job type', { data });
      }
    },
    {
      connection: redis as any,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    processedCount++;
    logger.info('[ReceiptWorker] Job completed', {
      jobId: job.id,
      orderId: (job.data as ReceiptJobData).orderId,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('[ReceiptWorker] Job failed', {
      jobId: job?.id,
      orderId: job ? (job.data as ReceiptJobData).orderId : 'unknown',
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  // BullMQ is event-driven (no poll loop), so emit a periodic liveness
  // heartbeat. The tick pings the worker's Redis lifeline — a wedged Redis
  // (worker silently stops pulling jobs) surfaces as a failed tick, and a dead
  // process stops the heartbeat entirely (→ goes stale → checker flags it).
  // items = jobs completed since the last heartbeat (delta, not cumulative).
  heartbeatTimer = setInterval(() => {
    void runWorkerTick(
      'receiptWorker',
      { intervalMs: HEARTBEAT_INTERVAL_MS, criticality: 'medium', timeoutMs: 15_000 },
      async () => {
        await redis.ping();
        const delta = processedCount - lastReportedCount;
        lastReportedCount = processedCount;
        return { items: delta };
      },
    );
  }, HEARTBEAT_INTERVAL_MS);

  logger.info('[ReceiptWorker] Started');
}

export async function stopReceiptWorker() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('[ReceiptWorker] Stopped');
  }
}
