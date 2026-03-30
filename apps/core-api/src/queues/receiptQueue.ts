/**
 * Receipt Queue (BullMQ + ioredis)
 *
 * Enqueues receipt creation and update jobs so the API response
 * is never blocked by receipt processing. Jobs are retried
 * automatically with exponential backoff.
 *
 * If Redis is unavailable, enqueue calls log a warning and no-op
 * so the rest of the application continues to work.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from 'settlement-core';

// ── Job payload types ───────────────────────────────────────────
export interface CreateReceiptPayload {
  type: 'CREATE_RECEIPT';
  orderId: string;
  order: {
    id: string;
    order_number: string;
    type: string;
    payment_method: string;
    crypto_amount: string;
    crypto_currency: string;
    fiat_amount: string;
    fiat_currency: string;
    rate: string;
    platform_fee: string;
    protocol_fee_amount: string | null;
    status: string;
    user_id: string;
    merchant_id: string;
    buyer_merchant_id: string | null;
    acceptor_wallet_address: string | null;
    buyer_wallet_address: string | null;
    escrow_tx_hash: string | null;
    payment_details: Record<string, unknown> | null;
    accepted_at: string | null;
    escrowed_at: string | null;
  };
  actorId: string;
}

export interface UpdateReceiptPayload {
  type: 'UPDATE_RECEIPT';
  orderId: string;
  newStatus: string;
  fields?: {
    escrow_tx_hash?: string | null;
    release_tx_hash?: string | null;
    refund_tx_hash?: string | null;
    payment_sent_at?: boolean;
    escrowed_at?: boolean;
    completed_at?: boolean;
    cancelled_at?: boolean;
    expired_at?: boolean;
  };
}

export type ReceiptJobData = CreateReceiptPayload | UpdateReceiptPayload;

// ── Lazy Redis + Queue (only created on first use) ──────────────
let redisConnection: IORedis | null = null;
let receiptQueue: Queue<ReceiptJobData> | null = null;
let redisAvailable = true;
let warnedOnce = false;

function getRedis(): IORedis | null {
  if (redisConnection) return redisConnection;
  if (!redisAvailable) return null;

  try {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const isUpstash = url.startsWith('rediss://') || url.includes('upstash.io');
    const conn = new IORedis(url, {
      maxRetriesPerRequest: null,
      // Upstash requires TLS and doesn't support the INFO command
      ...(isUpstash ? { tls: { rejectUnauthorized: false }, enableReadyCheck: false } : {}),
      retryStrategy(times) {
        if (times > 3) {
          redisAvailable = false;
          if (!warnedOnce) {
            warnedOnce = true;
            logger.warn('[ReceiptQueue] Redis unavailable — receipt queue disabled. Receipts will be processed synchronously via event listeners.');
          }
          return null; // stop retrying
        }
        return Math.min(times * 500, 3000);
      },
      lazyConnect: true,
    });

    conn.on('error', () => {
      // Suppress connection errors — retryStrategy handles it
    });

    redisConnection = conn;
    return conn;
  } catch {
    redisAvailable = false;
    return null;
  }
}

function getQueue(): Queue<ReceiptJobData> | null {
  if (receiptQueue) return receiptQueue;

  const redis = getRedis();
  if (!redis) return null;

  receiptQueue = new Queue<ReceiptJobData>('receiptQueue', {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return receiptQueue;
}

// Export for the worker (needs the raw connection)
export function getRedisConnection(): IORedis | null {
  return getRedis();
}

// ── Helper: enqueue a CREATE_RECEIPT job ────────────────────────
export function enqueueCreateReceipt(
  orderId: string,
  order: CreateReceiptPayload['order'],
  actorId: string,
) {
  const q = getQueue();
  if (!q) {
    logger.warn('[ReceiptQueue] Redis unavailable, skipping enqueue', { orderId, type: 'CREATE_RECEIPT' });
    return Promise.resolve(null);
  }
  return q.add(
    'CREATE_RECEIPT',
    { type: 'CREATE_RECEIPT', orderId, order, actorId },
    { jobId: `create-receipt-${orderId}`, delay: 2000 },
  );
}

// ── Helper: enqueue an UPDATE_RECEIPT job ───────────────────────
export function enqueueUpdateReceipt(
  orderId: string,
  newStatus: string,
  fields?: UpdateReceiptPayload['fields'],
) {
  const q = getQueue();
  if (!q) {
    logger.warn('[ReceiptQueue] Redis unavailable, skipping enqueue', { orderId, type: 'UPDATE_RECEIPT' });
    return Promise.resolve(null);
  }
  return q.add(
    'UPDATE_RECEIPT',
    { type: 'UPDATE_RECEIPT', orderId, newStatus, fields },
  );
}

// ── Graceful shutdown ───────────────────────────────────────────
export async function closeReceiptQueue() {
  if (receiptQueue) await receiptQueue.close();
  if (redisConnection) redisConnection.disconnect();
}
