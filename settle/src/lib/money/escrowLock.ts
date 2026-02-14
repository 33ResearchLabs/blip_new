/**
 * Mock Escrow Lock — Deterministic balance deduction
 *
 * When MOCK_MODE is active (or Core-API is absent), this function
 * atomically deducts balance, records the escrow debit on the order,
 * writes a ledger entry, writes a merchant_transactions entry, and
 * transitions the order to 'escrowed' — all in a single DB transaction.
 */

import { transaction } from '@/lib/db';
import { Order, ActorType } from '@/lib/types/database';
import { validateTransition } from '@/lib/orders/stateMachine';
import { createTransactionInTx } from '@/lib/db/repositories/transactions';
import { logger } from '@/lib/logger';

export interface EscrowLockResult {
  success: boolean;
  order?: Order;
  error?: string;
}

/**
 * Determine who pays escrow for a given order.
 * This is the SINGLE source of truth — used at lock time,
 * and the result is permanently recorded on the order.
 */
export function determineEscrowPayer(order: {
  type: 'buy' | 'sell';
  merchant_id: string;
  user_id: string;
  buyer_merchant_id: string | null;
}): { entityType: 'merchant' | 'user'; entityId: string; table: 'merchants' | 'users' } {
  const isM2M = !!order.buyer_merchant_id;
  if (isM2M) {
    // M2M: merchant_id is always the seller who locks escrow
    return { entityType: 'merchant', entityId: order.merchant_id, table: 'merchants' };
  }
  if (order.type === 'buy') {
    // User buying crypto: merchant (seller) locks escrow
    return { entityType: 'merchant', entityId: order.merchant_id, table: 'merchants' };
  }
  // User selling crypto: user locks escrow
  return { entityType: 'user', entityId: order.user_id, table: 'users' };
}

/**
 * Lock escrow in mock mode. All balance, ledger, transaction, and status
 * changes happen in a single DB transaction.
 */
