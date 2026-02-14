import { query, queryOne } from '../index';

export interface MempoolOrder {
  id: string;
  order_number: string;
  corridor_id: string;
  side: string;
  amount_usdt: number;
  ref_price_at_create: number;
  premium_bps_current: number;
  premium_bps_cap: number;
  bump_step_bps: number;
  auto_bump_enabled: boolean;
  next_bump_at: string | null;
  current_offer_price: number;
  max_offer_price: number;
  expires_at: string;
  seconds_until_expiry: number;
  user_id: string;
  creator_merchant_id: string | null;
  creator_username: string | null;
  created_at: string;
  status: string;
}

export interface CorridorPrice {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  avg_fill_time_sec: number;
  active_merchants_count: number;
  updated_at: string;
  created_at: string;
}

export interface MerchantQuote {
  id: string;
  merchant_id: string;
  corridor_id: string;
  min_price_aed_per_usdt: number;
  min_size_usdt: number;
  max_size_usdt: number;
  sla_minutes: number;
  available_liquidity_usdt: number;
  is_online: boolean;
  updated_at: string;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  event_type: string;
  payload: any;
  created_at: string;
}

// Get mempool orders with optional filters
export async function getMempoolOrders(filters?: {
  corridor_id?: string;
  min_premium_bps?: number;
  max_premium_bps?: number;
  min_amount?: number;
  max_amount?: number;
  limit?: number;
  offset?: number;
}): Promise<MempoolOrder[]> {
  const {
    corridor_id,
    min_premium_bps,
    max_premium_bps,
    min_amount,
    max_amount,
    limit = 50,
    offset = 0
  } = filters || {};

  let sql = 'SELECT * FROM v_mempool_orders WHERE 1=1';
  const params: any[] = [];
  let paramCount = 0;

  if (corridor_id) {
    paramCount++;
    sql += ` AND corridor_id = $${paramCount}`;
    params.push(corridor_id);
  }

  if (min_premium_bps !== undefined) {
    paramCount++;
    sql += ` AND premium_bps_current >= $${paramCount}`;
    params.push(min_premium_bps);
  }

  if (max_premium_bps !== undefined) {
    paramCount++;
    sql += ` AND premium_bps_current <= $${paramCount}`;
    params.push(max_premium_bps);
  }

  if (min_amount !== undefined) {
    paramCount++;
    sql += ` AND amount_usdt >= $${paramCount}`;
    params.push(min_amount);
  }

  if (max_amount !== undefined) {
    paramCount++;
    sql += ` AND amount_usdt <= $${paramCount}`;
    params.push(max_amount);
  }

  paramCount++;
  sql += ` LIMIT $${paramCount}`;
  params.push(limit);

  paramCount++;
  sql += ` OFFSET $${paramCount}`;
  params.push(offset);

  return query<MempoolOrder>(sql, params);
}

// Get mineable orders for a specific merchant
export async function getMineableOrdersForMerchant(
  merchantId: string,
  corridorId: string = 'USDT_AED'
): Promise<MempoolOrder[]> {
  return query<MempoolOrder>(
    `SELECT o.* FROM v_mempool_orders o
     WHERE o.corridor_id = $1
       AND is_order_mineable(o.id, $2) = TRUE
     ORDER BY o.premium_bps_current DESC, o.created_at ASC`,
    [corridorId, merchantId]
  );
}

