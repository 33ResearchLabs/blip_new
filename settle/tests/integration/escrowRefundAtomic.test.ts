/**
 * Regression Test: Atomic Escrow Refund (Cancellation)
 *
 * Ensures that order cancellation with escrow refund is truly atomic:
 * - balance refund (if MOCK_MODE and escrow exists)
 * - status = 'cancelled'
 * - cancelled_at set
 * - order_events record created
 * - notification_outbox record created
 * - order_version incremented
 *
 * All in a SINGLE transaction - no race conditions, no silent failures.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { query, queryOne, pool } from 'settlement-core/db';
import { Order, OrderEvent } from 'settlement-core';

const SETTLE_URL = process.env.SETTLE_URL || 'https://localhost:3000';

describe('Atomic Escrow Refund (Cancellation)', () => {
  let testOrderId: string;
  let testUserId: string;
  let testMerchantId: string;
  let testOfferId: string;
  const uniqueId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  beforeAll(async () => {
    // Create test user with unique username
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (username, wallet_address, password_hash)
       VALUES ($1, $2, 'hash')
       RETURNING id`,
      [`user_${uniqueId}_refund`, `WALLET_USER_${uniqueId}_refund`]
    );
    testUserId = userResult[0].id;

    // Create test merchant with unique wallet
    const merchantResult = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance)
       VALUES ($1, 'Test Refund Merchant', 'Test Merchant', $2, 1000)
       RETURNING id`,
      [`WALLET_MERCHANT_${uniqueId}_refund`, `test_${uniqueId}_refund@test.com`]
    );
    testMerchantId = merchantResult[0].id;

    // Create test offer
    const offerResult = await query<{ id: string }>(
      `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount)
       VALUES ($1, 'buy', 'bank', 3.67, 10, 1000, 1000)
       RETURNING id`,
      [testMerchantId]
    );
    testOfferId = offerResult[0].id;

    // Create test order in escrowed status (ready for cancellation)
    const orderResult = await query<{ id: string }>(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
         status, escrow_tx_hash, escrow_trade_id, escrowed_at,
         expires_at, buyer_wallet_address, order_version
       ) VALUES ($1, $2, $3, 'buy', 'bank', 100, 367, 'USDC', 'AED', 3.67,
                 'escrowed', 'demo-escrow-refund-test', 123456, NOW(),
                 NOW() + INTERVAL '2 hours', 'MOCK_BUYER_WALLET', 1)
       RETURNING id`,
      [testUserId, testMerchantId, testOfferId]
    );
    testOrderId = orderResult[0].id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testOrderId) {
      await query('DELETE FROM notification_outbox WHERE order_id = $1', [testOrderId]);
      await query('DELETE FROM order_events WHERE order_id = $1', [testOrderId]);
      await query('DELETE FROM orders WHERE id = $1', [testOrderId]);
    }
    if (testOfferId) {
      await query('DELETE FROM merchant_offers WHERE id = $1', [testOfferId]);
    }
    if (testMerchantId) {
      await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    }
    if (testUserId) {
      await query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
  });

  it('should atomically cancel order with escrow refund (PATCH)', async () => {
    // Get initial merchant balance
    const initialBalance = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1',
      [testMerchantId]
    );

    // Cancel the order via PATCH /api/orders/:id
    const response = await fetch(`${SETTLE_URL}/api/orders/${testOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'cancelled',
        actor_type: 'merchant',
        actor_id: testMerchantId,
        reason: 'Test cancellation',
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify order is cancelled
    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [testOrderId]
    );

    expect(order).toBeTruthy();
    expect(order!.status).toBe('cancelled');
    expect(order!.cancelled_at).toBeTruthy();
    expect(Number(order!.order_version)).toBe(2); // Incremented from 1 to 2

    // Verify merchant balance was refunded (MOCK_MODE)
    const finalBalance = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1',
      [testMerchantId]
    );

    expect(parseFloat(finalBalance!.balance)).toBe(parseFloat(initialBalance!.balance) + 100); // 100 USDC refunded

    // Verify order_events record was created
    const events = await query<OrderEvent>(
      `SELECT * FROM order_events
       WHERE order_id = $1 AND event_type = 'order_cancelled'
       ORDER BY created_at DESC LIMIT 1`,
      [testOrderId]
    );

    expect(events.length).toBe(1);
    expect(events[0].new_status).toBe('cancelled');
    expect(events[0].old_status).toBe('escrowed');
    expect(events[0].actor_type).toBe('merchant');

    // Verify notification_outbox record was created
    const outbox = await query<{ id: string; status: string; attempts: number; payload: unknown }>(
      `SELECT * FROM notification_outbox
       WHERE order_id = $1 AND event_type = 'ORDER_CANCELLED'
       ORDER BY created_at DESC LIMIT 1`,
      [testOrderId]
    );

    expect(outbox.length).toBe(1);
    expect(outbox[0].status).toBe('pending');
    expect(outbox[0].attempts).toBe(0);

    // pg auto-parses JSONB columns
    const payload = typeof outbox[0].payload === 'string'
      ? JSON.parse(outbox[0].payload)
      : outbox[0].payload;
    expect(payload.orderId).toBe(testOrderId);
    expect(payload.status).toBe('cancelled');
    expect(payload.orderVersion).toBe(2);
  });
});

describe('Atomic Escrow Refund via DELETE', () => {
  let testOrderId: string;
  let testUserId: string;
  let testMerchantId: string;
  let testOfferId: string;
  const uniqueId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  beforeAll(async () => {
    // Create test user
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (username, wallet_address, password_hash)
       VALUES ($1, $2, 'hash')
       RETURNING id`,
      [`user_${uniqueId}_del`, `WALLET_USER_${uniqueId}_del`]
    );
    testUserId = userResult[0].id;

    // Create test merchant
    const merchantResult = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance)
       VALUES ($1, 'Test Delete Merchant', 'Test Merchant', $2, 1000)
       RETURNING id`,
      [`WALLET_MERCHANT_${uniqueId}_del`, `test_${uniqueId}_del@test.com`]
    );
    testMerchantId = merchantResult[0].id;

    // Create test offer
    const offerResult = await query<{ id: string }>(
      `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount)
       VALUES ($1, 'buy', 'bank', 3.67, 10, 1000, 1000)
       RETURNING id`,
      [testMerchantId]
    );
    testOfferId = offerResult[0].id;

    // Create test order in escrowed status (cancellable by state machine)
    const orderResult = await query<{ id: string }>(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
         status, escrow_tx_hash, escrow_trade_id, escrowed_at,
         expires_at, buyer_wallet_address, order_version
       ) VALUES ($1, $2, $3, 'buy', 'bank', 50, 183.5, 'USDC', 'AED', 3.67,
                 'escrowed', 'demo-escrow-delete-test', 999999, NOW(),
                 NOW() + INTERVAL '2 hours', 'MOCK_BUYER_WALLET', 1)
       RETURNING id`,
      [testUserId, testMerchantId, testOfferId]
    );
    testOrderId = orderResult[0].id;
  });

  afterAll(async () => {
    // Cleanup
    if (testOrderId) {
      await query('DELETE FROM notification_outbox WHERE order_id = $1', [testOrderId]);
      await query('DELETE FROM order_events WHERE order_id = $1', [testOrderId]);
      await query('DELETE FROM orders WHERE id = $1', [testOrderId]);
    }
    if (testOfferId) {
      await query('DELETE FROM merchant_offers WHERE id = $1', [testOfferId]);
    }
    if (testMerchantId) {
      await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    }
    if (testUserId) {
      await query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
  });

  it('should atomically cancel order with escrow refund (DELETE)', async () => {
    // Get initial merchant balance
    const initialBalance = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1',
      [testMerchantId]
    );

    // Cancel the order via DELETE
    const response = await fetch(
      `${SETTLE_URL}/api/orders/${testOrderId}?actor_type=merchant&actor_id=${testMerchantId}&reason=DELETE+test`,
      { method: 'DELETE' }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify order is cancelled
    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [testOrderId]
    );

    expect(order).toBeTruthy();
    expect(order!.status).toBe('cancelled');
    expect(Number(order!.order_version)).toBe(2);

    // Verify merchant balance was refunded
    const finalBalance = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1',
      [testMerchantId]
    );

    expect(parseFloat(finalBalance!.balance)).toBe(parseFloat(initialBalance!.balance) + 50);

    // Verify events and outbox
    const events = await query(
      `SELECT id FROM order_events WHERE order_id = $1 AND new_status = 'cancelled'`,
      [testOrderId]
    );
    expect(events.length).toBeGreaterThanOrEqual(1);

    const outbox = await query(
      `SELECT id FROM notification_outbox WHERE order_id = $1 AND event_type = 'ORDER_CANCELLED'`,
      [testOrderId]
    );
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Regression: Double-Refund Protection', () => {
  let testOrderId: string;
  let testUserId: string;
  let testMerchantId: string;
  let testOfferId: string;
  const uniqueId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  beforeAll(async () => {
    // Create test entities
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (username, wallet_address, password_hash)
       VALUES ($1, $2, 'hash') RETURNING id`,
      [`user_${uniqueId}_dblref`, `WALLET_USER_${uniqueId}_dblref`]
    );
    testUserId = userResult[0].id;

    const merchantResult = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance)
       VALUES ($1, 'Test Double Refund', 'Test', $2, 1000) RETURNING id`,
      [`WALLET_MERCHANT_${uniqueId}_dblref`, `test_${uniqueId}_dblref@test.com`]
    );
    testMerchantId = merchantResult[0].id;

    const offerResult = await query<{ id: string }>(
      `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount)
       VALUES ($1, 'buy', 'bank', 3.67, 10, 1000, 1000) RETURNING id`,
      [testMerchantId]
    );
    testOfferId = offerResult[0].id;

    const orderResult = await query<{ id: string }>(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
         status, escrow_tx_hash, escrow_trade_id, escrowed_at,
         expires_at, buyer_wallet_address, order_version
       ) VALUES ($1, $2, $3, 'buy', 'bank', 75, 275.25, 'USDC', 'AED', 3.67,
                 'escrowed', 'demo-escrow-double-refund', 888888, NOW(),
                 NOW() + INTERVAL '2 hours', 'MOCK_BUYER', 1)
       RETURNING id`,
      [testUserId, testMerchantId, testOfferId]
    );
    testOrderId = orderResult[0].id;
  });

  afterAll(async () => {
    if (testOrderId) {
      await query('DELETE FROM notification_outbox WHERE order_id = $1', [testOrderId]);
      await query('DELETE FROM order_events WHERE order_id = $1', [testOrderId]);
      await query('DELETE FROM orders WHERE id = $1', [testOrderId]);
    }
    if (testOfferId) await query('DELETE FROM merchant_offers WHERE id = $1', [testOfferId]);
    if (testMerchantId) await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    if (testUserId) await query('DELETE FROM users WHERE id = $1', [testUserId]);
  });

  it('should prevent double-refund via concurrent cancel calls', async () => {
    // Get initial balance
    const initialBalance = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1',
      [testMerchantId]
    );

    // Attempt to cancel twice concurrently
    const cancel1 = fetch(`${SETTLE_URL}/api/orders/${testOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'cancelled',
        actor_type: 'merchant',
        actor_id: testMerchantId,
        reason: 'Concurrent cancel 1',
      }),
    });

    const cancel2 = fetch(`${SETTLE_URL}/api/orders/${testOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'cancelled',
        actor_type: 'merchant',
        actor_id: testMerchantId,
        reason: 'Concurrent cancel 2',
      }),
    });

    const [response1, response2] = await Promise.all([cancel1, cancel2]);

    // One should succeed, one should fail
    const data1 = await response1.json();
    const data2 = await response2.json();

    const successCount = [data1.success, data2.success].filter(Boolean).length;
    expect(successCount).toBe(1);

    // Verify balance was only refunded ONCE
    const finalBalance = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1',
      [testMerchantId]
    );

    expect(parseFloat(finalBalance!.balance)).toBe(parseFloat(initialBalance!.balance) + 75); // Only +75, not +150

    // Verify only ONE cancellation event
    const events = await query(
      `SELECT id FROM order_events WHERE order_id = $1 AND event_type = 'order_cancelled'`,
      [testOrderId]
    );
    expect(events.length).toBe(1);

    // Verify only ONE outbox entry
    const outbox = await query(
      `SELECT id FROM notification_outbox WHERE order_id = $1 AND event_type = 'ORDER_CANCELLED'`,
      [testOrderId]
    );
    expect(outbox.length).toBe(1);
  });
});

// Close DB pool after all tests to prevent jest hanging
afterAll(async () => {
  await pool.end();
});
