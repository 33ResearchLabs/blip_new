/**
 * Real-Time Event Schemas (LOCK #5)
 *
 * Zod schemas for the 5 critical order lifecycle events.
 * Used by:
 *   - core-api WS broadcaster (validate before emit)
 *   - settle Pusher helpers (validate before emit)
 *   - settle client hooks (validate on receive)
 *
 * Bump SCHEMA_VERSION when payload shape changes.
 */
import { z } from 'zod';
// ─── Version ─────────────────────────────────────────────────────
export const SCHEMA_VERSION = 1;
// ─── WS Broadcast Schemas (core-api → client) ───────────────────
//
// These match the wire format of broadcastOrderEvent() in broadcast.ts.
// The WS message wraps this in { type: 'order_event', ...payload }.
const broadcastBase = z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    order_id: z.string().min(1),
    status: z.string().min(1),
    minimal_status: z.string().min(1),
    order_version: z.number().int().min(0),
    userId: z.string().optional(),
    merchantId: z.string().optional(),
    buyerMerchantId: z.string().optional(),
    previousStatus: z.string().optional(),
});
export const orderCreatedBroadcastSchema = broadcastBase.extend({
    event_type: z.literal('ORDER_CREATED'),
});
export const orderEscrowedBroadcastSchema = broadcastBase.extend({
    event_type: z.literal('ORDER_ESCROWED'),
});
export const orderPaymentSentBroadcastSchema = broadcastBase.extend({
    event_type: z.literal('ORDER_PAYMENT_SENT'),
});
export const orderCompletedBroadcastSchema = broadcastBase.extend({
    event_type: z.literal('ORDER_COMPLETED'),
});
export const orderDisputedBroadcastSchema = broadcastBase.extend({
    event_type: z.literal('ORDER_DISPUTED'),
});
/** Discriminated union of all 5 validated WS broadcast events */
export const broadcastPayloadSchema = z.discriminatedUnion('event_type', [
    orderCreatedBroadcastSchema,
    orderEscrowedBroadcastSchema,
    orderPaymentSentBroadcastSchema,
    orderCompletedBroadcastSchema,
    orderDisputedBroadcastSchema,
]);
// ─── Pusher Schemas (settle server → client) ────────────────────
//
// These match the payload objects built by notifyOrder* helpers
// in settle/src/lib/pusher/server.ts.
export const pusherOrderCreatedSchema = z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    orderId: z.string().min(1),
    status: z.string().min(1),
    minimal_status: z.string().optional(),
    order_version: z.number().int().min(0).optional(),
    createdAt: z.string().min(1),
    creatorMerchantId: z.string().optional(),
    data: z.unknown().optional(),
});
export const pusherStatusUpdatedSchema = z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    orderId: z.string().min(1),
    status: z.string().min(1),
    minimal_status: z.string().optional(),
    order_version: z.number().int().min(0).optional(),
    previousStatus: z.string().optional(),
    updatedAt: z.string().min(1),
    data: z.unknown().optional(),
});
export const pusherOrderCancelledSchema = z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    orderId: z.string().min(1),
    minimal_status: z.string().min(1),
    order_version: z.number().int().min(0).optional(),
    cancelledAt: z.string().min(1),
    data: z.unknown().optional(),
});
// ─── Set of validated WS event types ─────────────────────────────
export const VALIDATED_WS_EVENTS = new Set([
    'ORDER_CREATED',
    'ORDER_ESCROWED',
    'ORDER_PAYMENT_SENT',
    'ORDER_COMPLETED',
    'ORDER_DISPUTED',
]);
//# sourceMappingURL=schemas.js.map