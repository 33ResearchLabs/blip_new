/**
 * WebSocket Broadcast Utility
 *
 * Bridge between Next.js API routes and the WebSocket server.
 * The WS server exposes its broadcast function via global.__wsBroadcastToOrder
 * (set in server.js). API routes call these helpers to push events to WS clients.
 */

declare global {
  // eslint-disable-next-line no-var
  var __wsBroadcastToOrder: ((orderId: string, message: object) => void) | undefined;
}

function broadcast(orderId: string, message: object) {
  const fn = global.__wsBroadcastToOrder;
  if (fn) {
    fn(orderId, message);
  }
}

/**
 * Broadcast order status update to all WS clients subscribed to this order
 */
export function wsBroadcastOrderUpdate(data: {
  orderId: string;
  status: string;
  minimalStatus?: string;
  previousStatus?: string;
  orderVersion?: number;
  updatedAt: string;
  data?: unknown;
}) {
  broadcast(data.orderId, {
    type: 'order:status-updated',
    timestamp: new Date().toISOString(),
    data,
  });
}

/**
 * Broadcast a new chat message to all WS clients subscribed to this order.
 *
 * Mirrors the `chat:message-new` event the WS server emits from its own
 * `chat:send` handler (websocket-server.js). Use this for messages inserted
 * OUTSIDE the WS server's send path — e.g. system messages written directly via
 * SQL by core-api / workers — so WS-connected clients render them live instead
 * of only on the next fetch. The chat client dedupes by message id, so it's
 * safe to also fire the Pusher path (notifyNewMessage) in parallel.
 */
export function wsBroadcastNewMessage(data: {
  orderId: string;
  messageId: string;
  senderType: string;
  senderId: string | null;
  senderName?: string | null;
  content: string;
  messageType: string;
  createdAt: string;
}) {
  broadcast(data.orderId, {
    type: 'chat:message-new',
    timestamp: new Date().toISOString(),
    data: {
      messageId: data.messageId,
      orderId: data.orderId,
      senderType: data.senderType,
      senderId: data.senderId,
      senderName: data.senderName ?? 'System',
      content: data.content,
      messageType: data.messageType,
      imageUrl: null,
      fileUrl: null,
      fileName: null,
      fileSize: null,
      mimeType: null,
      createdAt: data.createdAt,
      status: 'sent',
    },
  });
}

/**
 * Broadcast order created event
 */
export function wsBroadcastOrderCreated(data: {
  orderId: string;
  status: string;
  createdAt: string;
  data?: unknown;
}) {
  broadcast(data.orderId, {
    type: 'order:created',
    timestamp: new Date().toISOString(),
    data,
  });
}

/**
 * Broadcast chat status change to all participants.
 * Emitted when order status changes affect chat availability
 * (e.g., accepted → chat opens, completed → chat closes).
 * Frontend MUST react by showing/hiding the chat UI instantly.
 */
export function wsBroadcastChatStatusUpdate(data: {
  orderId: string;
  enabled: boolean;
  reason: string | null;
}) {
  broadcast(data.orderId, {
    type: 'chat:status-update',
    timestamp: new Date().toISOString(),
    data,
  });
}

/**
 * Broadcast order cancelled event
 */
export function wsBroadcastOrderCancelled(data: {
  orderId: string;
  cancelledBy: string;
  reason?: string;
  data?: unknown;
}) {
  broadcast(data.orderId, {
    type: 'order:cancelled',
    timestamp: new Date().toISOString(),
    data,
  });
}
