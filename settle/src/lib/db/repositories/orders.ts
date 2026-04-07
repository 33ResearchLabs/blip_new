import { query, queryOne, transaction } from '../index';
import {
  Order,
  OrderWithRelations,
  OrderEvent,
  ChatMessage,
  OrderStatus,
  ActorType,
  OfferType,
  PaymentMethod,
} from '../../types/database';
import { updateOfferAvailability, restoreOfferAvailability } from './merchants';
import { incrementUserStats } from './users';
import {
  validateTransition,
  shouldRestoreLiquidity,
  getTransitionEventType,
  isTerminalStatus,
} from '../../orders/stateMachineMinimal';
import {
  normalizeStatus,
  validateStatusWrite,
  isTransientStatus,
} from '../../orders/statusNormalizer';
import { logger } from '../../logger';
import { notifyNewMessage, notifyOrderStatusUpdated } from '../../pusher/server';
import { recordReputationEvent } from '../../reputation';
import { upsertMerchantContact } from './directMessages';
import { getCachedOrder, getCachedOrderFull, updateOrderCache, invalidateOrderCache } from '@/lib/cache';

// Result type for status updates
export interface StatusUpdateResult {
  success: boolean;
  order?: Order;
  error?: string;
}

// Orders
export async function getOrderById(id: string): Promise<Order | null> {
  return getCachedOrder<Order>(id, (orderId) =>
    queryOne<Order>('SELECT * FROM orders WHERE id = $1', [orderId])
  );
}

export async function getOrderByNumber(orderNumber: string): Promise<Order | null> {
  return queryOne<Order>('SELECT * FROM orders WHERE order_number = $1', [orderNumber]);
}

export async function getOrderWithRelations(id: string): Promise<OrderWithRelations | null> {
  return getCachedOrderFull<OrderWithRelations>(id, (_id) => queryOne<OrderWithRelations>(
    `SELECT o.*,
            json_build_object(
              'id', u.id,
              'name', CASE WHEN u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%' THEN m.display_name ELSE COALESCE(u.name, u.username) END,
              'username', u.username,
              'wallet_address', u.wallet_address,
              'rating', u.rating,
              'total_trades', u.total_trades
            ) as user,
            json_build_object(
              'id', m.id,
              'display_name', m.display_name,
              'business_name', m.business_name,
              'rating', m.rating,
              'total_trades', m.total_trades,
              'is_online', m.is_online,
              'wallet_address', m.wallet_address
            ) as merchant,
            CASE
              WHEN bm.id IS NOT NULL THEN json_build_object(
                'id', bm.id,
                'display_name', bm.display_name,
                'business_name', bm.business_name,
                'rating', bm.rating,
                'total_trades', bm.total_trades,
                'is_online', bm.is_online,
                'wallet_address', bm.wallet_address
              )
              ELSE NULL
            END as buyer_merchant,
            json_build_object(
              'id', mo.id,
              'type', mo.type,
              'payment_method', mo.payment_method,
              'rate', mo.rate,
              'bank_name', mo.bank_name,
              'bank_account_name', mo.bank_account_name,
              'bank_iban', mo.bank_iban,
              'location_name', mo.location_name,
              'location_address', mo.location_address,
              'location_lat', mo.location_lat,
              'location_lng', mo.location_lng,
              'meeting_instructions', mo.meeting_instructions
            ) as offer,
            CASE
              WHEN upm.id IS NOT NULL THEN json_build_object(
                'id', upm.id,
                'type', upm.type,
                'label', upm.label,
                'details', upm.details
              )
              ELSE NULL
            END as locked_payment_method,
            CASE
              WHEN mpm.id IS NOT NULL THEN json_build_object(
                'id', mpm.id,
                'type', mpm.type,
                'name', mpm.name,
                'details', mpm.details,
                'is_default', mpm.is_default
              )
              ELSE NULL
            END as merchant_payment_method
     FROM orders o
     LEFT JOIN users u ON o.user_id = u.id
     LEFT JOIN merchants m ON o.merchant_id = m.id
     LEFT JOIN merchant_offers mo ON o.offer_id = mo.id
     LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
     LEFT JOIN user_payment_methods upm ON o.payment_method_id = upm.id
     LEFT JOIN merchant_payment_methods mpm ON o.merchant_payment_method_id = mpm.id
     WHERE o.id = $1`,
    [_id]
  ));
}

export async function getUserOrders(
  userId: string,
  status?: OrderStatus[],
  days?: number
): Promise<OrderWithRelations[]> {
  let sql = `
    SELECT o.*,
           json_build_object(
             'id', m.id,
             'display_name', m.display_name,
             'rating', m.rating,
             'total_trades', m.total_trades,
             'wallet_address', m.wallet_address,
             'is_online', m.is_online,
             'last_seen_at', m.last_seen_at
           ) as merchant,
           json_build_object(
             'payment_method', mo.payment_method,
             'location_name', mo.location_name,
             'bank_name', mo.bank_name,
             'bank_iban', mo.bank_iban,
             'bank_account_name', mo.bank_account_name,
             'location_address', mo.location_address,
             'location_lat', mo.location_lat,
             'location_lng', mo.location_lng,
             'meeting_instructions', mo.meeting_instructions
           ) as offer,
           CASE
             WHEN upm.id IS NOT NULL THEN json_build_object(
               'id', upm.id,
               'type', upm.type,
               'label', upm.label,
               'details', upm.details
             )
             ELSE NULL
           END as locked_payment_method,
           CASE
             WHEN mpm.id IS NOT NULL THEN json_build_object(
               'id', mpm.id,
               'type', mpm.type,
               'name', mpm.name,
               'details', mpm.details,
               'is_default', mpm.is_default
             )
             ELSE NULL
           END as merchant_payment_method,
           COALESCE(chat_agg.unread_count, 0) as unread_count,
           chat_latest.last_message
    FROM orders o
    LEFT JOIN merchants m ON o.merchant_id = m.id
    LEFT JOIN merchant_offers mo ON o.offer_id = mo.id
    LEFT JOIN user_payment_methods upm ON o.payment_method_id = upm.id
    LEFT JOIN merchant_payment_methods mpm ON o.merchant_payment_method_id = mpm.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE cm.sender_type IN ('merchant', 'compliance') AND cm.message_type != 'system' AND cm.is_read = false)::int as unread_count
      FROM chat_messages cm WHERE cm.order_id = o.id
    ) chat_agg ON true
    LEFT JOIN LATERAL (
      SELECT json_build_object('content', cm.content, 'sender_type', cm.sender_type, 'created_at', cm.created_at) as last_message
      FROM chat_messages cm
      WHERE cm.order_id = o.id AND cm.message_type != 'system' AND cm.sender_type != 'system'
      ORDER BY cm.created_at DESC LIMIT 1
    ) chat_latest ON true
    WHERE o.user_id = $1
  `;

  const params: unknown[] = [userId];

  if (status && status.length > 0) {
    sql += ` AND o.status = ANY($${params.length + 1})`;
    params.push(status);
  }

  if (days && days > 0) {
    sql += ` AND o.created_at >= NOW() - INTERVAL '${Math.floor(days)} days'`;
  }

  sql += ' ORDER BY o.created_at DESC';

  return query<OrderWithRelations>(sql, params);
}

export async function getMerchantOrders(
  merchantId: string,
  status?: OrderStatus[]
): Promise<OrderWithRelations[]> {
  // Query orders where merchant is the seller
  // Note: buyer_merchant_id for M2M trades requires migration 007
  let sql = `
    SELECT o.*,
           -- my_role: authoritative buyer/seller/observer
           CASE
             WHEN o.buyer_merchant_id = $1 THEN 'buyer'
             WHEN o.merchant_id = $1 AND o.buyer_merchant_id IS NOT NULL AND o.buyer_merchant_id != $1 THEN 'seller'
             WHEN o.merchant_id = $1 AND o.escrow_debited_entity_type = 'merchant' AND o.escrow_debited_entity_id::TEXT = $1::TEXT THEN 'seller'
             WHEN o.merchant_id = $1 AND o.type = 'buy' THEN 'seller'
             WHEN o.merchant_id = $1 AND o.type = 'sell' AND (u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%') THEN 'seller'
             WHEN o.merchant_id = $1 AND o.type = 'sell' THEN 'buyer'
             ELSE 'observer'
           END as my_role,
           json_build_object(
             'id', u.id,
             'name', CASE
               WHEN u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%' THEN
                 CASE
                   WHEN o.buyer_merchant_id IS NOT NULL AND o.buyer_merchant_id != o.merchant_id THEN COALESCE(bm.display_name, m.display_name)
                   ELSE m.display_name
                 END
               ELSE COALESCE(u.name, u.username)
             END,
             'username', u.username,
             'rating', u.rating,
             'total_trades', u.total_trades
           ) as user,
           json_build_object(
             'payment_method', mo.payment_method,
             'location_name', mo.location_name
           ) as offer,
           CASE
             WHEN upm.id IS NOT NULL THEN json_build_object(
               'id', upm.id,
               'type', upm.type,
               'label', upm.label,
               'details', upm.details
             )
             ELSE NULL
           END as locked_payment_method,
           CASE
             WHEN mpm.id IS NOT NULL THEN json_build_object(
               'id', mpm.id,
               'type', mpm.type,
               'name', mpm.name,
               'details', mpm.details,
               'is_default', mpm.is_default
             )
             ELSE NULL
           END as merchant_payment_method
    FROM orders o
    JOIN users u ON o.user_id = u.id
    LEFT JOIN merchants m ON o.merchant_id = m.id
    LEFT JOIN merchant_offers mo ON o.offer_id = mo.id
    LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
    LEFT JOIN user_payment_methods upm ON o.payment_method_id = upm.id
    LEFT JOIN merchant_payment_methods mpm ON o.merchant_payment_method_id = mpm.id
    WHERE (o.merchant_id = $1 OR o.buyer_merchant_id = $1)
      AND o.status NOT IN ('expired', 'cancelled')
  `;

  const params: unknown[] = [merchantId];

  if (status && status.length > 0) {
    sql += ` AND o.status = ANY($2)`;
    params.push(status);
  }

  sql += ' ORDER BY o.created_at DESC';

  console.log('[DB] getMerchantOrders for merchant:', merchantId);
  const results = await query<OrderWithRelations>(sql, params);
  console.log('[DB] getMerchantOrders found:', results?.length || 0, 'orders');

  return results;
}

