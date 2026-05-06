/**
 * Idempotency-Key — required-header regression test.
 *
 * Pure unit test of `requireIdempotencyKey` and the `withIdempotency` /
 * `withTxIdempotency` wrappers. Verifies:
 *
 *   1. Missing header → 400 with a clear error message; the `execute`
 *      callback is NEVER invoked.
 *   2. Empty / whitespace-only header → 400.
 *   3. Header present + first call → execute runs, response returned.
 *   4. Header present + same scoped key → cached response, no second
 *      execute. (This requires a live DB; we skip if unreachable.)
 *
 * Run: tsx apps/core-api/tests/idempotencyRequired.test.ts
 */

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { pool, query as dbQuery } from 'settlement-core';
import {
  requireIdempotencyKey,
  withIdempotency,
  withTxIdempotency,
} from '../src/idempotency.js';

async function main(): Promise<void> {
  // ── Test 1+2: requireIdempotencyKey returns a 400 reply on missing/empty ─
  {
    const app = Fastify({ logger: false });
    app.post('/echo', async (req, reply) => {
      const missing = requireIdempotencyKey(req, reply);
      if (missing) return missing;
      return { ok: true };
    });

    const noHeader = await app.inject({ method: 'POST', url: '/echo', payload: {} });
    assert.strictEqual(noHeader.statusCode, 400, 'missing header must be 400');
    assert.match(
      String(noHeader.json()?.error ?? ''),
      /Idempotency-Key/i,
      'missing-header error must mention header name',
    );

    const empty = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'idempotency-key': '   ' },
      payload: {},
    });
    assert.strictEqual(empty.statusCode, 400, 'whitespace-only key must be 400');

    const present = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'idempotency-key': 'abc' },
      payload: {},
    });
    assert.strictEqual(present.statusCode, 200, 'present key must pass');
    assert.deepStrictEqual(present.json(), { ok: true });

    await app.close();
  }

  // ── Test 3: withIdempotency itself rejects missing-key (no execute) ────
  {
    const app = Fastify({ logger: false });
    let executed = 0;
    app.post('/wrapped', async (req, reply) =>
      withIdempotency(req, reply, 'unit_test', 'order-1', async () => {
        executed += 1;
        return { statusCode: 200, body: { run: executed } };
      }),
    );
    const missing = await app.inject({ method: 'POST', url: '/wrapped', payload: {} });
    assert.strictEqual(missing.statusCode, 400, 'withIdempotency must 400 on missing key');
    assert.strictEqual(executed, 0, 'execute callback must NOT run when key missing');
    await app.close();
  }

  // ── Test 4: withTxIdempotency caches the response on second call ──────
  try {
    await dbQuery('SELECT 1');
  } catch (err) {
    console.warn(
      '[idempotencyRequired] SKIP txn cache test — Postgres not reachable:',
      err instanceof Error ? err.message : String(err),
    );
    console.log('PASS idempotency required-header (DB-dependent test skipped)');
    process.exit(0);
  }

  {
    const app = Fastify({ logger: false });
    let executed = 0;

    // idempotency_log.order_id has a FK to orders(id) — seed a real order
    // so the INSERT inside withTxIdempotency does not fail on the FK.
    const orderId = randomUUID();
    const userId = randomUUID();
    const merchantId = randomUUID();
    // orders.order_number is varchar(20) — keep it short.
    const orderNumber = `IT-${Math.floor(Math.random() * 100000000)}`;
    await dbQuery(
      `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 0, 0)`,
      [userId, `idem_u_${userId.slice(0, 8)}`],
    );
    await dbQuery(
      `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
       VALUES ($1, $2, 'idem', 'idem', 0, 0, 3.67)`,
      [merchantId, `idem_m_${merchantId.slice(0, 8)}`],
    );
    await dbQuery(
      `INSERT INTO orders (
         id, order_number, user_id, merchant_id, type, payment_method,
         crypto_amount, fiat_amount, rate, status, order_version
       ) VALUES (
         $1, $2, $3, $4, 'buy'::offer_type, 'bank'::payment_method,
         10, 36.7, 3.67, 'pending'::order_status, 1
       )`,
      [orderId, orderNumber, userId, merchantId],
    );

    app.post('/tx', async (req, reply) =>
      withTxIdempotency(req, reply, 'unit_test_tx', orderId, async () => {
        executed += 1;
        return { statusCode: 200, body: { run: executed } };
      }),
    );

    const key = `unit-${randomUUID()}`;
    const actorId = randomUUID();
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': key,
      'x-actor-id': actorId,
    };
    const first = await app.inject({ method: 'POST', url: '/tx', headers, payload: {} });
    assert.strictEqual(first.statusCode, 200, `first call: ${first.statusCode} ${first.body}`);
    assert.deepStrictEqual(first.json(), { run: 1 });

    const second = await app.inject({ method: 'POST', url: '/tx', headers, payload: {} });
    assert.strictEqual(second.statusCode, 200, `second call: ${second.statusCode} ${second.body}`);
    assert.deepStrictEqual(second.json(), { run: 1 }, 'second call must return CACHED body, not a fresh run=2');
    assert.strictEqual(executed, 1, 'execute callback must run only once across two requests');

    // Cleanup
    await dbQuery('DELETE FROM idempotency_log WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await dbQuery('DELETE FROM merchants WHERE id = $1', [merchantId]).catch(() => {});
    await app.close();
  }

  console.log('PASS idempotency required-header + tx-cache replay');
  await pool.end().catch(() => {});
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
