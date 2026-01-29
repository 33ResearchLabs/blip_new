/**
 * WebSocket Event Types
 *
 * Event constants matching Pusher CHAT_EVENTS for consistency
 */

// Chat events (matches CHAT_EVENTS from pusher/events.ts)
export const WS_CHAT_EVENTS = {
  MESSAGE_NEW: 'chat:message-new',
  MESSAGES_READ: 'chat:messages-read',
  TYPING_START: 'chat:typing-start',
  TYPING_STOP: 'chat:typing-stop',
} as const;

// Client action types
export const WS_CLIENT_ACTIONS = {
  SUBSCRIBE: 'chat:subscribe',
  UNSUBSCRIBE: 'chat:unsubscribe',
  SEND: 'chat:send',
  TYPING: 'chat:typing',
  MARK_READ: 'chat:mark-read',
  PING: 'ping',
} as const;

// Server response types
export const WS_SERVER_RESPONSES = {
  CONNECTED: 'connected',
  SUBSCRIBED: 'chat:subscribed',
  UNSUBSCRIBED: 'chat:unsubscribed',
  PONG: 'pong',
  ERROR: 'error',
} as const;

// All events combined
export const WS_EVENTS = {
  ...WS_CHAT_EVENTS,
  ...WS_CLIENT_ACTIONS,
  ...WS_SERVER_RESPONSES,
} as const;

export type WSChatEvent = (typeof WS_CHAT_EVENTS)[keyof typeof WS_CHAT_EVENTS];
export type WSClientAction = (typeof WS_CLIENT_ACTIONS)[keyof typeof WS_CLIENT_ACTIONS];
export type WSServerResponse = (typeof WS_SERVER_RESPONSES)[keyof typeof WS_SERVER_RESPONSES];
export type WSEvent = WSChatEvent | WSClientAction | WSServerResponse;
