import { NextRequest } from 'next/server';
import {
  getMerchantDirectConversations,
  getDirectMessages,
  sendDirectMessage,
  markDirectMessagesAsRead,
  getMerchantUnreadDirectCount,
} from '@/lib/db/repositories/directMessages';
import {
  getAuthContext,
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
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only send messages as yourself');
      }
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

    return successResponse(message, 201);
  } catch (error) {
    console.error('Error sending direct message:', error);
    return errorResponse('Internal server error');
  }
}
