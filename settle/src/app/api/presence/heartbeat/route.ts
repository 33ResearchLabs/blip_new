import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import {
  setGlobalPresence,
  removeGlobalPresence,
  getGlobalPresence,
} from '@/lib/chat/presence';
import { PRESENCE_EVENTS } from '@/lib/pusher/events';

// POST /api/presence/heartbeat
// Writes presence to Redis (primary) + DB (fallback).
// On STATE TRANSITIONS (online↔offline), pushes a presence:update event
// to the merchant chat channels of all counterparties — so their inbox
// updates instantly without polling.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof (await import('next/server')).NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const isOnline = body?.isOnline !== false;

    const actorType = auth.actorType;
    const actorId = auth.actorId;
    if (!actorType || !actorId) return errorResponse('Missing actor');

    // Check previous state to detect transitions (online→offline or offline→online)
    const prev = await getGlobalPresence(actorType, actorId);
    const stateChanged = prev.isOnline !== isOnline;

    // Primary: Redis (fast, auto-expires via TTL)
    if (isOnline) {
      await setGlobalPresence(actorType, actorId);
    } else {
      await removeGlobalPresence(actorType, actorId);
    }

    // ── Presence fan-out on state transition ──
    // Only fires when going online→offline or offline→online (not on every heartbeat).
    // Pushes to the aggregated merchant-chat channel of each counterparty.
    if (stateChanged) {
      (async () => {
        try {
          const { getMerchantChatChannel, getUserChannel } = await import('@/lib/pusher/channels');
          const { triggerEvent } = await import('@/lib/pusher/server');

          const payload = {
            actorType,
            actorId,
            isOnline,
            lastSeen: isOnline ? null : new Date().toISOString(),
          };

          // Find counterparties who need to know about this presence change.
          // For a user going online/offline: notify their merchants.
          // For a merchant: notify users + other merchants in active orders.
          if (actorType === 'user') {
            // Find merchants who have active orders with this user
            const rows = await query<{ merchant_id: string }>(
              `SELECT DISTINCT merchant_id FROM orders
               WHERE user_id = $1 AND status IN ('accepted','escrowed','payment_sent','disputed')
               AND merchant_id IS NOT NULL`,
              [actorId]
            );
            for (const row of rows) {
              triggerEvent(getMerchantChatChannel(row.merchant_id), PRESENCE_EVENTS.UPDATE, payload).catch(() => {});
            }
          } else if (actorType === 'merchant') {
            // Find users who have active orders with this merchant
            const rows = await query<{ user_id: string; buyer_merchant_id: string | null }>(
              `SELECT DISTINCT user_id, buyer_merchant_id FROM orders
               WHERE (merchant_id = $1 OR buyer_merchant_id = $1)
               AND status IN ('accepted','escrowed','payment_sent','disputed')`,
              [actorId]
            );
            for (const row of rows) {
              if (row.user_id) {
                triggerEvent(getUserChannel(row.user_id), PRESENCE_EVENTS.UPDATE, payload).catch(() => {});
              }
              if (row.buyer_merchant_id && row.buyer_merchant_id !== actorId) {
                triggerEvent(getMerchantChatChannel(row.buyer_merchant_id), PRESENCE_EVENTS.UPDATE, payload).catch(() => {});
              }
            }
          }
        } catch {}
      })();
    }

    // Secondary: DB fallback (fire-and-forget)
    query(
      `INSERT INTO chat_presence (actor_type, actor_id, is_online, last_seen, connection_id)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (actor_type, actor_id)
       DO UPDATE SET is_online = EXCLUDED.is_online, last_seen = NOW()`,
      [actorType, actorId, isOnline, `hb-${Date.now()}`]
    ).catch(() => {});

    return successResponse({ ok: true, actorType, actorId, isOnline });
  } catch (error) {
    console.error('Presence heartbeat error:', error);
    return errorResponse('Internal server error');
  }
}
