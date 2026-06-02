/**
 * Support Chat WebSocket Server
 *
 * Path: /ws/support
 *
 * User clients connect with:
 *   { type: 'join', actorType: 'user'|'merchant', actorId: string, displayName?: string }
 *
 * Admin clients connect with:
 *   { type: 'join_admin', adminSecret: string }
 *
 * Messages:
 *   { type: 'message', sessionId: string, content: string }
 *
 * Admin can resolve sessions:
 *   { type: 'resolve', sessionId: string }
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { query, queryOne } from 'settlement-core';
import { logger } from 'settlement-core';

const ADMIN_SECRET = process.env.SUPPORT_ADMIN_SECRET || 'support-admin-dev';

interface UserClient {
  kind: 'user';
  actorType: string;
  actorId: string;
  sessionId: string;
  alive: boolean;
}

interface AdminClient {
  kind: 'admin';
  alive: boolean;
}

type ClientMeta = UserClient | AdminClient;

const clients = new Map<WebSocket, ClientMeta>();
const adminSockets = new Set<WebSocket>();
// sessionId -> user WebSocket (one active connection per session)
const sessionSockets = new Map<string, WebSocket>();

let wss: WebSocketServer | null = null;
let heartbeat: NodeJS.Timeout | null = null;

export function initSupportChatServer(server: HTTPServer): void {
  wss = new WebSocketServer({ server, path: '/ws/support' });

  wss.on('connection', (ws) => {
    clients.set(ws, { kind: 'user', actorType: '', actorId: '', sessionId: '', alive: true });

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      const meta = clients.get(ws);
      if (!meta) return;

      if (msg.type === 'join' && typeof msg.actorType === 'string' && typeof msg.actorId === 'string') {
        await handleUserJoin(ws, msg.actorType, msg.actorId, msg.displayName as string | undefined);
        return;
      }

      if (msg.type === 'join_admin' && msg.adminSecret === ADMIN_SECRET) {
        await handleAdminJoin(ws);
        return;
      }

      if (msg.type === 'message' && typeof msg.content === 'string') {
        if (meta.kind === 'admin') {
          await handleAdminMessage(ws, msg.sessionId as string, msg.content);
        } else if (meta.kind === 'user' && meta.sessionId) {
          await handleUserMessage(ws, meta, msg.content);
        }
        return;
      }

      if (msg.type === 'resolve' && meta.kind === 'admin' && typeof msg.sessionId === 'string') {
        await handleResolve(msg.sessionId);
        return;
      }

      if (msg.type === 'pong') {
        if (meta) meta.alive = true;
      }
    });

    ws.on('close', () => {
      const meta = clients.get(ws);
      if (meta?.kind === 'admin') adminSockets.delete(ws);
      if (meta?.kind === 'user' && meta.sessionId) {
        if (sessionSockets.get(meta.sessionId) === ws) sessionSockets.delete(meta.sessionId);
      }
      clients.delete(ws);
    });

    ws.on('error', () => {
      const meta = clients.get(ws);
      if (meta?.kind === 'admin') adminSockets.delete(ws);
      if (meta?.kind === 'user' && meta.sessionId) {
        if (sessionSockets.get(meta.sessionId) === ws) sessionSockets.delete(meta.sessionId);
      }
      clients.delete(ws);
      try { ws.terminate(); } catch { /* already dead */ }
    });
  });

  heartbeat = setInterval(() => {
    clients.forEach((meta, ws) => {
      if (!meta.alive) { ws.terminate(); return; }
      meta.alive = false;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { ws.terminate(); }
    });
  }, 30000);

  logger.info('[SupportWS] Support chat WebSocket server initialized on /ws/support');
}

