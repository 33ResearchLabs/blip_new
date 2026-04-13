/**
 * Core API Extension Routes
 *
 * POST /v1/orders/:id/extension - Request time extension
 * PUT /v1/orders/:id/extension - Accept/decline extension
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  queryOne,
  canExtendOrder,
  getExtensionDuration,
  getExpiryOutcome,
  normalizeStatus,
  logger,
} from 'settlement-core';
import { ORDER_EVENT } from '../events';
import { insertOutboxEventDirect } from '../outbox';

export const extensionRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/extension - Request extension
  // Allowed durations for payment_sent extensions (fiat sender picks one)
  const PAYMENT_SENT_EXTENSION_OPTIONS = [15, 60, 720]; // 15min, 60min, 12hr

  fastify.post<{
    Params: { id: string };
    Body: {
      actor_type: 'user' | 'merchant';
      actor_id: string;
      duration_minutes?: number; // optional: fiat sender picks from 15, 60, 720
    };
  }>('/orders/:id/extension', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, duration_minutes } = request.body;

    if (!actor_type || !actor_id) {
      return reply.status(400).send({ success: false, error: 'actor_type and actor_id required' });
    }

    try {
      const order = await queryOne<{
        id: string; status: string; extension_count: number; max_extensions: number;
        extension_requested_by: string | null; user_id: string; merchant_id: string;
      }>(
        'SELECT id, status, extension_count, max_extensions, extension_requested_by, user_id, merchant_id FROM orders WHERE id = $1',
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      const extensionCheck = canExtendOrder(order.status as any, order.extension_count, order.max_extensions);
      if (!extensionCheck.canExtend) {
        return reply.status(400).send({ success: false, error: extensionCheck.reason });
      }

      if (order.extension_requested_by) {
        return reply.status(400).send({ success: false, error: 'Extension request already pending' });
      }

      // For payment_sent orders, fiat sender can pick from preset durations
      let duration: number;
      if (order.status === 'payment_sent' && duration_minutes) {
        if (!PAYMENT_SENT_EXTENSION_OPTIONS.includes(duration_minutes)) {
          return reply.status(400).send({
            success: false,
            error: `Invalid duration. Allowed: ${PAYMENT_SENT_EXTENSION_OPTIONS.join(', ')} minutes`,
          });
        }
        duration = duration_minutes;
      } else {
        duration = getExtensionDuration(order.status as any);
      }

      const updatedOrder = await queryOne(
        `UPDATE orders
         SET extension_requested_by = $2,
             extension_requested_at = NOW(),
             extension_minutes = $3,
             order_version = order_version + 1
         WHERE id = $1
         RETURNING *`,
        [id, actor_type, duration]
      );

      await dbQuery(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'extension_requested', $2, $3, $4)`,
        [id, actor_type, actor_id, JSON.stringify({ extension_count: order.extension_count, extension_minutes: duration })]
      );

      logger.info('[core-api] Extension requested', { orderId: id, actor: actor_type });

      await insertOutboxEventDirect({
        event: ORDER_EVENT.STATUS_CHANGED,
        orderId: id, previousStatus: order.status, newStatus: order.status,
        actorType: actor_type, actorId: actor_id,
        userId: order.user_id, merchantId: order.merchant_id,
        order: updatedOrder as unknown as Record<string, unknown>,
        orderVersion: (updatedOrder as any).order_version, minimalStatus: normalizeStatus(order.status as any),
        metadata: { extension_requested: true },
      });

      return reply.send({ success: true, data: updatedOrder });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error requesting extension');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // PUT /v1/orders/:id/extension - Accept/decline extension
  fastify.put<{
    Params: { id: string };
    Body: {
      actor_type: 'user' | 'merchant';
      actor_id: string;
      accept: boolean;
    };
  }>('/orders/:id/extension', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, accept } = request.body;

    if (!actor_type || !actor_id || accept === undefined) {
      return reply.status(400).send({ success: false, error: 'actor_type, actor_id, and accept required' });
    }

    try {
      const order = await queryOne<{
        id: string; status: string; extension_count: number; max_extensions: number;
        extension_requested_by: string | null; extension_minutes: number;
        user_id: string; merchant_id: string;
      }>(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      if (!order.extension_requested_by) {
        return reply.status(400).send({ success: false, error: 'No extension request pending' });
      }

      if (order.extension_requested_by === actor_type) {
        return reply.status(400).send({ success: false, error: 'Cannot respond to own request' });
      }

      let updatedOrder;

      if (accept) {
        const extensionMinutes = order.extension_minutes || getExtensionDuration(order.status as any);

        updatedOrder = await queryOne(
          `UPDATE orders
           SET extension_count = extension_count + 1,
               extension_requested_by = NULL,
               extension_requested_at = NULL,
               last_extended_at = NOW(),
               expires_at = COALESCE(expires_at, NOW()) + INTERVAL '1 minute' * $2,
               order_version = order_version + 1
           WHERE id = $1
           RETURNING *`,
          [id, extensionMinutes]
        );

        await dbQuery(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'extension_accepted', $2, $3, $4)`,
          [id, actor_type, actor_id, JSON.stringify({ extension_count: order.extension_count + 1, extension_minutes: extensionMinutes })]
        );
      } else {
        // Decline - determine outcome
        const outcome = getExpiryOutcome(order.status as any, order.extension_count, order.max_extensions);

        if (outcome === 'disputed') {
          updatedOrder = await queryOne(
            `UPDATE orders
             SET extension_requested_by = NULL,
                 extension_requested_at = NULL,
                 status = 'disputed',
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id]
          );

          await dbQuery(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_disputed', 'system', NULL, $2, 'disputed', $3)`,
            [id, order.status, JSON.stringify({ reason: 'Extension declined after max extensions' })]
          );
        } else {
          updatedOrder = await queryOne(
            `UPDATE orders
             SET extension_requested_by = NULL,
                 extension_requested_at = NULL,
                 status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by = $2,
                 cancellation_reason = 'Extension declined',
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id, actor_type]
          );

          await dbQuery(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_cancelled', $2, $3, $4, 'cancelled', $5)`,
            [id, actor_type, actor_id, order.status, JSON.stringify({ reason: 'Extension declined' })]
          );
        }

        // Decline event
        await dbQuery(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'extension_declined', $2, $3, $4)`,
          [id, actor_type, actor_id, JSON.stringify({ outcome })]
        );
      }

      logger.info('[core-api] Extension response', { orderId: id, accepted: accept });

      const finalStatus = (updatedOrder as any).status || order.status;
      const extEvent = finalStatus === 'cancelled' ? ORDER_EVENT.CANCELLED
        : finalStatus === 'expired' ? ORDER_EVENT.EXPIRED
        : ORDER_EVENT.STATUS_CHANGED;
      await insertOutboxEventDirect({
        event: extEvent,
        orderId: id, previousStatus: order.status, newStatus: finalStatus,
        actorType: actor_type, actorId: actor_id,
        userId: order.user_id, merchantId: order.merchant_id,
        order: updatedOrder as unknown as Record<string, unknown>,
        orderVersion: (updatedOrder as any).order_version, minimalStatus: normalizeStatus(finalStatus as any),
        metadata: { extension_accepted: accept },
      });

      return reply.send({
        success: true,
        data: updatedOrder,
      });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error responding to extension');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
