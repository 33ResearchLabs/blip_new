/**
 * Order Invariant Checker Tests
 *
 * Unit tests for checkInvariants() and checkPreCommit() — pure functions,
 * no DB needed for the unit section.
 *
 * Lifecycle regression tests use real local DB (settle, user zeus, port 5432).
 *
 * Run: npx tsx apps/core-api/tests/invariants.test.ts
 */

import assert from 'assert';
import { randomUUID } from 'crypto';
import {
  checkInvariants,
  checkPreCommit,
  PreCommitInvariantError,
  InvariantOrder,
  InvariantEvent,
  InvariantLedgerEntry,
  query,
  queryOne,
  closePool,
} from 'settlement-core';

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

// ─── Helpers ────────────────────────────────────────────────────

function makeOrder(overrides: Partial<InvariantOrder> = {}): InvariantOrder {
  return {
    id: randomUUID(),
    status: 'pending',
    escrow_tx_hash: null,
    release_tx_hash: null,
    refund_tx_hash: null,
    completed_at: null,
    cancelled_at: null,
    merchant_id: randomUUID(),
    buyer_merchant_id: null,
    order_version: 1,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<InvariantEvent> = {}): InvariantEvent {
  return {
    event_type: 'status_changed',
    new_status: null,
    old_status: null,
    ...overrides,
  };
}

// ─── checkInvariants: Unit Tests ────────────────────────────────

// 1. Completed + release_tx_hash → ok
test('checkInvariants: completed order with release_tx_hash passes', async () => {
  const order = makeOrder({
    status: 'completed',
    escrow_tx_hash: 'escrow-tx',
    release_tx_hash: 'release-tx',
    completed_at: new Date(),
  });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, true, `Expected ok, got violations: ${result.violations}`);
});

// 2. Completed + no release_tx_hash → violation
test('checkInvariants: completed order without release_tx_hash fails', async () => {
  const order = makeOrder({
    status: 'completed',
    escrow_tx_hash: 'escrow-tx',
    release_tx_hash: null,
    completed_at: new Date(),
  });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('release_tx_hash')));
});

// 3. release_tx_hash + escrow_tx_hash → ok
test('checkInvariants: release_tx_hash with escrow_tx_hash passes', async () => {
  const order = makeOrder({
    status: 'completed',
    escrow_tx_hash: 'escrow-tx',
    release_tx_hash: 'release-tx',
    completed_at: new Date(),
  });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, true);
});

// 4. release_tx_hash + no escrow_tx_hash → violation
test('checkInvariants: release_tx_hash without escrow_tx_hash fails', async () => {
  const order = makeOrder({
    status: 'completed',
    release_tx_hash: 'release-tx',
    escrow_tx_hash: null,
    completed_at: new Date(),
  });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('release_tx_hash exists without escrow_tx_hash')));
});

// 5. Terminal finality: clean event log → ok
test('checkInvariants: clean event log with no post-terminal events passes', async () => {
  const order = makeOrder({ status: 'completed', escrow_tx_hash: 'e', release_tx_hash: 'r', completed_at: new Date() });
  // Events in DESC order (most recent first) — matches DB query ORDER BY created_at DESC
  const events: InvariantEvent[] = [
    makeEvent({ old_status: 'escrowed', new_status: 'completed' }),
    makeEvent({ old_status: 'accepted', new_status: 'escrowed' }),
    makeEvent({ old_status: 'pending', new_status: 'accepted' }),
  ];
  const result = checkInvariants(order, events);
  assert.strictEqual(result.ok, true, `Violations: ${result.violations}`);
});

// 6. Terminal finality: non-terminal after terminal → violation
test('checkInvariants: event after terminal status fails', async () => {
  const order = makeOrder({ status: 'completed', escrow_tx_hash: 'e', release_tx_hash: 'r', completed_at: new Date() });
  // Events in reverse chronological order (most recent first)
  const events: InvariantEvent[] = [
    makeEvent({ event_type: 'reopen', old_status: 'completed', new_status: 'pending' }),
    makeEvent({ old_status: 'escrowed', new_status: 'completed' }),
    makeEvent({ old_status: 'pending', new_status: 'escrowed' }),
  ];
  const result = checkInvariants(order, events);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('Event after terminal status')));
});

// 7. Completed + completed_at → ok
test('checkInvariants: completed order with completed_at passes', async () => {
  const order = makeOrder({
    status: 'completed',
    escrow_tx_hash: 'e',
    release_tx_hash: 'r',
    completed_at: new Date(),
  });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, true);
});

// 8. Completed + no completed_at → violation
test('checkInvariants: completed order without completed_at fails', async () => {
  const order = makeOrder({
    status: 'completed',
    escrow_tx_hash: 'e',
    release_tx_hash: 'r',
    completed_at: null,
  });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('completed_at')));
});

