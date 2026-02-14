#!/usr/bin/env tsx
/**
 * Local Seed Script
 *
 * Resets the database, seeds base fixtures (users, merchants, offers),
 * then creates 20 orders across all 8 states using core-api endpoints.
 *
 * Prerequisites: scripts/dev-local.sh running in another terminal.
 *
 * Usage:
 *   tsx scripts/seed/local.ts              # full seed (reset + fixtures + orders)
 *   tsx scripts/seed/local.ts --reset-only # reset database only
 */

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';
const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';
const CORE_API_SECRET = process.env.CORE_API_SECRET || '';

const RESET_ONLY = process.argv.includes('--reset-only');

// ── Helpers ──

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CORE_API_SECRET) h['x-core-api-secret'] = CORE_API_SECRET;
  return h;
}

async function post(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 201) throw new Error(`POST ${url} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function patch(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PATCH ${url} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function del(url: string, query: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${url}?${qs}`, { method: 'DELETE', headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DELETE ${url} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Step 1: Reset ──

async function resetDatabase(): Promise<void> {
  console.log('[1/3] Resetting database...');
  await post(`${SETTLE_URL}/api/test/reset`, { confirm: true });
  await sleep(500);
  console.log('  Database reset complete.');
}

// ── Step 2: Seed fixtures ──

interface SeedData {
  users: Array<{ id: string; username: string }>;
  merchants: Array<{ id: string; username: string }>;
  offers: Array<{ id: string; type: string; payment_method: string; merchant_id: string }>;
}

async function seedFixtures(): Promise<SeedData> {
  console.log('[2/3] Seeding base fixtures...');
  const res = await post(`${SETTLE_URL}/api/test/seed`, { scenario: 'full' });
  if (!res.success) throw new Error(`Seed failed: ${res.error}`);

  const { users, merchants, offers } = res.data;
  console.log(`  ${users.length} users, ${merchants.length} merchants, ${offers.length} offers created.`);
  return { users, merchants, offers };
}

// ── Step 3: Create orders across all states ──

interface CreatedOrder {
  id: string;
  order_number: string;
  status: string;
  type: string;
}

async function createOrder(
  userId: string,
  merchantId: string,
  offerId: string,
  type: 'buy' | 'sell',
  amount: number,
  rate: number,
): Promise<CreatedOrder> {
  const res = await post(`${CORE_API_URL}/v1/orders`, {
    user_id: userId,
    merchant_id: merchantId,
    offer_id: offerId,
    type,
    payment_method: 'bank',
    crypto_amount: amount,
    fiat_amount: amount * rate,
    rate,
    payment_details: { bank_name: 'Seed Test Bank' },
  });
  return res.data;
}

async function seedOrders(data: SeedData): Promise<CreatedOrder[]> {
  console.log('[3/3] Creating 20 orders across all states...');

  const u1 = data.users[0].id;
  const u2 = data.users[1].id;
  const m1 = data.merchants[0].id;
  const m2 = data.merchants[1].id;
  // offers: [0]=m1 sell, [1]=m1 buy, [2]=m2 sell
  const sellOffer = data.offers[0].id; // merchant sells USDC → user buys
  const buyOffer = data.offers[1].id;  // merchant buys USDC → user sells
  const m2SellOffer = data.offers[2].id;

  const rate = 3.67;
  const orders: CreatedOrder[] = [];
  let idx = 0;

  const log = (label: string, order: CreatedOrder) => {
    idx++;
    orders.push(order);
    console.log(`  [${String(idx).padStart(2, '0')}] ${order.order_number} → ${order.status.padEnd(18)} (${label})`);
  };

  // ── 3x pending ──
  for (let i = 0; i < 3; i++) {
    const o = await createOrder(u1, m1, sellOffer, 'buy', 100 + i * 50, rate);
    log('pending', o);
  }

  // ── 3x accepted ──
  for (let i = 0; i < 3; i++) {
    const o = await createOrder(u2, m1, buyOffer, 'sell', 200 + i * 25, rate);
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: m1,
    });
    o.status = 'accepted';
    log('accepted', o);
  }

  // ── 3x escrowed ──
  for (let i = 0; i < 3; i++) {
    const o = await createOrder(u1, m1, sellOffer, 'buy', 300 + i * 30, rate);
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: m1,
    });
    await post(`${CORE_API_URL}/v1/orders/${o.id}/escrow`, {
      tx_hash: `mock_escrow_seed_${o.id.slice(0, 8)}`,
      actor_type: 'merchant',
      actor_id: m1,
    });
    o.status = 'escrowed';
    log('escrowed', o);
  }

  // ── 3x payment_sent ──
  for (let i = 0; i < 3; i++) {
    const o = await createOrder(u1, m1, sellOffer, 'buy', 400 + i * 20, rate);
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: m1,
    });
    await post(`${CORE_API_URL}/v1/orders/${o.id}/escrow`, {
      tx_hash: `mock_escrow_seed_ps_${o.id.slice(0, 8)}`,
      actor_type: 'merchant',
      actor_id: m1,
    });
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'payment_sent',
      actor_type: 'user',
      actor_id: u1,
    });
    o.status = 'payment_sent';
    log('payment_sent', o);
  }

  // ── 3x completed ──
  for (let i = 0; i < 3; i++) {
    const o = await createOrder(u2, m2, m2SellOffer, 'buy', 500 + i * 10, rate);
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: m2,
    });
    await post(`${CORE_API_URL}/v1/orders/${o.id}/escrow`, {
      tx_hash: `mock_escrow_seed_c_${o.id.slice(0, 8)}`,
      actor_type: 'merchant',
      actor_id: m2,
    });
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'payment_sent',
      actor_type: 'user',
      actor_id: u2,
    });
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'payment_confirmed',
      actor_type: 'merchant',
      actor_id: m2,
    });
    await post(`${CORE_API_URL}/v1/orders/${o.id}/events`, {
      event_type: 'release',
      tx_hash: `mock_release_seed_${o.id.slice(0, 8)}`,
    });
    o.status = 'completed';
    log('completed', o);
  }

  // ── 2x cancelled ──
  for (let i = 0; i < 2; i++) {
    const o = await createOrder(u1, m1, sellOffer, 'buy', 150 + i * 25, rate);
    await del(`${CORE_API_URL}/v1/orders/${o.id}`, {
      actor_type: 'user',
      actor_id: u1,
      reason: 'Seed: user cancelled',
    });
    o.status = 'cancelled';
    log('cancelled', o);
  }

  // ── 1x expired (create with short expiry, then expire via system) ──
  {
    const o = await createOrder(u2, m1, buyOffer, 'sell', 175, rate);
    // Expire via PATCH with system actor
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'expired',
      actor_type: 'system',
      actor_id: m1, // system uses merchant_id as actor_id
    });
    o.status = 'expired';
    log('expired', o);
  }

  // ── 2x disputed ──
  for (let i = 0; i < 2; i++) {
    const o = await createOrder(u1, m1, sellOffer, 'buy', 600 + i * 50, rate);
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: m1,
    });
    await post(`${CORE_API_URL}/v1/orders/${o.id}/escrow`, {
      tx_hash: `mock_escrow_seed_d_${o.id.slice(0, 8)}`,
      actor_type: 'merchant',
      actor_id: m1,
    });
    await patch(`${CORE_API_URL}/v1/orders/${o.id}`, {
      status: 'payment_sent',
      actor_type: 'user',
      actor_id: u1,
    });
    await post(`${CORE_API_URL}/v1/orders/${o.id}/dispute`, {
      reason: 'Seed: payment not received',
      description: `Seeded dispute #${i + 1} for testing`,
      initiated_by: 'merchant',
      actor_id: m1,
    });
    o.status = 'disputed';
    log('disputed', o);
  }

  return orders;
}

