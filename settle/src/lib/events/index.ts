/**
 * Events module — public API
 */

export { emitOrderEvent, buildEvent } from './OrderEventEmitter';
export { getSystemChatMessage } from './chatTemplates';
export { CircuitBreaker, CircuitOpenError } from './circuitBreaker';
export type { CircuitState } from './circuitBreaker';
export type {
  OrderLifecycleEvent,
  OrderEventType,
  OrderCreatedPayload,
  OrderAcceptedPayload,
  EscrowedPayload,
  PaymentSentPayload,
  CompletedPayload,
  CancelledPayload,
  ExpiredPayload,
  DisputedPayload,
} from './types';
export { buildIdempotencyKey, statusToEventType } from './types';
