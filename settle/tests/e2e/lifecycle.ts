#!/usr/bin/env npx tsx
/**
 * E2E Lifecycle Test — Blip Money Protocol
 *
 * Tests every order state transition against the running API.
 * Run: npx tsx settle/tests/e2e/lifecycle.ts
 *
 * Requires: settle (port 3000) + core-api (port 4010) running
 */

const API = process.env.API_BASE || 'http://localhost:3000/api';
const CORE_API = process.env.CORE_API_URL || 'http://localhost:4010';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let seedData: {
  merchants: { id: string; username: string }[];
  users: { id: string; username: string }[];
};

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `${API}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function getOrderStatus(orderId: string): Promise<string> {
  const res = await api('GET', `/orders/${orderId}?actor_type=system&actor_id=system`);
  assert(res.ok, `Failed to fetch order ${orderId}: ${JSON.stringify(res.data)}`);
  const order = res.data?.data || res.data?.order || res.data;
  return order?.status || order?.minimal_status || 'unknown';
}

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`  ✓ ${name} (${duration}ms)`);
  } catch (err: any) {
    const duration = Date.now() - start;
    results.push({ name, passed: false, error: err.message, duration });
    console.log(`  ✗ ${name} (${duration}ms)`);
    console.log(`    ${err.message}`);
  }
}

// ─── Seed ────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🔧 Seeding test data...');
  const res = await api('POST', '/test/seed', { scenario: 'full' });
  if (!res.ok) {
    // Try GET fallback
    const fallback = await api('GET', '/test/seed?scenario=full');
    if (!fallback.ok) throw new Error(`Seed failed: ${JSON.stringify(fallback.data)}`);
    seedData = fallback.data.data;
  } else {
    seedData = res.data.data;
  }

  assert(seedData.merchants?.length >= 2, 'Need at least 2 test merchants');
  assert(seedData.users?.length >= 1, 'Need at least 1 test user');

  console.log(`  Merchants: ${seedData.merchants.map(m => m.username).join(', ')}`);
  console.log(`  Users: ${seedData.users.map(u => u.username).join(', ')}`);
}

// ─── Helpers for order operations ────────────────────────────────────────────

const M1 = () => seedData.merchants[0].id;
const M2 = () => seedData.merchants[1].id;

async function createOrder(merchantId: string, type: 'buy' | 'sell', amount = 50) {
  const res = await api('POST', '/merchant/orders', {
    merchant_id: merchantId,
    type,
    crypto_amount: amount,
    payment_method: 'bank',
    spread_preference: 'fastest',
    expiry_minutes: 60,
  });
  assert(res.ok, `Create ${type} order failed: ${JSON.stringify(res.data)}`);
  const order = res.data?.data?.order || res.data?.data || res.data?.order;
  assert(order?.id, `No order ID returned: ${JSON.stringify(res.data)}`);
  return order;
}

async function acceptOrder(orderId: string, merchantId: string) {
  const res = await api('PATCH', `/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  assert(res.ok, `Accept order failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function lockEscrow(orderId: string, merchantId: string) {
  const mockTxHash = `mock-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await api('POST', `/orders/${orderId}/escrow`, {
    tx_hash: mockTxHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  assert(res.ok, `Lock escrow failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function markPaymentSent(orderId: string, merchantId: string) {
  const res = await api('PATCH', `/orders/${orderId}`, {
    status: 'payment_sent',
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  assert(res.ok, `Mark payment_sent failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function completeOrder(orderId: string, merchantId: string) {
  const res = await api('PATCH', `/orders/${orderId}`, {
    status: 'completed',
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  assert(res.ok, `Complete order failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function cancelOrder(orderId: string, merchantId: string, reason = 'test cancel') {
  const res = await api('PATCH', `/orders/${orderId}`, {
    status: 'cancelled',
    actor_type: 'merchant',
    actor_id: merchantId,
    reason,
  });
  return res;
}

async function openDispute(orderId: string, merchantId: string, reason = 'test dispute') {
  const res = await api('POST', `/orders/${orderId}/dispute`, {
    reason,
    description: 'E2E test dispute',
    initiated_by: 'merchant',
    merchant_id: merchantId,
  });
  return res;
}

async function requestExtension(orderId: string, merchantId: string) {
  const res = await api('POST', `/orders/${orderId}/extension`, {
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res;
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

/**
 * TEST 1: BUY order full lifecycle
 * M1 creates BUY → M2 accepts (becomes seller) → M2 locks escrow → M1 sends fiat → M2 completes
 */
async function testBuyOrderLifecycle() {
  const order = await createOrder(M1(), 'buy', 25);
  const orderId = order.id;

  // M2 accepts → becomes seller
  await acceptOrder(orderId, M2());
  let status = await getOrderStatus(orderId);
  assert(status === 'accepted', `Expected accepted, got ${status}`);

  // M2 locks escrow (seller locks)
  await lockEscrow(orderId, M2());
  status = await getOrderStatus(orderId);
  assert(status === 'escrowed', `Expected escrowed, got ${status}`);

  // M1 marks fiat sent (buyer sends fiat)
  await markPaymentSent(orderId, M1());
  status = await getOrderStatus(orderId);
  assert(status === 'payment_sent', `Expected payment_sent, got ${status}`);

  // M2 completes (seller confirms fiat received, releases crypto)
  await completeOrder(orderId, M2());
  status = await getOrderStatus(orderId);
  assert(status === 'completed', `Expected completed, got ${status}`);
}

/**
 * TEST 2: SELL order full lifecycle
 * M1 creates SELL → M1 pre-locks escrow → M2 accepts (becomes buyer) → M2 sends fiat → M1 completes
 */
async function testSellOrderLifecycle() {
  const order = await createOrder(M1(), 'sell', 25);
  const orderId = order.id;

  // M1 pre-locks escrow (seller locks before anyone accepts)
  await lockEscrow(orderId, M1());
  let status = await getOrderStatus(orderId);
  assert(
    status === 'escrowed' || status === 'pending',
    `Expected escrowed or pending after pre-lock, got ${status}`
  );

  // M2 accepts → becomes buyer
  await acceptOrder(orderId, M2());
  status = await getOrderStatus(orderId);
  assert(
    status === 'accepted' || status === 'escrowed',
    `Expected accepted or escrowed, got ${status}`
  );

  // M2 marks fiat sent (buyer sends fiat)
  await markPaymentSent(orderId, M2());
  status = await getOrderStatus(orderId);
  assert(status === 'payment_sent', `Expected payment_sent, got ${status}`);

  // M1 completes (seller confirms fiat received)
  await completeOrder(orderId, M1());
  status = await getOrderStatus(orderId);
  assert(status === 'completed', `Expected completed, got ${status}`);
}

/**
 * TEST 3: Cancel before escrow (clean cancel)
 */
async function testCancelBeforeEscrow() {
  const order = await createOrder(M1(), 'buy', 10);
  const orderId = order.id;

  const res = await cancelOrder(orderId, M1());
  assert(res.ok, `Cancel failed: ${JSON.stringify(res.data)}`);

  const status = await getOrderStatus(orderId);
  assert(status === 'cancelled', `Expected cancelled, got ${status}`);
}

/**
 * TEST 4: Cancel after acceptance (before escrow = clean cancel)
 */
async function testCancelAfterAcceptance() {
  const order = await createOrder(M1(), 'buy', 10);
  const orderId = order.id;

  await acceptOrder(orderId, M2());
  let status = await getOrderStatus(orderId);
  assert(status === 'accepted', `Expected accepted, got ${status}`);

  const res = await cancelOrder(orderId, M2(), 'changed mind');
  assert(res.ok, `Cancel after accept failed: ${JSON.stringify(res.data)}`);

  status = await getOrderStatus(orderId);
  assert(status === 'cancelled', `Expected cancelled, got ${status}`);
}

/**
 * TEST 5: Dispute after escrow
 */
async function testDisputeAfterEscrow() {
  const order = await createOrder(M1(), 'buy', 15);
  const orderId = order.id;

  await acceptOrder(orderId, M2());
  await lockEscrow(orderId, M2());

  const status = await getOrderStatus(orderId);
  assert(status === 'escrowed', `Expected escrowed, got ${status}`);

  const res = await openDispute(orderId, M1(), 'seller not responding');
  assert(res.ok, `Dispute failed: ${JSON.stringify(res.data)}`);

  const newStatus = await getOrderStatus(orderId);
  assert(newStatus === 'disputed', `Expected disputed, got ${newStatus}`);
}

/**
 * TEST 6: Extension request
 */
async function testExtensionRequest() {
  const order = await createOrder(M1(), 'buy', 10);
  const orderId = order.id;

  // Request extension on pending order
  const res = await requestExtension(orderId, M1());
  // Extensions may or may not be supported for pending — just check it doesn't crash
  assert(
    res.ok || res.status === 400 || res.status === 422,
    `Extension request returned unexpected ${res.status}: ${JSON.stringify(res.data)}`
  );

  // Clean up
  await cancelOrder(orderId, M1());
}

/**
 * TEST 7: M2M order (merchant-to-merchant with target)
 */
async function testM2MOrder() {
  const res = await api('POST', '/merchant/orders', {
    merchant_id: M1(),
    type: 'buy',
    crypto_amount: 30,
    payment_method: 'bank',
    spread_preference: 'fastest',
    target_merchant_id: M2(),
    expiry_minutes: 60,
  });
  assert(res.ok, `M2M order creation failed: ${JSON.stringify(res.data)}`);

  const order = res.data?.data?.order || res.data?.data || res.data?.order;
  assert(order?.id, `No order ID for M2M: ${JSON.stringify(res.data)}`);

  // M2 should be able to see and accept
  await acceptOrder(order.id, M2());
  const status = await getOrderStatus(order.id);
  assert(status === 'accepted', `M2M accept: expected accepted, got ${status}`);

  // Clean up
  await cancelOrder(order.id, M2());
}

/**
 * TEST 8: Chat messages on order
 */
async function testOrderChat() {
  const order = await createOrder(M1(), 'buy', 10);
  const orderId = order.id;

  // Send message
  const sendRes = await api('POST', `/orders/${orderId}/messages`, {
    sender_type: 'merchant',
    sender_id: M1(),
    content: 'E2E test message',
    message_type: 'text',
  });
  assert(sendRes.ok, `Send message failed: ${JSON.stringify(sendRes.data)}`);

  // Read messages
  const readRes = await api('GET', `/orders/${orderId}/messages?actor_type=merchant&actor_id=${M1()}`);
  assert(readRes.ok, `Read messages failed: ${JSON.stringify(readRes.data)}`);

  const messages = readRes.data?.data || readRes.data?.messages || [];
  assert(Array.isArray(messages), `Messages not an array: ${typeof messages}`);

  // Clean up
  await cancelOrder(orderId, M1());
}

/**
 * TEST 9: Dispute flow → payment_sent → dispute
 */
async function testDisputeOnPaymentSent() {
  const order = await createOrder(M1(), 'buy', 15);
  const orderId = order.id;

  await acceptOrder(orderId, M2());
  await lockEscrow(orderId, M2());
  await markPaymentSent(orderId, M1());

  let status = await getOrderStatus(orderId);
  assert(status === 'payment_sent', `Expected payment_sent, got ${status}`);

  // M2 disputes (seller says they didn't receive fiat)
  const res = await openDispute(orderId, M2(), 'did not receive fiat payment');
  assert(res.ok, `Dispute on payment_sent failed: ${JSON.stringify(res.data)}`);

  status = await getOrderStatus(orderId);
  assert(status === 'disputed', `Expected disputed, got ${status}`);
}

/**
 * TEST 10: Double accept prevention
 */
async function testDoubleAcceptPrevention() {
  const order = await createOrder(M1(), 'buy', 10);
  const orderId = order.id;

  await acceptOrder(orderId, M2());

  // Try accepting again — should fail
  const res = await api('PATCH', `/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: M2(),
  });
  // Should fail since already accepted
  assert(
    !res.ok || res.status >= 400,
    `Double accept should have failed but got ${res.status}`
  );

  // Clean up
  await cancelOrder(orderId, M2());
}

/**
 * TEST 11: Health check
 */
async function testHealthCheck() {
  const res = await api('GET', '/health');
  assert(res.ok, `Health check failed: ${res.status}`);
}

/**
 * TEST 12: Invalid status transition
 */
async function testInvalidTransition() {
  const order = await createOrder(M1(), 'buy', 10);
  const orderId = order.id;

  // Try to complete a pending order (skip accept + escrow)
  const res = await api('PATCH', `/orders/${orderId}`, {
    status: 'completed',
    actor_type: 'merchant',
    actor_id: M1(),
  });
  assert(!res.ok, `Invalid transition pending→completed should fail, got ${res.status}`);

  await cancelOrder(orderId, M1());
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Blip Money — E2E Protocol Lifecycle Tests  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\nAPI: ${API}`);

  // Pre-flight: check server is up
  try {
    const health = await fetch(`${API}/health`);
    if (!health.ok) throw new Error(`status ${health.status}`);
  } catch (err: any) {
    console.error(`\n❌ Server not reachable at ${API}`);
    console.error(`   Start with: cd settle && npm run dev`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // Seed test data
  try {
    await seed();
  } catch (err: any) {
    console.error(`\n❌ Seed failed: ${err.message}`);
    console.error('   Make sure ALLOW_TEST_ENDPOINTS=1 or NODE_ENV=development');
    process.exit(1);
  }

  // Run tests
  console.log('\n── Core Lifecycle ──────────────────────────────');
  await runTest('Health check', testHealthCheck);
  await runTest('BUY order: create → accept → escrow → payment → complete', testBuyOrderLifecycle);
  await runTest('SELL order: create → escrow → accept → payment → complete', testSellOrderLifecycle);

  console.log('\n── Cancellation ───────────────────────────────');
  await runTest('Cancel before escrow (clean)', testCancelBeforeEscrow);
  await runTest('Cancel after acceptance (before escrow)', testCancelAfterAcceptance);

  console.log('\n── Disputes ───────────────────────────────────');
  await runTest('Dispute after escrow lock', testDisputeAfterEscrow);
  await runTest('Dispute on payment_sent', testDisputeOnPaymentSent);

  console.log('\n── Edge Cases ─────────────────────────────────');
  await runTest('Extension request', testExtensionRequest);
  await runTest('M2M order (merchant-to-merchant)', testM2MOrder);
  await runTest('Chat messages on order', testOrderChat);
  await runTest('Double accept prevention', testDoubleAcceptPrevention);
  await runTest('Invalid transition (pending → completed)', testInvalidTransition);

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((s, r) => s + r.duration, 0);

  console.log('\n══════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed (${totalTime}ms total)`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ✗ ${r.name}`);
      console.log(`      ${r.error}`);
    }
    console.log('');
    process.exit(1);
  } else {
    console.log('  All tests passed! ✓\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
