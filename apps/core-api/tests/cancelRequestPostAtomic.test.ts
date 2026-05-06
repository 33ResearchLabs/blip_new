/**
 * Cancel-request POST — atomic + idempotent regression test (B3).
 *
 * Boots Fastify with the cancelRequest routes, seeds an order in
 * `escrowed` status, and verifies:
 *
 *   T1. Missing Idempotency-Key → 400 with no DB writes.
 *
 *   T2. Two parallel POSTs with the SAME key → exactly ONE
 *       cancel_requested order_event row (no duplication). The
 *       idempotency_log unique constraint serializes the racers.
 *
 *   T3. Two parallel POSTs with DIFFERENT keys → exactly ONE
 *       succeeds (200); the other observes `cancel_requested_by`
 *       already set and returns 400. No duplicate event.
 *
 *   T4. Replay the winning key → cached response, no second
 *       order_event insert.
 *
 * Skips cleanly when Postgres is unreachable.
 *
 * Run: tsx apps/core-api/tests/cancelRequestPostAtomic.test.ts
 */

import assert from 'node:assert';
import { randomUUID, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { pool, query as dbQuery } from 'settlement-core';
import { cancelRequestRoutes } from '../src/routes/cancelRequest.js';

process.env.NEXT_PUBLIC_MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE ?? 'true';
const SECRET = process.env.CORE_API_SECRET ?? 'test-secret';
process.env.CORE_API_SECRET = SECRET;

function signActor(actorType: string, actorId: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${actorType}:${actorId}:${ts}`).digest('hex');
  return {
    'x-actor-type': actorType,
    'x-actor-id': actorId,
    'x-actor-timestamp': String(ts),
    'x-actor-signature': sig,
    'x-core-api-secret': SECRET,
  };
}

async function countCancelRequestedEvents(orderId: string): Promise<number> {
  const rows = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM order_events WHERE order_id = $1 AND event_type = 'cancel_requested'`,
    [orderId],
  );
  return parseInt(rows[0]?.n ?? '0', 10);
}

