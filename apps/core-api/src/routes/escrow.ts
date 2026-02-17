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
import { broadcastOrderEvent } from '../ws/broadcast';
import { bufferEvent, bufferNotification } from '../batchWriter';

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

      // Batched fire-and-forget (zero round-trips, flushed every 50ms)
      bufferEvent({ order_id: id, event_type: 'status_changed_to_escrowed', actor_type, actor_id, old_status: oldStatus, new_status: 'escrowed', metadata: JSON.stringify({ tx_hash }) });
      bufferNotification({ order_id: id, event_type: 'ORDER_ESCROWED', payload: JSON.stringify({ orderId: id, status: 'escrowed', previousStatus: oldStatus, escrowTxHash: tx_hash, updatedAt: new Date().toISOString() }) });

      broadcastOrderEvent({
        event_type: 'ORDER_ESCROWED',
        order_id: id,
        status: 'escrowed',
        minimal_status: normalizeStatus('escrowed' as any),
        order_version: updatedOrder!.order_version,
        userId,
        merchantId,
        previousStatus: oldStatus,
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
