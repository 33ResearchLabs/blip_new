/**
 * POST /api/merchant/messages/mark-all-read
 *
 * Marks every unread incoming chat message across every order accessible to
 * this merchant as read in a single SQL statement.
 *
 * Motivation: the MerchantChatTabs "Mark all read" button used to loop over
 * local conversations and fire optimistic per-order updates, but nothing
 * actually persisted on the server. The next poll (15s) re-fetched the
 * unchanged is_read=false rows and the badge came right back. This endpoint
 * closes that loop with a single round-trip.
 *
 * Scope:
 *   - Orders where the caller is merchant_id OR buyer_merchant_id.
 *   - Messages where sender is NOT the caller (NOT (sender_type='merchant'
 *     AND sender_id = <caller>)) — so M2M orders correctly mark the other
 *     merchant's messages read without touching the caller's own outgoing
 *     messages.
 *   - is_read = false only (no-op on already-read rows).
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  forbiddenResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { clearAllMerchantUnreads } from '@/lib/chat/unreadCounters';
import { triggerEvent } from '@/lib/pusher/server';
import { getMerchantChannel } from '@/lib/pusher/channels';
import { CHAT_EVENTS } from '@/lib/pusher/events';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.merchantId) {
      return forbiddenResponse('Only merchants can mark their own inbox as read.');
    }
    const merchantId = auth.merchantId;

    const rows = await query<{ id: string }>(
      `UPDATE chat_messages cm
       SET is_read = true,
           read_at = COALESCE(read_at, NOW()),
           status  = CASE WHEN status IN ('sent','delivered') THEN 'seen' ELSE status END
       FROM orders o
       WHERE cm.order_id = o.id
         AND (o.merchant_id = $1 OR o.buyer_merchant_id = $1)
         AND NOT (cm.sender_type = 'merchant' AND cm.sender_id = $1)
         AND cm.is_read = false
       RETURNING cm.id`,
      [merchantId]
    );

    const marked = rows.length;

    // Best-effort clean-up. Redis counters and Pusher sync are secondary to
    // the DB update above — they recover on the next poll if they fail.
    clearAllMerchantUnreads(merchantId).catch(() => {});

    if (marked > 0) {
      triggerEvent(getMerchantChannel(merchantId), CHAT_EVENTS.MESSAGES_READ, {
        scope: 'inbox',
        merchantId,
        markedCount: marked,
        readAt: new Date().toISOString(),
      }).catch(() => {});
    }

    return successResponse({ marked });
  } catch (error) {
    console.error('[merchant/messages/mark-all-read] error', error);
    return errorResponse('Internal server error');
  }
}
