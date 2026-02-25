/**
 * Orders Feature — Public API
 *
 * Import from '@/features/orders' for clean, feature-scoped access.
 *
 * EXISTING HOOKS NOT REPLACED:
 *  - useRealtimeOrder  (hooks/useRealtimeOrder.ts)  — Pusher + polling for single order
 *  - useRealtimeOrders (hooks/useRealtimeOrders.ts) — Batched real-time order list
 *  - useChat           (hooks/useChat.ts)           — Multi-window chat with polling
 *  - useRealtimeChat   (hooks/useRealtimeChat.ts)   — Pusher chat bindings
 *  - useWebSocketChat  (hooks/useWebSocketChat.ts)  — WS chat fallback
 *
 * Those hooks contain complex real-time/batching logic that should NOT be
 * duplicated. Use them directly from '@/hooks/'.
 */

// Services
export {
  getOrder,
  listOrders,
  createOrder,
  updateOrderStatus,
  cancelOrder,
  ApiError,
  type CreateOrderParams,
  type UpdateStatusParams,
  type CancelOrderParams,
  type ListOrdersParams,
} from './services/orders.service';

export {
  getMessages,
  sendMessage,
  markMessagesRead,
  type SendMessageParams,
  type MarkReadParams,
} from './services/messages.service';

export {
  submitReview,
  type SubmitReviewParams,
} from './services/reviews.service';

// Hooks
export { useCreateOrder } from './hooks/useCreateOrder';
export { useOrderStatus } from './hooks/useOrderStatus';
export { useCancelOrder } from './hooks/useCancelOrder';
export { useOrderMessages } from './hooks/useOrderMessages';
export { useSubmitReview } from './hooks/useSubmitReview';
