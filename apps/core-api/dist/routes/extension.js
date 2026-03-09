import { query as dbQuery, queryOne, canExtendOrder, getExtensionDuration, getExpiryOutcome, normalizeStatus, logger, } from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';
export const extensionRoutes = async (fastify) => {
    // POST /v1/orders/:id/extension - Request extension
    fastify.post('/orders/:id/extension', async (request, reply) => {
        const { id } = request.params;
        const { actor_type, actor_id } = request.body;
        if (!actor_type || !actor_id) {
            return reply.status(400).send({ success: false, error: 'actor_type and actor_id required' });
        }
        try {
            const order = await queryOne('SELECT id, status, extension_count, max_extensions, extension_requested_by, user_id, merchant_id FROM orders WHERE id = $1', [id]);
            if (!order) {
                return reply.status(404).send({ success: false, error: 'Order not found' });
            }
            const extensionCheck = canExtendOrder(order.status, order.extension_count, order.max_extensions);
            if (!extensionCheck.canExtend) {
                return reply.status(400).send({ success: false, error: extensionCheck.reason });
            }
            if (order.extension_requested_by) {
                return reply.status(400).send({ success: false, error: 'Extension request already pending' });
            }
            const duration = getExtensionDuration(order.status);
            const updatedOrder = await queryOne(`UPDATE orders
         SET extension_requested_by = $2,
             extension_requested_at = NOW(),
             extension_minutes = $3,
             order_version = order_version + 1
         WHERE id = $1
         RETURNING *`, [id, actor_type, duration]);
            await dbQuery(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'extension_requested', $2, $3, $4)`, [id, actor_type, actor_id, JSON.stringify({ extension_count: order.extension_count, extension_minutes: duration })]);
            logger.info('[core-api] Extension requested', { orderId: id, actor: actor_type });
            broadcastOrderEvent({
                event_type: 'EXTENSION_REQUESTED',
                order_id: id,
                status: order.status,
                minimal_status: normalizeStatus(order.status),
                order_version: updatedOrder.order_version,
                userId: order.user_id,
                merchantId: order.merchant_id,
            });
            return reply.send({ success: true, data: updatedOrder });
        }
        catch (error) {
            fastify.log.error({ error, id }, 'Error requesting extension');
            return reply.status(500).send({ success: false, error: 'Internal server error' });
        }
    });
    // PUT /v1/orders/:id/extension - Accept/decline extension
    fastify.put('/orders/:id/extension', async (request, reply) => {
        const { id } = request.params;
        const { actor_type, actor_id, accept } = request.body;
        if (!actor_type || !actor_id || accept === undefined) {
            return reply.status(400).send({ success: false, error: 'actor_type, actor_id, and accept required' });
        }
        try {
            const order = await queryOne('SELECT * FROM orders WHERE id = $1', [id]);
            if (!order) {
                return reply.status(404).send({ success: false, error: 'Order not found' });
            }
            if (!order.extension_requested_by) {
                return reply.status(400).send({ success: false, error: 'No extension request pending' });
            }
            if (order.extension_requested_by === actor_type) {
                return reply.status(400).send({ success: false, error: 'Cannot respond to own request' });
            }
            let updatedOrder;
            if (accept) {
                const extensionMinutes = order.extension_minutes || getExtensionDuration(order.status);
                updatedOrder = await queryOne(`UPDATE orders
           SET extension_count = extension_count + 1,
               extension_requested_by = NULL,
               extension_requested_at = NULL,
               expires_at = COALESCE(expires_at, NOW()) + INTERVAL '1 minute' * $2,
               order_version = order_version + 1
           WHERE id = $1
           RETURNING *`, [id, extensionMinutes]);
                await dbQuery(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'extension_accepted', $2, $3, $4)`, [id, actor_type, actor_id, JSON.stringify({ extension_count: order.extension_count + 1, extension_minutes: extensionMinutes })]);
            }
            else {
                // Decline - determine outcome
                const outcome = getExpiryOutcome(order.status, order.extension_count, order.max_extensions);
                if (outcome === 'disputed') {
                    updatedOrder = await queryOne(`UPDATE orders
             SET extension_requested_by = NULL,
                 extension_requested_at = NULL,
                 status = 'disputed',
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`, [id]);
                    await dbQuery(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_disputed', 'system', NULL, $2, 'disputed', $3)`, [id, order.status, JSON.stringify({ reason: 'Extension declined after max extensions' })]);
                }
                else {
                    updatedOrder = await queryOne(`UPDATE orders
             SET extension_requested_by = NULL,
                 extension_requested_at = NULL,
                 status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by = $2,
                 cancellation_reason = 'Extension declined',
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`, [id, actor_type]);
                    await dbQuery(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_cancelled', $2, $3, $4, 'cancelled', $5)`, [id, actor_type, actor_id, order.status, JSON.stringify({ reason: 'Extension declined' })]);
                }
                // Decline event
                await dbQuery(`INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'extension_declined', $2, $3, $4)`, [id, actor_type, actor_id, JSON.stringify({ outcome })]);
            }
            logger.info('[core-api] Extension response', { orderId: id, accepted: accept });
            const finalStatus = updatedOrder.status || order.status;
            broadcastOrderEvent({
                event_type: accept ? 'EXTENSION_ACCEPTED' : `ORDER_${finalStatus.toUpperCase()}`,
                order_id: id,
                status: finalStatus,
                minimal_status: normalizeStatus(finalStatus),
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
            fastify.log.error({ error, id }, 'Error responding to extension');
            return reply.status(500).send({ success: false, error: 'Internal server error' });
        }
    });
};
