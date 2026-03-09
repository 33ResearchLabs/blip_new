/**
 * WebSocket Broadcast Module (Core API)
 *
 * Manages WS connections and broadcasts order updates to subscribed clients.
 * Clients subscribe by sending: { type: 'subscribe', actorType, actorId }
 * Server broadcasts: { type: 'order_event', event_type, order_id, status, minimal_status, order_version }
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { logger, broadcastPayloadSchema, SCHEMA_VERSION, VALIDATED_WS_EVENTS } from 'settlement-core';

interface ClientMeta {
  actorType: string;
  actorId: string;
  alive: boolean;
}

// Map: ws -> client metadata
const clients = new Map<WebSocket, ClientMeta>();

// Index: actorKey -> Set<WebSocket> for fast lookup
// actorKey = `${actorType}:${actorId}` e.g. "merchant:abc-123"
const actorIndex = new Map<string, Set<WebSocket>>();

const MAX_CONNECTIONS = 500;
let wss: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Initialize WS server on the same HTTP server as Fastify
 */
export function initWebSocketServer(server: HTTPServer): void {
  wss = new WebSocketServer({ server, path: '/ws/orders' });

  wss.on('connection', (ws) => {
    // Reject if at capacity
    if (clients.size >= MAX_CONNECTIONS) {
      logger.warn('[WS] Max connections reached, rejecting');
      ws.close(1013, 'Max connections');
      return;
    }
    logger.info('[WS] New connection');

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'subscribe' && msg.actorType && msg.actorId) {
          const meta: ClientMeta = {
            actorType: msg.actorType,
            actorId: msg.actorId,
            alive: true,
          };
          clients.set(ws, meta);

          const key = `${msg.actorType}:${msg.actorId}`;
          if (!actorIndex.has(key)) {
            actorIndex.set(key, new Set());
          }
          actorIndex.get(key)!.add(ws);

          ws.send(JSON.stringify({ type: 'subscribed', actorType: msg.actorType, actorId: msg.actorId }));
          logger.info('[WS] Client subscribed', { actorType: msg.actorType, actorId: msg.actorId });
        }

        if (msg.type === 'pong') {
          const meta = clients.get(ws);
          if (meta) meta.alive = true;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      const meta = clients.get(ws);
      if (meta) {
        const key = `${meta.actorType}:${meta.actorId}`;
        actorIndex.get(key)?.delete(ws);
        if (actorIndex.get(key)?.size === 0) {
          actorIndex.delete(key);
        }
      }
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      logger.error('[WS] Client error', { error: err.message });
      // Clean up on error — client is dead
      const meta = clients.get(ws);
      if (meta) {
        const key = `${meta.actorType}:${meta.actorId}`;
        actorIndex.get(key)?.delete(ws);
        if (actorIndex.get(key)?.size === 0) actorIndex.delete(key);
      }
      clients.delete(ws);
      try { ws.terminate(); } catch { /* already dead */ }
    });
  });

  // Heartbeat every 30s — kill stale connections
  heartbeatInterval = setInterval(() => {
    clients.forEach((meta, ws) => {
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        clients.delete(ws);
        return;
      }
      if (!meta.alive) {
        ws.terminate();
        return;
      }
      meta.alive = false;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { ws.terminate(); }
    });
  }, 30000);

  logger.info('[WS] WebSocket server initialized on /ws/orders');
}

export interface BroadcastPayload {
  event_type: string;
  order_id: string;
  status: string;
  minimal_status: string;
  order_version: number;
  userId?: string;
  merchantId?: string;
  buyerMerchantId?: string;
  previousStatus?: string;
  premium_bps_current?: number;
  max_reached?: boolean;
}

/**
 * Broadcast an order event to relevant subscribers.
 *
 * Determines targets based on userId/merchantId.
 * For ORDER_CREATED/ACCEPTED/CANCELLED/EXPIRED: broadcasts to ALL merchants.
 */
export function broadcastOrderEvent(payload: BroadcastPayload): void {
  if (!wss) return;

  // Inject schema_version into all broadcasts
  const enriched = { ...payload, schema_version: SCHEMA_VERSION };

  // Validate the 5 critical events; pass-through others (LOCK #5)
  if (VALIDATED_WS_EVENTS.has(payload.event_type as any)) {
    const result = broadcastPayloadSchema.safeParse(enriched);
    if (!result.success) {
      logger.error('[WS] PAYLOAD VALIDATION FAILED — event NOT broadcast', {
        event_type: payload.event_type,
        order_id: payload.order_id,
        issues: result.error.issues,
      });
      return;
    }
  }

  const message = JSON.stringify({
    type: 'order_event',
    schema_version: SCHEMA_VERSION,
    event_type: payload.event_type,
    order_id: payload.order_id,
    status: payload.status,
    minimal_status: payload.minimal_status,
    order_version: payload.order_version,
    previousStatus: payload.previousStatus,
    buyer_merchant_id: payload.buyerMerchantId,
    merchant_id: payload.merchantId,
  });

  const targets = new Set<WebSocket>();

  // Send to involved user
  if (payload.userId) {
    actorIndex.get(`user:${payload.userId}`)?.forEach((ws) => targets.add(ws));
  }
  // Send to involved merchant
  if (payload.merchantId) {
    actorIndex.get(`merchant:${payload.merchantId}`)?.forEach((ws) => targets.add(ws));
  }
  // M2M buyer merchant
  if (payload.buyerMerchantId) {
    actorIndex.get(`merchant:${payload.buyerMerchantId}`)?.forEach((ws) => targets.add(ws));
  }

  // For create/accept/cancel/expire: broadcast to ALL merchants
  const broadcastToAll = ['ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_CANCELLED', 'ORDER_EXPIRED'];
  if (broadcastToAll.includes(payload.event_type)) {
    for (const [key, wsSet] of actorIndex) {
      if (key.startsWith('merchant:')) {
        wsSet.forEach((ws) => targets.add(ws));
      }
    }
  }

  let sent = 0;
  targets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(message); sent++; } catch { /* dead socket, heartbeat will clean */ }
    }
  });

  if (sent > 0) {
    logger.info('[WS] Broadcast sent', {
      event: payload.event_type,
      orderId: payload.order_id,
      recipients: sent,
    });
  }
}

/**
 * Broadcast a price update to ALL connected merchants.
 */
export interface PriceBroadcastPayload {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  confidence: string;
  updated_at: string;
}

export function broadcastPriceEvent(payload: PriceBroadcastPayload): void {
  if (!wss) return;

  const message = JSON.stringify({ type: 'price_update', ...payload });
  let sent = 0;

  for (const [key, wsSet] of actorIndex) {
    if (key.startsWith('merchant:')) {
      wsSet.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(message); sent++; } catch { /* dead socket, heartbeat will clean */ }
        }
      });
    }
  }

  if (sent > 0) {
    logger.info('[WS] Price broadcast sent', {
      corridor: payload.corridor_id,
      refPrice: payload.ref_price,
      recipients: sent,
    });
  }
}

/**
 * Return WS connection stats (for /debug/ws endpoint)
 */
export function getWsStats() {
  const subscriptions: Record<string, number> = {};
  for (const [key, wsSet] of actorIndex) {
    subscriptions[key] = wsSet.size;
  }

  return {
    connected: clients.size,
    subscriptions,
    subscriptionCount: actorIndex.size,
  };
}

/**
 * Cleanup WS server (for graceful shutdown)
 */
export function closeWebSocketServer(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
  clients.clear();
  actorIndex.clear();
}
