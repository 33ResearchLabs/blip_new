/**
 * Client-side idempotency-key derivation.
 *
 * Background: every state-changing route on core-api dedupes on
 * `(actor_id, action, idempotency_key)`. When the frontend generates a
 * fresh random key per HTTP call, retries (network blip, double-click
 * past the in-flight guard, page reload mid-request, React strict-mode
 * re-invocation) present a NEW key and the dedup is silently bypassed —
 * opening a duplicate-execution window the backend was designed to close.
 *
 * The helpers below produce STABLE keys so retries of the same logical
 * request collapse into the backend's idempotency_log.
 *
 * Pick the helper that matches the natural identity of the request:
 *
 *   • If the request commits a unique on-chain side effect (Solana
 *     signature), use `txAnchoredKey(txHash, scope)`. Same tx → same key.
 *
 *   • If the request is a state-machine action on an existing order
 *     (SEND_PAYMENT, CONFIRM_PAYMENT, ACCEPT, CANCEL, DISPUTE, …), use
 *     `orderActionKey(orderId, action)`. The state machine is one-shot
 *     per (order, action) so a successful replay returns the cached
 *     response instead of erroring.
 *
 *   • If the request creates a fresh resource with no identifier yet
 *     (initial order POST), use a per-submission UUID held in a `useRef`
 *     in the calling hook — `newSubmitId()` mints one. Reset the ref to
 *     `null` when the attempt resolves successfully so the next click
 *     gets a fresh key.
 *
 * Backend behaviour is unchanged: core-api still dedupes on whatever
 * value we send. These helpers just send a value that's actually stable
 * across retries.
 */

const SCOPE_RE = /^[a-z0-9_]+$/;

function assertScope(scope: string): void {
  if (!SCOPE_RE.test(scope)) {
    throw new Error(
      `idempotencyKeys: scope must match /^[a-z0-9_]+$/ (got: ${scope})`,
    );
  }
}

/**
 * Anchor an idempotency key to a Solana transaction signature.
 *
 * Two retries that submit the same on-chain signature share the same key
 * → backend dedupe collapses them. A different signature (e.g. a
 * different escrow lock) yields a different key.
 *
 * `scope` distinguishes purposes for the same tx (e.g. an escrow tx
 * recorded on the order vs. the same hash being used to create the
 * sell-side order). Use snake_case slugs.
 */
export function txAnchoredKey(txHash: string, scope: string): string {
  if (!txHash) throw new Error("idempotencyKeys: txHash is required");
  assertScope(scope);
  return `tx:${txHash}:${scope}`;
}

/**
 * Anchor an idempotency key to an (order, action) pair.
 *
 * Retries of the SAME action on the SAME order collapse on the backend
 * to the cached response from the first successful invocation. This is
 * safe because the action endpoint's state-machine prevents legitimate
 * re-execution — without dedupe, the second attempt 4xx's; with dedupe,
 * the second attempt mirrors the original 2xx.
 *
 * The 24h TTL on idempotency_log means an action repeated more than 24h
 * later (vanishingly rare for these flows) gets a fresh attempt anyway.
 */
export function orderActionKey(orderId: string, action: string): string {
  if (!orderId) throw new Error("idempotencyKeys: orderId is required");
  if (!action) throw new Error("idempotencyKeys: action is required");
  return `order:${orderId}:action:${action}`;
}

/**
 * Mint a fresh per-submission idempotency key.
 *
 * Hold the returned value in a `useRef` for the lifetime of one submit
 * attempt. Reuse the SAME value for any client-side retries within that
 * attempt. Reset the ref to `null` when the attempt resolves successfully
 * so the next click mints a new key. (Failed attempts are NOT cached
 * server-side — the idempotency record is committed inside the same
 * transaction as the mutation, so 4xx/5xx leaves no trace and a retry
 * with the same key runs fresh.)
 */
export function newSubmitId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `submit:${crypto.randomUUID()}`;
  }
  // Fallback for environments without crypto.randomUUID (legacy Safari, jsdom).
  const rand = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `submit:${rand}`;
}
