/**
 * Redis Client (Singleton)
 *
 * Connects to Redis (local or Upstash) for caching.
 * Falls back gracefully — cache misses simply hit the DB.
 * Survives HMR reloads in dev via globalThis.
 */

import { Redis } from "ioredis";

const globalForRedis = globalThis as unknown as { __redisClient?: Redis };

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[Redis] REDIS_URL not set — caching disabled, DB-only mode");
    return null;
  }

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: 5000,
    });

    client.on("error", (err: any) => {
      console.error("[Redis] Connection error:", err.message);
    });

    client.on("connect", () => {
      console.log("[Redis] Connected successfully");
    });

    client.connect().catch((err) => {
      console.warn(
        "[Redis] Initial connection failed (will retry):",
        err.message,
      );
    });

    return client;
  } catch (err) {
    console.warn("[Redis] Failed to create client:", err);
    return null;
  }
}

const redis = globalForRedis.__redisClient ?? createRedisClient();
if (process.env.NODE_ENV !== "production" && redis) {
  globalForRedis.__redisClient = redis;
}

// ── Metrics counters ────────────────────────────────────────────────────

export const cacheMetrics = {
  hits: 0,
  misses: 0,
  errors: 0,
  stampedeLockWaits: 0,
  /** Reset counters (for periodic reporting) */
  snapshot() {
    const snap = { hits: this.hits, misses: this.misses, errors: this.errors, stampedeLockWaits: this.stampedeLockWaits };
    this.hits = 0;
    this.misses = 0;
    this.errors = 0;
    this.stampedeLockWaits = 0;
    return snap;
  },
};

/**
 * Safe wrapper — all operations are no-op when Redis is unavailable.
 * Callers never need to check for null.
 */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (!redis) return null;
    try {
      const data = await redis.get(key);
      if (data) {
        cacheMetrics.hits++;
        return JSON.parse(data);
      }
      cacheMetrics.misses++;
      return null;
    } catch {
      cacheMetrics.errors++;
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!redis) return;
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // cache write failure is non-fatal
    }
  },

  async del(...keys: string[]): Promise<void> {
    if (!redis) return;
    try {
      await redis.del(...keys);
    } catch {
      // cache invalidation failure is non-fatal
    }
  },

  async exists(key: string): Promise<boolean> {
    if (!redis) return false;
    try {
      return (await redis.exists(key)) === 1;
    } catch {
      return false;
    }
  },

  /**
   * SET NX with TTL — used for distributed locks (stampede protection).
   * Returns true if the lock was acquired, false if already held.
   */
  async setnx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!redis) return true; // No Redis = no contention, proceed
    try {
      const result = await redis.set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    } catch {
      return true; // On error, don't block — let the caller proceed
    }
  },

  /** Check if Redis is available */
  isAvailable(): boolean {
    return redis !== null && redis.status === "ready";
  },
};

export { redis };
export default cache;
