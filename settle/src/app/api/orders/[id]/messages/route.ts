import { NextRequest } from 'next/server';
import { getOrderMessages, sendMessage, markMessagesAsRead, getOrderById, markOrderHasManualMessage } from '@/lib/db/repositories/orders';
import {
  sendMessageSchema,
  markMessagesReadSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';
import { notifyNewMessage, notifyMessagesRead } from '@/lib/pusher/server';

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

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`GET /api/orders/${id}/messages`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    const messages = await getOrderMessages(id);
    logger.api.request('GET', `/api/orders/${id}/messages`, auth?.actorId);
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

    const body = await request.json();

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

    // Authorization: verify sender can access this order
    const auth = { actorType: sender_type, actorId: sender_id };
    const canAccess = await canAccessOrder(auth as { actorType: 'user' | 'merchant' | 'system'; actorId: string }, id);
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

    // Authorization check (need reader_id from auth context)
    const auth = getAuthContext(request);
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`PATCH /api/orders/${id}/messages`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
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
