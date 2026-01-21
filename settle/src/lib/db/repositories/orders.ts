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
import { recordReputationEvent } from '../../reputation';

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
              'name', u.name,
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
             'total_trades', m.total_trades
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
  let sql = `
    SELECT o.*,
           json_build_object(
             'id', u.id,
             'name', u.name,
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

  return query<OrderWithRelations>(sql, params);
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
}): Promise<Order> {
  return transaction(async (client) => {
    // Create the order with explicit 'pending' status
    const result = await client.query(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, rate, payment_details,
         status, expires_at, buyer_wallet_address
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW() + INTERVAL '2 hours', $10)
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
      ]
    );

    const order = result.rows[0] as Order;

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

      // Build update query with appropriate timestamp
      let timestampField = '';
      switch (newStatus) {
        case 'accepted':
          timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '30 minutes'";
          break;
        case 'escrowed':
          timestampField = ", escrowed_at = NOW(), expires_at = NOW() + INTERVAL '2 hours'";
          break;
        case 'payment_sent':
          timestampField = ", payment_sent_at = NOW(), expires_at = NOW() + INTERVAL '4 hours'";
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
      let sql = `UPDATE orders SET status = $1${timestampField} WHERE id = $2 RETURNING *`;

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

      return { success: true, order: updatedOrder };
    });
  } catch (error) {
    logger.order.error(orderId, 'updateStatus', error as Error);
    return { success: false, error: 'Failed to update order status' };
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
        WHEN cm.sender_type = 'user' THEN u.name
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

// Expired orders cleanup
export async function expireOldOrders(): Promise<number> {
  const result = await query(
    `UPDATE orders
     SET status = 'expired', cancelled_at = NOW(), cancelled_by = 'system', cancellation_reason = 'Timed out'
     WHERE status IN ('pending', 'accepted', 'escrowed', 'payment_pending', 'payment_sent')
       AND expires_at < NOW()
     RETURNING id`
  );
  return result.length;
}