async function main(): Promise<void> {
  try {
    await dbQuery('SELECT 1');
  } catch (err) {
    console.warn(
      '[cancelRequestPostAtomic] SKIP — Postgres not reachable:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(0);
  }

  const userId = randomUUID();
  const merchantId = randomUUID();
  const orderId = randomUUID();
  const orderNumber = `T-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const cleanup = async () => {
    await dbQuery('DELETE FROM order_events WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery("DELETE FROM outbox_events WHERE (payload->>'orderId') = $1", [orderId]).catch(() => {});
    await dbQuery('DELETE FROM idempotency_log WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await dbQuery('DELETE FROM merchants WHERE id = $1', [merchantId]).catch(() => {});
  };
  await cleanup();

  const app = Fastify({ logger: false });
  await app.register(cancelRequestRoutes, { prefix: '/v1' });

  try {
    await dbQuery(
      `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 0, 0)`,
      [userId, `t_${userId.slice(0, 8)}`],
    );
    await dbQuery(
      `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
       VALUES ($1, $2, 't', 't', 100, 0, 3.67)`,
      [merchantId, `t_${merchantId.slice(0, 8)}`],
    );
    await dbQuery(
      `INSERT INTO orders (id, order_number, user_id, merchant_id, type, status, payment_method,
                           crypto_amount, fiat_amount, rate, escrow_tx_hash,
                           escrow_debited_entity_type, escrow_debited_entity_id, escrow_debited_amount,
                           order_version)
       VALUES ($1, $2, $3, $4, 'buy', 'escrowed', 'bank',
               100, 367, 3.67, 'TX-' || $1,
               'merchant', $4, 100,
               1)`,
      [orderId, orderNumber, userId, merchantId],
    );

    const url = `/v1/orders/${orderId}/cancel-request`;

    // ── T1: missing Idempotency-Key ── must 400, no order_event written
    {
      const r = await app.inject({
        method: 'POST',
        url,
        headers: signActor('user', userId),
        payload: { actor_type: 'user', actor_id: userId, reason: 'no key' },
      });
      assert.strictEqual(r.statusCode, 400, 'T1: missing key must be 400');
      assert.match(String(r.json()?.error ?? ''), /Idempotency-Key/, 'T1: error mentions header');
      const events = await countCancelRequestedEvents(orderId);
      assert.strictEqual(events, 0, 'T1: no cancel_requested event written');
    }

    // ── T2: two parallel POSTs with SAME key ── only one event row
    {
      const sharedKey = randomUUID();
      const headers = { ...signActor('user', userId), 'idempotency-key': sharedKey };
      const [a, b] = await Promise.all([
        app.inject({
          method: 'POST',
          url,
          headers,
          payload: { actor_type: 'user', actor_id: userId, reason: 'concurrent same' },
        }),
        app.inject({
          method: 'POST',
          url,
          headers,
          payload: { actor_type: 'user', actor_id: userId, reason: 'concurrent same' },
        }),
      ]);
      // Both should observe the same outcome (200 winner + 200 cached, OR
      // 200 + 409 if the second saw the row already updated mid-txn).
      const okStatuses = [a.statusCode, b.statusCode].sort();
      assert.ok(
        okStatuses[0] === 200,
        `T2: at least one 200 expected, got ${okStatuses.join(',')}`,
      );
      const events = await countCancelRequestedEvents(orderId);
      assert.strictEqual(events, 1, `T2: exactly 1 event row, got ${events}`);
    }

    // Reset cancel state for T3.
    await dbQuery(
      `UPDATE orders
          SET cancel_requested_by = NULL,
              cancel_requested_at = NULL,
              cancel_request_reason = NULL,
              order_version = order_version + 1
        WHERE id = $1`,
      [orderId],
    );
    await dbQuery('DELETE FROM order_events WHERE order_id = $1', [orderId]);
    await dbQuery('DELETE FROM idempotency_log WHERE order_id = $1', [orderId]);

    // ── T3: two parallel POSTs with DIFFERENT keys ── exactly one wins
    {
      const k1 = randomUUID();
      const k2 = randomUUID();
      const baseHeaders = signActor('user', userId);
      const [a, b] = await Promise.all([
        app.inject({
          method: 'POST',
          url,
          headers: { ...baseHeaders, 'idempotency-key': k1 },
          payload: { actor_type: 'user', actor_id: userId, reason: 'concurrent diff' },
        }),
        app.inject({
          method: 'POST',
          url,
          headers: { ...baseHeaders, 'idempotency-key': k2 },
          payload: { actor_type: 'user', actor_id: userId, reason: 'concurrent diff' },
        }),
      ]);
      const winners = [a.statusCode, b.statusCode].filter((s) => s === 200).length;
      assert.strictEqual(winners, 1, `T3: exactly one 200 expected, got ${[a.statusCode, b.statusCode].join(',')}`);
      const events = await countCancelRequestedEvents(orderId);
      assert.strictEqual(events, 1, `T3: exactly 1 event row, got ${events}`);
    }

    // ── T4: replay winning key ── cached response, no second event
    {
      const replayKey = randomUUID();
      // Reset state once more.
      await dbQuery(
        `UPDATE orders
            SET cancel_requested_by = NULL,
                cancel_requested_at = NULL,
                cancel_request_reason = NULL,
                order_version = order_version + 1
          WHERE id = $1`,
        [orderId],
      );
      await dbQuery('DELETE FROM order_events WHERE order_id = $1', [orderId]);
      await dbQuery('DELETE FROM idempotency_log WHERE order_id = $1', [orderId]);

      const headers = { ...signActor('user', userId), 'idempotency-key': replayKey };
      const r1 = await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { actor_type: 'user', actor_id: userId, reason: 'first' },
      });
      assert.strictEqual(r1.statusCode, 200, 'T4: first call 200');
      const eventsAfter1 = await countCancelRequestedEvents(orderId);
      assert.strictEqual(eventsAfter1, 1, 'T4: 1 event after first call');

      const r2 = await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { actor_type: 'user', actor_id: userId, reason: 'replay' },
      });
      assert.strictEqual(r2.statusCode, 200, 'T4: replay returns 200 from cache');
      const eventsAfter2 = await countCancelRequestedEvents(orderId);
      assert.strictEqual(eventsAfter2, 1, 'T4: still exactly 1 event after replay');
    }

    console.log('cancelRequestPostAtomic: ALL TESTS PASSED');
  } finally {
    await app.close();
    await cleanup();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('cancelRequestPostAtomic FAILED:', err);
  process.exit(1);
});
