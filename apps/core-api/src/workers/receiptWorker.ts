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

let worker: Worker<ReceiptJobData> | null = null;

export async function startReceiptWorker() {
  const redis = getRedisConnection();
  if (!redis) {
    logger.warn('[ReceiptWorker] Redis unavailable — worker not started');
    return;
  }
  // Test connectivity before creating the worker
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    logger.warn('[ReceiptWorker] Redis not reachable — worker not started');
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
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
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

  logger.info('[ReceiptWorker] Started');
}

export async function stopReceiptWorker() {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('[ReceiptWorker] Stopped');
  }
}
