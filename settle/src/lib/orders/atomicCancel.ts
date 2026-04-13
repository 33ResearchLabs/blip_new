/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMIC ESCROW REFUND - LOCKED FINALIZATION PATH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL: This function MUST remain atomic. Do NOT refactor to split apart:
 * - status update to 'cancelled'
 * - timestamp updates (cancelled_at)
 * - order_events record creation
 * - notification_outbox record creation
 * - order_version increment
 *
 * All of the above MUST happen in a SINGLE database transaction.
 * Any attempt to split this logic will introduce race conditions.
 *
 * Post-commit invariant validation ensures this contract is maintained.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { transaction } from '@/lib/db';
import { Order, ActorType } from '@/lib/types/database';
import { logger } from '@/lib/logger';
import { validateTransition } from './stateMachineMinimal';


export interface AtomicCancelResult {
  success: boolean;
  order?: Order;
  error?: string;
}

/**
 * Atomically cancel an order with escrow refund
 *
 * This function ensures that when an order with locked escrow is cancelled:
 * 1. The escrow amount is refunded to the seller
 * 2. The order status is set to 'cancelled'
 * 3. An order_events record is created
 * 4. A notification_outbox record is created
 * 5. The order_version is incremented
 *
 * All in a SINGLE database transaction to prevent money printer bugs.
 */
