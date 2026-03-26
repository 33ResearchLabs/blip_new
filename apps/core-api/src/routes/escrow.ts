/**
 * Core API Escrow Routes
 *
 * POST /v1/orders/:id/escrow - Lock escrow deposit
 *
 * Receives pre-validated payload from settle (on-chain verification done by settle).
 *
 * Seller enforcement:
 *   buy  order → merchant_id must lock (they have the USDC)
 *   sell order → user_id must lock (they have the USDC)
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  queryOne,
  logger,
  MOCK_MODE,
  normalizeStatus,
} from 'settlement-core';
import { ORDER_EVENT } from '../events';
import { insertOutboxEventDirect } from '../outbox';

interface EscrowDepositPayload {
  tx_hash: string;
  actor_type: 'user' | 'merchant';
  actor_id: string;
  escrow_address?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
}

interface OrderLookup {
  id: string;
  type: string;
  status: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  escrow_tx_hash: string | null;
}

export const escrowRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/escrow - Lock escrow
  fastify.post<{
    Params: { id: string };
    Body: EscrowDepositPayload;
  }>('/orders/:id/escrow', async (request, reply) => {
    const { id } = request.params;
    const {
      tx_hash,
      actor_type,
      actor_id,
      escrow_address,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } = request.body;

    if (!tx_hash || !actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'tx_hash, actor_type, and actor_id are required',
      });
    }

    try {
      // Defense-in-depth: validate seller BEFORE calling stored procedure
      const order = await queryOne<OrderLookup>(
        `SELECT id, type, status, user_id, merchant_id, buyer_merchant_id, escrow_tx_hash
         FROM orders WHERE id = $1`,
        [id]
      );

      if (!order) {
        return reply.status(404).send({ success: false, error: 'Order not found' });
      }

      // Determine the correct seller (who locks escrow):
      //   buy  order (non-M2M): merchant_id sells crypto → merchant locks
      //   sell order (non-M2M): user_id sells crypto → user locks
      //   M2M (any type): merchant_id is ALWAYS the seller → merchant locks
      const isM2M = !!order.buyer_merchant_id;
      let expectedSellerId: string;
      let expectedSellerType: string;

      if (isM2M) {
        // M2M: merchant_id is ALWAYS the seller, buyer_merchant_id is ALWAYS the buyer.
        // This is type-agnostic — matches the SQL role resolution and the field semantics.
        expectedSellerId = order.merchant_id;
        expectedSellerType = 'merchant';
      } else if (order.type === 'buy') {
        // User buys → merchant sells
        expectedSellerId = order.merchant_id;
        expectedSellerType = 'merchant';
      } else {
        // User sells → user is seller
        expectedSellerId = order.user_id;
        expectedSellerType = 'user';
      }

      if (actor_id !== expectedSellerId) {
        logger.warn('[ESCROW GUARD] Wrong party attempted escrow lock', {
          orderId: id,
          orderType: order.type,
          isM2M,
          expectedSeller: { type: expectedSellerType, id: expectedSellerId },
          actualCaller: { type: actor_type, id: actor_id },
        });
        return reply.status(403).send({
          success: false,
          error: `Only the seller (${expectedSellerType}) can lock escrow for this order`,
        });
      }

      // Single stored procedure: FOR UPDATE + validate + deduct + update (1 round-trip)
      const procResult = await queryOne<{ escrow_order_v1: any }>(
        'SELECT escrow_order_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id, tx_hash, actor_type, actor_id,
          escrow_address || null, escrow_trade_id ?? null,
          escrow_trade_pda || null, escrow_pda || null,
          escrow_creator_wallet || null, MOCK_MODE,
        ]
      );
      const data = procResult!.escrow_order_v1;
      if (!data.success) {
        const errMsg = data.error;
        if (errMsg === 'INSUFFICIENT_BALANCE') {
          return reply.status(400).send({ success: false, error: 'Insufficient balance to lock escrow' });
        }
        if (errMsg === 'ALREADY_ESCROWED') {
          return reply.status(409).send({ success: false, error: 'Escrow already locked' });
        }
        if (errMsg === 'ORDER_STATUS_CHANGED') {
          return reply.status(409).send({ success: false, error: 'Order status changed' });
        }
        if (errMsg === 'ORDER_NOT_FOUND') {
          return reply.status(404).send({ success: false, error: 'Order not found' });
        }
        if (errMsg === 'WRONG_ESCROW_PARTY') {
          return reply.status(403).send({ success: false, error: data.detail || 'Only the seller can lock escrow' });
        }
        return reply.status(400).send({ success: false, error: errMsg });
      }

      const updatedOrder = data.order;
      const oldStatus = data.old_status;
      const userId = updatedOrder.user_id;
      const merchantId = updatedOrder.merchant_id;

      logger.info('[ESCROW] Escrow locked by correct seller', {
        orderId: id,
        orderType: order.type,
        sellerId: expectedSellerId,
        sellerType: expectedSellerType,
        amount: updatedOrder.crypto_amount,
      });

      await insertOutboxEventDirect({
        event: ORDER_EVENT.ESCROWED,
        orderId: id, previousStatus: oldStatus, newStatus: 'escrowed',
        actorType: actor_type, actorId: actor_id,
        userId, merchantId, buyerMerchantId: updatedOrder.buyer_merchant_id ?? undefined,
        order: updatedOrder as unknown as Record<string, unknown>,
        orderVersion: updatedOrder!.order_version, minimalStatus: normalizeStatus('escrowed' as any),
        metadata: { tx_hash },
      });

      return reply.send({
        success: true,
        data: updatedOrder,
      });
    } catch (error) {
      fastify.log.error({ error, id }, 'Error locking escrow');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
