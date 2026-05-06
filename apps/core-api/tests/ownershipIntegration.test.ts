/**
 * Ownership assertions — end-to-end IDOR coverage.
 *
 * Boots Fastify with the actual conversion / dispute / orders plugins,
 * seeds minimal fixtures, then for each protected route asserts:
 *
 *   1. Mismatched x-actor-id (attacker spoofs body but not header)         → 403
 *   2. Missing  x-actor-id  (no signed identity at all)                    → 403
 *   3. Mismatched x-actor-type (correct id but wrong role)                 → 403  (where applicable)
 *   4. Matching  headers   (legitimate caller)                              → 2xx
 *
 * Also verifies that NO balance / dispute / order mutation occurred during
 * the rejection cases — the assertion must run BEFORE any DB write.
 *
 * Skips with a clear message if the local Postgres is unreachable.
 *
 * Run: tsx apps/core-api/tests/ownershipIntegration.test.ts
 */

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { pool, query as dbQuery, queryOne } from 'settlement-core';
import { conversionRoutes } from '../src/routes/conversion.js';
import { disputeRoutes } from '../src/routes/dispute.js';
import { orderRoutes } from '../src/routes/orders.js';

let passed = 0;
const check = (name: string, cond: boolean, ctx?: unknown) => {
  if (!cond) {
    console.error(`FAIL: ${name}`, ctx ?? '');
    process.exit(1);
  }
  console.log(`  ✓ ${name}`);
  passed++;
};

