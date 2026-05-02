/**
 * Mutual cancel respond — concurrency + idempotency integration test.
 *
 * Boots a Fastify instance with the cancelRequest routes, seeds an order in
 * `escrowed` status with a pending cancel request from the merchant. Then:
 *
 *   1. Fires the user's accept TWICE concurrently with DIFFERENT idempotency
 *      keys. Asserts:
 *        - exactly one of them moves the order to `cancelled` (the other
 *          observes the conflict and gets 409 / no-op)
 *        - escrow balance refunded EXACTLY ONCE (no double-credit)
 *        - merchant_offers.available_amount restored EXACTLY ONCE
 *
 *   2. Replays the same idempotency key — must return the cached response
 *      with no further state change.
 *
 *   3. A request without an Idempotency-Key header → 400.
 *
 * Skips with a clear message if the local Postgres is unreachable.
 *
 * Run: tsx apps/core-api/tests/cancelRequestRespondRace.test.ts
 */

import assert from 'node:assert';
import { randomUUID, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { pool, query as dbQuery, queryOne } from 'settlement-core';
import { cancelRequestRoutes } from '../src/routes/cancelRequest.js';

// MOCK_MODE must be true for this test to exercise the in-mock refund path —
// the production path delegates refund to the on-chain release. Set BEFORE
// importing the route module above (settlement-core reads MOCK_MODE at load).
process.env.NEXT_PUBLIC_MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE ?? 'true';

const SECRET = process.env.CORE_API_SECRET ?? 'test-secret';
process.env.CORE_API_SECRET = SECRET;

function signActor(actorType: string, actorId: string) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${actorType}:${actorId}:${ts}`).digest('hex');
  return {
    'x-actor-type': actorType,
    'x-actor-id': actorId,
    'x-actor-timestamp': String(ts),
    'x-actor-signature': sig,
    'x-core-api-secret': SECRET,
  } as Record<string, string>;
}

async function main(): Promise<void> {
  try {
    await dbQuery('SELECT 1');
  } catch (err) {
    console.warn(
      '[cancelRequestRespondRace] SKIP — Postgres not reachable:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(0);
  }

  const userId = randomUUID();
  const merchantId = randomUUID();
  const orderId = randomUUID();
  const offerId = randomUUID();
  const orderNumber = `T-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const escrowAmount = 100;

  const cleanup = async () => {
    await dbQuery('DELETE FROM order_events WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM outbox_events WHERE (payload->>\'orderId\') = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM idempotency_log WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM merchant_offers WHERE id = $1', [offerId]).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await dbQuery('DELETE FROM merchants WHERE id = $1', [merchantId]).catch(() => {});
  };

  await cleanup();

  const app = Fastify({ logger: false });
  await app.register(cancelRequestRoutes, { prefix: '/v1' });

  try {
    // Seed: a user with 0 USDT (refund target), a merchant with the offer, and
    // an order that has the merchant's escrow locked. The mutual-cancel accept
    // path will refund the merchant since merchant funded the escrow on a BUY.
    await dbQuery(
      `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 0, 0)`,
      [userId, `cxltest_user_${userId.slice(0, 8)}`],
    );
    await dbQuery(
      `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
       VALUES ($1, $2, 'cxltest', 'cxltest', 0, 0, 3.67)`,
      [merchantId, `cxltest_m_${merchantId.slice(0, 8)}`],
    );
    await dbQuery(
      `INSERT INTO merchant_offers
        (id, merchant_id, type, payment_method, min_amount, max_amount, available_amount,
         rate, is_active)
       VALUES ($1, $2, 'buy'::offer_type, 'bank'::payment_method, 10, 1000, 0,
               3.67, true)`,
      [offerId, merchantId],
    );
    await dbQuery(
      `INSERT INTO orders (
         id, order_number, user_id, merchant_id, type, payment_method,
         crypto_amount, fiat_amount, rate, status, order_version,
         escrow_tx_hash, escrow_debited_entity_type, escrow_debited_entity_id,
         escrow_debited_amount, offer_id,
         cancel_requested_by, cancel_requested_at, cancel_request_reason
       ) VALUES (
         $1, $2, $3, $4, 'buy'::offer_type, 'bank'::payment_method,
         $5, $6, 3.67, 'escrowed'::order_status, 1,
         'mock-tx-hash', 'merchant', $4,
         $5, $7,
         'merchant'::actor_type, NOW(), 'price changed'
       )`,
      [orderId, orderNumber, userId, merchantId, escrowAmount, escrowAmount * 3.67, offerId],
    );

    // ── Test 1: missing Idempotency-Key → 400 ───────────────────────────
    {
      const resp = await app.inject({
        method: 'PUT',
        url: `/v1/orders/${orderId}/cancel-request`,
        headers: { 'content-type': 'application/json', ...signActor('user', userId) },
        payload: { actor_type: 'user', actor_id: userId, accept: true },
      });
      assert.strictEqual(resp.statusCode, 400, `expected 400 on missing Idempotency-Key, got ${resp.statusCode}`);
      const body = resp.json();
      assert.match(
        String(body?.error ?? ''),
        /Idempotency-Key/i,
        `expected idempotency-key error, got ${JSON.stringify(body)}`,
      );
      // No state change
      const orderStill = await queryOne<{ status: string; order_version: number }>(
        `SELECT status, order_version FROM orders WHERE id = $1`,
        [orderId],
      );
      assert.strictEqual(orderStill?.status, 'escrowed', 'order changed status on missing-key reject');
      assert.strictEqual(Number(orderStill?.order_version), 1, 'order_version moved on missing-key reject');
    }

    // ── Test 2: parallel accepts with DIFFERENT keys → exactly one wins ─
    const respond = (idempKey: string) =>
      app.inject({
        method: 'PUT',
        url: `/v1/orders/${orderId}/cancel-request`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempKey,
          ...signActor('user', userId),
        },
        payload: { actor_type: 'user', actor_id: userId, accept: true },
      });

    const keyA = `cxl-${randomUUID()}`;
    const keyB = `cxl-${randomUUID()}`;
    const [respA, respB] = await Promise.all([respond(keyA), respond(keyB)]);

    const bodies = [respA.json(), respB.json()];
    // Successful cancel response shape: { success: true, data: <order>, cancelled: true }
    const cancelledFlags = bodies.map((b) => b?.success === true && b?.cancelled === true);
    const successCount = cancelledFlags.filter(Boolean).length;
    assert.strictEqual(
      successCount,
      1,
      `expected exactly ONE successful cancel; got ${successCount}. responses=${JSON.stringify(bodies)}`,
    );

    // The loser may be:
    //   - 409 "Order was modified concurrently" (raced past status guard), OR
    //   - 400 "No cancel request pending"        (raced past `cancel_requested_by`)
    // Either is a correct, idempotent observation — both indicate that the
    // mutation was correctly serialised and the loser made no balance changes.
    // What we will NOT tolerate: 200 with `cancelled: true` from both, or 500.
    const losers = [respA, respB].filter((_, i) => !cancelledFlags[i]);
    for (const l of losers) {
      assert.ok(
        l.statusCode === 400 || l.statusCode === 409,
        `loser must be 400 or 409, got ${l.statusCode} ${l.body}`,
      );
    }

    // Authoritative DB checks: balance refunded EXACTLY ONCE
    const merchantRow = await queryOne<{ balance: string }>(
      `SELECT balance FROM merchants WHERE id = $1`,
      [merchantId],
    );
    const merchantBal = parseFloat(String(merchantRow?.balance ?? '0'));
    assert.ok(
      Math.abs(merchantBal - escrowAmount) < 1e-6,
      `merchant balance double-credit detected: expected ${escrowAmount}, got ${merchantBal}`,
    );

    // Offer liquidity restored EXACTLY ONCE
    const offerRow = await queryOne<{ available_amount: string }>(
      `SELECT available_amount FROM merchant_offers WHERE id = $1`,
      [offerId],
    );
    const offerAvail = parseFloat(String(offerRow?.available_amount ?? '0'));
    assert.ok(
      Math.abs(offerAvail - escrowAmount) < 1e-6,
      `offer liquidity double-restored: expected ${escrowAmount}, got ${offerAvail}`,
    );

    // Order moved to cancelled, version advanced exactly once
    const order = await queryOne<{ status: string; order_version: number }>(
      `SELECT status, order_version FROM orders WHERE id = $1`,
      [orderId],
    );
    assert.strictEqual(order?.status, 'cancelled', 'order not cancelled');
    assert.strictEqual(Number(order?.order_version), 2, `order_version moved more than once: ${order?.order_version}`);

    // ── Test 3: replay the WINNING key → cached response, no state change ─
    const winningKey = cancelledFlags[0] ? keyA : keyB;
    const replay = await respond(winningKey);
    assert.strictEqual(replay.statusCode, 200, `replay non-200: ${replay.statusCode}`);
    const replayBody = replay.json();
    assert.strictEqual(replayBody?.cancelled, true, 'replay did not return cached cancel response');

    // Balance / offer liquidity unchanged after replay
    const merchantAfter = await queryOne<{ balance: string }>(
      `SELECT balance FROM merchants WHERE id = $1`,
      [merchantId],
    );
    assert.ok(
      Math.abs(parseFloat(String(merchantAfter?.balance ?? '0')) - escrowAmount) < 1e-6,
      'replay caused additional credit',
    );
    const offerAfter = await queryOne<{ available_amount: string }>(
      `SELECT available_amount FROM merchant_offers WHERE id = $1`,
      [offerId],
    );
    assert.ok(
      Math.abs(parseFloat(String(offerAfter?.available_amount ?? '0')) - escrowAmount) < 1e-6,
      'replay caused additional offer liquidity restore',
    );

    console.log('PASS cancel-request respond race — single-credit invariant + idempotency required');
  } finally {
    await app.close().catch(() => {});
    await cleanup();
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
