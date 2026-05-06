/**
 * Dispute confirm/finalize — concurrency integration test.
 *
 * Boots a Fastify instance with the dispute routes, seeds an order in
 * `disputed` status with a `pending_confirmation` dispute, then fires the
 * user's accept and the merchant's accept *concurrently*. Asserts that:
 *
 *   1. exactly one finalize executes (only one response has finalized=true)
 *   2. the user balance is credited at most the escrow amount (no double-credit)
 *   3. dispute.status ends as 'resolved' with the expected resolution
 *   4. order.status ends as 'cancelled' (resolution = 'user') with order_version bumped
 *
 * Skips with a clear message if the local Postgres is unreachable.
 *
 * Run: tsx apps/core-api/tests/disputeConfirmRace.test.ts
 */

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { pool, query as dbQuery, queryOne } from 'settlement-core';
import { disputeRoutes } from '../src/routes/dispute.js';

async function main(): Promise<void> {
  // Probe the database — bail out cleanly if the dev DB is not running so the
  // test does not become a flake in CI environments without a Postgres service.
  try {
    await dbQuery('SELECT 1');
  } catch (err) {
    console.warn(
      '[disputeConfirmRace] SKIP — Postgres not reachable:',
      err instanceof Error ? err.message : String(err)
    );
    process.exit(0);
  }

  const userId = randomUUID();
  const merchantId = randomUUID();
  const orderId = randomUUID();
  const orderNumber = `T-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const escrowAmount = 100; // crypto units (matches numeric(20,6))

  const cleanup = async () => {
    // Order matters: child rows first
    await dbQuery('DELETE FROM order_events WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM outbox_events WHERE (payload->>\'orderId\') = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM disputes WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await dbQuery('DELETE FROM merchants WHERE id = $1', [merchantId]).catch(() => {});
  };

  // Seed fixtures. Wrap in cleanup to keep the dev DB tidy if the test fails midway.
  await cleanup();

  const app = Fastify({ logger: false });
  await app.register(disputeRoutes, { prefix: '/v1' });

  try {
    await dbQuery(
      `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 0, 0)`,
      [userId, `racetest_user_${userId.slice(0, 8)}`]
    );
    await dbQuery(
      `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
       VALUES ($1, $2, 'racetest', 'racetest', 0, 0, 3.67)`,
      [merchantId, `racetest_m_${merchantId.slice(0, 8)}`]
    );
    await dbQuery(
      `INSERT INTO orders (
         id, order_number, user_id, merchant_id, type, payment_method,
         crypto_amount, fiat_amount, rate, status, order_version,
         escrow_debited_entity_type, escrow_debited_entity_id, escrow_debited_amount
       ) VALUES (
         $1, $2, $3, $4, 'buy'::offer_type, 'bank'::payment_method,
         $5, $6, 3.67, 'disputed'::order_status, 1,
         'merchant', $4, $5
       )`,
      [orderId, orderNumber, userId, merchantId, escrowAmount, escrowAmount * 3.67]
    );
    await dbQuery(
      `INSERT INTO disputes (
         order_id, raised_by, raiser_id, reason, status,
         proposed_resolution, user_confirmed, merchant_confirmed
       ) VALUES (
         $1, 'user'::actor_type, $2, 'payment_not_received'::dispute_reason,
         'pending_confirmation'::dispute_status,
         'user', false, false
       )`,
      [orderId, userId]
    );

    // Fire both confirms concurrently. Without the FOR UPDATE locks, both
    // requests would interleave and the user balance would be credited twice.
    //
    // The dispute_confirm route enforces:
    //   - assertActorOwnership: x-actor-id must equal partyId  (defense-in-depth IDOR)
    //   - withIdempotency: Idempotency-Key header is required  (no silent retry)
    // We supply both so the race assertions reflect true behaviour.
    const confirmCall = (party: 'user' | 'merchant', partyId: string, idempKey: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/dispute/confirm`,
        headers: {
          'content-type': 'application/json',
          'x-actor-type': party,
          'x-actor-id': partyId,
          'idempotency-key': idempKey,
        },
        payload: { party, action: 'accept', partyId },
      });

    const [userResp, merchantResp] = await Promise.all([
      confirmCall('user', userId, `race-user-${orderId}`),
      confirmCall('merchant', merchantId, `race-mer-${orderId}`),
    ]);

    const userBody = userResp.json();
    const merchantBody = merchantResp.json();

    // Both responses must be 2xx — the loser of the race is a benign "still pending"
    // observation that flips to a finalize, OR a 409 if it raced past the lock.
    // (We don't assert exact codes; we assert the *combined* effect on the DB.)
    assert(userResp.statusCode < 500, `user response 5xx: ${userResp.statusCode} ${userResp.body}`);
    assert(merchantResp.statusCode < 500, `merchant response 5xx: ${merchantResp.statusCode} ${merchantResp.body}`);

    const finalizedFlags = [
      userBody?.data?.finalized === true,
      merchantBody?.data?.finalized === true,
    ];
    const finalizedCount = finalizedFlags.filter(Boolean).length;
    assert.strictEqual(
      finalizedCount,
      1,
      `expected exactly one finalize, got ${finalizedCount} — user=${JSON.stringify(userBody)} merchant=${JSON.stringify(merchantBody)}`
    );

    // Authoritative DB state checks
    const dispute = await queryOne<{ status: string; resolution: string }>(
      `SELECT status, resolution FROM disputes WHERE order_id = $1`,
      [orderId]
    );
    assert.strictEqual(dispute?.status, 'resolved', 'dispute did not finalize');
    assert.strictEqual(dispute?.resolution, 'user', 'wrong resolution stored');

    const order = await queryOne<{ status: string; order_version: number }>(
      `SELECT status, order_version FROM orders WHERE id = $1`,
      [orderId]
    );
    assert.strictEqual(order?.status, 'cancelled', 'order did not transition to cancelled');
    assert.strictEqual(
      Number(order?.order_version),
      2,
      `order_version should advance exactly once; got ${order?.order_version}`
    );

    // Balance must be credited the escrow amount EXACTLY ONCE.
    const userRow = await queryOne<{ balance: string }>(
      `SELECT balance FROM users WHERE id = $1`,
      [userId]
    );
    const merchantRow = await queryOne<{ balance: string }>(
      `SELECT balance FROM merchants WHERE id = $1`,
      [merchantId]
    );
    const userBal = parseFloat(String(userRow?.balance ?? '0'));
    const merchantBal = parseFloat(String(merchantRow?.balance ?? '0'));

    assert.ok(
      Math.abs(userBal - escrowAmount) < 1e-6,
      `user balance double-credit detected: expected ${escrowAmount}, got ${userBal}`
    );
    assert.strictEqual(merchantBal, 0, `merchant balance unexpectedly credited: ${merchantBal}`);

    // A repeat confirm after finalize must NOT touch balances again.
    // Use a fresh idempotency key so we exercise the post-finalize guard, not
    // the cached-response short-circuit.
    const replay = await confirmCall('user', userId, `race-user-replay-${orderId}`);
    const replayBody = replay.json();
    assert.ok(
      replay.statusCode === 400 || replay.statusCode === 409 || replayBody?.data?.finalized === true,
      `unexpected replay response: ${replay.statusCode} ${replay.body}`
    );
    const userRowAfter = await queryOne<{ balance: string }>(
      `SELECT balance FROM users WHERE id = $1`,
      [userId]
    );
    assert.ok(
      Math.abs(parseFloat(String(userRowAfter?.balance ?? '0')) - escrowAmount) < 1e-6,
      'replay caused additional credit'
    );

    console.log('PASS dispute confirm/finalize race — single-credit invariant holds');
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
