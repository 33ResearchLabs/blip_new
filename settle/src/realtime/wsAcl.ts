/**
 * Access control for shadow WS room joins.
 *
 * Read-only — never mutates orders, never imports business-logic helpers.
 * Lives in src/realtime/ so the entire shadow stack remains removable.
 *
 * Contract:
 *   canJoinOrderRoom(actorType, actorId, orderId) → true if the actor is
 *   a participant in the order (user_id, merchant_id, or buyer_merchant_id),
 *   OR if actorType === 'compliance' (compliance can observe any order).
 */
import { query } from '../lib/db';
import { WS_SHADOW_LOG_PREFIX as TAG, type ActorType } from './wsEvents';

interface OrderParticipants {
  user_id: string | null;
  merchant_id: string | null;
  buyer_merchant_id: string | null;
}

const ttlMs = 30_000;
const cache = new Map<string, { allowed: boolean; expires: number }>();

function cacheKey(actorType: ActorType, actorId: string, orderId: string): string {
  return `${actorType}:${actorId}:${orderId}`;
}

export async function canJoinOrderRoom(
  actorType: ActorType,
  actorId: string,
  orderId: string
): Promise<boolean> {
  // Compliance can observe any order — matches existing app semantics.
  if (actorType === 'compliance') return true;

  const key = cacheKey(actorType, actorId, orderId);
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.allowed;

  let allowed = false;
  try {
    const rows = await query<OrderParticipants>(
      `SELECT user_id, merchant_id, buyer_merchant_id
         FROM orders
        WHERE id = $1
        LIMIT 1`,
      [orderId]
    );
    if (rows.length === 0) {
      allowed = false;
    } else {
      const o = rows[0];
      if (actorType === 'user') {
        allowed = o.user_id === actorId;
      } else if (actorType === 'merchant') {
        allowed = o.merchant_id === actorId || o.buyer_merchant_id === actorId;
      }
    }
  } catch (err) {
    // Fail closed on DB errors — safer than leaking events.
    console.warn(`${TAG} acl: db error, denying join`, (err as Error).message);
    allowed = false;
  }

  cache.set(key, { allowed, expires: now + ttlMs });
  return allowed;
}

/** Test/teardown helper. */
export function clearAclCache(): void {
  cache.clear();
}
