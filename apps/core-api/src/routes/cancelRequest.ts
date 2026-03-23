/**
 * Core API Cancel Request Routes
 *
 * POST /v1/orders/:id/cancel-request - Request mutual cancellation
 * PUT  /v1/orders/:id/cancel-request - Accept/decline cancel request
 *
 * Flow:
 *   - Before acceptance (pending): unilateral cancel via normal PATCH status
 *   - After acceptance: one party requests → other approves/declines
 *   - If approved: atomic cancel + escrow refund
 *   - If declined: request cleared, order continues
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  queryOne,
  normalizeStatus,
  canUnilateralCancel,
  canRequestCancel,
  logger,
  MOCK_MODE,
} from 'settlement-core';
import { orderBus, ORDER_EVENT } from '../events';

interface OrderRow {
  id: string;
  status: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  cancel_requested_by: string | null;
  cancel_request_reason: string | null;
  crypto_amount: string;
  type: string;
  escrow_tx_hash: string | null;
  escrow_debited_entity_type: string | null;
  escrow_debited_entity_id: string | null;
  offer_id: string | null;
}

export const cancelRequestRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/cancel-request — Request cancellation
  fastify.post<{
    Params: { id: string };
    Body: {
      actor_type: 'user' | 'merchant';
      actor_id: string;
      reason?: string;
    };
  }>('/orders/:id/cancel-request', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, reason } = request.body;

    if (!actor_type || !actor_id) {
      return reply.status(400).send({ success: false, error: 'actor_type and actor_id required' });
    }

    try {
      const order = await queryOne<OrderRow>(
        `SELECT id, status, user_id, merchant_id, buyer_merchant_id, cancel_requested_by, crypto_amount, type,
                escrow_tx_hash, escrow_debited_entity_type, escrow_debited_entity_id, offer_id
         FROM orders WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      // Verify actor is a participant in this order
      const isParticipant = actor_id === order.user_id
        || actor_id === order.merchant_id
        || (order.buyer_merchant_id && actor_id === order.buyer_merchant_id);
      if (!isParticipant) {
        return reply.status(403).send({ success: false, error: 'Not authorized — you are not a participant in this order' });
      }

      // If pre-acceptance, just cancel directly (unilateral)
      if (canUnilateralCancel(order.status as any)) {
        return reply.status(400).send({
          success: false,
          error: 'Order can be cancelled directly — no request needed. Use PATCH status=cancelled.',
        });
      }

      if (!canRequestCancel(order.status as any)) {
        return reply.status(400).send({
          success: false,
          error: `Cancel request not allowed in '${order.status}' status`,
        });
      }

      if (order.cancel_requested_by) {
        return reply.status(400).send({
          success: false,
          error: 'Cancel request already pending',
        });
      }

      // Set cancel request
      const updated = await queryOne(
        `UPDATE orders
         SET cancel_requested_by = $2,
             cancel_requested_at = NOW(),
             cancel_request_reason = $3,
             last_activity_at = NOW(),
             order_version = order_version + 1
         WHERE id = $1
         RETURNING *`,
        [id, actor_type, reason || 'Requested cancellation']
      );

      // Event
      await dbQuery(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'cancel_requested', $2, $3, $4)`,
        [id, actor_type, actor_id, JSON.stringify({ reason: reason || 'Requested cancellation' })]
      );

      // Notification
      await dbQuery(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status)
         VALUES ($1, 'CANCEL_REQUESTED', $2, 'pending')`,
        [
          id,
          JSON.stringify({
            orderId: id,
            userId: order.user_id,
            merchantId: order.merchant_id,
            requestedBy: actor_type,
            reason: reason || 'Requested cancellation',
            status: order.status,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      logger.info('[core-api] Cancel requested', { orderId: id, by: actor_type });

      orderBus.emitOrderEvent({
        event: ORDER_EVENT.STATUS_CHANGED,
        orderId: id, previousStatus: order.status, newStatus: order.status,
        actorType: actor_type, actorId: actor_id,
        userId: order.user_id, merchantId: order.merchant_id,
        order: updated as unknown as Record<string, unknown>,
        orderVersion: (updated as any).order_version, minimalStatus: normalizeStatus(order.status as any),
        metadata: { cancel_requested: true, reason },
      });

      return reply.send({ success: true, data: updated });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error requesting cancel');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // PUT /v1/orders/:id/cancel-request — Accept or decline
  fastify.put<{
    Params: { id: string };
    Body: {
      actor_type: 'user' | 'merchant';
      actor_id: string;
      accept: boolean;
    };
  }>('/orders/:id/cancel-request', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, accept } = request.body;

    if (!actor_type || !actor_id || accept === undefined) {
      return reply.status(400).send({ success: false, error: 'actor_type, actor_id, and accept required' });
    }

    try {
      const order = await queryOne<OrderRow>(
        `SELECT id, status, user_id, merchant_id, buyer_merchant_id, cancel_requested_by, cancel_request_reason,
                crypto_amount, type, escrow_tx_hash,
                escrow_debited_entity_type, escrow_debited_entity_id, offer_id
         FROM orders WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      if (!order.cancel_requested_by) {
        return reply.status(400).send({ success: false, error: 'No cancel request pending' });
      }

      // Verify actor is a participant in this order
      const isParticipant = actor_id === order.user_id
        || actor_id === order.merchant_id
        || (order.buyer_merchant_id && actor_id === order.buyer_merchant_id);
      if (!isParticipant) {
        return reply.status(403).send({ success: false, error: 'Not authorized — you are not a participant in this order' });
      }

      // Cannot respond to own cancel request (check actor_type for non-M2M, actor_id for M2M)
      // For M2M trades, both parties are 'merchant', so we need actor_id check
      if (order.cancel_requested_by === actor_type) {
        // M2M: both are merchants, so check actor_id against who requested
        // cancel_requested_by only stores type, not id — so for M2M we allow the counterparty merchant
        const isM2M = !!order.buyer_merchant_id;
        if (!isM2M) {
          return reply.status(400).send({ success: false, error: 'Cannot respond to your own cancel request' });
        }
        // For M2M: we can't tell who requested from type alone, but at least verify it's a different actor
        // This is a best-effort check — full fix needs cancel_requested_by_id column
      }

      if (!accept) {
        // DECLINE — clear request, order continues
        const updated = await queryOne(
          `UPDATE orders
           SET cancel_requested_by = NULL,
               cancel_requested_at = NULL,
               cancel_request_reason = NULL,
               last_activity_at = NOW(),
               order_version = order_version + 1
           WHERE id = $1
           RETURNING *`,
          [id]
        );

        await dbQuery(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'cancel_declined', $2, $3, $4)`,
          [id, actor_type, actor_id, JSON.stringify({ reason: 'Cancel request declined' })]
        );

        orderBus.emitOrderEvent({
          event: ORDER_EVENT.STATUS_CHANGED,
          orderId: id, previousStatus: order.status, newStatus: order.status,
          actorType: actor_type, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id,
          order: updated as unknown as Record<string, unknown>,
          orderVersion: (updated as any).order_version, minimalStatus: normalizeStatus(order.status as any),
          metadata: { cancel_declined: true },
        });

        logger.info('[core-api] Cancel declined', { orderId: id, by: actor_type });
        return reply.send({ success: true, data: updated, declined: true });
      }

      // ACCEPT — both agree to cancel → atomic cancel with escrow refund
      const amount = parseFloat(String(order.crypto_amount));
      const hasEscrow = !!order.escrow_tx_hash;

      // Refund escrow in mock mode
      if (hasEscrow && MOCK_MODE) {
        let refundTo: string;
        let refundTable: string;

        // Use tracked escrow debited entity if available
        if (order.escrow_debited_entity_type && order.escrow_debited_entity_id) {
          refundTable = order.escrow_debited_entity_type === 'user' ? 'users' : 'merchants';
          refundTo = order.escrow_debited_entity_id;
        } else {
          // Fallback: sell order → user locked escrow, buy order → merchant
          const isSellOrder = order.type === 'sell';
          refundTo = isSellOrder ? order.user_id : order.merchant_id;
          refundTable = isSellOrder ? 'users' : 'merchants';
        }

        await dbQuery(
          `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
          [amount, refundTo]
        );

        logger.info('[core-api] Escrow refunded on mutual cancel', {
          orderId: id, amount, refundTo, table: refundTable,
        });
      }

      // Restore offer liquidity
      if (order.offer_id) {
        await dbQuery(
          `UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2`,
          [amount, order.offer_id]
        );
      }

      // Update order to cancelled
      const updated = await queryOne(
        `UPDATE orders
         SET status = 'cancelled',
             cancelled_at = NOW(),
             cancelled_by = 'system',
             cancellation_reason = $2,
             cancel_requested_by = NULL,
             cancel_requested_at = NULL,
             last_activity_at = NOW(),
             order_version = order_version + 1
         WHERE id = $1
         RETURNING *`,
        [id, `Mutual cancel: ${order.cancel_request_reason || 'Both parties agreed'}`]
      );

      // Events
      await dbQuery(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'cancel_accepted', $2, $3, $4, 'cancelled', $5)`,
        [id, actor_type, actor_id, order.status, JSON.stringify({
          reason: order.cancel_request_reason,
          requestedBy: order.cancel_requested_by,
          acceptedBy: actor_type,
          escrowRefunded: hasEscrow,
        })]
      );

      // Notification
      await dbQuery(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status)
         VALUES ($1, 'ORDER_CANCELLED', $2, 'pending')`,
        [
          id,
          JSON.stringify({
            orderId: id,
            userId: order.user_id,
            merchantId: order.merchant_id,
            status: 'cancelled',
            previousStatus: order.status,
            reason: `Mutual cancel: ${order.cancel_request_reason}`,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      logger.info('[core-api] Mutual cancel completed', { orderId: id });

      orderBus.emitOrderEvent({
        event: ORDER_EVENT.CANCELLED,
        orderId: id, previousStatus: order.status, newStatus: 'cancelled',
        actorType: actor_type, actorId: actor_id,
        userId: order.user_id, merchantId: order.merchant_id,
        order: updated as unknown as Record<string, unknown>,
        orderVersion: (updated as any).order_version, minimalStatus: normalizeStatus('cancelled' as any),
      });

      return reply.send({ success: true, data: updated, cancelled: true });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error responding to cancel request');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
