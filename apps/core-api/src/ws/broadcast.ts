/**
 * WebSocket Broadcast Module (Core API)
 *
 * Manages WS connections and broadcasts order updates to subscribed clients.
 * Clients subscribe by sending: { type: 'subscribe', actorType, actorId }
 * Server broadcasts: { type: 'order_event', event_type, order_id, status, minimal_status, order_version }
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { logger } from 'settlement-core';

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
  // Optional fields used by EXPIRY_WARNING — passed through to clients so
  // the toast can show the remaining countdown without an extra fetch.
  expires_at?: string;
  seconds_remaining?: number;
}

// Events that participants alone should receive — never the global
// merchants pool. Listed explicitly so a future contributor can't silently
// add a participant-only event to the `broadcastToAll` set below.
const PARTICIPANT_ONLY_EVENTS = new Set([
  'INACTIVITY_WARNING',
  'EXPIRY_WARNING',
]);

/**
 * Broadcast an order event.
 *
 * SECURITY: this used to broadcast to per-actor subscribers on the
 * unauthenticated /ws/orders socket — anyone who knew an actorId could
 * `{type:'subscribe', actorType, actorId}` and receive that actor's order
 * events (counterparty IDs, amounts, statuses) in real time. The fix:
 * stop emitting order events on /ws/orders entirely. All authenticated
 * order-event delivery flows over Pusher (auth-gated private channels)
 * via `broadcastOrderToPusher`, which every caller invokes alongside
 * this function. The client (`settle/src/hooks/useRealtimeOrders.ts`)
 * already ignores order_event messages from this socket — it only
 * consumes `price_update`. So this change is observable to attackers
 * (the leak stops) and invisible to legitimate clients.
 *
 * Kept as a no-op (rather than deleted) so that call sites in workers
 * and event listeners continue to compile and run unchanged.
 */
export function broadcastOrderEvent(_payload: BroadcastPayload): void {
  // intentional no-op — see comment above
  void _payload;
  void PARTICIPANT_ONLY_EVENTS;
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
