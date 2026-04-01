import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
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
    const tab = searchParams.get('tab'); // 'direct' | 'automated' | 'dispute' | 'all'

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Authorization check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType === 'merchant' && auth.actorId !== merchantId) {
      return forbiddenResponse('You can only access your own messages');
    }

    // Verify merchant exists and check compliance access
    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    const merchantRow = await query<{ has_compliance_access: boolean }>(
      'SELECT has_compliance_access FROM merchants WHERE id = $1',
      [merchantId]
    );
    const hasComplianceAccess = merchantRow[0]?.has_compliance_access === true;

    // Build the query for conversations (grouped by order)
    // Access: seller (merchant_id) OR buyer (buyer_merchant_id)
    // For dispute tab: also include all disputed orders if merchant has compliance access
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
        COALESCE(o.has_manual_message, false) as has_manual_message,
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
            'image_url', cm.image_url,
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
      WHERE (
        o.merchant_id = $1
        OR o.buyer_merchant_id = $1
        OR ($2::boolean = true AND o.status = 'disputed')
      )
    `;

    const queryParams: (string | number | boolean)[] = [merchantId, hasComplianceAccess];
    let paramIndex = 3;

    // Filter by order status
    if (orderStatus) {
      const statuses = orderStatus.split(',');
      conversationsQuery += ` AND o.status = ANY($${paramIndex}::text[])`;
      queryParams.push(statuses as unknown as string);
      paramIndex++;
    }

    // Filter by chat tab
    if (tab === 'direct') {
      conversationsQuery += ` AND COALESCE(o.has_manual_message, false) = true AND o.status != 'disputed'`;
    } else if (tab === 'automated') {
      conversationsQuery += ` AND COALESCE(o.has_manual_message, false) = false AND o.status != 'disputed'`;
    } else if (tab === 'dispute') {
      conversationsQuery += ` AND o.status = 'disputed'`;
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
      WHERE (o.merchant_id = $1 OR o.buyer_merchant_id = $1 OR ($2::boolean = true AND o.status = 'disputed'))
      AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.order_id = o.id)
    `;
    const countParams: (string | number | boolean)[] = [merchantId, hasComplianceAccess];

    if (orderStatus) {
      const statuses = orderStatus.split(',');
      countQuery += ` AND o.status = ANY($${countParams.length + 1}::text[])`;
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

    // Reusable access clause for all aggregate queries
    const accessClause = `(o.merchant_id = $1 OR o.buyer_merchant_id = $1 OR ($2::boolean = true AND o.status = 'disputed'))`;
    const accessParams: (string | boolean)[] = [merchantId, hasComplianceAccess];

    // Get total unread across all orders
    const unreadResult = await query(
      `SELECT COUNT(*)::int as total_unread
       FROM chat_messages cm
       JOIN orders o ON cm.order_id = o.id
       WHERE ${accessClause} AND cm.sender_type != 'merchant' AND cm.is_read = false`,
      accessParams
    );
    const totalUnread = (unreadResult[0] as { total_unread?: number })?.total_unread || 0;

    // Get tab counts and unread counts per tab
    const tabCountsResult = await query(
      `SELECT
        COUNT(*) FILTER (WHERE COALESCE(o.has_manual_message, false) = true AND o.status != 'disputed')::int as direct_count,
        COUNT(*) FILTER (WHERE COALESCE(o.has_manual_message, false) = false AND o.status != 'disputed')::int as automated_count,
        COUNT(*) FILTER (WHERE o.status = 'disputed')::int as dispute_count
       FROM orders o
       WHERE ${accessClause}
         AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.order_id = o.id)`,
      accessParams
    );
    const tabCounts = tabCountsResult[0] as { direct_count: number; automated_count: number; dispute_count: number } || { direct_count: 0, automated_count: 0, dispute_count: 0 };

    // Get unread counts per tab
    const tabUnreadResult = await query(
      `SELECT
        COUNT(*) FILTER (WHERE COALESCE(o.has_manual_message, false) = true AND o.status != 'disputed')::int as direct_unread,
        COUNT(*) FILTER (WHERE COALESCE(o.has_manual_message, false) = false AND o.status != 'disputed')::int as automated_unread,
        COUNT(*) FILTER (WHERE o.status = 'disputed')::int as dispute_unread
       FROM chat_messages cm
       JOIN orders o ON cm.order_id = o.id
       WHERE ${accessClause} AND cm.sender_type != 'merchant' AND cm.is_read = false`,
      accessParams
    );
    const tabUnread = tabUnreadResult[0] as { direct_unread: number; automated_unread: number; dispute_unread: number } || { direct_unread: 0, automated_unread: 0, dispute_unread: 0 };

    return successResponse({
      conversations: conversationsResult,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      totalUnread,
      tabCounts: {
        direct: tabCounts.direct_count,
        automated: tabCounts.automated_count,
        dispute: tabCounts.dispute_count,
        directUnread: tabUnread.direct_unread,
        automatedUnread: tabUnread.automated_unread,
        disputeUnread: tabUnread.dispute_unread,
      },
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