async function main(): Promise<void> {
  try {
    await dbQuery('SELECT 1');
  } catch (err) {
    console.warn(
      '[ownershipIntegration] SKIP — Postgres not reachable:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(0);
  }

  const userId = randomUUID();
  const merchantId = randomUUID();
  const attackerId = randomUUID();
  const orderId = randomUUID();
  const orderNumber = `OWN-${Date.now().toString().slice(-9)}-${Math.floor(Math.random() * 1000)}`;

  const cleanup = async () => {
    await dbQuery('DELETE FROM order_events WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM notification_outbox WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM outbox_events WHERE (payload->>\'orderId\') = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM idempotency_log WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM disputes WHERE order_id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id = $1 OR id = $2', [userId, attackerId]).catch(() => {});
    await dbQuery('DELETE FROM merchants WHERE id = $1', [merchantId]).catch(() => {});
  };

  await cleanup();

  // ── Fixtures ──
  // The conversion route only requires the account row; orders/disputes need
  // a fully-formed order in 'escrowed' status.
  await dbQuery(
    `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 1000, 0)`,
    [userId, `own_user_${userId.slice(0, 8)}`],
  );
  await dbQuery(
    `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 0, 0)`,
    [attackerId, `own_attacker_${attackerId.slice(0, 8)}`],
  );
  await dbQuery(
    `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
     VALUES ($1, $2, 'own', 'own', 0, 0, 3.67)`,
    [merchantId, `own_m_${merchantId.slice(0, 8)}`],
  );
  await dbQuery(
    `INSERT INTO orders (
       id, order_number, user_id, merchant_id, type, payment_method,
       crypto_amount, fiat_amount, rate, status, order_version
     ) VALUES (
       $1, $2, $3, $4, 'buy'::offer_type, 'bank'::payment_method,
       50, 50, 3.67, 'escrowed'::order_status, 1
     )`,
    [orderId, orderNumber, userId, merchantId],
  );

  const app = Fastify({ logger: false });
  await app.register(conversionRoutes, { prefix: '/v1' });
  await app.register(disputeRoutes, { prefix: '/v1' });
  await app.register(orderRoutes, { prefix: '/v1' });

  try {
    // ── Helper to fetch user balance for "no mutation occurred" assertions ──
    const getUserBalance = async (id: string) => {
      const row = await queryOne<{ balance: string }>(
        'SELECT balance FROM users WHERE id = $1',
        [id],
      );
      return parseFloat(String(row?.balance ?? '0'));
    };

    const initialUserBal = await getUserBalance(userId);
    const initialAttackerBal = await getUserBalance(attackerId);

    // ────────────────────────────────────────────────────────────────────
    //  conversion.ts — POST /v1/convert/usdt-to-sinr
    // ────────────────────────────────────────────────────────────────────
    console.log('\nconversion.ts — usdt-to-sinr');

    // 1. Attacker spoofs body.account_id (header is attacker, body is victim)
    const convSpoof = await app.inject({
      method: 'POST',
      url: '/v1/convert/usdt-to-sinr',
      headers: {
        'content-type': 'application/json',
        'x-actor-id': attackerId,
        'x-actor-type': 'user',
      },
      payload: { account_type: 'user', account_id: userId, amount: 1_000_000 },
    });
    check(
      'convert: header=attacker, body=victim → 403',
      convSpoof.statusCode === 403,
      { code: convSpoof.statusCode, body: convSpoof.body },
    );
    check(
      'convert: spoofed call did NOT touch victim balance',
      Math.abs((await getUserBalance(userId)) - initialUserBal) < 1e-6,
    );
    check(
      'convert: spoofed call did NOT touch attacker balance',
      Math.abs((await getUserBalance(attackerId)) - initialAttackerBal) < 1e-6,
    );

    // 2. No header at all
    const convNoHeader = await app.inject({
      method: 'POST',
      url: '/v1/convert/usdt-to-sinr',
      headers: { 'content-type': 'application/json' },
      payload: { account_type: 'user', account_id: userId, amount: 1_000_000 },
    });
    check('convert: missing x-actor-id → 403', convNoHeader.statusCode === 403);

    // 3. Type mismatch (id matches, type differs)
    const convTypeMismatch = await app.inject({
      method: 'POST',
      url: '/v1/convert/usdt-to-sinr',
      headers: {
        'content-type': 'application/json',
        'x-actor-id': userId,
        'x-actor-type': 'merchant', // body says 'user'
      },
      payload: { account_type: 'user', account_id: userId, amount: 1_000_000 },
    });
    check('convert: actor-type mismatch → 403', convTypeMismatch.statusCode === 403);

    // 4. Matching headers — legitimate call (route reaches the txn; we don't
    //    assert success since synthetic_rate / exposure may not be configured
    //    in the local seed. We just verify it does NOT 403.)
    const convOk = await app.inject({
      method: 'POST',
      url: '/v1/convert/usdt-to-sinr',
      headers: {
        'content-type': 'application/json',
        'x-actor-id': userId,
        'x-actor-type': 'user',
      },
      payload: { account_type: 'user', account_id: userId, amount: 1_000_000 },
    });
    check(
      'convert: matching headers → not 403 (ownership passed)',
      convOk.statusCode !== 403,
      { code: convOk.statusCode, body: convOk.body },
    );

    // ────────────────────────────────────────────────────────────────────
    //  dispute.ts — POST /v1/orders/:id/dispute (open)
    // ────────────────────────────────────────────────────────────────────
    console.log('\ndispute.ts — open');

    const openSpoof = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/dispute`,
      headers: {
        'content-type': 'application/json',
        'x-actor-id': attackerId,
        'x-actor-type': 'user',
      },
      payload: {
        reason: 'payment_not_received',
        description: '',
        initiated_by: 'user',
        actor_id: userId, // attacker-controlled body claiming to be victim
      },
    });
    check(
      'dispute open: header=attacker, body=victim → 403',
      openSpoof.statusCode === 403,
      { code: openSpoof.statusCode, body: openSpoof.body },
    );

    const openCount = await queryOne<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM disputes WHERE order_id = $1',
      [orderId],
    );
    check(
      'dispute open: spoofed call created NO dispute row',
      openCount?.n === '0',
      { count: openCount?.n },
    );

    const openNoHeader = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/dispute`,
      headers: { 'content-type': 'application/json' },
      payload: {
        reason: 'payment_not_received',
        description: '',
        initiated_by: 'user',
        actor_id: userId,
      },
    });
    check('dispute open: missing x-actor-id → 403', openNoHeader.statusCode === 403);

    // Legitimate open — Idempotency-Key required by withIdempotency.
    const openOk = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/dispute`,
      headers: {
        'content-type': 'application/json',
        'x-actor-id': userId,
        'x-actor-type': 'user',
        'idempotency-key': `test-open-${orderId}`,
      },
      payload: {
        reason: 'payment_not_received',
        description: '',
        initiated_by: 'user',
        actor_id: userId,
      },
    });
    check(
      'dispute open: matching headers → 2xx',
      openOk.statusCode === 200,
      { code: openOk.statusCode, body: openOk.body },
    );

    // Manually set dispute to pending_confirmation (skipping the staff
    // workflow that would normally do this) so we can exercise confirm.
    await dbQuery(
      `UPDATE disputes
       SET status = 'pending_confirmation'::dispute_status,
           proposed_resolution = 'user',
           user_confirmed = false,
           merchant_confirmed = false
       WHERE order_id = $1`,
      [orderId],
    );
    await dbQuery(
      `UPDATE orders SET status = 'disputed'::order_status WHERE id = $1`,
      [orderId],
    );

    // ────────────────────────────────────────────────────────────────────
    //  dispute.ts — POST /v1/orders/:id/dispute/confirm
    // ────────────────────────────────────────────────────────────────────
    console.log('\ndispute.ts — confirm');

    const confirmSpoof = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/dispute/confirm`,
      headers: {
        'content-type': 'application/json',
        'x-actor-id': attackerId,
        'x-actor-type': 'user',
      },
      payload: { party: 'user', action: 'accept', partyId: userId },
    });
    check(
      'dispute confirm: header=attacker, body=victim → 403',
      confirmSpoof.statusCode === 403,
    );

    const flagsAfterSpoof = await queryOne<{
      user_confirmed: boolean;
      merchant_confirmed: boolean;
      status: string;
    }>(
      'SELECT user_confirmed, merchant_confirmed, status FROM disputes WHERE order_id = $1',
      [orderId],
    );
    check(
      'dispute confirm: spoofed call did NOT flip user_confirmed',
      flagsAfterSpoof?.user_confirmed === false,
    );

    const confirmTypeMismatch = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/dispute/confirm`,
      headers: {
        'content-type': 'application/json',
        'x-actor-id': userId,
        'x-actor-type': 'merchant', // body says 'user'
      },
      payload: { party: 'user', action: 'accept', partyId: userId },
    });
    check('dispute confirm: actor-type mismatch → 403', confirmTypeMismatch.statusCode === 403);

    const confirmOk = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/dispute/confirm`,
      headers: {
        'content-type': 'application/json',
        'x-actor-id': userId,
        'x-actor-type': 'user',
        'idempotency-key': `test-confirm-${orderId}`,
      },
      payload: { party: 'user', action: 'accept', partyId: userId },
    });
    check(
      'dispute confirm: matching headers → 2xx',
      confirmOk.statusCode === 200,
      { code: confirmOk.statusCode, body: confirmOk.body },
    );

    // ────────────────────────────────────────────────────────────────────
    //  orders.ts — GET /v1/orders/:id
    // ────────────────────────────────────────────────────────────────────
    console.log('\norders.ts — GET /v1/orders/:id');

    const getSpoof = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: { 'x-actor-id': attackerId, 'x-actor-type': 'user' },
    });
    check('order GET: non-participant → 403', getSpoof.statusCode === 403);

    const getNoHeader = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
    });
    check('order GET: missing x-actor-id → 403', getNoHeader.statusCode === 403);

    const getOkUser = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: { 'x-actor-id': userId, 'x-actor-type': 'user' },
    });
    check(
      'order GET: user participant → 200',
      getOkUser.statusCode === 200,
      { code: getOkUser.statusCode, body: getOkUser.body },
    );

    const getOkMerchant = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: { 'x-actor-id': merchantId, 'x-actor-type': 'merchant' },
    });
    check(
      'order GET: merchant participant → 200',
      getOkMerchant.statusCode === 200,
    );

    // 404 path still shouldn't leak — non-existent order with non-participant
    // header should 404 (order missing) before any ownership check, since the
    // route can't derive owners without the row.
    const getMissing = await app.inject({
      method: 'GET',
      url: `/v1/orders/${randomUUID()}`,
      headers: { 'x-actor-id': attackerId, 'x-actor-type': 'user' },
    });
    check('order GET: nonexistent order → 404', getMissing.statusCode === 404);

    console.log(`\nPASS — ${passed} ownership integration checks`);
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