// 9. Cancelled + cancelled_at → ok
test('checkInvariants: cancelled order with cancelled_at passes', async () => {
  const order = makeOrder({ status: 'cancelled', cancelled_at: new Date() });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, true);
});

// 10. Cancelled + no cancelled_at → violation
test('checkInvariants: cancelled order without cancelled_at fails', async () => {
  const order = makeOrder({ status: 'cancelled', cancelled_at: null });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('cancelled_at')));
});

// 11. Post-escrow status + escrow_tx_hash → ok
test('checkInvariants: escrowed order with escrow_tx_hash passes', async () => {
  const order = makeOrder({ status: 'escrowed', escrow_tx_hash: 'e' });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, true);
});

// 12. payment_sent + no escrow_tx_hash → violation
test('checkInvariants: payment_sent without escrow_tx_hash fails', async () => {
  const order = makeOrder({ status: 'payment_sent', escrow_tx_hash: null });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes("'payment_sent' status missing escrow_tx_hash")));
});

// 13. Ledger: unique idempotency_keys → ok
test('checkInvariants: unique ledger idempotency_keys passes', async () => {
  const order = makeOrder({ status: 'escrowed', escrow_tx_hash: 'e' });
  const ledger: InvariantLedgerEntry[] = [
    { entry_type: 'ESCROW_LOCK', amount: -100, idempotency_key: 'key1' },
    { entry_type: 'FEE', amount: -0.5, idempotency_key: 'key2' },
  ];
  const result = checkInvariants(order, [], ledger);
  assert.strictEqual(result.ok, true);
});

// 14. Ledger: duplicate idempotency_keys → violation
test('checkInvariants: duplicate ledger idempotency_keys fails', async () => {
  const order = makeOrder({ status: 'escrowed', escrow_tx_hash: 'e' });
  const ledger: InvariantLedgerEntry[] = [
    { entry_type: 'ESCROW_LOCK', amount: -100, idempotency_key: 'key1' },
    { entry_type: 'ESCROW_LOCK', amount: -100, idempotency_key: 'key1' },
  ];
  const result = checkInvariants(order, [], ledger);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('Duplicate ledger idempotency_keys')));
});

// 15. refund_tx_hash without escrow_tx_hash → violation
test('checkInvariants: refund_tx_hash without escrow_tx_hash fails', async () => {
  const order = makeOrder({ status: 'cancelled', cancelled_at: new Date(), refund_tx_hash: 'refund-tx', escrow_tx_hash: null });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('refund_tx_hash exists without escrow_tx_hash')));
});

// 16. order_version < 1 for non-pending → violation
test('checkInvariants: non-pending with order_version 0 fails', async () => {
  const order = makeOrder({ status: 'accepted', order_version: 0 });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('order_version')));
});

// 17. Pending with order_version 0 → ok (allowed for pending)
test('checkInvariants: pending with order_version 0 passes', async () => {
  const order = makeOrder({ status: 'pending', order_version: 0 });
  const result = checkInvariants(order, []);
  assert.strictEqual(result.ok, true);
});

// ─── checkPreCommit: Unit Tests ─────────────────────────────────

// 18. Terminal status → throws
test('checkPreCommit: transition from terminal status throws', async () => {
  const order = makeOrder({ status: 'completed', escrow_tx_hash: 'e', release_tx_hash: 'r', completed_at: new Date() });
  try {
    checkPreCommit(order, 'pending');
    assert.fail('Expected PreCommitInvariantError');
  } catch (err) {
    assert.ok(err instanceof PreCommitInvariantError);
    assert.strictEqual((err as PreCommitInvariantError).code, 'TERMINAL_STATUS');
  }
});

// 19. Completion without release + escrow → throws
test('checkPreCommit: completing with escrow but no release_tx_hash throws', async () => {
  const order = makeOrder({ status: 'payment_confirmed', escrow_tx_hash: 'e', release_tx_hash: null });
  try {
    checkPreCommit(order, 'completed');
    assert.fail('Expected PreCommitInvariantError');
  } catch (err) {
    assert.ok(err instanceof PreCommitInvariantError);
    assert.strictEqual((err as PreCommitInvariantError).code, 'COMPLETION_WITHOUT_RELEASE');
  }
});

// 20. Completion with hasReleaseTxHash context → ok
test('checkPreCommit: completing with hasReleaseTxHash context passes', async () => {
  const order = makeOrder({ status: 'payment_confirmed', escrow_tx_hash: 'e', release_tx_hash: null });
  // Should not throw when context says release_tx_hash is being provided
  checkPreCommit(order, 'completed', { hasReleaseTxHash: true });
});