// ── Main ──

async function main() {
  console.log('\n=== Local Seed ===');
  console.log(`Settle:   ${SETTLE_URL}`);
  console.log(`Core API: ${CORE_API_URL}\n`);

  // Health check
  try {
    const h = await fetch(`${SETTLE_URL}/api/health`);
    if (!h.ok) throw new Error(`Settle unhealthy: ${h.status}`);
  } catch (err: any) {
    console.error(`Settle not reachable at ${SETTLE_URL}: ${err.message}`);
    console.error('Start with: pnpm dev:local');
    process.exit(1);
  }

  await resetDatabase();

  if (RESET_ONLY) {
    console.log('\n--reset-only: done.\n');
    process.exit(0);
  }

  // Check core-api health for order creation
  try {
    const h = await fetch(`${CORE_API_URL}/health`);
    if (!h.ok) throw new Error(`Core API unhealthy: ${h.status}`);
  } catch (err: any) {
    console.error(`Core API not reachable at ${CORE_API_URL}: ${err.message}`);
    console.error('Start with: pnpm dev:local');
    process.exit(1);
  }

  const fixtures = await seedFixtures();
  const orders = await seedOrders(fixtures);

  // Summary
  const stateCounts: Record<string, number> = {};
  for (const o of orders) {
    stateCounts[o.status] = (stateCounts[o.status] || 0) + 1;
  }

  console.log('\n=== Seed Summary ===');
  console.log(`Users:     ${fixtures.users.length}`);
  console.log(`Merchants: ${fixtures.merchants.length}`);
  console.log(`Offers:    ${fixtures.offers.length}`);
  console.log(`Orders:    ${orders.length}`);
  console.log(`States:    ${Object.entries(stateCounts).map(([s, c]) => `${s}(${c})`).join(', ')}`);
  console.log();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
