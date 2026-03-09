/**
 * Ledger Idempotency Tests
 *
 * Tests DB-level uniqueness for ledger entries via idempotency_key:
 *
 * 1. Duplicate INSERT with same idempotency_key → count stays 1
 * 2. Different keys create separate entries
 * 3. NULL idempotency_key allows duplicates (backward compat)
 * 4. End-to-end: route + idempotency guard → 1 ledger entry on replay
 * 5. Debug endpoint shows no duplicate idempotency_keys
 *
 * Uses real local DB (settle, user zeus, port 5432).
 * Seeds test data with unique IDs and cleans up after.
 *
 * Run: npx tsx apps/core-api/tests/ledgerIdempotency.test.ts
 */

import Fastify from 'fastify';
import assert from 'assert';
import { randomUUID } from 'crypto';
import { query, queryOne, closePool } from 'settlement-core';
import { idempotencyGuard, registerIdempotencyCapture } from '../src/middleware/idempotency.js';
import { registerRequestIdHeader, genReqId } from '../src/hooks/requestId.js';
import { opsDebugRoutes } from '../src/routes/opsDebug.js';

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

  // Test route: inserts a ledger entry with deterministic idempotency_key
  app.post<{ Params: { id: string }; Body: { action: string } }>(
    '/test/:id',
    {
      preHandler: idempotencyGuard('test.ledger', (req) => (req.params as any).id),
    },
    async (request, reply) => {
      const { id } = request.params;
      const { action } = request.body;

      await query(
        `INSERT INTO ledger_entries
         (account_type, account_id, entry_type, amount, asset,
          related_order_id, description, idempotency_key)
         VALUES ('merchant', $1, 'ESCROW_LOCK', -100, 'USDT', $2, $3, $4)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [TEST_MERCHANT_ID, id, `Test ledger entry: ${action}`, `test:${id}:${action}`]
      );

      return { success: true, data: { orderId: id, action } };
    }
  );

  // Mount debug route (same prefix as index.ts)
  app.register(opsDebugRoutes, { prefix: '/v1' });

  return app;
}

// ─── Seed / Cleanup ──────────────────────────────────────────────

async function seed() {
  await query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, 'test_hash')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, `test_ledger_user_${TEST_USER_ID.slice(0, 8)}`]
  );

  await query(
    `INSERT INTO merchants (id, business_name, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MERCHANT_ID, 'Test Ledger Merchant', 'TestLedger', `test_ledger_${TEST_MERCHANT_ID.slice(0, 8)}@test.com`]
  );

  await query(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method, status,
       crypto_amount, fiat_amount, rate, crypto_currency, fiat_currency, escrow_tx_hash)
     VALUES ($1, $2, $3, $4, 'buy', 'bank', 'escrowed', 100, 367, 3.67, 'USDC', 'AED', 'mock-escrow-ledger')`,
    [TEST_ORDER_ID, `TEST-LEDGER-${TEST_ORDER_ID.slice(0, 6)}`, TEST_USER_ID, TEST_MERCHANT_ID]
  );
}

async function cleanup() {
  await query(`DELETE FROM ledger_entries WHERE idempotency_key LIKE 'test:%'`);
  await query(`DELETE FROM ledger_entries WHERE related_order_id = $1`, [TEST_ORDER_ID]);
  await query(`DELETE FROM idempotency_keys WHERE key LIKE 'test-%'`);
  await query('DELETE FROM order_events WHERE order_id = $1', [TEST_ORDER_ID]);
  await query('DELETE FROM merchant_transactions WHERE order_id = $1', [TEST_ORDER_ID]);
  await query('DELETE FROM orders WHERE id = $1', [TEST_ORDER_ID]);
  await query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
  await query('DELETE FROM merchants WHERE id = $1', [TEST_MERCHANT_ID]);
}

// ─── Tests ────────────────────────────────────────────────────────

test('duplicate INSERT with same idempotency_key is a no-op', async () => {
  const key = `test:direct:${randomUUID().slice(0, 8)}`;

  // First insert
  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, description, idempotency_key)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -50, 'USDT', $2, 'Test dedup 1', $3)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, key]
  );

  // Second insert — same key, should be no-op
  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, description, idempotency_key)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -50, 'USDT', $2, 'Test dedup 2', $3)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, key]
  );

  const rows = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entries WHERE idempotency_key = $1`,
    [key]
  );
  assert.strictEqual(parseInt(rows[0].cnt), 1, `Expected 1 entry, got ${rows[0].cnt}`);

  // Cleanup
  await query(`DELETE FROM ledger_entries WHERE idempotency_key = $1`, [key]);
});

