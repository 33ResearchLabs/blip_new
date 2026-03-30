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

    const limitParam = request.nextUrl.searchParams.get('limit');
    const before = request.nextUrl.searchParams.get('before') || undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const messages = await getOrderMessages(id, { limit, before });
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
    const rateLimitResponse = await checkRateLimit(request, 'messages:send', MESSAGE_LIMIT);
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

    const { sender_type, sender_id, content, message_type, image_url, file_url, file_name, file_size, mime_type } = parseResult.data;

    // Verify sender identity matches authenticated actor (prevent spoofing)
    if (sender_id !== auth.actorId || sender_type !== auth.actorType) {
      logger.auth.forbidden(`POST /api/orders/${id}/messages`, sender_id, 'Sender identity mismatch with authenticated actor');
      return forbiddenResponse('Sender identity does not match authenticated user');
    }

    // Check order exists + authorize in one step (avoid duplicate getOrderById)
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Inline access check using already-fetched order (skip canAccessOrder's redundant DB query)
    const hasAccess = (() => {
      if (auth.actorType === 'system') return true;
      if (auth.actorType === 'compliance') {
        if (order.status === 'disputed') return true;
        if (auth.merchantId && (order.merchant_id === auth.merchantId || order.buyer_merchant_id === auth.merchantId)) return true;
        return false;
      }
      if (auth.actorType === 'user') {
        if (order.user_id === auth.actorId) return true;
        if (auth.merchantId && (order.merchant_id === auth.merchantId || order.buyer_merchant_id === auth.merchantId)) return true;
        return false;
      }
      if (auth.actorType === 'merchant') {
        if (order.merchant_id === auth.actorId || order.buyer_merchant_id === auth.actorId) return true;
        if (order.status === 'escrowed' && !order.buyer_merchant_id) return true;
        return false;
      }
      return false;
    })();

    if (!hasAccess) {
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
      file_url,
      file_name,
      file_size,
      mime_type,
    });

    // Mark order as having manual messages (fire-and-forget, don't block response)
    if (sender_type !== 'system' && message_type !== 'system') {
      markOrderHasManualMessage(id).catch(() => {});
    }

    // Trigger real-time notification on order channel (fire-and-forget)
    notifyNewMessage({
      orderId: id,
      messageId: message.id,
      senderType: sender_type,
      senderId: sender_id,
      content: content || '',
      messageType: message_type || 'text',
      imageUrl: image_url,
      fileUrl: file_url,
      fileName: file_name,
      fileSize: file_size,
      mimeType: mime_type,
      createdAt: message.created_at.toISOString(),
    });

    // ── Post-send notifications (fire-and-forget, don't block response) ──
    //
    // ARCHITECTURE: All dispute communication uses chat_messages (order channel) as single source.
    // No DM bridging needed — merchant/user open the ORDER CHAT for disputed orders.
    //
    // For non-compliance messages (user/merchant): bridge to direct_messages for DM view.
    // For compliance messages: only send Pusher notifications to private channels (notification bell).

    const postSendWork = async () => {
      try {
        if (sender_type === 'compliance') {
          // Compliance: notify user + merchant via their private channels (notification bell only)
          // The actual message is in chat_messages — they'll see it when they open order chat
          const { getUserChannel, getMerchantChannel } = await import('@/lib/pusher/channels');
          const { triggerEvent } = await import('@/lib/pusher/server');
          const notifPayload = {
            type: 'compliance_message', orderId: id,
            content: content || '', senderName: 'Compliance Officer',
            createdAt: message.created_at.toISOString(),
          };
          const channels = [getUserChannel(order.user_id), getMerchantChannel(order.merchant_id)];
          if (order.buyer_merchant_id && order.buyer_merchant_id !== order.merchant_id) {
            channels.push(getMerchantChannel(order.buyer_merchant_id));
          }
          Promise.allSettled(channels.map(ch => triggerEvent(ch, 'notification:new', notifPayload))).catch(() => {});
        } else if (sender_type !== 'system' && message_type !== 'system') {
          // User/merchant: bridge to direct_messages so counterparty sees it in DM view
          const recipientType = sender_type === 'user' ? 'merchant' : 'user';
          const recipientId = sender_type === 'user' ? order.merchant_id : order.user_id;
          if (recipientId && recipientId !== sender_id) {
            const dmRows = await query<{ id: string }>(
              `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type, image_url)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
              [sender_type, sender_id, recipientType, recipientId, content, message_type || 'text', image_url || null]
            );
            if (dmRows.length > 0) {
              query(
                `INSERT INTO dm_read_status (message_id, actor_id, is_read, read_at) VALUES ($1, $2, true, NOW()), ($1, $3, false, NULL) ON CONFLICT DO NOTHING`,
                [dmRows[0].id, sender_id, recipientId]
              ).catch(() => {});
            }
            notifyNewDirectMessage({
              messageId: message.id, senderType: sender_type as 'merchant' | 'user',
              senderId: sender_id, recipientType: recipientType as 'merchant' | 'user',
              recipientId, content: content || '', messageType: message_type || 'text',
              imageUrl: image_url, createdAt: message.created_at.toISOString(),
            }).catch(() => {});
          }
        }
      } catch (err) {
        logger.warn('[Messages] Post-send work failed', { orderId: id, error: err });
      }
    };
    postSendWork();

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
