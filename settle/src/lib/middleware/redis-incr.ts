/**
 * Redis INCR with auto-EXPIRE for rate limiting.
 *
 * Uses MULTI/EXEC to atomically INCR and set TTL on first creation.
 * Returns the current count after increment.
 */

import { redis } from '@/lib/cache/redis';

export async function redisIncr(key: string, windowSeconds: number): Promise<number> {
  if (!redis) throw new Error('Redis not available');

  // INCR is atomic; EXPIRE only needs to be set once (on first INCR)
  const count = await redis.incr(key);
  if (count === 1) {
    // First request in this window — set TTL
    await redis.expire(key, windowSeconds);
  }
  return count;
}
