/**
 * Core API Order Creation Routes
 *
 * POST /v1/orders - Create order (from user flow)
 * POST /v1/merchant/orders - Create merchant-initiated order (including M2M)
 *
 * Receives pre-validated payloads from settle proxy.
 * Handles DB writes only - settle does validation, auth, and offer lookup.
 *
 * Safety guarantees:
 * - Atomic transaction: liquidity deduction + order insert + idempotency record
 * - Deadlock/serialization retry with exponential backoff (40P01, 40001)
 * - Idempotency stored INSIDE the transaction (no gap between commit and record)
 * - CHECK (available_amount >= 0) enforced at DB level
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  queryOne,
  transactionWithRetry,
  normalizeStatus,
  logger,
} from 'settlement-core';
import { ORDER_EVENT } from '../events';
import { insertOutboxEvent } from '../outbox';
import { buildScopedKey } from '../idempotency';
import { financialRateLimitHook } from '../rateLimit';

/**
 * Check idempotency_log for a previously completed action (scoped key).
 */
async function checkIdempotencyLog(scopedKey: string): Promise<{ status_code: number; response: any } | null> {
  const row = await queryOne<{ status_code: number; response: any }>(
    `SELECT status_code, response FROM idempotency_log WHERE idempotency_key = $1 AND expires_at > NOW()`,
    [scopedKey]
  );
  return row || null;
}

/**
 * Store idempotency result INSIDE a transaction client.
 * This ensures the record is committed atomically with the order —
 * if the transaction rolls back, no orphaned idempotency record is left.
 */
async function storeIdempotencyInTx(
  client: { query: (text: string, params?: unknown[]) => Promise<any> },
  scopedKey: string, action: string, orderId: string | null,
  statusCode: number, response: any, actorId: string, originalKey: string
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_log
     (idempotency_key, action, order_id, status_code, response, actor_id, original_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [scopedKey, action, orderId, statusCode, JSON.stringify(response), actorId, originalKey]
  );
}

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
  expiry_minutes?: number;
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
  // Bump/decay fields
  ref_price_at_create?: number;
  premium_bps_current?: number;
  premium_bps_cap?: number;
  bump_step_bps?: number;
  bump_interval_sec?: number;
  auto_bump_enabled?: boolean;
  next_bump_at?: string | null;
  // Price engine proof fields
  price_proof_sig?: string | null;
  price_proof_ref_price?: number | null;
  price_proof_expires_at?: string | null;
  // Payment method (fiat receiver's selected method)
  payment_method_id?: string;
  // Merchant's payment method (where buyer sends fiat)
  merchant_payment_method_id?: string;
}

/**
 * Build the field/value arrays for order INSERT outside the transaction
 * to keep the lock window as short as possible.
 */
