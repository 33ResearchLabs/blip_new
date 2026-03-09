/**
 * Ops Debug Endpoint Tests
 *
 * Tests GET /v1/ops/orders/:id/debug
 *
 * 1. Returns all 5 sections for a seeded order with events + ledger
 * 2. Events include request_id values
 * 3. invariants.ok = true for valid completed order
 * 4. invariants.ok = false for completed order missing release_tx_hash
 * 5. Returns 404 for non-existent order
 * 6. checkInvariants: terminal status finality violation
 *
 * Uses real local DB (settle, user zeus, port 5432).
 * Seeds test data with unique IDs and cleans up after.
 *
 * Run: tsx apps/core-api/tests/opsDebug.test.ts
 */

import Fastify from 'fastify';
import assert from 'assert';
import { randomUUID } from 'crypto';
import { query, closePool, checkInvariants } from 'settlement-core';
import { opsDebugRoutes } from '../src/routes/opsDebug.js';
import { registerRequestIdHeader, genReqId } from '../src/hooks/requestId.js';

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

function buildApp() {
  const app = Fastify({ logger: false, genReqId });
  registerRequestIdHeader(app);
  // No auth hook — tests don't need secret
  app.register(opsDebugRoutes, { prefix: '/v1' });
  return app;
}

// ─── Test data IDs ────────────────────────────────────────────────

const TEST_USER_ID = randomUUID();
const TEST_MERCHANT_ID = randomUUID();
const TEST_ORDER_VALID_ID = randomUUID();
const TEST_ORDER_BAD_ID = randomUUID();

// ─── Seed / Cleanup ──────────────────────────────────────────────

async function seed() {
  // User (minimal required columns)
  await query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, 'test_hash')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, `test_debug_user_${TEST_USER_ID.slice(0, 8)}`]
  );

  // Merchant (minimal required columns)
  await query(
    `INSERT INTO merchants (id, business_name, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [
      TEST_MERCHANT_ID,
      'Test Debug Merchant',
      'TestMerchant',
      `test_debug_${TEST_MERCHANT_ID.slice(0, 8)}@test.com`,
    ]
  );

  // Valid completed order (has both escrow + release hashes + completed_at)
  await query(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method, status,
       crypto_amount, fiat_amount, rate, crypto_currency, fiat_currency,
       escrow_tx_hash, release_tx_hash, completed_at)
     VALUES ($1, $2, $3, $4, 'buy', 'bank', 'completed', 100, 367, 3.67, 'USDC', 'AED',
       'mock-escrow-tx-valid', 'mock-release-tx-valid', NOW())`,
    [TEST_ORDER_VALID_ID, `TEST-DBG-${TEST_ORDER_VALID_ID.slice(0, 6)}`, TEST_USER_ID, TEST_MERCHANT_ID]
  );

  // Bad completed order (missing release_tx_hash)
  await query(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method, status,
       crypto_amount, fiat_amount, rate, crypto_currency, fiat_currency,
       escrow_tx_hash)
     VALUES ($1, $2, $3, $4, 'buy', 'bank', 'completed', 50, 183.5, 3.67, 'USDC', 'AED',
       'mock-escrow-tx-bad')`,
    [TEST_ORDER_BAD_ID, `TEST-DBG-${TEST_ORDER_BAD_ID.slice(0, 6)}`, TEST_USER_ID, TEST_MERCHANT_ID]
  );

  // 2 events for valid order (with request_id)
  await query(
    `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata, request_id)
     VALUES ($1, 'order.created', 'user', $2, NULL, 'pending', '{}', 'seed-req-1')`,
    [TEST_ORDER_VALID_ID, TEST_USER_ID]
  );
  await query(
    `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata, request_id)
     VALUES ($1, 'order.completed', 'merchant', $2, 'payment_sent', 'completed', '{}', 'seed-req-2')`,
    [TEST_ORDER_VALID_ID, TEST_MERCHANT_ID]
  );

  // 2 ledger entries for valid order
  await query(
    `INSERT INTO ledger_entries (account_type, account_id, entry_type, amount, related_order_id, description)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -100, $2, 'Test escrow lock')`,
    [TEST_MERCHANT_ID, TEST_ORDER_VALID_ID]
  );
  await query(
    `INSERT INTO ledger_entries (account_type, account_id, entry_type, amount, related_order_id, description)
     VALUES ('merchant', $1, 'ESCROW_RELEASE', 100, $2, 'Test escrow release')`,
    [TEST_MERCHANT_ID, TEST_ORDER_VALID_ID]
  );
}

async function cleanup() {
  // Delete in reverse FK order
  await query('DELETE FROM ledger_entries WHERE related_order_id = $1', [TEST_ORDER_VALID_ID]);
  await query('DELETE FROM order_events WHERE order_id = $1', [TEST_ORDER_VALID_ID]);
  await query('DELETE FROM order_events WHERE order_id = $1', [TEST_ORDER_BAD_ID]);
  await query('DELETE FROM merchant_transactions WHERE order_id = $1', [TEST_ORDER_VALID_ID]);
  await query('DELETE FROM merchant_transactions WHERE order_id = $1', [TEST_ORDER_BAD_ID]);
  await query('DELETE FROM orders WHERE id = $1', [TEST_ORDER_VALID_ID]);
  await query('DELETE FROM orders WHERE id = $1', [TEST_ORDER_BAD_ID]);
  await query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
  await query('DELETE FROM merchants WHERE id = $1', [TEST_MERCHANT_ID]);
}

// ─── Tests ────────────────────────────────────────────────────────

test('returns all 5 sections for valid order', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/ops/orders/${TEST_ORDER_VALID_ID}/debug`,
  });

  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);

  // All 5 top-level sections exist
  assert.ok(body.order, 'order section missing');
  assert.ok(Array.isArray(body.events), 'events section missing');
  assert.ok(Array.isArray(body.ledger_entries), 'ledger_entries section missing');
  assert.ok(body.tx, 'tx section missing');
  assert.ok(body.invariants, 'invariants section missing');
  assert.ok(body.meta, 'meta section missing');

  // Events count
  assert.ok(body.events.length >= 2, `expected >= 2 events, got ${body.events.length}`);

  // Ledger count
  assert.ok(body.ledger_entries.length >= 2, `expected >= 2 ledger entries, got ${body.ledger_entries.length}`);

  // TX hashes
  assert.strictEqual(body.tx.escrow_tx_hash, 'mock-escrow-tx-valid');
  assert.strictEqual(body.tx.release_tx_hash, 'mock-release-tx-valid');

  // Meta
  assert.ok(body.meta.generated_at, 'meta.generated_at missing');
  assert.ok(body.meta.request_id, 'meta.request_id missing');

  await app.close();
});

