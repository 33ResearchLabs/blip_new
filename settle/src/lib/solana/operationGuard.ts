/**
 * Operation Guard — prevents accidental double-execution of user-initiated
 * transactions (e.g., rapid double-clicks on "Lock Escrow").
 *
 * SCOPE: only guards against near-simultaneous clicks at the CALLSITE.
 *        This is NOT a persistent idempotency layer — the safe retry flow
 *        inside sendAndConfirmSafe is NOT blocked by this guard.
 *
 * Usage:
 *   const key = `lock-escrow:${orderId}`;
 *   if (!acquireOp(key)) return; // second click within 10s → ignored
 *   try {
 *     await solanaWallet.lockEscrow(...);
 *   } finally {
 *     releaseOp(key);  // always release, even on error
 *   }
 *
 * Design choices:
 *  - In-memory only (Map) — no persistence, no complex state
 *  - Short TTL (10s) — won't block legitimate retries after a failure
 *  - Auto-release via TTL so forgotten releaseOp() calls don't lock keys forever
 *  - Caller must explicitly opt in by wrapping their action
 */

const TTL_MS = 10_000;
const activeOps = new Map<string, { acquiredAt: number; expiresAt: number }>();

/**
 * Try to acquire a lock on `key`. Returns true if acquired, false if another
 * acquire is still active for the same key. Caller MUST call releaseOp(key)
 * when done (even on error).
 */
export function acquireOp(key: string): boolean {
  const now = Date.now();
  const existing = activeOps.get(key);
  if (existing && existing.expiresAt > now) {
    return false; // still active — reject duplicate call
  }
  activeOps.set(key, { acquiredAt: now, expiresAt: now + TTL_MS });
  return true;
}

/** Release a previously acquired lock. Safe to call even if never acquired. */
export function releaseOp(key: string): void {
  activeOps.delete(key);
}

/** Check if a key is currently locked (without acquiring). */
export function isOpActive(key: string): boolean {
  const existing = activeOps.get(key);
  return !!existing && existing.expiresAt > Date.now();
}

/** Wrap an async function with op-guard protection. Rejects if already active. */
export async function withOpGuard<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!acquireOp(key)) {
    throw new Error(
      `Operation "${key}" is already in progress. Please wait for it to complete.`,
    );
  }
  try {
    return await fn();
  } finally {
    releaseOp(key);
  }
}