export async function mockEscrowLock(
  orderId: string,
  actorType: ActorType,
  actorId: string,
  txHash: string,
  escrowDetails?: {
    escrow_trade_id?: number;
    escrow_trade_pda?: string;
    escrow_pda?: string;
    escrow_creator_wallet?: string;
  }
): Promise<EscrowLockResult> {
  try {
    const order = await transaction(async (client) => {
      // 1. Lock the order row
      const lockResult = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (lockResult.rows.length === 0) {
        throw new Error('ORDER_NOT_FOUND');
      }

      const lockedOrder = lockResult.rows[0] as Order;

      // 2. Validate the order can be escrowed
      if (lockedOrder.escrow_tx_hash) {
        throw new Error('ALREADY_ESCROWED');
      }

      const validation = validateTransition(lockedOrder.status as any, 'escrowed', actorType);
      if (!validation.valid) {
        throw new Error(`INVALID_TRANSITION: ${validation.error}`);
      }

      const amount = parseFloat(String(lockedOrder.crypto_amount));

      // 3. Determine who pays escrow
      const payer = determineEscrowPayer({
        type: lockedOrder.type as 'buy' | 'sell',
        merchant_id: lockedOrder.merchant_id,
        user_id: lockedOrder.user_id,
        buyer_merchant_id: lockedOrder.buyer_merchant_id,
      });

      // 4. Lock the payer's row and check balance
      const balanceResult = await client.query(
        `SELECT balance FROM ${payer.table} WHERE id = $1 FOR UPDATE`,
        [payer.entityId]
      );

      if (balanceResult.rows.length === 0) {
        throw new Error('PAYER_NOT_FOUND');
      }

      const currentBalance = parseFloat(String(balanceResult.rows[0].balance));
      if (currentBalance < amount) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      // 5. Deduct balance
      await client.query(
        `UPDATE ${payer.table} SET balance = balance - $1 WHERE id = $2`,
        [amount, payer.entityId]
      );

      const balanceAfter = currentBalance - amount;

      // 6. Update order with escrow details + debit tracking
      const updateResult = await client.query(
        `UPDATE orders
         SET status = 'escrowed',
             escrow_tx_hash = $1,
             escrowed_at = NOW(),
             expires_at = NOW() + INTERVAL '120 minutes',
             order_version = order_version + 1,
             escrow_debited_entity_type = $2,
             escrow_debited_entity_id = $3,
             escrow_debited_amount = $4,
             escrow_debited_at = NOW(),
             escrow_trade_id = $5,
             escrow_trade_pda = $6,
             escrow_pda = $7,
             escrow_creator_wallet = $8
         WHERE id = $9
         RETURNING *`,
        [
          txHash,
          payer.entityType,
          payer.entityId,
          amount,
          escrowDetails?.escrow_trade_id ?? null,
          escrowDetails?.escrow_trade_pda ?? null,
          escrowDetails?.escrow_pda ?? null,
          escrowDetails?.escrow_creator_wallet ?? null,
          orderId,
        ]
      );

      const updatedOrder = updateResult.rows[0] as Order;

      // 7. Insert ledger entry
      await client.query(
        `INSERT INTO ledger_entries
         (account_type, account_id, entry_type, amount, asset,
          related_order_id, related_tx_hash, description, metadata,
          balance_before, balance_after)
         VALUES ($1, $2, 'ESCROW_LOCK', $3, 'USDT', $4, $5, $6, $7, $8, $9)`,
        [
          payer.entityType,
          payer.entityId,
          -amount,
          orderId,
          txHash,
          `Escrow locked for order #${updatedOrder.order_number}`,
          JSON.stringify({ order_type: lockedOrder.type }),
          currentBalance,
          balanceAfter,
        ]
      );

      // 8. Insert merchant_transactions entry
      await createTransactionInTx(client, {
        ...(payer.entityType === 'merchant'
          ? { merchant_id: payer.entityId }
          : { user_id: payer.entityId }),
        order_id: orderId,
        type: 'escrow_lock',
        amount: -amount,
        description: `Escrow locked for order #${updatedOrder.order_number}`,
      });

      // 9. Insert order_events record
      await client.query(
        `INSERT INTO order_events
         (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'escrow_locked', $2, $3, $4, 'escrowed', $5)`,
        [
          orderId,
          actorType,
          actorId,
          lockedOrder.status,
          JSON.stringify({
            tx_hash: txHash,
            debited_entity_type: payer.entityType,
            debited_entity_id: payer.entityId,
            debited_amount: amount,
            mock_mode: true,
          }),
        ]
      );

      logger.info('[MockEscrow] Escrow locked', {
        orderId,
        payer: payer.entityType,
        payerId: payer.entityId,
        amount,
        balanceBefore: currentBalance,
        balanceAfter,
        orderVersion: updatedOrder.order_version,
      });

      return updatedOrder;
    });

    return { success: true, order };
  } catch (error) {
    const errMsg = (error as Error).message;

    if (errMsg === 'ORDER_NOT_FOUND') {
      return { success: false, error: 'Order not found' };
    }
    if (errMsg === 'ALREADY_ESCROWED') {
      return { success: false, error: 'Order already has escrow locked' };
    }
    if (errMsg === 'INSUFFICIENT_BALANCE') {
      return { success: false, error: 'Insufficient balance to lock escrow' };
    }
    if (errMsg === 'PAYER_NOT_FOUND') {
      return { success: false, error: 'Escrow payer entity not found' };
    }
    if (errMsg.startsWith('INVALID_TRANSITION')) {
      return { success: false, error: errMsg.replace('INVALID_TRANSITION: ', '') };
    }

    logger.error('[MockEscrow] Escrow lock failed', {
      orderId,
      error: errMsg,
    });

    return { success: false, error: `Failed to lock escrow: ${errMsg}` };
  }
}