async function handleUserJoin(ws: WebSocket, actorType: string, actorId: string, displayName?: string): Promise<void> {
  try {
    // Find or create session
    let session = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM support_sessions WHERE actor_type=$1 AND actor_id=$2 AND status='open' ORDER BY created_at DESC LIMIT 1`,
      [actorType, actorId],
    );

    if (!session) {
      const rows = await query<{ id: string }>(
        `INSERT INTO support_sessions (actor_type, actor_id, display_name, status)
         VALUES ($1, $2, $3, 'open') RETURNING id`,
        [actorType, actorId, displayName || actorId],
      );
      session = { id: rows[0].id, status: 'open' };
    }

    const meta: UserClient = { kind: 'user', actorType, actorId, sessionId: session.id, alive: true };
    clients.set(ws, meta);
    sessionSockets.set(session.id, ws);

    // Send last 50 messages
    const messages = await query<{ id: string; sender: string; content: string; created_at: string }>(
      `SELECT id, sender, content, created_at FROM support_messages WHERE session_id=$1 ORDER BY created_at ASC LIMIT 50`,
      [session.id],
    );

    ws.send(JSON.stringify({ type: 'joined', sessionId: session.id, history: messages }));
    logger.info('[SupportWS] User joined', { actorType, actorId, sessionId: session.id });
  } catch (err) {
    logger.error('[SupportWS] handleUserJoin error', { error: (err as Error).message });
  }
}

async function handleAdminJoin(ws: WebSocket): Promise<void> {
  const meta: AdminClient = { kind: 'admin', alive: true };
  clients.set(ws, meta);
  adminSockets.add(ws);

  // Send all open sessions with last message
  const sessions = await query<{
    id: string; actor_type: string; actor_id: string; display_name: string;
    status: string; last_message_at: string; last_message_preview: string; unread_admin: number; created_at: string;
  }>(
    `SELECT id, actor_type, actor_id, display_name, status, last_message_at, last_message_preview, unread_admin, created_at
     FROM support_sessions ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 100`,
    [],
  );

  ws.send(JSON.stringify({ type: 'admin_joined', sessions }));
  logger.info('[SupportWS] Admin joined');
}

async function handleUserMessage(ws: WebSocket, meta: UserClient, content: string): Promise<void> {
  if (!content.trim()) return;
  try {
    const rows = await query<{ id: string; created_at: string }>(
      `INSERT INTO support_messages (session_id, sender, content) VALUES ($1, 'user', $2) RETURNING id, created_at`,
      [meta.sessionId, content.slice(0, 2000)],
    );
    const msg = rows[0];

    await query(
      `UPDATE support_sessions SET last_message_at=NOW(), last_message_preview=$1, unread_admin=unread_admin+1, updated_at=NOW() WHERE id=$2`,
      [content.slice(0, 100), meta.sessionId],
    );

    const envelope = {
      type: 'message',
      sessionId: meta.sessionId,
      id: msg.id,
      sender: 'user',
      content,
      created_at: msg.created_at,
      actorId: meta.actorId,
      actorType: meta.actorType,
    };

    // Echo back to user
    safeSend(ws, envelope);

    // Broadcast to all admins
    broadcastToAdmins(envelope);
  } catch (err) {
    logger.error('[SupportWS] handleUserMessage error', { error: (err as Error).message });
  }
}

async function handleAdminMessage(_ws: WebSocket, sessionId: string, content: string): Promise<void> {
  if (!sessionId || !content.trim()) return;
  try {
    const rows = await query<{ id: string; created_at: string }>(
      `INSERT INTO support_messages (session_id, sender, content) VALUES ($1, 'admin', $2) RETURNING id, created_at`,
      [sessionId, content.slice(0, 2000)],
    );
    const msg = rows[0];

    await query(
      `UPDATE support_sessions SET last_message_at=NOW(), last_message_preview=$1, updated_at=NOW() WHERE id=$2`,
      [content.slice(0, 100), sessionId],
    );

    const envelope = { type: 'message', sessionId, id: msg.id, sender: 'admin', content, created_at: msg.created_at };

    // Send to user if online
    const userWs = sessionSockets.get(sessionId);
    if (userWs && userWs.readyState === WebSocket.OPEN) safeSend(userWs, envelope);

    // Echo + broadcast to all admins
    broadcastToAdmins(envelope);
  } catch (err) {
    logger.error('[SupportWS] handleAdminMessage error', { error: (err as Error).message });
  }
}

async function handleResolve(sessionId: string): Promise<void> {
  try {
    await query(`UPDATE support_sessions SET status='resolved', updated_at=NOW() WHERE id=$1`, [sessionId]);
    const payload = { type: 'session_resolved', sessionId };
    broadcastToAdmins(payload);
    const userWs = sessionSockets.get(sessionId);
    if (userWs && userWs.readyState === WebSocket.OPEN) safeSend(userWs, payload);
  } catch (err) {
    logger.error('[SupportWS] handleResolve error', { error: (err as Error).message });
  }
}

function broadcastToAdmins(payload: object): void {
  const msg = JSON.stringify(payload);
  adminSockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) try { ws.send(msg); } catch { /* dead */ }
  });
}

function safeSend(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) try { ws.send(JSON.stringify(payload)); } catch { /* dead */ }
}

export function closeSupportChatServer(): void {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  if (wss) { wss.close(); wss = null; }
  clients.clear();
  adminSockets.clear();
  sessionSockets.clear();
}
