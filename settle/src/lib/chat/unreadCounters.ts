/**
 * Redis-backed Unread Message Counters
 *
 * Structure: HSET unread:merchant:{merchantId} orderId count
 *
 * - incrementUnread(): called after message INSERT (for the RECEIVER only)
 * - clearUnread():     called when merchant opens/reads a chat
 * - getAllUnreads():    called once on inbox load (single HGETALL, no N+1)
 *
 * Falls back gracefully when Redis is unavailable — returns empty/0.
 * The DB read-tracking (chat_message_reads) remains the authoritative
 * source; Redis is a hot-path optimization for the merchant inbox.
 */

import { redis } from '@/lib/cache/redis';

const UNREAD_KEY = (merchantId: string) => `unread:merchant:${merchantId}`;
// User-side unread (simpler — single active order at a time, but useful for badges)
const USER_UNREAD_KEY = (userId: string) => `unread:user:${userId}`;

/**
 * Increment unread count for a specific order in a merchant's inbox.
 * Called from the message POST handler for the RECEIVER, not the sender.
 */
export async function incrementMerchantUnread(merchantId: string, orderId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.hincrby(UNREAD_KEY(merchantId), orderId, 1);
  } catch {
    // Redis failure is non-fatal — inbox will show stale count
  }
}

/**
 * Clear unread count when merchant opens/reads a chat.
 * Returns the count that was cleared (useful for analytics).
 */
export async function clearMerchantUnread(merchantId: string, orderId: string): Promise<number> {
  if (!redis) return 0;
  try {
    const prev = await redis.hget(UNREAD_KEY(merchantId), orderId);
    await redis.hdel(UNREAD_KEY(merchantId), orderId);
    return parseInt(prev || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Get all unread counts for a merchant's inbox in ONE call.
 * Returns { [orderId]: count }. No N+1 — single HGETALL.
 */
export async function getAllMerchantUnreads(merchantId: string): Promise<Record<string, number>> {
  if (!redis) return {};
  try {
    const raw = await redis.hgetall(UNREAD_KEY(merchantId));
    const result: Record<string, number> = {};
    for (const [orderId, countStr] of Object.entries(raw)) {
      const count = parseInt(countStr, 10);
      if (count > 0) result[orderId] = count;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Increment unread count for a user (single order at a time).
 */
export async function incrementUserUnread(userId: string, orderId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.hincrby(USER_UNREAD_KEY(userId), orderId, 1);
  } catch {}
}

/**
 * Clear user's unread for an order.
 */
export async function clearUserUnread(userId: string, orderId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.hdel(USER_UNREAD_KEY(userId), orderId);
  } catch {}
}
