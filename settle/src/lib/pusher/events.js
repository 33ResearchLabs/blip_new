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
};
// Chat events
export const CHAT_EVENTS = {
    MESSAGE_NEW: 'chat:message-new',
    MESSAGES_READ: 'chat:messages-read',
    TYPING_START: 'chat:typing-start',
    TYPING_STOP: 'chat:typing-stop',
};
// Notification events
export const NOTIFICATION_EVENTS = {
    NEW: 'notification:new',
};
// All events combined
export const PUSHER_EVENTS = {
    ...ORDER_EVENTS,
    ...CHAT_EVENTS,
    ...NOTIFICATION_EVENTS,
};
