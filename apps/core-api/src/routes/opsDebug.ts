/**
 * Ops Debug Route — Single-truth order inspection
 *
 * GET /ops/orders/:id/debug
 *
 * Returns order + events + ledger + tx hashes + invariant results in one response.
 * Protected by x-core-api-secret (via auth hook). Works in production.
 */
import type { FastifyPluginAsync } from 'fastify';
import { query, queryOne, checkInvariants } from 'settlement-core';

// ─── Types ────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  status: string;
  escrow_tx_hash: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  [key: string]: unknown;
}

interface EventRow {
  id: string;
  order_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  old_status: string | null;
  new_status: string | null;
  metadata: unknown;
  request_id: string | null;
  created_at: string;
}

// ─── Route ────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const opsDebugRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    '/ops/orders/:id/debug',
    async (request, reply) => {
      const { id } = request.params;

      if (!UUID_RE.test(id)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid order ID format',
        });
      }

      // Fetch order first (fail fast on 404)
      const order = await queryOne<OrderRow>(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: 'Order not found',
        });
      }

      // Parallel queries — all indexed
      const [events, ledgerEntries, transactions] = await Promise.all([
        query<EventRow>(
          `SELECT * FROM order_events
           WHERE order_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [id]
        ),
        query(
          `SELECT * FROM ledger_entries
           WHERE related_order_id = $1
           ORDER BY created_at DESC`,
          [id]
        ),
        query(
          `SELECT * FROM merchant_transactions
           WHERE order_id = $1
           ORDER BY created_at ASC`,
          [id]
        ),
      ]);

      const invariants = checkInvariants(order as any, events, ledgerEntries as any[]);

      return {
        order,
        events,
        ledger_entries: ledgerEntries,
        tx: {
          escrow_tx_hash: order.escrow_tx_hash || null,
          release_tx_hash: order.release_tx_hash || null,
          refund_tx_hash: order.refund_tx_hash || null,
        },
        invariants,
        meta: {
          request_id: request.id,
          generated_at: new Date().toISOString(),
        },
      };
    }
  );
};
