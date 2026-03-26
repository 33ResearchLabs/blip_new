/**
 * Mock Escrow Release — Atomic buyer credit + seller fee deduction
 *
 * When MOCK_MODE is active, this function atomically:
 * 1. Credits the buyer's balance (escrow release)
 * 2. Deducts platform fee from seller
 * 3. Creates ESCROW_RELEASE ledger entry for buyer
 * 4. Creates FEE ledger entry for seller
 * 5. Transitions order to 'completed'
 *
 * All in a SINGLE DB transaction — debit + credit are never split.
 *
 * TASK 1: Ensures debit (seller at escrow lock) + credit (buyer at release)
 *         are bookended by atomic transactions.
 * TASK 3: Validates balance_after = balance_before + delta post-UPDATE.
 * TASK 4: WHERE status = 'payment_confirmed' prevents double release.
 */

import { transaction } from '@/lib/db';
import { Order, ActorType } from '@/lib/types/database';
import { validateTransition } from '@/lib/orders/stateMachineMinimal';
import { createTransactionInTx } from '@/lib/db/repositories/transactions';
import { logger } from '@/lib/logger';

export interface MockReleaseResult {
  success: boolean;
  order?: Order;
  feeAmount?: number;
  error?: string;
}

/**
 * Determine who receives the escrowed crypto on release.
 *
 * Buy order:  user is the buyer → credit user
 * Sell order: merchant is the buyer → credit merchant
 * M2M:       buyer_merchant_id is the buyer → credit buyer merchant
 */
function determineReleaseBeneficiary(order: {
  type: 'buy' | 'sell';
  merchant_id: string;
  user_id: string;
  buyer_merchant_id: string | null;
}): { entityType: 'merchant' | 'user'; entityId: string; table: 'merchants' | 'users' } {
  if (order.buyer_merchant_id) {
    // M2M: buyer_merchant_id is ALWAYS the buyer who receives crypto. Type-agnostic.
    return { entityType: 'merchant', entityId: order.buyer_merchant_id, table: 'merchants' };
  }
  if (order.type === 'buy') {
    return { entityType: 'user', entityId: order.user_id, table: 'users' };
  }
  // Sell order: merchant is buying crypto from user
  return { entityType: 'merchant', entityId: order.merchant_id, table: 'merchants' };
}

/**
 * Release escrow in mock mode. Credits buyer, deducts fee, completes order
 * — all in a single DB transaction.
 */
