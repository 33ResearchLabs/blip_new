/**
 * Pusher Server Client (Core API)
 *
 * Triggers real-time events directly from the Fastify backend so updates
 * are emitted at the source of truth — no round-trip through Next.js.
 *
 * Channel naming follows the same convention as settle/src/lib/pusher/channels.ts:
 *   private-order-{orderId}
 *   private-user-{userId}
 *   private-merchant-{merchantId}
 *   private-merchants-global
 */
import { logger } from 'settlement-core';

// ── Channel helpers ─────────────────────────────────────────────
export const getOrderChannel = (orderId: string) => `private-order-${orderId}`;
export const getUserChannel = (userId: string) => `private-user-${userId}`;
export const getMerchantChannel = (merchantId: string) => `private-merchant-${merchantId}`;
export const getAllMerchantsChannel = () => 'private-merchants-global';

// ── Event names (must match settle/src/lib/pusher/events.ts) ───
export const ORDER_EVENTS = {
  CREATED: 'order:created',
  STATUS_UPDATED: 'order:status-updated',
  CANCELLED: 'order:cancelled',
} as const;

// ── Pusher-like interface for mock fallback ─────────────────────
interface PusherLike {
  trigger: (channel: string | string[], event: string, data: unknown) => Promise<unknown>;
}

let pusherServer: PusherLike | null = null;
let loadAttempted = false;

async function getPusher(): Promise<PusherLike> {
  if (pusherServer) return pusherServer;

  const mock: PusherLike = {
    trigger: async () => {
      // Silently no-op when Pusher is not configured
    },
  };

  if (loadAttempted) return mock;
  loadAttempted = true;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY || process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER || process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    logger.warn('[Pusher] Credentials not configured — real-time Pusher events disabled');
    return mock;
  }

  try {
    const Pusher = (await import('pusher')).default;
    pusherServer = new Pusher({ appId, key, secret, cluster, useTLS: true });
    logger.info('[Pusher] Server client initialized');
    return pusherServer;
  } catch (err) {
    logger.warn('[Pusher] Module not available — falling back to mock', { error: err });
    return mock;
  }
}

// ── Trigger helper (fire-and-forget, never blocks caller) ───────
async function triggerEvent(channels: string | string[], event: string, data: unknown): Promise<void> {
  try {
    const pusher = await getPusher();
    await pusher.trigger(channels, event, data);
  } catch (err) {
    logger.error('[Pusher] Failed to trigger event', { event, error: err });
  }
}

// ── Public: notify order status updated ─────────────────────────
export interface OrderStatusPayload {
  orderId: string;
  userId: string;
  // NULL for unclaimed M2M BUY broadcasts (seller slot not yet filled).
  // Per-merchant channel push is skipped when this is null/empty so we don't
  // emit to a ghost channel like `private-merchant-null`.
  merchantId: string | null;
  buyerMerchantId?: string;
  status: string;
  minimal_status: string;
  order_version: number;
  previousStatus?: string;
  updatedAt: string;
  data?: unknown;
}

/**
 * Emit an order-status-updated Pusher event to all relevant channels.
 * Called alongside broadcastOrderEvent() in route handlers.
 */
export function pusherNotifyOrderStatus(payload: OrderStatusPayload): void {
  const channels = [
    getOrderChannel(payload.orderId),
    getUserChannel(payload.userId),
  ];
  if (payload.merchantId) {
    channels.push(getMerchantChannel(payload.merchantId));
  }
  if (payload.buyerMerchantId) {
    channels.push(getMerchantChannel(payload.buyerMerchantId));
  }
  // Broadcast to all merchants for statuses that affect the order pool
  const broadcastStatuses = ['accepted', 'cancelled', 'expired'];
  if (broadcastStatuses.includes(payload.status)) {
    channels.push(getAllMerchantsChannel());
  }

  triggerEvent(channels, ORDER_EVENTS.STATUS_UPDATED, {
    orderId: payload.orderId,
    status: payload.status,
    minimal_status: payload.minimal_status,
    order_version: payload.order_version,
    previousStatus: payload.previousStatus,
    updatedAt: payload.updatedAt,
    data: payload.data,
  });
}

/**
 * Emit an order-cancelled Pusher event.
 */
export function pusherNotifyOrderCancelled(payload: OrderStatusPayload): void {
  const channels = [
    getOrderChannel(payload.orderId),
    getUserChannel(payload.userId),
  ];
  if (payload.merchantId) {
    channels.push(getMerchantChannel(payload.merchantId));
  }
  if (payload.buyerMerchantId) {
    channels.push(getMerchantChannel(payload.buyerMerchantId));
  }
  channels.push(getAllMerchantsChannel());

  triggerEvent(channels, ORDER_EVENTS.CANCELLED, {
    orderId: payload.orderId,
    minimal_status: 'cancelled',
    order_version: payload.order_version,
    cancelledAt: payload.updatedAt,
    data: payload.data,
  });
}

/**
 * Emit order:created to all merchants.
 */
export function pusherNotifyOrderCreated(payload: OrderStatusPayload): void {
  triggerEvent([getAllMerchantsChannel()], ORDER_EVENTS.CREATED, {
    orderId: payload.orderId,
    status: payload.status,
    minimal_status: payload.minimal_status,
    order_version: payload.order_version,
    createdAt: payload.updatedAt,
    data: payload.data,
  });
}
