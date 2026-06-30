/**
 * Realtime event deduplication (client-side, authoritative).
 *
 * A single order transition is delivered to the client MULTIPLE times by design:
 *  - the instant path (fireInstantNotification) fires immediately, AND
 *  - the notification-outbox worker re-fires the same event ~5-10s later as a
 *    reliability backup, AND
 *  - core-api emits the same transition independently (broadcastListener), AND
 *  - Pusher fans one payload out to several channels a client may share at once
 *    (per-user + per-order + per-merchant).
 *
 * Every one of those copies carries the SAME stable identity:
 *     (orderId, status, order_version)
 * `order_version` is monotonic per order and unique per transition, so this
 * triple names exactly one logical event regardless of which producer,
 * transport, or channel delivered it. (Verified: both settle's instant/outbox
 * payloads and core-api's broadcastListener stamp the same order_version.)
 *
 * This module collapses repeat deliveries of the same identity to the SAME
 * consumer, so one user action surfaces exactly one notification. It is scoped
 * per consumer (the `scope` arg) because independent subscriptions — e.g. the
 * orders-list hook vs. a single-order detail hook — are separate consumers that
 * should each legitimately process the event once.
 *
 * Fallback-safe / zero-regression: when an event has no stable identity (no
 * order_version — some legacy/expiry pushes), the identity is null and this
 * returns `false`, leaving each caller's existing dedup (short time-window /
 * previousStatus guards) fully in charge. Nothing here changes backend
 * emission or any money/state path — it is purely the consumer edge.
 */

// TTL must cover the full delivery tail of one transition: instant (0s) →
// outbox poll (~5s) → outbox retry backoff (up to ~30s). 120s is comfortably
// beyond that while staying short relative to how long an order lives, and keys
// include order_version so a genuinely-new transition is never suppressed.
const TTL_MS = 120_000;
const MAX_ENTRIES = 2000;

// `${scope}::${identity}` -> last-seen epoch ms
const seen = new Map<string, number>();

/**
 * Build the stable identity for an order event, or null when it cannot be
 * identified deterministically (missing version). `status` is the raw order
 * status; `orderVersion` is the monotonic per-order counter.
 */
export function orderEventIdentity(
  orderId: string | undefined,
  status: string | undefined,
  orderVersion: number | null | undefined,
): string | null {
  if (!orderId || orderVersion == null) return null;
  return `${orderId}:${status ?? ''}:${orderVersion}`;
}

/**
 * Returns true if this (scope, identity) was already seen within the TTL — i.e.
 * a duplicate delivery the caller should drop. Recording refreshes the
 * timestamp so a long retry tail keeps collapsing. A null/undefined identity is
 * never a duplicate (caller keeps its own fallback dedup).
 */
export function isDuplicateRealtimeEvent(scope: string, identity: string | null | undefined): boolean {
  if (!identity) return false;
  const key = `${scope}::${identity}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < TTL_MS) {
    seen.set(key, now);
    return true;
  }
  seen.set(key, now);
  if (seen.size > MAX_ENTRIES) prune(now);
  return false;
}

function prune(now: number): void {
  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
  }
  // Hard cap — if still oversized, drop oldest-inserted entries.
  if (seen.size > MAX_ENTRIES) {
    const iter = seen.keys();
    while (seen.size > MAX_ENTRIES) {
      const oldest = iter.next().value;
      if (!oldest) break;
      seen.delete(oldest);
    }
  }
}

// ── Chat-message toast dedup (isolated store) ──────────────────────────────
// Chat toasts are deduped by messageId across the two chat transports (the
// dashboard WS path and the Pusher private-channel path). Kept in a SEPARATE
// bounded store from the order-event map above so a burst of order events can
// never evict a chat key (via the hard-cap prune) before its duplicate copy
// arrives. Same TTL window.
const CHAT_MAX_ENTRIES = 500;
const seenChat = new Map<string, number>();

/**
 * Returns true if this chat messageId was already toasted within the TTL — i.e.
 * a duplicate delivery the caller should drop. A null/undefined id is never a
 * duplicate (caller keeps whatever fallback it has).
 */
export function isDuplicateChatToast(messageId: string | null | undefined): boolean {
  if (!messageId) return false;
  const now = Date.now();
  const last = seenChat.get(messageId);
  if (last !== undefined && now - last < TTL_MS) {
    seenChat.set(messageId, now);
    return true;
  }
  seenChat.set(messageId, now);
  if (seenChat.size > CHAT_MAX_ENTRIES) pruneChat(now);
  return false;
}

function pruneChat(now: number): void {
  for (const [k, t] of seenChat) {
    if (now - t > TTL_MS) seenChat.delete(k);
  }
  if (seenChat.size > CHAT_MAX_ENTRIES) {
    const iter = seenChat.keys();
    while (seenChat.size > CHAT_MAX_ENTRIES) {
      const oldest = iter.next().value;
      if (!oldest) break;
      seenChat.delete(oldest);
    }
  }
}

/** Test/debug helper — clears all recorded identities. */
export function __resetRealtimeDedup(): void {
  seen.clear();
  seenChat.clear();
}
