#!/usr/bin/env tsx
/**
 * Demo Flow Runner
 *
 * Runs end-to-end order flows against core-api, printing each step with timings.
 *
 * Prerequisites: scripts/dev-local.sh running + seed data (pnpm seed:local)
 *
 * Usage:
 *   tsx scripts/demo/runner.ts u2m:buy    # User buys USDC from merchant
 *   tsx scripts/demo/runner.ts u2m:sell   # User sells USDC to merchant
 *   tsx scripts/demo/runner.ts m2m:buy    # Merchant-to-merchant buy
 *   tsx scripts/demo/runner.ts m2m:sell   # Merchant-to-merchant sell
 */

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';
const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';
const CORE_API_SECRET = process.env.CORE_API_SECRET || '';

const FLOW = process.argv[2];
const VALID_FLOWS = ['u2m:buy', 'u2m:sell', 'm2m:buy', 'm2m:sell'];

if (!FLOW || !VALID_FLOWS.includes(FLOW)) {
  console.error(`Usage: tsx scripts/demo/runner.ts <${VALID_FLOWS.join('|')}>`);
  process.exit(1);
}

// ── Helpers ──

function coreHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CORE_API_SECRET) h['x-core-api-secret'] = CORE_API_SECRET;
  return { ...h, ...extra };
}