function buildOrderInsertParams(data: CreateOrderPayload) {
  const fields = [
    'user_id', 'merchant_id', 'offer_id', 'type', 'payment_method',
    'crypto_amount', 'fiat_amount', 'crypto_currency', 'fiat_currency', 'rate',
    'payment_details', 'status',
  ];
  const values: unknown[] = [
    data.user_id, data.merchant_id, data.offer_id, data.type, data.payment_method,
    data.crypto_amount, data.fiat_amount, 'USDC', 'AED', data.rate,
    data.payment_details ? JSON.stringify(data.payment_details) : null,
    data.escrow_tx_hash ? 'escrowed' : 'pending',
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
    // Bump/decay fields
    ['ref_price_at_create', data.ref_price_at_create],
    ['premium_bps_current', data.premium_bps_current],
    ['premium_bps_cap', data.premium_bps_cap],
    ['bump_step_bps', data.bump_step_bps],
    ['bump_interval_sec', data.bump_interval_sec],
    ['auto_bump_enabled', data.auto_bump_enabled],
    ['next_bump_at', data.next_bump_at],
    // Price engine proof
    ['price_proof_sig', data.price_proof_sig],
    ['price_proof_ref_price', data.price_proof_ref_price],
    ['price_proof_expires_at', data.price_proof_expires_at],
    // Payment method
    ['payment_method_id', data.payment_method_id],
    // Merchant's payment method (where buyer sends fiat)
    ['merchant_payment_method_id', data.merchant_payment_method_id],
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

  // expires_at uses raw SQL to avoid JS Date / Postgres timezone mismatch
  const expiryMin = Math.max(1, Math.min(1440, data.expiry_minutes || 15));
  const expiresAtRaw = `now() + interval '${expiryMin} minutes'`;
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const allFields = [...fields, 'expires_at'];
  const allPlaceholders = [placeholders, expiresAtRaw].join(', ');

  return { allFields, allPlaceholders, values };
}

/**
 * Resolve idempotency key + actor from request + payload.
 */
function resolveIdempotency(request: { headers: Record<string, unknown> }, actorId: string, action: string) {
  const rawKey = (request.headers['idempotency-key'] as string | undefined)
    || (request.headers['x-idempotency-key'] as string | undefined);
  if (!rawKey) return null;
  return { rawKey, scopedKey: buildScopedKey(actorId, action, rawKey) };
}

export const orderCreateRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders - Create order
  fastify.post<{ Body: CreateOrderPayload }>('/orders', { preHandler: financialRateLimitHook('create_order') }, async (request, reply) => {
    const data = request.body;
    const actorId = data.user_id || data.merchant_id;

    if (!data.user_id || !data.merchant_id || !data.offer_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_id, merchant_id, and offer_id are required',
      });
    }

    // Idempotency check: prevent duplicate order creation from retries
    const idem = resolveIdempotency(request, actorId, 'create_order');
    if (idem) {
      const cached = await checkIdempotencyLog(idem.scopedKey);
      if (cached) {
        logger.info('[order-create] Idempotent replay', { actorId, offerId: data.offer_id });
        return reply.status(cached.status_code).send(cached.response);
      }
    }

    // Build INSERT params outside the transaction to minimize lock duration
    const { allFields, allPlaceholders, values } = buildOrderInsertParams(data);

    logger.info('[order-create] Transaction starting', {
      offerId: data.offer_id, actorId, cryptoAmount: data.crypto_amount,
    });

    try {
      // Atomic transaction with deadlock retry:
      //   1. Deduct liquidity (row-level lock via UPDATE WHERE)
      //   2. Insert order
      //   3. Store idempotency record (same tx — commits or rolls back together)
      const { order, remainingLiquidity } = await transactionWithRetry(async (client) => {
        // Deduct liquidity — the WHERE clause acts as an implicit row lock.
        // RETURNING available_amount gives us post-deduction balance for observability.
        const { rows: deducted } = await client.query(
          `UPDATE merchant_offers
           SET available_amount = available_amount - $1, updated_at = NOW()
           WHERE id = $2 AND available_amount >= $1
           RETURNING id, available_amount`,
          [data.crypto_amount, data.offer_id]
        );
        if (deducted.length === 0) {
          throw Object.assign(new Error('Insufficient offer liquidity'), { statusCode: 409 });
        }

        const { rows } = await client.query(
          `INSERT INTO orders (${allFields.join(', ')}) VALUES (${allPlaceholders}) RETURNING *`,
          values
        );
        const order = rows[0] as OrderRow;

        // Store idempotency INSIDE the transaction — atomic with order creation.
        // If tx rolls back, no orphaned idempotency record is left.
        if (idem) {
          const responseBody = {
            success: true,
            data: { ...order, minimal_status: normalizeStatus(order.status as any) },
          };
          await storeIdempotencyInTx(
            client, idem.scopedKey, 'create_order', order.id, 201, responseBody,
            actorId, idem.rawKey
          );
        }

        // Outbox event inside transaction — atomic with order creation
        await insertOutboxEvent(client, {
          event: ORDER_EVENT.CREATED,
          orderId: order.id, previousStatus: '', newStatus: String(order.status),
          actorType: 'system', actorId: data.merchant_id,
          userId: data.user_id, merchantId: data.merchant_id, buyerMerchantId: data.buyer_merchant_id,
          order: order as unknown as Record<string, unknown>,
          orderVersion: order.order_version || 1, minimalStatus: normalizeStatus(order.status as any),
        });

        return { order, remainingLiquidity: deducted[0].available_amount };
      }, { label: 'order-create' });

      logger.info('[order-create] Success', {
        orderId: order.id, offerId: data.offer_id, actorId,
        remainingLiquidity, type: data.type,
      });

      const responseBody = {
        success: true,
        data: { ...order, minimal_status: normalizeStatus(order.status as any) },
      };

      return reply.status(201).send(responseBody);
    } catch (error: any) {
      logger.error('[order-create] Failed', {
        offerId: data.offer_id, actorId,
        error: error?.message, code: error?.code,
      });
      if (error?.statusCode) {
        return reply.status(error.statusCode).send({ success: false, error: error.message });
      }
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // POST /v1/merchant/orders - Merchant-initiated order creation
  fastify.post<{ Body: CreateOrderPayload & { is_m2m?: boolean } }>(
    '/merchant/orders',
    async (request, reply) => {
      const data = request.body;
      const actorId = data.merchant_id;

      if (!data.user_id || !data.merchant_id || !data.offer_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_id, merchant_id, and offer_id are required',
        });
      }

      // Idempotency check (was missing on merchant route)
      const idem = resolveIdempotency(request, actorId, 'create_merchant_order');
      if (idem) {
        const cached = await checkIdempotencyLog(idem.scopedKey);
        if (cached) {
          logger.info('[merchant-order-create] Idempotent replay', { actorId, offerId: data.offer_id });
          return reply.status(cached.status_code).send(cached.response);
        }
      }

      const { allFields, allPlaceholders, values } = buildOrderInsertParams(data);

      logger.info('[merchant-order-create] Transaction starting', {
        offerId: data.offer_id, actorId, cryptoAmount: data.crypto_amount,
        isM2M: (data as any).is_m2m,
      });

      try {
        const { order, remainingLiquidity } = await transactionWithRetry(async (client) => {
          const { rows: deducted } = await client.query(
            `UPDATE merchant_offers
             SET available_amount = available_amount - $1, updated_at = NOW()
             WHERE id = $2 AND available_amount >= $1
             RETURNING id, available_amount`,
            [data.crypto_amount, data.offer_id]
          );
          if (deducted.length === 0) {
            throw Object.assign(new Error('Insufficient offer liquidity'), { statusCode: 409 });
          }

          const { rows } = await client.query(
            `INSERT INTO orders (${allFields.join(', ')}) VALUES (${allPlaceholders}) RETURNING *`,
            values
          );
          const order = rows[0] as OrderRow;

          if (idem) {
            const responseBody = {
              success: true,
              data: { ...order, minimal_status: normalizeStatus(order.status as any) },
            };
            await storeIdempotencyInTx(
              client, idem.scopedKey, 'create_merchant_order', order.id, 201, responseBody,
              actorId, idem.rawKey
            );
          }

          // Outbox event inside transaction — atomic with order creation
          await insertOutboxEvent(client, {
            event: ORDER_EVENT.CREATED,
            orderId: order.id, previousStatus: '', newStatus: String(order.status),
            actorType: 'merchant', actorId: data.merchant_id,
            userId: data.user_id, merchantId: data.merchant_id, buyerMerchantId: data.buyer_merchant_id,
            order: order as unknown as Record<string, unknown>,
            orderVersion: order.order_version || 1, minimalStatus: normalizeStatus(order.status as any),
          });

          return { order, remainingLiquidity: deducted[0].available_amount };
        }, { label: 'merchant-order-create' });

        logger.info('[merchant-order-create] Success', {
          orderId: order.id, offerId: data.offer_id, actorId,
          remainingLiquidity, buyerMerchantId: data.buyer_merchant_id,
          isM2M: (data as any).is_m2m,
        });

        return reply.status(201).send({
          success: true,
          data: { ...order, minimal_status: normalizeStatus(order.status as any) },
        });
      } catch (error: any) {
        logger.error('[merchant-order-create] Failed', {
          offerId: data.offer_id, actorId,
          error: error?.message, code: error?.code,
        });
        if (error?.statusCode) {
          return reply.status(error.statusCode).send({ success: false, error: error.message });
        }
        return reply.status(500).send({ success: false, error: 'Internal server error' });
      }
    }
  );
};
