/**
 * Core API Dispute Routes
 *
 * POST /v1/orders/:id/dispute - Open a dispute
 * POST /v1/orders/:id/dispute/confirm - Confirm/reject dispute resolution
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  queryOne,
  normalizeStatus,
  logger,
} from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';

export const disputeRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/dispute - Open dispute
  fastify.post<{
    Params: { id: string };
    Body: {
      reason: string;
      description?: string;
      initiated_by: 'user' | 'merchant';
      actor_id: string;
    };
  }>('/orders/:id/dispute', async (request, reply) => {
    const { id } = request.params;
    const { reason, description, initiated_by, actor_id } = request.body;

    if (!reason || !initiated_by || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'reason, initiated_by, and actor_id are required',
      });
    }

    try {
      // Check order exists
      const order = await queryOne<{ id: string; status: string; user_id: string; merchant_id: string }>(
        'SELECT id, status, user_id, merchant_id FROM orders WHERE id = $1',
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      if (order.status === 'disputed') {
        return reply.status(400).send({ success: false, error: 'Order is already disputed' });
      }

      // Check if dispute already exists
      const existing = await dbQuery('SELECT id FROM disputes WHERE order_id = $1', [id]);
      if (existing.length > 0) {
        return reply.status(400).send({ success: false, error: 'Dispute already exists' });
      }

      // Ensure disputes table has confirmation columns
      try {
        await dbQuery(`
          ALTER TABLE disputes
          ADD COLUMN IF NOT EXISTS proposed_resolution VARCHAR(50),
          ADD COLUMN IF NOT EXISTS proposed_by UUID,
          ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
          ADD COLUMN IF NOT EXISTS user_confirmed BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS merchant_confirmed BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS split_percentage JSONB,
          ADD COLUMN IF NOT EXISTS assigned_to UUID
        `);
      } catch (alterErr) {
        // Columns may already exist
      }

      // Insert dispute
      const disputeResult = await dbQuery(
        `INSERT INTO disputes (
          order_id, reason, description, raised_by, raiser_id, status,
          user_confirmed, merchant_confirmed, created_at
        )
         VALUES ($1, $2::dispute_reason, $3, $4::actor_type, $5, 'open'::dispute_status, false, false, NOW())
         RETURNING *`,
        [id, reason, description || '', initiated_by, actor_id]
      );

      // Update order status
      await dbQuery(
        `UPDATE orders SET status = 'disputed'::order_status, order_version = order_version + 1 WHERE id = $1`,
        [id]
      );

      // Event
      await dbQuery(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'status_changed_to_disputed', $2, $3, $4, 'disputed', $5)`,
        [id, initiated_by, actor_id, order.status, JSON.stringify({ reason, description })]
      );

      // Notification outbox
      await dbQuery(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_DISPUTED', $2, 'pending')`,
        [
          id,
          JSON.stringify({
            orderId: id,
            userId: order.user_id,
            merchantId: order.merchant_id,
            status: 'disputed',
            previousStatus: order.status,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      logger.info('[core-api] Dispute created', { orderId: id, reason });

      broadcastOrderEvent({
        event_type: 'ORDER_DISPUTED',
        order_id: id,
        status: 'disputed',
        minimal_status: normalizeStatus('disputed' as any),
        order_version: 0, // version already incremented in DB
        userId: order.user_id,
        merchantId: order.merchant_id,
        previousStatus: order.status,
      });

      return reply.send({ success: true, data: disputeResult[0] });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error creating dispute');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // POST /v1/orders/:id/dispute/confirm - Confirm/reject resolution
  fastify.post<{
    Params: { id: string };
    Body: {
      party: 'user' | 'merchant';
      action: 'accept' | 'reject';
      partyId: string;
    };
  }>('/orders/:id/dispute/confirm', async (request, reply) => {
    const { id } = request.params;
    const { party, action, partyId } = request.body;

    if (!party || !action || !partyId) {
      return reply.status(400).send({ success: false, error: 'party, action, and partyId required' });
    }

    try {
      const disputeResult = await dbQuery(
        `SELECT d.*, o.user_id, o.merchant_id
         FROM disputes d JOIN orders o ON d.order_id = o.id
         WHERE d.order_id = $1`,
        [id]
      );

      if (disputeResult.length === 0) {
        return reply.status(404).send({ success: false, error: 'Dispute not found' });
      }

      const dispute = disputeResult[0] as any;

      if (dispute.status !== 'pending_confirmation') {
        return reply.status(400).send({ success: false, error: 'No pending resolution' });
      }

      // Verify party identity
      if (party === 'user' && partyId !== dispute.user_id) {
        return reply.status(403).send({ success: false, error: 'Unauthorized' });
      }
      if (party === 'merchant' && partyId !== dispute.merchant_id) {
        return reply.status(403).send({ success: false, error: 'Unauthorized' });
      }

      if (action === 'reject') {
        await dbQuery(
          `UPDATE disputes
           SET status = 'investigating'::dispute_status,
               proposed_resolution = NULL,
               user_confirmed = false,
               merchant_confirmed = false
           WHERE order_id = $1`,
          [id]
        );

        return reply.send({
          success: true,
          data: { status: 'investigating', message: 'Resolution rejected' },
        });
      }

      // Accept
      const updateField = party === 'user' ? 'user_confirmed' : 'merchant_confirmed';
      await dbQuery(`UPDATE disputes SET ${updateField} = true WHERE order_id = $1`, [id]);

      const updated = await queryOne<{
        user_confirmed: boolean; merchant_confirmed: boolean; proposed_resolution: string;
      }>('SELECT user_confirmed, merchant_confirmed, proposed_resolution FROM disputes WHERE order_id = $1', [id]);

      if (updated && updated.user_confirmed && updated.merchant_confirmed) {
        // Both confirmed - finalize
        const resolution = updated.proposed_resolution;

        const orderResult = await dbQuery(
          `SELECT o.*, d.split_percentage FROM orders o JOIN disputes d ON d.order_id = o.id WHERE o.id = $1`,
          [id]
        );
        const order = orderResult[0] as any;
        const amount = parseFloat(String(order.crypto_amount));

        let userAmount = 0;
        let merchantAmount = 0;
        let orderStatus = 'completed';

        if (resolution === 'user') {
          userAmount = amount;
          orderStatus = 'cancelled';
        } else if (resolution === 'merchant') {
          merchantAmount = amount;
          orderStatus = 'completed';
        } else if (resolution === 'split') {
          const splitPct = order.split_percentage
            ? (typeof order.split_percentage === 'string' ? JSON.parse(order.split_percentage) : order.split_percentage)
            : { user: 50, merchant: 50 };
          userAmount = amount * (splitPct.user / 100);
          merchantAmount = amount * (splitPct.merchant / 100);
          orderStatus = 'completed';
        }

        if (userAmount > 0) {
          await dbQuery('UPDATE users SET balance = balance + $1 WHERE id = $2', [userAmount, order.user_id]);
        }
        if (merchantAmount > 0) {
          await dbQuery('UPDATE merchants SET balance = balance + $1 WHERE id = $2', [merchantAmount, order.merchant_id]);
        }

        await dbQuery(
          `UPDATE disputes SET status = 'resolved'::dispute_status, resolution = $1, resolved_at = NOW() WHERE order_id = $2`,
          [resolution, id]
        );

        await dbQuery(
          `UPDATE orders SET status = $1::order_status, order_version = order_version + 1 WHERE id = $2`,
          [orderStatus, id]
        );

        // Notification outbox
        await dbQuery(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, $2, $3, 'pending')`,
          [
            id,
            `ORDER_${orderStatus.toUpperCase()}`,
            JSON.stringify({
              orderId: id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: orderStatus,
              previousStatus: 'disputed',
              resolution,
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        logger.info('[core-api] Dispute resolved', { orderId: id, resolution, orderStatus });

        broadcastOrderEvent({
          event_type: `ORDER_${orderStatus.toUpperCase()}`,
          order_id: id,
          status: orderStatus,
          minimal_status: normalizeStatus(orderStatus as any),
          order_version: 0,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: 'disputed',
        });

        return reply.send({
          success: true,
          data: {
            status: `resolved_${resolution}`,
            orderStatus,
            finalized: true,
            moneyReleased: { user: userAmount, merchant: merchantAmount, total: amount },
          },
        });
      }

      // One party confirmed
      return reply.send({
        success: true,
        data: {
          status: 'pending_confirmation',
          userConfirmed: party === 'user' ? true : dispute.user_confirmed,
          merchantConfirmed: party === 'merchant' ? true : dispute.merchant_confirmed,
          finalized: false,
        },
      });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error confirming dispute');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
