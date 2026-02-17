/**
 * Core API Corridor Routes
 *
 * POST /v1/corridor/match — auto-match LP, lock buyer sAED, create fulfillment
 * PATCH /v1/corridor/fulfillments/:id — LP marks payment_sent
 * GET /v1/corridor/fulfillments — LP's active assignments
 */
import type { FastifyPluginAsync } from 'fastify';
import { transaction, logger } from 'settlement-core';

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export const corridorRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /v1/corridor/match — Find LP, lock buyer sAED, create fulfillment, link to order
  fastify.post<{
    Body: {
      order_id: string;
      buyer_merchant_id: string;
      seller_merchant_id: string;
      fiat_amount: number;
      bank_details?: Record<string, unknown>;
    };
  }>('/corridor/match', async (request, reply) => {
    const { order_id, buyer_merchant_id, seller_merchant_id, fiat_amount, bank_details } = request.body;

    if (!order_id || !buyer_merchant_id || !seller_merchant_id || !fiat_amount) {
      return reply.status(400).send({ success: false, error: 'Missing required fields' });
    }

    try {
      const result = await transaction(async (client: PgClient) => {
        // 1. Find best LP (cheapest fee, online, can handle amount)
        const lpResult = await client.query(
          `SELECT cp.*, m.rating as merchant_rating, m.display_name as merchant_name
           FROM corridor_providers cp
           JOIN merchants m ON cp.merchant_id = m.id
           WHERE cp.is_active = true
             AND m.is_online = true
             AND m.status = 'active'
             AND cp.min_amount <= $1
             AND cp.max_amount >= $1
             AND cp.merchant_id != $2
             AND cp.merchant_id != $3
             AND (cp.available_hours_start IS NULL
                  OR CURRENT_TIME BETWEEN cp.available_hours_start AND cp.available_hours_end)
           ORDER BY cp.fee_percentage ASC, m.rating DESC
           LIMIT 1
           FOR UPDATE`,
          [fiat_amount, buyer_merchant_id, seller_merchant_id]
        );

        if (lpResult.rows.length === 0) {
          throw new Error('NO_LP_AVAILABLE');
        }

        const lp = lpResult.rows[0];
        const feePercentage = parseFloat(String(lp.fee_percentage));
        const fiatFils = Math.round(fiat_amount * 100);
        const corridorFeeFils = Math.round(fiatFils * feePercentage / 100);
        const totalSaedLock = fiatFils + corridorFeeFils;

        // 2. Lock buyer's sAED
        const buyerResult = await client.query(
          'SELECT sinr_balance FROM merchants WHERE id = $1 FOR UPDATE',
          [buyer_merchant_id]
        );
        if (buyerResult.rows.length === 0) throw new Error('BUYER_NOT_FOUND');

        const buyerSaed = parseInt(String(buyerResult.rows[0].sinr_balance));
        if (buyerSaed < totalSaedLock) throw new Error('INSUFFICIENT_SAED');

        await client.query(
          'UPDATE merchants SET sinr_balance = sinr_balance - $1 WHERE id = $2',
          [totalSaedLock, buyer_merchant_id]
        );

        const saedAfter = buyerSaed - totalSaedLock;

        // 3. Ledger entry for sAED lock
        await client.query(
          `INSERT INTO ledger_entries
           (account_type, account_id, entry_type, amount, asset,
            related_order_id, description, metadata, balance_before, balance_after)
           VALUES ('merchant', $1, 'CORRIDOR_SAED_LOCK', $2, 'sAED', $3, $4, $5, $6, $7)`,
          [
            buyer_merchant_id,
            -totalSaedLock,
            order_id,
            `Corridor sAED lock: ${totalSaedLock} fils (${fiat_amount} AED + ${corridorFeeFils} fils fee)`,
            JSON.stringify({ fiat_fils: fiatFils, fee_fils: corridorFeeFils, fee_pct: feePercentage }),
            buyerSaed,
            saedAfter,
          ]
        );

        // 4. Transaction log for buyer
        await client.query(
          `INSERT INTO merchant_transactions
           (merchant_id, order_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, $2, 'synthetic_conversion', $3, $4, $5, $6)`,
          [buyer_merchant_id, order_id, -totalSaedLock, buyerSaed, saedAfter, 'Corridor sAED lock']
        );

        // 5. Create fulfillment record
        const ffResult = await client.query(
          `INSERT INTO corridor_fulfillments
           (order_id, provider_merchant_id, provider_id, saed_amount_locked, fiat_amount,
            corridor_fee, bank_details, send_deadline)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 minutes')
           RETURNING *`,
          [
            order_id,
            lp.merchant_id,
            lp.id,
            totalSaedLock,
            fiat_amount,
            corridorFeeFils,
            bank_details ? JSON.stringify(bank_details) : null,
          ]
        );

        const fulfillment = ffResult.rows[0];

        // 6. Link fulfillment to order
        await client.query(
          `UPDATE orders
           SET payment_via = 'saed_corridor', corridor_fulfillment_id = $1
           WHERE id = $2`,
          [fulfillment.id, order_id]
        );

        // 7. Create notification for LP
        await client.query(
          `INSERT INTO notification_outbox
           (order_id, event_type, merchant_id, payload)
           VALUES ($1, 'CORRIDOR_ASSIGNMENT', $2, $3)`,
          [
            order_id,
            lp.merchant_id,
            JSON.stringify({
              fulfillment_id: fulfillment.id,
              fiat_amount,
              corridor_fee_fils: corridorFeeFils,
              send_deadline: fulfillment.send_deadline,
              bank_details: bank_details || null,
            }),
          ]
        );

        logger.info('[Corridor] LP matched and sAED locked', {
          orderId: order_id, buyerMerchantId: buyer_merchant_id,
          lpMerchantId: lp.merchant_id, feePercentage,
          totalSaedLock, fiatAmount: fiat_amount,
        });

        return {
          fulfillment_id: fulfillment.id,
          provider_merchant_id: lp.merchant_id,
          provider_name: lp.merchant_name,
          fee_percentage: feePercentage,
          corridor_fee_fils: corridorFeeFils,
          saed_locked: totalSaedLock,
          fiat_amount,
          send_deadline: fulfillment.send_deadline,
        };
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === 'NO_LP_AVAILABLE') {
        return reply.status(404).send({ success: false, error: 'No liquidity provider available for this amount' });
      }
      if (msg === 'BUYER_NOT_FOUND') {
        return reply.status(404).send({ success: false, error: 'Buyer merchant not found' });
      }
      if (msg === 'INSUFFICIENT_SAED') {
        return reply.status(400).send({ success: false, error: 'Insufficient sAED balance' });
      }
      fastify.log.error({ error, orderId: order_id }, 'Corridor match failed');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // PATCH /v1/corridor/fulfillments/:id — LP updates fulfillment status
  fastify.patch<{
    Params: { id: string };
    Body: { provider_status: 'payment_sent'; actor_id: string };
  }>('/corridor/fulfillments/:id', async (request, reply) => {
    const { id } = request.params;
    const { provider_status, actor_id } = request.body;

    if (provider_status !== 'payment_sent') {
      return reply.status(400).send({ success: false, error: 'Can only update to payment_sent' });
    }

    try {
      const result = await transaction(async (client: PgClient) => {
        const ffResult = await client.query(
          'SELECT * FROM corridor_fulfillments WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (ffResult.rows.length === 0) throw new Error('NOT_FOUND');

        const ff = ffResult.rows[0];
        if (ff.provider_merchant_id !== actor_id) throw new Error('UNAUTHORIZED');
        if (ff.provider_status !== 'pending') throw new Error('INVALID_STATUS');

        await client.query(
          `UPDATE corridor_fulfillments
           SET provider_status = 'payment_sent', payment_sent_at = NOW(), updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id]
        );

        // Notify order parties that LP sent payment
        await client.query(
          `INSERT INTO notification_outbox
           (order_id, event_type, merchant_id, payload)
           VALUES ($1, 'CORRIDOR_PAYMENT_SENT', $2, $3)`,
          [ff.order_id, ff.provider_merchant_id, JSON.stringify({ fulfillment_id: id })]
        );

        logger.info('[Corridor] LP marked payment sent', {
          fulfillmentId: id, orderId: ff.order_id, lpMerchantId: actor_id,
        });

        return { id, provider_status: 'payment_sent' };
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === 'NOT_FOUND') return reply.status(404).send({ success: false, error: 'Fulfillment not found' });
      if (msg === 'UNAUTHORIZED') return reply.status(403).send({ success: false, error: 'Not your fulfillment' });
      if (msg === 'INVALID_STATUS') return reply.status(400).send({ success: false, error: 'Fulfillment not in pending status' });
      fastify.log.error({ error, id }, 'Corridor fulfillment update failed');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // GET /v1/corridor/fulfillments — LP's active assignments
  fastify.get<{
    Querystring: { provider_merchant_id: string };
  }>('/corridor/fulfillments', async (request, reply) => {
    const { provider_merchant_id } = request.query;
    if (!provider_merchant_id) {
      return reply.status(400).send({ success: false, error: 'provider_merchant_id required' });
    }

    try {
      const rows = await transaction(async (client: PgClient) => {
        const result = await client.query(
          `SELECT cf.*, o.order_number, o.crypto_amount, o.fiat_currency,
                  m.display_name as seller_name
           FROM corridor_fulfillments cf
           JOIN orders o ON cf.order_id = o.id
           JOIN merchants m ON o.merchant_id = m.id
           WHERE cf.provider_merchant_id = $1
             AND cf.provider_status IN ('pending', 'payment_sent')
           ORDER BY cf.assigned_at DESC`,
          [provider_merchant_id]
        );
        return result.rows;
      });

      return reply.status(200).send({ success: true, data: rows });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch corridor fulfillments');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // GET /v1/corridor/providers — Get provider config for a merchant
  fastify.get<{
    Querystring: { merchant_id: string };
  }>('/corridor/providers', async (request, reply) => {
    const { merchant_id } = request.query;
    if (!merchant_id) {
      return reply.status(400).send({ success: false, error: 'merchant_id required' });
    }

    try {
      const rows = await transaction(async (client: PgClient) => {
        const result = await client.query(
          'SELECT * FROM corridor_providers WHERE merchant_id = $1',
          [merchant_id]
        );
        return result.rows;
      });

      return reply.status(200).send({ success: true, data: rows[0] || null });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch corridor provider');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // POST /v1/corridor/providers — Register/update as LP
  fastify.post<{
    Body: {
      merchant_id: string;
      is_active: boolean;
      fee_percentage: number;
      min_amount: number;
      max_amount: number;
      auto_accept?: boolean;
    };
  }>('/corridor/providers', async (request, reply) => {
    const { merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept } = request.body;

    if (!merchant_id || fee_percentage == null || !min_amount || !max_amount) {
      return reply.status(400).send({ success: false, error: 'Missing required fields' });
    }

    if (fee_percentage < 0 || fee_percentage > 10) {
      return reply.status(400).send({ success: false, error: 'Fee must be 0-10%' });
    }

    try {
      const result = await transaction(async (client: PgClient) => {
        const row = await client.query(
          `INSERT INTO corridor_providers (merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (merchant_id) DO UPDATE SET
             is_active = $2, fee_percentage = $3, min_amount = $4, max_amount = $5,
             auto_accept = $6, updated_at = NOW()
           RETURNING *`,
          [merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept ?? true]
        );
        return row.rows[0];
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to upsert corridor provider');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // GET /v1/corridor/availability — Check if LP available for amount
  fastify.get<{
    Querystring: { fiat_amount: string; exclude?: string };
  }>('/corridor/availability', async (request, reply) => {
    const fiatAmount = parseFloat(request.query.fiat_amount);
    const excludeIds = request.query.exclude ? request.query.exclude.split(',') : [];

    if (!fiatAmount || fiatAmount <= 0) {
      return reply.status(400).send({ success: false, error: 'Valid fiat_amount required' });
    }

    try {
      const result = await transaction(async (client: PgClient) => {
        const row = await client.query(
          `SELECT COUNT(*) as cnt, MIN(cp.fee_percentage) as min_fee
           FROM corridor_providers cp
           JOIN merchants m ON cp.merchant_id = m.id
           WHERE cp.is_active = true
             AND m.is_online = true
             AND m.status = 'active'
             AND cp.min_amount <= $1
             AND cp.max_amount >= $1
             AND ($2::uuid[] IS NULL OR cp.merchant_id != ALL($2::uuid[]))
             AND (cp.available_hours_start IS NULL
                  OR CURRENT_TIME BETWEEN cp.available_hours_start AND cp.available_hours_end)`,
          [fiatAmount, excludeIds.length > 0 ? excludeIds : null]
        );
        const cnt = parseInt(String(row.rows[0].cnt));
        return {
          available: cnt > 0,
          cheapest_fee: row.rows[0].min_fee ? parseFloat(String(row.rows[0].min_fee)) : null,
          provider_count: cnt,
        };
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check corridor availability');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
};
