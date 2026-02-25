/**
 * Order Lifecycle Event Contracts
 *
 * Typed event payloads for all order status transitions.
 * Used by OrderEventEmitter to write consistent events to:
 * - order_events table (audit trail)
 * - chat_messages table (system messages)
 * - notification_outbox table (reliable delivery)
 */

import type { OrderStatus, ActorType } from '@/lib/types/database';

// ─── Event Type Enum ─────────────────────────────────────────────────

export type OrderEventType =
  | 'order.created'
  | 'order.accepted'
  | 'order.escrow_pending'
  | 'order.escrowed'
  | 'order.payment_pending'
  | 'order.payment_sent'
  | 'order.payment_confirmed'
  | 'order.releasing'
  | 'order.completed'
  | 'order.cancelled'
  | 'order.expired'
  | 'order.disputed'
  | 'order.dispute_resolved'
  | 'order.extension_requested'
  | 'order.extension_responded';

// ─── Base Event Envelope ─────────────────────────────────────────────

export interface OrderLifecycleEvent {
  /** Unique event ID (UUID v4) */
  eventId: string;
  /** Dotted event type, e.g., 'order.escrowed' */
  eventType: OrderEventType;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** UUID of the order */
  orderId: string;
  /** Monotonically incrementing for optimistic concurrency */
  orderVersion: number;
  /** Who triggered the event */
  actor: {
    type: ActorType;
    id: string;
  };
  /** Previous order status (null for order.created) */
  previousStatus: OrderStatus | null;
  /** New order status after this event */
  newStatus: OrderStatus;
  /** Event-specific payload */
  payload: Record<string, unknown>;
  /** Idempotency key: "{orderId}:{eventType}:{orderVersion}" */
  idempotencyKey: string;
}

// ─── Per-Event Payloads ──────────────────────────────────────────────

export interface OrderCreatedPayload {
  orderNumber: number;
  type: 'buy' | 'sell';
  paymentMethod: 'bank' | 'cash';
  cryptoAmount: number;
  cryptoCurrency: string;
  fiatAmount: number;
  fiatCurrency: string;
  rate: number;
  userId: string;
  merchantId: string;
  offerId: string;
  buyerMerchantId: string | null;
  expiresAt: string;
  preEscrowed: boolean;
  escrowTxHash: string | null;
}

export interface OrderAcceptedPayload {
  claimedByMerchantId: string | null;
  previousMerchantId: string | null;
  acceptorWalletAddress: string | null;
  isM2M: boolean;
  expiresAt: string;
}

export interface EscrowedPayload {
  txHash: string;
  escrowTradePda: string | null;
  escrowPda: string | null;
  escrowCreatorWallet: string | null;
  amount: number;
  currency: string;
  debitedEntityType: 'merchant' | 'user';
  debitedEntityId: string;
  mockMode: boolean;
}

export interface PaymentSentPayload {
  fiatAmount: number;
  fiatCurrency: string;
  sentBy: ActorType;
}

export interface PaymentConfirmedPayload {
  fiatAmount: number;
  fiatCurrency: string;
  confirmedBy: ActorType;
}

export interface CompletedPayload {
  releaseTxHash: string | null;
  cryptoAmount: number;
  cryptoCurrency: string;
  fiatAmount: number;
  fiatCurrency: string;
}

export interface CancelledPayload {
  reason: string;
  cancelledBy: ActorType;
  escrowRefunded: boolean;
  refundedAmount: number;
  refundedEntityType: 'merchant' | 'user' | null;
  refundedEntityId: string | null;
  atomicCancellation: boolean;
}

export interface ExpiredPayload {
  expiresAt: string;
  autoDisputed: boolean;
}

export interface DisputedPayload {
  reason: string;
  raisedBy: ActorType;
  raiserId: string;
}

export interface ExtensionRequestedPayload {
  requestedBy: ActorType;
  extensionMinutes: number;
  extensionCount: number;
  maxExtensions: number;
}

export interface ExtensionRespondedPayload {
  accepted: boolean;
  respondedBy: ActorType;
  newExpiresAt: string | null;
  extensionCount: number;
}

// ─── Helper to build idempotency key ─────────────────────────────────

export function buildIdempotencyKey(
  orderId: string,
  eventType: OrderEventType,
  orderVersion: number
): string {
  return `${orderId}:${eventType}:${orderVersion}`;
}

// ─── Map DB status to event type ─────────────────────────────────────

export function statusToEventType(newStatus: OrderStatus): OrderEventType {
  const map: Record<string, OrderEventType> = {
    pending: 'order.created',
    accepted: 'order.accepted',
    escrow_pending: 'order.escrow_pending',
    escrowed: 'order.escrowed',
    payment_pending: 'order.payment_pending',
    payment_sent: 'order.payment_sent',
    payment_confirmed: 'order.payment_confirmed',
    releasing: 'order.releasing',
    completed: 'order.completed',
    cancelled: 'order.cancelled',
    expired: 'order.expired',
    disputed: 'order.disputed',
  };
  return map[newStatus] || ('order.' + newStatus) as OrderEventType;
}
