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
  shouldRestoreLiquidity,
  logger,
  MOCK_MODE,
} from 'settlement-core';

// Fire-and-forget helper — logs errors but never blocks
const bgQuery = (sql: string, params: unknown[]) => dbQuery(sql, params).catch(() => {});
import { orderBus, ORDER_EVENT, type OrderEventPayload } from '../events';

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
  payment_via: string;
  corridor_fulfillment_id: string | null;
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
      // Prevent writing transient statuses (no DB needed)
      if (isTransientStatus(newStatus)) {
        return reply.status(400).send({
          success: false,
          error: `Status '${newStatus}' is transient. Use '${normalizeStatus(newStatus)}' instead.`,
        });
      }

      // Global guard: reject transitions on self-referencing orders (merchant_id = buyer_merchant_id)
      // EXCEPT: 'accepted' (acceptance reassigns merchant_id), 'escrowed' (pre-lock before acceptance),
      // and 'cancelled' (always allowed). These are expected for merchant-created BUY orders.
      const selfRefAllowed = ['cancelled', 'accepted', 'escrowed'];
      if (!selfRefAllowed.includes(newStatus)) {
        const selfRefCheck = await queryOne<{ id: string }>(
          `SELECT id FROM orders WHERE id = $1 AND merchant_id = buyer_merchant_id`,
          [id]
        );
        if (selfRefCheck) {
          logger.error('[GUARD] Blocked transition on self-referencing order', { orderId: id, newStatus, actor_id });
          return reply.status(400).send({
            success: false,
            error: 'Order is in an invalid state (self-referencing). Please cancel and recreate.',
          });
        }
      }

      // Special case: Cancellation with escrow needs pre-read for atomicCancelWithRefund
      if (newStatus === 'cancelled') {
        const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
        if (!order) {
          return reply.status(404).send({ success: false, error: 'Order not found' });
        }
        if (order.escrow_tx_hash) {
          const cancelResult = await atomicCancelWithRefund(
            id, order.status, actor_type, actor_id, reason,
            {
              type: order.type as 'buy' | 'sell',
              crypto_amount: parseFloat(String(order.crypto_amount)),
              merchant_id: order.merchant_id, user_id: order.user_id,
              buyer_merchant_id: order.buyer_merchant_id,
              order_number: parseInt(order.order_number, 10),
              crypto_currency: order.crypto_currency,
              fiat_amount: parseFloat(String(order.fiat_amount)),
              fiat_currency: order.fiat_currency,
            }
          );
          if (!cancelResult.success) {
            return reply.status(400).send({ success: false, error: cancelResult.error });
          }
          try {
            await verifyRefundInvariants({ orderId: id, expectedStatus: 'cancelled', expectedMinOrderVersion: order.order_version + 1 });
          } catch (invariantError) {
            logger.error('[CRITICAL] Refund invariant FAILED (PATCH cancel)', { orderId: id, error: invariantError });
            return reply.status(500).send({ success: false, error: 'ORDER_REFUND_INVARIANT_FAILED' });
          }
          orderBus.emitOrderEvent({
            event: ORDER_EVENT.CANCELLED,
            orderId: id, previousStatus: order.status, newStatus: 'cancelled',
            actorType: actor_type, actorId: actor_id,
            userId: order.user_id, merchantId: order.merchant_id, buyerMerchantId: order.buyer_merchant_id ?? undefined,
            order: cancelResult.order as unknown as Record<string, unknown>,
            orderVersion: cancelResult.order!.order_version, minimalStatus: 'cancelled',
            refundTxHash: cancelResult.order?.refund_tx_hash ?? undefined,
          });
          return reply.send({ success: true, data: { ...cancelResult.order, minimal_status: normalizeStatus(cancelResult.order!.status) } });
        }
        // Non-escrow cancel falls through to general TX path
      }

      // Fast path: accept via stored procedure (4 round-trips → 1)
      if (newStatus === 'accepted' || (newStatus === 'payment_pending' && request.body.metadata?.is_m2m)) {
        // Belt-and-suspenders: block self-acceptance before stored proc
        if (actor_type === 'merchant') {
          const preCheck = await queryOne<{ merchant_id: string; user_id: string }>(
            'SELECT o.merchant_id, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1',
            [id]
          );
          if (preCheck && preCheck.merchant_id === actor_id) {
            const username = (preCheck as any).username || '';
            if (username.startsWith('open_order_') || username.startsWith('m2m_')) {
              logger.warn('[GUARD] Blocked self-acceptance', { orderId: id, actor_id });
              return reply.status(400).send({ success: false, error: 'Cannot accept your own order' });
            }
          }
        }
        const procResult = await queryOne<{ accept_order_v1: any }>(
          'SELECT accept_order_v1($1,$2,$3,$4)',
          [id, actor_type, actor_id, request.body.acceptor_wallet_address || null]
        );
        const data = procResult!.accept_order_v1;
        if (!data.success) {
          return reply.status(400).send({ success: false, error: data.error });
        }
        const order = data.order as OrderRow;
        const oldStatus = data.old_status;

        // Attach accepting merchant's default payment method to the order
        // so the counterparty knows where to send fiat
        if (actor_type === 'merchant' && actor_id && !order.merchant_payment_method_id) {
          try {
            const mpm = await queryOne<{ id: string }>(
              `SELECT id FROM merchant_payment_methods
               WHERE merchant_id = $1 AND is_active = true
               ORDER BY is_default DESC, created_at DESC LIMIT 1`,
              [actor_id]
            );
            if (mpm) {
              await dbQuery(
                'UPDATE orders SET merchant_payment_method_id = $1 WHERE id = $2',
                [mpm.id, id]
              );
              (order as any).merchant_payment_method_id = mpm.id;
            }
          } catch (e) {
            logger.warn('[core-api] Failed to attach merchant payment method on accept', { orderId: id, error: e });
          }
        }

        orderBus.emitOrderEvent({
          event: ORDER_EVENT.ACCEPTED,
          orderId: id, orderNumber: order.order_number,
          previousStatus: oldStatus, newStatus: order.status,
          actorType: actor_type, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id, buyerMerchantId: order.buyer_merchant_id ?? undefined,
          order: order as unknown as Record<string, unknown>,
          orderVersion: order.order_version, minimalStatus: normalizeStatus(order.status as OrderStatus),
          metadata: request.body.metadata,
        });
        return reply.send({ success: true, data: { ...order, minimal_status: normalizeStatus(order.status as OrderStatus) } });
      }

      // Fast path: payment_sent is a simple status flip — no TX needed
      if (newStatus === 'payment_sent') {
        const updated = await queryOne<OrderRow>(
          `UPDATE orders SET status = 'payment_sent', payment_sent_at = NOW(), order_version = order_version + 1
           WHERE id = $1 AND status = 'escrowed'
           RETURNING *`,
          [id]
        );
        if (!updated) {
          return reply.status(400).send({ success: false, error: 'Order not found or cannot transition to payment_sent' });
        }
        orderBus.emitOrderEvent({
          event: ORDER_EVENT.PAYMENT_SENT,
          orderId: id, previousStatus: 'escrowed', newStatus: 'payment_sent',
          actorType: actor_type, actorId: actor_id,
          userId: updated.user_id, merchantId: updated.merchant_id, buyerMerchantId: updated.buyer_merchant_id ?? undefined,
          order: updated as unknown as Record<string, unknown>,
          orderVersion: updated.order_version, minimalStatus: 'payment_sent',
        });
        return reply.send({ success: true, data: { ...updated, minimal_status: normalizeStatus(updated.status) } });
      }

      // General status update with state machine validation
      const result = await transaction(async (client) => {
        // Fresh reference to avoid TS control-flow narrowing from fast-path early returns above
        const newStatus: OrderStatus = request.body.status;
        const currentResult = await client.query<OrderRow>(
          'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
          [id]
        );

        if (currentResult.rows.length === 0) {
          return { success: false as const, error: 'Order not found' };
        }

        const currentOrder = currentResult.rows[0];
        const oldStatus = currentOrder.status;

        // Security: verify actor is a participant (skip for 'accepted' — acceptor is joining)
        if (newStatus !== 'accepted') {
          const isParticipant = actor_id === currentOrder.user_id
            || actor_id === currentOrder.merchant_id
            || (currentOrder.buyer_merchant_id && actor_id === currentOrder.buyer_merchant_id);
          if (!isParticipant && actor_type !== 'system') {
            return { success: false as const, error: 'Not authorized — you are not a participant in this order' };
          }
        }

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

        // Restore liquidity on cancellation/expiry (critical — must be atomic)
        if (shouldRestoreLiquidity(oldStatus, newStatus)) {
          await client.query(
            'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
            [currentOrder.crypto_amount, currentOrder.offer_id]
          );
        }

        // Mock mode balance handling (critical — must be atomic)
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

        // Corridor bridge (critical — must be atomic)
        if (newStatus === 'completed' && currentOrder.payment_via === 'saed_corridor' && currentOrder.corridor_fulfillment_id) {
          try {
            const ffResult = await client.query(
              'SELECT * FROM corridor_fulfillments WHERE id = $1 FOR UPDATE',
              [currentOrder.corridor_fulfillment_id]
            );
            if (ffResult.rows.length > 0 && ffResult.rows[0].provider_status !== 'completed') {
              const ff = ffResult.rows[0];
              const saedAmount = parseInt(String(ff.saed_amount_locked));
              const providerMerchantId = ff.provider_merchant_id;
              await client.query(
                'UPDATE merchants SET sinr_balance = sinr_balance + $1 WHERE id = $2',
                [saedAmount, providerMerchantId]
              );
              await client.query(
                `UPDATE corridor_fulfillments SET provider_status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [currentOrder.corridor_fulfillment_id]
              );
            }
          } catch (corridorErr) {
            logger.error('[Corridor] Settlement failed on completion', { orderId: id, error: corridorErr });
          }
        }

        return { success: true as const, order: updatedOrder, oldStatus, currentOrder };
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      // --- All side-effects via event bus ---
      const txOldStatus = result.oldStatus!;
      const statusToEvent: Record<string, OrderEventPayload['event']> = {
        escrowed: ORDER_EVENT.ESCROWED, payment_sent: ORDER_EVENT.PAYMENT_SENT,
        completed: ORDER_EVENT.COMPLETED, cancelled: ORDER_EVENT.CANCELLED,
        expired: ORDER_EVENT.EXPIRED, disputed: ORDER_EVENT.DISPUTED,
      };

      orderBus.emitOrderEvent({
        event: statusToEvent[newStatus] || ORDER_EVENT.STATUS_CHANGED,
        orderId: id, orderNumber: result.currentOrder!.order_number,
        previousStatus: txOldStatus, newStatus: result.order!.status,
        actorType: actor_type, actorId: actor_id,
        userId: result.order!.user_id, merchantId: result.order!.merchant_id,
        buyerMerchantId: result.order!.buyer_merchant_id ?? undefined,
        order: result.order as unknown as Record<string, unknown>,
        orderVersion: result.order!.order_version, minimalStatus: normalizeStatus(result.order!.status),
        metadata: request.body.metadata,
      });

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

        orderBus.emitOrderEvent({
          event: ORDER_EVENT.CANCELLED,
          orderId: id, previousStatus: order.status, newStatus: 'cancelled',
          actorType: actor_type, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id, buyerMerchantId: order.buyer_merchant_id ?? undefined,
          order: result.order as unknown as Record<string, unknown>,
          orderVersion: result.order!.order_version, minimalStatus: 'cancelled',
          refundTxHash: result.order?.refund_tx_hash ?? undefined,
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

        orderBus.emitOrderEvent({
          event: ORDER_EVENT.CANCELLED,
          orderId: id, previousStatus: order.status, newStatus: 'cancelled',
          actorType: actor_type, actorId: actor_id,
          userId: result.order!.user_id, merchantId: result.order!.merchant_id,
          buyerMerchantId: result.order!.buyer_merchant_id ?? undefined,
          order: result.order as unknown as Record<string, unknown>,
          orderVersion: result.order!.order_version, minimalStatus: 'cancelled',
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
      if (event_type === 'release') {
        if (!tx_hash) {
          return reply.status(400).send({ success: false, error: 'tx_hash required for release' });
        }

        // Security: verify actor is authorized to release this order
        const releaseOrder = await queryOne<{ status: string; merchant_id: string; user_id: string; buyer_merchant_id: string | null; release_tx_hash: string | null }>(
          'SELECT status, merchant_id, user_id, buyer_merchant_id, release_tx_hash FROM orders WHERE id = $1',
          [id]
        );
        if (!releaseOrder) {
          return reply.status(404).send({ success: false, error: 'Order not found' });
        }
        // Double-release guard: reject if already released
        if (releaseOrder.release_tx_hash) {
          return reply.status(400).send({ success: false, error: 'Order already released' });
        }
        // Status guard: only allow release from valid states
        const releasableStatuses = ['payment_confirmed', 'releasing', 'escrowed', 'payment_sent', 'payment_pending'];
        if (!releasableStatuses.includes(releaseOrder.status)) {
          return reply.status(400).send({ success: false, error: `Cannot release order in status '${releaseOrder.status}'` });
        }
        // Authorization: only the seller (merchant_id) or system can release
        const isAuthorized = actorType === 'system'
          || actorId === releaseOrder.merchant_id
          || (actorType === 'merchant' && actorId === releaseOrder.buyer_merchant_id);
        if (!isAuthorized) {
          logger.error('[GUARD] Unauthorized release attempt', { orderId: id, actorType, actorId });
          return reply.status(403).send({ success: false, error: 'Not authorized to release this order' });
        }

        // Single stored procedure: FOR UPDATE + update + credit balance (1 round-trip)
        const procResult = await queryOne<{ release_order_v1: any }>(
          'SELECT release_order_v1($1,$2,$3)',
          [id, tx_hash, MOCK_MODE]
        );
        const releaseData = procResult!.release_order_v1;
        if (!releaseData.success) {
          if (releaseData.error === 'NOT_FOUND') {
            return reply.status(404).send({ success: false, error: 'Order not found' });
          }
          return reply.status(400).send({ success: false, error: releaseData.error });
        }
        const result = { updated: releaseData.order as OrderRow, oldOrder: { ...releaseData.order, status: releaseData.old_status } as OrderRow };

        // Invariant check — fire-and-forget (don't block response)
        verifyReleaseInvariants({
          orderId: id,
          expectedStatus: 'completed',
          expectedTxHash: tx_hash,
          expectedMinOrderVersion: result.updated.order_version,
        }).catch((invariantError) => {
          logger.error('[CRITICAL] Release invariant FAILED', { orderId: id, error: invariantError });
        });

        orderBus.emitOrderEvent({
          event: ORDER_EVENT.COMPLETED,
          orderId: id, orderNumber: result.oldOrder.order_number,
          previousStatus: result.oldOrder.status, newStatus: 'completed',
          actorType: actorType!, actorId: actorId!,
          userId: result.oldOrder.user_id, merchantId: result.oldOrder.merchant_id,
          buyerMerchantId: result.oldOrder.buyer_merchant_id ?? undefined,
          order: result.updated as unknown as Record<string, unknown>,
          orderVersion: result.updated.order_version, minimalStatus: 'completed',
          txHash: tx_hash, metadata: { tx_hash },
        });

        return reply.send({
          success: true,
          data: { ...result.updated, minimal_status: normalizeStatus(result.updated.status) },
        });
      } else if (event_type === 'refund') {
        // Refund needs pre-read for atomicCancelWithRefund
        const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
        if (!order) {
          return reply.status(404).send({ success: false, error: 'Order not found' });
        }
        const refundResult = await atomicCancelWithRefund(
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

        if (!refundResult.success) {
          return reply.status(400).send({ success: false, error: refundResult.error });
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

        orderBus.emitOrderEvent({
          event: ORDER_EVENT.CANCELLED,
          orderId: id, previousStatus: order.status, newStatus: 'cancelled',
          actorType: actorType!, actorId: actorId!,
          userId: order.user_id, merchantId: order.merchant_id, buyerMerchantId: order.buyer_merchant_id ?? undefined,
          order: refundResult.order as unknown as Record<string, unknown>,
          orderVersion: refundResult.order!.order_version, minimalStatus: 'cancelled',
          refundTxHash: refundResult.order?.refund_tx_hash ?? undefined,
        });

        return reply.send({
          success: true,
          data: { ...refundResult.order, minimal_status: normalizeStatus(refundResult.order!.status) },
        });
      } else {
        return reply.status(400).send({ success: false, error: 'Invalid event_type' });
      }
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg === 'NOT_FOUND') {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }
      fastify.log.error({ error, id, event_type }, 'Error processing order event');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
