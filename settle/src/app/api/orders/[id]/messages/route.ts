import { NextRequest, NextResponse } from 'next/server';
import { getOrderMessages, sendMessage, markMessagesAsRead, getOrderById, markOrderHasManualMessage } from '@/lib/db/repositories/orders';
import { query } from '@/lib/db';
import {
  sendMessageSchema,
  markMessagesReadSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, MESSAGE_LIMIT } from '@/lib/middleware/rateLimit';
import { logger } from '@/lib/logger';
import { notifyNewMessage, notifyNewDirectMessage, notifyMessagesRead } from '@/lib/pusher/server';

// Validate order ID parameter
async function validateOrderId(id: string): Promise<{ valid: boolean; error?: string }> {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return { valid: false, error: 'Invalid order ID format' };
  }
  return { valid: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization check
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`GET /api/orders/${id}/messages`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    const messages = await getOrderMessages(id);
    logger.api.request('GET', `/api/orders/${id}/messages`, auth.actorId);
    return successResponse(messages);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/messages', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Rate limit: 30 messages per minute
    const rateLimitResponse = checkRateLimit(request, 'messages:send', MESSAGE_LIMIT);
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = sendMessageSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { sender_type, sender_id, content, message_type, image_url } = parseResult.data;

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization: verify authenticated actor can access this order
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`POST /api/orders/${id}/messages`, sender_id, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Don't allow messages on completed/cancelled/expired orders
    const terminalStatuses = ['completed', 'cancelled', 'expired'];
    if (terminalStatuses.includes(order.status)) {
      return validationErrorResponse([`Cannot send messages on ${order.status} orders`]);
    }

    const message = await sendMessage({
      order_id: id,
      sender_type,
      sender_id,
      content,
      message_type,
      image_url,
    });

    // Mark order as having manual messages (transition from automated to direct chat)
    if (sender_type !== 'system' && message_type !== 'system') {
      await markOrderHasManualMessage(id);
    }

    // Trigger real-time notification
    notifyNewMessage({
      orderId: id,
      messageId: message.id,
      senderType: sender_type,
      senderId: sender_id,
      content,
      messageType: message_type || 'text',
      imageUrl: image_url,
      createdAt: message.created_at.toISOString(),
    });

    // Bridge: also insert into direct_messages so merchant sees it in DM view
    if (sender_type !== 'system' && message_type !== 'system') {
      try {
        // Look up the counterparty from the order
        const recipientType = sender_type === 'user' ? 'merchant' : 'user';
        const recipientIdField = sender_type === 'user' ? 'merchant_id' : 'user_id';
        const recipientRow = await query<{ [key: string]: string }>(
          `SELECT user_id, merchant_id, buyer_merchant_id FROM orders WHERE id = $1`,
          [id]
        );
        if (recipientRow.length > 0) {
          const row = recipientRow[0] as { user_id: string; merchant_id: string; buyer_merchant_id: string | null };
          const recipientId = sender_type === 'user'
            ? row.merchant_id
            : row.user_id;

          if (recipientId && recipientId !== sender_id) {
            await query(
              `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type, image_url)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [sender_type, sender_id, recipientType, recipientId, content, message_type || 'text', image_url || null]
            );
            // Notify recipient via Pusher DM channel
            notifyNewDirectMessage({
              messageId: message.id,
              senderType: sender_type as 'merchant' | 'user',
              senderId: sender_id,
              recipientType: recipientType as 'merchant' | 'user',
              recipientId,
              content,
              messageType: message_type || 'text',
              imageUrl: image_url,
              createdAt: message.created_at.toISOString(),
            }).catch(() => {});
          }
        }
      } catch (bridgeErr) {
        logger.warn('[Messages] Bridge to direct_messages failed', { orderId: id, error: bridgeErr });
      }
    }

    logger.chat.messageSent(id, sender_type, sender_id);
    return successResponse(message, 201);
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/messages', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    const body = await request.json();

    // Validate request body
    const parseResult = markMessagesReadSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { reader_type } = parseResult.data;

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Authorization check
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`PATCH /api/orders/${id}/messages`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    await markMessagesAsRead(id, reader_type);

    // Trigger real-time notification
    notifyMessagesRead(id, reader_type, new Date().toISOString());

    logger.chat.messagesRead(id, reader_type);
    return successResponse({ marked_read: true });
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]/messages', error as Error);
    return errorResponse('Internal server error');
  }
}
