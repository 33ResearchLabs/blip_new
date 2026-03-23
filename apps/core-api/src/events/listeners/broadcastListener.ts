/**
 * Broadcast Listener
 *
 * Pushes order status updates to WebSocket clients and Pusher channels.
 */
import { orderBus, ORDER_EVENT, type OrderEventPayload } from '../orderEvents';
import { broadcastOrderEvent } from '../../ws/broadcast';
import { pusherNotifyOrderStatus, pusherNotifyOrderCancelled, pusherNotifyOrderCreated } from '../../pusher';
import { logger } from 'settlement-core';

export function registerBroadcastListener(): void {
  // WebSocket broadcast on every status change
  orderBus.safeOn(ORDER_EVENT.STATUS_CHANGED, (p: OrderEventPayload) => {
    broadcastOrderEvent({
      event_type: `ORDER_${p.newStatus.toUpperCase()}`,
      order_id: p.orderId,
      status: p.newStatus,
      minimal_status: p.minimalStatus,
      order_version: p.orderVersion,
      userId: p.userId,
      merchantId: p.merchantId,
      buyerMerchantId: p.buyerMerchantId,
      previousStatus: p.previousStatus,
    });
  });

  // Pusher: order created → all merchants
  orderBus.safeOn(ORDER_EVENT.CREATED, (p: OrderEventPayload) => {
    pusherNotifyOrderCreated({
      orderId: p.orderId,
      userId: p.userId,
      merchantId: p.merchantId,
      buyerMerchantId: p.buyerMerchantId,
      status: p.newStatus,
      minimal_status: p.minimalStatus,
      order_version: p.orderVersion,
      updatedAt: new Date().toISOString(),
      data: p.order,
    });
  });

  // Pusher: cancelled → dedicated cancel event
  orderBus.safeOn(ORDER_EVENT.CANCELLED, (p: OrderEventPayload) => {
    pusherNotifyOrderCancelled({
      orderId: p.orderId,
      userId: p.userId,
      merchantId: p.merchantId,
      buyerMerchantId: p.buyerMerchantId,
      status: 'cancelled',
      minimal_status: 'cancelled',
      order_version: p.orderVersion,
      previousStatus: p.previousStatus,
      updatedAt: new Date().toISOString(),
      data: p.order,
    });
  });

  // Pusher: all other status changes → generic status update
  const nonCancelledEvents = [
    ORDER_EVENT.ACCEPTED,
    ORDER_EVENT.ESCROWED,
    ORDER_EVENT.PAYMENT_SENT,
    ORDER_EVENT.COMPLETED,
    ORDER_EVENT.EXPIRED,
    ORDER_EVENT.DISPUTED,
  ] as const;

  for (const event of nonCancelledEvents) {
    orderBus.safeOn(event, (p: OrderEventPayload) => {
      pusherNotifyOrderStatus({
        orderId: p.orderId,
        userId: p.userId,
        merchantId: p.merchantId,
        buyerMerchantId: p.buyerMerchantId,
        status: p.newStatus,
        minimal_status: p.minimalStatus,
        order_version: p.orderVersion,
        previousStatus: p.previousStatus,
        updatedAt: new Date().toISOString(),
        data: p.order,
      });
    });
  }

  logger.info('[BroadcastListener] Registered');
}
