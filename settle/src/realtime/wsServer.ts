/**
 * Shadow WebSocket server for Blip Money.
 *
 * SHADOW MODE — fully isolated:
 *   - runs on its own port (WS_SHADOW_PORT, default 4001)
 *   - not imported by Next.js, server.js, or any API route
 *   - does not publish to or read from Pusher
 *   - does not create chat messages; delivery layer only
 *
 * Deleting src/realtime/ and scripts/run-ws-shadow.ts must leave the
 * app's build and tests unaffected.
 */
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createServer, type Server as HttpServer } from 'http';
import { authenticate } from './wsAuth';
import {
  register,
  unregister,
  getMeta,
  getActorSockets,
  totalConnectionCount,
} from './wsRegistry';
import {
  joinRoom,
  leaveRoom,
  leaveAllRooms,
  broadcastToRoom,
  socketsSharingRoomsWith,
  isValidRoom,
  getRoomSockets,
} from './wsRooms';
import {
  WS_SHADOW_LOG_PREFIX as TAG,
  type IncomingEvent,
  type OutgoingEvent,
} from './wsEvents';
import { subscribeShadowEvents, closeShadowBus } from './wsRedisBus';
import { canJoinOrderRoom } from './wsAcl';

const HEARTBEAT_MS = 30_000;

export interface ShadowServer {
  wss: WebSocketServer;
  http: HttpServer;
  port: number;
  close: () => Promise<void>;
  emitEvent: (event: OutgoingEvent) => number;
}

function send(ws: WebSocket, event: OutgoingEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { type: 'ERROR', data: { message } });
}

/**
 * Broadcast an event to all sockets in a room.
 * Exported as the canonical "emit" entry point.
 */
export function emitEvent(event: OutgoingEvent): number {
  if (!event.room) {
    console.warn(`${TAG} emitEvent called without room; ignored`, event.type);
    return 0;
  }
  return broadcastToRoom(event);
}

async function handleIncoming(ws: WebSocket, raw: RawData): Promise<void> {
  let msg: IncomingEvent;
  try {
    msg = JSON.parse(raw.toString()) as IncomingEvent;
  } catch {
    return sendError(ws, 'invalid JSON');
  }
  if (!msg || typeof msg !== 'object' || !('type' in msg)) {
    return sendError(ws, 'missing type');
  }

  switch (msg.type) {
    case 'JOIN_ORDER': {
      const room = `order:${msg.orderId}`;
      if (!isValidRoom(room)) return sendError(ws, 'invalid orderId');
      const meta = getMeta(ws);
      if (!meta) return sendError(ws, 'no session');
      // Read-only ACL: actor must be a participant in the order.
      const allowed = await canJoinOrderRoom(meta.actorType, meta.actorId, msg.orderId);
      if (!allowed) {
        console.warn(
          `${TAG} acl deny ${meta.actorType}:${meta.actorId} order:${msg.orderId}`
        );
        return sendError(ws, 'forbidden');
      }
      const wasFirstRoom = meta.rooms.size === 0;
      if (joinRoom(ws, room)) {
        send(ws, { type: 'JOINED', room });
        // Fire presence on first room join (now there's an audience).
        if (wasFirstRoom) broadcastPresence(ws, 'USER_ONLINE');
      } else {
        sendError(ws, 'join failed');
      }
      return;
    }
    case 'LEAVE_ORDER': {
      const room = `order:${msg.orderId}`;
      leaveRoom(ws, room);
      send(ws, { type: 'LEFT', room });
      return;
    }
    case 'TYPING':
    case 'STOP_TYPING': {
      const meta = getMeta(ws);
      if (!meta) return;
      const room = `order:${msg.orderId}`;
      if (!meta.rooms.has(room)) return sendError(ws, 'not in room');
      broadcastToRoom(
        {
          type: msg.type,
          room,
          data: { actorId: meta.actorId, actorType: meta.actorType },
        },
        ws
      );
      return;
    }
    case 'READ_MESSAGE':
    case 'DELIVERED_MESSAGE': {
      const meta = getMeta(ws);
      if (!meta) return;
      const room = `order:${msg.orderId}`;
      if (!meta.rooms.has(room)) return sendError(ws, 'not in room');
      broadcastToRoom(
        {
          type: msg.type,
          room,
          data: {
            actorId: meta.actorId,
            actorType: meta.actorType,
            messageId: msg.messageId,
          },
        },
        ws
      );
      return;
    }
    case 'SYNC': {
      // Mock response — no DB integration in shadow mode.
      send(ws, {
        type: 'SYNC_ACK',
        data: { lastSeq: msg.lastSeq, missed: [] },
      });
      return;
    }
    default:
      sendError(ws, `unknown type: ${(msg as { type: string }).type}`);
  }
}