export async function mockEscrowRelease(
  orderId: string,
  actorType: ActorType,
  actorId: string,
  releaseTxHash: string
): Promise<MockReleaseResult> {
  try {
    const result = await transaction(async (client) => {
      // 1. Lock the order row
      const lockResult = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (lockResult.rows.length === 0) {
        throw new Error('ORDER_NOT_FOUND');
      }

      const lockedOrder = lockResult.rows[0] as Order;

      // TASK 4: Only allow release from payment_confirmed or releasing
      // This is the SOLE guard against double release
      const allowedStatuses = ['payment_confirmed', 'releasing'];
      if (!allowedStatuses.includes(lockedOrder.status)) {
        if (lockedOrder.status === 'completed') {
          throw new Error('ALREADY_RELEASED');
        }
        throw new Error(`INVALID_STATUS: Cannot release from '${lockedOrder.status}'`);
      }

      // Validate state machine transition
      const validation = validateTransition(lockedOrder.status as any, 'completed', actorType);
      if (!validation.valid) {
        throw new Error(`INVALID_TRANSITION: ${validation.error}`);
      }

      // Must have escrow locked
      if (!lockedOrder.escrow_debited_entity_id) {
        throw new Error('NO_ESCROW: Escrow was never locked for this order');
      }

      const cryptoAmount = parseFloat(String(lockedOrder.crypto_amount));

      // 2. Determine buyer (release beneficiary)
      const buyer = determineReleaseBeneficiary({
        type: lockedOrder.type as 'buy' | 'sell',
        merchant_id: lockedOrder.merchant_id,
        user_id: lockedOrder.user_id,
        buyer_merchant_id: lockedOrder.buyer_merchant_id,
      });

      // 3. Credit the buyer's balance
      const buyerBalanceResult = await client.query(
        `SELECT balance FROM ${buyer.table} WHERE id = $1 FOR UPDATE`,
        [buyer.entityId]
      );

      if (buyerBalanceResult.rows.length === 0) {
        throw new Error('BUYER_NOT_FOUND');
      }

      const buyerBalanceBefore = parseFloat(String(buyerBalanceResult.rows[0].balance));

      await client.query(
        `UPDATE ${buyer.table} SET balance = balance + $1 WHERE id = $2`,
        [cryptoAmount, buyer.entityId]
      );

      // TASK 3: Validate balance consistency post-UPDATE
      const buyerBalanceCheck = await client.query(
        `SELECT balance FROM ${buyer.table} WHERE id = $1`,
        [buyer.entityId]
      );
      const buyerBalanceAfter = parseFloat(String(buyerBalanceCheck.rows[0].balance));
      const expectedBuyerBalance = buyerBalanceBefore + cryptoAmount;

      if (Math.abs(buyerBalanceAfter - expectedBuyerBalance) > 0.00000001) {
        throw new Error(
          `BALANCE_MISMATCH: buyer balance ${buyerBalanceAfter} != expected ${expectedBuyerBalance}`
        );
      }

      // 4. ESCROW_RELEASE ledger entry for buyer (ON CONFLICT for idempotency)
      await client.query(
        `INSERT INTO ledger_entries
         (account_type, account_id, entry_type, amount, asset,
          related_order_id, related_tx_hash, description, metadata,
          balance_before, balance_after)
         VALUES ($1, $2, 'ESCROW_RELEASE', $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (related_order_id, entry_type, account_id)
           WHERE related_order_id IS NOT NULL
             AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE')
         DO NOTHING`,
        [
          buyer.entityType,
          buyer.entityId,
          cryptoAmount,
          lockedOrder.crypto_currency || 'USDT',
          orderId,
          releaseTxHash,
          `Escrow released for order #${lockedOrder.order_number}`,
          JSON.stringify({
            order_type: lockedOrder.type,
            source: 'app',
          }),
          buyerBalanceBefore,
          buyerBalanceAfter,
        ]
      );

      // 5. merchant_transactions entry for buyer credit
      await createTransactionInTx(client, {
        ...(buyer.entityType === 'merchant'
          ? { merchant_id: buyer.entityId }
          : { user_id: buyer.entityId }),
        order_id: orderId,
        type: 'escrow_release',
        amount: cryptoAmount,
        description: `Escrow released for order #${lockedOrder.order_number}`,
      });

      // 6. Deduct platform fee from seller (who locked escrow)
      const feePercentage = parseFloat(String(lockedOrder.protocol_fee_percentage ?? 2.5));
      const feeAmount = cryptoAmount * feePercentage / 100;

      let actualFeeAmount = 0;
      if (feeAmount > 0) {
        const sellerType = lockedOrder.escrow_debited_entity_type as 'merchant' | 'user';
        const sellerId = lockedOrder.escrow_debited_entity_id;
        const sellerTable = sellerType === 'merchant' ? 'merchants' : 'users';

        const sellerBalanceResult = await client.query(
          `SELECT balance FROM ${sellerTable} WHERE id = $1 FOR UPDATE`,
          [sellerId]
        );

        if (sellerBalanceResult.rows.length > 0) {
          const sellerBalanceBefore = parseFloat(String(sellerBalanceResult.rows[0].balance));

          // Don't deduct more than seller has (edge case: seller withdrew between lock and release)
          actualFeeAmount = Math.min(feeAmount, sellerBalanceBefore);

          if (actualFeeAmount > 0) {
            await client.query(
              `UPDATE ${sellerTable} SET balance = balance - $1 WHERE id = $2`,
              [actualFeeAmount, sellerId]
            );

            const sellerBalanceAfter = sellerBalanceBefore - actualFeeAmount;

            // FEE ledger entry
            await client.query(
              `INSERT INTO ledger_entries
               (account_type, account_id, entry_type, amount, asset,
                related_order_id, description, metadata,
                balance_before, balance_after)
               VALUES ($1, $2, 'FEE', $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (related_order_id, entry_type, account_id)
                 WHERE related_order_id IS NOT NULL
                   AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE')
               DO NOTHING`,
              [
                sellerType,
                sellerId,
                -actualFeeAmount,
                lockedOrder.crypto_currency || 'USDT',
                orderId,
                `Platform fee (${feePercentage}%) for order #${lockedOrder.order_number}`,
                JSON.stringify({
                  fee_rate: `${feePercentage}%`,
                  order_type: lockedOrder.type,
                  source: 'app',
                }),
                sellerBalanceBefore,
                sellerBalanceAfter,
              ]
            );

            // Fee transaction log
            await createTransactionInTx(client, {
              ...(sellerType === 'merchant'
                ? { merchant_id: sellerId }
                : { user_id: sellerId }),
              order_id: orderId,
              type: 'fee_deduction',
              amount: -actualFeeAmount,
              description: `Platform fee (${feePercentage}%) for order #${lockedOrder.order_number}`,
            });

            // Credit platform balance
            await client.query(
              `UPDATE platform_balance
               SET balance = balance + $1,
                   total_fees_collected = total_fees_collected + $1,
                   updated_at = NOW()
               WHERE key = 'main'`,
              [actualFeeAmount]
            );

            // Platform fee audit log
            await client.query(
              `INSERT INTO platform_fee_transactions
               (order_id, fee_amount, fee_percentage, spread_preference, platform_balance_after)
               VALUES ($1, $2, $3, $4,
                 (SELECT balance FROM platform_balance WHERE key = 'main'))`,
              [orderId, actualFeeAmount, feePercentage, lockedOrder.spread_preference || 'fastest']
            );
          }
        }
      }

      // 7. Complete the order — version + status guard prevents double release
      const updateResult = await client.query(
        `UPDATE orders
         SET status = 'completed',
             release_tx_hash = $1,
             completed_at = NOW(),
             payment_confirmed_at = COALESCE(payment_confirmed_at, NOW()),
             order_version = order_version + 1,
             platform_fee = $2
         WHERE id = $3
           AND order_version = $4
           AND status = $5::order_status
           AND status NOT IN ('completed', 'cancelled', 'expired')
         RETURNING *`,
        [
          releaseTxHash,
          actualFeeAmount,
          orderId,
          lockedOrder.order_version,
          lockedOrder.status,
        ]
      );

      if (updateResult.rows.length === 0) {
        throw new Error('CONCURRENT_MODIFICATION: Order was modified by another process');
      }

      const updatedOrder = updateResult.rows[0] as Order;

      // 8. Order event
      await client.query(
        `INSERT INTO order_events
         (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'escrow_released', $2, $3, $4, 'completed', $5)`,
        [
          orderId,
          actorType,
          actorId,
          lockedOrder.status,
          JSON.stringify({
            release_tx_hash: releaseTxHash,
            buyer_type: buyer.entityType,
            buyer_id: buyer.entityId,
            credited_amount: cryptoAmount,
            fee_amount: actualFeeAmount,
            fee_percentage: feePercentage,
            mock_mode: true,
          }),
        ]
      );

      logger.info('[MockRelease] Escrow released atomically', {
        orderId,
        buyer: buyer.entityType,
        buyerId: buyer.entityId,
        creditedAmount: cryptoAmount,
        feeAmount: actualFeeAmount,
        buyerBalanceBefore,
        buyerBalanceAfter,
        orderVersion: updatedOrder.order_version,
      });

      return { order: updatedOrder, feeAmount: actualFeeAmount };
    });

    return {
      success: true,
      order: result.order,
      feeAmount: result.feeAmount,
    };
  } catch (error) {
    const errMsg = (error as Error).message;

    if (errMsg === 'ORDER_NOT_FOUND') {
      return { success: false, error: 'Order not found' };
    }
    if (errMsg === 'ALREADY_RELEASED') {
      return { success: false, error: 'Escrow already released — order is completed' };
    }
    if (errMsg.startsWith('INVALID_STATUS')) {
      return { success: false, error: errMsg.replace('INVALID_STATUS: ', '') };
    }
    if (errMsg.startsWith('NO_ESCROW')) {
      return { success: false, error: errMsg.replace('NO_ESCROW: ', '') };
    }
    if (errMsg === 'BUYER_NOT_FOUND') {
      return { success: false, error: 'Release beneficiary not found' };
    }
    if (errMsg.startsWith('BALANCE_MISMATCH')) {
      return { success: false, error: errMsg };
    }
    if (errMsg.startsWith('INVALID_TRANSITION')) {
      return { success: false, error: errMsg.replace('INVALID_TRANSITION: ', '') };
    }
    if (errMsg.startsWith('CONCURRENT_MODIFICATION')) {
      return { success: false, error: 'Order was modified concurrently. Please retry.' };
    }

    logger.error('[MockRelease] Escrow release failed', {
      orderId,
      error: errMsg,
    });

    return { success: false, error: `Failed to release escrow: ${errMsg}` };
  }
}
