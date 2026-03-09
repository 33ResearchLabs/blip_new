/**
 * Idempotency Middleware Tests
 *
 * Tests the server-side idempotency guard:
 *
 * 1. Missing Idempotency-Key header → 400
 * 2. First request succeeds and inserts mutation
 * 3. Replay returns stored response + Idempotency-Replay header
 * 4. Only one mutation row created (dedup proof)
 * 5. Same key + different body → 409 mismatch
 * 6. Failed request can be retried with same key + same body
 *
 * Uses real local DB (settle, user zeus, port 5432).
 * Seeds test data with unique IDs and cleans up after.
 *
 * Run: npx tsx apps/core-api/tests/idempotency.test.ts
 */

import Fastify from 'fastify';
import assert from 'assert';
import { randomUUID } from 'crypto';
import { query, queryOne, closePool } from 'settlement-core';
import { idempotencyGuard, registerIdempotencyCapture } from '../src/middleware/idempotency.js';
import { registerRequestIdHeader, genReqId } from '../src/hooks/requestId.js';

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

// ─── Test data IDs ────────────────────────────────────────────────

const TEST_USER_ID = randomUUID();
const TEST_MERCHANT_ID = randomUUID();
const TEST_ORDER_ID = randomUUID();

// ─── Test app builder ─────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false, genReqId });
  registerRequestIdHeader(app);
  registerIdempotencyCapture(app);

  // Test route: protected by idempotency guard, inserts an order_event as the "mutation"
  app.post<{ Params: { id: string }; Body: { action: string } }>(
    '/test/:id',
    {
      preHandler: idempotencyGuard('test.action', (req) => (req.params as any).id),
    },
    async (request, reply) => {
      const { id } = request.params;
      const { action } = request.body;

      // Simulate a mutation — insert an order_event row
      await query(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, $2, 'system'::actor_type, $3, 'escrowed'::order_status, 'payment_sent'::order_status, '{}')`,
        [id, `test.${action}`, TEST_USER_ID]
      );

      return { success: true, data: { orderId: id, action } };
    }
  );

  // Test route that always fails (for failed-retry test)
  let failRouteCallCount = 0;
  app.post<{ Params: { id: string }; Body: { action: string } }>(
    '/test-fail/:id',
    {
      preHandler: idempotencyGuard('test.fail', (req) => (req.params as any).id),
    },
    async (request, reply) => {
      failRouteCallCount++;
      if (failRouteCallCount <= 1) {
        // First call: fail with 500
        return reply.status(500).send({ success: false, error: 'Simulated failure' });
      }
      // Subsequent calls: succeed
      return { success: true, data: { recovered: true } };
    }
  );

  return { app, getFailCallCount: () => failRouteCallCount };
}

// ─── Seed / Cleanup ──────────────────────────────────────────────

async function seed() {
  await query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, 'test_hash')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, `test_idem_user_${TEST_USER_ID.slice(0, 8)}`]
  );

  await query(
    `INSERT INTO merchants (id, business_name, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MERCHANT_ID, 'Test Idem Merchant', 'TestIdem', `test_idem_${TEST_MERCHANT_ID.slice(0, 8)}@test.com`]
  );

  await query(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method, status,
       crypto_amount, fiat_amount, rate, crypto_currency, fiat_currency, escrow_tx_hash)
     VALUES ($1, $2, $3, $4, 'buy', 'bank', 'escrowed', 100, 367, 3.67, 'USDC', 'AED', 'mock-escrow-idem')`,
    [TEST_ORDER_ID, `TEST-IDEM-${TEST_ORDER_ID.slice(0, 6)}`, TEST_USER_ID, TEST_MERCHANT_ID]
  );
}

async function cleanup() {
  await query('DELETE FROM idempotency_keys WHERE order_id = $1', [TEST_ORDER_ID]);
  await query(`DELETE FROM idempotency_keys WHERE key LIKE 'test-%'`);
  await query('DELETE FROM order_events WHERE order_id = $1', [TEST_ORDER_ID]);
  await query('DELETE FROM merchant_transactions WHERE order_id = $1', [TEST_ORDER_ID]);
  await query('DELETE FROM orders WHERE id = $1', [TEST_ORDER_ID]);
  await query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
  await query('DELETE FROM merchants WHERE id = $1', [TEST_MERCHANT_ID]);
}

// ─── Tests ────────────────────────────────────────────────────────

test('returns 400 when Idempotency-Key header is missing', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    payload: { action: 'payment_sent' },
    // No Idempotency-Key header
  });

  assert.strictEqual(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.success, false);
  assert.ok(body.error.includes('Idempotency-Key'));

  await app.close();
});

test('first request succeeds and inserts mutation', async () => {
  const { app } = buildApp();
  const key = `test-first-${randomUUID().slice(0, 8)}`;

  const res = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'payment_sent' },
  });

  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.orderId, TEST_ORDER_ID);

  // Verify idempotency_keys row was created
  const idemRow = await queryOne<{ key: string; status: string; route: string }>(
    'SELECT key, status, route FROM idempotency_keys WHERE key = $1',
    [key]
  );
  assert.ok(idemRow, 'idempotency_keys row not found');
  assert.strictEqual(idemRow!.status, 'completed');
  assert.strictEqual(idemRow!.route, 'test.action');

  // Cleanup this key
  await query('DELETE FROM idempotency_keys WHERE key = $1', [key]);

  await app.close();
});

test('replay returns stored response with Idempotency-Replay header', async () => {
  const { app } = buildApp();
  const key = `test-replay-${randomUUID().slice(0, 8)}`;

  // First request
  const res1 = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'replay_test' },
  });
  assert.strictEqual(res1.statusCode, 200);
  const body1 = JSON.parse(res1.body);

  // Second request — same key, same body
  const res2 = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'replay_test' },
  });

  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(res2.headers['idempotency-replay'], 'true');

  const body2 = JSON.parse(res2.body);
  assert.deepStrictEqual(body2, body1);

  // Cleanup
  await query('DELETE FROM idempotency_keys WHERE key = $1', [key]);

  await app.close();
});

test('only one mutation row created (dedup proof)', async () => {
  const { app } = buildApp();
  const key = `test-dedup-${randomUUID().slice(0, 8)}`;
  const action = `dedup_${randomUUID().slice(0, 6)}`;

  // First request
  await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action },
  });

  // Second request — same key
  await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action },
  });

  // Count order_events for this specific action
  const rows = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM order_events WHERE order_id = $1 AND event_type = $2`,
    [TEST_ORDER_ID, `test.${action}`]
  );
  const count = parseInt(rows[0].cnt);
  assert.strictEqual(count, 1, `Expected 1 event row, got ${count}`);

  // Cleanup
  await query('DELETE FROM idempotency_keys WHERE key = $1', [key]);

  await app.close();
});

