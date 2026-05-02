/**
 * Settle Idempotency — header-pass-through layer.
 *
 * Background:
 *   The previous implementation cached responses in `idempotency_log` from
 *   the settle (Next.js) layer using a store-AFTER-execute pattern. That
 *   left a small but exploitable window where:
 *
 *     1. settle proxies the mutation to core-api
 *     2. core-api commits the mutation
 *     3. settle's INSERT into idempotency_log fails (DB blip / cancel)
 *        and the error is logged "non-fatal"
 *     4. a retry with the same key sees no row and re-executes the mutation
 *
 *   That is a real-money correctness bug. It is fixed here.
 *
 * New design:
 *   Settle no longer owns an idempotency cache. Core-api already wraps every
 *   financial mutation in `withTxIdempotency` (apps/core-api/src/idempotency.ts)
 *   which inserts the idempotency record INSIDE the same DB transaction as
 *   the mutation — atomic commit/rollback, no post-write gap. Settle's job
 *   is reduced to:
 *
 *     1. REQUIRE an Idempotency-Key header on every state-changing route
 *        (`requireIdempotencyKey` — fail-closed 400 on missing).
 *     2. Forward the key downstream so core-api keys its idempotency_log
 *        off the same string.
 *
 *   `withIdempotency` is retained as a thin compatibility wrapper around
 *   `execute()` — it no longer reads or writes idempotency_log itself. The
 *   `cached` flag in the result is always `false` from settle's perspective;
 *   true deduplication happens in core-api and is invisible to the settle
 *   caller (it just sees a normal 2xx response).
 *
 * Migration note:
 *   Keep importing `getIdempotencyKey` / `withIdempotency` from this module
 *   so existing routes don't churn. The behavioural change is intentional
 *   and is the fix for blocker B1.
 */

import { NextResponse } from 'next/server';

export interface IdempotencyResult<T = unknown> {
  /** Always false now — see header comment. Retained for API compatibility. */
  cached: boolean;
  data: T;
  statusCode: number;
}

/**
 * Extract idempotency key from request headers.
 * Supports both 'Idempotency-Key' and 'X-Idempotency-Key' headers.
 */
export function getIdempotencyKey(request: Request): string | null {
  return (
    request.headers.get('idempotency-key') ||
    request.headers.get('x-idempotency-key') ||
    null
  );
}

/**
 * Reject the request (400) when the Idempotency-Key header is missing.
 *
 * Use as the first thing a state-changing financial route does:
 *
 *     const missing = requireIdempotencyKey(request);
 *     if (missing) return missing;
 *
 * Returns the NextResponse (already 400'd) when the header is missing —
 * caller MUST `return` it. Returns null when the header is present.
 */
export function requireIdempotencyKey(request: Request): NextResponse | null {
  const key = getIdempotencyKey(request);
  if (!key || key.trim().length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Idempotency-Key header is required for this endpoint. ' +
          'Send a unique value (UUIDv4 recommended) per logical request.',
      },
      { status: 400 },
    );
  }
  return null;
}

/**
 * Pass-through wrapper retained for API compatibility.
 *
 * Settle layer no longer caches results. Idempotency is enforced
 * end-to-end by core-api's `withTxIdempotency` — the mutation and its
 * idempotency_log row commit atomically inside the same DB transaction,
 * eliminating the legacy post-execute write gap.
 *
 * Behaviour:
 *   - `key` is informational only at this layer (still useful for logging).
 *     The route MUST have already enforced presence with
 *     `requireIdempotencyKey()` and the proxy MUST forward the same value
 *     in `idempotencyKey` so core-api keys its log off the same string.
 *   - `execute()` is invoked exactly once. Any retry on a duplicate key
 *     re-enters this function, re-proxies to core-api, and core-api
 *     returns the cached response from its own idempotency_log — same
 *     status code, same body, no double-execution.
 *
 * The `cached` flag in the returned `IdempotencyResult` is always `false`
 * here — settle cannot tell whether core-api short-circuited or genuinely
 * executed. Callers should treat both responses identically (which they
 * already do, since both shapes are the canonical mutation response).
 */
export async function withIdempotency<T>(
  _key: string | null | undefined,
  _action: string,
  _orderId: string | null,
  execute: () => Promise<{ data: T; statusCode: number }>,
): Promise<IdempotencyResult<T>> {
  const result = await execute();
  return { cached: false, data: result.data, statusCode: result.statusCode };
}
