/**
 * Core API Order Creation Routes
 *
 * POST /v1/orders - Create order (from user flow)
 * POST /v1/merchant/orders - Create merchant-initiated order (including M2M)
 *
 * Receives pre-validated payloads from settle proxy.
 * Handles DB writes only - settle does validation, auth, and offer lookup.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  queryOne,
  normalizeStatus,
  logger,
  MOCK_MODE,
} from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';
import { bufferNotification } from '../batchWriter';

interface OrderRow {
  id: string;
  status: string;
  order_version?: number;
  [key: string]: unknown;
}

interface CreateOrderPayload {
  user_id: string;
  merchant_id: string;
  offer_id: string;
  type: 'buy' | 'sell';
  payment_method: string;
  crypto_amount: number;
  fiat_amount: number;
  rate: number;
  payment_details?: Record<string, unknown>;
  buyer_wallet_address?: string;
  buyer_merchant_id?: string;
  spread_preference?: string;
  protocol_fee_percentage?: number;
  protocol_fee_amount?: number;
  // Pre-locked escrow fields (for escrow-first orders)
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
}

export const orderCreateRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders - Create order
  fastify.post<{ Body: CreateOrderPayload }>('/orders', async (request, reply) => {
    const data = request.body;

    if (!data.user_id || !data.merchant_id || !data.offer_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_id, merchant_id, and offer_id are required',
      });
    }

    try {
      // Two separate queries (NOT in a TX) to minimize offer row lock duration.
      // Stored proc held the lock across INSERT which caused contention with 20 merchants.
      const fields = [
        'user_id', 'merchant_id', 'offer_id', 'type', 'payment_method',
        'crypto_amount', 'fiat_amount', 'crypto_currency', 'fiat_currency', 'rate',
        'payment_details', 'status', 'expires_at',
      ];
      const values: unknown[] = [
        data.user_id, data.merchant_id, data.offer_id, data.type, data.payment_method,
        data.crypto_amount, data.fiat_amount, 'USDC', 'AED', data.rate,
        data.payment_details ? JSON.stringify(data.payment_details) : null,
        data.escrow_tx_hash ? 'escrowed' : 'pending',
        new Date(Date.now() + 15 * 60 * 1000),
      ];
      const optionals: [string, unknown][] = [
        ['buyer_wallet_address', data.buyer_wallet_address],
        ['buyer_merchant_id', data.buyer_merchant_id],
        ['spread_preference', data.spread_preference],
        ['protocol_fee_percentage', data.protocol_fee_percentage],
        ['protocol_fee_amount', data.protocol_fee_amount],
        ['escrow_tx_hash', data.escrow_tx_hash],
        ['escrow_trade_id', data.escrow_trade_id],
        ['escrow_trade_pda', data.escrow_trade_pda],
        ['escrow_pda', data.escrow_pda],
        ['escrow_creator_wallet', data.escrow_creator_wallet],
      ];
      for (const [field, value] of optionals) {
        if (value !== undefined && value !== null) {
          fields.push(field);
          values.push(value);
        }
      }
      if (data.escrow_tx_hash) {
        fields.push('escrowed_at');
        values.push(new Date());
      }

      // Deduct liquidity first (short row lock, auto-commit)
      const deducted = await dbQuery<{ id: string }>(
        'UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2 AND available_amount >= $1 RETURNING id',
        [data.crypto_amount, data.offer_id]
      );
      if (deducted.length === 0) {
        return reply.status(409).send({ success: false, error: 'Insufficient offer liquidity' });
      }

      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const rows = await dbQuery(`INSERT INTO orders (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`, values);
      const order = rows[0] as OrderRow;

      // Batched notification (zero round-trips, flushed every 50ms)
      bufferNotification({ order_id: order.id, event_type: 'ORDER_CREATED', payload: JSON.stringify({
        orderId: order.id, userId: data.user_id, merchantId: data.merchant_id,
        status: order.status, minimal_status: normalizeStatus(order.status as any),
        order_version: order.order_version || 1, updatedAt: new Date().toISOString(),
      })});

      logger.info('[core-api] Order created', { orderId: order.id, type: data.type });

      broadcastOrderEvent({
        event_type: 'ORDER_CREATED',
        order_id: order.id,
        status: String(order.status),
        minimal_status: normalizeStatus(order.status as any),
        order_version: order.order_version || 1,
        userId: data.user_id,
        merchantId: data.merchant_id,
        buyerMerchantId: data.buyer_merchant_id,
      });

      return reply.status(201).send({
        success: true,
        data: { ...order, minimal_status: normalizeStatus(order.status as any) },
      });
    } catch (error: any) {
      if (error?.statusCode) {
        return reply.status(error.statusCode).send({ success: false, error: error.message });
      }
      fastify.log.error({ error }, 'Error creating order');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // POST /v1/merchant/orders - Merchant-initiated order creation
  fastify.post<{ Body: CreateOrderPayload & { is_m2m?: boolean } }>(
    '/merchant/orders',
    async (request, reply) => {
      const data = request.body;

      if (!data.user_id || !data.merchant_id || !data.offer_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_id, merchant_id, and offer_id are required',
        });
      }

      try {
        // Same creation logic - settle has already resolved the offer, created placeholder user, etc.
        const defaultExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

        const fields = [
          'user_id', 'merchant_id', 'offer_id', 'type', 'payment_method',
          'crypto_amount', 'fiat_amount', 'crypto_currency', 'fiat_currency', 'rate',
          'payment_details', 'status', 'expires_at',
        ];
        const values: unknown[] = [
          data.user_id, data.merchant_id, data.offer_id, data.type, data.payment_method,
          data.crypto_amount, data.fiat_amount, 'USDC', 'AED', data.rate,
          data.payment_details ? JSON.stringify(data.payment_details) : null,
          data.escrow_tx_hash ? 'escrowed' : 'pending',
          defaultExpiresAt,
        ];

        // Optional fields
        const optionalFields: [string, unknown][] = [
          ['buyer_wallet_address', data.buyer_wallet_address],
          ['buyer_merchant_id', data.buyer_merchant_id],
          ['spread_preference', data.spread_preference],
          ['protocol_fee_percentage', data.protocol_fee_percentage],
          ['protocol_fee_amount', data.protocol_fee_amount],
          ['escrow_tx_hash', data.escrow_tx_hash],
          ['escrow_trade_id', data.escrow_trade_id],
          ['escrow_trade_pda', data.escrow_trade_pda],
          ['escrow_pda', data.escrow_pda],
          ['escrow_creator_wallet', data.escrow_creator_wallet],
        ];

        for (const [field, value] of optionalFields) {
          if (value !== undefined && value !== null) {
            fields.push(field);
            values.push(value);
          }
        }

        if (data.escrow_tx_hash) {
          fields.push('escrowed_at');
          values.push(new Date());
        }

        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO orders (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;

        const rows = await dbQuery(sql, values);
        const order = rows[0] as OrderRow;

        // Batched notification (zero round-trips, flushed every 50ms)
        bufferNotification({ order_id: order.id, event_type: 'ORDER_CREATED', payload: JSON.stringify({
          orderId: order.id, userId: data.user_id, merchantId: data.merchant_id,
          buyerMerchantId: data.buyer_merchant_id, status: order.status,
          minimal_status: normalizeStatus(order.status as any),
          order_version: order.order_version || 1, updatedAt: new Date().toISOString(),
        })});

        logger.info('[core-api] Merchant order created', {
          orderId: order.id,
          merchantId: data.merchant_id,
          buyerMerchantId: data.buyer_merchant_id,
          isM2M: data.is_m2m,
        });

        broadcastOrderEvent({
          event_type: 'ORDER_CREATED',
          order_id: order.id,
          status: String(order.status),
          minimal_status: normalizeStatus(order.status as any),
          order_version: order.order_version || 1,
          userId: data.user_id,
          merchantId: data.merchant_id,
          buyerMerchantId: data.buyer_merchant_id,
        });

        return reply.status(201).send({
          success: true,
          data: { ...order, minimal_status: normalizeStatus(order.status as any) },
        });
      } catch (error: any) {
        if (error?.statusCode) {
          return reply.status(error.statusCode).send({ success: false, error: error.message });
        }
        fastify.log.error({ error }, 'Error creating merchant order');
        return reply.status(500).send({ success: false, error: 'Internal server error' });
      }
    }
  );
};
