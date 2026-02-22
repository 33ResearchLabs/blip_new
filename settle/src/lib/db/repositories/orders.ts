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
import { MOCK_MODE } from '../../config/mockMode';
import { updateOfferAvailability, restoreOfferAvailability } from './merchants';
import { incrementUserStats } from './users';
import {
  validateTransition,
  shouldRestoreLiquidity,
  getTransitionEventType,
  isTerminalStatus,
} from '../../orders/stateMachine';
import {
  normalizeStatus,
  validateStatusWrite,
  isTransientStatus,
} from '../../orders/statusNormalizer';
import { logger } from '../../logger';
import { notifyNewMessage, notifyOrderStatusUpdated } from '../../pusher/server';
import { recordReputationEvent } from '../../reputation';
import { upsertMerchantContact } from './directMessages';

// Result type for status updates
export interface StatusUpdateResult {
  success: boolean;
  order?: Order;
  error?: string;
}

// Orders
export async function getOrderById(id: string): Promise<Order | null> {
  return queryOne<Order>('SELECT * FROM orders WHERE id = $1', [id]);
}

export async function getOrderByNumber(orderNumber: string): Promise<Order | null> {
  return queryOne<Order>('SELECT * FROM orders WHERE order_number = $1', [orderNumber]);
}

export async function getOrderWithRelations(id: string): Promise<OrderWithRelations | null> {
  return queryOne<OrderWithRelations>(
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
            ) as offer
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN merchants m ON o.merchant_id = m.id
     JOIN merchant_offers mo ON o.offer_id = mo.id
     LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
     WHERE o.id = $1`,
    [id]
  );
}

export async function getUserOrders(
  userId: string,
  status?: OrderStatus[]
): Promise<OrderWithRelations[]> {
  let sql = `
    SELECT o.*,
           json_build_object(
             'id', m.id,
             'display_name', m.display_name,
             'rating', m.rating,
             'total_trades', m.total_trades,
             'wallet_address', m.wallet_address
           ) as merchant,
           json_build_object(
             'payment_method', mo.payment_method,
             'location_name', mo.location_name
           ) as offer,
           COALESCE((
             SELECT COUNT(*)::int FROM chat_messages cm
             WHERE cm.order_id = o.id
               AND cm.sender_type = 'merchant'
               AND cm.message_type != 'system'
               AND cm.is_read = false
           ), 0) as unread_count,
           (
             SELECT json_build_object(
               'content', cm.content,
               'sender_type', cm.sender_type,
               'created_at', cm.created_at
             )
             FROM chat_messages cm
             WHERE cm.order_id = o.id
               AND cm.message_type != 'system'
               AND cm.sender_type != 'system'
             ORDER BY cm.created_at DESC
             LIMIT 1
           ) as last_message
    FROM orders o
    JOIN merchants m ON o.merchant_id = m.id
    JOIN merchant_offers mo ON o.offer_id = mo.id
    WHERE o.user_id = $1
      AND o.status NOT IN ('expired', 'cancelled')
  `;

  const params: unknown[] = [userId];

  if (status && status.length > 0) {
    sql += ` AND o.status = ANY($2)`;
    params.push(status);
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
             'name', CASE WHEN u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%' THEN m.display_name ELSE COALESCE(u.name, u.username) END,
             'username', u.username,
             'rating', u.rating,
             'total_trades', u.total_trades
           ) as user,
           json_build_object(
             'payment_method', mo.payment_method,
             'location_name', mo.location_name
           ) as offer
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN merchants m ON o.merchant_id = m.id
    JOIN merchant_offers mo ON o.offer_id = mo.id
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
           -- is_my_order: backward compat (true if I'm buyer or seller, not observer)
           CASE
             WHEN o.buyer_merchant_id = $1 THEN true
             WHEN o.merchant_id = $1 AND o.accepted_at IS NOT NULL THEN true
             WHEN o.merchant_id = $1 AND (u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%') THEN true
             WHEN o.escrow_creator_wallet IS NOT NULL AND LOWER(o.escrow_creator_wallet) = LOWER(current_m.wallet_address) THEN true
             ELSE false
           END as is_my_order,
           json_build_object(
             'id', u.id,
             'name', CASE WHEN u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%' THEN m.display_name ELSE COALESCE(u.name, u.username) END,
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
           COALESCE((
             SELECT COUNT(*)::int FROM chat_messages cm
             WHERE cm.order_id = o.id
               AND cm.sender_type != 'merchant'
               AND cm.sender_type != 'system'
               AND cm.message_type != 'system'
               AND cm.is_read = false
           ), 0) as unread_count,
           (SELECT COUNT(*)::int FROM chat_messages cm WHERE cm.order_id = o.id AND cm.message_type != 'system') as message_count,
           (SELECT cm.content FROM chat_messages cm
             WHERE cm.order_id = o.id
               AND cm.message_type != 'system'
               AND cm.sender_type != 'system'
             ORDER BY cm.created_at DESC LIMIT 1
           ) as last_human_message,
           (SELECT cm.sender_type FROM chat_messages cm
             WHERE cm.order_id = o.id
               AND cm.message_type != 'system'
               AND cm.sender_type != 'system'
             ORDER BY cm.created_at DESC LIMIT 1
           ) as last_human_message_sender
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN merchants m ON o.merchant_id = m.id
    JOIN merchant_offers mo ON o.offer_id = mo.id
    LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
    LEFT JOIN merchants current_m ON current_m.id = $1
    WHERE (
        -- PENDING or ESCROWED orders: ALL merchants can see (New Orders - broadcast model)
        -- Exclude expired/cancelled from broadcast pool
        (o.status IN ('pending', 'escrowed') AND o.status NOT IN ('expired', 'cancelled'))

        -- All orders where I'm the merchant (include ALL statuses so merchant sees completed/cancelled/escrowed)
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

  sql += ' ORDER BY o.created_at DESC';

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

    // Determine initial status: 'escrowed' if escrow details provided, otherwise 'pending'
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

    // Reserve liquidity
    await client.query(
      'UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2',
      [data.crypto_amount, data.offer_id]
    );

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
      // This covers: escrowed orders AND pending orders created by a merchant (not a user)
      const isM2MAcceptance =
        actorType === 'merchant' &&
        (oldStatus === 'escrowed' || oldStatus === 'pending') &&
        (newStatus === 'accepted' || newStatus === 'payment_pending') &&
        currentOrder.merchant_id !== actorId;

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
            if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) || (MOCK_MODE && wallet.length > 0)) {
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
        case 'payment_sent':
          timestampField = ", payment_sent_at = NOW()";
          break;
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
          // No special timestamp for disputed
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

      // Build parameterized query: $1=status, $2..N=dynamic values, $N+1=orderId
      const updateParams: unknown[] = [effectiveStatus, ...dynamicParams, orderId];
      const whereParam = nextParam;
      let sql = `UPDATE orders SET status = $1${timestampField}${merchantReassign}${acceptorWalletUpdate}${buyerMerchantUpdate} WHERE id = $${whereParam} RETURNING *`;

      const updateResult = await client.query(sql, updateParams);
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

        // NOTE: Escrow lock/release handle the main balance movements.
        // Platform fee deduction happens here on completion (MOCK_MODE only).
        if (MOCK_MODE && currentOrder.escrow_tx_hash) {
          try {
            const { deductPlatformFee } = await import('@/lib/money/platformFee');
            await deductPlatformFee(client, {
              id: orderId,
              order_number: currentOrder.order_number,
              crypto_amount: parseFloat(String(currentOrder.crypto_amount)),
              protocol_fee_percentage: currentOrder.protocol_fee_percentage,
              spread_preference: currentOrder.spread_preference,
              escrow_debited_entity_type: currentOrder.escrow_debited_entity_type,
              escrow_debited_entity_id: currentOrder.escrow_debited_entity_id,
              merchant_id: currentOrder.merchant_id,
            });
          } catch (feeErr) {
            logger.error('Failed to deduct platform fee on completion', { orderId, error: feeErr });
          }
        }

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

// Order Events
export async function getOrderEvents(orderId: string): Promise<OrderEvent[]> {
  return query<OrderEvent>(
    'SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId]
  );
}

// Chat Messages
export async function getOrderMessages(orderId: string): Promise<ChatMessage[]> {
  // Join with users and merchants to get sender names
  return query<ChatMessage>(
    `SELECT
      cm.*,
      CASE
        WHEN cm.sender_type = 'user' THEN u.username
        WHEN cm.sender_type = 'merchant' THEN m.display_name
        WHEN cm.sender_type = 'compliance' THEN ct.name
        ELSE 'System'
      END as sender_name
    FROM chat_messages cm
    LEFT JOIN users u ON cm.sender_type = 'user' AND cm.sender_id = u.id::text
    LEFT JOIN merchants m ON cm.sender_type = 'merchant' AND cm.sender_id = m.id::text
    LEFT JOIN compliance_team ct ON cm.sender_type = 'compliance' AND cm.sender_id = ct.id::text
    WHERE cm.order_id = $1
      AND cm.sender_type != 'system'
      AND cm.message_type != 'system'
    ORDER BY cm.created_at ASC`,
    [orderId]
  );
}

export async function sendMessage(data: {
  order_id: string;
  sender_type: ActorType;
  sender_id: string;
  content: string;
  message_type?: 'text' | 'image' | 'system';
  image_url?: string;
}): Promise<ChatMessage> {
  const result = await queryOne<ChatMessage>(
    `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, image_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.order_id,
      data.sender_type,
      data.sender_id,
      data.content,
      data.message_type || 'text',
      data.image_url || null,
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
           cancelled_at = NOW(),
           cancelled_by = 'system',
           cancellation_reason = 'Order expired - no one accepted within 15 minutes'
       WHERE id = ANY($1)
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
         cancelled_at = NOW(),
         cancelled_by = 'system',
         cancellation_reason = CASE
           WHEN escrow_tx_hash IS NOT NULL THEN 'Order timeout - moved to dispute (escrow locked)'
           ELSE 'Order timeout - cancelled (no escrow)'
         END
       WHERE id = ANY($1)
       RETURNING id`,
      [acceptedIds]
    );
    totalExpired += updateResult?.length || 0;
  }

  // Mock mode: refund escrowed amounts back to the recorded escrow payer
  if (MOCK_MODE) {
    for (const order of ordersToExpire) {
      if (order.escrow_tx_hash) {
        // Use recorded debit fields (deterministic); fallback to inference for pre-migration orders
        const debitType = order.escrow_debited_entity_type;
        const debitId = order.escrow_debited_entity_id;
        const debitAmount = order.escrow_debited_amount != null
          ? parseFloat(String(order.escrow_debited_amount))
          : parseFloat(String(order.crypto_amount));

        let refundId: string;
        let refundTable: 'merchants' | 'users';
        let refundEntityType: 'merchant' | 'user';

        if (debitType && debitId) {
          refundId = debitId;
          refundTable = debitType === 'merchant' ? 'merchants' : 'users';
          refundEntityType = debitType;
        } else {
          // Legacy fallback
          const isBuyOrder = order.type === 'buy';
          const isM2M = !!order.buyer_merchant_id;
          if (isM2M) {
            refundId = order.merchant_id;
            refundTable = 'merchants';
            refundEntityType = 'merchant';
          } else {
            refundId = isBuyOrder ? order.merchant_id : order.user_id;
            refundTable = isBuyOrder ? 'merchants' : 'users';
            refundEntityType = isBuyOrder ? 'merchant' : 'user';
          }
          logger.warn('[Expiry] Used legacy inference for refund — order missing escrow_debited fields', { orderId: order.id });
        }

        try {
          await query(
            `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
            [debitAmount, refundId]
          );

          // Ledger entry for refund
          await query(
            `INSERT INTO ledger_entries
             (account_type, account_id, entry_type, amount, asset,
              related_order_id, description, metadata, balance_before, balance_after)
             SELECT $1, $2, 'ESCROW_REFUND', $3, 'USDT', $4,
                    'Escrow refunded on expiry for order #' || $5,
                    $6::jsonb,
                    balance - $3, balance
             FROM ${refundTable} WHERE id = $2`,
            [
              refundEntityType,
              refundId,
              debitAmount,
              order.id,
              order.order_number,
              JSON.stringify({ reason: 'Order timeout/expiry' }),
            ]
          );

          // Transaction log entry for refund
          await query(
            `INSERT INTO merchant_transactions
             (merchant_id, user_id, order_id, type, amount, balance_before, balance_after, description)
             SELECT $1, $2, $3, 'escrow_refund', $4,
                    balance - $4, balance,
                    'Escrow refund on expiry for order #' || $5
             FROM ${refundTable} WHERE id = $6`,
            [
              refundEntityType === 'merchant' ? refundId : null,
              refundEntityType === 'user' ? refundId : null,
              order.id,
              debitAmount,
              order.order_number,
              refundId,
            ]
          );

          logger.info('[Mock] Refunded escrow on expiry', {
            orderId: order.id,
            refundId,
            refundEntityType,
            debitAmount,
            usedRecordedFields: !!(debitType && debitId),
          });
        } catch (refundErr) {
          logger.error('[Mock] Failed to refund on expiry', { orderId: order.id, error: refundErr });
        }
      }
    }
  }

  // Record reputation events and send system messages for each expired order
  for (const order of ordersToExpire) {
    const isEscrowLocked = ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status);
    const isPending = order.status === 'pending';
    const eventType = isEscrowLocked ? 'order_disputed' : 'order_timeout';
    const timeout = isPending ? '15 minutes' : '120 minutes';
    const reason = `Order timeout - not completed within ${timeout} (was in ${order.status} status)`;

    try {
      // Send system message about expiration
      const expiryMessage = isEscrowLocked
        ? `⏰ Order expired - moved to dispute for resolution (escrow was locked)`
        : isPending
          ? `⏰ Order expired - no one accepted within 15 minutes`
          : `⏰ Order expired - not completed within 120 minutes after acceptance`;

      const savedMessage = await sendMessage({
        order_id: order.id,
        sender_type: 'system',
        sender_id: order.id,
        content: expiryMessage,
        message_type: 'system',
      });

      // Send real-time notification for the system message
      notifyNewMessage({
        orderId: order.id,
        messageId: savedMessage.id,
        senderType: 'system',
        senderId: order.id,
        content: expiryMessage,
        messageType: 'system',
        createdAt: savedMessage.created_at.toISOString(),
      });

      // Notify parties about the status change via Pusher
      const newStatus = isEscrowLocked ? 'disputed' : 'cancelled';
      notifyOrderStatusUpdated({
        orderId: order.id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        status: newStatus,
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
      });

      // Also notify the buyer merchant if this is an M2M trade
      if (order.buyer_merchant_id) {
        notifyOrderStatusUpdated({
          orderId: order.id,
          userId: order.user_id,
          merchantId: order.buyer_merchant_id,
          status: newStatus,
          previousStatus: order.status,
          updatedAt: new Date().toISOString(),
        });
      }

      // Record event for user
      await recordReputationEvent(
        order.user_id,
        'user',
        eventType,
        reason,
        { orderId: order.id, previousStatus: order.status, amount: order.fiat_amount, currency: order.fiat_currency }
      );

      // Record event for merchant
      await recordReputationEvent(
        order.merchant_id,
        'merchant',
        eventType,
        reason,
        { orderId: order.id, previousStatus: order.status, amount: order.fiat_amount, currency: order.fiat_currency }
      );

      logger.info('Recorded reputation events for expired order', {
        orderId: order.id,
        eventType,
        userId: order.user_id,
        merchantId: order.merchant_id,
      });
    } catch (repErr) {
      logger.warn('Failed to record reputation events for expired order', { orderId: order.id, error: repErr });
    }
  }

  return totalExpired;
}
