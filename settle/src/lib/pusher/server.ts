/**
 * Pusher Server Client
 *
 * Server-side Pusher instance for triggering events from API routes
 */

import { ORDER_EVENTS, CHAT_EVENTS, type PusherEvent } from './events';
import { getUserChannel, getMerchantChannel, getOrderChannel, getAllMerchantsChannel } from './channels';

// Mock Pusher interface for when module is not available
interface PusherLike {
  trigger: (channel: string | string[], event: string, data: unknown) => Promise<unknown>;
  triggerBatch: (batch: Array<{ channel: string; name: string; data: unknown }>) => Promise<unknown>;
}

// Initialize Pusher server client (singleton)
let pusherServer: PusherLike | null = null;
let pusherLoadAttempted = false;

async function getPusherServer(): Promise<PusherLike> {
  if (pusherServer) {
    return pusherServer;
  }

  // Mock pusher that does nothing - used when pusher isn't configured or available
  const mockPusher: PusherLike = {
    trigger: async (...args) => {
      console.log('[Pusher Server] MOCK trigger called (Pusher not configured):', JSON.stringify(args[0]));
      return {};
    },
    triggerBatch: async () => ({}),
  };

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    if (!pusherLoadAttempted) {
      console.warn('[Pusher Server] Credentials not configured. Real-time features disabled.');
      pusherLoadAttempted = true;
    }
    return mockPusher;
  }

  try {
    // Dynamic import to avoid build errors when pusher isn't installed
    const Pusher = (await import('pusher')).default;
    pusherServer = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });
    console.log('[Pusher Server] Pusher instance created successfully');
    return pusherServer;
  } catch (err) {
    console.warn('[Pusher Server] Module not available:', err);
    return mockPusher;
  }
}

/**
 * Trigger an event on a channel
 */
