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
export declare const SCHEMA_VERSION = 1;
export declare const orderCreatedBroadcastSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_CREATED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_CREATED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_CREATED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>;
export declare const orderEscrowedBroadcastSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_ESCROWED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_ESCROWED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_ESCROWED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>;
export declare const orderPaymentSentBroadcastSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_PAYMENT_SENT">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_PAYMENT_SENT";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_PAYMENT_SENT";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>;
export declare const orderCompletedBroadcastSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_COMPLETED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_COMPLETED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_COMPLETED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>;
export declare const orderDisputedBroadcastSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_DISPUTED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_DISPUTED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_DISPUTED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>;
/** Discriminated union of all 5 validated WS broadcast events */
export declare const broadcastPayloadSchema: z.ZodDiscriminatedUnion<"event_type", [z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_CREATED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_CREATED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_CREATED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>, z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_ESCROWED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_ESCROWED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_ESCROWED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>, z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_PAYMENT_SENT">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_PAYMENT_SENT";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_PAYMENT_SENT";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>, z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_COMPLETED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_COMPLETED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_COMPLETED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>, z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    order_id: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodNumber;
    userId: z.ZodOptional<z.ZodString>;
    merchantId: z.ZodOptional<z.ZodString>;
    buyerMerchantId: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodString>;
} & {
    event_type: z.ZodLiteral<"ORDER_DISPUTED">;
}, "strip", z.ZodTypeAny, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_DISPUTED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}, {
    status: string;
    schema_version: 1;
    order_id: string;
    minimal_status: string;
    order_version: number;
    event_type: "ORDER_DISPUTED";
    userId?: string | undefined;
    merchantId?: string | undefined;
    buyerMerchantId?: string | undefined;
    previousStatus?: string | undefined;
}>]>;
export type BroadcastPayloadV1 = z.infer<typeof broadcastPayloadSchema>;
export declare const pusherOrderCreatedSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    orderId: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodOptional<z.ZodString>;
    order_version: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodString;
    creatorMerchantId: z.ZodOptional<z.ZodString>;
    data: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    status: string;
    schema_version: 1;
    createdAt: string;
    minimal_status?: string | undefined;
    order_version?: number | undefined;
    creatorMerchantId?: string | undefined;
    data?: unknown;
}, {
    orderId: string;
    status: string;
    schema_version: 1;
    createdAt: string;
    minimal_status?: string | undefined;
    order_version?: number | undefined;
    creatorMerchantId?: string | undefined;
    data?: unknown;
}>;
export declare const pusherStatusUpdatedSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    orderId: z.ZodString;
    status: z.ZodString;
    minimal_status: z.ZodOptional<z.ZodString>;
    order_version: z.ZodOptional<z.ZodNumber>;
    previousStatus: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodString;
    data: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    status: string;
    schema_version: 1;
    updatedAt: string;
    minimal_status?: string | undefined;
    order_version?: number | undefined;
    previousStatus?: string | undefined;
    data?: unknown;
}, {
    orderId: string;
    status: string;
    schema_version: 1;
    updatedAt: string;
    minimal_status?: string | undefined;
    order_version?: number | undefined;
    previousStatus?: string | undefined;
    data?: unknown;
}>;
export declare const pusherOrderCancelledSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    orderId: z.ZodString;
    minimal_status: z.ZodString;
    order_version: z.ZodOptional<z.ZodNumber>;
    cancelledAt: z.ZodString;
    data: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    schema_version: 1;
    minimal_status: string;
    cancelledAt: string;
    order_version?: number | undefined;
    data?: unknown;
}, {
    orderId: string;
    schema_version: 1;
    minimal_status: string;
    cancelledAt: string;
    order_version?: number | undefined;
    data?: unknown;
}>;
export type PusherOrderCreatedPayload = z.infer<typeof pusherOrderCreatedSchema>;
export type PusherStatusUpdatedPayload = z.infer<typeof pusherStatusUpdatedSchema>;
export type PusherOrderCancelledPayload = z.infer<typeof pusherOrderCancelledSchema>;
export declare const VALIDATED_WS_EVENTS: Set<"ORDER_CREATED" | "ORDER_ESCROWED" | "ORDER_PAYMENT_SENT" | "ORDER_COMPLETED" | "ORDER_DISPUTED">;
//# sourceMappingURL=schemas.d.ts.map