test('same key + different body returns 409 mismatch', async () => {
  const { app } = buildApp();
  const key = `test-mismatch-${randomUUID().slice(0, 8)}`;

  // First request
  await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'original_action' },
  });

  // Second request — same key, DIFFERENT body
  const res = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'different_action' },
  });

  assert.strictEqual(res.statusCode, 409);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.success, false);
  assert.ok(body.error.includes('reuse'));

  // Cleanup
  await query('DELETE FROM idempotency_keys WHERE key = $1', [key]);

  await app.close();
});

test('failed request can be retried with same key', async () => {
  const { app } = buildApp();
  const key = `test-retry-${randomUUID().slice(0, 8)}`;

  // First request — will fail with 500
  const res1 = await app.inject({
    method: 'POST',
    url: `/test-fail/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'retry_test' },
  });
  assert.strictEqual(res1.statusCode, 500);

  // Verify status is 'failed'
  const idemRow = await queryOne<{ status: string }>(
    'SELECT status FROM idempotency_keys WHERE key = $1',
    [key]
  );
  assert.strictEqual(idemRow!.status, 'failed');

  // Retry with same key + same body — should succeed
  const res2 = await app.inject({
    method: 'POST',
    url: `/test-fail/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action: 'retry_test' },
  });
  assert.strictEqual(res2.statusCode, 200);

  const body2 = JSON.parse(res2.body);
  assert.strictEqual(body2.success, true);
  assert.strictEqual(body2.data.recovered, true);

  // Verify status is now 'completed'
  const idemRow2 = await queryOne<{ status: string }>(
    'SELECT status FROM idempotency_keys WHERE key = $1',
    [key]
  );
  assert.strictEqual(idemRow2!.status, 'completed');

  // Cleanup
  await query('DELETE FROM idempotency_keys WHERE key = $1', [key]);

  await app.close();
});

// ─── Runner ──────────────────────────────────────────────────────

async function run() {
  try {
    await seed();
  } catch (err) {
    console.error('Failed to seed test data:', (err as Error).message);
    process.exit(1);
  }

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  try {
    await cleanup();
  } catch (err) {
    console.error('Cleanup warning:', (err as Error).message);
  }

  await closePool();
  if (failed > 0) process.exit(1);
}

console.log('Idempotency Middleware Tests');
console.log('─'.repeat(40));
run();
