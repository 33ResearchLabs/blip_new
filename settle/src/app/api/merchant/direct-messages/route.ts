import { NextRequest, NextResponse } from 'next/server';
import {
  getMerchantDirectConversations,
  getDirectMessages,
  sendDirectMessage,
  markDirectMessagesAsRead,
  getMerchantUnreadDirectCount,
} from '@/lib/db/repositories/directMessages';
import { notifyNewDirectMessage, notifyNewMessage } from '@/lib/pusher/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

// GET /api/merchant/direct-messages - Get conversations or messages
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const userId = searchParams.get('target_id') || searchParams.get('user_id'); // Get messages with this person

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Authorization check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType === 'merchant' && auth.actorId !== merchantId) {
      return forbiddenResponse('You can only access your own messages');
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    if (userId) {
      // Get messages with specific user
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const offset = parseInt(searchParams.get('offset') || '0', 10);
      const messages = await getDirectMessages(merchantId, userId, limit, offset);

      // Mark messages as read
      await markDirectMessagesAsRead(merchantId, 'merchant', userId);

      return successResponse({
        messages: messages.reverse(), // Return in chronological order
        hasMore: messages.length === limit,
      });
    } else {
      // Get all conversations
      const conversations = await getMerchantDirectConversations(merchantId);
      const unreadCount = await getMerchantUnreadDirectCount(merchantId);

      return successResponse({
        conversations,
        totalUnread: unreadCount,
      });
    }
  } catch (error) {
    console.error('Error fetching direct messages:', error);
    return errorResponse('Internal server error');
  }
}

// POST /api/merchant/direct-messages - Send a message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, user_id, recipient_id, recipient_type, content, message_type, image_url } = body;

    // Support both old (user_id) and new (recipient_id + recipient_type) params
    const targetId = recipient_id || user_id;
    const targetType: 'merchant' | 'user' = recipient_type || 'user';

    if (!merchant_id || !targetId || !content) {
      return validationErrorResponse(['merchant_id, recipient_id (or user_id), and content are required']);
    }

    // Authorization check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType === 'merchant' && auth.actorId !== merchant_id) {
      return forbiddenResponse('You can only send messages as yourself');
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    // Verify the parties have an existing order relationship (any status).
    // Active-order requirement is removed: post-trade chat must remain open
    // so participants can message each other even after completion/cancellation.
    // We still block strangers — there must have been at least one prior trade.
    const relationshipRows = await query<{ id: string }>(
      `SELECT id FROM orders
       WHERE ((merchant_id = $1 AND user_id = $2) OR (merchant_id = $2 AND user_id = $1)
              OR (buyer_merchant_id = $1 AND user_id = $2) OR (buyer_merchant_id = $2 AND user_id = $1)
              OR (merchant_id = $1 AND buyer_merchant_id = $2) OR (merchant_id = $2 AND buyer_merchant_id = $1))
       LIMIT 1`,
      [merchant_id, targetId]
    );
    if (relationshipRows.length === 0) {
      return forbiddenResponse('Direct messages require a prior order relationship between parties');
    }

    const message = await sendDirectMessage({
      sender_type: 'merchant',
      sender_id: merchant_id,
      recipient_type: targetType,
      recipient_id: targetId,
      content,
      message_type: message_type || 'text',
      image_url,
    });

    // Notify recipient in real-time via Pusher
    notifyNewDirectMessage({
      messageId: message.id,
      senderType: 'merchant',
      senderId: merchant_id,
      recipientType: targetType,
      recipientId: targetId,
      content,
      messageType: message_type || 'text',
      imageUrl: image_url,
      createdAt: message.created_at?.toISOString?.() || new Date().toISOString(),
    }).catch(err => console.error('[DM] Pusher notification failed:', err));

    // Bridge: also insert into chat_messages so user sees it in order chat.
    // Mirror to the most recent order between the parties REGARDLESS of status —
    // user-side has no direct-message listener, so the order chat is the only
    // surface where users see merchant DMs (including post-trade messages).
    try {
      const orderRows = await query<{
        id: string;
        user_id: string;
        merchant_id: string | null;
        buyer_merchant_id: string | null;
      }>(
        `SELECT id, user_id, merchant_id, buyer_merchant_id FROM orders
         WHERE ((merchant_id = $1 AND user_id = $2) OR (merchant_id = $2 AND user_id = $1)
                OR (buyer_merchant_id = $1 AND user_id = $2) OR (buyer_merchant_id = $2 AND user_id = $1)
                OR (merchant_id = $1 AND buyer_merchant_id = $2) OR (merchant_id = $2 AND buyer_merchant_id = $1))
         ORDER BY created_at DESC LIMIT 1`,
        [merchant_id, targetId]
      );
      if (orderRows.length > 0) {
        const order = orderRows[0];
        const orderId = order.id;
        // RETURNING the actual chat_messages row id + created_at so the Pusher
        // event payload matches what GET /messages will later return — without
        // this, dedup-by-id in the client fails and the message renders twice
        // (once via Pusher, once via REST fetch).
        const insertedRows = await query<{ id: string; created_at: Date; seq: number | null }>(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, image_url)
           VALUES ($1, 'merchant', $2, $3, $4, $5)
           RETURNING id, created_at, seq`,
          [orderId, merchant_id, content, message_type || 'text', image_url || null]
        );
        const inserted = insertedRows[0];
        // Notify via Pusher order channel + recipient's private channel so the
        // user gets it in real-time even if the order chat isn't open.
        notifyNewMessage({
          orderId,
          messageId: inserted.id,
          senderType: 'merchant',
          senderId: merchant_id,
          content,
          messageType: message_type || 'text',
          imageUrl: image_url,
          createdAt: inserted.created_at?.toISOString?.() || new Date().toISOString(),
          userId: order.user_id,
          merchantId: order.merchant_id ?? undefined,
          buyerMerchantId: order.buyer_merchant_id ?? undefined,
          seq: inserted.seq ?? undefined,
        }).catch(() => {});
      }
    } catch (bridgeErr) {
      console.error('[DM] Bridge to chat_messages failed:', bridgeErr);
    }

    return successResponse(message, 201);
  } catch (error) {
    console.error('Error sending direct message:', error);
    return errorResponse('Internal server error');
  }
}
