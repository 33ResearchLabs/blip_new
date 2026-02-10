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
} from '../../orders/stateMachine';
import { logger } from '../../logger';
import { notifyNewMessage } from '../../pusher/server';
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
              'name', u.username,
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
           json_build_object(
             'id', u.id,
             'name', u.username,
             'rating', u.rating,
             'total_trades', u.total_trades
           ) as user,
           json_build_object(
             'payment_method', mo.payment_method,
             'location_name', mo.location_name
           ) as offer
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN merchant_offers mo ON o.offer_id = mo.id
    WHERE o.merchant_id = $1
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
  // - For pending/escrowed orders: ALWAYS false (no one has accepted yet, all can see in New Orders)
  // - For accepted+ orders: true if I'm the merchant who accepted OR I'm the buyer_merchant (M2M)
  // This ensures user sell orders with escrow show in "New Orders" for ALL merchants
  let sql = `
    SELECT o.*,
           CASE
             -- Pending/escrowed orders: NEVER "my order" - available for any merchant to accept
             WHEN o.status IN ('pending', 'escrowed') THEN false
             -- After acceptance: it's my order if I'm assigned merchant OR buyer_merchant (M2M)
             ELSE ((o.merchant_id = $1 AND o.accepted_at IS NOT NULL) OR o.buyer_merchant_id = $1)
           END as is_my_order,
           json_build_object(
             'id', u.id,
             'name', u.username,
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
               AND cm.is_read = false
           ), 0) as unread_count,
           (SELECT COUNT(*)::int FROM chat_messages cm WHERE cm.order_id = o.id) as message_count
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN merchants m ON o.merchant_id = m.id
    JOIN merchant_offers mo ON o.offer_id = mo.id
    LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
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
}): Promise<Order> {
  return transaction(async (client) => {
    console.log('[DB] createOrder called with:', {
      user_id: data.user_id,
      merchant_id: data.merchant_id,
      offer_id: data.offer_id,
      type: data.type,
      crypto_amount: data.crypto_amount,
    });

    // Create the order with explicit 'pending' status
    // Note: buyer_merchant_id column requires migration 007
    const result = await client.query(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, rate, payment_details,
         status, expires_at, buyer_wallet_address, buyer_merchant_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW() + INTERVAL '15 minutes', $10, $11)
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
        data.buyer_wallet_address || null,
        data.buyer_merchant_id || null,
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

      // Check if this is M2M acceptance (merchant accepting another merchant's escrowed order)
      // In M2M: seller stays as merchant_id, buyer becomes buyer_merchant_id
      const isM2MAcceptance =
        actorType === 'merchant' &&
        oldStatus === 'escrowed' &&
        (newStatus === 'accepted' || newStatus === 'payment_pending') &&
        currentOrder.merchant_id !== actorId;

      // Build update query with appropriate timestamp
      let timestampField = '';
      let merchantReassign = '';
      let acceptorWalletUpdate = '';
      let buyerMerchantUpdate = '';
      switch (newStatus) {
        case 'accepted':
          // Note: expires_at stays at original 15 mins from creation (global timeout)
          timestampField = ", accepted_at = NOW()";
          // If a different merchant is claiming, reassign the order to them
          // Note: We do NOT set buyer_merchant_id here - that field is ONLY for M2M trades
          // where a merchant is the buyer (set at order creation time)
          if (isMerchantClaiming) {
            merchantReassign = `, merchant_id = '${actorId}'`;
            logger.info('Merchant claiming order', {
              orderId,
              previousMerchantId: currentOrder.merchant_id,
              newMerchantId: actorId,
            });
          }
          // For M2M: set buyer_merchant_id instead of reassigning merchant_id
          if (isM2MAcceptance) {
            buyerMerchantUpdate = `, buyer_merchant_id = '${actorId}'`;
            merchantReassign = ''; // Don't reassign - seller stays as merchant_id
            logger.info('M2M acceptance: setting buyer_merchant_id', {
              orderId,
              sellerMerchantId: currentOrder.merchant_id,
              buyerMerchantId: actorId,
            });
          }
          // Store acceptor's wallet address when accepting (for sell orders with escrow)
          if (metadata?.acceptor_wallet_address) {
            // Sanitize: only allow valid Solana addresses
            const wallet = String(metadata.acceptor_wallet_address);
            if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
              acceptorWalletUpdate = `, acceptor_wallet_address = '${wallet}'`;
              logger.info('Storing acceptor wallet address', {
                orderId,
                acceptorWallet: wallet,
              });
            }
          }
          break;
        case 'escrowed':
          // Note: expires_at stays at original 15 mins from creation (global timeout)
          timestampField = ", escrowed_at = NOW()";
          break;
        case 'payment_pending':
          // M2M flow: when merchant accepts escrowed order and goes directly to payment_pending
          // This skips 'accepted' state, so we need to set accepted_at here too
          if (isM2MAcceptance) {
            timestampField = ", accepted_at = NOW()";
            buyerMerchantUpdate = `, buyer_merchant_id = '${actorId}'`;
            logger.info('M2M direct acceptance to payment_pending', {
              orderId,
              sellerMerchantId: currentOrder.merchant_id,
              buyerMerchantId: actorId,
            });
            // Store acceptor's wallet address
            if (metadata?.acceptor_wallet_address) {
              const wallet = String(metadata.acceptor_wallet_address);
              if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
                acceptorWalletUpdate = `, acceptor_wallet_address = '${wallet}'`;
              }
            }
          }
          break;
        case 'payment_sent':
          // Note: expires_at stays at original 15 mins from creation (global timeout)
          timestampField = ", payment_sent_at = NOW()";
          break;
        case 'payment_confirmed':
          timestampField = ', payment_confirmed_at = NOW()';
          break;
        case 'completed':
          timestampField = ', completed_at = NOW()';
          break;
        case 'cancelled':
          timestampField = ', cancelled_at = NOW(), cancelled_by = $4, cancellation_reason = $5';
          break;
        case 'expired':
          timestampField = ", cancelled_at = NOW(), cancelled_by = 'system', cancellation_reason = 'Timed out'";
          break;
        case 'disputed':
          // No special timestamp for disputed
          break;
      }

      const updateParams: unknown[] = [newStatus, orderId];
      let sql = `UPDATE orders SET status = $1${timestampField}${merchantReassign}${acceptorWalletUpdate}${buyerMerchantUpdate} WHERE id = $2 RETURNING *`;

      if (newStatus === 'cancelled') {
        updateParams.push(actorType, metadata?.reason || null);
      }

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

        // Update merchant balance (display-only tracking - actual funds are on-chain)
        // Sell order: merchant sold crypto, balance decreases
        // Buy order: merchant bought crypto, balance increases
        const balanceChange = currentOrder.type === 'sell'
          ? -currentOrder.crypto_amount  // Merchant sold crypto
          : currentOrder.crypto_amount;   // Merchant bought crypto

        await client.query(
          `UPDATE merchants SET balance = balance + $1 WHERE id = $2`,
          [balanceChange, currentOrder.merchant_id]
        );
        logger.info('Merchant balance updated', {
          orderId,
          merchantId: currentOrder.merchant_id,
          orderType: currentOrder.type,
          balanceChange,
        });

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
      logger.order.statusChanged(orderId, oldStatus, newStatus, actorType, actorId);

      // Send system message to chat for this status change (use client within transaction)
      try {
        const statusMessage = getStatusChangeMessage(newStatus, updatedOrder, actorType, metadata);
        if (statusMessage) {
          await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $2, $3, 'system')`,
            [orderId, orderId, statusMessage]
          );
        }

        // Auto-send bank info message when order is accepted (for bank payment method)
        if (newStatus === 'accepted' && updatedOrder.payment_method === 'bank') {
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
        if (newStatus === 'escrowed' && updatedOrder.escrow_tx_hash) {
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
        if (newStatus === 'completed' && updatedOrder.release_tx_hash) {
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

// Expired orders cleanup - Global 15-minute timeout from creation
export async function expireOldOrders(): Promise<number> {
  // First, get the orders that will be expired (we need user_id and merchant_id for reputation)
  const ordersToExpire = await query<{
    id: string;
    user_id: string;
    merchant_id: string;
    status: string;
    fiat_amount: number;
    fiat_currency: string;
  }>(
    `SELECT id, user_id, merchant_id, status, fiat_amount, fiat_currency
     FROM orders
     WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
       AND created_at < NOW() - INTERVAL '15 minutes'`
  );

  if (ordersToExpire.length === 0) {
    return 0;
  }

  // Update the orders to cancelled/disputed
  const result = await query(
    `UPDATE orders
     SET
       status = CASE
         -- If escrow is locked, go to disputed for manual resolution
         WHEN status IN ('escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing') THEN 'disputed'::order_status
         -- Otherwise just cancel
         ELSE 'cancelled'::order_status
       END,
       cancelled_at = NOW(),
       cancelled_by = 'system',
       cancellation_reason = 'Order timeout - not completed within 15 minutes'
     WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
       AND created_at < NOW() - INTERVAL '15 minutes'
     RETURNING id`
  );

  // Record reputation events and send system messages for each expired order
  for (const order of ordersToExpire) {
    const isEscrowLocked = ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status);
    const eventType = isEscrowLocked ? 'order_disputed' : 'order_timeout';
    const reason = `Order timeout - not completed within 15 minutes (was in ${order.status} status)`;

    try {
      // Send system message about expiration
      const expiryMessage = isEscrowLocked
        ? `⏰ Order expired - moved to dispute for resolution (escrow was locked)`
        : `⏰ Order expired - not completed within 15 minutes`;

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

  return result.length;
}