export async function atomicCancelWithRefund(
  orderId: string,
  currentStatus: string,
  actorType: ActorType,
  actorId: string,
  reason?: string,
  orderData?: {
    type: 'buy' | 'sell';
    crypto_amount: number;
    merchant_id: string;
    user_id: string;
    buyer_merchant_id: string | null;
    order_number: number;
    crypto_currency: string;
    fiat_amount: number;
    fiat_currency: string;
  }
): Promise<AtomicCancelResult> {
  // Validate transition
  const validation = validateTransition(currentStatus as any, 'cancelled', actorType);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid status transition',
    };
  }

  try {
    const order = await transaction(async (client) => {
      // Lock the order row and re-check status
      const lockCheck = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (lockCheck.rows.length === 0) {
        throw new Error('ORDER_NOT_FOUND');
      }

      const lockedOrder = lockCheck.rows[0];

      // Validate transition again with locked state
      if (lockedOrder.status === 'cancelled') {
        throw new Error('ALREADY_CANCELLED');
      }

      const revalidation = validateTransition(
        lockedOrder.status,
        'cancelled',
        actorType
      );
      if (!revalidation.valid) {
        throw new Error('STATUS_CHANGED_INVALID_TRANSITION');
      }

      const hadEscrow = !!lockedOrder.escrow_tx_hash;
      const escrowDebitedEntityId = lockedOrder.escrow_debited_entity_id;
      const escrowDebitedEntityType = lockedOrder.escrow_debited_entity_type;
      const escrowDebitedAmount = lockedOrder.escrow_debited_amount
        ? parseFloat(String(lockedOrder.escrow_debited_amount))
        : 0;

      // TASK 4: Refund always goes to escrow_debited_entity_id (the entity that
      // actually paid), NOT derived from order roles. This is the single source
      // of truth recorded at escrow lock time.
      if (hadEscrow && escrowDebitedEntityId && escrowDebitedAmount > 0) {
        const refundTable = escrowDebitedEntityType === 'merchant' ? 'merchants' : 'users';

        // Restore balance to the entity that was debited
        const balanceResult = await client.query(
          `SELECT balance FROM ${refundTable} WHERE id = $1 FOR UPDATE`,
          [escrowDebitedEntityId]
        );

        if (balanceResult.rows.length > 0) {
          const balanceBefore = parseFloat(String(balanceResult.rows[0].balance));

          await client.query(
            `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
            [escrowDebitedAmount, escrowDebitedEntityId]
          );

          // TASK 3: Validate balance consistency post-UPDATE
          const balanceCheck = await client.query(
            `SELECT balance FROM ${refundTable} WHERE id = $1`,
            [escrowDebitedEntityId]
          );
          const balanceAfter = parseFloat(String(balanceCheck.rows[0].balance));
          const expectedBalance = balanceBefore + escrowDebitedAmount;

          if (Math.abs(balanceAfter - expectedBalance) > 0.00000001) {
            throw new Error(
              `BALANCE_MISMATCH: refund balance ${balanceAfter} != expected ${expectedBalance}`
            );
          }

          // Insert ESCROW_REFUND ledger entry (ON CONFLICT for idempotency — TASK 2)
          await client.query(
            `INSERT INTO ledger_entries
             (account_type, account_id, entry_type, amount, asset,
              related_order_id, description, metadata,
              balance_before, balance_after)
             VALUES ($1, $2, 'ESCROW_REFUND', $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (related_order_id, entry_type, account_id)
               WHERE related_order_id IS NOT NULL
                 AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE')
             DO NOTHING`,
            [
              escrowDebitedEntityType,
              escrowDebitedEntityId,
              escrowDebitedAmount,
              lockedOrder.crypto_currency || 'USDT',
              orderId,
              `Escrow refunded for cancelled order #${lockedOrder.order_number}`,
              JSON.stringify({
                reason: reason || 'Cancelled by ' + actorType,
                original_lock_at: lockedOrder.escrow_debited_at,
              }),
              balanceBefore,
              balanceAfter,
            ]
          );

          logger.info('[Atomic] Escrow balance refunded', {
            orderId,
            refundedTo: escrowDebitedEntityId,
            refundedType: escrowDebitedEntityType,
            amount: escrowDebitedAmount,
            balanceBefore,
            balanceAfter,
          });
        } else {
          logger.error('[Atomic] Escrow debited entity not found for refund', {
            orderId,
            escrowDebitedEntityId,
            escrowDebitedEntityType,
          });
        }
      }

      // In real (on-chain) mode, escrow refunds happen on-chain.
      // The on-chain refund is handled by the caller before invoking this function.

      // Corridor bridge: refund locked sAED to buyer on cancellation
      if (lockedOrder.payment_via === 'saed_corridor' && lockedOrder.corridor_fulfillment_id) {
        const { refundBuyerSaed } = await import('@/lib/money/corridorSettlement');
        await refundBuyerSaed(client, orderId, lockedOrder.corridor_fulfillment_id);
        logger.info('[Atomic] Corridor sAED refunded on cancellation', { orderId });
      }

      // Update order status with version + previous status guard
      const updateResult = await client.query(
        `UPDATE orders
         SET status = 'cancelled',
             cancelled_at = NOW(),
             cancelled_by = $1,
             cancellation_reason = $2,
             order_version = order_version + 1
         WHERE id = $3
           AND order_version = $4
           AND status = $5::order_status
           AND status NOT IN ('completed', 'cancelled', 'expired')
         RETURNING *`,
        [actorType, reason || 'Cancelled by ' + actorType, orderId, lockedOrder.order_version, lockedOrder.status]
      );

      if (updateResult.rows.length === 0) {
        throw new Error('STATUS_CHANGED_INVALID_TRANSITION');
      }

      const updatedOrder = updateResult.rows[0] as Order;

      // Create order_events record.
      // order_events.actor_id is UUID — when the actor is the system worker
      // (no real UUID), pass NULL instead of the literal string 'system'.
      const actorIdForEvent = actorType === 'system' ? null : actorId;
      await client.query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'order_cancelled', $2, $3, $4, 'cancelled', $5)`,
        [
          orderId,
          actorType,
          actorIdForEvent,
          currentStatus,
          JSON.stringify({
            reason: reason || 'Cancelled by ' + actorType,
            had_escrow: hadEscrow,
            refunded_amount: hadEscrow ? escrowDebitedAmount : 0,
            refunded_entity_type: hadEscrow ? escrowDebitedEntityType : null,
            refunded_entity_id: hadEscrow ? escrowDebitedEntityId : null,
            atomic_cancellation: true,
          }),
        ]
      );

      // Create notification_outbox record
      await client.query(
        `INSERT INTO notification_outbox (event_type, order_id, payload)
         VALUES ($1, $2, $3)`,
        [
          'ORDER_CANCELLED',
          orderId,
          JSON.stringify({
            orderId,
            userId: updatedOrder.user_id,
            merchantId: updatedOrder.merchant_id,
            buyerMerchantId: updatedOrder.buyer_merchant_id,
            status: 'cancelled',
            previousStatus: currentStatus,
            orderNumber: updatedOrder.order_number,
            cryptoAmount: updatedOrder.crypto_amount,
            cryptoCurrency: updatedOrder.crypto_currency,
            fiatAmount: updatedOrder.fiat_amount,
            fiatCurrency: updatedOrder.fiat_currency,
            orderType: updatedOrder.type,
            orderVersion: updatedOrder.order_version,
            reason: reason || 'Cancelled by ' + actorType,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      logger.info('[Atomic] Order cancelled with events and outbox', {
        orderId,
        orderVersion: updatedOrder.order_version,
        hadEscrow,
      });

      return updatedOrder;
    });

    return {
      success: true,
      order,
    };
  } catch (error) {
    const errMsg = (error as Error).message;

    if (errMsg === 'ORDER_NOT_FOUND') {
      return {
        success: false,
        error: 'Order not found',
      };
    }

    if (errMsg === 'ALREADY_CANCELLED') {
      return {
        success: false,
        error: 'Order already cancelled',
      };
    }

    if (errMsg === 'STATUS_CHANGED_INVALID_TRANSITION') {
      return {
        success: false,
        error: 'Order status changed - cancellation no longer valid',
      };
    }

    logger.error('[Atomic] Cancel with refund failed', {
      orderId,
      error: errMsg,
    });

    return {
      success: false,
      error: `Failed to cancel order: ${errMsg}`,
    };
  }
}
