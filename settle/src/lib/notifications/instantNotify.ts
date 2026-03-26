/**
 * Instant Notification Helper
 *
 * Fires Pusher/WS events IMMEDIATELY after a successful mutation,
 * bypassing the 5s outbox polling delay.
 *
 * This is a UX optimization — the outbox worker still runs as a
 * reliability backup. If this fire-and-forget call fails, the outbox
 * will deliver within 5s anyway.
 *
 * Deduplication: the UI uses order_version to ignore stale events,
 * so receiving the same event twice (instant + outbox) is harmless.
 */

import { notifyOrderStatusUpdated } from '@/lib/pusher/server';
import { wsBroadcastOrderUpdate } from '@/lib/websocket/broadcast';
import { normalizeStatus } from '@/lib/orders/statusNormalizer';
import { logger } from '@/lib/logger';

interface InstantNotifyParams {
  orderId: string;
  userId: string;
  merchantId: string;
  buyerMerchantId?: string;
  status: string;
  previousStatus: string;
  orderVersion?: number;
  updatedAt: string;
  data?: unknown;
}

/**
 * Fire-and-forget instant notification.
 * Never throws — errors are logged and swallowed.
 */
export async function fireInstantNotification(params: InstantNotifyParams): Promise<void> {
  const minimalStatus = normalizeStatus(params.status);

  const payload = {
    orderId: params.orderId,
    userId: params.userId,
    merchantId: params.merchantId,
    buyerMerchantId: params.buyerMerchantId,
    status: params.status,
    minimal_status: minimalStatus,
    order_version: params.orderVersion,
    previousStatus: params.previousStatus,
    updatedAt: params.updatedAt,
    data: params.data,
  };

  // Fire both in parallel — neither blocks the API response
  const promises: Promise<void>[] = [
    notifyOrderStatusUpdated(payload).catch((err) => {
      logger.warn('[InstantNotify] Pusher fire-and-forget failed', {
        orderId: params.orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
  ];

  // WebSocket broadcast
  if (params.data) {
    promises.push(
      Promise.resolve(wsBroadcastOrderUpdate({
        orderId: params.orderId,
        status: params.status,
        minimalStatus,
        previousStatus: params.previousStatus,
        orderVersion: params.orderVersion,
        updatedAt: params.updatedAt,
        data: params.data,
      })).catch((err) => {
        logger.warn('[InstantNotify] WS broadcast failed', {
          orderId: params.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  // M2M buyer merchant notification
  if (params.buyerMerchantId && params.buyerMerchantId !== params.merchantId) {
    promises.push(
      notifyOrderStatusUpdated({
        ...payload,
        merchantId: params.buyerMerchantId,
      }).catch((err) => {
        logger.warn('[InstantNotify] M2M buyer notification failed', {
          orderId: params.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  // Don't await — fire and forget. setImmediate to not block response.
  Promise.all(promises).catch(() => {
    // All individual errors already logged
  });
}