// 21. Self-reference → throws
test('checkPreCommit: self-reference order throws for non-accept/cancel', async () => {
  const merchantId = randomUUID();
  const order = makeOrder({ status: 'escrowed', escrow_tx_hash: 'e', merchant_id: merchantId, buyer_merchant_id: merchantId });
  try {
    checkPreCommit(order, 'payment_sent');
    assert.fail('Expected PreCommitInvariantError');
  } catch (err) {
    assert.ok(err instanceof PreCommitInvariantError);
    assert.strictEqual((err as PreCommitInvariantError).code, 'SELF_REFERENCE');
  }
});

// 22. Self-reference but cancel → ok
test('checkPreCommit: self-reference order allows cancel', async () => {
  const merchantId = randomUUID();
  const order = makeOrder({ status: 'escrowed', escrow_tx_hash: 'e', merchant_id: merchantId, buyer_merchant_id: merchantId });
  checkPreCommit(order, 'cancelled');
});

// 23. Transient status → throws
test('checkPreCommit: transient status throws', async () => {
  const order = makeOrder({ status: 'pending' });
  try {
    checkPreCommit(order, 'escrow_pending');
    assert.fail('Expected PreCommitInvariantError');
  } catch (err) {
    assert.ok(err instanceof PreCommitInvariantError);
    assert.strictEqual((err as PreCommitInvariantError).code, 'TRANSIENT_STATUS');
  }
});

// 24. Valid transition → no throw
test('checkPreCommit: valid transition does not throw', async () => {
  const order = makeOrder({ status: 'pending' });
  checkPreCommit(order, 'accepted');
});

// ─── Lifecycle Regression Tests (real DB) ───────────────────────

const TEST_USER_ID = randomUUID();
const TEST_MERCHANT_ID = randomUUID();
const TEST_BUYER_MERCHANT_ID = randomUUID();
const lifecycleOrderIds: string[] = [];

async function seedLifecycle() {
  await query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, 'test_hash')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, `test_inv_user_${TEST_USER_ID.slice(0, 8)}`]
  );
  await query(
    `INSERT INTO merchants (id, business_name, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MERCHANT_ID, 'Test Invariant Merchant', 'TestInv', `test_inv_${TEST_MERCHANT_ID.slice(0, 8)}@test.com`]
  );
  await query(
    `INSERT INTO merchants (id, business_name, display_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_BUYER_MERCHANT_ID, 'Test Buyer Merchant', 'TestBuyer', `test_buyer_${TEST_BUYER_MERCHANT_ID.slice(0, 8)}@test.com`]
  );
}

async function cleanupLifecycle() {
  for (const orderId of lifecycleOrderIds) {
    await query('DELETE FROM ledger_entries WHERE related_order_id = $1', [orderId]);
    await query('DELETE FROM order_events WHERE order_id = $1', [orderId]);
    await query('DELETE FROM merchant_transactions WHERE order_id = $1', [orderId]);
    await query('DELETE FROM orders WHERE id = $1', [orderId]);
  }
  await query('DELETE FROM merchants WHERE id = $1', [TEST_MERCHANT_ID]);
  await query('DELETE FROM merchants WHERE id = $1', [TEST_BUYER_MERCHANT_ID]);
  await query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
}

