import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
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

    // Combined merchant lookup — was 2 separate round-trips (verifyMerchant +
    // compliance check). One query halves the auth latency on every chat-list
    // refresh (this endpoint polls every ~15s when Pusher is offline).
    const merchantRow = await query<{ id: string; has_compliance_access: boolean | null; status: string }>(
      'SELECT id, COALESCE(has_compliance_access, false) as has_compliance_access, COALESCE(status, $2) as status FROM merchants WHERE id = $1',
      [merchantId, 'active']
    );
    if (merchantRow.length === 0 || merchantRow[0].status !== 'active') {
      return validationErrorResponse(['Merchant not found']);
    }
    const hasComplianceAccess = merchantRow[0].has_compliance_access === true;

    // Build the query for conversations (grouped by order).
    // Access: seller (merchant_id) OR buyer (buyer_merchant_id).
    // For dispute tab: also include all disputed orders if merchant has compliance access.
    //
    // Performance notes:
    //  - Was 4 correlated subqueries per row (count, unread, last_message,
    //    last_activity). With limit=50 → 200 sub-selects per request.
    //  - Now uses denormalized order columns (last_message_at,
    //    last_message_preview, last_message_sender_type) for the latest-msg
    //    info, and a single LATERAL for unread count which has the index
    //    (order_id, sender_type, is_read).
    //  - last_message.id is no longer returned because it wasn't being read
    //    by the frontend (verified: MerchantChatTabs uses sender_type +
    //    content + created_at + is_read only).
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
        COALESCE(unread.cnt, 0) as message_count,
        COALESCE(unread.unread, 0) as unread_count,
        CASE WHEN o.last_message_preview IS NOT NULL THEN
          json_build_object(
            'id', NULL,
            'content', o.last_message_preview,
            'sender_type', o.last_message_sender_type,
            'message_type', 'text',
            'image_url', NULL,
            'created_at', o.last_message_at,
            'is_read', COALESCE(unread.unread, 0) = 0
          )
        ELSE NULL END as last_message,
        o.last_message_at as last_activity
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int as cnt,
          COUNT(*) FILTER (WHERE cm.sender_type != 'merchant' AND cm.is_read = false)::int as unread
        FROM chat_messages cm
        WHERE cm.order_id = o.id
      ) unread ON true
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

    // Only include orders that have at least one message. Uses the
    // denormalized last_message_at column (set on every chat insert) so we
    // avoid a per-row EXISTS sub-select on chat_messages.
    conversationsQuery += ` AND o.last_message_at IS NOT NULL`;

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
      SELECT COUNT(*)::int as total
      FROM orders o
      WHERE (o.merchant_id = $1 OR o.buyer_merchant_id = $1 OR ($2::boolean = true AND o.status = 'disputed'))
      AND o.last_message_at IS NOT NULL
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
