/**
 * Outbox Pattern — Reliable Event Delivery
 *
 * Two insertion modes:
 *   1. insertOutboxEvent(client, payload) — inside an existing transaction (atomic)
 *   2. insertOutboxEventDirect(payload)   — standalone INSERT (best-effort)
 *
 * Use (1) whenever possible. Use (2) only for call sites where wrapping in a
 * transaction would require restructuring stored-procedure or cross-module code.
 *
 * The outbox event worker polls outbox_events and emits through orderBus,
 * so all existing listeners (receipt, notification, broadcast, audit) fire unchanged.
 */
import type { OrderEventPayload } from './events';
import { query, logger } from 'settlement-core';

/**
 * Insert an outbox event inside an existing transaction.
 * Committed atomically with the order mutation — if the transaction
 * rolls back, no orphaned event is left.
 */
export async function insertOutboxEvent(
  client: { query: (text: string, params?: unknown[]) => Promise<any> },
  payload: OrderEventPayload
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (event_type, payload)
     VALUES ($1, $2)`,
    [payload.event, JSON.stringify(payload)]
  );
}

/**
 * Insert an outbox event outside a transaction (standalone).
 *
 * Use only when wrapping in a transaction is impractical (e.g. after a stored
 * procedure that already committed). The INSERT is a single atomic SQL statement
 * so the crash window is microseconds.
 *
 * Errors are logged but never thrown — callers should not fail if outbox write fails.
 */
export async function insertOutboxEventDirect(
  payload: OrderEventPayload
): Promise<void> {
  try {
    await query(
      `INSERT INTO outbox_events (event_type, payload)
       VALUES ($1, $2)`,
      [payload.event, JSON.stringify(payload)]
    );
  } catch (err) {
    logger.error('[Outbox] Failed to insert outbox event (standalone)', {
      event: payload.event,
      orderId: payload.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
