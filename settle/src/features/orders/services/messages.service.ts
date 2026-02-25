/**
 * Messages Service — API communication for order chat
 *
 * Pure async functions. No React state, no polling logic, no Pusher bindings.
 * Polling/realtime is handled by the existing useChat / useRealtimeChat hooks.
 */

import api from '@/lib/api/client';

// ─── Types ────────────────────────────────────────────────────────────

export interface SendMessageParams {
  orderId: string;
  sender_type: 'user' | 'merchant';
  sender_id: string;
  content: string;
  message_type?: 'text' | 'image';
  image_url?: string;
}

export interface MarkReadParams {
  orderId: string;
  reader_type: 'user' | 'merchant';
}

// ─── Service functions ────────────────────────────────────────────────

/** Fetch all messages for an order */
export async function getMessages(orderId: string) {
  return api.orders.getMessages(orderId);
}

/** Send a message in an order chat */
export async function sendMessage(params: SendMessageParams) {
  const { orderId, ...body } = params;
  return api.orders.sendMessage(orderId, body);
}

/** Mark messages as read */
export async function markMessagesRead(params: MarkReadParams) {
  return api.orders.markMessagesRead(params.orderId, params.reader_type);
}
