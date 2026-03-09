import { query as dbQuery, normalizeStatus, logger, } from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';
import { bufferNotification } from '../batchWriter';
export const orderCreateRoutes = async (fastify) => {
    // POST /v1/orders - Create order
    fastify.post('/orders', async (request, reply) => {
        const data = request.body;
        if (!data.user_id || !data.merchant_id || !data.offer_id) {
            return reply.status(400).send({
                success: false,
                error: 'user_id, merchant_id, and offer_id are required',
            });
        }
        try {
            // Two separate queries (NOT in a TX) to minimize offer row lock duration.
            // Stored proc held the lock across INSERT which caused contention with 20 merchants.
            const fields = [
                'user_id', 'merchant_id', 'offer_id', 'type', 'payment_method',
                'crypto_amount', 'fiat_amount', 'crypto_currency', 'fiat_currency', 'rate',
                'payment_details', 'status',
            ];
            // escrow_funded=true means actual funds locked (SELL), false/absent means trade intent only (BUY)
            const isEscrowFunded = data.escrow_tx_hash && data.escrow_funded !== false;
            const values = [
                data.user_id, data.merchant_id, data.offer_id, data.type, data.payment_method,
                data.crypto_amount, data.fiat_amount, 'USDC', 'AED', data.rate,
                data.payment_details ? JSON.stringify(data.payment_details) : null,
                isEscrowFunded ? 'escrowed' : 'pending',
            ];
            // expires_at uses raw SQL to avoid JS Date / Postgres timezone mismatch
            // (created_at is `timestamp without time zone` using DB-local now())
            const expiryMin = Math.max(1, Math.min(1440, data.expiry_minutes || 15));
            const expiresAtRaw = `now() + interval '${expiryMin} minutes'`;
            const optionals = [
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
            ];
            for (const [field, value] of optionals) {
                if (value !== undefined && value !== null) {
                    fields.push(field);
                    values.push(value);
                }
            }
            if (isEscrowFunded) {
                fields.push('escrowed_at');
                values.push(new Date());
            }
            // Deduct liquidity first (short row lock, auto-commit)
            const deducted = await dbQuery('UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2 AND available_amount >= $1 RETURNING id', [data.crypto_amount, data.offer_id]);
            if (deducted.length === 0) {
                return reply.status(409).send({ success: false, error: 'Insufficient offer liquidity' });
            }
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
            const allFields = [...fields, 'expires_at'];
            const allPlaceholders = [placeholders, expiresAtRaw].join(', ');
            const rows = await dbQuery(`INSERT INTO orders (${allFields.join(', ')}) VALUES (${allPlaceholders}) RETURNING *`, values);
            const order = rows[0];
            // Batched notification (zero round-trips, flushed every 50ms)
            bufferNotification({ order_id: order.id, event_type: 'ORDER_CREATED', payload: JSON.stringify({
                    orderId: order.id, userId: data.user_id, merchantId: data.merchant_id,
                    status: order.status, minimal_status: normalizeStatus(order.status),
                    order_version: order.order_version || 1, updatedAt: new Date().toISOString(),
                }) });
            logger.info('[core-api] Order created', { orderId: order.id, type: data.type });
            broadcastOrderEvent({
                event_type: 'ORDER_CREATED',
                order_id: order.id,
                status: String(order.status),
                minimal_status: normalizeStatus(order.status),
                order_version: order.order_version || 1,
                userId: data.user_id,
                merchantId: data.merchant_id,
                buyerMerchantId: data.buyer_merchant_id,
            });
            return reply.status(201).send({
                success: true,
                data: { ...order, minimal_status: normalizeStatus(order.status) },
            });
        }
        catch (error) {
            if (error?.statusCode) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            fastify.log.error({ error }, 'Error creating order');
            return reply.status(500).send({ success: false, error: 'Internal server error' });
        }
    });
    // POST /v1/merchant/orders - Merchant-initiated order creation
    fastify.post('/merchant/orders', async (request, reply) => {
        const data = request.body;
        if (!data.user_id || !data.merchant_id || !data.offer_id) {
            return reply.status(400).send({
                success: false,
                error: 'user_id, merchant_id, and offer_id are required',
            });
        }
        try {
            // Same creation logic - settle has already resolved the offer, created placeholder user, etc.
            // expires_at uses raw SQL to avoid JS Date / Postgres timezone mismatch
            const expiryMin = Math.max(1, Math.min(1440, data.expiry_minutes || 15));
            const expiresAtRaw = `now() + interval '${expiryMin} minutes'`;
            const fields = [
                'user_id', 'merchant_id', 'offer_id', 'type', 'payment_method',
                'crypto_amount', 'fiat_amount', 'crypto_currency', 'fiat_currency', 'rate',
                'payment_details', 'status',
            ];
            // escrow_funded=true means actual funds locked (SELL), false/absent means trade intent only (BUY)
            const isEscrowFunded = data.escrow_tx_hash && data.escrow_funded !== false;
            const values = [
                data.user_id, data.merchant_id, data.offer_id, data.type, data.payment_method,
                data.crypto_amount, data.fiat_amount, 'USDC', 'AED', data.rate,
                data.payment_details ? JSON.stringify(data.payment_details) : null,
                isEscrowFunded ? 'escrowed' : 'pending',
            ];
            // Optional fields
            const optionalFields = [
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
            ];
            for (const [field, value] of optionalFields) {
                if (value !== undefined && value !== null) {
                    fields.push(field);
                    values.push(value);
                }
            }
            if (isEscrowFunded) {
                fields.push('escrowed_at');
                values.push(new Date());
            }
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
            const allFields = [...fields, 'expires_at'];
            const allPlaceholders = [placeholders, expiresAtRaw].join(', ');
            const sql = `INSERT INTO orders (${allFields.join(', ')}) VALUES (${allPlaceholders}) RETURNING *`;
            const rows = await dbQuery(sql, values);
            const order = rows[0];
            // Batched notification (zero round-trips, flushed every 50ms)
            bufferNotification({ order_id: order.id, event_type: 'ORDER_CREATED', payload: JSON.stringify({
                    orderId: order.id, userId: data.user_id, merchantId: data.merchant_id,
                    buyerMerchantId: data.buyer_merchant_id, status: order.status,
                    minimal_status: normalizeStatus(order.status),
                    order_version: order.order_version || 1, updatedAt: new Date().toISOString(),
                }) });
            logger.info('[core-api] Merchant order created', {
                orderId: order.id,
                merchantId: data.merchant_id,
                buyerMerchantId: data.buyer_merchant_id,
                isM2M: data.is_m2m,
            });
            broadcastOrderEvent({
                event_type: 'ORDER_CREATED',
                order_id: order.id,
                status: String(order.status),
                minimal_status: normalizeStatus(order.status),
                order_version: order.order_version || 1,
                userId: data.user_id,
                merchantId: data.merchant_id,
                buyerMerchantId: data.buyer_merchant_id,
            });
            return reply.status(201).send({
                success: true,
                data: { ...order, minimal_status: normalizeStatus(order.status) },
            });
        }
        catch (error) {
            if (error?.statusCode) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            fastify.log.error({ error }, 'Error creating merchant order');
            return reply.status(500).send({ success: false, error: 'Internal server error' });
        }
    });
};
