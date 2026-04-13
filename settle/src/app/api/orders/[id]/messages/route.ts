import { NextRequest, NextResponse } from 'next/server';
import { getOrderMessages, getOrderMessagesAfterSeq, sendMessage, markMessagesAsRead, getOrderById, markOrderHasManualMessage } from '@/lib/db/repositories/orders';
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
import { notifyNewMessage, notifyNewDirectMessage, notifyMessagesRead, triggerEvent } from '@/lib/pusher/server';
import { CHAT_EVENTS } from '@/lib/pusher/events';

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

    // Authorization check — pass prefetched order to avoid duplicate DB query
    const canAccess = await canAccessOrder(auth, id, order);
    if (!canAccess) {
      logger.auth.forbidden(`GET /api/orders/${id}/messages`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Phase 3: reconnect catch-up cursor. When the client provides
    // ?after_seq=N we return messages with seq > N in ASC order, hard-capped
    // at 200. Used after Pusher reconnect to backfill missed messages without
    // losing ordering.
    //
    // Backward compatible: if after_seq is absent, the existing latest-N
    // path runs unchanged.
    const afterSeqParam = request.nextUrl.searchParams.get('after_seq');
    if (afterSeqParam !== null) {
      const afterSeq = parseInt(afterSeqParam, 10);
      if (Number.isNaN(afterSeq) || afterSeq < 0) {
        return validationErrorResponse(['after_seq must be a non-negative integer']);
      }
      const limitParam = request.nextUrl.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam, 10) : 200;
      const catchup = await getOrderMessagesAfterSeq(id, afterSeq, limit);
      logger.api.request('GET', `/api/orders/${id}/messages?after_seq=${afterSeq}`, auth.actorId);
      return successResponse(catchup);
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

    const { sender_type, sender_id, content, message_type, image_url, file_url, file_name, file_size, mime_type, client_id } = parseResult.data;

    // ── URL validation: prevent malicious/spoofed image/file URLs ──
    // Only allow Cloudinary URLs. A tampered client could pass an arbitrary
    // URL (XSS payload, phishing page, tracking pixel) as the image_url.
    const ALLOWED_URL_DOMAINS = ['res.cloudinary.com', 'cloudinary.com'];
    if (image_url) {
      try {
        const parsed = new URL(image_url);
        if (!ALLOWED_URL_DOMAINS.some(d => parsed.hostname.endsWith(d))) {
          return validationErrorResponse(['image_url must be a Cloudinary URL']);
        }
      } catch {
        return validationErrorResponse(['image_url is not a valid URL']);
      }
    }
    if (file_url) {
      try {
        const parsed = new URL(file_url);
        if (!ALLOWED_URL_DOMAINS.some(d => parsed.hostname.endsWith(d))) {
          return validationErrorResponse(['file_url must be a Cloudinary URL']);
        }
      } catch {
        return validationErrorResponse(['file_url is not a valid URL']);
      }
    }

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

    // ── Chat availability enforcement (backend is source of truth) ──
    // The frontend shows/hides the chat UI based on getChatAvailability(),
    // but the backend MUST enforce it here as the final gate. This prevents
    // messages on closed/frozen/pre-accepted orders even if the client is
    // out of date or manipulated.
    const { getChatAvailability } = await import('@/lib/chat/availability');
    const chatStatus = getChatAvailability(order, sender_type as 'user' | 'merchant' | 'compliance' | 'system');
    if (!chatStatus.enabled) {
      return forbiddenResponse(chatStatus.reason || 'Chat is not available for this order');
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
      client_id,  // Phase 3: idempotency key, optional
    });

    // Mark order as having manual messages (fire-and-forget, don't block response)
    if (sender_type !== 'system' && message_type !== 'system') {
      markOrderHasManualMessage(id).catch(() => {});
    }

    // Trigger real-time notification on order channel + participant private channels.
    // Phase 3: include clientId and seq so recipients can replace optimistic
    // temp messages by clientId and track lastSeq for reconnect catch-up.
    console.log('[CHAT] Emitting message:new via Pusher', {
      orderId: id,
      messageId: message.id,
      senderType: sender_type,
      merchantId: order.merchant_id,
      userId: order.user_id,
    });
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
      clientId: (message as { client_id?: string | null }).client_id ?? null,
      seq: (message as { seq?: number | null }).seq ?? null,
    });

    // ── Merchant aggregated channel: message preview + unread (fire-and-forget) ──
    // Merchants subscribe to ONE channel for all chat updates. This avoids
    // the 50+ order channel subscription problem.
    {
      const { getMerchantChatChannel } = await import('@/lib/pusher/channels');
      const { triggerEvent } = await import('@/lib/pusher/server');
      const previewPayload = {
        orderId: id,
        preview: (content || '[attachment]').substring(0, 80),
        senderType: sender_type,
        senderName: (message as any).sender_name || sender_type,
        messageType: message_type || 'text',
        timestamp: message.created_at.toISOString(),
      };
      // Send preview to all merchants involved in this order (except the sender)
      const merchantIds = [order.merchant_id, order.buyer_merchant_id].filter(
        (mid): mid is string => !!mid && mid !== sender_id
      );
      for (const mid of merchantIds) {
        triggerEvent(getMerchantChatChannel(mid), CHAT_EVENTS.MESSAGE_PREVIEW, previewPayload).catch(() => {});
      }
    }

    // ── Redis unread counters (fire-and-forget) ──
    // Increment unread for the RECEIVER, not the sender.
    {
      const { incrementMerchantUnread, incrementUserUnread } = await import('@/lib/chat/unreadCounters');
      if (sender_type === 'user' || sender_type === 'compliance') {
        // User/compliance sent → increment merchant's unread
        if (order.merchant_id && order.merchant_id !== sender_id) {
          incrementMerchantUnread(order.merchant_id, id).catch(() => {});
        }
        if (order.buyer_merchant_id && order.buyer_merchant_id !== sender_id) {
          incrementMerchantUnread(order.buyer_merchant_id, id).catch(() => {});
        }
      }
      if (sender_type === 'merchant' || sender_type === 'compliance') {
        // Merchant/compliance sent → increment user's unread
        if (order.user_id && order.user_id !== sender_id) {
          incrementUserUnread(order.user_id, id).catch(() => {});
        }
        // Also increment the OTHER merchant's unread (M2M)
        if (sender_type === 'merchant') {
          const otherMerchant = sender_id === order.merchant_id
            ? order.buyer_merchant_id
            : order.merchant_id;
          if (otherMerchant && otherMerchant !== sender_id) {
            incrementMerchantUnread(otherMerchant, id).catch(() => {});
          }
        }
      }
    }

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

    // Require authentication for all PATCH actions
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization check — pass prefetched order to avoid duplicate DB query
    const canAccess = await canAccessOrder(auth, id, order);
    if (!canAccess) {
      logger.auth.forbidden(`PATCH /api/orders/${id}/messages`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // ── Action: "delivered" — batch delivery acknowledgment ──────────
    // The receiver's client auto-sends this when a message arrives via Pusher.
    // Updates chat_messages.status to 'delivered' and delivered_at timestamp.
    // Idempotent: re-delivering an already-delivered message is a no-op.
    if (body.action === 'delivered' && Array.isArray(body.message_ids)) {
      const messageIds: string[] = body.message_ids.slice(0, 50); // Cap at 50
      if (messageIds.length > 0) {
        // Batch update: only update messages that are currently 'sent' (not already delivered/seen)
        const result = await query(
          `UPDATE chat_messages
           SET status = 'delivered', delivered_at = NOW()
           WHERE order_id = $1
             AND id = ANY($2::uuid[])
             AND (status IS NULL OR status = 'sent')
           RETURNING id`,
          [id, messageIds]
        );

        // Emit delivery event to the ORDER channel so the SENDER sees ✓✓
        // Only emit if we actually updated something (prevents duplicate events)
        if (result.length > 0) {
          const { getOrderChannel } = await import('@/lib/pusher/channels');
          triggerEvent(getOrderChannel(id), 'chat:messages-delivered', {
            orderId: id,
            messageIds: result.map((r: any) => r.id),
            deliveredBy: auth.actorType,
            deliveredById: auth.actorId, // M2M safe
            deliveredAt: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      return successResponse({ delivered: messageIds.length });
    }

    // ── Action: mark-read (default) ─────────────────────────────────
    // Validate request body for mark-read
    const parseResult = markMessagesReadSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { reader_type } = parseResult.data;

    // Phase 3: pass authenticated actorId so the dual-write to
    // chat_message_reads can attribute the read to the correct actor.
    await markMessagesAsRead(id, reader_type, auth.actorId);

    // Also update status to 'seen' for all unread messages from the other party
    // M2M safe: use ID-based filter so merchant A's read doesn't mark their own messages
    await query(
      `UPDATE chat_messages
       SET status = 'seen'
       WHERE order_id = $1
         AND NOT (sender_type = $2 AND sender_id = $3)
         AND (status IS NULL OR status IN ('sent', 'delivered'))`,
      [id, reader_type, auth.actorId]
    ).catch(() => {});

    // Clear Redis unread counter for the reader
    {
      const { clearMerchantUnread, clearUserUnread } = await import('@/lib/chat/unreadCounters');
      if (auth.actorType === 'merchant') {
        clearMerchantUnread(auth.actorId, id).catch(() => {});
      } else if (auth.actorType === 'user') {
        clearUserUnread(auth.actorId, id).catch(() => {});
      }
    }

    // Trigger real-time notification (multi-device: also emit on user's private channel)
    notifyMessagesRead(id, reader_type, new Date().toISOString(), auth.actorId);

    // Multi-device sync: emit on the reader's private channel so other tabs/devices
    // update their UI without polling.
    {
      const { getUserChannel, getMerchantChannel } = await import('@/lib/pusher/channels');
      const syncChannel = auth.actorType === 'merchant'
        ? getMerchantChannel(auth.actorId)
        : auth.actorType === 'user'
          ? getUserChannel(auth.actorId)
          : null;
      if (syncChannel) {
        triggerEvent(syncChannel, CHAT_EVENTS.MESSAGES_READ, {
          orderId: id,
          readerType: reader_type,
          readAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    logger.chat.messagesRead(id, reader_type);
    return successResponse({ marked_read: true });
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]/messages', error as Error);
    return errorResponse('Internal server error');
  }
}
