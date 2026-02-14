/**
 * Core API Expire Routes
 *
 * POST /v1/orders/expire - Batch expire orders past their deadline
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  normalizeStatus,
  logger,
  MOCK_MODE,
} from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';

export const expireRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/expire - Batch expire
  fastify.post('/orders/expire', async (_request, reply) => {
    try {
      // Find expired orders
      const ordersToExpire = await dbQuery<{
        id: string; status: string; user_id: string; merchant_id: string;
        buyer_merchant_id: string | null; type: string; crypto_amount: string;
        escrow_tx_hash: string | null; accepted_at: string | null;
      }>(
        `SELECT id, status, user_id, merchant_id, buyer_merchant_id, type, crypto_amount, escrow_tx_hash, accepted_at
         FROM orders
         WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
           AND (
             (status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes')
             OR (status NOT IN ('pending') AND COALESCE(accepted_at, created_at) < NOW() - INTERVAL '120 minutes')
           )`
      );

      if (ordersToExpire.length === 0) {
        return reply.send({ success: true, message: 'No orders to expire', expiredCount: 0 });
      }

      const pendingExpired = ordersToExpire.filter(o => o.status === 'pending');
      const acceptedExpired = ordersToExpire.filter(o => o.status !== 'pending');
      let totalExpired = 0;

      // Expire pending orders
      if (pendingExpired.length > 0) {
        const pendingIds = pendingExpired.map(o => o.id);
        await dbQuery(
          `UPDATE orders
           SET status = 'expired'::order_status,
               cancelled_at = NOW(),
               cancelled_by = 'system',
               cancellation_reason = 'Order expired - no one accepted within 15 minutes',
               order_version = order_version + 1
           WHERE id = ANY($1)`,
          [pendingIds]
        );
        totalExpired += pendingIds.length;

        for (const o of pendingExpired) {
          broadcastOrderEvent({
            event_type: 'ORDER_EXPIRED',
            order_id: o.id,
            status: 'expired',
            minimal_status: normalizeStatus('expired' as any),
            order_version: 0,
            userId: o.user_id,
            merchantId: o.merchant_id,
            previousStatus: o.status,
          });
        }
      }

      // Handle accepted+ orders
      for (const order of acceptedExpired) {
        const hasEscrow = !!order.escrow_tx_hash;

        if (hasEscrow) {
          // Escrowed orders go to disputed
          await dbQuery(
            `UPDATE orders
             SET status = 'disputed'::order_status,
                 cancellation_reason = 'Order timed out with escrow locked',
                 order_version = order_version + 1
             WHERE id = $1`,
            [order.id]
          );
        } else {
          // Non-escrowed orders get cancelled
          await dbQuery(
            `UPDATE orders
             SET status = 'cancelled'::order_status,
                 cancelled_at = NOW(),
                 cancelled_by = 'system',
                 cancellation_reason = 'Order timed out',
                 order_version = order_version + 1
             WHERE id = $1`,
            [order.id]
          );
        }

        // Event
        const newStatus = hasEscrow ? 'disputed' : 'cancelled';
        await dbQuery(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, $2, 'system', 'expiry-endpoint', $3, $4, $5)`,
          [
            order.id,
            `status_changed_to_${newStatus}`,
            order.status,
            newStatus,
            JSON.stringify({ reason: 'Order timed out' }),
          ]
        );

        // Notification outbox
        await dbQuery(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, $2, $3, 'pending')`,
          [
            order.id,
            `ORDER_${newStatus.toUpperCase()}`,
            JSON.stringify({
              orderId: order.id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: newStatus,
              previousStatus: order.status,
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        broadcastOrderEvent({
          event_type: `ORDER_${newStatus.toUpperCase()}`,
          order_id: order.id,
          status: newStatus,
          minimal_status: normalizeStatus(newStatus as any),
          order_version: 0,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        totalExpired++;
      }

      logger.info('[core-api] Orders expired', { count: totalExpired });

      return reply.send({
        success: true,
        message: `Expired ${totalExpired} orders`,
        expiredCount: totalExpired,
      });
    } catch (error) {
      fastify.log.error({ error }, 'Error expiring orders');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
