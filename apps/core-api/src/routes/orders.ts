/**
 * Core API Orders Routes
 *
 * Handles order reads + finalization events (release/refund) +
 * general status transitions (PATCH) + cancellation (DELETE).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  queryOne,
  transaction,
  Order,
  OrderStatus,
  ActorType,
  atomicCancelWithRefund,
  verifyReleaseInvariants,
  verifyRefundInvariants,
  validateTransition,
  normalizeStatus,
  isTransientStatus,
  getTransitionEventType,
  shouldRestoreLiquidity,
  logger,
  MOCK_MODE,
} from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';

interface OrderRow {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  offer_id: string;
  buyer_merchant_id: string | null;
  type: string;
  payment_method: string;
  crypto_amount: string;
  crypto_currency: string;
  fiat_amount: string;
  fiat_currency: string;
  rate: string;
  platform_fee: string;
  network_fee: string;
  status: OrderStatus;
  escrow_tx_hash: string | null;
  escrow_address: string | null;
  escrow_trade_id: number | null;
  escrow_trade_pda: string | null;
  escrow_pda: string | null;
  escrow_creator_wallet: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  buyer_wallet_address: string | null;
  acceptor_wallet_address: string | null;
  payment_details: Record<string, unknown> | null;
  created_at: Date;
  accepted_at: Date | null;
  escrowed_at: Date | null;
  payment_sent_at: Date | null;
  payment_confirmed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  expires_at: Date | null;
  cancelled_by: ActorType | null;
  cancellation_reason: string | null;
  extension_count: number;
  max_extensions: number;
  extension_requested_by: ActorType | null;
  extension_requested_at: Date | null;
  extension_minutes: number;
  has_manual_message: boolean;
  assigned_compliance_id: string | null;
  spread_preference: string | null;
  protocol_fee_percentage: string | null;
  protocol_fee_amount: string | null;
  order_version: number;
}

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /v1/orders/:id
  fastify.get<{ Params: { id: string } }>(
    '/orders/:id',
    async (request, reply) => {
      const { id } = request.params;

      try {
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

        const orderWithMinimalStatus = {
          ...order,
          minimal_status: normalizeStatus(order.status),
        };

        return reply.send({
          success: true,
          data: orderWithMinimalStatus,
        });
      } catch (error) {
        fastify.log.error({ error, id }, 'Error fetching order');
        return reply.status(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  // PATCH /v1/orders/:id - General status transition
  fastify.patch<{
    Params: { id: string };
    Body: {
      status: OrderStatus;
      actor_type: ActorType;
      actor_id: string;
      reason?: string;
      acceptor_wallet_address?: string;
      metadata?: Record<string, unknown>;
    };
  }>('/orders/:id', async (request, reply) => {
    const { id } = request.params;
    const { status: newStatus, actor_type, actor_id, reason, acceptor_wallet_address } = request.body;

    if (!newStatus || !actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'status, actor_type, and actor_id are required',
      });
    }

    try {
      // Fetch current order
      const order = await queryOne<OrderRow>(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      // Special case: Cancellation with escrow - use atomic refund path
      if (newStatus === 'cancelled' && order.escrow_tx_hash) {
        const result = await atomicCancelWithRefund(
          id,
          order.status,
          actor_type,
          actor_id,
          reason,
          {
            type: order.type as 'buy' | 'sell',
            crypto_amount: parseFloat(String(order.crypto_amount)),
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: parseInt(order.order_number, 10),
            crypto_currency: order.crypto_currency,
            fiat_amount: parseFloat(String(order.fiat_amount)),
            fiat_currency: order.fiat_currency,
          }
        );

        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }

        try {
          await verifyRefundInvariants({
            orderId: id,
            expectedStatus: 'cancelled',
            expectedMinOrderVersion: order.order_version + 1,
          });
        } catch (invariantError) {
          logger.error('[CRITICAL] Refund invariant FAILED (PATCH cancel)', { orderId: id, error: invariantError });
          return reply.status(500).send({ success: false, error: 'ORDER_REFUND_INVARIANT_FAILED' });
        }

        broadcastOrderEvent({
          event_type: 'ORDER_CANCELLED',
          order_id: id,
          status: 'cancelled',
          minimal_status: 'cancelled',
          order_version: result.order!.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        return reply.send({
          success: true,
          data: { ...result.order, minimal_status: normalizeStatus(result.order!.status) },
        });
      }

      // Prevent writing transient statuses
      if (isTransientStatus(newStatus)) {
        return reply.status(400).send({
          success: false,
          error: `Status '${newStatus}' is transient. Use '${normalizeStatus(newStatus)}' instead.`,
        });
      }

      // General status update with state machine validation
      const result = await transaction(async (client) => {
        const currentResult = await client.query<OrderRow>(
          'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
          [id]
        );

        if (currentResult.rows.length === 0) {
          return { success: false as const, error: 'Order not found' };
        }

        const currentOrder = currentResult.rows[0];
        const oldStatus = currentOrder.status;

        // Validate transition
        const validation = validateTransition(oldStatus, newStatus, actor_type);
        if (!validation.valid) {
          return { success: false as const, error: validation.error };
        }

        // Idempotency
        if (oldStatus === newStatus) {
          return { success: true as const, order: currentOrder };
        }

        // Prevent completing without escrow release
        if (newStatus === 'completed' && currentOrder.escrow_tx_hash && !currentOrder.release_tx_hash) {
          return { success: false as const, error: 'Cannot complete: escrow not released' };
        }

        // Prevent merchant from accepting their own merchant-initiated orders
        if (
          actor_type === 'merchant' &&
          (newStatus === 'accepted' || newStatus === 'payment_pending') &&
          currentOrder.merchant_id === actor_id
        ) {
          const userResult = await client.query<{ username: string }>(
            'SELECT username FROM users WHERE id = $1',
            [currentOrder.user_id]
          );
          const username = userResult.rows[0]?.username || '';
          if (username.startsWith('open_order_') || username.startsWith('m2m_')) {
            return { success: false as const, error: 'Cannot accept your own order' };
          }
        }

        // Merchant claiming logic
        const isMerchantClaiming =
          actor_type === 'merchant' &&
          (oldStatus === 'pending' || oldStatus === 'escrowed') &&
          newStatus === 'accepted' &&
          currentOrder.merchant_id !== actor_id;

        const isM2MAcceptance =
          actor_type === 'merchant' &&
          (oldStatus === 'escrowed' || oldStatus === 'pending') &&
          (newStatus === 'accepted' || newStatus === 'payment_pending') &&
          currentOrder.merchant_id !== actor_id;

        // Build dynamic update parts using parameterized queries (prevent SQL injection)
        let timestampField = '';
        const extraSetClauses: string[] = [];
        // Base params: $1 = status, $2 = id. Additional params start at $3+
        const updateParams: unknown[] = [];
        let paramIdx = 2; // next available param index

        const addParam = (value: unknown): string => {
          paramIdx++;
          updateParams.push(value);
          return `$${paramIdx}`;
        };

        switch (newStatus) {
          case 'accepted':
            timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
            // When accepting an already-escrowed order, the escrow creator (seller) must
            // remain as merchant_id. The acceptor becomes buyer_merchant_id.
            if ((isMerchantClaiming || isM2MAcceptance) && currentOrder.escrow_tx_hash && !currentOrder.buyer_merchant_id) {
              extraSetClauses.push(`buyer_merchant_id = ${addParam(actor_id)}`);
            } else if (isMerchantClaiming || (isM2MAcceptance && currentOrder.buyer_merchant_id)) {
              extraSetClauses.push(`merchant_id = ${addParam(actor_id)}`);
            } else if (isM2MAcceptance && !currentOrder.buyer_merchant_id) {
              extraSetClauses.push(`buyer_merchant_id = ${addParam(actor_id)}`);
            }
            if (acceptor_wallet_address) {
              extraSetClauses.push(`acceptor_wallet_address = ${addParam(acceptor_wallet_address)}`);
            }
            break;
          case 'escrowed':
            timestampField = ", escrowed_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
            break;
          case 'payment_pending':
            if (isM2MAcceptance) {
              timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
              if (currentOrder.buyer_merchant_id) {
                extraSetClauses.push(`merchant_id = ${addParam(actor_id)}`);
              } else {
                extraSetClauses.push(`buyer_merchant_id = ${addParam(actor_id)}`);
              }
              if (acceptor_wallet_address) {
                extraSetClauses.push(`acceptor_wallet_address = ${addParam(acceptor_wallet_address)}`);
              }
            }
            break;
          case 'payment_sent':
            timestampField = ', payment_sent_at = NOW()';
            break;
          case 'payment_confirmed':
            timestampField = ', payment_confirmed_at = NOW()';
            break;
          case 'completed':
            timestampField = ', completed_at = NOW()';
            break;
          case 'cancelled':
            timestampField = `, cancelled_at = NOW(), cancelled_by = ${addParam(actor_type)}::actor_type, cancellation_reason = ${addParam(reason || null)}::TEXT`;
            break;
          case 'expired':
            timestampField = ", cancelled_at = NOW(), cancelled_by = 'system', cancellation_reason = 'Timed out'";
            break;
        }

        // If accepting an already-escrowed order, keep status as escrowed
        let effectiveStatus: OrderStatus = newStatus;
        if (newStatus === 'accepted' && oldStatus === 'escrowed' && currentOrder.escrow_tx_hash) {
          effectiveStatus = 'escrowed' as OrderStatus;
        }

        const extraSetStr = extraSetClauses.length > 0 ? ', ' + extraSetClauses.join(', ') : '';
        const allParams: unknown[] = [effectiveStatus, id, ...updateParams];
        const sql = `UPDATE orders SET status = $1${timestampField}${extraSetStr}, order_version = order_version + 1 WHERE id = $2 RETURNING *`;

        const updateResult = await client.query<OrderRow>(sql, allParams);
        const updatedOrder = updateResult.rows[0];

        // Create event
        const eventType = getTransitionEventType(oldStatus, newStatus);
        await client.query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, eventType, actor_type, actor_id, oldStatus, newStatus, JSON.stringify(request.body.metadata || {})]
        );

        // Notification outbox
        await client.query(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, $2, $3, 'pending')`,
          [
            id,
            `ORDER_${newStatus.toUpperCase()}`,
            JSON.stringify({
              orderId: id,
              userId: updatedOrder.user_id,
              merchantId: updatedOrder.merchant_id,
              status: updatedOrder.status,
              minimal_status: normalizeStatus(updatedOrder.status),
              order_version: updatedOrder.order_version,
              previousStatus: oldStatus,
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        // Restore liquidity on cancellation/expiry
        if (shouldRestoreLiquidity(oldStatus, newStatus)) {
          await client.query(
            'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
            [currentOrder.crypto_amount, currentOrder.offer_id]
          );
        }

        // Stats on completion
        if (newStatus === 'completed') {
          await client.query(
            `UPDATE users SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
            [currentOrder.fiat_amount, currentOrder.user_id]
          );
          await client.query(
            `UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
            [currentOrder.fiat_amount, currentOrder.merchant_id]
          );
        }

        // Record reputation events for completed/cancelled/disputed transitions
        if (['completed', 'cancelled', 'disputed', 'expired'].includes(newStatus)) {
          const repEventType = newStatus === 'completed' ? 'order_completed'
            : newStatus === 'disputed' ? 'order_disputed'
            : newStatus === 'expired' ? 'order_timeout'
            : 'order_cancelled';
          const repScoreChange = newStatus === 'completed' ? 5
            : newStatus === 'disputed' ? -5
            : newStatus === 'expired' ? -5
            : -2;
          // Record for merchant
          await client.query(
            `INSERT INTO reputation_events (entity_id, entity_type, event_type, score_change, reason, metadata)
             VALUES ($1, 'merchant', $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [currentOrder.merchant_id, repEventType, repScoreChange, `Order ${currentOrder.order_number} ${newStatus}`, JSON.stringify({ order_id: id })]
          );
          // Record for user
          await client.query(
            `INSERT INTO reputation_events (entity_id, entity_type, event_type, score_change, reason, metadata)
             VALUES ($1, 'user', $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [currentOrder.user_id, repEventType, repScoreChange, `Order ${currentOrder.order_number} ${newStatus}`, JSON.stringify({ order_id: id })]
          );
        }

        // Mock mode balance handling for completed orders without release_tx_hash
        if (MOCK_MODE && newStatus === 'completed' && currentOrder.escrow_tx_hash && !currentOrder.release_tx_hash) {
          const amount = parseFloat(String(currentOrder.crypto_amount));
          const isBuyOrder = currentOrder.type === 'buy';
          const recipientId = isBuyOrder
            ? (currentOrder.buyer_merchant_id || currentOrder.user_id)
            : (currentOrder.buyer_merchant_id || currentOrder.merchant_id);
          const recipientTable = isBuyOrder
            ? (currentOrder.buyer_merchant_id ? 'merchants' : 'users')
            : 'merchants';

          await client.query(
            `UPDATE ${recipientTable} SET balance = balance + $1 WHERE id = $2`,
            [amount, recipientId]
          );
        }

        return { success: true as const, order: updatedOrder };
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      broadcastOrderEvent({
        event_type: `ORDER_${newStatus.toUpperCase()}`,
        order_id: id,
        status: result.order!.status,
        minimal_status: normalizeStatus(result.order!.status),
        order_version: result.order!.order_version,
        userId: result.order!.user_id,
        merchantId: result.order!.merchant_id,
        previousStatus: order!.status,
      });

      // Fire-and-forget reputation recalculation for terminal statuses
      if (['completed', 'cancelled', 'disputed', 'expired'].includes(newStatus)) {
        const settleUrl = process.env.SETTLE_URL || 'http://localhost:3000';
        Promise.allSettled([
          fetch(`${settleUrl}/api/reputation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: result.order!.merchant_id, entityType: 'merchant' }) }),
          fetch(`${settleUrl}/api/reputation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: result.order!.user_id, entityType: 'user' }) }),
        ]).catch(() => {});
      }

      return reply.send({
        success: true,
        data: { ...result.order, minimal_status: normalizeStatus(result.order!.status) },
      });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error updating order status');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // DELETE /v1/orders/:id - Cancel order
  fastify.delete<{
    Params: { id: string };
    Querystring: {
      actor_type: string;
      actor_id: string;
      reason?: string;
    };
  }>('/orders/:id', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, reason } = request.query;

    if (!actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'actor_type and actor_id query params required',
      });
    }

    try {
      const order = await queryOne<OrderRow>(
        'SELECT * FROM orders WHERE id = $1',
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      if (order.escrow_tx_hash) {
        // Atomic cancel with refund
        const result = await atomicCancelWithRefund(
          id,
          order.status,
          actor_type as ActorType,
          actor_id,
          reason || undefined,
          {
            type: order.type as 'buy' | 'sell',
            crypto_amount: parseFloat(String(order.crypto_amount)),
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: parseInt(order.order_number, 10),
            crypto_currency: order.crypto_currency,
            fiat_amount: parseFloat(String(order.fiat_amount)),
            fiat_currency: order.fiat_currency,
          }
        );

        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }

        try {
          await verifyRefundInvariants({
            orderId: id,
            expectedStatus: 'cancelled',
            expectedMinOrderVersion: order.order_version + 1,
          });
        } catch (invariantError) {
          logger.error('[CRITICAL] Refund invariant FAILED (DELETE)', { orderId: id, error: invariantError });
          return reply.status(500).send({ success: false, error: 'ORDER_REFUND_INVARIANT_FAILED' });
        }

        broadcastOrderEvent({
          event_type: 'ORDER_CANCELLED',
          order_id: id,
          status: 'cancelled',
          minimal_status: 'cancelled',
          order_version: result.order!.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        return reply.send({
          success: true,
          data: { ...result.order, minimal_status: normalizeStatus(result.order!.status) },
        });
      } else {
        // Simple cancel via state machine
        const result = await transaction(async (client) => {
          const current = await client.query<OrderRow>(
            'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
            [id]
          );

          if (current.rows.length === 0) {
            return { success: false as const, error: 'Order not found' };
          }

          const currentOrder = current.rows[0];
          const validation = validateTransition(currentOrder.status, 'cancelled' as OrderStatus, actor_type as ActorType);
          if (!validation.valid) {
            return { success: false as const, error: validation.error };
          }

          const updateResult = await client.query<OrderRow>(
            `UPDATE orders
             SET status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by = $2::actor_type,
                 cancellation_reason = $3,
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id, actor_type, reason || null]
          );

          const updatedOrder = updateResult.rows[0];

          await client.query(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_cancelled', $2, $3, $4, 'cancelled', $5)`,
            [id, actor_type, actor_id, currentOrder.status, JSON.stringify({ reason })]
          );

          await client.query(
            `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_CANCELLED', $2, 'pending')`,
            [
              id,
              JSON.stringify({
                orderId: id,
                userId: updatedOrder.user_id,
                merchantId: updatedOrder.merchant_id,
                status: 'cancelled',
                order_version: updatedOrder.order_version,
                previousStatus: currentOrder.status,
                updatedAt: new Date().toISOString(),
              }),
            ]
          );

          if (shouldRestoreLiquidity(currentOrder.status, 'cancelled' as OrderStatus)) {
            await client.query(
              'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
              [currentOrder.crypto_amount, currentOrder.offer_id]
            );
          }

          return { success: true as const, order: updatedOrder };
        });

        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }

        broadcastOrderEvent({
          event_type: 'ORDER_CANCELLED',
          order_id: id,
          status: 'cancelled',
          minimal_status: 'cancelled',
          order_version: result.order!.order_version,
          userId: result.order!.user_id,
          merchantId: result.order!.merchant_id,
          previousStatus: order.status,
        });

        return reply.send({
          success: true,
          data: { ...result.order, minimal_status: normalizeStatus(result.order!.status) },
        });
      }
    } catch (error) {
      fastify.log.error({ error, id }, 'Error cancelling order');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // POST /v1/orders/:id/events - Release/Refund finalization (existing)
  fastify.post<{
    Params: { id: string };
    Body: {
      event_type: 'release' | 'refund';
      tx_hash?: string;
      reason?: string;
    };
  }>('/orders/:id/events', async (request, reply) => {
    const { id } = request.params;
    const { event_type, tx_hash, reason } = request.body;

    const actorType = request.headers['x-actor-type'] as ActorType | undefined;
    const actorId = request.headers['x-actor-id'] as string | undefined;

    if (!actorType || !actorId) {
      return reply.status(401).send({ success: false, error: 'Actor headers required' });
    }

    try {
      const order = await transaction(async (client) => {
        const result = await client.query<OrderRow>(
          'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
          [id]
        );
        return result.rows[0] || null;
      });

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      if (event_type === 'release') {
        if (!tx_hash) {
          return reply.status(400).send({ success: false, error: 'tx_hash required for release' });
        }

        const result = await transaction(async (client) => {
          const updateResult = await client.query<OrderRow>(
            `UPDATE orders
             SET status = 'completed',
                 release_tx_hash = $1,
                 completed_at = NOW(),
                 payment_confirmed_at = COALESCE(payment_confirmed_at, NOW()),
                 order_version = order_version + 1
             WHERE id = $2
             RETURNING *`,
            [tx_hash, id]
          );

          const updatedOrder = updateResult.rows[0];

          await client.query(
            `INSERT INTO order_events
             (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, 'status_changed_to_completed', actorType, actorId, order.status, 'completed', { tx_hash }]
          );

          await client.query(
            `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, $2, $3, $4)`,
            [
              id,
              'ORDER_COMPLETED',
              JSON.stringify({
                orderId: id,
                userId: order.user_id,
                merchantId: order.merchant_id,
                status: 'completed',
                minimal_status: normalizeStatus('completed'),
                order_version: updatedOrder.order_version,
                previousStatus: order.status,
                updatedAt: new Date().toISOString(),
              }),
              'pending',
            ]
          );

          if (MOCK_MODE) {
            const amount = parseFloat(String(order.crypto_amount));
            const isBuyOrder = order.type === 'buy';
            const recipientId = isBuyOrder
              ? order.buyer_merchant_id || order.user_id
              : order.buyer_merchant_id || order.merchant_id;
            const recipientTable = isBuyOrder
              ? order.buyer_merchant_id ? 'merchants' : 'users'
              : 'merchants';

            await client.query(
              `UPDATE ${recipientTable} SET balance = balance + $1 WHERE id = $2`,
              [amount, recipientId]
            );
          }

          return updatedOrder;
        });

        try {
          await verifyReleaseInvariants({
            orderId: id,
            expectedStatus: 'completed',
            expectedTxHash: tx_hash,
            expectedMinOrderVersion: order.order_version + 1,
          });
        } catch (invariantError) {
          logger.error('[CRITICAL] Release invariant FAILED', { orderId: id, error: invariantError });
          return reply.status(500).send({ success: false, error: 'ORDER_RELEASE_INVARIANT_FAILED' });
        }

        broadcastOrderEvent({
          event_type: 'ORDER_COMPLETED',
          order_id: id,
          status: 'completed',
          minimal_status: 'completed',
          order_version: result.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        return reply.send({
          success: true,
          data: { ...result, minimal_status: normalizeStatus(result.status) },
        });
      } else if (event_type === 'refund') {
        const result = await atomicCancelWithRefund(
          id,
          order.status,
          actorType,
          actorId,
          reason,
          {
            type: order.type as 'buy' | 'sell',
            crypto_amount: parseFloat(String(order.crypto_amount)),
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: parseInt(order.order_number, 10),
            crypto_currency: order.crypto_currency,
            fiat_amount: parseFloat(String(order.fiat_amount)),
            fiat_currency: order.fiat_currency,
          }
        );

        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }

        try {
          await verifyRefundInvariants({
            orderId: id,
            expectedStatus: 'cancelled',
            expectedMinOrderVersion: order.order_version + 1,
          });
        } catch (invariantError) {
          logger.error('[CRITICAL] Refund invariant FAILED', { orderId: id, error: invariantError });
          return reply.status(500).send({ success: false, error: 'ORDER_REFUND_INVARIANT_FAILED' });
        }

        broadcastOrderEvent({
          event_type: 'ORDER_CANCELLED',
          order_id: id,
          status: 'cancelled',
          minimal_status: 'cancelled',
          order_version: result.order!.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status,
        });

        return reply.send({
          success: true,
          data: { ...result.order, minimal_status: normalizeStatus(result.order!.status) },
        });
      } else {
        return reply.status(400).send({ success: false, error: 'Invalid event_type' });
      }
    } catch (error) {
      fastify.log.error({ error, id, event_type }, 'Error processing order event');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
