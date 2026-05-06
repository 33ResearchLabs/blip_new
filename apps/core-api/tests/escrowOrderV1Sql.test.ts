/**
 * SQL-layer hardening test for escrow_order_v1().
 *
 * The core-api route at apps/core-api/src/routes/escrow.ts already does
 * server-side seller derivation BEFORE invoking the stored procedure, so the
 * proxy path is safe today. This test covers the OTHER direction: any caller
 * that reaches the SQL function directly (debug endpoint, admin script, future
 * route, or a regression in the route's pre-check) must still be rejected by
 * the function itself.
 *
 * Specifically, this re-litigates the exact bugs migration 112 fixed:
 *   1. Caller claims to be merchant but order's seller is user → 403 / WRONG_ESCROW_PARTY.
 *   2. Caller passes a real merchant id that isn't this order's seller → 403.
 *   3. 'pending' real-user order → ORDER_NOT_ACCEPTED (no Mine/Accept skip).
 *   4. Idempotent re-call → ALREADY_ESCROWED (no second debit).
 *   5. escrow_debited_entity_id reflects the SERVER-DERIVED seller, not p_actor_id.
 *   6. Mock-mode deduction follows the server-derived seller, not the caller.
 *
 * Skips when DATABASE_URL / local Postgres is unavailable.
 *
 * Run: tsx apps/core-api/tests/escrowOrderV1Sql.test.ts
 */

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query as dbQuery, queryOne } from 'settlement-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../settle/database/migrations/112_escrow_v1_restore_seller_validation.sql',
);

let passed = 0;
const check = (name: string, cond: boolean, ctx?: unknown) => {
  if (!cond) {
    console.error(`FAIL: ${name}`, ctx ?? '');
    process.exit(1);
  }
  console.log(`  ✓ ${name}`);
  passed++;
};

interface ProcResult {
  success: boolean;
  error?: string;
  detail?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order?: any;
  old_status?: string;
}

async function callEscrow(args: {
  orderId: string;
  txHash: string;
  actorType: 'user' | 'merchant';
  actorId: string;
  mockMode: boolean;
}): Promise<ProcResult> {
  const row = await queryOne<{ escrow_order_v1: ProcResult }>(
    'SELECT escrow_order_v1($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,$5) AS escrow_order_v1',
    [args.orderId, args.txHash, args.actorType, args.actorId, args.mockMode],
  );
  return row!.escrow_order_v1;
}

