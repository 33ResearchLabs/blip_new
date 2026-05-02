/**
 * Idempotency Protection for Core API Routes
 *
 * Prevents duplicate execution of critical financial actions caused by:
 * - Client retries (network timeouts, double-clicks)
 * - Worker retries
 * - Webhook re-deliveries
 *
 * KEY SCOPING (v2):
 * Keys are scoped by (actor_id, action, original_key) to prevent collisions
 * across different users or different endpoints. The stored `idempotency_key`
 * is a SHA-256 hash of the concatenation of these three components.
 *
 * Protected actions:
 * - create_order (in orderCreate.ts)
 * - payment_sent
 * - release_escrow
 * - cancel_order
 * - open_dispute
 * - confirm_dispute
 * - cancel_request_respond
 *
 * SAFETY (v3):
 *   - For financial endpoints, the Idempotency-Key header is REQUIRED. Missing
 *     header → 400. Use `requireIdempotencyKey` to enforce.
 *   - The idempotency record is committed INSIDE the same DB transaction as
 *     the mutation (`storeIdempotencyInTx` + `withTxIdempotency`). The legacy
 *     `withIdempotency` helper has a post-execution write gap and MUST NOT be
 *     used for new financial routes — keep it only for read-mostly handlers
 *     that already provide their own internal atomicity.
 */

import { createHash } from 'node:crypto';
import { query as dbQuery, queryOne, transaction, logger } from 'settlement-core';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Structural type for a Postgres client opened by `transaction()`.
 * Avoids importing `PoolClient` from `pg` so this module does not need
 * `@types/pg` in its package.json.
 */
