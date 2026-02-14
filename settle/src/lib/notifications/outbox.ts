/**
 * Notification Outbox Helper
 *
 * Inserts notification records into the outbox table for reliable delivery.
 * The outbox worker (started in server.js) polls and processes these records,
 * retrying failed deliveries via Pusher/WebSocket.
 */

import { query } from '@/lib/db';

interface OutboxInsert {
  eventType: string;
  orderId: string;
  payload: Record<string, unknown>;
}

/**
 * Insert a notification into the outbox for reliable async delivery.
 * This is fire-and-forget from the caller's perspective — the outbox worker handles retries.
 */
export async function insertNotificationOutbox({ eventType, orderId, payload }: OutboxInsert): Promise<void> {
  await query(
    `INSERT INTO notification_outbox (event_type, order_id, payload) VALUES ($1, $2, $3)`,
    [eventType, orderId, JSON.stringify(payload)]
  );
}
