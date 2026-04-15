/**
 * Chat toast event bus — tiny pub/sub for surfacing inbound chat messages
 * as in-app popups on any user-side screen.
 *
 * Design:
 *  - Zero-regression: subscribers are optional, publishers fire-and-forget.
 *    If no toast host is mounted, calls are no-ops.
 *  - Decoupled: `useUserEffects` publishes, `<ChatToastHost>` subscribes.
 *    Neither knows about the other.
 *  - Tiny: no external dependencies, no state machine, no React coupling.
 */

export interface ChatToastPayload {
  /** The order this message belongs to — used for dedup + routing on tap. */
  orderId: string;
  /** Counterparty display name (merchant side — "Seller", the merchant's name). */
  senderName: string;
  /** 1-line preview (already truncated by the publisher). */
  preview: string;
  /** Optional avatar URL. Host falls back to initial when missing. */
  avatarUrl?: string | null;
  /** Arrival time (ms). Used for sort + staleness checks. */
  timestamp: number;
}

type Listener = (payload: ChatToastPayload) => void;

const listeners = new Set<Listener>();

export function subscribeChatToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitChatToast(payload: ChatToastPayload): void {
  // Snapshot so a listener unsubscribing mid-dispatch can't mutate the set.
  for (const listener of Array.from(listeners)) {
    try {
      listener(payload);
    } catch {
      /* swallow — one bad listener must not break the others */
    }
  }
}