type TxClient = {
  query: <R = unknown>(text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
};

interface IdempotencyLogRow {
  status_code: number;
  response: unknown;
}

/**
 * Build a collision-safe scoped key from (actorId, action, originalKey).
 * The result is a deterministic SHA-256 hex digest.
 */
export function buildScopedKey(actorId: string, action: string, originalKey: string): string {
  return createHash('sha256')
    .update(`${actorId}:${action}:${originalKey}`)
    .digest('hex');
}

/**
 * Extract idempotency key from request headers.
 * Supports both 'Idempotency-Key' and 'X-Idempotency-Key'.
 */
export function getIdempotencyKey(request: FastifyRequest): string | null {
  return (
    (request.headers['idempotency-key'] as string) ||
    (request.headers['x-idempotency-key'] as string) ||
    null
  );
}

/**
 * Extract actor_id from the request — checks body, query, and headers.
 * Returns 'anonymous' as fallback (still scoped per-action).
 */
function extractActorId(request: FastifyRequest): string {
  const body = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;
  return (
    (body?.actor_id as string) ||
    (query?.actor_id as string) ||
    (request.headers['x-actor-id'] as string) ||
    'anonymous'
  );
}

/**
 * Check idempotency_log for a previously completed action.
 * Now scoped: uses the hashed (actor_id + action + key) composite.
 */
async function checkIdempotencyLog(scopedKey: string): Promise<IdempotencyLogRow | null> {
  const row = await queryOne<IdempotencyLogRow>(
    `SELECT status_code, response FROM idempotency_log
     WHERE idempotency_key = $1 AND expires_at > NOW()`,
    [scopedKey]
  );
  return row || null;
}

/**
 * Store idempotency result (best-effort — don't fail the action if storage fails).
 * Stores both the scoped key (for lookup) and the original components (for debugging).
 */
async function storeIdempotencyResult(
  scopedKey: string,
  action: string,
  orderId: string | null,
  statusCode: number,
  response: unknown,
  actorId: string,
  originalKey: string
): Promise<void> {
  try {
    await dbQuery(
      `INSERT INTO idempotency_log
       (idempotency_key, action, order_id, status_code, response, actor_id, original_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [scopedKey, action, orderId, statusCode, JSON.stringify(response), actorId, originalKey]
    );
  } catch (err) {
    logger.warn('[Idempotency] Failed to store result (non-fatal)', {
      scopedKey,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reject the request (400) when the Idempotency-Key header is missing.
 *
 * Use as the very first line of every state-changing financial handler:
 *
 *     const missing = requireIdempotencyKey(request, reply);
 *     if (missing) return missing;
 *
 * Returns the FastifyReply (already 400'd) when missing — caller must
 * `return` it. Returns null when the header is present.
 */
export function requireIdempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply | null {
  const key = getIdempotencyKey(request);
  if (!key || key.trim().length === 0) {
    return reply.status(400).send({
      success: false,
      error:
        'Idempotency-Key header is required for this endpoint. ' +
        'Send a unique value (UUIDv4 recommended) per logical request.',
    });
  }
  return null;
}

/**
 * Store the idempotency record INSIDE a transaction client.
 *
 * Use this from inside a `transaction(async (client) => { ... })` block
 * so the record commits atomically with the mutation. If the transaction
 * rolls back (any error / invariant failure), no orphan idempotency row
 * is left behind.
 *
 * `ON CONFLICT DO NOTHING` makes the insert race-safe against two
 * concurrent transactions both starting with the same scoped key — the
 * loser's INSERT no-ops; we then re-read the winner's record so the
 * loser returns the same response the winner is about to send.
 */
export async function storeIdempotencyInTx(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  scopedKey: string,
  action: string,
  orderId: string | null,
  statusCode: number,
  response: unknown,
  actorId: string,
  originalKey: string,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_log
     (idempotency_key, action, order_id, status_code, response, actor_id, original_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [scopedKey, action, orderId, statusCode, JSON.stringify(response), actorId, originalKey],
  );
}

/**
 * Look up an existing idempotency record from inside an open transaction
 * client so the read participates in the transaction's snapshot.
 */
async function checkIdempotencyLogInTx(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: IdempotencyLogRow[] }> },
  scopedKey: string,
): Promise<IdempotencyLogRow | null> {
  const { rows } = await client.query(
    `SELECT status_code, response FROM idempotency_log
     WHERE idempotency_key = $1 AND expires_at > NOW()`,
    [scopedKey],
  );
  return rows[0] ?? null;
}

/**
 * Atomic idempotency wrapper — replacement for `withIdempotency` that closes
 * the post-execution write gap.
 *
 * Caller passes an `executeInTx(client, scopedKey)` function that performs
 * the entire mutation against the open transaction client. The wrapper:
 *
 *   1. Asserts the Idempotency-Key header is present (400 if missing).
 *   2. Opens a single DB transaction.
 *   3. Looks up the scoped key inside the transaction. Hit → returns
 *      the cached response and aborts the txn (no writes).
 *   4. Otherwise runs `executeInTx` and stores the idempotency record
 *      using the SAME client. Commit/rollback are atomic.
 *
 * The handler MUST do all DB work via the supplied `client` — using
 * `dbQuery`/`queryOne` from inside the callback would escape the
 * transaction's locks and re-introduce the race.
 */
export async function withTxIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  orderId: string,
  executeInTx: (
    client: TxClient,
    scopedKey: string,
  ) => Promise<{ statusCode: number; body: unknown }>,
): Promise<FastifyReply> {
  const missing = requireIdempotencyKey(request, reply);
  if (missing) return missing;

  const originalKey = getIdempotencyKey(request) as string;
  const actorId = extractActorId(request);
  const scopedKey = buildScopedKey(actorId, action, originalKey);

  let cachedHit: IdempotencyLogRow | null = null;

  const result = await transaction(async (client) => {
    // Look up first inside the txn snapshot. A previous successful run
    // for this scoped key short-circuits here without doing any writes.
    const existing = await checkIdempotencyLogInTx(client, scopedKey);
    if (existing) {
      cachedHit = existing;
      return existing as unknown as { statusCode: number; body: unknown };
    }

    const out = await executeInTx(client, scopedKey);

    // Persist idempotency atomically with the mutation. ON CONFLICT
    // DO NOTHING covers the rare race where two parallel transactions
    // both passed the existence check; the unique key serializes them
    // and the late writer's INSERT no-ops — but their mutation has
    // ALSO been blocked by the row-level locks the handler took on
    // the financial rows, so no double-spend is possible.
    await storeIdempotencyInTx(
      client,
      scopedKey,
      action,
      orderId,
      out.statusCode,
      out.body,
      actorId,
      originalKey,
    );

    return out;
  });

  if (cachedHit) {
    logger.info('[Idempotency] Returning cached result (txn lookup)', {
      scopedKey: scopedKey.slice(0, 16) + '…',
      action,
      orderId,
      actorId,
    });
    return reply.status((cachedHit as IdempotencyLogRow).status_code).send((cachedHit as IdempotencyLogRow).response);
  }

  return reply.status(result.statusCode).send(result.body);
}

/**
 * Legacy idempotency wrapper. Stores the response AFTER `execute()` returns,
 * so it has a small window where two concurrent identical requests can both
 * miss the cache and execute the underlying handler. Acceptable only when the
 * handler itself is internally atomic (e.g. it owns its own transaction with
 * row-level locks). For new financial routes, use `withTxIdempotency`.
 *
 * v3 — header is now MANDATORY (400 on missing) so retries cannot silently
 * bypass protection.
 */
export async function withIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  orderId: string,
  execute: () => Promise<{ statusCode: number; body: unknown }>
): Promise<FastifyReply> {
  const missing = requireIdempotencyKey(request, reply);
  if (missing) return missing;

  const originalKey = getIdempotencyKey(request) as string;
  const actorId = extractActorId(request);
  const scopedKey = buildScopedKey(actorId, action, originalKey);

  // Check for existing result
  const cached = await checkIdempotencyLog(scopedKey);
  if (cached) {
    logger.info('[Idempotency] Returning cached result', {
      scopedKey: scopedKey.slice(0, 16) + '…',
      action,
      orderId,
      actorId,
    });
    return reply.status(cached.status_code).send(cached.response);
  }

  // Execute the action
  const result = await execute();

  // Store the result (best-effort)
  await storeIdempotencyResult(
    scopedKey, action, orderId, result.statusCode, result.body,
    actorId, originalKey
  );

  return reply.status(result.statusCode).send(result.body);
}
