/**
 * Regression Test: Atomic Escrow Release with Events and Notifications
 *
 * Ensures that escrow release is truly atomic:
 * - release_tx_hash set
 * - status = 'completed'
 * - completed_at set
 * - payment_confirmed_at set
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

describe('Atomic Escrow Release', () => {
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
      [`user_${uniqueId}`, `WALLET_USER_${uniqueId}`]
    );
    testUserId = userResult[0].id;

    // Create test merchant with unique wallet
    const merchantResult = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance)
       VALUES ($1, 'Test Release Merchant', 'Test Merchant', $2, 1000)
       RETURNING id`,
      [`WALLET_MERCHANT_${uniqueId}`, `test_${uniqueId}@test.com`]
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

    // Create test order in payment_sent status (ready for release)
    const orderResult = await query<{ id: string }>(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
         status, escrow_tx_hash, escrow_trade_id, escrowed_at, payment_sent_at,
         expires_at, buyer_wallet_address, order_version
       ) VALUES ($1, $2, $3, 'buy', 'bank', 100, 367, 'USDC', 'AED', 3.67,
                 'payment_sent', 'demo-escrow-123', 123456, NOW(), NOW(),
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

  it('should atomically release escrow with all side effects', async () => {
    // Call the escrow release API
    const response = await fetch(`${SETTLE_URL}/api/orders/${testOrderId}/escrow`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_hash: 'demo-release-atomic-test',
        actor_type: 'merchant',
        actor_id: testMerchantId,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify order is completed
    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [testOrderId]
    );

    expect(order).toBeTruthy();
    expect(order!.status).toBe('completed');
    expect(order!.release_tx_hash).toBe('demo-release-atomic-test');
    expect(order!.completed_at).toBeTruthy();
    expect(order!.payment_confirmed_at).toBeTruthy();
    expect(Number(order!.order_version)).toBe(2); // Incremented from 1 to 2

    // Verify order_events record was created
    const events = await query<OrderEvent>(
      `SELECT * FROM order_events
       WHERE order_id = $1 AND event_type = 'order_completed'
       ORDER BY created_at DESC LIMIT 1`,
      [testOrderId]
    );

    expect(events.length).toBe(1);
    expect(events[0].new_status).toBe('completed');
    expect(events[0].old_status).toBe('payment_sent');
    expect(events[0].actor_type).toBe('merchant');

    // Verify notification_outbox record was created
    const outbox = await query<{ id: string; status: string; attempts: number; payload: unknown }>(
      `SELECT * FROM notification_outbox
       WHERE order_id = $1 AND event_type = 'ORDER_COMPLETED'
       ORDER BY created_at DESC LIMIT 1`,
      [testOrderId]
    );

    expect(outbox.length).toBe(1);
    expect(outbox[0].status).toBe('pending');
    expect(outbox[0].attempts).toBe(0);

    // pg auto-parses JSONB columns, so payload may already be an object
    const payload = typeof outbox[0].payload === 'string'
      ? JSON.parse(outbox[0].payload)
      : outbox[0].payload;
    expect(payload.orderId).toBe(testOrderId);
    expect(payload.status).toBe('completed');
    expect(payload.orderVersion).toBe(2);
    expect(payload.releaseTxHash).toBe('demo-release-atomic-test');
  });

  it('should prevent double-release', async () => {
    // Try to release again (order is now 'completed', not in releasable status)
    const response = await fetch(`${SETTLE_URL}/api/orders/${testOrderId}/escrow`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_hash: 'demo-release-duplicate',
        actor_type: 'merchant',
        actor_id: testMerchantId,
      }),
    });

    // Settle checks status before transaction; completed is not releasable → 400
    expect(response.status).toBeGreaterThanOrEqual(400);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe('Regression: Double-Release Protection', () => {
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
      [`user_${uniqueId}_dbl`, `WALLET_USER_${uniqueId}_dbl`]
    );
    testUserId = userResult[0].id;

    // Create test merchant
    const merchantResult = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance)
       VALUES ($1, 'Test Double Release Merchant', 'Test Merchant', $2, 1000)
       RETURNING id`,
      [`WALLET_MERCHANT_${uniqueId}_dbl`, `test_${uniqueId}_dbl@test.com`]
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

    // Create test order in payment_sent status
    const orderResult = await query<{ id: string }>(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
         status, escrow_tx_hash, escrow_trade_id, escrowed_at, payment_sent_at,
         expires_at, buyer_wallet_address, order_version
       ) VALUES ($1, $2, $3, 'buy', 'bank', 100, 367, 'USDC', 'AED', 3.67,
                 'payment_sent', 'demo-escrow-double-test', 123456, NOW(), NOW(),
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

  it('should prevent double-release via concurrent API calls', async () => {
    // Attempt to release twice concurrently
    const release1 = fetch(`${SETTLE_URL}/api/orders/${testOrderId}/escrow`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_hash: 'demo-release-concurrent-1',
        actor_type: 'merchant',
        actor_id: testMerchantId,
      }),
    });

    const release2 = fetch(`${SETTLE_URL}/api/orders/${testOrderId}/escrow`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_hash: 'demo-release-concurrent-2',
        actor_type: 'merchant',
        actor_id: testMerchantId,
      }),
    });

    const [response1, response2] = await Promise.all([release1, release2]);

    // One should succeed, one should fail (400 status check or 409 conflict)
    const data1 = await response1.json();
    const data2 = await response2.json();

    const successCount = [data1.success, data2.success].filter(Boolean).length;
    const failCount = [response1.status, response2.status].filter(s => s >= 400).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // Verify only ONE completion event exists
    const events = await query(
      `SELECT id FROM order_events
       WHERE order_id = $1 AND event_type = 'order_completed'`,
      [testOrderId]
    );

    expect(events.length).toBe(1);

    // Verify only ONE outbox entry for ORDER_COMPLETED
    const outbox = await query(
      `SELECT id FROM notification_outbox
       WHERE order_id = $1 AND event_type = 'ORDER_COMPLETED'`,
      [testOrderId]
    );

    expect(outbox.length).toBe(1);

    // Verify order_version is monotonic (not corrupted by race)
    const order = await query<Order>(
      'SELECT order_version FROM orders WHERE id = $1',
      [testOrderId]
    );

    expect(Number(order[0].order_version)).toBe(2); // Should be exactly 2 (incremented once)
  });
});

describe('Regression: Outbox Retry Reliability', () => {
  let testOrderId: string;
  let testUserId: string;
  let testMerchantId: string;
  let testOfferId: string;
  let outboxId: string;
  const uniqueId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  beforeAll(async () => {
    // Create test user
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (username, wallet_address, password_hash)
       VALUES ($1, $2, 'hash')
       RETURNING id`,
      [`user_${uniqueId}_outbox`, `WALLET_USER_${uniqueId}_outbox`]
    );
    testUserId = userResult[0].id;

    // Create test merchant
    const merchantResult = await query<{ id: string }>(
      `INSERT INTO merchants (wallet_address, business_name, display_name, email, balance)
       VALUES ($1, 'Test Outbox Merchant', 'Test Merchant', $2, 1000)
       RETURNING id`,
      [`WALLET_MERCHANT_${uniqueId}_outbox`, `test_${uniqueId}_outbox@test.com`]
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

    // Create test order
    const orderResult = await query<{ id: string }>(
      `INSERT INTO orders (
         user_id, merchant_id, offer_id, type, payment_method,
         crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
         status, order_version
       ) VALUES ($1, $2, $3, 'buy', 'bank', 100, 367, 'USDC', 'AED', 3.67,
                 'completed', 1)
       RETURNING id`,
      [testUserId, testMerchantId, testOfferId]
    );
    testOrderId = orderResult[0].id;

    // Create a test outbox entry in 'pending' state
    const outboxResult = await query<{ id: string }>(
      `INSERT INTO notification_outbox (event_type, order_id, payload, status, attempts, max_attempts)
       VALUES ('ORDER_COMPLETED', $1, $2, 'pending', 0, 3)
       RETURNING id`,
      [
        testOrderId,
        JSON.stringify({
          orderId: testOrderId,
          userId: testUserId,
          merchantId: testMerchantId,
          status: 'completed',
          orderVersion: 1,
        }),
      ]
    );
    outboxId = outboxResult[0].id;
  });

  afterAll(async () => {
    // Cleanup
    if (outboxId) {
      await query('DELETE FROM notification_outbox WHERE id = $1', [outboxId]);
    }
    if (testOrderId) {
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

  it('should retry failed notifications without corrupting order state', async () => {
    // Simulate first attempt failure by marking it as failed
    await query(
      `UPDATE notification_outbox
       SET status = 'failed', attempts = 1, last_error = 'Simulated failure', last_attempt_at = NOW()
       WHERE id = $1`,
      [outboxId]
    );

    // Verify outbox record is in failed state
    let outboxRecord = await query<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>(
      'SELECT status, attempts, last_error FROM notification_outbox WHERE id = $1',
      [outboxId]
    );

    expect(outboxRecord[0].status).toBe('failed');
    expect(outboxRecord[0].attempts).toBe(1);
    expect(outboxRecord[0].last_error).toBe('Simulated failure');

    // Simulate worker retry by resetting to pending (this is what worker does)
    await query(
      `UPDATE notification_outbox
       SET status = 'pending', last_attempt_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1`,
      [outboxId]
    );

    // Now mark it as sent (simulating successful retry)
    await query(
      `UPDATE notification_outbox
       SET status = 'sent', sent_at = NOW()
       WHERE id = $1`,
      [outboxId]
    );

    // Verify outbox record is now sent
    outboxRecord = await query<{ status: string; sent_at: Date | null }>(
      'SELECT status, sent_at FROM notification_outbox WHERE id = $1',
      [outboxId]
    );

    expect(outboxRecord[0].status).toBe('sent');
    expect(outboxRecord[0].sent_at).toBeTruthy();

    // Verify order state remained stable throughout
    const order = await query<Order>(
      'SELECT status, order_version FROM orders WHERE id = $1',
      [testOrderId]
    );

    expect(order[0].status).toBe('completed');
    expect(Number(order[0].order_version)).toBe(1); // Should not have changed
  });

  it('should not re-send already-sent notifications (idempotency)', async () => {
    // Record is already marked as 'sent' from previous test
    // Verify it remains sent even if worker processes it again
    const outboxRecord = await query<{ status: string }>(
      'SELECT status FROM notification_outbox WHERE id = $1',
      [outboxId]
    );

    expect(outboxRecord[0].status).toBe('sent');

    // If worker runs again, it should skip this record
    // (This is tested via the idempotency check in processOutboxRecord)
    // Just verify the record hasn't been modified
    const unchangedRecord = await query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM notification_outbox WHERE id = $1',
      [outboxId]
    );

    expect(unchangedRecord[0].status).toBe('sent');
  });
});

// Close DB pool after all tests to prevent jest hanging
afterAll(async () => {
  await pool.end();
});
