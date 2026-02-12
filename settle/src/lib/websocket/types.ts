/**
 * WebSocket Message Types
 *
 * Shared types for client-server WebSocket communication
 */

// Actor types
export type ActorType = 'user' | 'merchant' | 'compliance' | 'system';

// Message types for chat
export type MessageType =
  | 'text'
  | 'image'
  | 'system'
  | 'dispute'
  | 'resolution'
  | 'resolution_proposed'
  | 'resolution_rejected'
  | 'resolution_accepted'
  | 'resolution_finalized';

// Base message structure
export interface WSMessage {
  type: string;
  timestamp?: string;
}

// ============================================
// Client -> Server Messages
// ============================================

export interface WSSubscribeMessage extends WSMessage {
  type: 'chat:subscribe';
  orderId: string;
}

export interface WSUnsubscribeMessage extends WSMessage {
  type: 'chat:unsubscribe';
  orderId: string;
}

export interface WSSendMessage extends WSMessage {
  type: 'chat:send';
  orderId: string;
  content: string;
  messageType: MessageType;
  imageUrl?: string;
}

export interface WSTypingMessage extends WSMessage {
  type: 'chat:typing';
  orderId: string;
  isTyping: boolean;
}

export interface WSMarkReadMessage extends WSMessage {
  type: 'chat:mark-read';
  orderId: string;
}

export interface WSPingMessage extends WSMessage {
  type: 'ping';
}

// Union of all client messages
export type ClientMessage =
  | WSSubscribeMessage
  | WSUnsubscribeMessage
  | WSSendMessage
  | WSTypingMessage
  | WSMarkReadMessage
  | WSPingMessage;

// ============================================
// Server -> Client Messages
// ============================================

export interface WSSubscribedMessage extends WSMessage {
  type: 'chat:subscribed';
  orderId: string;
  success: boolean;
  error?: string;
}

export interface WSUnsubscribedMessage extends WSMessage {
  type: 'chat:unsubscribed';
  orderId: string;
}

export interface WSNewMessageEvent extends WSMessage {
  type: 'chat:message-new';
  data: {
    messageId: string;
    orderId: string;
    senderType: ActorType;
    senderId: string | null;
    senderName?: string;
    content: string;
    messageType: MessageType;
    imageUrl?: string | null;
    createdAt: string;
  };
}

export interface WSTypingEvent extends WSMessage {
  type: 'chat:typing-start' | 'chat:typing-stop';
  data: {
    orderId: string;
    actorType: ActorType;
  };
}

export interface WSMessagesReadEvent extends WSMessage {
  type: 'chat:messages-read';
  data: {
    orderId: string;
    readerType: ActorType;
    readAt: string;
  };
}

export interface WSPongMessage extends WSMessage {
  type: 'pong';
}

export interface WSErrorMessage extends WSMessage {
  type: 'error';
  code: number;
  message: string;
}

export interface WSConnectedMessage extends WSMessage {
  type: 'connected';
  connectionId: string;
}

// ============================================
// Order Events (Server -> Client)
// ============================================

export interface WSOrderStatusUpdatedEvent extends WSMessage {
  type: 'order:status-updated';
  data: {
    orderId: string;
    status: string;
    previousStatus?: string;
    updatedAt: string;
    data?: unknown;
  };
}

export interface WSOrderCreatedEvent extends WSMessage {
  type: 'order:created';
  data: {
    orderId: string;
    status: string;
    createdAt: string;
    data?: unknown;
  };
}

export interface WSOrderCancelledEvent extends WSMessage {
  type: 'order:cancelled';
  data: {
    orderId: string;
    cancelledBy: string;
    reason?: string;
    data?: unknown;
  };
}

export type WSOrderEvent = WSOrderStatusUpdatedEvent | WSOrderCreatedEvent | WSOrderCancelledEvent;

// Union of all server messages
export type ServerMessage =
  | WSSubscribedMessage
  | WSUnsubscribedMessage
  | WSNewMessageEvent
  | WSTypingEvent
  | WSMessagesReadEvent
  | WSPongMessage
  | WSErrorMessage
  | WSConnectedMessage
  | WSOrderStatusUpdatedEvent
  | WSOrderCreatedEvent
  | WSOrderCancelledEvent;

// ============================================
// Connection State
// ============================================

export interface WSClientInfo {
  actorType: ActorType;
  actorId: string;
  connectionId: string;
  subscribedOrders: Set<string>;
  lastPing: number;
}

// Error codes
export const WS_ERROR_CODES = {
  AUTH_FAILED: 4001,
  INVALID_MESSAGE: 4002,
  ORDER_ACCESS_DENIED: 4003,
  RATE_LIMITED: 4004,
  SERVER_ERROR: 4005,
} as const;