/**
 * Get orders for merchant dashboard (broadcast model):
 *
 * NEW ORDERS (is_my_order = false):
 * - ALL pending orders (buy orders awaiting merchant acceptance)
 * - ALL escrowed orders (sell orders where user locked escrow, awaiting merchant acceptance)
 *
 * ACTIVE/ONGOING (is_my_order = true after acceptance):
 * - Orders where I'm merchant_id AND accepted_at IS NOT NULL
 * - Orders where I'm buyer_merchant (M2M orders I initiated)
 *
 * Key insight: Both buy AND sell orders appear in "New Orders" for ALL merchants.
 * is_my_order is ONLY true after a merchant accepts the order.
 */
export async function getAllPendingOrdersForMerchant(
  merchantId: string,
  status?: OrderStatus[]
): Promise<OrderWithRelations[]> {
  // is_my_order logic:
  // - For pending/escrowed orders: true if I created it (buyer_merchant_id OR escrow_creator_wallet matches my wallet)
  // - For accepted+ orders: true if I'm the merchant who accepted OR I'm the buyer_merchant (M2M)
  // This ensures merchant-initiated sell orders with escrow show in "Ongoing" for the creator
  let sql = `
    SELECT o.*,
           -- my_role: authoritative buyer/seller/observer determination
           -- Rules: buyer_merchant_id=BUYER, merchant_id=SELLER (after acceptance)
           -- For non-M2M: type='buy' → merchant=seller, type='sell' → merchant=buyer
           CASE
             WHEN o.buyer_merchant_id = $1 THEN 'buyer'
             WHEN o.merchant_id = $1 AND o.buyer_merchant_id IS NOT NULL AND o.buyer_merchant_id != $1 THEN 'seller'
             WHEN o.merchant_id = $1 AND o.escrow_debited_entity_type = 'merchant' AND o.escrow_debited_entity_id::TEXT = $1::TEXT THEN 'seller'
             WHEN o.merchant_id = $1 AND o.type = 'buy' THEN 'seller'
             WHEN o.merchant_id = $1 AND o.type = 'sell' AND (u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%') THEN 'seller'
             WHEN o.merchant_id = $1 AND o.type = 'sell' THEN 'buyer'
             ELSE 'observer'
           END as my_role,
           -- is_my_order: true if I'm buyer or seller (not observer)
           -- Fallback chain ensures no order assigned to me is ever missed
           CASE
             WHEN o.buyer_merchant_id = $1 THEN true
             WHEN o.merchant_id = $1 AND o.accepted_at IS NOT NULL THEN true
             WHEN o.merchant_id = $1 AND (u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%') THEN true
             WHEN o.escrow_creator_wallet IS NOT NULL AND LOWER(o.escrow_creator_wallet) = LOWER(current_m.wallet_address) THEN true
             ELSE false
           END as is_my_order,
           json_build_object(
             'id', u.id,
             'name', CASE
               WHEN u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%' THEN
                 CASE
                   WHEN o.buyer_merchant_id IS NOT NULL AND o.buyer_merchant_id != o.merchant_id THEN COALESCE(bm.display_name, m.display_name)
                   ELSE m.display_name
                 END
               ELSE COALESCE(u.name, u.username)
             END,
             'username', u.username,
             'rating', u.rating,
             'total_trades', u.total_trades,
             'wallet_address', u.wallet_address
           ) as user,
           json_build_object(
             'id', m.id,
             'display_name', m.display_name,
             'username', m.username,
             'rating', m.rating,
             'wallet_address', m.wallet_address
           ) as merchant,
           json_build_object(
             'payment_method', mo.payment_method,
             'location_name', mo.location_name,
             'rate', mo.rate
           ) as offer,
           CASE WHEN bm.id IS NOT NULL THEN
             json_build_object(
               'id', bm.id,
               'display_name', bm.display_name,
               'wallet_address', bm.wallet_address
             )
           ELSE NULL END as buyer_merchant,
           CASE WHEN seller_offer.id IS NOT NULL THEN
             json_build_object(
               'bank_name', seller_offer.bank_name,
               'bank_account_name', seller_offer.bank_account_name,
               'bank_iban', seller_offer.bank_iban
             )
           ELSE NULL END as seller_bank,
           CASE
             WHEN upm.id IS NOT NULL THEN json_build_object(
               'id', upm.id,
               'type', upm.type,
               'label', upm.label,
               'details', upm.details
             )
             ELSE NULL
           END as locked_payment_method,
           CASE
             WHEN mpm.id IS NOT NULL THEN json_build_object(
               'id', mpm.id,
               'type', mpm.type,
               'name', mpm.name,
               'details', mpm.details,
               'is_default', mpm.is_default
             )
             ELSE NULL
           END as merchant_payment_method,
           COALESCE(chat_agg.unread_count, 0) as unread_count,
           COALESCE(chat_agg.message_count, 0) as message_count,
           chat_latest.content as last_human_message,
           chat_latest.sender_type as last_human_message_sender
    FROM orders o
    JOIN users u ON o.user_id = u.id
    LEFT JOIN merchants m ON o.merchant_id = m.id
    LEFT JOIN merchant_offers mo ON o.offer_id = mo.id
    LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
    LEFT JOIN merchants current_m ON current_m.id = $1
    LEFT JOIN user_payment_methods upm ON o.payment_method_id = upm.id
    LEFT JOIN merchant_payment_methods mpm ON o.merchant_payment_method_id = mpm.id
    LEFT JOIN LATERAL (
      SELECT smo.id, smo.bank_name, smo.bank_account_name, smo.bank_iban
      FROM merchant_offers smo
      WHERE smo.merchant_id = o.merchant_id AND smo.is_active = true AND smo.payment_method = 'bank'
      ORDER BY smo.created_at DESC LIMIT 1
    ) seller_offer ON o.buyer_merchant_id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE cm.sender_type != 'merchant' AND cm.sender_type != 'system' AND cm.message_type != 'system' AND cm.is_read = false)::int as unread_count,
        COUNT(*) FILTER (WHERE cm.message_type != 'system')::int as message_count
      FROM chat_messages cm WHERE cm.order_id = o.id
    ) chat_agg ON true
    LEFT JOIN LATERAL (
      SELECT cm.content, cm.sender_type
      FROM chat_messages cm
      WHERE cm.order_id = o.id AND cm.message_type != 'system' AND cm.sender_type != 'system'
      ORDER BY cm.created_at DESC LIMIT 1
    ) chat_latest ON true
    WHERE (
        -- OPEN orders: broadcast pending/escrowed that are NOT yet taken by another merchant
        (o.status IN ('pending', 'escrowed')
         AND (o.buyer_merchant_id IS NULL
              OR o.buyer_merchant_id = $1
              OR (o.buyer_merchant_id = o.merchant_id AND o.accepted_at IS NULL))
         AND o.accepted_at IS NULL
        )

        -- Unclaimed sell orders (merchant_id IS NULL, broadcast to all merchants)
        OR (o.merchant_id IS NULL AND o.status IN ('pending', 'escrowed') AND o.accepted_at IS NULL)

        -- All orders where I'm the assigned merchant
        OR (o.merchant_id = $1)

        -- Orders I created as buyer_merchant (M2M orders I initiated)
        OR (o.buyer_merchant_id = $1)
      )
  `;

  const params: unknown[] = [merchantId];

  if (status && status.length > 0) {
    sql += ` AND o.status = ANY($2)`;
    params.push(status);
  }

  sql += ' ORDER BY o.created_at DESC LIMIT 200';

  console.log('[DB] getAllPendingOrdersForMerchant for merchant:', merchantId);
  const results = await query<OrderWithRelations>(sql, params);
  console.log('[DB] getAllPendingOrdersForMerchant found:', results?.length || 0, 'orders');

  return results;
}

