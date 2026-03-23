/**
 * Core API Escrow Routes
 *
 * POST /v1/orders/:id/escrow - Lock escrow deposit
 *
 * Receives pre-validated payload from settle (on-chain verification done by settle).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  queryOne,
  logger,
  MOCK_MODE,
  normalizeStatus,
} from 'settlement-core';
import { orderBus, ORDER_EVENT } from '../events';

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
        return reply.status(400).send({ success: false, error: errMsg });
      }

      const updatedOrder = data.order;
      const oldStatus = data.old_status;
      const userId = updatedOrder.user_id;
      const merchantId = updatedOrder.merchant_id;

      orderBus.emitOrderEvent({
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
