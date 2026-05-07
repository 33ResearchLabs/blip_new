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
  // Buffer event + notification on every status change.
  // `old_status` / `new_status` are nullable enum columns — empty strings
  // would fail the enum cast (PG error 22P02). Coerce empty/undefined to null.
  const safeStatus = (s: unknown): string | null => {
    if (typeof s !== 'string') return null;
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  orderBus.safeOn(ORDER_EVENT.STATUS_CHANGED, (p: OrderEventPayload) => {
    bufferEvent({
      order_id: p.orderId,
      event_type: getTransitionEventType(p.previousStatus as any, p.newStatus as any),
      actor_type: p.actorType,
      actor_id: p.actorId,
      old_status: safeStatus(p.previousStatus),
      new_status: safeStatus(p.newStatus),
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

    // Skip merchant scoring when merchantId is null — unclaimed M2M BUY
    // broadcasts that expire/cancel before a seller claims have no merchant
    // counterparty to score. Score the buyer_merchant_id (creator) instead
    // if this was their broadcast.
    if (p.merchantId) {
      bufferReputation({ entity_id: p.merchantId, entity_type: 'merchant', event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });
    } else if (p.buyerMerchantId) {
      bufferReputation({ entity_id: p.buyerMerchantId, entity_type: 'merchant', event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });
    }
    bufferReputation({ entity_id: p.userId, entity_type: 'user', event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });

    // Fire reputation recalculation (circuit-breaker-protected)
    const settleUrl = process.env.SETTLE_URL || 'http://localhost:3000';
    const reputationMerchantId = p.merchantId || p.buyerMerchantId;
    withCircuitBreaker('reputation_api', async () => {
      const calls: Promise<unknown>[] = [
        fetch(`${settleUrl}/api/reputation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: p.userId, entityType: 'user' }) }),
      ];
      if (reputationMerchantId) {
        calls.push(fetch(`${settleUrl}/api/reputation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: reputationMerchantId, entityType: 'merchant' }) }));
      }
      await Promise.allSettled(calls);
    }).catch((err) => {
      if (err instanceof CircuitBreakerError) {
        logger.warn('[NotificationListener] Reputation API circuit open — skipping', { orderId: p.orderId });
      }
      // Silently ignore other errors (fire-and-forget)
    });
  });

  // Stats update on completion. A completed order always has merchant_id set
  // (a seller claimed — the M2M BUY broadcast shape with merchant_id=NULL can
  // only exist in pending/expired/cancelled states), but guard just in case.
  //
  // Volume is incremented in CRYPTO units (crypto_amount, denominated in
  // USDT) — NOT fiat_amount. Mixing fiat across INR/AED/USD corridors into
  // one column makes the leaderboard meaningless because callers treat
  // total_volume as USDT.
  //
  // M2M trades update BOTH merchant participants: the seller (merchant_id)
  // and the buyer (buyer_merchant_id). The previous code only credited the
  // seller, undercounting any merchant who acted as buyer. The user-side
  // (`users` row) is only updated when user_id is a real participant
  // (M2M placeholder users have a synthetic id but should NOT accumulate
  // stats — the listener payload's userId is set unconditionally so we
  // gate on the order having a real user role).
  orderBus.safeOn(ORDER_EVENT.COMPLETED, (p: OrderEventPayload) => {
    if (!p.merchantId) {
      logger.warn('[NotificationListener] COMPLETED event with null merchantId — skipping stats update', { orderId: p.orderId });
      return;
    }

    const cryptoAmount = (p.order as { crypto_amount?: number | string })?.crypto_amount ?? 0;
    const buyerMerchantId = p.buyerMerchantId ?? null;
    const isM2M = !!buyerMerchantId;

    // Sequential single-statement updates. Wrapped in Promise.all → catch
    // so we don't lose visibility if any one fails. Errors are non-fatal
    // (stats are denormalized convenience; reputation worker recomputes
    // from the orders table separately).
    const statements: Promise<unknown>[] = [];

    // Seller / primary merchant
    statements.push(dbQuery(
      `UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
      [cryptoAmount, p.merchantId],
    ));

    // M2M buyer merchant — same credit as the seller. Both parties traded
    // crypto_amount worth.
    if (isM2M && buyerMerchantId !== p.merchantId) {
      statements.push(dbQuery(
        `UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
        [cryptoAmount, buyerMerchantId],
      ));
    }

    // User stats — skip for M2M (the user_id on M2M is a placeholder, not
    // a real trading user). For non-M2M, p.userId is the real counterparty.
    if (!isM2M && p.userId) {
      statements.push(dbQuery(
        `UPDATE users SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
        [cryptoAmount, p.userId],
      ));
    }

    Promise.allSettled(statements).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        logger.error('[NotificationListener] Stats update partial failure', {
          orderId: p.orderId,
          failures: failed.map((r) => (r as PromiseRejectedResult).reason).map(String),
        });
      }
    });
  });

  logger.info('[NotificationListener] Registered');
}
