/**
 * End-to-end trade flow test — simulates the EXACT API calls the UI makes.
 * Tests both M2M (merchant dashboard) and user P2P flows.
 */

const BASE = 'http://localhost:3000';

// Test merchants
const MERCHANT_A = '664d8192-ac4a-45df-81c5-acfdbc2ab8e9'; // TestMerchant1 (buyer)
const MERCHANT_B = '671158b8-8094-41b6-89c1-b90cf2060144'; // H4ck3r (seller)
const USER_ID = '1afcfd7b-3451-4cc8-9f0a-e786e41e01dd';    // test_buyer_001

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function api(path: string, opts?: RequestInit & { merchantId?: string; userId?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts?.headers as Record<string, string> };
  if (opts?.merchantId) headers['x-merchant-id'] = opts.merchantId;
  if (opts?.userId) headers['x-user-id'] = opts.userId;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

async function getOrder(orderId: string, merchantId: string) {
  // Fetch merchant's orders and find this one
  const res = await api(`/api/orders/${orderId}`, { merchantId });
  return res.data?.data || res.data;
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: M2M Flow (Merchant A buys, Merchant B sells)
// ═══════════════════════════════════════════════════════════════
async function testM2MFlow() {
  console.log('\n═══ TEST 1: M2M Trade Flow (Merchant A buys → Merchant B sells) ═══\n');

  // Step 1: Merchant A creates a BUY order
  console.log('Step 1: Merchant A creates BUY order');
  const createRes = await api('/api/merchant/orders', {
    method: 'POST',
    merchantId: MERCHANT_A,
    body: JSON.stringify({
      merchant_id: MERCHANT_A,
      type: 'buy',
      crypto_amount: 100,
      fiat_amount: 367,
      fiat_currency: 'AED',
      rate: 3.67,
      payment_method: 'bank',
      corridor_id: 'USDT_AED',
    }),
  });
  assert(createRes.ok, 'Order created', `status=${createRes.status} ${JSON.stringify(createRes.data?.error || '')}`);
  const orderId = createRes.data?.data?.id || createRes.data?.order?.id;
  if (!orderId) { console.log('  ABORT: No order ID'); return null; }

  // Check DB: type should be inverted to 'sell'
  const afterCreate = await getOrder(orderId, MERCHANT_A);
  assert(afterCreate?.type === 'sell', `Type inverted to sell (got ${afterCreate?.type})`);
  assert(afterCreate?.status === 'pending', `Status is pending (got ${afterCreate?.status})`);

  // Step 2: Merchant B accepts
  console.log('\nStep 2: Merchant B accepts order');
  const acceptRes = await api(`/api/orders/${orderId}`, {
    method: 'PATCH',
    merchantId: MERCHANT_B,
    body: JSON.stringify({
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: MERCHANT_B,
      acceptor_wallet_address: '54gXbJ5qUowZ2ZywwHkVLFAxYQwWfYJTUUYYmMa9iA2R',
    }),
  });
  assert(acceptRes.ok, 'Order accepted', `status=${acceptRes.status} ${JSON.stringify(acceptRes.data?.error || '')}`);

  const afterAccept = await getOrder(orderId, MERCHANT_B);
  assert(afterAccept?.status === 'accepted', `Status is accepted (got ${afterAccept?.status})`);
  assert(afterAccept?.merchant_id === MERCHANT_B, `merchant_id = Merchant B / seller (got ${afterAccept?.merchant_id})`);
  assert(afterAccept?.buyer_merchant_id === MERCHANT_A, `buyer_merchant_id = Merchant A / buyer (got ${afterAccept?.buyer_merchant_id})`);

  // Step 3: Merchant B locks escrow (simulated — POST escrow data)
  console.log('\nStep 3: Merchant B locks escrow');
  const escrowRes = await api(`/api/orders/${orderId}/escrow`, {
    method: 'POST',
    merchantId: MERCHANT_B,
    body: JSON.stringify({
      tx_hash: 'fake_tx_' + Date.now(),
      actor_type: 'merchant',
      actor_id: MERCHANT_B,
      escrow_trade_id: 12345,
      escrow_trade_pda: 'FakeTradePda1111111111111111111111111111111',
      escrow_pda: 'FakeEscrowPda1111111111111111111111111111111',
      escrow_creator_wallet: '54gXbJ5qUowZ2ZywwHkVLFAxYQwWfYJTUUYYmMa9iA2R',
    }),
  });
  assert(escrowRes.ok, 'Escrow recorded', `status=${escrowRes.status} ${JSON.stringify(escrowRes.data?.error || '')}`);

  const afterEscrow = await getOrder(orderId, MERCHANT_B);
  assert(afterEscrow?.status === 'escrowed', `Status is escrowed (got ${afterEscrow?.status})`);

  // Step 4: Merchant A marks fiat payment sent
  console.log('\nStep 4: Merchant A marks fiat payment sent');
  const payRes = await api(`/api/orders/${orderId}`, {
    method: 'PATCH',
    merchantId: MERCHANT_A,
    body: JSON.stringify({
      status: 'payment_sent',
      actor_type: 'merchant',
      actor_id: MERCHANT_A,
    }),
  });
  assert(payRes.ok, 'Payment sent marked', `status=${payRes.status} ${JSON.stringify(payRes.data?.error || '')}`);

  const afterPay = await getOrder(orderId, MERCHANT_A);
  assert(afterPay?.status === 'payment_sent', `Status is payment_sent (got ${afterPay?.status})`);

  // Step 5: Merchant B releases escrow (simulated — set release_tx_hash, then complete)
  console.log('\nStep 5: Merchant B releases escrow');
  const releaseRes = await api(`/api/orders/${orderId}/escrow`, {
    method: 'PATCH',
    merchantId: MERCHANT_B,
    body: JSON.stringify({
      tx_hash: 'fake_release_tx_' + Date.now(),
      actor_type: 'merchant',
      actor_id: MERCHANT_B,
    }),
  });
  assert(releaseRes.ok, 'Escrow released', `status=${releaseRes.status} ${JSON.stringify(releaseRes.data?.error || '')}`);

  const afterRelease = await getOrder(orderId, MERCHANT_B);
  assert(afterRelease?.status === 'completed' || afterRelease?.status === 'releasing', `Status is completed/releasing (got ${afterRelease?.status})`);

  console.log(`\n  M2M Flow: ${orderId}`);
  return orderId;
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: User P2P Flow (User buys via public app, Merchant sells)
// ═══════════════════════════════════════════════════════════════
async function testUserP2PFlow() {
  console.log('\n═══ TEST 2: User P2P Flow (User buys → Merchant sells) ═══\n');

  // Step 1: User places a BUY order (this goes through the user app API)
  console.log('Step 1: User creates BUY order');
  const createRes = await api('/api/orders', {
    method: 'POST',
    userId: USER_ID,
    body: JSON.stringify({
      user_id: USER_ID,
      offer_id: '4b2bd6e9-6c1c-4688-9885-9e19ff8cc0de',
      type: 'buy',
      crypto_amount: 100,
      payment_method: 'bank',
    }),
  });
  assert(createRes.ok, 'Order created', `status=${createRes.status} ${JSON.stringify(createRes.data?.error || '')}`);
  const orderId = createRes.data?.data?.id || createRes.data?.order?.id;
  if (!orderId) { console.log('  ABORT: No order ID'); return null; }

  // Check the user can see the order
  const userOrders = await api(`/api/orders?user_id=${USER_ID}`, { userId: USER_ID });
  const found = userOrders.data?.data?.find((o: any) => o.id === orderId);
  assert(!!found, 'User can see order in list');
  assert(found?.status === 'pending', `Status is pending (got ${found?.status})`);

  // Check offer has bank details
  assert(!!found?.offer?.bank_name || found?.offer?.bank_name === null, 'Offer includes bank_name field', `keys: ${Object.keys(found?.offer || {}).join(',')}`);

  // Step 2: Merchant B accepts
  console.log('\nStep 2: Merchant B accepts');
  const acceptRes = await api(`/api/orders/${orderId}`, {
    method: 'PATCH',
    merchantId: MERCHANT_B,
    body: JSON.stringify({
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: MERCHANT_B,
    }),
  });
  assert(acceptRes.ok, 'Order accepted', `status=${acceptRes.status} ${JSON.stringify(acceptRes.data?.error || '')}`);

  // User fetches single order (realtime polling)
  const singleOrder = await api(`/api/orders/${orderId}`, { userId: USER_ID });
  assert(singleOrder.ok, 'User can fetch single order');
  assert(singleOrder.data?.data?.status === 'accepted', `Status is accepted (got ${singleOrder.data?.data?.status})`);

  // Step 3: Merchant B locks escrow
  console.log('\nStep 3: Merchant B locks escrow');
  const escrowRes = await api(`/api/orders/${orderId}/escrow`, {
    method: 'POST',
    merchantId: MERCHANT_B,
    body: JSON.stringify({
      tx_hash: 'fake_user_tx_' + Date.now(),
      actor_type: 'merchant',
      actor_id: MERCHANT_B,
      escrow_trade_id: 67890,
      escrow_trade_pda: 'FakeUserTradePda111111111111111111111111111',
      escrow_pda: 'FakeUserEscrowPda111111111111111111111111111',
      escrow_creator_wallet: '54gXbJ5qUowZ2ZywwHkVLFAxYQwWfYJTUUYYmMa9iA2R',
    }),
  });
  assert(escrowRes.ok, 'Escrow recorded', `status=${escrowRes.status} ${JSON.stringify(escrowRes.data?.error || '')}`);

  // User sees escrowed status
  const afterEscrow = await api(`/api/orders/${orderId}`, { userId: USER_ID });
  assert(afterEscrow.data?.data?.status === 'escrowed', `User sees escrowed (got ${afterEscrow.data?.data?.status})`);

  // Step 4: User marks payment sent (this is what the "I've Paid" button does)
  console.log('\nStep 4: User marks fiat payment sent');
  const payRes = await api(`/api/orders/${orderId}`, {
    method: 'PATCH',
    userId: USER_ID,
    body: JSON.stringify({
      status: 'payment_sent',
      actor_type: 'user',
      actor_id: USER_ID,
    }),
  });
  assert(payRes.ok, 'Payment sent', `status=${payRes.status} ${JSON.stringify(payRes.data?.error || '')}`);

  const afterPay = await api(`/api/orders/${orderId}`, { userId: USER_ID });
  assert(afterPay.data?.data?.status === 'payment_sent', `Status is payment_sent (got ${afterPay.data?.data?.status})`);

  // Step 5: Merchant B releases escrow
  console.log('\nStep 5: Merchant B releases escrow');
  const releaseRes = await api(`/api/orders/${orderId}/escrow`, {
    method: 'PATCH',
    merchantId: MERCHANT_B,
    body: JSON.stringify({
      tx_hash: 'fake_release_user_tx_' + Date.now(),
      actor_type: 'merchant',
      actor_id: MERCHANT_B,
    }),
  });
  assert(releaseRes.ok, 'Escrow released', `status=${releaseRes.status} ${JSON.stringify(releaseRes.data?.error || '')}`);

  const afterRelease = await api(`/api/orders/${orderId}`, { userId: USER_ID });
  assert(afterRelease.data?.data?.status === 'completed' || afterRelease.data?.data?.status === 'releasing', `Status is completed/releasing (got ${afterRelease.data?.data?.status})`);

  console.log(`\n  P2P Flow: ${orderId}`);
  return orderId;
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: Self-accept guard
// ═══════════════════════════════════════════════════════════════
async function testSelfAcceptGuard() {
  console.log('\n═══ TEST 3: Self-accept guard ═══\n');

  // Create order as Merchant A
  const createRes = await api('/api/merchant/orders', {
    method: 'POST',
    merchantId: MERCHANT_A,
    body: JSON.stringify({
      merchant_id: MERCHANT_A,
      type: 'sell',
      crypto_amount: 100,
      fiat_amount: 367,
      fiat_currency: 'AED',
      rate: 3.67,
      payment_method: 'bank',
      corridor_id: 'USDT_AED',
    }),
  });
  const orderId = createRes.data?.data?.id || createRes.data?.order?.id;
  if (!orderId) { console.log('  ABORT: No order ID'); return; }

  // Merchant A tries to accept their own order
  const acceptRes = await api(`/api/orders/${orderId}`, {
    method: 'PATCH',
    merchantId: MERCHANT_A,
    body: JSON.stringify({
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: MERCHANT_A,
    }),
  });
  assert(!acceptRes.ok || acceptRes.data?.error?.includes('Cannot accept'), 'Self-accept blocked', `status=${acceptRes.status} ${JSON.stringify(acceptRes.data?.error || '')}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: Auth — no headers returns 401
// ═══════════════════════════════════════════════════════════════
async function testAuthGuard() {
  console.log('\n═══ TEST 4: Auth guards ═══\n');

  const res = await api('/api/orders/fake-id', { method: 'PATCH', body: JSON.stringify({ status: 'accepted', actor_type: 'user', actor_id: 'fake' }) });
  assert(res.status === 401, 'No auth headers → 401', `got ${res.status}`);
}

// ═══════════════════════════════════════════════════════════════
// RUN ALL
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  BLIP MONEY — End-to-End Flow Test       ║');
  console.log('╚═══════════════════════════════════════════╝');

  await testM2MFlow();
  await testUserP2PFlow();
  await testSelfAcceptGuard();
  await testAuthGuard();

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
