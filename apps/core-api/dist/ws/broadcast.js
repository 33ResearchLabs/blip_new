/**
 * WebSocket Broadcast Module (Core API)
 *
 * Manages WS connections and broadcasts order updates to subscribed clients.
 * Clients subscribe by sending: { type: 'subscribe', actorType, actorId }
 * Server broadcasts: { type: 'order_event', event_type, order_id, status, minimal_status, order_version }
 */
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from 'settlement-core';
// Map: ws -> client metadata
const clients = new Map();
// Index: actorKey -> Set<WebSocket> for fast lookup
// actorKey = `${actorType}:${actorId}` e.g. "merchant:abc-123"
const actorIndex = new Map();
let wss = null;
let heartbeatInterval = null;
/**
 * Initialize WS server on the same HTTP server as Fastify
 */
export function initWebSocketServer(server) {
    wss = new WebSocketServer({ server, path: '/ws/orders' });
    wss.on('connection', (ws) => {
        logger.info('[WS] New connection');
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'subscribe' && msg.actorType && msg.actorId) {
                    const meta = {
                        actorType: msg.actorType,
                        actorId: msg.actorId,
                        alive: true,
                    };
                    clients.set(ws, meta);
                    const key = `${msg.actorType}:${msg.actorId}`;
                    if (!actorIndex.has(key)) {
                        actorIndex.set(key, new Set());
                    }
                    actorIndex.get(key).add(ws);
                    ws.send(JSON.stringify({ type: 'subscribed', actorType: msg.actorType, actorId: msg.actorId }));
                    logger.info('[WS] Client subscribed', { actorType: msg.actorType, actorId: msg.actorId });
                }
                if (msg.type === 'pong') {
                    const meta = clients.get(ws);
                    if (meta)
                        meta.alive = true;
                }
            }
            catch {
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
        });
    });
    // Heartbeat every 30s
    heartbeatInterval = setInterval(() => {
        clients.forEach((meta, ws) => {
            if (!meta.alive) {
                ws.terminate();
                return;
            }
            meta.alive = false;
            ws.send(JSON.stringify({ type: 'ping' }));
        });
    }, 30000);
    logger.info('[WS] WebSocket server initialized on /ws/orders');
}
/**
 * Broadcast an order event to relevant subscribers.
 *
 * Determines targets based on userId/merchantId.
 * For ORDER_CREATED/ACCEPTED/CANCELLED/EXPIRED: broadcasts to ALL merchants.
 */
export function broadcastOrderEvent(payload) {
    if (!wss)
        return;
    const message = JSON.stringify({
        type: 'order_event',
        event_type: payload.event_type,
        order_id: payload.order_id,
        status: payload.status,
        minimal_status: payload.minimal_status,
        order_version: payload.order_version,
        previousStatus: payload.previousStatus,
    });
    const targets = new Set();
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
            ws.send(message);
            sent++;
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
 * Return WS connection stats (for /debug/ws endpoint)
 */
export function getWsStats() {
    const subscriptions = {};
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
export function closeWebSocketServer() {
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
