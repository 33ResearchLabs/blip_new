/**
 * Redis-backed Presence System
 *
 * TWO levels:
 *  A. Global presence — is the user/merchant online anywhere?
 *     Key: presence:global:{actorType}:{actorId} → timestamp
 *     TTL: 45 seconds (auto-expires if heartbeat stops)
 *
 *  B. Order-level presence — who's in this specific chat?
 *     Key: presence:order:{orderId} → HASH { actorType:actorId → timestamp }
 *     TTL: 45 seconds on the hash key
 *
 * The heartbeat endpoint writes to Redis (not DB). The presence
 * query endpoint reads from Redis (not DB). The DB chat_presence
 * table remains as a fallback for when Redis is unavailable.
 *
 * Performance: Redis SET/GET vs. DB INSERT/SELECT = ~100x faster.
 * At 1000 concurrent users × 30s heartbeat = 2000 Redis ops/min
 * vs. 2000 DB writes/min previously.
 */

import { redis } from '@/lib/cache/redis';

const PRESENCE_TTL = 45; // seconds — heartbeat every 30s gives 15s grace

// ── Global presence ──────────────────────────────────────────────────

function globalKey(actorType: string, actorId: string): string {
  return `presence:global:${actorType}:${actorId}`;
}

/**
 * Set global presence (called from heartbeat endpoint).
 * The key auto-expires after PRESENCE_TTL if no heartbeat follows.
 */
export async function setGlobalPresence(
  actorType: string,
  actorId: string,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(globalKey(actorType, actorId), PRESENCE_TTL, Date.now().toString());
  } catch {}
}

/**
 * Explicitly mark offline (called on tab close / logout).
 */
export async function removeGlobalPresence(
  actorType: string,
  actorId: string,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(globalKey(actorType, actorId));
  } catch {}
}

/**
 * Check if a specific actor is online.
 * Returns { isOnline, lastSeen } — lastSeen is ISO string or null.
 */
export async function getGlobalPresence(
  actorType: string,
  actorId: string,
): Promise<{ isOnline: boolean; lastSeen: string | null }> {
  if (!redis) return { isOnline: false, lastSeen: null };
  try {
    const ts = await redis.get(globalKey(actorType, actorId));
    if (!ts) return { isOnline: false, lastSeen: null };
    return {
      isOnline: true,
      lastSeen: new Date(parseInt(ts, 10)).toISOString(),
    };
  } catch {
    return { isOnline: false, lastSeen: null };
  }
}

/**
 * Batch check presence for multiple actors (used in merchant inbox).
 * Returns a Map of actorId → { isOnline, lastSeen }.
 * Uses Redis pipeline for efficiency — single round-trip.
 */
export async function batchGetPresence(
  actors: Array<{ actorType: string; actorId: string }>,
): Promise<Map<string, { isOnline: boolean; lastSeen: string | null }>> {
  const result = new Map<string, { isOnline: boolean; lastSeen: string | null }>();
  if (!redis || actors.length === 0) return result;

  try {
    const pipeline = redis.pipeline();
    for (const { actorType, actorId } of actors) {
      pipeline.get(globalKey(actorType, actorId));
    }
    const responses = await pipeline.exec();
    if (!responses) return result;

    for (let i = 0; i < actors.length; i++) {
      const [err, ts] = responses[i] || [null, null];
      const { actorId } = actors[i];
      if (err || !ts) {
        result.set(actorId, { isOnline: false, lastSeen: null });
      } else {
        result.set(actorId, {
          isOnline: true,
          lastSeen: new Date(parseInt(ts as string, 10)).toISOString(),
        });
      }
    }
  } catch {}
  return result;
}

// ── Order-level presence ─────────────────────────────────────────────

function orderKey(orderId: string): string {
  return `presence:order:${orderId}`;
}

/**
 * Mark an actor as present in an order's chat.
 * Called when the user opens a specific chat.
 */
export async function joinOrderPresence(
  orderId: string,
  actorType: string,
  actorId: string,
): Promise<void> {
  if (!redis) return;
  try {
    const key = orderKey(orderId);
    await redis.hset(key, `${actorType}:${actorId}`, Date.now().toString());
    await redis.expire(key, PRESENCE_TTL);
  } catch {}
}

/**
 * Remove an actor from an order's chat presence.
 * Called when the user closes/switches chat.
 */
export async function leaveOrderPresence(
  orderId: string,
  actorType: string,
  actorId: string,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.hdel(orderKey(orderId), `${actorType}:${actorId}`);
  } catch {}
}

/**
 * Get all participants currently in an order's chat.
 */
export async function getOrderPresence(
  orderId: string,
): Promise<Array<{ actorType: string; actorId: string; isOnline: boolean; lastSeen: string }>> {
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(orderKey(orderId));
    const now = Date.now();
    return Object.entries(raw).map(([field, ts]) => {
      const [actorType, actorId] = field.split(':');
      const lastSeen = parseInt(ts, 10);
      return {
        actorType,
        actorId,
        isOnline: now - lastSeen < PRESENCE_TTL * 1000,
        lastSeen: new Date(lastSeen).toISOString(),
      };
    });
  } catch {
    return [];
  }
}
