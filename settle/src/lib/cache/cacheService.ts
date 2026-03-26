/**
 * Cache Service — Domain-specific caching layer (production-hardened)
 *
 * Features:
 *   1. Stampede protection — on cache miss, only ONE request fetches from DB;
 *      concurrent requests wait on a short poll loop instead of all hitting DB.
 *   2. Write-through updates — on order mutation, UPDATES cache in-place
 *      instead of deleting (avoids miss→stampede after every write).
 *   3. Typed helpers for orders, receipts, merchants.
 *   4. All operations safe: cache down → DB-only mode, no errors propagated.
 *
 * TTLs:
 *   Active orders (non-terminal): 30s
 *   Terminal orders:              300s
 *   Receipts:                     300s
 *   Merchants:                    120s
 */

import cache, { cacheMetrics } from './redis';

// ── Cache key builders ─────────────────────────────────────────────────

export const CacheKeys = {
  order: (id: string) => `order:${id}`,
  orderLock: (id: string) => `lock:order:${id}`,
  receipt: (orderId: string) => `receipt:${orderId}`,
  receiptLock: (orderId: string) => `lock:receipt:${orderId}`,
  merchant: (id: string) => `merchant:${id}`,
  merchantLock: (id: string) => `lock:merchant:${id}`,
  merchantOffers: (id: string) => `merchant:${id}:offers`,
} as const;

// ── TTLs (seconds) ─────────────────────────────────────────────────────

const TTL = {
  ACTIVE_ORDER: 30,
  TERMINAL_ORDER: 300,
  RECEIPT: 300,
  MERCHANT: 120,
  MERCHANT_OFFERS: 60,
  LOCK: 5, // Stampede lock — 5s max hold time
} as const;

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'expired']);

// Stampede protection: max time to wait for another request to populate cache
const STAMPEDE_WAIT_MS = 3000;
const STAMPEDE_POLL_MS = 50;

// ── In-process singleflight (complements Redis lock for same-instance dedup) ──

const inFlightRequests = new Map<string, Promise<unknown>>();

// ── Core fetch-with-stampede-protection ─────────────────────────────────

/**
 * Fetch from cache with stampede protection.
 *
 * Flow:
 *   1. Check cache → HIT → return
 *   2. Try to acquire lock (SET NX)
 *      a. Lock acquired → fetch from DB → write to cache → release lock → return
 *      b. Lock NOT acquired → another request is fetching → poll cache until populated or timeout
 *   3. On timeout → fetch from DB directly (safety valve)
 *
 * In-process singleflight:
 *   Within the same Node.js process, concurrent calls for the same key
 *   are coalesced into a single Promise (no Redis needed).
 */
async function fetchWithProtection<T>(
  cacheKey: string,
  lockKey: string,
  ttl: number,
  dbFetcher: () => Promise<T | null>
): Promise<T | null> {
  // 1. Cache hit
  const cached = await cache.get<T>(cacheKey);
  if (cached) return cached;

  // 2. In-process singleflight — if another call in this process is already fetching, wait on it
  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    cacheMetrics.stampedeLockWaits++;
    return existing as Promise<T | null>;
  }

  // 3. Create the fetch promise and register it
  const fetchPromise = (async (): Promise<T | null> => {
    // Try distributed lock
    const acquired = await cache.setnx(lockKey, '1', TTL.LOCK);

    if (acquired) {
      // We own the lock — fetch from DB
      try {
        const data = await dbFetcher();
        if (data) {
          await cache.set(cacheKey, data, ttl);
        }
        return data;
      } finally {
        // Release lock (best-effort)
        await cache.del(lockKey);
      }
    }

    // Lock not acquired — another instance is fetching. Poll cache.
    cacheMetrics.stampedeLockWaits++;
    const deadline = Date.now() + STAMPEDE_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(STAMPEDE_POLL_MS);
      const result = await cache.get<T>(cacheKey);
      if (result) return result;
    }

    // Timeout — safety valve: fetch from DB directly
    return dbFetcher();
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Order cache ─────────────────────────────────────────────────────────

function orderTTL(status?: string): number {
  return status && TERMINAL_STATUSES.has(status) ? TTL.TERMINAL_ORDER : TTL.ACTIVE_ORDER;
}

/**
 * Get order from cache with stampede protection.
 */
export async function getCachedOrder<T>(
  orderId: string,
  dbFetcher: (id: string) => Promise<T | null>
): Promise<T | null> {
  return fetchWithProtection<T>(
    CacheKeys.order(orderId),
    CacheKeys.orderLock(orderId),
    TTL.ACTIVE_ORDER, // conservative; will be overridden by updateOrderCache
    () => dbFetcher(orderId)
  );
}

/**
 * Write-through: update order cache in-place after a mutation.
 * Avoids cache miss → stampede after every status change.
 */
export async function updateOrderCache(orderId: string, order: unknown): Promise<void> {
  const status = (order as any)?.status;
  await cache.set(CacheKeys.order(orderId), order, orderTTL(status));
}

/**
 * Invalidate order cache (use when you don't have the updated order object).
 */
export async function invalidateOrderCache(orderId: string): Promise<void> {
  await cache.del(
    CacheKeys.order(orderId),
    CacheKeys.receipt(orderId)
  );
}

// ── Receipt cache ───────────────────────────────────────────────────────

export async function getCachedReceipt<T>(
  orderId: string,
  dbFetcher: (orderId: string) => Promise<T | null>
): Promise<T | null> {
  return fetchWithProtection<T>(
    CacheKeys.receipt(orderId),
    CacheKeys.receiptLock(orderId),
    TTL.RECEIPT,
    () => dbFetcher(orderId)
  );
}

export async function updateReceiptCache(orderId: string, receipt: unknown): Promise<void> {
  await cache.set(CacheKeys.receipt(orderId), receipt, TTL.RECEIPT);
}

// ── Merchant cache ──────────────────────────────────────────────────────

export async function getCachedMerchant<T>(
  merchantId: string,
  dbFetcher: (id: string) => Promise<T | null>
): Promise<T | null> {
  return fetchWithProtection<T>(
    CacheKeys.merchant(merchantId),
    CacheKeys.merchantLock(merchantId),
    TTL.MERCHANT,
    () => dbFetcher(merchantId)
  );
}

export async function updateMerchantCache(merchantId: string, merchant: unknown): Promise<void> {
  await cache.set(CacheKeys.merchant(merchantId), merchant, TTL.MERCHANT);
}

export async function invalidateMerchantCache(merchantId: string): Promise<void> {
  await cache.del(
    CacheKeys.merchant(merchantId),
    CacheKeys.merchantOffers(merchantId)
  );
}

// ── Bulk invalidation ───────────────────────────────────────────────────

export async function invalidateOrderRelatedCaches(
  orderId: string,
  merchantId?: string,
): Promise<void> {
  const keys = [CacheKeys.order(orderId), CacheKeys.receipt(orderId)];
  if (merchantId) keys.push(CacheKeys.merchant(merchantId));
  await cache.del(...keys);
}
