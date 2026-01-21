/**
 * Pusher Event Types
 *
 * Centralized event name constants for real-time communication
 */

// Order events
export const ORDER_EVENTS = {
  CREATED: 'order:created',
  STATUS_UPDATED: 'order:status-updated',
  CANCELLED: 'order:cancelled',
  EXPIRED: 'order:expired',
  EXTENSION_REQUESTED: 'order:extension-requested',
  EXTENSION_RESPONSE: 'order:extension-response',
} as const;

// Chat events
export const CHAT_EVENTS = {
  MESSAGE_NEW: 'chat:message-new',
  MESSAGES_READ: 'chat:messages-read',
  TYPING_START: 'chat:typing-start',
  TYPING_STOP: 'chat:typing-stop',
} as const;

// Notification events
export const NOTIFICATION_EVENTS = {
  NEW: 'notification:new',
} as const;

// All events combined
export const PUSHER_EVENTS = {
  ...ORDER_EVENTS,
  ...CHAT_EVENTS,
  ...NOTIFICATION_EVENTS,
} as const;

export type OrderEvent = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];
export type ChatEvent = (typeof CHAT_EVENTS)[keyof typeof CHAT_EVENTS];
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
export type PusherEvent = OrderEvent | ChatEvent | NotificationEvent;
