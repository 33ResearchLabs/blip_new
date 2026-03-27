/**
 * Notification Listener
 *
 * Buffers order events and notification outbox entries for every
 * status transition. Also handles reputation scoring for terminal states.
 */
import { orderBus, ORDER_EVENT, type OrderEventPayload } from '../orderEvents';
import { bufferEvent, bufferNotification, bufferReputation } from '../../batchWriter';
import { getTransitionEventType, normalizeStatus, logger, query as dbQuery } from 'settlement-core';
import { withCircuitBreaker, CircuitBreakerError } from '../../circuitBreaker';

export function registerNotificationListener(): void {
  // Buffer event + notification on every status change
  orderBus.safeOn(ORDER_EVENT.STATUS_CHANGED, (p: OrderEventPayload) => {
    bufferEvent({
      order_id: p.orderId,
      event_type: getTransitionEventType(p.previousStatus as any, p.newStatus as any),
      actor_type: p.actorType,
      actor_id: p.actorId,
      old_status: p.previousStatus,
      new_status: p.newStatus,
      metadata: JSON.stringify(p.metadata || {}),
    });

    bufferNotification({
      order_id: p.orderId,
      event_type: `ORDER_${p.newStatus.toUpperCase()}`,
      payload: JSON.stringify({
        orderId: p.orderId,
        userId: p.userId,
        merchantId: p.merchantId,
        status: p.newStatus,
        minimal_status: p.minimalStatus,
        order_version: p.orderVersion,
        previousStatus: p.previousStatus,
        updatedAt: new Date().toISOString(),
      }),
    });
  });

  // Reputation scoring for terminal states
  const terminalStatuses = ['completed', 'cancelled', 'disputed', 'expired'];

  orderBus.safeOn(ORDER_EVENT.STATUS_CHANGED, (p: OrderEventPayload) => {
    if (!terminalStatuses.includes(p.newStatus)) return;

    const repType = p.newStatus === 'completed' ? 'order_completed'
      : p.newStatus === 'disputed' ? 'order_disputed'
      : p.newStatus === 'expired' ? 'order_timeout'
      : 'order_cancelled';
    const repScore = p.newStatus === 'completed' ? 5
      : p.newStatus === 'disputed' ? -5
      : p.newStatus === 'expired' ? -5
      : -2;
    const repReason = `Order ${p.orderNumber || p.orderId} ${p.newStatus}`;
    const repMeta = JSON.stringify({ order_id: p.orderId });

    bufferReputation({ entity_id: p.merchantId, entity_type: 'merchant', event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });
    bufferReputation({ entity_id: p.userId, entity_type: 'user', event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });

    // Fire reputation recalculation (circuit-breaker-protected)
    const settleUrl = process.env.SETTLE_URL || 'http://localhost:3000';
    withCircuitBreaker('reputation_api', async () => {
      await Promise.allSettled([
        fetch(`${settleUrl}/api/reputation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: p.merchantId, entityType: 'merchant' }) }),
        fetch(`${settleUrl}/api/reputation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: p.userId, entityType: 'user' }) }),
      ]);
    }).catch((err) => {
      if (err instanceof CircuitBreakerError) {
        logger.warn('[NotificationListener] Reputation API circuit open — skipping', { orderId: p.orderId });
      }
      // Silently ignore other errors (fire-and-forget)
    });
  });

  // Stats update on completion
  orderBus.safeOn(ORDER_EVENT.COMPLETED, (p: OrderEventPayload) => {
    dbQuery(
      `WITH u AS (UPDATE users SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2 RETURNING 1)
       UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $3`,
      [p.order.fiat_amount, p.userId, p.merchantId]
    ).catch((err) => {
      logger.error('[NotificationListener] Stats update failed', { orderId: p.orderId, error: String(err) });
    });
  });

  logger.info('[NotificationListener] Registered');
}
