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

    // Bridge: also insert into chat_messages so user sees it in order chat
    try {
      // Find the active (non-terminal) order between merchant and recipient
      const orderRows = await query<{ id: string }>(
        `SELECT id FROM orders
         WHERE ((merchant_id = $1 AND user_id = $2) OR (merchant_id = $2 AND user_id = $1)
                OR (buyer_merchant_id = $1 AND user_id = $2) OR (buyer_merchant_id = $2 AND user_id = $1)
                OR (merchant_id = $1 AND buyer_merchant_id = $2) OR (merchant_id = $2 AND buyer_merchant_id = $1))
           AND status NOT IN ('completed', 'cancelled', 'expired')
         ORDER BY created_at DESC LIMIT 1`,
        [merchant_id, targetId]
      );
      if (orderRows.length > 0) {
        const orderId = orderRows[0].id;
        await query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, image_url)
           VALUES ($1, 'merchant', $2, $3, $4, $5)`,
          [orderId, merchant_id, content, message_type || 'text', image_url || null]
        );
        // Notify via Pusher order channel so user gets it in real-time
        notifyNewMessage({
          orderId,
          messageId: message.id,
          senderType: 'merchant',
          senderId: merchant_id,
          content,
          messageType: message_type || 'text',
          imageUrl: image_url,
          createdAt: message.created_at?.toISOString?.() || new Date().toISOString(),
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
