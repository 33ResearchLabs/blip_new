/**
 * Order Event Bus
 *
 * Typed, in-process event emitter that decouples order state transitions
 * from their side-effects (receipts, notifications, WebSocket broadcasts,
 * Pusher, reputation).
 *
 * Design notes:
 *   - Listeners are fire-and-forget: they catch their own errors so one
 *     failing listener never blocks the HTTP response or other listeners.
 *   - The payload is a single, self-contained object — no back-references
 *     to Fastify request/reply — so migrating to Kafka/Redis Streams later
 *     only requires swapping the emit() implementation with a produce() call.
 *   - Listeners register once at startup (not per-request).
 */
import { EventEmitter } from 'node:events';
import { logger } from 'settlement-core';

// ── Event names ─────────────────────────────────────────────────
export const ORDER_EVENT = {
  CREATED:      'order.created',
  ACCEPTED:     'order.accepted',
  ESCROWED:     'order.escrowed',
  PAYMENT_SENT: 'order.payment_sent',
  COMPLETED:    'order.completed',
  CANCELLED:    'order.cancelled',
  EXPIRED:      'order.expired',
  DISPUTED:     'order.disputed',
  /** Generic status change — emitted for ALL transitions including the above. */
  STATUS_CHANGED: 'order.status_changed',
} as const;

export type OrderEventName = (typeof ORDER_EVENT)[keyof typeof ORDER_EVENT];

// ── Payload ─────────────────────────────────────────────────────
export interface OrderEventPayload {
  /** The event that occurred (matches the key used to emit). */
  event: OrderEventName;

  // ── Identifiers ──
  orderId: string;
  orderNumber?: string;

  // ── Transition ──
  previousStatus: string;
  newStatus: string;

  // ── Actors ──
  actorType: string;
  actorId: string;
  userId: string;
  // NULL for unclaimed M2M BUY broadcasts (seller slot not yet filled).
  // Downstream listeners (pusher, ws/broadcast, notifications) must guard null.
  merchantId: string | null;
  buyerMerchantId?: string;

  // ── Order snapshot (the full row after the transition) ──
  order: Record<string, unknown>;
  orderVersion: number;
  minimalStatus: string;

  // ── Optional extras (vary by transition) ──
  metadata?: Record<string, unknown>;
  txHash?: string;
  refundTxHash?: string;
}

// ── Singleton bus ───────────────────────────────────────────────
class OrderEventBus extends EventEmitter {
  /**
   * Emit an order event. Listeners are invoked synchronously but each
   * wraps its body in a try/catch, so this never throws.
   */
  emitOrderEvent(payload: OrderEventPayload): void {
    // Emit the specific event (e.g. 'order.accepted')
    this.emit(payload.event, payload);
    // Always emit the generic event for cross-cutting listeners
    if (payload.event !== ORDER_EVENT.STATUS_CHANGED) {
      this.emit(ORDER_EVENT.STATUS_CHANGED, payload);
    }
  }

  /**
   * Register a listener that will never crash the emitter.
   * Errors are logged and swallowed.
   */
  safeOn(event: OrderEventName, listener: (payload: OrderEventPayload) => void | Promise<void>): this {
    this.on(event, (payload: OrderEventPayload) => {
      try {
        const result = listener(payload);
        // If the listener returns a promise, catch async errors too
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            logger.error(`[OrderEventBus] Async listener error on ${event}`, { error: err, orderId: payload.orderId });
          });
        }
      } catch (err) {
        logger.error(`[OrderEventBus] Sync listener error on ${event}`, { error: err, orderId: payload.orderId });
      }
    });
    return this;
  }
}

// Increase max listeners — we have multiple listeners per event
const orderBus = new OrderEventBus();
orderBus.setMaxListeners(30);

export { orderBus };