export async function createOrder(data: {
  user_id: string;
  merchant_id: string;
  offer_id: string;
  type: OfferType;
  payment_method: PaymentMethod;
  crypto_amount: number;
  fiat_amount: number;
  rate: number;
  payment_details?: Record<string, unknown>;
  buyer_wallet_address?: string; // Buyer's Solana wallet for receiving crypto (buy orders)
  buyer_merchant_id?: string; // For M2M trading: the merchant acting as buyer
  // Optional escrow details (for escrow-first sell orders)
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  spread_preference?: string;
  protocol_fee_percentage?: number;
  protocol_fee_amount?: number;
}): Promise<Order> {
  return transaction(async (client) => {
    console.log('[DB] createOrder called with:', {
      user_id: data.user_id,
      merchant_id: data.merchant_id,
      offer_id: data.offer_id,
      type: data.type,
      crypto_amount: data.crypto_amount,
      hasEscrow: !!data.escrow_tx_hash,
    });

    // ── Enforce order type flow rules ─────────────────────────────────
    // SELL orders MUST have escrow locked at creation (escrow-first model)
    // BUY orders start as 'pending' and go through accept → escrow → payment
    if (data.type === 'sell' && !data.escrow_tx_hash) {
      throw new Error('SELL orders require escrow at creation. Provide escrow_tx_hash.');
    }
    if (data.type === 'buy' && data.escrow_tx_hash) {
      // BUY orders should not have escrow at creation (escrow comes after acceptance)
      logger.warn('[CreateOrder] BUY order created with escrow_tx_hash — this is unusual but allowed for backwards compatibility');
    }

    // Determine initial status: 'escrowed' for SELL, 'pending' for BUY
    const initialStatus = data.escrow_tx_hash ? 'escrowed' : 'pending';
    const expiresMinutes = data.escrow_tx_hash ? 120 : 15;

    // FIX #1+#2: When escrow is pre-locked at creation (sell orders),
    // record escrow_debited fields AND deduct balance INSIDE this transaction.
    let escrowDebitedEntityType: 'merchant' | 'user' | null = null;
    let escrowDebitedEntityId: string | null = null;
    let escrowDebitedAmount: number | null = null;

    if (data.escrow_tx_hash) {
      const { determineEscrowPayer } = await import('@/lib/money/escrowLock');
      const payer = determineEscrowPayer({
        type: data.type,
        merchant_id: data.merchant_id,
        user_id: data.user_id,
        buyer_merchant_id: data.buyer_merchant_id ?? null,
      });
      escrowDebitedEntityType = payer.entityType;
      escrowDebitedEntityId = payer.entityId;
      escrowDebitedAmount = data.crypto_amount;

      // Deduct balance atomically inside this transaction (prevents race conditions)
      const balanceResult = await client.query(
        `SELECT balance FROM ${payer.table} WHERE id = $1 FOR UPDATE`,
        [payer.entityId]
      );
      if (balanceResult.rows.length === 0) {
        throw new Error('Escrow payer entity not found');
      }
      const currentBalance = parseFloat(String(balanceResult.rows[0].balance));
      if (currentBalance < data.crypto_amount) {
        throw new Error('Insufficient balance to lock escrow');
      }
      await client.query(
        `UPDATE ${payer.table} SET balance = balance - $1 WHERE id = $2`,
        [data.crypto_amount, payer.entityId]
      );

      logger.info('[CreateOrder] Pre-locked escrow balance deducted atomically', {
        payer: payer.entityType,
        payerId: payer.entityId,
        amount: data.crypto_amount,
        balanceBefore: currentBalance,
        balanceAfter: currentBalance - data.crypto_amount,
      });
    }

    // Create the order
    const result = await client.query(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, rate, payment_details,
         status, expires_at, buyer_wallet_address, buyer_merchant_id,
         escrow_tx_hash, escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet, escrowed_at,
         escrow_debited_entity_type, escrow_debited_entity_id, escrow_debited_amount, escrow_debited_at,
         spread_preference, protocol_fee_percentage, protocol_fee_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + ($11 || ' minutes')::INTERVAL, $12::TEXT, $13::UUID,
               $14::TEXT, $15::BIGINT, $16::TEXT, $17::TEXT, $18::TEXT, CASE WHEN $14 IS NOT NULL THEN NOW() ELSE NULL END,
               $19, $20, $21, CASE WHEN $14 IS NOT NULL THEN NOW() ELSE NULL END,
               $22, $23, $24)
       RETURNING *`,
      [
        data.user_id,
        data.merchant_id,
        data.offer_id,
        data.type,
        data.payment_method,
        data.crypto_amount,
        data.fiat_amount,
        data.rate,
        JSON.stringify(data.payment_details || {}),
        initialStatus,
        expiresMinutes.toString(),
        data.buyer_wallet_address ?? null,
        data.buyer_merchant_id ?? null,
        data.escrow_tx_hash ?? null,
        data.escrow_trade_id ?? null,
        data.escrow_trade_pda ?? null,
        data.escrow_pda ?? null,
        data.escrow_creator_wallet ?? null,
        escrowDebitedEntityType,
        escrowDebitedEntityId,
        escrowDebitedAmount,
        data.spread_preference ?? 'fastest',
        data.protocol_fee_percentage ?? 2.50,
        data.protocol_fee_amount ?? null,
      ]
    );

    const order = result.rows[0] as Order;
    console.log('[DB] Order created:', order.id, 'status:', order.status);

    logger.info('Order created in database', {
      orderId: order.id,
      status: order.status,
      merchantId: data.merchant_id,
      userId: data.user_id,
    });

    // Create initial event
    await client.query(
      `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, new_status)
       VALUES ($1, 'order_created', 'user', $2, 'pending')`,
      [order.id, data.user_id]
    );

    // Reserve liquidity (atomic: only deducts if sufficient balance exists)
    const reserveResult = await client.query(
      `UPDATE merchant_offers
       SET available_amount = available_amount - $1
       WHERE id = $2
         AND available_amount >= $1
       RETURNING *`,
      [data.crypto_amount, data.offer_id]
    );
    if (reserveResult.rows.length === 0) {
      throw new Error('INSUFFICIENT_LIQUIDITY');
    }

    return order;
  });
}

/**
 * Generate system message for status changes
 */
function getStatusChangeMessage(
  newStatus: OrderStatus,
  order: Order,
  actorType: ActorType,
  metadata?: Record<string, unknown>
): string | null {
  const amount = `${order.crypto_amount} USDC`;
  const fiat = `${order.fiat_amount.toLocaleString()} ${order.fiat_currency}`;

  switch (newStatus) {
    case 'accepted':
      return `✓ Order accepted by ${actorType === 'merchant' ? 'merchant' : 'counterparty'}`;
    case 'escrowed':
      return `🔒 ${amount} locked in escrow`;
    case 'payment_sent':
      return `💸 Payment of ${fiat} marked as sent`;
    case 'payment_confirmed':
      return `✓ Payment confirmed`;
    case 'completed':
      return `✅ Trade completed successfully! ${amount} released`;
    case 'cancelled':
      const reason = metadata?.reason ? `: ${metadata.reason}` : '';
      return `❌ Order cancelled${reason}`;
    case 'expired':
      return `⏰ Order expired (15 minute timeout)`;
    case 'disputed':
      return `⚠️ Order is now under dispute`;
    default:
      return null;
  }
}

/**
 * Generate default guidance messages for merchant and user based on order status.
 * Returns an array of messages to insert as system messages in the chat,
 * giving both parties clear next-step instructions.
 */
function getStatusGuidanceMessages(
  newStatus: OrderStatus,
  order: Order,
  actorType: ActorType,
): string[] {
  const isBuyOrder = order.type === 'buy'; // user is buying crypto from merchant
  const fiat = `${order.fiat_amount.toLocaleString()} ${order.fiat_currency}`;
  const crypto = `${order.crypto_amount} USDC`;
  const paymentMethod = order.payment_method === 'cash' ? 'cash' : 'bank transfer';

  switch (newStatus) {
    case 'accepted':
      if (isBuyOrder) {
        return [
          `📋 Next steps:\n• Merchant: Please lock ${crypto} in escrow to secure the trade.\n• Buyer: Once escrow is locked, send ${fiat} via ${paymentMethod} using the payment details provided.`,
        ];
      } else {
        return [
          `📋 Next steps:\n• Seller: Please lock ${crypto} in escrow to secure the trade.\n• Merchant: Once escrow is locked, send ${fiat} via ${paymentMethod} to the seller.`,
        ];
      }

    case 'escrowed':
      if (isBuyOrder) {
        return [
          `📋 Escrow is locked! Next steps:\n• Buyer: Please send ${fiat} via ${paymentMethod} to the merchant using the payment details above.\n• Merchant: Wait for the buyer to send payment, then confirm receipt.`,
        ];
      } else {
        return [
          `📋 Escrow is locked! Next steps:\n• Merchant: Please send ${fiat} via ${paymentMethod} to the seller.\n• Seller: Wait for the merchant to send payment, then confirm receipt.`,
        ];
      }

    case 'payment_sent':
      if (isBuyOrder) {
        return [
          `📋 Payment marked as sent!\n• Merchant: Please verify you have received ${fiat} in your account and confirm the payment.\n• Buyer: Waiting for merchant to confirm receipt of your payment.`,
        ];
      } else {
        return [
          `📋 Payment marked as sent!\n• Seller: Please verify you have received ${fiat} in your account and confirm the payment.\n• Merchant: Waiting for seller to confirm receipt of your payment.`,
        ];
      }

    case 'completed':
      if (isBuyOrder) {
        return [
          `🎉 Trade complete!\n• Buyer: ${crypto} has been released to your wallet.\n• Merchant: ${fiat} payment received. Thank you for trading!`,
        ];
      } else {
        return [
          `🎉 Trade complete!\n• Seller: ${fiat} payment received and ${crypto} released to the merchant.\n• Merchant: Thank you for trading!`,
        ];
      }

    case 'cancelled':
      return [
        `ℹ️ This order has been cancelled. If crypto was locked in escrow, it will be returned to the original wallet. If you believe this was a mistake, please contact support.`,
      ];

    case 'disputed':
      return [
        `⚠️ A dispute has been raised on this order.\n• Both parties: Please provide any evidence (screenshots, transaction receipts) in this chat.\n• A compliance officer will review and resolve the dispute. Do not send or release any funds until the dispute is resolved.`,
      ];

    case 'expired':
      return [
        `ℹ️ This order expired because it was not completed within the time limit. If crypto was locked in escrow, it will be returned. You can create a new order to try again.`,
      ];

    default:
      return [];
  }
}

/**
 * Update order status with state machine validation
 * Returns a result object instead of throwing to allow proper error handling
 */
export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  actorType: ActorType,
  actorId: string,
  metadata?: Record<string, unknown>
): Promise<StatusUpdateResult> {
  try {
    // CRITICAL: Prevent writing transient micro-statuses
    // New code should use minimal statuses (8-state system)
    // Transient statuses (escrow_pending, payment_pending, payment_confirmed, releasing)
    // are kept in DB for backwards compatibility but should NOT be written by new code
    if (isTransientStatus(newStatus)) {
      const normalizedStatus = normalizeStatus(newStatus);
      logger.warn('Attempted to write transient status - rejecting', {
        orderId,
        requestedStatus: newStatus,
        normalizedStatus,
        actorType,
        actorId,
      });
      return {
        success: false,
        error: `Status '${newStatus}' is a transient status and cannot be written. Use '${normalizedStatus}' instead.`,
      };
    }

    return await transaction(async (client) => {
      // Get current order with row lock
      const currentResult = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (currentResult.rows.length === 0) {
        return { success: false, error: 'Order not found' };
      }

      const currentOrder = currentResult.rows[0] as Order;
      const oldStatus = currentOrder.status as OrderStatus;

      // Validate the transition using state machine
      const validation = validateTransition(oldStatus, newStatus, actorType);
      if (!validation.valid) {
        logger.warn('Invalid order transition attempted', {
          orderId,
          oldStatus,
          newStatus,
          actorType,
          actorId,
          error: validation.error,
        });
        return { success: false, error: validation.error };
      }

      // Idempotency check: if already at target status, return success
      if (oldStatus === newStatus) {
        return { success: true, order: currentOrder };
      }

      // CRITICAL: Prevent marking as 'completed' without escrow release
      // Orders with escrow (escrow_tx_hash set) MUST have release_tx_hash to complete
      if (newStatus === 'completed' && currentOrder.escrow_tx_hash && !currentOrder.release_tx_hash) {
        logger.warn('Attempted to complete order without escrow release', {
          orderId,
          escrowTxHash: currentOrder.escrow_tx_hash,
          releaseTxHash: currentOrder.release_tx_hash,
        });
        return {
          success: false,
          error: 'Cannot complete order: escrow has not been released on-chain. Please release the escrow first.'
        };
      }

      // Check if this is a merchant claiming an order (Uber-like model)
      // When a merchant accepts a pending or escrowed order, reassign the order to them
      // For sell orders: user locks escrow first (status = 'escrowed'), then merchant accepts
      const isMerchantClaiming =
        actorType === 'merchant' &&
        (oldStatus === 'pending' || oldStatus === 'escrowed') &&
        newStatus === 'accepted' &&
        currentOrder.merchant_id !== actorId;

      // Check if this is M2M acceptance (merchant accepting another merchant's order)
      // In M2M: original merchant stays as merchant_id, acceptor becomes buyer_merchant_id
      // IMPORTANT: Only treat as M2M if the order was created by a merchant (placeholder user),
      // NOT when a real user created the order. For user-created orders, the accepting merchant
      // should replace merchant_id (via isMerchantClaiming), not set buyer_merchant_id.
      const userResult = await client.query(
        'SELECT username FROM users WHERE id = $1',
        [currentOrder.user_id]
      );
      const username = userResult.rows[0]?.username || '';
      const isPlaceholderUser = username.startsWith('open_order_') || username.startsWith('m2m_');
      const isM2MAcceptance =
        actorType === 'merchant' &&
        (oldStatus === 'escrowed' || oldStatus === 'pending') &&
        (newStatus === 'accepted' || newStatus === 'payment_pending') &&
        currentOrder.merchant_id !== actorId &&
        isPlaceholderUser;

      // Build update query with PARAMETERIZED values (prevent SQL injection)
      let timestampField = '';
      let merchantReassign = '';
      let acceptorWalletUpdate = '';
      let buyerMerchantUpdate = '';
      const dynamicParams: unknown[] = []; // Extra params beyond $1 (status)
      let nextParam = 2; // $1 = status, dynamic params start at $2

      switch (newStatus) {
        case 'accepted':
          // Extend timer to 120 minutes from acceptance
          timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
          // If a different merchant is claiming, reassign the order to them
          if (isMerchantClaiming) {
            merchantReassign = `, merchant_id = $${nextParam}`;
            dynamicParams.push(actorId);
            nextParam++;
            logger.info('Merchant claiming order', {
              orderId,
              previousMerchantId: currentOrder.merchant_id,
              newMerchantId: actorId,
            });
          }
          // For M2M: handle acceptance based on whether buyer_merchant_id is already set
          if (isM2MAcceptance) {
            if (currentOrder.buyer_merchant_id) {
              merchantReassign = `, merchant_id = $${nextParam}`;
              dynamicParams.push(actorId);
              nextParam++;
              buyerMerchantUpdate = '';
              logger.info('M2M acceptance (BUY order): reassigning merchant_id to seller', {
                orderId,
                buyerMerchantId: currentOrder.buyer_merchant_id,
                sellerMerchantId: actorId,
              });
            } else {
              buyerMerchantUpdate = `, buyer_merchant_id = $${nextParam}`;
              dynamicParams.push(actorId);
              nextParam++;
              merchantReassign = '';
              logger.info('M2M acceptance (SELL order): setting buyer_merchant_id', {
                orderId,
                sellerMerchantId: currentOrder.merchant_id,
                buyerMerchantId: actorId,
              });
            }
          }
          // Store acceptor's wallet address when accepting (for sell orders with escrow)
          if (metadata?.acceptor_wallet_address) {
            const wallet = String(metadata.acceptor_wallet_address);
            if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
              acceptorWalletUpdate = `, acceptor_wallet_address = $${nextParam}`;
              dynamicParams.push(wallet);
              nextParam++;
              logger.info('Storing acceptor wallet address', {
                orderId,
                acceptorWallet: wallet,
              });
            }
          }
          break;
        case 'escrowed':
          // Extend timer on escrow lock
          timestampField = ", escrowed_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
          break;
        case 'payment_pending':
          // M2M flow: when merchant accepts escrowed order and goes directly to payment_pending
          if (isM2MAcceptance) {
            timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
            if (currentOrder.buyer_merchant_id) {
              merchantReassign = `, merchant_id = $${nextParam}`;
              dynamicParams.push(actorId);
              nextParam++;
              logger.info('M2M direct acceptance to payment_pending (BUY order)', {
                orderId,
                buyerMerchantId: currentOrder.buyer_merchant_id,
                sellerMerchantId: actorId,
              });
            } else {
              buyerMerchantUpdate = `, buyer_merchant_id = $${nextParam}`;
              dynamicParams.push(actorId);
              nextParam++;
              logger.info('M2M direct acceptance to payment_pending (SELL order)', {
                orderId,
                sellerMerchantId: currentOrder.merchant_id,
                buyerMerchantId: actorId,
              });
            }
            if (metadata?.acceptor_wallet_address) {
              const wallet = String(metadata.acceptor_wallet_address);
              if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
                acceptorWalletUpdate = `, acceptor_wallet_address = $${nextParam}`;
                dynamicParams.push(wallet);
                nextParam++;
              }
            }
          }
          break;
        case 'payment_sent': {
          // Payment deadline system (Task 3):
          // Set deadline based on payment method to prevent infinite payment_sent state
          // - cash (UPI): 60 minutes
          // - bank (existing beneficiary / locked payment method): 4 hours
          // - bank (new beneficiary / no locked payment method): 48 hours
          let deadlineInterval = "INTERVAL '60 minutes'"; // default: cash/UPI
          let needsProof = false;

          if (currentOrder.payment_method === 'bank') {
            needsProof = true;
            if ((currentOrder as any).payment_method_id) {
              // Existing beneficiary (locked payment method on file)
              deadlineInterval = "INTERVAL '4 hours'";
            } else {
              // New beneficiary — allow more time for first-time transfers
              deadlineInterval = "INTERVAL '48 hours'";
            }
          }

          timestampField = `, payment_sent_at = NOW(), payment_deadline = NOW() + ${deadlineInterval}, requires_payment_proof = ${needsProof}`;
          break;
        }
        case 'payment_confirmed':
          timestampField = ', payment_confirmed_at = NOW()';
          break;
        case 'completed':
          timestampField = ', completed_at = NOW()';
          break;
        case 'cancelled':
          timestampField = `, cancelled_at = NOW(), cancelled_by = $${nextParam}::actor_type, cancellation_reason = $${nextParam + 1}::TEXT`;
          dynamicParams.push(actorType, metadata?.reason || null);
          nextParam += 2;
          break;
        case 'expired':
          timestampField = ", cancelled_at = NOW(), cancelled_by = 'system', cancellation_reason = 'Timed out'";
          break;
        case 'disputed':
          // Set auto-resolve deadline: 24 hours from now to prevent infinite stall
          // Track who raised the dispute (user or merchant)
          timestampField = `, disputed_at = NOW(), dispute_auto_resolve_at = NOW() + INTERVAL '24 hours', disputed_by = $${nextParam}::TEXT, disputed_by_id = $${nextParam + 1}::UUID`;
          dynamicParams.push(actorType, actorId);
          nextParam += 2;
          break;
      }

      // If accepting an already-escrowed order, keep status as 'escrowed' (don't regress)
      let effectiveStatus = newStatus;
      if (newStatus === 'accepted' && oldStatus === 'escrowed' && currentOrder.escrow_tx_hash) {
        effectiveStatus = 'escrowed';
        logger.info('M2M acceptance of escrowed order: keeping status as escrowed', {
          orderId,
          escrowTxHash: currentOrder.escrow_tx_hash,
        });
      }

      // Build parameterized query with version + previous status guards:
      // $1=status, $2..N=dynamic values, $N+1=orderId, $N+2=expected_version, $N+3=expected_old_status
      const updateParams: unknown[] = [effectiveStatus, ...dynamicParams, orderId, currentOrder.order_version, oldStatus];
      const whereParam = nextParam;
      const versionParam = nextParam + 1;
      const oldStatusParam = nextParam + 2;
      const sql = `UPDATE orders SET status = $1, order_version = order_version + 1${timestampField}${merchantReassign}${acceptorWalletUpdate}${buyerMerchantUpdate} WHERE id = $${whereParam} AND order_version = $${versionParam} AND status = $${oldStatusParam}::order_status RETURNING *`;

      const updateResult = await client.query(sql, updateParams);

      // If no row returned, a concurrent update beat us (version or status changed)
      if (updateResult.rows.length === 0) {
        logger.warn('Concurrent status update detected (version/status mismatch)', {
          orderId,
          expectedVersion: currentOrder.order_version,
          expectedStatus: oldStatus,
          targetStatus: effectiveStatus,
        });
        return {
          success: false,
          error: 'Order was modified concurrently. Please retry.',
        };
      }

      const updatedOrder = updateResult.rows[0] as Order;

      // Create event (always, for audit trail)
      const eventType = getTransitionEventType(oldStatus, newStatus);
      await client.query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          eventType,
          actorType,
          actorId,
          oldStatus,
          newStatus,
          JSON.stringify(metadata || {}),
        ]
      );

      // Handle side effects: liquidity restoration
      if (shouldRestoreLiquidity(oldStatus, newStatus)) {
        await client.query(
          'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
          [currentOrder.crypto_amount, currentOrder.offer_id]
        );
        logger.info('Liquidity restored', {
          orderId,
          offerId: currentOrder.offer_id,
          amount: currentOrder.crypto_amount,
        });
      }

      // Handle side effects: stats update on completion
      if (newStatus === 'completed') {
        await client.query(
          `UPDATE users SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
          [currentOrder.fiat_amount, currentOrder.user_id]
        );
        await client.query(
          `UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2`,
          [currentOrder.fiat_amount, currentOrder.merchant_id]
        );

        // Corridor bridge: transfer locked sAED to LP on completion
        if (currentOrder.payment_via === 'saed_corridor' && currentOrder.corridor_fulfillment_id) {
          try {
            const { atomicCorridorSettlement } = await import('@/lib/money/corridorSettlement');
            await atomicCorridorSettlement(client, orderId, currentOrder.corridor_fulfillment_id);
            logger.info('[Corridor] Settlement completed within order completion', { orderId });
          } catch (corridorErr) {
            logger.error('Failed corridor settlement on completion', { orderId, error: corridorErr });
          }
        }

        logger.order.completed(orderId, currentOrder.crypto_amount, currentOrder.fiat_amount);

        // Create order receipt snapshot
        try {
          // Fetch creator (user) and acceptor (merchant) names
          const creatorRow = await client.query(
            'SELECT name, username FROM users WHERE id = $1',
            [updatedOrder.user_id]
          );
          const acceptorRow = await client.query(
            'SELECT display_name, wallet_address FROM merchants WHERE id = $1',
            [updatedOrder.merchant_id]
          );
          const creatorName = creatorRow.rows[0]?.name || creatorRow.rows[0]?.username || null;
          const acceptorName = acceptorRow.rows[0]?.display_name || null;
          const acceptorWallet = acceptorRow.rows[0]?.wallet_address || updatedOrder.acceptor_wallet_address || null;

          await client.query(
            `INSERT INTO order_receipts (
              order_id, order_number, type, payment_method,
              crypto_amount, crypto_currency, fiat_amount, fiat_currency, rate,
              platform_fee, protocol_fee_amount, status,
              creator_type, creator_id, creator_name, creator_wallet_address,
              acceptor_type, acceptor_id, acceptor_name, acceptor_wallet_address,
              payment_details, escrow_tx_hash, release_tx_hash,
              accepted_at, escrowed_at, payment_sent_at, completed_at
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, $7, $8, $9,
              $10, $11, $12,
              $13, $14, $15, $16,
              $17, $18, $19, $20,
              $21, $22, $23,
              $24, $25, $26, NOW()
            ) ON CONFLICT (order_id) DO UPDATE SET
              status = EXCLUDED.status,
              release_tx_hash = EXCLUDED.release_tx_hash,
              completed_at = NOW(),
              updated_at = NOW()`,
            [
              orderId,
              updatedOrder.order_number,
              updatedOrder.type,
              updatedOrder.payment_method,
              updatedOrder.crypto_amount,
              updatedOrder.crypto_currency,
              updatedOrder.fiat_amount,
              updatedOrder.fiat_currency,
              updatedOrder.rate,
              updatedOrder.platform_fee || 0,
              updatedOrder.protocol_fee_amount || null,
              'completed',
              updatedOrder.buyer_merchant_id ? 'merchant' : 'user',
              updatedOrder.buyer_merchant_id || updatedOrder.user_id,
              creatorName,
              updatedOrder.buyer_wallet_address || null,
              'merchant',
              updatedOrder.merchant_id,
              acceptorName,
              acceptorWallet,
              JSON.stringify(updatedOrder.payment_details || {}),
              updatedOrder.escrow_tx_hash || null,
              updatedOrder.release_tx_hash || null,
              updatedOrder.accepted_at,
              updatedOrder.escrowed_at,
              updatedOrder.payment_sent_at,
            ]
          );
          logger.info('Order receipt created', { orderId, orderNumber: updatedOrder.order_number });
        } catch (receiptErr) {
          logger.warn('Failed to create order receipt', { orderId, error: receiptErr });
        }

        // Record reputation events for order completion
        try {
          await recordReputationEvent(
            currentOrder.user_id,
            'user',
            'order_completed',
            `Completed order for ${currentOrder.fiat_amount} ${currentOrder.fiat_currency}`,
            { orderId, amount: currentOrder.fiat_amount, currency: currentOrder.fiat_currency }
          );
          await recordReputationEvent(
            currentOrder.merchant_id,
            'merchant',
            'order_completed',
            `Completed order for ${currentOrder.fiat_amount} ${currentOrder.fiat_currency}`,
            { orderId, amount: currentOrder.fiat_amount, currency: currentOrder.fiat_currency }
          );
        } catch (repErr) {
          logger.warn('Failed to record reputation events for completed order', { orderId, error: repErr });
        }

        // Auto-add user as merchant contact for direct messaging
        try {
          await upsertMerchantContact({
            merchant_id: currentOrder.merchant_id,
            user_id: currentOrder.user_id,
            trade_volume: currentOrder.fiat_amount,
          });
          logger.info('Added/updated merchant contact from completed order', {
            orderId,
            merchantId: currentOrder.merchant_id,
            userId: currentOrder.user_id,
          });
        } catch (contactErr) {
          logger.warn('Failed to upsert merchant contact', { orderId, error: contactErr });
        }

        // Update avg completion time (fire-and-forget, never blocks order flow)
        try {
          const { updateAvgCompletionTime } = await import('./risk');
          if (currentOrder.created_at) {
            const completionMs = Date.now() - new Date(currentOrder.created_at).getTime();
            updateAvgCompletionTime(currentOrder.user_id, 'user', completionMs).catch(() => {});
            updateAvgCompletionTime(currentOrder.merchant_id, 'merchant', completionMs).catch(() => {});
          }
        } catch {
          // risk module not available — non-fatal
        }
      }

      // Handle side effects: cancellation
      if (newStatus === 'cancelled') {
        try {
          await recordReputationEvent(
            currentOrder.user_id,
            'user',
            'order_cancelled',
            `Order cancelled`,
            { orderId, cancelledBy: actorType }
          );
          await recordReputationEvent(
            currentOrder.merchant_id,
            'merchant',
            'order_cancelled',
            `Order cancelled`,
            { orderId, cancelledBy: actorType }
          );
        } catch (repErr) {
          logger.warn('Failed to record reputation events for cancelled order', { orderId, error: repErr });
        }

        // Increment cancelled_orders stats (fire-and-forget, never blocks order flow)
        try {
          const { incrementCancelledOrders } = await import('./risk');
          incrementCancelledOrders(currentOrder.user_id, currentOrder.merchant_id).catch(() => {});
        } catch {
          // risk module not available — non-fatal
        }
      }

      // Handle side effects: dispute
      if (newStatus === 'disputed') {
        // Create disputes table row if one doesn't already exist
        // The compliance resolve endpoint requires this row to function.
        try {
          await client.query(
            `INSERT INTO disputes (order_id, raised_by, raiser_id, reason, description, status, created_at)
             SELECT $1, $2, $3, 'non_responsive'::dispute_reason, $4, 'open', NOW()
             WHERE NOT EXISTS (SELECT 1 FROM disputes WHERE order_id = $1)`,
            [
              orderId,
              actorType || 'system',
              actorId || currentOrder.user_id,
              metadata?.reason || 'Order disputed',
            ]
          );
        } catch (disputeErr) {
          logger.error('Failed to create disputes row (non-fatal)', { orderId, error: disputeErr });
        }

        // Increment dispute_count stats (fire-and-forget, never blocks order flow)
        try {
          const { incrementDisputeCount } = await import('./risk');
          incrementDisputeCount(currentOrder.user_id, currentOrder.merchant_id).catch(() => {});
        } catch {
          // risk module not available — non-fatal
        }
      }

      // Log the status change
      logger.order.statusChanged(orderId, oldStatus, effectiveStatus, actorType, actorId);

      // Send system message to chat for this status change (use client within transaction)
      try {
        const statusMessage = getStatusChangeMessage(effectiveStatus, updatedOrder, actorType, metadata);
        if (statusMessage) {
          await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $2, $3, 'system')`,
            [orderId, orderId, statusMessage]
          );
        }

        // Auto-send default guidance messages for merchant and user
        // Uses message_type='text' so they appear in the main chat (not filtered as system-only)
        const guidanceMessages = getStatusGuidanceMessages(effectiveStatus, updatedOrder, actorType);
        for (const guidanceMsg of guidanceMessages) {
          await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $2, $3, 'text')`,
            [orderId, orderId, guidanceMsg]
          );
        }

        // Auto-send bank info message when order is accepted (for bank payment method)
        if (effectiveStatus === 'accepted' && updatedOrder.payment_method === 'bank') {
          const paymentDetails = updatedOrder.payment_details as Record<string, unknown> | null;
          if (paymentDetails) {
            // For buy orders: user needs to send fiat to merchant's bank
            // For sell orders: merchant needs to send fiat to user's bank
            const bankInfoMessage = JSON.stringify({
              type: 'bank_info',
              text: updatedOrder.type === 'buy'
                ? '🏦 Payment Details - Send fiat to this account'
                : '🏦 Payment Details - Merchant will send fiat here',
              data: {
                bank_name: paymentDetails.bank_name,
                bank_account_name: paymentDetails.bank_account_name,
                bank_iban: paymentDetails.bank_iban,
                user_bank_account: paymentDetails.user_bank_account,
              },
            });
            await client.query(
              `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
               VALUES ($1, 'system', $2, $3, 'system')`,
              [orderId, orderId, bankInfoMessage]
            );
          }
        }

        // Auto-send escrow info message when crypto is locked
        if (effectiveStatus === 'escrowed' && updatedOrder.escrow_tx_hash) {
          const escrowInfoMessage = JSON.stringify({
            type: 'escrow_locked',
            text: `🔒 ${updatedOrder.crypto_amount} ${updatedOrder.crypto_currency} locked in escrow`,
            data: {
              amount: updatedOrder.crypto_amount,
              currency: updatedOrder.crypto_currency,
              txHash: updatedOrder.escrow_tx_hash,
              escrowPda: updatedOrder.escrow_pda || updatedOrder.escrow_trade_pda,
            },
          });
          await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $2, $3, 'system')`,
            [orderId, orderId, escrowInfoMessage]
          );
        }

        // Auto-send release info message when trade completes
        if (effectiveStatus === 'completed' && updatedOrder.release_tx_hash) {
          const releaseInfoMessage = JSON.stringify({
            type: 'escrow_released',
            text: `✅ ${updatedOrder.crypto_amount} ${updatedOrder.crypto_currency} released`,
            data: {
              amount: updatedOrder.crypto_amount,
              currency: updatedOrder.crypto_currency,
              txHash: updatedOrder.release_tx_hash,
              escrowPda: updatedOrder.escrow_pda || updatedOrder.escrow_trade_pda,
            },
          });
          await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $2, $3, 'system')`,
            [orderId, orderId, releaseInfoMessage]
          );
        }
      } catch (msgErr) {
        logger.warn('Failed to send status change message to chat', { orderId, error: msgErr });
      }

      // Write-through: update cache with fresh order data instead of invalidating
      // Avoids cache miss → stampede after every status change
      updateOrderCache(orderId, updatedOrder);

      return { success: true, order: updatedOrder };
    });
  } catch (error) {
    const err = error as Error;
    console.error('[DB] updateOrderStatus error:', {
      orderId,
      name: err.name,
      message: err.message,
    });
    logger.order.error(orderId, 'updateStatus', err);
    return { success: false, error: `Failed to update order status: ${err.message}` };
  }
}