/** Broadcast presence ONLY to rooms the actor already shares with peers. */
function broadcastPresence(
  ws: WebSocket,
  type: 'USER_ONLINE' | 'USER_OFFLINE'
): void {
  const meta = getMeta(ws);
  if (!meta) return;
  const peers = socketsSharingRoomsWith(ws);
  if (peers.size === 0) return;
  const payload = JSON.stringify({
    type,
    data: { actorId: meta.actorId, actorType: meta.actorType },
  });
  for (const peer of peers) {
    if (peer.readyState === peer.OPEN) peer.send(payload);
  }
}

export function startShadowServer(
  portOverride?: number
): Promise<ShadowServer> {
  const port = portOverride ?? Number(process.env.WS_SHADOW_PORT ?? 4001);

  return new Promise((resolve, reject) => {
    const http = createServer((_req, res) => {
      // Minimal health endpoint — shadow server only.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          mode: 'shadow',
          connections: totalConnectionCount(),
        })
      );
    });

    const wss = new WebSocketServer({ noServer: true });

    http.on('upgrade', (req, socket, head) => {
      const identity = authenticate(req);
      if (!identity) {
        console.warn(`${TAG} upgrade rejected: unauthenticated`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      // If the client used the subprotocol-token transport, RFC 6455
      // requires us to confirm exactly one selected subprotocol back.
      const sub = req.headers['sec-websocket-protocol'];
      if (sub && typeof sub === 'string' && sub.includes('bearer')) {
        (req.headers as Record<string, string>)['sec-websocket-protocol'] = 'bearer';
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, identity);
      });
    });

    wss.on('connection', (ws: WebSocket, _req, identity) => {
      const { actorId, actorType } = identity as {
        actorId: string;
        actorType: 'user' | 'merchant' | 'compliance';
      };
      register(ws, actorType, actorId);
      console.log(
        `${TAG} connect ${actorType}:${actorId} (total=${totalConnectionCount()})`
      );

      // Mark heartbeat alive
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      ws.on('pong', () => {
        (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      });

      ws.on('message', (raw) => {
        void handleIncoming(ws, raw).catch((err) =>
          console.warn(`${TAG} handler error`, (err as Error).message)
        );
      });

      ws.on('close', () => {
        // Broadcast offline to rooms the socket is still in, BEFORE
        // leaveAllRooms() clears its memberships.
        const { meta, wentOffline } = unregister(ws);
        if (wentOffline) {
          broadcastPresence(ws, 'USER_OFFLINE');
        }
        leaveAllRooms(ws);
        console.log(
          `${TAG} disconnect ${meta?.actorType}:${meta?.actorId} offline=${wentOffline} (total=${totalConnectionCount()})`
        );
      });

      ws.on('error', (err) => {
        console.warn(`${TAG} socket error`, (err as Error).message);
      });

      // If this is the first connection for the actor, presence is
      // broadcast lazily — only after they join a room (see below).
    });

    // Heartbeat loop
    const heartbeat = setInterval(() => {
      wss.clients.forEach((ws) => {
        const w = ws as WebSocket & { isAlive?: boolean };
        if (w.isAlive === false) {
          console.warn(`${TAG} terminating dead socket`);
          return ws.terminate();
        }
        w.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      });
    }, HEARTBEAT_MS);

    wss.on('close', () => clearInterval(heartbeat));

    http.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`${TAG} port ${port} already in use — exiting`);
      } else {
        console.error(`${TAG} http error`, err);
      }
      reject(err);
    });

    // Redis subscriber: cross-process fan-out. If Redis is unavailable
    // this is a no-op and the server still works in single-node mode.
    const unsubscribe = subscribeShadowEvents((event) => {
      if (!event.room) return;
      broadcastToRoom(event);
    });

    http.listen(port, () => {
      console.log(`${TAG} listening on :${port}`);
      resolve({
        wss,
        http,
        port,
        emitEvent,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(heartbeat);
            void unsubscribe()
              .catch(() => {})
              .then(() => closeShadowBus())
              .catch(() => {})
              .finally(() => {
                wss.close(() => http.close(() => res()));
              });
          }),
      });
    });
  });
}

// Re-export for callers that want to publish events (none in shadow mode).
export { getActorSockets, getRoomSockets };
