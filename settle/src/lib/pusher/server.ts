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
    console.log('[Pusher Server] Using existing Pusher instance');
    return pusherServer;
  }

  // Mock pusher that does nothing - used when pusher isn't configured or available
  const mockPusher: PusherLike = {
    trigger: async (...args) => {
      console.log('[Pusher Server] MOCK trigger called (Pusher not configured):', args);
      return {};
    },
    triggerBatch: async () => ({}),
  };

  if (pusherLoadAttempted) {
    console.log('[Pusher Server] Load already attempted, returning mock');
    return mockPusher;
  }
  pusherLoadAttempted = true;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  console.log('[Pusher Server] Credentials check:', {
    hasAppId: !!appId,
    hasKey: !!key,
    hasSecret: !!secret,
    hasCluster: !!cluster
  });

  if (!appId || !key || !secret || !cluster) {
    console.warn('[Pusher Server] Credentials not configured. Real-time features disabled.');
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
  status: string;
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
    createdAt: data.updatedAt,
    data: data.data,
  });

  console.log('[Pusher] ORDER_CREATED broadcast sent to all merchants');
}

/**
 * Notify all parties when an order status is updated
 */
export async function notifyOrderStatusUpdated(data: OrderEventData): Promise<void> {
  const channels = [
    getUserChannel(data.userId),
    getMerchantChannel(data.merchantId),
    getOrderChannel(data.orderId),
  ];

  await triggerEvent(channels, ORDER_EVENTS.STATUS_UPDATED, {
    orderId: data.orderId,
    status: data.status,
    previousStatus: data.previousStatus,
    updatedAt: data.updatedAt,
    data: data.data,
  });
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

  await triggerEvent(channels, ORDER_EVENTS.CANCELLED, {
    orderId: data.orderId,
    cancelledAt: data.updatedAt,
    data: data.data,
  });
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
  messageType: 'text' | 'image' | 'system';
  imageUrl?: string | null;
  createdAt: string;
}

/**
 * Notify when a new chat message is sent
 */
export async function notifyNewMessage(data: ChatMessageData): Promise<void> {
  const channel = getOrderChannel(data.orderId);

  await triggerEvent(channel, CHAT_EVENTS.MESSAGE_NEW, {
    messageId: data.messageId,
    orderId: data.orderId,
    senderType: data.senderType,
    senderId: data.senderId,
    content: data.content,
    messageType: data.messageType,
    imageUrl: data.imageUrl,
    createdAt: data.createdAt,
  });
}

/**
 * Notify when messages are marked as read
 */
export async function notifyMessagesRead(
  orderId: string,
  readerType: 'user' | 'merchant' | 'system' | 'compliance',
  readAt: string
): Promise<void> {
  const channel = getOrderChannel(orderId);

  await triggerEvent(channel, CHAT_EVENTS.MESSAGES_READ, {
    orderId,
    readerType,
    readAt,
  });
}

/**
 * Notify typing status
 */
export async function notifyTyping(
  orderId: string,
  actorType: 'user' | 'merchant',
  isTyping: boolean
): Promise<void> {
  const channel = getOrderChannel(orderId);
  const event = isTyping ? CHAT_EVENTS.TYPING_START : CHAT_EVENTS.TYPING_STOP;

  await triggerEvent(channel, event, {
    orderId,
    actorType,
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
