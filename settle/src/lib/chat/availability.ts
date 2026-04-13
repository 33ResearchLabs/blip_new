/**
 * Chat Availability — Backend Source of Truth
 *
 * The frontend must NEVER decide chat availability on its own.
 * This module returns the definitive { enabled, reason } state
 * for any order, and the message POST handler enforces it.
 *
 * Rules:
 *  1. Chat requires BOTH parties connected (order accepted)
 *  2. Chat closes on completed / cancelled / expired
 *  3. Compliance can always message on disputed orders
 *  4. Frozen chats block everyone except compliance
 */

export interface ChatStatus {
  enabled: boolean;
  reason: string | null;
}

// Order statuses where chat is fully open for all participants
const CHAT_OPEN_STATUSES = new Set([
  'accepted',
  'escrowed',
  'payment_sent',
  'disputed',
]);

// Order statuses where chat is closed for regular participants
const CHAT_CLOSED_STATUSES = new Set([
  'completed',
  'cancelled',
  'expired',
]);

interface OrderForChat {
  id: string;
  status: string;
  user_id: string | null;
  merchant_id: string | null;
  buyer_merchant_id: string | null;
  chat_frozen?: boolean;
  chat_frozen_by?: string | null;
}

/**
 * Determine chat availability for a given order and actor.
 *
 * This is the SINGLE source of truth. Both the chat status API
 * and the message POST handler call this function.
 */
export function getChatAvailability(
  order: OrderForChat,
  actorType: 'user' | 'merchant' | 'compliance' | 'system',
): ChatStatus {
  // ── 1. Order not yet accepted — neither party should chat ──
  if (order.status === 'open' || order.status === 'pending') {
    return {
      enabled: false,
      reason: 'Waiting for counterparty to accept the order',
    };
  }

  // ── 2. Chat frozen by compliance — only compliance can message ──
  if (order.chat_frozen) {
    if (actorType === 'compliance' || actorType === 'system') {
      return { enabled: true, reason: null };
    }
    return {
      enabled: false,
      reason: 'Chat has been frozen by a compliance officer',
    };
  }

  // ── 3. Order in active status — chat is open ──
  if (CHAT_OPEN_STATUSES.has(order.status)) {
    // Special case: disputed orders allow compliance even if they weren't
    // originally part of the order
    return { enabled: true, reason: null };
  }

  // ── 4. Order closed (completed/cancelled/expired) ──
  if (CHAT_CLOSED_STATUSES.has(order.status)) {
    // Compliance can still message on orders that were disputed
    // (dispute may have been resolved → status is now completed/cancelled)
    if (actorType === 'compliance' || actorType === 'system') {
      return { enabled: true, reason: null };
    }
    return {
      enabled: false,
      reason: `Chat closed — this order has been ${order.status}`,
    };
  }

  // ── 5. Unknown status — fail closed ──
  return {
    enabled: false,
    reason: 'Chat is not available for this order',
  };
}

/**
 * Check if both parties are connected to an order.
 * Used to determine if the chat should be shown in the UI at all.
 */
export function hasBothParties(order: OrderForChat): boolean {
  // For U2M orders: user_id + merchant_id must both be set
  // For M2M orders: merchant_id + buyer_merchant_id must both be set
  const hasUser = !!order.user_id;
  const hasMerchant = !!order.merchant_id;
  const hasBuyerMerchant = !!order.buyer_merchant_id;

  // M2M: both merchant roles filled
  if (hasBuyerMerchant && hasMerchant) return true;
  // U2M: user + merchant both present
  if (hasUser && hasMerchant) return true;

  return false;
}
