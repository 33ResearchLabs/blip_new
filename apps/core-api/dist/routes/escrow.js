import { transaction, queryOne, logger, MOCK_MODE, normalizeStatus, } from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';
export const escrowRoutes = async (fastify) => {
    // POST /v1/orders/:id/escrow - Lock escrow
    fastify.post('/orders/:id/escrow', async (request, reply) => {
        const { id } = request.params;
        const { tx_hash, actor_type, actor_id, escrow_address, escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet, } = request.body;
        if (!tx_hash || !actor_type || !actor_id) {
            return reply.status(400).send({
                success: false,
                error: 'tx_hash, actor_type, and actor_id are required',
            });
        }
        try {
            // Get order to check amount
            const order = await queryOne('SELECT id, crypto_amount, order_number, status, user_id, merchant_id FROM orders WHERE id = $1', [id]);
            if (!order) {
                return reply.status(404).send({ success: false, error: 'Order not found' });
            }
            const amount = parseFloat(String(order.crypto_amount));
            // Atomic: lock order + deduct balance + update escrow fields
            await transaction(async (client) => {
                // Lock and re-check
                const lockCheck = await client.query('SELECT status, escrow_tx_hash FROM orders WHERE id = $1 FOR UPDATE', [id]);
                const lockedOrder = lockCheck.rows[0];
                if (!lockedOrder || !['pending', 'accepted', 'escrow_pending'].includes(lockedOrder.status)) {
                    throw new Error('ORDER_STATUS_CHANGED');
                }
                if (lockedOrder.escrow_tx_hash) {
                    throw new Error('ALREADY_ESCROWED');
                }
                // Mock mode: deduct seller balance
                if (MOCK_MODE) {
                    const sellerTable = actor_type === 'merchant' ? 'merchants' : 'users';
                    const deductResult = await client.query(`UPDATE ${sellerTable} SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`, [amount, actor_id]);
                    if (!deductResult || deductResult.rows.length === 0) {
                        throw new Error('INSUFFICIENT_BALANCE');
                    }
                }
                // Update order with escrow details
                await client.query(`UPDATE orders SET
            escrow_tx_hash = $1,
            escrow_address = $2,
            escrow_trade_id = $3::BIGINT,
            escrow_trade_pda = $4,
            escrow_pda = $5,
            escrow_creator_wallet = $6,
            escrowed_at = NOW(),
            expires_at = NOW() + INTERVAL '120 minutes',
            status = 'escrowed',
            order_version = order_version + 1
          WHERE id = $7`, [
                    tx_hash,
                    escrow_address || null,
                    escrow_trade_id || null,
                    escrow_trade_pda || null,
                    escrow_pda || null,
                    escrow_creator_wallet || null,
                    id,
                ]);
                // Create event
                await client.query(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'status_changed_to_escrowed', $2, $3, $4, 'escrowed', $5)`, [id, actor_type, actor_id, order.status, JSON.stringify({ tx_hash })]);
                // Notification outbox
                await client.query(`INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_ESCROWED', $2, 'pending')`, [
                    id,
                    JSON.stringify({
                        orderId: id,
                        status: 'escrowed',
                        previousStatus: order.status,
                        escrowTxHash: tx_hash,
                        updatedAt: new Date().toISOString(),
                    }),
                ]);
            });
            // Fetch updated order
            const updatedOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [id]);
            logger.info('[core-api] Escrow locked', { orderId: id, txHash: tx_hash });
            broadcastOrderEvent({
                event_type: 'ORDER_ESCROWED',
                order_id: id,
                status: 'escrowed',
                minimal_status: normalizeStatus('escrowed'),
                order_version: updatedOrder.order_version,
                userId: order.user_id,
                merchantId: order.merchant_id,
                previousStatus: order.status,
            });
            return reply.send({
                success: true,
                data: updatedOrder,
            });
        }
        catch (error) {
            const errMsg = error.message;
            if (errMsg === 'INSUFFICIENT_BALANCE') {
                return reply.status(400).send({ success: false, error: 'Insufficient balance to lock escrow' });
            }
            if (errMsg === 'ALREADY_ESCROWED') {
                return reply.status(409).send({ success: false, error: 'Escrow already locked' });
            }
            if (errMsg === 'ORDER_STATUS_CHANGED') {
                return reply.status(409).send({ success: false, error: 'Order status changed' });
            }
            fastify.log.error({ error, id }, 'Error locking escrow');
            return reply.status(500).send({ success: false, error: 'Internal server error' });
        }
    });
};
