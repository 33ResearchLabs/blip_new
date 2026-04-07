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
    // Allow dual-login: user token can send as user if userId matches,
    // merchant token can send as merchant if merchantId matches.
    // Allow compliance: merchant with has_compliance_access can send as sender_type 'compliance'.
    const senderMatchesAuth = sender_id === auth.actorId && sender_type === auth.actorType;
    const senderMatchesUserId = sender_type === 'user' && sender_id === auth.userId;
    const senderMatchesMerchantId = sender_type === 'merchant' && sender_id === auth.merchantId;
    // Merchant with compliance access sending as compliance (sender_id = merchant ID)
    // Verify has_compliance_access BEFORE accepting sender_type to prevent spoofing
    let senderMatchesComplianceMerchant = false;
    if (sender_type === 'compliance' && auth.actorType === 'merchant' && sender_id === auth.actorId) {
      const { getMerchantById } = await import('@/lib/db/repositories/merchants');
      const merchant = await getMerchantById(auth.actorId);
      senderMatchesComplianceMerchant = !!merchant?.has_compliance_access;
    }
    if (!senderMatchesAuth && !senderMatchesUserId && !senderMatchesMerchantId && !senderMatchesComplianceMerchant) {
      logger.auth.forbidden(`POST /api/orders/${id}/messages`, sender_id, 'Sender identity mismatch with authenticated actor');
      return forbiddenResponse('Sender identity does not match authenticated user');
    }

    // Check order exists + authorize in one step (avoid duplicate getOrderById)
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Inline access check using already-fetched order (skip canAccessOrder's redundant DB query)
    // Note: for compliance-as-merchant, we already validated has_compliance_access via
    // senderMatchesComplianceMerchant — so we can trust sender_type here.
    const hasAccess = await (async () => {
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
        // Merchant with compliance access can send messages on disputed orders
        if (senderMatchesComplianceMerchant && order.status === 'disputed') {
          const { getMerchantById } = await import('@/lib/db/repositories/merchants');
          const merchant = await getMerchantById(auth.actorId);
          if (merchant?.has_compliance_access) return true;
        }
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

    // Trigger real-time notification on order channel + participant private channels
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
      userId: order.user_id,
      merchantId: order.merchant_id,
      buyerMerchantId: order.buyer_merchant_id,
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
          // User/merchant: bridge to direct_messages so the counterparty sees
          // it in the merchant DM panel (which only reads from direct_messages,
          // not chat_messages). Without this bridge, user-originated order
          // chats are stranded in chat_messages and never reach the merchant
          // inbox preview.
          //
          // Bridging direction:
          //   user → merchant : recipient is the seller merchant on the order
          //   merchant → user : recipient is the order's user (skip if placeholder)
          //
          // For an M2M order both participants are merchants — bridge to the
          // OTHER merchant via buyer_merchant_id, since merchant_id is always
          // the seller and buyer_merchant_id is always the buyer.
          let recipientType: 'merchant' | 'user';
          let recipientId: string | null = null;

          if (sender_type === 'user') {
            recipientType = 'merchant';
            // Prefer the merchant_id (seller); if for some reason it's the
            // sender themselves (shouldn't happen on user→merchant), fall
            // through to buyer_merchant_id.
            recipientId = order.merchant_id || order.buyer_merchant_id || null;
          } else {
            // sender_type === 'merchant'
            // M2M case: the OTHER merchant is the recipient.
            if (order.buyer_merchant_id && sender_id === order.merchant_id) {
              recipientType = 'merchant';
              recipientId = order.buyer_merchant_id;
            } else if (order.buyer_merchant_id && sender_id === order.buyer_merchant_id) {
              recipientType = 'merchant';
              recipientId = order.merchant_id;
            } else {
              // Standard U2M order — recipient is the user. Skip if it's a
              // placeholder open-order user (no real account to deliver to).
              recipientType = 'user';
              const isPlaceholder = order.user_id && (
                order.user_id.startsWith?.('open_order_') ||
                order.user_id.startsWith?.('m2m_')
              );
              recipientId = isPlaceholder ? null : (order.user_id || null);
            }
          }

          if (recipientId && recipientId !== sender_id) {
            try {
              // 1. Bridge the message into direct_messages.
              const dmRows = await query<{ id: string }>(
                `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type, image_url)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [sender_type, sender_id, recipientType, recipientId, content, message_type || 'text', image_url || null]
              );

              if (dmRows.length > 0) {
                // 2. Per-party read state.
                await query(
                  `INSERT INTO dm_read_status (message_id, actor_id, is_read, read_at)
                   VALUES ($1, $2, true, NOW()), ($1, $3, false, NULL)
                   ON CONFLICT DO NOTHING`,
                  [dmRows[0].id, sender_id, recipientId]
                );

                // 3. Ensure a merchant_contacts row exists for the merchant
                //    side of the conversation. getMerchantDirectConversations
                //    LEFT-JOINs from merchant_contacts, so without this row
                //    the DM is invisible in the merchant inbox preview.
                //
                //    For M2M (both merchants), seed contacts on BOTH sides.
                //    For U2M, seed only the merchant→user contact.
                const { addContact } = await import('@/lib/db/repositories/directMessages');

                if (recipientType === 'merchant') {
                  // recipient is a merchant: ensure they have sender as a contact
                  await addContact({
                    merchant_id: recipientId,
                    target_id: sender_id,
                    target_type: sender_type === 'user' ? 'user' : 'merchant',
                  }).catch((e) => logger.warn('[Messages] addContact (recipient) failed', { error: String(e) }));
                }
                if (sender_type === 'merchant') {
                  // sender is a merchant: ensure they have recipient as a contact too
                  await addContact({
                    merchant_id: sender_id,
                    target_id: recipientId,
                    target_type: recipientType,
                  }).catch((e) => logger.warn('[Messages] addContact (sender) failed', { error: String(e) }));
                }

                // 4. Real-time notify the recipient's private channel so the
                //    merchant DM panel refetches its conversation list.
                notifyNewDirectMessage({
                  messageId: message.id,
                  senderType: sender_type as 'merchant' | 'user',
                  senderId: sender_id,
                  recipientType: recipientType as 'merchant' | 'user',
                  recipientId,
                  content: content || '',
                  messageType: message_type || 'text',
                  imageUrl: image_url,
                  createdAt: message.created_at.toISOString(),
                }).catch((e) => logger.warn('[Messages] notifyNewDirectMessage failed', { error: String(e) }));

                logger.info('[Messages] Bridged order chat → DM', {
                  orderId: id,
                  senderType: sender_type,
                  senderId: sender_id,
                  recipientType,
                  recipientId,
                });
              }
            } catch (bridgeErr) {
              // Surface bridge failures explicitly — previously they were
              // swallowed by the outer catch and the merchant DM panel would
              // silently miss messages.
              logger.warn('[Messages] DM bridge insert failed', {
                orderId: id,
                senderType: sender_type,
                recipientType,
                error: bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr),
              });
            }
          } else {
            logger.warn('[Messages] DM bridge skipped — no valid recipient', {
              orderId: id,
              senderType: sender_type,
              senderId: sender_id,
              merchantId: order.merchant_id,
              buyerMerchantId: order.buyer_merchant_id,
              userId: order.user_id,
            });
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