async function createOrder(overrides: Record<string, unknown> = {}): Promise<string> {
  const orderId = randomUUID();
  lifecycleOrderIds.push(orderId);
  const defaults = {
    id: orderId,
    order_number: `TEST-INV-${orderId.slice(0, 6)}`,
    user_id: TEST_USER_ID,
    merchant_id: TEST_MERCHANT_ID,
    type: 'buy',
    payment_method: 'bank',
    status: 'pending',
    crypto_amount: 100,
    fiat_amount: 367,
    rate: 3.67,
    crypto_currency: 'USDC',
    fiat_currency: 'AED',
    order_version: 1,
    ...overrides,
  };

  const cols = Object.keys(defaults);
  const vals = Object.values(defaults);
  const placeholders = vals.map((_, i) => `$${i + 1}`);

  await query(
    `INSERT INTO orders (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    vals
  );
  return orderId;
}

async function updateOrder(orderId: string, fields: Record<string, unknown>) {
  const entries = Object.entries(fields);
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
  const vals = entries.map(([, v]) => v);
  await query(
    `UPDATE orders SET ${sets.join(', ')}, order_version = order_version + 1 WHERE id = $1`,
    [orderId, ...vals]
  );
}

async function addEvent(orderId: string, oldStatus: string, newStatus: string) {
  await query(
    `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
     VALUES ($1, $2, 'system', $3, $4, $5, '{}')`,
    [orderId, `status_changed_to_${newStatus}`, TEST_MERCHANT_ID, oldStatus, newStatus]
  );
}

async function fetchOrderAndEvents(orderId: string) {
  const order = await queryOne<InvariantOrder>('SELECT * FROM orders WHERE id = $1', [orderId]);
  const events = await query<InvariantEvent>(
    'SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at DESC',
    [orderId]
  );
  const ledger = await query<InvariantLedgerEntry>(
    'SELECT * FROM ledger_entries WHERE related_order_id = $1',
    [orderId]
  );
  return { order: order!, events, ledger };
}

// 25. Full happy path: pending → accepted → escrowed → payment_sent → payment_confirmed → completed
test('lifecycle: full happy path passes invariants at each stage', async () => {
  const orderId = await createOrder();

  // pending → accepted
  await updateOrder(orderId, { status: 'accepted', accepted_at: new Date() });
  await addEvent(orderId, 'pending', 'accepted');
  let { order, events, ledger } = await fetchOrderAndEvents(orderId);
  let result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `accepted: ${result.violations}`);

  // accepted → escrowed
  await updateOrder(orderId, { status: 'escrowed', escrow_tx_hash: 'mock-escrow-inv', escrowed_at: new Date() });
  await addEvent(orderId, 'accepted', 'escrowed');
  ({ order, events, ledger } = await fetchOrderAndEvents(orderId));
  result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `escrowed: ${result.violations}`);

  // escrowed → payment_sent
  await updateOrder(orderId, { status: 'payment_sent', payment_sent_at: new Date() });
  await addEvent(orderId, 'escrowed', 'payment_sent');
  ({ order, events, ledger } = await fetchOrderAndEvents(orderId));
  result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `payment_sent: ${result.violations}`);

  // payment_sent → payment_confirmed
  await updateOrder(orderId, { status: 'payment_confirmed', payment_confirmed_at: new Date() });
  await addEvent(orderId, 'payment_sent', 'payment_confirmed');
  ({ order, events, ledger } = await fetchOrderAndEvents(orderId));
  result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `payment_confirmed: ${result.violations}`);

  // payment_confirmed → completed
  await updateOrder(orderId, { status: 'completed', release_tx_hash: 'mock-release-inv', completed_at: new Date() });
  await addEvent(orderId, 'payment_confirmed', 'completed');
  ({ order, events, ledger } = await fetchOrderAndEvents(orderId));
  result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `completed: ${result.violations}`);
});

// 26. Clean cancel (no escrow): pending → cancelled
test('lifecycle: clean cancel (no escrow) passes invariants', async () => {
  const orderId = await createOrder();

  await updateOrder(orderId, { status: 'cancelled', cancelled_at: new Date(), cancellation_reason: 'test' });
  await addEvent(orderId, 'pending', 'cancelled');
  const { order, events, ledger } = await fetchOrderAndEvents(orderId);
  const result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `cancelled: ${result.violations}`);
});

// 27. Escrowed → disputed → resolved (cancelled with refund)
test('lifecycle: escrowed → disputed → cancelled passes invariants', async () => {
  const orderId = await createOrder({
    status: 'escrowed',
    escrow_tx_hash: 'mock-escrow-dispute',
    escrowed_at: new Date(),
  });
  await addEvent(orderId, 'pending', 'accepted');
  await addEvent(orderId, 'accepted', 'escrowed');

  // escrowed → disputed
  await updateOrder(orderId, { status: 'disputed' });
  await addEvent(orderId, 'escrowed', 'disputed');
  let { order, events, ledger } = await fetchOrderAndEvents(orderId);
  let result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `disputed: ${result.violations}`);

  // disputed → cancelled (with refund)
  await updateOrder(orderId, { status: 'cancelled', cancelled_at: new Date(), refund_tx_hash: 'mock-refund-inv' });
  await addEvent(orderId, 'disputed', 'cancelled');
  ({ order, events, ledger } = await fetchOrderAndEvents(orderId));
  result = checkInvariants(order, events, ledger);
  assert.strictEqual(result.ok, true, `cancelled after dispute: ${result.violations}`);
});

// ─── Runner ──────────────────────────────────────────────────────

async function run() {
  // Seed for lifecycle tests
  try {
    await seedLifecycle();
  } catch (err) {
    console.error('Failed to seed lifecycle data:', (err as Error).message);
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
    await cleanupLifecycle();
  } catch (err) {
    console.error('Cleanup warning:', (err as Error).message);
  }

  await closePool();
  if (failed > 0) process.exit(1);
}

console.log('Order Invariant Checker Tests');
console.log('─'.repeat(40));
run();
