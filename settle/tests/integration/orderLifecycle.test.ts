/**
 * Critical Path Tests: Order Lifecycle
 *
 * Tests the 3 flows that MUST work for the app to function:
 * 1. BUY order happy path (pending → accepted → escrowed → payment_sent → completed)
 * 2. SELL order happy path (merchant-initiated, pre-locked → accepted → payment_sent → completed)
 * 3. Cancel with refund (escrowed → cancelled)
 *
 * These tests hit the real API routes against a live local DB.
 * Run: npm run test:integration (requires settle dev server on port 3000 + core-api on 4010)
 *
 * Note: Balance deduction/refund only happens in MOCK_MODE.
 * In non-mock mode, escrow is on-chain (Solana), so DB balance stays unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { query, queryOne, pool } from 'settlement-core/db';

const BASE = process.env.SETTLE_URL || 'http://localhost:3000';

// Helper to call API
async function api(path: string, method = 'GET', body?: object) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data, ok: res.ok };
}

// Expect 2xx
function expectOk(result: { status: number; data: any; ok: boolean }, context: string) {
  if (!result.ok) {
    throw new Error(`${context}: HTTP ${result.status} — ${JSON.stringify(result.data)}`);
  }
  expect(result.data.success).toBe(true);
}

// Small delay for async event batching in core-api
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────
// TEST 1: BUY ORDER — HAPPY PATH
// ─────────────────────────────────────────────────────────
describe('BUY Order — Happy Path', () => {
  let userId: string;
  let merchantId: string; // seller
  let offerId: string;
  let orderId: string;
  const uid = `buy_hp_${Date.now()}`;

  beforeAll(async () => {
    // Create buyer (user)
    const u = await query<{ id: string }>(
      `INSERT INTO users (username, wallet_address, password_hash)
       VALUES ($1, $2, 'hash') RETURNING id`,
      [`user_${uid}`, `WALLET_U_${uid}`]
    );
    userId = u[0].id;

    // Create seller (merchant) with balance — must be 'active' for verifyMerchant
    const m = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance, status)
       VALUES ($1, 'Seller Merchant', 'Seller', $2, 10000, 'active') RETURNING id`,
      [`WALLET_M_${uid}`, `${uid}@test.com`]
    );
    merchantId = m[0].id;

    // Create offer (type='buy' = merchant buys crypto from users, i.e. user sells)
    // For user BUY order, user needs a matching offer — the system finds it via offer_id
    const o = await query<{ id: string }>(
      `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, is_active)
       VALUES ($1, 'buy', 'bank', 3.67, 10, 5000, 5000, true) RETURNING id`,
      [merchantId]
    );
    offerId = o[0].id;
  });

  afterAll(async () => {
    if (orderId) {
      await query('DELETE FROM chat_messages WHERE order_id = $1', [orderId]);
      await query('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]);
      await query('DELETE FROM order_events WHERE order_id = $1', [orderId]);
      await query('DELETE FROM ledger_entries WHERE related_order_id = $1', [orderId]);
      await query('DELETE FROM merchant_transactions WHERE order_id = $1', [orderId]);
      await query('DELETE FROM reputation_events WHERE entity_id = $1', [orderId]);
      await query('DELETE FROM orders WHERE id = $1', [orderId]);
    }
    if (offerId) await query('DELETE FROM merchant_offers WHERE id = $1', [offerId]);
    if (merchantId) await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    if (userId) await query('DELETE FROM users WHERE id = $1', [userId]);
  });

  it('Step 1: Create BUY order → status = pending', async () => {
    const result = await api('/api/orders', 'POST', {
      user_id: userId,
      type: 'buy',
      crypto_amount: 100,
      offer_id: offerId,
      payment_method: 'bank',
    });

    expectOk(result, 'Create BUY order');
    orderId = result.data.data?.id || result.data.order?.id;
    expect(orderId).toBeTruthy();

    const order = await queryOne<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order!.status).toBe('pending');
  });

  it('Step 2: Merchant accepts → status = accepted', async () => {
    const result = await api(`/api/orders/${orderId}`, 'PATCH', {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: merchantId,
    });

    expectOk(result, 'Accept order');

    const order = await queryOne<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order!.status).toBe('accepted');
  });

  it('Step 3: Merchant locks escrow → status = escrowed', async () => {
    const result = await api(`/api/orders/${orderId}/escrow`, 'POST', {
      tx_hash: `mock_escrow_${uid}`,
      actor_type: 'merchant',
      actor_id: merchantId,
    });

    expectOk(result, 'Lock escrow');

    const order = await queryOne<{ status: string; escrow_tx_hash: string }>(
      'SELECT status, escrow_tx_hash FROM orders WHERE id = $1', [orderId]
    );
    expect(order!.status).toBe('escrowed');
    expect(order!.escrow_tx_hash).toBeTruthy();
  });

  it('Step 4: Buyer sends fiat → status = payment_sent', async () => {
    const result = await api(`/api/orders/${orderId}`, 'PATCH', {
      status: 'payment_sent',
      actor_type: 'user',
      actor_id: userId,
    });

    expectOk(result, 'Mark payment sent');

    const order = await queryOne<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order!.status).toBe('payment_sent');
  });

  it('Step 5: Seller releases escrow → status = completed', async () => {
    const result = await api(`/api/orders/${orderId}/escrow`, 'PATCH', {
      tx_hash: `mock_release_${uid}`,
      actor_type: 'merchant',
      actor_id: merchantId,
    });

    expectOk(result, 'Release escrow');

    const order = await queryOne<{ status: string; release_tx_hash: string }>(
      'SELECT status, release_tx_hash FROM orders WHERE id = $1', [orderId]
    );
    expect(order!.status).toBe('completed');
    expect(order!.release_tx_hash).toBeTruthy();
  });

  it('Verify: order_events has audit trail', async () => {
    // Core-api batches events asynchronously — wait briefly
    await wait(200);

    const events = await query<{ event_type: string }>(
      `SELECT event_type FROM order_events WHERE order_id = $1 ORDER BY created_at`,
      [orderId]
    );
    const types = events.map(e => e.event_type);

    // At minimum, the status transitions should be recorded
    expect(types.length).toBeGreaterThanOrEqual(2);
    expect(types).toContain('status_changed_to_accepted');
    expect(types).toContain('status_changed_to_escrowed');
  });
});

// ─────────────────────────────────────────────────────────
// TEST 2: SELL ORDER — HAPPY PATH
// ─────────────────────────────────────────────────────────
describe('SELL Order — Happy Path (Merchant-initiated)', () => {
  let merchantId: string; // seller, creates the offer
  let buyerMerchantId: string; // buyer (M2M for simplicity)
  let offerId: string;
  let orderId: string;
  const uid = `sell_hp_${Date.now()}`;

  beforeAll(async () => {
    // Create seller merchant with balance
    const m = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance, status)
       VALUES ($1, 'Seller M', 'Seller', $2, 10000, 'active') RETURNING id`,
      [`WALLET_SELL_${uid}`, `sell_${uid}@test.com`]
    );
    merchantId = m[0].id;

    // Create buyer merchant
    const b = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance, status)
       VALUES ($1, 'Buyer M', 'Buyer', $2, 10000, 'active') RETURNING id`,
      [`WALLET_BUY_${uid}`, `buy_${uid}@test.com`]
    );
    buyerMerchantId = b[0].id;

    // SELL order creation requires a pre-existing offer (corridor)
    // Merchant SELL → API looks for offer type 'sell' (after inversion logic)
    const o = await query<{ id: string }>(
      `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, is_active)
       VALUES ($1, 'sell', 'bank', 3.67, 10, 5000, 5000, true) RETURNING id`,
      [merchantId]
    );
    offerId = o[0].id;
  });

  afterAll(async () => {
    if (orderId) {
      await query('DELETE FROM chat_messages WHERE order_id = $1', [orderId]);
      await query('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]);
      await query('DELETE FROM order_events WHERE order_id = $1', [orderId]);
      await query('DELETE FROM ledger_entries WHERE related_order_id = $1', [orderId]);
      await query('DELETE FROM merchant_transactions WHERE order_id = $1', [orderId]);
      await query('DELETE FROM reputation_events WHERE entity_id = $1', [orderId]);
      await query('DELETE FROM orders WHERE id = $1', [orderId]);
    }
    await query('DELETE FROM merchant_offers WHERE merchant_id IN ($1, $2)', [merchantId, buyerMerchantId]);
    if (buyerMerchantId) await query('DELETE FROM merchants WHERE id = $1', [buyerMerchantId]);
    if (merchantId) await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
  });

  it('Step 1: Merchant creates SELL order → status = pending or escrowed', async () => {
    // Merchant creates SELL via merchant orders endpoint
    // Type inversion: merchant SELL → DB type=buy
    const result = await api('/api/merchant/orders', 'POST', {
      merchant_id: merchantId,
      type: 'sell',
      crypto_amount: 200,
      payment_method: 'bank',
    });

    expectOk(result, 'Create SELL order');
    orderId = result.data.data?.id || result.data.order?.id;
    expect(orderId).toBeTruthy();

    const order = await queryOne<{ status: string; type: string }>(
      'SELECT status, type FROM orders WHERE id = $1', [orderId]
    );
    // DB type is inverted: merchant sell → DB 'buy'
    expect(order!.type).toBe('buy');
    // Order starts as pending (escrow locked separately) or escrowed (pre-locked)
    expect(['pending', 'escrowed']).toContain(order!.status);
  });

  it('Step 2: Ensure escrow locked, buyer accepts', async () => {
    // Ensure escrow is locked
    const currentOrder = await queryOne<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    if (currentOrder && currentOrder.status === 'pending') {
      // Accept first (so merchant can lock escrow)
      await api(`/api/orders/${orderId}`, 'PATCH', {
        status: 'accepted',
        actor_type: 'merchant',
        actor_id: merchantId,
      });
      // Lock escrow
      const escrowResult = await api(`/api/orders/${orderId}/escrow`, 'POST', {
        tx_hash: `mock_sell_escrow_${uid}`,
        actor_type: 'merchant',
        actor_id: merchantId,
      });
      expectOk(escrowResult, 'Lock escrow for SELL order');
    }

    // Buyer accepts — for escrowed SELL orders, use PATCH (mempool only accepts pending)
    // Set buyer_merchant_id directly to simulate M2M acceptance
    await query(
      `UPDATE orders SET buyer_merchant_id = $1 WHERE id = $2`,
      [buyerMerchantId, orderId]
    );

    const order = await queryOne<{ status: string; buyer_merchant_id: string }>(
      'SELECT status, buyer_merchant_id FROM orders WHERE id = $1', [orderId]
    );
    expect(order!.buyer_merchant_id).toBe(buyerMerchantId);
  });

  it('Step 3: Buyer marks fiat sent → payment_sent', async () => {
    const result = await api(`/api/orders/${orderId}`, 'PATCH', {
      status: 'payment_sent',
      actor_type: 'merchant',
      actor_id: buyerMerchantId,
    });

    expectOk(result, 'Buyer marks fiat sent');

    const order = await queryOne<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order!.status).toBe('payment_sent');
  });

  it('Step 4: Seller confirms fiat & releases → completed', async () => {
    const result = await api(`/api/orders/${orderId}/escrow`, 'PATCH', {
      tx_hash: `mock_sell_release_${uid}`,
      actor_type: 'merchant',
      actor_id: merchantId,
    });

    expectOk(result, 'Release escrow (SELL)');

    const order = await queryOne<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1', [orderId]
    );
    expect(order!.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────
// TEST 3: CANCEL WITH ESCROW REFUND
// ─────────────────────────────────────────────────────────
describe('Cancel with Escrow Refund', () => {
  let userId: string;
  let merchantId: string;
  let offerId: string;
  let orderId: string;
  const uid = `cancel_${Date.now()}`;

  beforeAll(async () => {
    const u = await query<{ id: string }>(
      `INSERT INTO users (username, wallet_address, password_hash)
       VALUES ($1, $2, 'hash') RETURNING id`,
      [`user_${uid}`, `WALLET_U_${uid}`]
    );
    userId = u[0].id;

    const m = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance, status)
       VALUES ($1, 'Cancel Test', 'Cancel', $2, 5000, 'active') RETURNING id`,
      [`WALLET_M_${uid}`, `${uid}@test.com`]
    );
    merchantId = m[0].id;

    const o = await query<{ id: string }>(
      `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, is_active)
       VALUES ($1, 'buy', 'bank', 3.67, 10, 5000, 5000, true) RETURNING id`,
      [merchantId]
    );
    offerId = o[0].id;
  });

  afterAll(async () => {
    if (orderId) {
      await query('DELETE FROM chat_messages WHERE order_id = $1', [orderId]);
      await query('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]);
      await query('DELETE FROM order_events WHERE order_id = $1', [orderId]);
      await query('DELETE FROM ledger_entries WHERE related_order_id = $1', [orderId]);
      await query('DELETE FROM merchant_transactions WHERE order_id = $1', [orderId]);
      await query('DELETE FROM reputation_events WHERE entity_id = $1', [orderId]);
      await query('DELETE FROM orders WHERE id = $1', [orderId]);
    }
    if (offerId) await query('DELETE FROM merchant_offers WHERE id = $1', [offerId]);
    if (merchantId) await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    if (userId) await query('DELETE FROM users WHERE id = $1', [userId]);
  });

  it('Setup: Create order, accept, lock escrow', async () => {
    // Create
    const create = await api('/api/orders', 'POST', {
      user_id: userId,
      type: 'buy',
      crypto_amount: 150,
      offer_id: offerId,
      payment_method: 'bank',
    });
    expectOk(create, 'Create order for cancel test');
    orderId = create.data.data?.id || create.data.order?.id;

    // Accept
    const accept = await api(`/api/orders/${orderId}`, 'PATCH', {
      status: 'accepted',
      actor_type: 'merchant',
      actor_id: merchantId,
    });
    expectOk(accept, 'Accept order for cancel test');

    // Escrow
    const escrow = await api(`/api/orders/${orderId}/escrow`, 'POST', {
      tx_hash: `mock_cancel_escrow_${uid}`,
      actor_type: 'merchant',
      actor_id: merchantId,
    });
    expectOk(escrow, 'Lock escrow for cancel test');

    const order = await queryOne<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order!.status).toBe('escrowed');
  });

  it('Cancel escrowed order → status = cancelled', async () => {
    const result = await api(`/api/orders/${orderId}`, 'PATCH', {
      status: 'cancelled',
      actor_type: 'merchant',
      actor_id: merchantId,
      reason: 'Integration test cancel',
    });

    expectOk(result, 'Cancel escrowed order');

    // Verify cancelled
    const order = await queryOne<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1', [orderId]
    );
    expect(order!.status).toBe('cancelled');
  });

  it('Verify: Cannot cancel again (already terminal)', async () => {
    const { data } = await api(`/api/orders/${orderId}`, 'PATCH', {
      status: 'cancelled',
      actor_type: 'merchant',
      actor_id: merchantId,
    });

    // Should fail — order is already cancelled
    expect(data.success).toBe(false);
  });
});

// Close pool
afterAll(async () => {
  await pool.end();
});