/**
 * Legacy wrapper that returns Order | null for backward compatibility
 * @deprecated Use updateOrderStatus which returns StatusUpdateResult
 */
export async function updateOrderStatusLegacy(
  orderId: string,
  newStatus: OrderStatus,
  actorType: ActorType,
  actorId: string,
  metadata?: Record<string, unknown>
): Promise<Order | null> {
  const result = await updateOrderStatus(orderId, newStatus, actorType, actorId, metadata);
  return result.success ? result.order! : null;
}

export async function cancelOrder(
  orderId: string,
  actorType: ActorType,
  actorId: string,
  reason?: string
): Promise<StatusUpdateResult> {
  return updateOrderStatus(orderId, 'cancelled', actorType, actorId, { reason });
}

/**
 * Atomically claim an escrowed order for a merchant (broadcast model).
 *
 * Uses WHERE buyer_merchant_id IS NULL AND status = 'escrowed' to prevent
 * race conditions — only one merchant can claim. If no rows are updated,
 * the order was already claimed by another merchant.
 *
 * @returns StatusUpdateResult with the claimed order or an error
 */
export async function claimOrder(
  orderId: string,
  claimingMerchantId: string,
  acceptorWalletAddress?: string,
): Promise<StatusUpdateResult> {
  try {
    return await transaction(async (client) => {
      // First, fetch the order to determine if this is user↔merchant or M2M
      const orderCheck = await client.query(
        `SELECT id, status, type, user_id, merchant_id, buyer_merchant_id,
                accepted_at
         FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      );

      if (orderCheck.rows.length === 0) {
        return { success: false, error: 'Order not found' };
      }

      const order = orderCheck.rows[0];
      if (order.status !== 'escrowed') {
        return { success: false, error: `Order is in '${order.status}' status, cannot claim` };
      }

      // Determine if already claimed
      const isM2MOrder = !!order.buyer_merchant_id;

      if (isM2MOrder || order.accepted_at) {
        return { success: false, error: 'Order already claimed by another merchant' };
      }

      // For user↔merchant orders: claiming merchant becomes merchant_id (the buyer/counterparty)
      // buyer_merchant_id is ONLY for M2M trades
      // For M2M placeholder orders: claiming merchant becomes buyer_merchant_id
      const userUsername = await client.query(
        'SELECT username FROM users WHERE id = $1', [order.user_id]
      );
      const username = userUsername.rows[0]?.username || '';
      const isPlaceholderUser = username.startsWith('open_order_') || username.startsWith('m2m_');

      // Look up the claiming merchant's wallet as fallback if not provided in request
      let walletToUse = acceptorWalletAddress || null;
      if (!walletToUse) {
        const merchantWallet = await client.query(
          'SELECT wallet_address FROM merchants WHERE id = $1',
          [claimingMerchantId]
        );
        walletToUse = merchantWallet.rows[0]?.wallet_address || null;
      }

      let claimResult;
      if (isPlaceholderUser) {
        // M2M / merchant-created order: set buyer_merchant_id
        // ALWAYS overwrite acceptor_wallet_address with buyer's wallet (not COALESCE)
        // The creator may have set it during self-accept — buyer's wallet is what matters for release
        claimResult = await client.query(
          `UPDATE orders
           SET buyer_merchant_id = $1,
               accepted_at = NOW(),
               acceptor_wallet_address = COALESCE($3, acceptor_wallet_address),
               order_version = order_version + 1
           WHERE id = $2
             AND buyer_merchant_id IS NULL
             AND status = 'escrowed'
           RETURNING *`,
          [claimingMerchantId, orderId, walletToUse]
        );
      } else {
        // User↔merchant order: set merchant_id (the claiming merchant is the buyer/counterparty)
        // merchant_id IS NULL check prevents overwriting an already-assigned merchant
        claimResult = await client.query(
          `UPDATE orders
           SET merchant_id = $1,
               accepted_at = NOW(),
               acceptor_wallet_address = COALESCE($3, acceptor_wallet_address),
               order_version = order_version + 1
           WHERE id = $2
             AND accepted_at IS NULL
             AND merchant_id IS NULL
             AND status = 'escrowed'
           RETURNING *`,
          [claimingMerchantId, orderId, walletToUse]
        );
      }

      if (claimResult.rows.length === 0) {
        return { success: false, error: 'Unable to claim order — may have been claimed already' };
      }

      const claimedOrder = claimResult.rows[0] as Order;

      // Record the claim event
      const claimField = isPlaceholderUser ? 'buyer_merchant_id' : 'merchant_id';
      await client.query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'order_claimed', 'merchant', $2, 'escrowed', 'escrowed', $3)`,
        [orderId, claimingMerchantId, JSON.stringify({ claim: true, [claimField]: claimingMerchantId })]
      );

      logger.info('[claimOrder] Order claimed successfully', {
        orderId,
        claimingMerchantId,
        claimField,
        isPlaceholderUser,
        previousStatus: 'escrowed',
      });

      // Invalidate cache
      invalidateOrderCache(orderId);

      return { success: true, order: claimedOrder };
    });
  } catch (error) {
    logger.error('[claimOrder] Failed to claim order', {
      orderId,
      claimingMerchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: 'Failed to claim order' };
  }
}

/**
 * Atomically claim an escrowed order AND mark payment as sent in one transaction.
 * This is the "Option B (better UX)" flow: claim + payment_sent atomically.
 *
 * Prevents race conditions — only one merchant can claim and pay.
 */
export async function claimAndPayOrder(
  orderId: string,
  claimingMerchantId: string,
  acceptorWalletAddress?: string,
): Promise<StatusUpdateResult> {
  try {
    return await transaction(async (client) => {
      // Atomic claim + payment: claim the order and set status to payment_sent in one step.
      // First determine if this is a user↔merchant or M2M order.
      const orderCheck = await client.query(
        `SELECT o.id, o.status, o.type, o.user_id, o.merchant_id, o.buyer_merchant_id,
                o.accepted_at, u.username
         FROM orders o JOIN users u ON o.user_id = u.id
         WHERE o.id = $1 FOR UPDATE`,
        [orderId]
      );

      if (orderCheck.rows.length === 0) {
        return { success: false, error: 'Order not found' };
      }

      const order = orderCheck.rows[0];
      if (order.status !== 'escrowed') {
        return { success: false, error: `Order is in '${order.status}' status, cannot claim` };
      }
      if (order.buyer_merchant_id || order.accepted_at) {
        return { success: false, error: 'Order already claimed by another merchant' };
      }

      const isPlaceholderUser = order.username?.startsWith('open_order_') || order.username?.startsWith('m2m_');

      // Look up the claiming merchant's wallet as fallback if not provided
      let walletToUse = acceptorWalletAddress || null;
      if (!walletToUse) {
        const merchantWallet = await client.query(
          'SELECT wallet_address FROM merchants WHERE id = $1',
          [claimingMerchantId]
        );
        walletToUse = merchantWallet.rows[0]?.wallet_address || null;
      }

      // For user↔merchant: set merchant_id (buyer_merchant_id is M2M only)
      // For M2M/placeholder: set buyer_merchant_id
      let claimResult;
      if (isPlaceholderUser) {
        claimResult = await client.query(
          `UPDATE orders
           SET buyer_merchant_id = $1,
               status = 'payment_sent',
               accepted_at = NOW(),
               payment_sent_at = NOW(),
               acceptor_wallet_address = COALESCE($3, acceptor_wallet_address),
               escrow_debited_entity_id = COALESCE(escrow_debited_entity_id, merchant_id),
               escrow_debited_entity_type = COALESCE(escrow_debited_entity_type, 'merchant'),
               escrow_debited_amount = COALESCE(escrow_debited_amount, crypto_amount),
               escrow_debited_at = COALESCE(escrow_debited_at, escrowed_at, created_at),
               order_version = order_version + 1,
               updated_at = NOW()
           WHERE id = $2
             AND buyer_merchant_id IS NULL
             AND status = 'escrowed'
           RETURNING *`,
          [claimingMerchantId, orderId, walletToUse]
        );
      } else {
        // User↔merchant: claiming merchant becomes merchant_id (the counterparty/buyer)
        claimResult = await client.query(
          `UPDATE orders
           SET merchant_id = $1,
               status = 'payment_sent',
               accepted_at = NOW(),
               payment_sent_at = NOW(),
               acceptor_wallet_address = COALESCE($3, acceptor_wallet_address),
               escrow_debited_entity_id = COALESCE(escrow_debited_entity_id, user_id),
               escrow_debited_entity_type = COALESCE(escrow_debited_entity_type, 'user'),
               escrow_debited_amount = COALESCE(escrow_debited_amount, crypto_amount),
               escrow_debited_at = COALESCE(escrow_debited_at, escrowed_at, created_at),
               order_version = order_version + 1,
               updated_at = NOW()
           WHERE id = $2
             AND accepted_at IS NULL
             AND status = 'escrowed'
           RETURNING *`,
          [claimingMerchantId, orderId, walletToUse]
        );
      }

      if (claimResult.rows.length === 0) {
        return { success: false, error: 'Unable to claim and pay order — may have been claimed already' };
      }

      const claimedOrder = claimResult.rows[0] as Order;

      // Record the claim + payment event
      await client.query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'status_changed_to_payment_sent', 'merchant', $2, 'escrowed', 'payment_sent', $3)`,
        [orderId, claimingMerchantId, JSON.stringify({
          claim_and_pay: true,
          buyer_merchant_id: claimingMerchantId,
        })]
      );

      logger.info('[claimAndPayOrder] Order claimed and payment sent', {
        orderId,
        claimingMerchantId,
        previousStatus: 'escrowed',
        newStatus: 'payment_sent',
      });

      invalidateOrderCache(orderId);

      return { success: true, order: claimedOrder };
    });
  } catch (error) {
    logger.error('[claimAndPayOrder] Failed', {
      orderId,
      claimingMerchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: 'Failed to claim and pay order' };
  }
}

// Order Events
export async function getOrderEvents(orderId: string): Promise<OrderEvent[]> {
  return query<OrderEvent>(
    'SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId]
  );
}

// Chat Messages
export async function getOrderMessages(
  orderId: string,
  options?: { limit?: number; before?: string }
): Promise<ChatMessage[]> {
  const limit = Math.min(options?.limit || 50, 200);
  const params: unknown[] = [orderId, limit];

  let cursorClause = '';
  if (options?.before) {
    cursorClause = 'AND cm.created_at < $3';
    params.push(options.before);
  }

  // Fetch newest N messages (DESC), then reverse to return ASC order for frontend
  const rows = await query<ChatMessage>(
    `SELECT
      cm.*,
      CASE
        WHEN cm.sender_type = 'user' THEN u.username
        WHEN cm.sender_type = 'merchant' THEN m.display_name
        WHEN cm.sender_type = 'compliance' THEN ct.name
        ELSE 'System'
      END as sender_name
    FROM chat_messages cm
    LEFT JOIN users u ON cm.sender_type = 'user' AND cm.sender_id = u.id
    LEFT JOIN merchants m ON cm.sender_type = 'merchant' AND cm.sender_id = m.id
    LEFT JOIN compliance_team ct ON cm.sender_type = 'compliance' AND cm.sender_id = ct.id
    WHERE cm.order_id = $1
      AND NOT (cm.sender_type = 'system' AND cm.message_type = 'system')
      ${cursorClause}
    ORDER BY cm.created_at DESC
    LIMIT $2`,
    params
  );

  // Reverse so messages are returned in chronological (ASC) order
  return rows.reverse();
}

export async function sendMessage(data: {
  order_id: string;
  sender_type: ActorType;
  sender_id: string;
  content?: string;
  message_type?: 'text' | 'image' | 'file' | 'system' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  image_url?: string;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}): Promise<ChatMessage> {
  const result = await queryOne<ChatMessage>(
    `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, image_url, file_url, file_name, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.order_id,
      data.sender_type,
      data.sender_id,
      data.content || null,
      data.message_type || 'text',
      data.image_url || null,
      data.file_url || null,
      data.file_name || null,
      data.file_size || null,
      data.mime_type || null,
    ]
  );
  return result!;
}

export async function markMessagesAsRead(
  orderId: string,
  readerType: ActorType
): Promise<void> {
  // Mark messages as read that were NOT sent by the reader
  await query(
    `UPDATE chat_messages
     SET is_read = true, read_at = NOW()
     WHERE order_id = $1 AND sender_type != $2 AND is_read = false`,
    [orderId, readerType]
  );
}

// Update has_manual_message flag when user/merchant sends a message
export async function markOrderHasManualMessage(orderId: string): Promise<void> {
  await query(
    `UPDATE orders SET has_manual_message = true WHERE id = $1 AND has_manual_message = false`,
    [orderId]
  );
}

// Expired orders cleanup - Minimal status timeout logic
export async function expireOldOrders(): Promise<number> {
  // First, get the orders that will be expired (we need user_id and merchant_id for reputation)
  // MINIMAL STATUS TIMEOUT RULES:
  // 1. "open" (pending): 15 minutes from creation → expired
  // 2. "accepted" without escrow: 120 minutes from acceptance → cancelled
  // 3. "escrowed"+ (escrow locked): 120 minutes from acceptance → disputed (never auto-cancel)
  const ordersToExpire = await query<{
    id: string;
    order_number: string;
    user_id: string;
    merchant_id: string;
    buyer_merchant_id: string | null;
    status: string;
    type: string;
    crypto_amount: number;
    fiat_amount: number;
    fiat_currency: string;
    escrow_tx_hash: string | null;
    accepted_at: string | null;
    escrow_debited_entity_type: 'merchant' | 'user' | null;
    escrow_debited_entity_id: string | null;
    escrow_debited_amount: number | null;
  }>(
    `SELECT id, order_number, user_id, merchant_id, buyer_merchant_id, status, type,
            crypto_amount, fiat_amount, fiat_currency, escrow_tx_hash, accepted_at,
            escrow_debited_entity_type, escrow_debited_entity_id, escrow_debited_amount
     FROM orders
     WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
       AND (
         -- "open" orders (pending): 15 min from creation → expired
         (status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes')
         -- "accepted"+ orders: 120 min from acceptance → cancelled or disputed based on escrow
         OR (status NOT IN ('pending') AND COALESCE(accepted_at, created_at) < NOW() - INTERVAL '120 minutes')
       )`
  );

  if (ordersToExpire.length === 0) {
    return 0;
  }

  // Separate into pending (expire) vs accepted (cancel or dispute based on escrow)
  const pendingExpired = ordersToExpire.filter(o => o.status === 'pending');
  const acceptedExpired = ordersToExpire.filter(o => o.status !== 'pending');

  let totalExpired = 0;

  // Expire pending orders (no one accepted them) - use 'expired' status (not 'cancelled')
  if (pendingExpired.length > 0) {
    const pendingIds = pendingExpired.map(o => o.id);
    const expireResult = await query(
      `UPDATE orders
       SET status = 'expired'::order_status,
           order_version = order_version + 1,
           cancelled_at = NOW(),
           cancelled_by = 'system',
           cancellation_reason = 'Order expired - no one accepted within 15 minutes'
       WHERE id = ANY($1) AND status = 'pending'
       RETURNING id`,
      [pendingIds]
    );
    totalExpired += expireResult?.length || 0;
  }

  // Handle accepted/in-progress orders that timed out (120 min)
  // CRITICAL INVARIANT: After escrow locked, timeout → disputed (NEVER auto-cancel)
  if (acceptedExpired.length > 0) {
    const acceptedIds = acceptedExpired.map(o => o.id);

    // Orders with escrow locked go to disputed
    // Orders without escrow (just accepted) get cancelled
    const updateResult = await query(
      `UPDATE orders
       SET
         status = CASE
           WHEN escrow_tx_hash IS NOT NULL THEN 'disputed'::order_status
           ELSE 'cancelled'::order_status
         END,
         order_version = order_version + 1,
         cancelled_at = NOW(),
         cancelled_by = 'system',
         cancellation_reason = CASE
           WHEN escrow_tx_hash IS NOT NULL THEN 'Order timeout - moved to dispute (escrow locked)'
           ELSE 'Order timeout - cancelled (no escrow)'
         END
       WHERE id = ANY($1)
         AND status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
       RETURNING id`,
      [acceptedIds]
    );
    totalExpired += updateResult?.length || 0;

    // Create disputes rows for orders that moved to disputed (escrow was locked)
    // The compliance resolve endpoint requires a disputes row to function.
    const disputedOrders = acceptedExpired.filter(o =>
      ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(o.status)
    );
    if (disputedOrders.length > 0) {
      try {
        const dVals: string[] = [];
        const dParams: unknown[] = [];
        let di = 0;
        for (const o of disputedOrders) {
          dVals.push(`($${++di}, 'system', $${++di}, 'non_responsive'::dispute_reason, $${++di}, 'open', NOW())`);
          dParams.push(o.id, o.user_id, `Order timeout - auto-disputed (was in ${o.status} status)`);
        }
        await query(
          `INSERT INTO disputes (order_id, raised_by, raiser_id, reason, description, status, created_at)
           VALUES ${dVals.join(', ')}
           ON CONFLICT (order_id) DO NOTHING`,
          dParams
        );
      } catch (disputeErr) {
        console.error('[expireOrders] Failed to create dispute rows (non-fatal):', disputeErr);
      }
    }
  }

  // Batch insert system messages + reputation events (avoids N+1 per-order DB calls)
  if (ordersToExpire.length > 0) {
    const msgValues: string[] = [];
    const msgParams: unknown[] = [];
    const repValues: string[] = [];
    const repParams: unknown[] = [];
    let msgIdx = 0;
    let repIdx = 0;

    for (const order of ordersToExpire) {
      const isEscrowLocked = ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status);
      const isPending = order.status === 'pending';
      const eventType = isEscrowLocked ? 'order_disputed' : 'order_timeout';
      const timeout = isPending ? '15 minutes' : '120 minutes';
      const reason = `Order timeout - not completed within ${timeout} (was in ${order.status} status)`;
      const expiryMessage = isEscrowLocked
        ? `⏰ Order expired - moved to dispute for resolution (escrow was locked)`
        : isPending
          ? `⏰ Order expired - no one accepted within 15 minutes`
          : `⏰ Order expired - not completed within 120 minutes after acceptance`;

      // Batch message insert
      msgValues.push(`($${++msgIdx}, 'system', $${++msgIdx}, $${++msgIdx}, 'system')`);
      msgParams.push(order.id, order.id, expiryMessage);

      // Batch reputation events (user + merchant per order)
      const metadata = JSON.stringify({ orderId: order.id, previousStatus: order.status, amount: order.fiat_amount, currency: order.fiat_currency });
      const scoreChange = eventType === 'order_disputed' ? -15 : -5;
      repValues.push(`($${++repIdx}, 'user', $${++repIdx}, $${++repIdx}, $${++repIdx}, $${++repIdx})`);
      repParams.push(order.user_id, eventType, scoreChange, reason, metadata);
      repValues.push(`($${++repIdx}, 'merchant', $${++repIdx}, $${++repIdx}, $${++repIdx}, $${++repIdx})`);
      repParams.push(order.merchant_id, eventType, scoreChange, reason, metadata);

      // Fire-and-forget Pusher notifications (no DB call)
      const newStatus = isEscrowLocked ? 'disputed' : 'cancelled';
      notifyOrderStatusUpdated({
        orderId: order.id, userId: order.user_id, merchantId: order.merchant_id,
        status: newStatus, previousStatus: order.status, updatedAt: new Date().toISOString(),
      });
      if (order.buyer_merchant_id) {
        notifyOrderStatusUpdated({
          orderId: order.id, userId: order.user_id, merchantId: order.buyer_merchant_id,
          status: newStatus, previousStatus: order.status, updatedAt: new Date().toISOString(),
        });
      }
    }

    try {
      // 2 queries total instead of 3*N
      await Promise.all([
        query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type) VALUES ${msgValues.join(',')}`,
          msgParams
        ),
        query(
          `INSERT INTO reputation_events (entity_id, entity_type, event_type, score_change, reason, metadata) VALUES ${repValues.join(',')}`,
          repParams
        ),
      ]);
      logger.info(`Batch inserted ${ordersToExpire.length} expiry messages + ${repValues.length} reputation events`);
    } catch (batchErr) {
      logger.warn('Failed to batch insert expiry messages/reputation events', { error: batchErr });
    }
  }

  return totalExpired;
}
