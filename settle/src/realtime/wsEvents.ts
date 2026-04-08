/**
 * WebSocket event types for the shadow realtime server.
 * SHADOW MODE: not wired to any production code path.
 */

export type ActorType = 'user' | 'merchant' | 'compliance';

// ── Incoming (client → server) ─────────────────────────────────────────
export type IncomingEvent =
  | { type: 'JOIN_ORDER'; orderId: string }
  | { type: 'LEAVE_ORDER'; orderId: string }
  | { type: 'TYPING'; orderId: string }
  | { type: 'STOP_TYPING'; orderId: string }
  | { type: 'READ_MESSAGE'; orderId: string; messageId: string }
  | { type: 'DELIVERED_MESSAGE'; orderId: string; messageId: string }
  | { type: 'SYNC'; lastSeq: number };

// ── Outgoing (server → client) ─────────────────────────────────────────
export type OutgoingEventType =
  | 'MESSAGE_NEW'
  | 'ORDER_UPDATED'
  | 'NOTIFICATION_NEW'
  | 'USER_ONLINE'
  | 'USER_OFFLINE'
  | 'TYPING'
  | 'STOP_TYPING'
  | 'READ_MESSAGE'
  | 'DELIVERED_MESSAGE'
  | 'SYNC_ACK'
  | 'JOINED'
  | 'LEFT'
  | 'ERROR';

export interface OutgoingEvent {
  type: OutgoingEventType;
  room?: string;
  data?: unknown;
}

export const WS_SHADOW_LOG_PREFIX = '[ws-shadow]';