export async function triggerEvent(
  channel: string | string[],
  event: PusherEvent,
  data: unknown
): Promise<void> {
  console.log('[Pusher Server] triggerEvent called:', { channel, event });
  try {
    const pusher = await getPusherServer();
    const result = await pusher.trigger(channel, event, data);
    console.log('[Pusher Server] Event triggered successfully:', { channel, event, result });
  } catch (error) {
    console.error('[Pusher Server] Failed to trigger event:', error);
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Trigger multiple events in a batch
 */
export async function triggerBatch(
  batch: Array<{ channel: string; name: PusherEvent; data: unknown }>
): Promise<void> {
  try {
    const pusher = await getPusherServer();
    await pusher.triggerBatch(batch);
  } catch (error) {
    console.error('Failed to trigger Pusher batch:', error);
  }
}

// ============================================
// Order Event Helpers
// ============================================

interface OrderEventData {
  orderId: string;
  userId: string;
  merchantId: string;
  buyerMerchantId?: string;
  creatorMerchantId?: string;
  status: string;
  minimal_status?: string;
  order_version?: number;
  previousStatus?: string;
  updatedAt: string;
  data?: unknown;
}

/**
 * Notify ALL merchants when an order is created (broadcast model)
 * Any merchant can see and accept new orders
 */
export async function notifyOrderCreated(data: OrderEventData): Promise<void> {
  // Broadcast to ALL merchants via the global channel
  const channels = [
    getAllMerchantsChannel(), // All merchants receive new orders
  ];

  console.log('[Pusher] Broadcasting ORDER_CREATED to all merchants:', {
    channels,
    event: ORDER_EVENTS.CREATED,
    orderId: data.orderId,
  });

  await triggerEvent(channels, ORDER_EVENTS.CREATED, {
    orderId: data.orderId,
    status: data.status,
    minimal_status: data.minimal_status,
    order_version: data.order_version,
    createdAt: data.updatedAt,
    data: data.data,
  });

  console.log('[Pusher] ORDER_CREATED broadcast sent to all merchants');
}

/**
 * Notify relevant parties when an order status is updated.
 * Only broadcast to ALL merchants for statuses that affect order availability
 * (accepted, cancelled, expired) so they can remove claimed orders from their list.
 * All other status updates (escrowed, payment_sent, etc.) only go to involved parties.
 */
export async function notifyOrderStatusUpdated(data: OrderEventData): Promise<void> {
  const channels = [
    getUserChannel(data.userId),
    getMerchantChannel(data.merchantId),
    getOrderChannel(data.orderId),
  ];

  // Only broadcast to all merchants when an order is claimed/removed from the pool
  const broadcastStatuses = ['accepted', 'cancelled', 'expired'];
  if (broadcastStatuses.includes(data.status)) {
    channels.push(getAllMerchantsChannel());
  }

  // Minimal payload — client uses order_version to dedup and fetches full details if needed
  const payload = {
    orderId: data.orderId,
    status: data.status,
    minimal_status: data.minimal_status,
    order_version: data.order_version,
    previousStatus: data.previousStatus,
    updatedAt: data.updatedAt,
    // Only include essential data fields, not the full order object
    data: data.data ? minimalOrderPayload(data.data) : undefined,
  };

  // Use triggerBatch for efficiency — single HTTP request to Pusher for all channels
  const batch = channels.map((channel) => ({
    channel,
    name: ORDER_EVENTS.STATUS_UPDATED as PusherEvent,
    data: payload,
  }));

  await triggerBatch(batch);
}

/**
 * Strip large/redundant fields from order payload to reduce Pusher message size.
 * Client should refetch full order details when needed.
 */
function minimalOrderPayload(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const order = data as Record<string, unknown>;
  // Only include fields the UI needs for instant state update
  return {
    id: order.id,
    status: order.status,
    order_version: order.order_version,
    order_number: order.order_number,
    crypto_amount: order.crypto_amount,
    crypto_currency: order.crypto_currency,
    fiat_amount: order.fiat_amount,
    fiat_currency: order.fiat_currency,
    completed_at: order.completed_at,
    cancelled_at: order.cancelled_at,
    payment_sent_at: order.payment_sent_at,
    payment_deadline: order.payment_deadline,
  };
}

/**
 * Notify when an order is cancelled
 */
export async function notifyOrderCancelled(data: OrderEventData): Promise<void> {
  const channels = [
    getUserChannel(data.userId),
    getMerchantChannel(data.merchantId),
    getOrderChannel(data.orderId),
  ];

  const payload = {
    orderId: data.orderId,
    minimal_status: data.minimal_status || 'cancelled',
    order_version: data.order_version,
    cancelledAt: data.updatedAt,
    data: data.data ? minimalOrderPayload(data.data) : data.data,
  };

  await triggerBatch(channels.map((channel) => ({
    channel,
    name: ORDER_EVENTS.CANCELLED as PusherEvent,
    data: payload,
  })));
}

// ============================================
// Chat Event Helpers
// ============================================

interface ChatMessageData {
  orderId: string;
  messageId: string;
  senderType: 'user' | 'merchant' | 'system' | 'compliance';
  senderId: string | null;
  content: string;
  messageType: 'text' | 'image' | 'file' | 'system' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  imageUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  senderName?: string;
  // Optional participant IDs — when provided, the message is also pushed
  // to their private channels so they receive it even without the chat open.
  userId?: string | null;
  merchantId?: string | null;
  buyerMerchantId?: string | null;
  // Phase 3: client_id (idempotency key) and seq (monotonic order). Echoed
  // back so the client can replace its optimistic temp message by clientId
  // and use seq for deterministic ordering / reconnect catch-up.
  clientId?: string | null;
  seq?: number | null;
}

/**
 * Notify when a new chat message is sent.
 * Always pushes to the order channel (subscribers with chat open).
 * When participant IDs are provided, also pushes to their private channels
 * so they receive the message even without the chat window open.
 */
export async function notifyNewMessage(data: ChatMessageData): Promise<void> {
  const payload = {
    messageId: data.messageId,
    orderId: data.orderId,
    senderType: data.senderType,
    senderId: data.senderId,
    senderName: data.senderName,
    content: data.content,
    messageType: data.messageType,
    imageUrl: data.imageUrl,
    fileUrl: data.fileUrl,
    fileName: data.fileName,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    createdAt: data.createdAt,
    // Phase 3: pass client_id + seq so the recipient can dedupe optimistic
    // temp messages by clientId and update its lastSeq cursor.
    clientId: data.clientId,
    seq: data.seq,
  };

  // 1. Order channel (existing — for open chat windows)
  const orderChannel = getOrderChannel(data.orderId);
  await triggerEvent(orderChannel, CHAT_EVENTS.MESSAGE_NEW, payload);

  // 2. Private channels (new — for closed chat windows)
  // Skip the sender's own channel to avoid echo
  const privateChannels: string[] = [];
  if (data.userId && !(data.senderType === 'user' && data.senderId === data.userId)) {
    privateChannels.push(getUserChannel(data.userId));
  }
  if (data.merchantId && !(data.senderType === 'merchant' && data.senderId === data.merchantId)) {
    privateChannels.push(getMerchantChannel(data.merchantId));
  }
  if (data.buyerMerchantId && data.buyerMerchantId !== data.merchantId &&
      !(data.senderType === 'merchant' && data.senderId === data.buyerMerchantId)) {
    privateChannels.push(getMerchantChannel(data.buyerMerchantId));
  }

  if (privateChannels.length > 0) {
    // Fire-and-forget — don't block on private channel delivery
    triggerEvent(privateChannels, CHAT_EVENTS.MESSAGE_NEW, payload).catch(() => {});
  }
}

/**
 * Notify when messages are marked as read
 */
export async function notifyMessagesRead(
  orderId: string,
  readerType: 'user' | 'merchant' | 'system' | 'compliance',
  readAt: string,
  readerId?: string,
): Promise<void> {
  const channel = getOrderChannel(orderId);

  await triggerEvent(channel, CHAT_EVENTS.MESSAGES_READ, {
    orderId,
    readerType,
    readerId, // M2M safe: allows ID-based filtering
    readAt,
  });
}

/**
 * Notify new direct message to recipient's private channel
 */
export async function notifyNewDirectMessage(data: {
  messageId: string;
  senderType: 'merchant' | 'user';
  senderId: string;
  recipientType: 'merchant' | 'user';
  recipientId: string;
  content: string;
  messageType: string;
  imageUrl?: string;
  createdAt: string;
}): Promise<void> {
  // Send to recipient's private channel
  const recipientChannel = data.recipientType === 'merchant'
    ? getMerchantChannel(data.recipientId)
    : getUserChannel(data.recipientId);

  await triggerEvent(recipientChannel, CHAT_EVENTS.DM_NEW, {
    messageId: data.messageId,
    senderType: data.senderType,
    senderId: data.senderId,
    content: data.content,
    messageType: data.messageType,
    imageUrl: data.imageUrl,
    createdAt: data.createdAt,
  });
}

/**
 * Notify typing status for a direct (1:1) chat — sent to the recipient's private channel.
 */
export async function notifyDirectTyping(
  senderType: 'user' | 'merchant',
  senderId: string,
  recipientType: 'user' | 'merchant',
  recipientId: string,
  isTyping: boolean,
): Promise<void> {
  const recipientChannel = recipientType === 'merchant'
    ? getMerchantChannel(recipientId)
    : getUserChannel(recipientId);
  const event = isTyping ? CHAT_EVENTS.TYPING_START : CHAT_EVENTS.TYPING_STOP;
  await triggerEvent(recipientChannel, event, {
    senderType,
    senderId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify typing status
 */
export async function notifyTyping(
  orderId: string,
  actorType: 'user' | 'merchant' | 'compliance',
  isTyping: boolean,
  actorId?: string,
): Promise<void> {
  const channel = getOrderChannel(orderId);
  const event = isTyping ? CHAT_EVENTS.TYPING_START : CHAT_EVENTS.TYPING_STOP;

  await triggerEvent(channel, event, {
    orderId,
    actorType,
    actorId, // M2M safe: allows ID-based filtering when both parties are merchants
    timestamp: new Date().toISOString(),
  });
}

// ============================================
// Extension Event Helpers
// ============================================

interface ExtensionRequestData {
  orderId: string;
  userId: string;
  merchantId: string;
  requestedBy: 'user' | 'merchant' | 'system' | 'compliance';
  extensionMinutes: number;
  extensionCount: number;
  maxExtensions: number;
}

interface ExtensionResponseData {
  orderId: string;
  userId: string;
  merchantId: string;
  accepted: boolean;
  respondedBy: 'user' | 'merchant' | 'system' | 'compliance';
  newExpiresAt?: string;
  newStatus?: string;
}

/**
 * Notify when an extension is requested
 */
export async function notifyExtensionRequested(data: ExtensionRequestData): Promise<void> {
  const channels = [
    getUserChannel(data.userId),
    getMerchantChannel(data.merchantId),
    getOrderChannel(data.orderId),
  ];

  await triggerEvent(channels, ORDER_EVENTS.EXTENSION_REQUESTED, {
    orderId: data.orderId,
    requestedBy: data.requestedBy,
    extensionMinutes: data.extensionMinutes,
    extensionCount: data.extensionCount,
    maxExtensions: data.maxExtensions,
    extensionsRemaining: data.maxExtensions - data.extensionCount - 1,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify when an extension request is responded to
 */
export async function notifyExtensionResponse(data: ExtensionResponseData): Promise<void> {
  const channels = [
    getUserChannel(data.userId),
    getMerchantChannel(data.merchantId),
    getOrderChannel(data.orderId),
  ];

  await triggerEvent(channels, ORDER_EVENTS.EXTENSION_RESPONSE, {
    orderId: data.orderId,
    accepted: data.accepted,
    respondedBy: data.respondedBy,
    newExpiresAt: data.newExpiresAt,
    newStatus: data.newStatus,
    timestamp: new Date().toISOString(),
  });
}

// Export the server instance getter for direct access if needed
export { getPusherServer };
