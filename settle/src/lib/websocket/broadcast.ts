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