async function main(): Promise<void> {
  try {
    await dbQuery('SELECT 1');
  } catch (err) {
    console.warn(
      '[escrowOrderV1Sql] SKIP — Postgres not reachable:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(0);
  }

  // Apply migration 112 in case the local DB still has 081's broken version.
  // The migration is idempotent (CREATE OR REPLACE FUNCTION + a UPDATE that
  // only touches mismatched rows), so re-running is safe.
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  await dbQuery(migrationSql);

  // ── Fixtures ──
  const orderNumPrefix = `EOV-${Date.now().toString().slice(-7)}`;
  const userId = randomUUID();
  const realUserId = randomUUID();
  const sellerMerchantId = randomUUID();
  const otherMerchantId = randomUUID();
  const buyOrderId = randomUUID();           // non-M2M buy: merchant is seller
  const sellOrderRealUserId = randomUUID();  // non-M2M sell, real user, status=accepted
  const sellOrderPendingId = randomUUID();   // non-M2M sell, real user, status=pending (must reject)
  const sellOrderPlaceholderId = randomUUID(); // sell, placeholder user, status=pending (allowed)
  const m2mOrderId = randomUUID();           // M2M: merchant_id is seller

  const cleanup = async () => {
    const ids = [
      buyOrderId, sellOrderRealUserId, sellOrderPendingId,
      sellOrderPlaceholderId, m2mOrderId,
    ];
    await dbQuery('DELETE FROM order_events WHERE order_id = ANY($1)', [ids]).catch(() => {});
    await dbQuery('DELETE FROM ledger_entries WHERE order_id = ANY($1)', [ids]).catch(() => {});
    await dbQuery('DELETE FROM orders WHERE id = ANY($1)', [ids]).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id IN ($1,$2,$3)', [userId, realUserId, randomUUID()]).catch(() => {});
    await dbQuery('DELETE FROM merchants WHERE id IN ($1,$2)', [sellerMerchantId, otherMerchantId]).catch(() => {});
  };
  await cleanup();

  // Users: a placeholder one, and a real one
  await dbQuery(
    `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 500, 0)`,
    [userId, `open_order_${userId.slice(0, 8)}`], // placeholder
  );
  await dbQuery(
    `INSERT INTO users (id, username, balance, sinr_balance) VALUES ($1, $2, 1000, 0)`,
    [realUserId, `real_${realUserId.slice(0, 8)}`],
  );
  await dbQuery(
    `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
     VALUES ($1, $2, 'a', 'a', 1000, 0, 3.67)`,
    [sellerMerchantId, `m_${sellerMerchantId.slice(0, 8)}`],
  );
  await dbQuery(
    `INSERT INTO merchants (id, username, business_name, display_name, balance, sinr_balance, synthetic_rate)
     VALUES ($1, $2, 'b', 'b', 1000, 0, 3.67)`,
    [otherMerchantId, `m_${otherMerchantId.slice(0, 8)}`],
  );

  // Orders. All in 'accepted' unless noted.
  await dbQuery(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method,
       crypto_amount, fiat_amount, rate, status, order_version)
     VALUES ($1, $2, $3, $4, 'buy', 'bank', 50, 50, 3.67, 'accepted', 1)`,
    [buyOrderId, `${orderNumPrefix}-1`, realUserId, sellerMerchantId],
  );
  await dbQuery(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method,
       crypto_amount, fiat_amount, rate, status, order_version)
     VALUES ($1, $2, $3, $4, 'sell', 'bank', 75, 75, 3.67, 'accepted', 1)`,
    [sellOrderRealUserId, `${orderNumPrefix}-2`, realUserId, sellerMerchantId],
  );
  await dbQuery(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method,
       crypto_amount, fiat_amount, rate, status, order_version)
     VALUES ($1, $2, $3, $4, 'sell', 'bank', 75, 75, 3.67, 'pending', 1)`,
    [sellOrderPendingId, `${orderNumPrefix}-3`, realUserId, sellerMerchantId],
  );
  await dbQuery(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, type, payment_method,
       crypto_amount, fiat_amount, rate, status, order_version)
     VALUES ($1, $2, $3, $4, 'sell', 'bank', 30, 30, 3.67, 'pending', 1)`,
    [sellOrderPlaceholderId, `${orderNumPrefix}-4`, userId, sellerMerchantId],
  );
  await dbQuery(
    `INSERT INTO orders (id, order_number, user_id, merchant_id, buyer_merchant_id, type, payment_method,
       crypto_amount, fiat_amount, rate, status, order_version)
     VALUES ($1, $2, $3, $4, $5, 'buy', 'bank', 100, 100, 3.67, 'accepted', 1)`,
    [m2mOrderId, `${orderNumPrefix}-5`, userId, sellerMerchantId, otherMerchantId],
  );

  try {
    console.log('escrow_order_v1 — SQL-layer hardening checks');

    // 1. Wrong-party rejection: non-M2M buy, seller is merchant, caller is the user
    const wrongParty = await callEscrow({
      orderId: buyOrderId, txHash: 'tx-attacker-1',
      actorType: 'user', actorId: realUserId, mockMode: true,
    });
    check(
      'non-M2M buy: caller=user (not seller) → WRONG_ESCROW_PARTY',
      wrongParty.success === false && wrongParty.error === 'WRONG_ESCROW_PARTY',
      wrongParty,
    );
    const buyAfter = await queryOne<{ escrow_tx_hash: string | null; escrow_debited_entity_id: string | null }>(
      'SELECT escrow_tx_hash, escrow_debited_entity_id FROM orders WHERE id = $1', [buyOrderId],
    );
    check('rejected call did NOT mark order escrowed', buyAfter?.escrow_tx_hash === null);
    check('rejected call did NOT set debited entity', buyAfter?.escrow_debited_entity_id === null);

    // 2. Wrong merchant: caller is some other real merchant, not the order's merchant_id
    const wrongMerchant = await callEscrow({
      orderId: buyOrderId, txHash: 'tx-attacker-2',
      actorType: 'merchant', actorId: otherMerchantId, mockMode: true,
    });
    check(
      'non-M2M buy: caller=other merchant → WRONG_ESCROW_PARTY',
      wrongMerchant.success === false && wrongMerchant.error === 'WRONG_ESCROW_PARTY',
    );

    // 3. Real-user 'pending' status must be rejected — no Mine/Accept skip
    const pendingReject = await callEscrow({
      orderId: sellOrderPendingId, txHash: 'tx-pending',
      actorType: 'user', actorId: realUserId, mockMode: true,
    });
    check(
      'real user, pending sell → ORDER_NOT_ACCEPTED',
      pendingReject.success === false && pendingReject.error === 'ORDER_NOT_ACCEPTED',
      pendingReject,
    );

    // 4. Placeholder user (open_order_*) at 'pending' is allowed
    const placeholderOk = await callEscrow({
      orderId: sellOrderPlaceholderId, txHash: 'tx-placeholder',
      actorType: 'user', actorId: userId, mockMode: true,
    });
    check(
      'placeholder user, pending sell → success',
      placeholderOk.success === true,
      placeholderOk,
    );

    // 5. Happy path: seller locks escrow on non-M2M buy. Verify
    //    escrow_debited_entity reflects the SERVER-DERIVED seller.
    const happy = await callEscrow({
      orderId: buyOrderId, txHash: 'tx-happy',
      actorType: 'merchant', actorId: sellerMerchantId, mockMode: true,
    });
    check('happy path: returns success', happy.success === true, happy);

    const happyRow = await queryOne<{
      escrow_debited_entity_id: string;
      escrow_debited_entity_type: string;
      status: string;
    }>(
      'SELECT escrow_debited_entity_id, escrow_debited_entity_type, status FROM orders WHERE id = $1',
      [buyOrderId],
    );
    check(
      'escrow_debited_entity_id = server-derived seller (merchant)',
      happyRow?.escrow_debited_entity_id === sellerMerchantId,
    );
    check(
      'escrow_debited_entity_type = "merchant"',
      happyRow?.escrow_debited_entity_type === 'merchant',
    );
    check('order status now = "escrowed"', happyRow?.status === 'escrowed');

    // 6. Idempotency: a second call (any caller) is rejected as ALREADY_ESCROWED
    const second = await callEscrow({
      orderId: buyOrderId, txHash: 'tx-attacker-replay',
      actorType: 'user', actorId: realUserId, mockMode: true,
    });
    check(
      'second call → ALREADY_ESCROWED, no double-debit',
      second.success === false && second.error === 'ALREADY_ESCROWED',
    );

    // 7. M2M: merchant_id is ALWAYS seller. buyer_merchant_id calling is rejected.
    const m2mWrong = await callEscrow({
      orderId: m2mOrderId, txHash: 'tx-m2m-wrong',
      actorType: 'merchant', actorId: otherMerchantId, mockMode: true,
    });
    check(
      'M2M: buyer_merchant_id calling lock → WRONG_ESCROW_PARTY',
      m2mWrong.success === false && m2mWrong.error === 'WRONG_ESCROW_PARTY',
    );
    const m2mOk = await callEscrow({
      orderId: m2mOrderId, txHash: 'tx-m2m-ok',
      actorType: 'merchant', actorId: sellerMerchantId, mockMode: true,
    });
    check('M2M: merchant_id (seller) → success', m2mOk.success === true, m2mOk);

    // 8. Mock-mode deduction follows the SERVER-DERIVED seller. We just locked
    //    50 USDT from sellerMerchantId on buyOrderId and 100 USDT on m2mOrderId.
    //    Starting balance was 1000 → expect 850.
    const mBal = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1', [sellerMerchantId],
    );
    const remaining = parseFloat(String(mBal?.balance ?? '0'));
    check(
      'mock-mode deducted from server-derived seller (1000 - 50 - 100 = 850)',
      Math.abs(remaining - 850) < 1e-6,
      { remaining },
    );
    // The "other merchant" (buyer in M2M) was never touched.
    const otherBal = await queryOne<{ balance: string }>(
      'SELECT balance FROM merchants WHERE id = $1', [otherMerchantId],
    );
    check(
      'mock-mode did NOT deduct from buyer_merchant_id (still 1000)',
      Math.abs(parseFloat(String(otherBal?.balance ?? '0')) - 1000) < 1e-6,
    );

    console.log(`\nPASS — ${passed} escrow_order_v1 SQL-hardening checks`);
  } finally {
    await cleanup();
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
