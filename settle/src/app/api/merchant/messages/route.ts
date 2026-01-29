import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  getAuthContext,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

/**
 * GET /api/merchant/messages
 *
 * Retrieves all messages across all orders for a merchant
 * Grouped by order with order metadata for message history view
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const orderStatus = searchParams.get('order_status'); // Filter by order status
    const search = searchParams.get('search'); // Search in message content

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only access your own messages');
      }
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    // Build the query for conversations (grouped by order)
    let conversationsQuery = `
      SELECT
        o.id as order_id,
        o.order_number,
        o.status as order_status,
        o.type as order_type,
        o.crypto_amount,
        o.fiat_amount,
        o.fiat_currency,
        o.created_at as order_created_at,
        json_build_object(
          'id', u.id,
          'username', u.username,
          'rating', u.rating,
          'total_trades', u.total_trades
        ) as user,
        (
          SELECT COUNT(*)::int
          FROM chat_messages cm
          WHERE cm.order_id = o.id
        ) as message_count,
        (
          SELECT COUNT(*)::int
          FROM chat_messages cm
          WHERE cm.order_id = o.id AND cm.sender_type != 'merchant' AND cm.is_read = false
        ) as unread_count,
        (
          SELECT json_build_object(
            'id', cm.id,
            'content', cm.content,
            'sender_type', cm.sender_type,
            'message_type', cm.message_type,
            'created_at', cm.created_at,
            'is_read', cm.is_read
          )
          FROM chat_messages cm
          WHERE cm.order_id = o.id
          ORDER BY cm.created_at DESC
          LIMIT 1
        ) as last_message,
        (
          SELECT MAX(cm.created_at)
          FROM chat_messages cm
          WHERE cm.order_id = o.id
        ) as last_activity
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.merchant_id = $1
    `;

    const queryParams: (string | number)[] = [merchantId];
    let paramIndex = 2;

    // Filter by order status
    if (orderStatus) {
      const statuses = orderStatus.split(',');
      conversationsQuery += ` AND o.status = ANY($${paramIndex}::text[])`;
      queryParams.push(statuses as unknown as string);
      paramIndex++;
    }

    // Only include orders with messages
    conversationsQuery += ` AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.order_id = o.id)`;

    // Search in messages
    if (search) {
      conversationsQuery += ` AND EXISTS (
        SELECT 1 FROM chat_messages cm
        WHERE cm.order_id = o.id AND cm.content ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Order by last activity and paginate
    conversationsQuery += `
      ORDER BY last_activity DESC NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const conversationsResult = await query(conversationsQuery, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT o.id)::int as total
      FROM orders o
      WHERE o.merchant_id = $1
      AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.order_id = o.id)
    `;
    const countParams: (string | number)[] = [merchantId];

    if (orderStatus) {
      const statuses = orderStatus.split(',');
      countQuery += ` AND o.status = ANY($2::text[])`;
      countParams.push(statuses as unknown as string);
    }

    if (search) {
      countQuery += ` AND EXISTS (
        SELECT 1 FROM chat_messages cm
        WHERE cm.order_id = o.id AND cm.content ILIKE $${countParams.length + 1}
      )`;
      countParams.push(`%${search}%`);
    }

    const countResult = await query(countQuery, countParams);
    const total = (countResult[0] as { total?: number })?.total || 0;

    // Get total unread across all orders
    const unreadResult = await query(
      `SELECT COUNT(*)::int as total_unread
       FROM chat_messages cm
       JOIN orders o ON cm.order_id = o.id
       WHERE o.merchant_id = $1 AND cm.sender_type != 'merchant' AND cm.is_read = false`,
      [merchantId]
    );
    const totalUnread = (unreadResult[0] as { total_unread?: number })?.total_unread || 0;

    return successResponse({
      conversations: conversationsResult,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      totalUnread,
    });
  } catch (error) {
    console.error('Error fetching merchant messages:', error);
    return errorResponse('Internal server error');
  }
}

/**
 * GET /api/merchant/messages?order_id=xxx
 *
 * Alternative: Get all messages for a specific order
 * This is handled by /api/orders/[id]/messages but duplicated here for convenience
 */