test('different keys create separate entries', async () => {
  const key1 = `test:diff:${randomUUID().slice(0, 8)}:lock`;
  const key2 = `test:diff:${randomUUID().slice(0, 8)}:release`;

  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, idempotency_key)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -50, 'USDT', $2, $3)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, key1]
  );

  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, idempotency_key)
     VALUES ('merchant', $1, 'ESCROW_RELEASE', 50, 'USDT', $2, $3)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, key2]
  );

  const rows = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entries WHERE idempotency_key IN ($1, $2)`,
    [key1, key2]
  );
  assert.strictEqual(parseInt(rows[0].cnt), 2, `Expected 2 entries, got ${rows[0].cnt}`);

  // Cleanup
  await query(`DELETE FROM ledger_entries WHERE idempotency_key IN ($1, $2)`, [key1, key2]);
});

test('NULL idempotency_key allows duplicates (backward compat)', async () => {
  const tag = `null_test_${randomUUID().slice(0, 8)}`;

  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, description)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -50, 'USDT', $2, $3)`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, tag]
  );

  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, description)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -50, 'USDT', $2, $3)`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, tag]
  );

  const rows = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entries WHERE description = $1`,
    [tag]
  );
  assert.strictEqual(parseInt(rows[0].cnt), 2, `Expected 2 entries (NULL allows dupes), got ${rows[0].cnt}`);

  // Cleanup
  await query(`DELETE FROM ledger_entries WHERE description = $1`, [tag]);
});

test('end-to-end: route with idempotency guard → 1 ledger entry on replay', async () => {
  const app = buildApp();
  const key = `test-e2e-${randomUUID().slice(0, 8)}`;
  const action = `e2e_${randomUUID().slice(0, 6)}`;

  // First request
  const res1 = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action },
  });
  assert.strictEqual(res1.statusCode, 200);

  // Second request — same key (replay)
  const res2 = await app.inject({
    method: 'POST',
    url: `/test/${TEST_ORDER_ID}`,
    headers: { 'Idempotency-Key': key },
    payload: { action },
  });
  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(res2.headers['idempotency-replay'], 'true');

  // Count ledger entries for this action
  const rows = await query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entries WHERE idempotency_key = $1`,
    [`test:${TEST_ORDER_ID}:${action}`]
  );
  assert.strictEqual(parseInt(rows[0].cnt), 1, `Expected 1 ledger entry, got ${rows[0].cnt}`);

  // Cleanup
  await query(`DELETE FROM ledger_entries WHERE idempotency_key = $1`, [`test:${TEST_ORDER_ID}:${action}`]);
  await query(`DELETE FROM idempotency_keys WHERE key = $1`, [key]);

  await app.close();
});

test('debug endpoint shows no duplicate idempotency_keys', async () => {
  const app = buildApp();
  const key1 = `test:debug:${TEST_ORDER_ID}:ESCROW_LOCK`;
  const key2 = `test:debug:${TEST_ORDER_ID}:ESCROW_RELEASE`;

  // Seed 2 ledger entries with different keys
  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, description, idempotency_key)
     VALUES ('merchant', $1, 'ESCROW_LOCK', -100, 'USDT', $2, 'Debug test lock', $3)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, key1]
  );

  await query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, related_order_id, description, idempotency_key)
     VALUES ('merchant', $1, 'ESCROW_RELEASE', 100, 'USDT', $2, 'Debug test release', $3)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [TEST_MERCHANT_ID, TEST_ORDER_ID, key2]
  );

  // Call debug endpoint
  const res = await app.inject({
    method: 'GET',
    url: `/v1/ops/orders/${TEST_ORDER_ID}/debug`,
  });

  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);

  // Debug endpoint returns data directly (no success wrapper)
  const ledgerEntries = body.ledger_entries;
  assert.ok(Array.isArray(ledgerEntries), 'ledger_entries should be an array');

  const keys = ledgerEntries
    .map((e: any) => e.idempotency_key)
    .filter((k: unknown) => k != null);
  const uniqueKeys = new Set(keys);
  assert.strictEqual(keys.length, uniqueKeys.size, `Duplicate idempotency_keys found: ${JSON.stringify(keys)}`);

  // Cleanup
  await query(`DELETE FROM ledger_entries WHERE idempotency_key IN ($1, $2)`, [key1, key2]);

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

console.log('Ledger Idempotency Tests');
console.log('─'.repeat(40));
run();
