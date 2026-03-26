/**
 * Idempotency Protection Layer
 *
 * Prevents duplicate execution of critical financial actions caused by:
 * - Client retries (network timeouts, double-clicks)
 * - Worker retries
 * - Webhook re-deliveries
 *
 * Uses idempotency_log table (migration 047) to store results of
 * completed actions. On retry, returns the cached result instead of
 * re-executing the action.
 *
 * Protected actions:
 * - create_order
 * - payment_sent
 * - release_escrow
 * - cancel_order
 */

import { query, queryOne, transaction } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface IdempotencyResult<T = unknown> {
  /** Whether this is a cached (replayed) result */
  cached: boolean;
  /** The result data */
  data: T;
  /** HTTP status code */
  statusCode: number;
}

interface IdempotencyLogRow {
  id: string;
  idempotency_key: string;
  action: string;
  order_id: string | null;
  status_code: number;
  response: unknown;
  created_at: Date;
  expires_at: Date;
}

/**
 * Execute an action with idempotency protection.
 *
 * If the idempotency_key has been seen before:
 *   → return the previously stored result (no re-execution)
 *
 * If the key is new:
 *   → execute the action
 *   → store the result
 *   → return the result
 *
 * @param key - Unique idempotency key (e.g. from Idempotency-Key header)
 * @param action - Action name for logging (e.g. 'create_order')
 * @param orderId - Optional order ID for association
 * @param execute - The actual action to execute
 */
export async function withIdempotency<T>(
  key: string | null | undefined,
  action: string,
  orderId: string | null,
  execute: () => Promise<{ data: T; statusCode: number }>
): Promise<IdempotencyResult<T>> {
  // If no key provided, skip idempotency — just execute
  if (!key) {
    const result = await execute();
    return { cached: false, data: result.data, statusCode: result.statusCode };
  }

  // Check for existing result
  const existing = await queryOne<IdempotencyLogRow>(
    `SELECT * FROM idempotency_log
     WHERE idempotency_key = $1
       AND expires_at > NOW()`,
    [key]
  );

  if (existing) {
    logger.info('[Idempotency] Returning cached result', {
      key,
      action: existing.action,
      orderId: existing.order_id,
      statusCode: existing.status_code,
    });
    return {
      cached: true,
      data: existing.response as T,
      statusCode: existing.status_code,
    };
  }

  // Execute the action
  const result = await execute();

  // Store the result (best-effort — don't fail the action if storage fails)
  try {
    await query(
      `INSERT INTO idempotency_log (idempotency_key, action, order_id, status_code, response)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key, action, orderId, result.statusCode, JSON.stringify(result.data)]
    );
  } catch (err) {
    logger.warn('[Idempotency] Failed to store result (non-fatal)', {
      key,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { cached: false, data: result.data, statusCode: result.statusCode };
}

/**
 * Clean up expired idempotency records.
 * Call periodically (e.g. hourly) to prevent table bloat.
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<number> {
  const result = await query<{ id: string }>(
    `DELETE FROM idempotency_log
     WHERE expires_at < NOW()
     RETURNING id`
  );
  return result.length;
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