async function post(url: string, body: unknown, extra?: Record<string, string>): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: coreHeaders(extra), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 201) throw new Error(`POST ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function patch(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'PATCH', headers: coreHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PATCH ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Seed fresh fixtures for this demo ──

interface DemoData {
  userId: string;
  merchantId: string;
  merchant2Id: string;
  sellOfferId: string;  // merchant sells USDC (user buys)
  buyOfferId: string;   // merchant buys USDC (user sells)
  m2SellOfferId: string; // merchant2 sells USDC
}

async function seedDemo(): Promise<DemoData> {
  // Reset + seed via settle
  await fetch(`${SETTLE_URL}/api/test/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  await sleep(300);

  const res = await fetch(`${SETTLE_URL}/api/test/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'full' }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`Seed failed: ${body.error}`);

  const { users, merchants, offers } = body.data;
  return {
    userId: users[0].id,
    merchantId: merchants[0].id,
    merchant2Id: merchants[1].id,
    sellOfferId: offers[0].id,
    buyOfferId: offers[1].id,
    m2SellOfferId: offers[2].id,
  };
}

// ── Step logging ──

let stepNum = 0;
const flowStart = performance.now();

function step(action: string, detail: string) {
  stepNum++;
  const elapsed = ((performance.now() - flowStart) / 1000).toFixed(2);
  console.log(`  [${stepNum}] ${elapsed}s  ${action.padEnd(24)} ${detail}`);
}

// ── Demo Flows ──

async function u2mBuy(d: DemoData) {
  console.log('\n--- Demo: u2m:buy (User buys USDC from merchant) ---\n');

  // Create order
  const create = await post(`${CORE_API_URL}/v1/orders`, {
    user_id: d.userId,
    merchant_id: d.merchantId,
    offer_id: d.sellOfferId,
    type: 'buy',
    payment_method: 'bank',
    crypto_amount: 500,
    fiat_amount: 500 * 3.67,
    rate: 3.67,
    payment_details: { bank_name: 'Demo Bank' },
  });
  const orderId = create.data.id;
  step('ORDER_CREATED', `id=${orderId}  status=pending`);

  // Merchant accepts
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('ORDER_ACCEPTED', 'status=accepted  (merchant)');

  // Merchant locks escrow
  await post(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    tx_hash: `mock_demo_escrow_${orderId.slice(0, 8)}`,
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('ESCROW_LOCKED', 'status=escrowed  (merchant locks USDC)');

  // User marks payment sent
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_sent',
    actor_type: 'user',
    actor_id: d.userId,
  });
  step('PAYMENT_SENT', 'status=payment_sent  (user sends AED)');

  // Merchant confirms payment
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_confirmed',
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('PAYMENT_CONFIRMED', 'status=payment_confirmed  (merchant confirms AED received)');

  // Release escrow
  await post(`${CORE_API_URL}/v1/orders/${orderId}/events`, {
    event_type: 'release',
    tx_hash: `mock_demo_release_${orderId.slice(0, 8)}`,
  }, {
    'x-actor-type': 'merchant',
    'x-actor-id': d.merchantId,
  });
  step('ESCROW_RELEASED', 'status=completed  (USDC released to user)');

  return orderId;
}

async function u2mSell(d: DemoData) {
  console.log('\n--- Demo: u2m:sell (User sells USDC to merchant) ---\n');

  const create = await post(`${CORE_API_URL}/v1/orders`, {
    user_id: d.userId,
    merchant_id: d.merchantId,
    offer_id: d.buyOfferId,
    type: 'sell',
    payment_method: 'bank',
    crypto_amount: 300,
    fiat_amount: 300 * 3.65,
    rate: 3.65,
    payment_details: { bank_name: 'Demo Bank' },
  });
  const orderId = create.data.id;
  step('ORDER_CREATED', `id=${orderId}  status=pending  (user sells USDC)`);

  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('ORDER_ACCEPTED', 'status=accepted  (merchant)');

  // User locks escrow (seller locks crypto in sell order)
  await post(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    tx_hash: `mock_demo_escrow_${orderId.slice(0, 8)}`,
    actor_type: 'user',
    actor_id: d.userId,
  });
  step('ESCROW_LOCKED', 'status=escrowed  (user locks USDC)');

  // Merchant sends fiat
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_sent',
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('PAYMENT_SENT', 'status=payment_sent  (merchant sends AED)');

  // User confirms fiat received
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_confirmed',
    actor_type: 'user',
    actor_id: d.userId,
  });
  step('PAYMENT_CONFIRMED', 'status=payment_confirmed  (user confirms AED received)');

  // User releases escrow to merchant
  await post(`${CORE_API_URL}/v1/orders/${orderId}/events`, {
    event_type: 'release',
    tx_hash: `mock_demo_release_${orderId.slice(0, 8)}`,
  }, {
    'x-actor-type': 'user',
    'x-actor-id': d.userId,
  });
  step('ESCROW_RELEASED', 'status=completed  (USDC released to merchant)');

  return orderId;
}

async function m2mBuy(d: DemoData) {
  console.log('\n--- Demo: m2m:buy (Merchant1 buys USDC from Merchant2) ---\n');

  // Merchant1 creates order to buy from Merchant2's sell offer
  const create = await post(`${CORE_API_URL}/v1/orders`, {
    user_id: d.userId,          // placeholder user (settle normally creates this)
    merchant_id: d.merchant2Id, // target merchant (seller)
    offer_id: d.m2SellOfferId,
    type: 'buy',
    payment_method: 'bank',
    crypto_amount: 1000,
    fiat_amount: 1000 * 3.68,
    rate: 3.68,
    buyer_merchant_id: d.merchantId, // buying merchant
    payment_details: { bank_name: 'M2M Demo Bank' },
  });
  const orderId = create.data.id;
  step('ORDER_CREATED', `id=${orderId}  status=pending  (M2M buy)`);

  // Merchant2 accepts
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: d.merchant2Id,
  });
  step('ORDER_ACCEPTED', 'status=accepted  (seller merchant accepts)');

  // Merchant2 locks escrow (seller locks USDC)
  await post(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    tx_hash: `mock_m2m_escrow_${orderId.slice(0, 8)}`,
    actor_type: 'merchant',
    actor_id: d.merchant2Id,
  });
  step('ESCROW_LOCKED', 'status=escrowed  (seller merchant locks USDC)');

  // Merchant1 sends fiat
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_sent',
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('PAYMENT_SENT', 'status=payment_sent  (buyer merchant sends AED)');

  // Merchant2 confirms fiat received
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_confirmed',
    actor_type: 'merchant',
    actor_id: d.merchant2Id,
  });
  step('PAYMENT_CONFIRMED', 'status=payment_confirmed  (seller confirms AED)');

  // Release
  await post(`${CORE_API_URL}/v1/orders/${orderId}/events`, {
    event_type: 'release',
    tx_hash: `mock_m2m_release_${orderId.slice(0, 8)}`,
  }, {
    'x-actor-type': 'merchant',
    'x-actor-id': d.merchant2Id,
  });
  step('ESCROW_RELEASED', 'status=completed  (USDC released to buyer merchant)');

  return orderId;
}

async function m2mSell(d: DemoData) {
  console.log('\n--- Demo: m2m:sell (Merchant1 sells USDC to Merchant2) ---\n');

  // Merchant1 creates sell order, Merchant2 will buy
  const create = await post(`${CORE_API_URL}/v1/orders`, {
    user_id: d.userId,          // placeholder user
    merchant_id: d.merchantId,  // seller merchant
    offer_id: d.sellOfferId,
    type: 'sell',               // from placeholder user perspective (merchant1 is selling)
    payment_method: 'bank',
    crypto_amount: 800,
    fiat_amount: 800 * 3.67,
    rate: 3.67,
    buyer_merchant_id: d.merchant2Id,
    payment_details: { bank_name: 'M2M Demo Bank' },
  });
  const orderId = create.data.id;
  step('ORDER_CREATED', `id=${orderId}  status=pending  (M2M sell)`);

  // Merchant2 accepts (buyer)
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: d.merchant2Id,
  });
  step('ORDER_ACCEPTED', 'status=accepted  (buyer merchant accepts)');

  // Merchant1 locks escrow (seller locks USDC)
  await post(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    tx_hash: `mock_m2m_sell_escrow_${orderId.slice(0, 8)}`,
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('ESCROW_LOCKED', 'status=escrowed  (seller merchant locks USDC)');

  // Merchant2 sends fiat
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_sent',
    actor_type: 'merchant',
    actor_id: d.merchant2Id,
  });
  step('PAYMENT_SENT', 'status=payment_sent  (buyer merchant sends AED)');

  // Merchant1 confirms fiat
  await patch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    status: 'payment_confirmed',
    actor_type: 'merchant',
    actor_id: d.merchantId,
  });
  step('PAYMENT_CONFIRMED', 'status=payment_confirmed  (seller confirms AED)');

  // Release to Merchant2
  await post(`${CORE_API_URL}/v1/orders/${orderId}/events`, {
    event_type: 'release',
    tx_hash: `mock_m2m_sell_release_${orderId.slice(0, 8)}`,
  }, {
    'x-actor-type': 'merchant',
    'x-actor-id': d.merchantId,
  });
  step('ESCROW_RELEASED', 'status=completed  (USDC released to buyer merchant)');

  return orderId;
}

// ── Main ──

async function main() {
  console.log(`\n=== Demo: ${FLOW} ===`);
  console.log(`Core API: ${CORE_API_URL}`);
  console.log(`Settle:   ${SETTLE_URL}`);

  // Health checks
  try {
    const h1 = await fetch(`${CORE_API_URL}/health`);
    if (!h1.ok) throw new Error(`Core API: ${h1.status}`);
    const h2 = await fetch(`${SETTLE_URL}/api/health`);
    if (!h2.ok) throw new Error(`Settle: ${h2.status}`);
  } catch (err: any) {
    console.error(`\nHealth check failed: ${err.message}`);
    console.error('Start with: pnpm dev:local');
    process.exit(1);
  }

  console.log('\nSeeding fresh test data...');
  const data = await seedDemo();
  console.log(`  user=${data.userId.slice(0, 8)}  m1=${data.merchantId.slice(0, 8)}  m2=${data.merchant2Id.slice(0, 8)}`);

  let orderId: string;

  switch (FLOW) {
    case 'u2m:buy':
      orderId = await u2mBuy(data);
      break;
    case 'u2m:sell':
      orderId = await u2mSell(data);
      break;
    case 'm2m:buy':
      orderId = await m2mBuy(data);
      break;
    case 'm2m:sell':
      orderId = await m2mSell(data);
      break;
    default:
      throw new Error(`Unknown flow: ${FLOW}`);
  }

  const totalMs = (performance.now() - flowStart).toFixed(0);
  console.log(`\n=== Done ===`);
  console.log(`Order:  ${orderId}`);
  console.log(`Status: completed`);
  console.log(`Time:   ${totalMs}ms (${stepNum} steps)`);
  console.log();
}

main().catch((err) => {
  console.error('\nDemo failed:', err.message);
  process.exit(1);
});
