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
      // Build optional fields list
      // Default expiry: 15 minutes from now for pending orders
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

      let paramIdx = values.length;

      if (data.buyer_wallet_address) {
        paramIdx++;
        fields.push('buyer_wallet_address');
        values.push(data.buyer_wallet_address);
      }
      if (data.buyer_merchant_id) {
        paramIdx++;
        fields.push('buyer_merchant_id');
        values.push(data.buyer_merchant_id);
      }
      if (data.spread_preference) {
        paramIdx++;
        fields.push('spread_preference');
        values.push(data.spread_preference);
      }
      if (data.protocol_fee_percentage !== undefined) {
        paramIdx++;
        fields.push('protocol_fee_percentage');
        values.push(data.protocol_fee_percentage);
      }
      if (data.protocol_fee_amount !== undefined) {
        paramIdx++;
        fields.push('protocol_fee_amount');
        values.push(data.protocol_fee_amount);
      }
      if (data.escrow_tx_hash) {
        fields.push('escrow_tx_hash', 'escrowed_at');
        values.push(data.escrow_tx_hash);
        values.push(new Date());
      }
      if (data.escrow_trade_id !== undefined) {
        fields.push('escrow_trade_id');
        values.push(data.escrow_trade_id);
      }
      if (data.escrow_trade_pda) {
        fields.push('escrow_trade_pda');
        values.push(data.escrow_trade_pda);
      }
      if (data.escrow_pda) {
        fields.push('escrow_pda');
        values.push(data.escrow_pda);
      }
      if (data.escrow_creator_wallet) {
        fields.push('escrow_creator_wallet');
        values.push(data.escrow_creator_wallet);
      }

      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const sql = `INSERT INTO orders (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;

      const rows = await dbQuery(sql, values);
      const order = rows[0] as OrderRow;

      // Deduct liquidity from offer
      await dbQuery(
        'UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2',
        [data.crypto_amount, data.offer_id]
      );

      // Mock mode: deduct escrow balance if pre-locked
      if (data.escrow_tx_hash && MOCK_MODE) {
        try {
          await dbQuery(
            `UPDATE merchants SET balance = balance - $1 WHERE id = $2 AND balance >= $1`,
            [data.crypto_amount, data.merchant_id]
          );
        } catch (deductErr) {
          logger.warn('[Mock] Failed to deduct escrow balance on create', { error: deductErr });
        }
      }

      // Insert notification outbox
      await dbQuery(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_CREATED', $2, 'pending')`,
        [
          order.id,
          JSON.stringify({
            orderId: order.id,
            userId: data.user_id,
            merchantId: data.merchant_id,
            status: order.status,
            minimal_status: normalizeStatus(order.status as any),
            order_version: order.order_version || 1,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

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
    } catch (error) {
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

        // Mock mode: deduct escrow balance if pre-locked
        if (data.escrow_tx_hash && MOCK_MODE) {
          const deductMerchantId = data.buyer_merchant_id || data.merchant_id;
          try {
            await dbQuery(
              `UPDATE merchants SET balance = balance - $1 WHERE id = $2 AND balance >= $1`,
              [data.crypto_amount, deductMerchantId]
            );
          } catch (deductErr) {
            logger.warn('[Mock] Failed to deduct escrow on merchant create', { error: deductErr });
          }
        }

        // Notification outbox
        await dbQuery(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_CREATED', $2, 'pending')`,
          [
            order.id,
            JSON.stringify({
              orderId: order.id,
              userId: data.user_id,
              merchantId: data.merchant_id,
              buyerMerchantId: data.buyer_merchant_id,
              status: order.status,
              minimal_status: normalizeStatus(order.status as any),
              order_version: order.order_version || 1,
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

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
      } catch (error) {
        fastify.log.error({ error }, 'Error creating merchant order');
        return reply.status(500).send({ success: false, error: 'Internal server error' });
      }
    }
  );
};
