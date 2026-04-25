/**
 * Core API Debug Routes (localhost only)
 *
 * GET /debug/ws      - WebSocket connection stats
 * GET /debug/workers - Worker heartbeat timestamps
 * GET /debug/outbox  - Notification outbox rows
 *
 * Guarded: returns 404 when NODE_ENV === 'production'.
 */
import type { FastifyPluginAsync } from 'fastify';
import { query, queryOne } from 'settlement-core';
import { getWsStats } from '../ws/broadcast';
import { readFileSync } from 'fs';
import { orderBus, ORDER_EVENT } from '../events/orderEvents';

export const debugRoutes: FastifyPluginAsync = async (fastify) => {
  // Block in production — return 404 to hide existence
  fastify.addHook('onRequest', async (_request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  // GET /debug/ws — connected clients, subscriptions
  fastify.get('/debug/ws', async () => {
    return getWsStats();
  });

  // GET /debug/workers — last heartbeat from each worker process
  fastify.get('/debug/workers', async () => {
    const readHeartbeat = (name: string) => {
      try {
        return JSON.parse(readFileSync(`/tmp/bm-worker-${name}.json`, 'utf-8'));
      } catch {
        return { status: 'not running or no heartbeat file' };
      }
    };

    return {
      outbox: readHeartbeat('outbox'),
      expiry: readHeartbeat('expiry'),
      autobump: readHeartbeat('autobump'),
    };
  });

  // GET /debug/outbox?status=pending&limit=50
  fastify.get<{
    Querystring: { status?: string; limit?: string };
  }>('/debug/outbox', async (request) => {
    const status = request.query.status || 'pending';
    const limit = Math.min(parseInt(request.query.limit || '50', 10), 200);

    const rows = await query(
      `SELECT id, order_id, event_type, status, attempts, max_attempts,
              created_at, last_attempt_at, sent_at, last_error
       FROM notification_outbox
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [status, limit]
    );

    const counts = await query<{ status: string; count: string }>(
      `SELECT status, count(*)::text FROM notification_outbox GROUP BY status ORDER BY status`
    );

    return {
      rows,
      counts: Object.fromEntries(counts.map((c) => [c.status, parseInt(c.count, 10)])),
      total: rows.length,
    };
  });

  // POST /debug/emit-cancel?orderId=...
  // Fires orderBus.emitOrderEvent with a synthetic CANCELLED payload to test
  // that all listeners (receipt, broadcast, notification) wire up correctly.
  fastify.post<{ Querystring: { orderId: string } }>(
    '/debug/emit-cancel',
    async (request) => {
      const { orderId } = request.query;
      const order = await queryOne<Record<string, unknown>>(
        'SELECT * FROM orders WHERE id = $1',
        [orderId],
      );
      if (!order) return { error: 'order not found' };
      orderBus.emitOrderEvent({
        event: ORDER_EVENT.CANCELLED,
        orderId,
        previousStatus: String(order.status),
        newStatus: 'cancelled',
        actorType: 'system',
        actorId: 'debug',
        userId: String(order.user_id),
        merchantId: order.merchant_id ? String(order.merchant_id) : null,
        buyerMerchantId: order.buyer_merchant_id ? String(order.buyer_merchant_id) : undefined,
        order: order,
        orderVersion: Number(order.order_version) || 1,
        minimalStatus: 'cancelled',
      });
      return { ok: true, emitted: 'order.cancelled', orderId };
    },
  );
};
