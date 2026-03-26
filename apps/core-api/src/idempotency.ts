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
 */

import { createHash } from 'node:crypto';
import { query as dbQuery, queryOne, logger } from 'settlement-core';
import type { FastifyRequest, FastifyReply } from 'fastify';

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
 * Execute a route handler with idempotency protection.
 *
 * Keys are scoped by (actor_id + action + original_key) — different users
 * or different endpoints can safely use the same original key without collision.
 *
 * If the scoped key has been seen before:
 *   → returns the cached response immediately (no re-execution)
 *
 * If the key is new:
 *   → executes the action, caches the result, returns it
 *
 * @param request  - Fastify request
 * @param reply    - Fastify reply
 * @param action   - Action name for scoping + logging (e.g. 'payment_sent')
 * @param orderId  - Order ID for association
 * @param execute  - The actual handler logic; must return { statusCode, body }
 */
export async function withIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  orderId: string,
  execute: () => Promise<{ statusCode: number; body: unknown }>
): Promise<FastifyReply> {
  const originalKey = getIdempotencyKey(request);

  // No key → skip idempotency, just execute
  if (!originalKey) {
    const result = await execute();
    return reply.status(result.statusCode).send(result.body);
  }

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
