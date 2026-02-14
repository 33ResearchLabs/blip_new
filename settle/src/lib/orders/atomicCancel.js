/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMIC ESCROW REFUND - LOCKED FINALIZATION PATH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL: This function MUST remain atomic. Do NOT refactor to split apart:
 * - status update to 'cancelled'
 * - balance refund (if MOCK_MODE and escrow exists)
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
import { MOCK_MODE } from '@/lib/config/mockMode';
import { logger } from '@/lib/logger';
import { validateTransition } from './stateMachine';
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
export async function atomicCancelWithRefund(orderId, currentStatus, actorType, actorId, reason, orderData) {
    // Validate transition
    const validation = validateTransition(currentStatus, 'cancelled', actorType);
    if (!validation.allowed) {
        return {
            success: false,
            error: validation.error || 'Invalid status transition',
        };
    }
    try {
        const order = await transaction(async (client) => {
            // Lock the order row and re-check status
            const lockCheck = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
            if (lockCheck.rows.length === 0) {
                throw new Error('ORDER_NOT_FOUND');
            }
            const lockedOrder = lockCheck.rows[0];
            // Validate transition again with locked state
            if (lockedOrder.status === 'cancelled') {
                throw new Error('ALREADY_CANCELLED');
            }
            const revalidation = validateTransition(lockedOrder.status, 'cancelled', actorType);
            if (!revalidation.allowed) {
                throw new Error('STATUS_CHANGED_INVALID_TRANSITION');
            }
            const amount = parseFloat(String(lockedOrder.crypto_amount));
            const hadEscrow = !!lockedOrder.escrow_tx_hash;
            // Refund escrow if present (MOCK_MODE only)
            if (MOCK_MODE && hadEscrow) {
                const isBuyOrder = lockedOrder.type === 'buy';
                const isM2M = !!lockedOrder.buyer_merchant_id;
                let refundId;
                let refundTable;
                if (isM2M) {
                    // M2M: merchant_id is always the seller who locked escrow
                    refundId = lockedOrder.merchant_id;
                    refundTable = 'merchants';
                }
                else {
                    // User trade: BUY = merchant locked, SELL = user locked
                    refundId = isBuyOrder ? lockedOrder.merchant_id : lockedOrder.user_id;
                    refundTable = isBuyOrder ? 'merchants' : 'users';
                }
                await client.query(`UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`, [amount, refundId]);
                logger.info('[Atomic] Refunded escrow on cancellation', {
                    orderId,
                    refundId,
                    amount,
                    table: refundTable,
                });
            }
            // Update order status with version increment
            const updateResult = await client.query(`UPDATE orders
         SET status = 'cancelled',
             cancelled_at = NOW(),
             cancelled_by = $1,
             cancellation_reason = $2,
             order_version = order_version + 1
         WHERE id = $3
         RETURNING *`, [actorType, reason || 'Cancelled by ' + actorType, orderId]);
            const updatedOrder = updateResult.rows[0];
            // Create order_events record
            await client.query(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'order_cancelled', $2, $3, $4, 'cancelled', $5)`, [
                orderId,
                actorType,
                actorId,
                currentStatus,
                JSON.stringify({
                    reason: reason || 'Cancelled by ' + actorType,
                    had_escrow: hadEscrow,
                    refunded_amount: hadEscrow && MOCK_MODE ? amount : 0,
                    atomic_cancellation: true,
                }),
            ]);
            // Create notification_outbox record
            await client.query(`INSERT INTO notification_outbox (event_type, order_id, payload)
         VALUES ($1, $2, $3)`, [
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
            ]);
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
    }
    catch (error) {
        const errMsg = error.message;
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