test('events include request_id values', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/ops/orders/${TEST_ORDER_VALID_ID}/debug`,
  });

  const body = JSON.parse(res.body);
  const reqIds = body.events.map((e: any) => e.request_id).filter(Boolean);
  assert.ok(reqIds.length >= 2, `expected >= 2 events with request_id, got ${reqIds.length}`);
  assert.ok(reqIds.includes('seed-req-1'));
  assert.ok(reqIds.includes('seed-req-2'));

  await app.close();
});

test('invariants.ok = true for valid completed order', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/ops/orders/${TEST_ORDER_VALID_ID}/debug`,
  });

  const body = JSON.parse(res.body);
  assert.strictEqual(body.invariants.ok, true, `violations: ${JSON.stringify(body.invariants.violations)}`);
  assert.deepStrictEqual(body.invariants.violations, []);

  await app.close();
});

test('invariants.ok = false for completed without release_tx_hash', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/ops/orders/${TEST_ORDER_BAD_ID}/debug`,
  });

  const body = JSON.parse(res.body);
  assert.strictEqual(body.invariants.ok, false);
  assert.ok(
    body.invariants.violations.some((v: string) => v.includes('Completed order missing release_tx_hash')),
    `expected release_tx_hash violation, got: ${JSON.stringify(body.invariants.violations)}`
  );

  await app.close();
});

test('returns 404 for non-existent order', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/ops/orders/${randomUUID()}/debug`,
  });

  assert.strictEqual(res.statusCode, 404);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.success, false);

  await app.close();
});

test('checkInvariants detects terminal status finality violation', () => {
  const order = {
    id: 'test',
    status: 'completed',
    escrow_tx_hash: 'tx1',
    release_tx_hash: 'tx2',
    refund_tx_hash: null,
  };

  // Events in DB order (newest first) — after completion, an event moves to non-terminal
  const events = [
    {
      id: '3',
      order_id: 'test',
      event_type: 'order.accepted',
      actor_type: 'merchant',
      actor_id: 'a',
      old_status: 'completed',
      new_status: 'accepted',
      metadata: null,
      request_id: null,
      created_at: '2026-03-01T03:00:00Z',
    },
    {
      id: '2',
      order_id: 'test',
      event_type: 'order.completed',
      actor_type: 'system',
      actor_id: 'b',
      old_status: 'payment_sent',
      new_status: 'completed',
      metadata: null,
      request_id: null,
      created_at: '2026-03-01T02:00:00Z',
    },
    {
      id: '1',
      order_id: 'test',
      event_type: 'order.created',
      actor_type: 'user',
      actor_id: 'c',
      old_status: null,
      new_status: 'pending',
      metadata: null,
      request_id: null,
      created_at: '2026-03-01T01:00:00Z',
    },
  ];

  const result = checkInvariants(order, events);
  assert.strictEqual(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.includes('Event after terminal status')),
    `expected terminal finality violation, got: ${JSON.stringify(result.violations)}`
  );
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

console.log('Ops Debug Endpoint Tests');
console.log('─'.repeat(40));
run();