// Bump order priority (manual or auto)
export async function bumpOrderPriority(
  orderId: string,
  isAuto: boolean = false
): Promise<{ success: boolean; new_premium_bps: number; max_reached: boolean }> {
  const order = await queryOne<{
    premium_bps_current: number;
    premium_bps_cap: number;
    bump_step_bps: number;
    bump_interval_sec: number;
    next_bump_at: string | null;
    status: string;
  }>(
    `SELECT premium_bps_current, premium_bps_cap, bump_step_bps, bump_interval_sec, next_bump_at, status
     FROM orders WHERE id = $1`,
    [orderId]
  );

  if (!order) {
    throw new Error('Order not found');
  }

  if (order.status !== 'pending') {
    throw new Error('Order is not pending');
  }

  const newPremium = Math.min(
    order.premium_bps_current + order.bump_step_bps,
    order.premium_bps_cap
  );

  const maxReached = newPremium >= order.premium_bps_cap;

  // Calculate next bump time
  const nextBumpAt = !maxReached
    ? new Date(Date.now() + order.bump_interval_sec * 1000).toISOString()
    : null;

  await query(
    `UPDATE orders
     SET premium_bps_current = $1,
         next_bump_at = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [newPremium, nextBumpAt, orderId]
  );

  // Log event
  await logOrderEvent(orderId, isAuto ? 'AUTO_BUMP' : 'MANUAL_BUMP', {
    old_premium_bps: order.premium_bps_current,
    new_premium_bps: newPremium,
    max_reached: maxReached,
  });

  return { success: true, new_premium_bps: newPremium, max_reached: maxReached };
}

// Accept order (atomic with optimistic locking)
export async function acceptOrder(
  orderId: string,
  merchantId: string
): Promise<{ success: boolean; message: string }> {
  const { transaction } = await import('../index');

  try {
    return await transaction(async (client) => {
      // Lock order and check if still mineable
      const orderResult = await client.query(
        `SELECT id, status, expires_at, corridor_id, crypto_amount,
                ref_price_at_create, premium_bps_current, winner_merchant_id
         FROM orders
         WHERE id = $1
         FOR UPDATE NOWAIT`,
        [orderId]
      );

      const order = orderResult.rows[0];

      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }

      if (order.status !== 'pending') {
        throw new Error('ORDER_NOT_PENDING');
      }

      if (new Date(order.expires_at) <= new Date()) {
        throw new Error('ORDER_EXPIRED');
      }

      if (order.winner_merchant_id) {
        throw new Error('ORDER_ALREADY_ACCEPTED');
      }

      // Check if merchant can mine this order
      const canMineResult = await client.query(
        `SELECT is_order_mineable($1, $2) as can_mine`,
        [orderId, merchantId]
      );

      if (!canMineResult.rows[0]?.can_mine) {
        throw new Error('ORDER_NOT_MINEABLE');
      }

      // Reserve liquidity in merchant quote
      await client.query(
        `UPDATE merchant_quotes
         SET available_liquidity_usdt = available_liquidity_usdt - $1
         WHERE merchant_id = $2 AND corridor_id = $3`,
        [order.crypto_amount, merchantId, order.corridor_id]
      );

      // Assign winner merchant
      await client.query(
        `UPDATE orders
         SET winner_merchant_id = $1,
             merchant_id = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [merchantId, orderId]
      );

      // Log event
      await client.query(
        `INSERT INTO order_events (order_id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [
          orderId,
          'ORDER_ACCEPTED',
          JSON.stringify({
            merchant_id: merchantId,
            premium_bps: order.premium_bps_current,
            offer_price: order.ref_price_at_create * (1 + order.premium_bps_current / 10000),
          }),
        ]
      );

      return { success: true, message: 'Order accepted successfully' };
    });
  } catch (error: any) {
    if (error.code === '55P03') {
      return { success: false, message: 'Order is being processed by another merchant' };
    }

    // Handle custom error messages
    const errorMessages: Record<string, string> = {
      ORDER_NOT_FOUND: 'Order not found',
      ORDER_NOT_PENDING: 'Order already filled or cancelled',
      ORDER_EXPIRED: 'Order expired',
      ORDER_ALREADY_ACCEPTED: 'Order already accepted by another merchant',
      ORDER_NOT_MINEABLE: 'Order does not meet your quote requirements',
    };

    const message = errorMessages[error.message] || error.message;
    return { success: false, message };
  }
}

// Update corridor reference price
export async function updateCorridorRefPrice(
  corridorId: string,
  refPrice: number,
  volume5m?: number,
  avgFillTimeSec?: number,
  activeMerchantsCount?: number
): Promise<void> {
  await query(
    `UPDATE corridor_prices
     SET ref_price = $2,
         volume_5m = COALESCE($3, volume_5m),
         avg_fill_time_sec = COALESCE($4, avg_fill_time_sec),
         active_merchants_count = COALESCE($5, active_merchants_count),
         updated_at = NOW()
     WHERE corridor_id = $1`,
    [corridorId, refPrice, volume5m, avgFillTimeSec, activeMerchantsCount]
  );
}

// Get corridor price
export async function getCorridorPrice(corridorId: string): Promise<CorridorPrice | null> {
  return queryOne<CorridorPrice>(
    `SELECT * FROM corridor_prices WHERE corridor_id = $1`,
    [corridorId]
  );
}

// Upsert merchant quote
export async function upsertMerchantQuote(data: {
  merchant_id: string;
  corridor_id: string;
  min_price_aed_per_usdt: number;
  min_size_usdt: number;
  max_size_usdt: number;
  sla_minutes: number;
  available_liquidity_usdt: number;
  is_online: boolean;
}): Promise<MerchantQuote> {
  const result = await queryOne<MerchantQuote>(
    `INSERT INTO merchant_quotes
      (merchant_id, corridor_id, min_price_aed_per_usdt, min_size_usdt,
       max_size_usdt, sla_minutes, available_liquidity_usdt, is_online)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (merchant_id, corridor_id)
     DO UPDATE SET
       min_price_aed_per_usdt = EXCLUDED.min_price_aed_per_usdt,
       min_size_usdt = EXCLUDED.min_size_usdt,
       max_size_usdt = EXCLUDED.max_size_usdt,
       sla_minutes = EXCLUDED.sla_minutes,
       available_liquidity_usdt = EXCLUDED.available_liquidity_usdt,
       is_online = EXCLUDED.is_online,
       updated_at = NOW()
     RETURNING *`,
    [
      data.merchant_id,
      data.corridor_id,
      data.min_price_aed_per_usdt,
      data.min_size_usdt,
      data.max_size_usdt,
      data.sla_minutes,
      data.available_liquidity_usdt,
      data.is_online,
    ]
  );
  return result!;
}

// Get merchant quote
export async function getMerchantQuote(
  merchantId: string,
  corridorId: string = 'USDT_AED'
): Promise<MerchantQuote | null> {
  return queryOne<MerchantQuote>(
    `SELECT * FROM merchant_quotes WHERE merchant_id = $1 AND corridor_id = $2`,
    [merchantId, corridorId]
  );
}

// Get all active merchant quotes for a corridor
export async function getActiveMerchantQuotes(
  corridorId: string = 'USDT_AED'
): Promise<MerchantQuote[]> {
  return query<MerchantQuote>(
    `SELECT * FROM merchant_quotes
     WHERE corridor_id = $1 AND is_online = TRUE
     ORDER BY min_price_aed_per_usdt ASC`,
    [corridorId]
  );
}

// Log order event
export async function logOrderEvent(
  orderId: string,
  eventType: string,
  payload: any
): Promise<void> {
  await query(
    `INSERT INTO order_events (order_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [orderId, eventType, JSON.stringify(payload)]
  );
}

// Get order events
export async function getOrderEvents(
  orderId: string,
  limit: number = 50
): Promise<OrderEvent[]> {
  return query<OrderEvent>(
    `SELECT * FROM order_events
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [orderId, limit]
  );
}

// Get orders ready for auto-bump
export async function getOrdersReadyForAutoBump(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM orders
     WHERE auto_bump_enabled = TRUE
       AND status = 'pending'
       AND next_bump_at IS NOT NULL
       AND next_bump_at <= NOW()
       AND premium_bps_current < premium_bps_cap`,
    []
  );
  return result.map((r) => r.id);
}

// Calculate reference price from recent completed trades (trimmed median)
export async function calculateRefPriceFromTrades(
  corridorId: string,
  lookbackMinutes: number = 5
): Promise<number | null> {
  const result = await queryOne<{ ref_price: number }>(
    `WITH recent_trades AS (
      SELECT
        (fiat_amount / crypto_amount) as price
      FROM orders
      WHERE corridor_id = $1
        AND status = 'completed'
        AND completed_at > NOW() - INTERVAL '1 minute' * $2
        AND crypto_amount > 0
      ORDER BY completed_at DESC
      LIMIT 100
    ),
    trimmed AS (
      SELECT price
      FROM recent_trades
      ORDER BY price
      OFFSET (SELECT COUNT(*) * 0.1 FROM recent_trades)
      LIMIT (SELECT COUNT(*) * 0.8 FROM recent_trades)
    )
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) as ref_price
    FROM trimmed`,
    [corridorId, lookbackMinutes]
  );

  return result?.ref_price || null;
}
