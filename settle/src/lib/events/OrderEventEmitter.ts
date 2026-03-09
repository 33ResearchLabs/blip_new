/**
 * OrderEventEmitter — Single point of truth for all order lifecycle side effects.
 *
 * EVERY order status change MUST go through this service. It atomically writes:
 * 1. order_events row (audit trail)
 * 2. chat_messages row (system message for chat timeline)
 * 3. notification_outbox row (reliable async delivery)
 *
 * The caller provides the DB client (PoolClient) so all writes happen
 * in the caller's transaction — no split-brain possible.
 *
 * SAFETY: This module MUST NOT:
 * - Perform status validation (caller's responsibility)
 * - Update order rows (caller's responsibility)
 * - Make external calls (Pusher, WS) — outbox worker handles that
 */

import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import type { OrderLifecycleEvent } from './types';
import { buildIdempotencyKey } from './types';
import { getSystemChatMessage } from './chatTemplates';
import { logger } from '@/lib/logger';

/**
 * Emit an order lifecycle event within an existing DB transaction.
 *
 * Writes to order_events, chat_messages, and notification_outbox
 * atomically within the caller's transaction.
 *
 * @param client - The DB transaction client (must be inside BEGIN..COMMIT)
 * @param event  - The fully typed event object
 */
export async function emitOrderEvent(
  client: PoolClient,
  event: OrderLifecycleEvent
): Promise<void> {
  const eventId = event.eventId || randomUUID();
  const idempotencyKey = event.idempotencyKey ||
    buildIdempotencyKey(event.orderId, event.eventType, event.orderVersion);

  // Each section uses SAVEPOINT so a failure in one doesn't abort the PG
  // transaction and roll back the others (PG marks txn as aborted on ANY error).

  // 1. Write to order_events (audit trail)
  try {
    await client.query('SAVEPOINT sp_order_events');
    await client.query(
      `INSERT INTO order_events
       (id, order_id, event_type, actor_type, actor_id,
        old_status, new_status, metadata, created_at, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        eventId,
        event.orderId,
        event.eventType,
        event.actor.type,
        event.actor.id,
        event.previousStatus,
        event.newStatus,
        JSON.stringify(event.payload),
        event.timestamp,
        event.requestId || null,
      ]
    );
    await client.query('RELEASE SAVEPOINT sp_order_events');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_order_events').catch(() => {});
    logger.warn('[EventEmitter] Failed to write order_events', {
      orderId: event.orderId,
      eventType: event.eventType,
      error: (err as Error).message,
    });
  }

  // 2. Write system chat message (if applicable for this event type)
  try {
    await client.query('SAVEPOINT sp_chat_messages');
    const chatMessage = getSystemChatMessage(event);
    if (chatMessage) {
      await client.query(
        `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
         VALUES ($1, 'system', $2, $3, 'system')`,
        [event.orderId, event.orderId, chatMessage.content]
      );

      // Insert additional rich messages (bank info cards, escrow info cards)
      if (chatMessage.extraMessages) {
        for (const extra of chatMessage.extraMessages) {
          await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $2, $3, 'system')`,
            [event.orderId, event.orderId, extra]
          );
        }
      }
    }
    await client.query('RELEASE SAVEPOINT sp_chat_messages');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_chat_messages').catch(() => {});
    logger.warn('[EventEmitter] Failed to write chat_messages', {
      orderId: event.orderId,
      eventType: event.eventType,
      error: (err as Error).message,
    });
  }

  // 3. Write to notification_outbox (reliable async delivery)
  try {
    await client.query('SAVEPOINT sp_outbox');
    await client.query(
      `INSERT INTO notification_outbox (event_type, order_id, payload, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        event.eventType.toUpperCase().replace(/\./g, '_'),
        event.orderId,
        JSON.stringify({
          orderId: event.orderId,
          userId: event.payload.userId || null,
          merchantId: event.payload.merchantId || null,
          buyerMerchantId: event.payload.buyerMerchantId || null,
          status: event.newStatus,
          previousStatus: event.previousStatus,
          minimal_status: event.payload.minimalStatus || event.newStatus,
          orderVersion: event.orderVersion,
          eventType: event.eventType,
          reason: event.payload.reason || null,
          updatedAt: event.timestamp,
        }),
        idempotencyKey,
      ]
    );
    await client.query('RELEASE SAVEPOINT sp_outbox');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_outbox').catch(() => {});
    logger.error('[EventEmitter] Failed to write notification_outbox', {
      orderId: event.orderId,
      eventType: event.eventType,
      error: (err as Error).message,
    });
  }
}

/**
 * Convenience: Build an OrderLifecycleEvent from common parameters.
 * Reduces boilerplate in callers.
 */
export function buildEvent(params: {
  orderId: string;
  eventType: OrderLifecycleEvent['eventType'];
  orderVersion: number;
  actorType: OrderLifecycleEvent['actor']['type'];
  actorId: string;
  previousStatus: OrderLifecycleEvent['previousStatus'];
  newStatus: OrderLifecycleEvent['newStatus'];
  payload?: Record<string, unknown>;
  requestId?: string;
}): OrderLifecycleEvent {
  const eventId = randomUUID();
  const timestamp = new Date().toISOString();
  return {
    eventId,
    eventType: params.eventType,
    timestamp,
    orderId: params.orderId,
    orderVersion: params.orderVersion,
    actor: {
      type: params.actorType,
      id: params.actorId,
    },
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    payload: params.payload || {},
    idempotencyKey: buildIdempotencyKey(
      params.orderId,
      params.eventType,
      params.orderVersion
    ),
    requestId: params.requestId,
  };
}
