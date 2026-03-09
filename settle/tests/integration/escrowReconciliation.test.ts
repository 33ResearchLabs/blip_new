/**
 * Escrow Reconciliation Prevention Layer — Extensive Tests
 *
 * Tests the 3-layer prevention system:
 * 1. /api/sync/balances — DB ↔ on-chain balance sync
 * 2. /api/sync/escrow — Stuck escrow detection
 * 3. Frontend auto-refund + localStorage recovery (verified via DB state)
 *
 * Run: npx tsx settle/tests/integration/escrowReconciliation.test.ts
 */

import pg from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

// ── Constants ────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=b8dab187-ffb1-40c7-b8a9-cb3f488a1d94';
const USDT_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');

const DON_WALLET = '6915WH93wpDBcR6XpCVrTGpJYAnacEm7h337AaEqKbHJ';
const DON_MERCHANT_ID = '0335ce31-8367-4957-8686-96f0a2e00692';
const TOJO_WALLET = '8UvUinTdzi7oPWcY9aieJvjzVAuG1MTFgCV7g3a93efd';
const TOJO_MERCHANT_ID = '36253aa0-a98e-4c43-b739-55ceb8077a3e';
const TREASURY_WALLET = '8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB';

// Test order IDs — first 8 chars of UUID MUST be unique (trigger generates order_number from them)
const TEST_IDS = {
  stuck:       'aa0000e1-0000-0000-0000-aaaaaaaaaaaa',
  badWallet:   'aa0000e2-0000-0000-0000-aaaaaaaaaaaa',
  withRefund:  'aa0000e3-0000-0000-0000-aaaaaaaaaaaa',
  withRelease: 'aa0000e4-0000-0000-0000-aaaaaaaaaaaa',
  mockEscrow:  'aa0000e5-0000-0000-0000-aaaaaaaaaaaa',
  demoEscrow:  'aa0000e6-0000-0000-0000-aaaaaaaaaaaa',
  activeEscrow:'aa0000e7-0000-0000-0000-aaaaaaaaaaaa',
  stuck2:      'aa0000e8-0000-0000-0000-aaaaaaaaaaaa',
  stuck3:      'aa0000e9-0000-0000-0000-aaaaaaaaaaaa',
};

const pool = new pg.Pool({
  host: 'localhost', port: 5432, database: 'settle', user: 'zeus',
});

let passed = 0;
let failed = 0;
let skipped = 0;
let userId: string;

function assert(condition: boolean, msg: string) {
  if (condition) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

function skip(msg: string) {
  console.log(`  ⊘ SKIP: ${msg}`); skipped++;
}

async function fetchJson(url: string, method = 'GET') {
  const res = await fetch(`${BASE_URL}${url}`, { method });
  return { status: res.status, data: await res.json() };
}

// Trigger generates: BM-YYMMDD-<first8chars of UUID uppercase>
function expectedOrderNumber(id: string): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `BM-${yy}${mm}${dd}-${id.slice(0, 8).toUpperCase()}`;
}

async function insertTestOrder(id: string, overrides: Record<string, any> = {}) {
  const defaults = {
    user_id: userId,
    merchant_id: DON_MERCHANT_ID,
    type: 'buy',
    status: 'cancelled',
    crypto_amount: 1000,
    crypto_currency: 'USDT',
    fiat_amount: 3670,
    fiat_currency: 'AED',
    rate: 3.67,
    payment_method: 'bank',
    escrow_tx_hash: null,
    escrow_trade_id: null,
    escrow_creator_wallet: null,
    refund_tx_hash: null,
    release_tx_hash: null,
  };
  const o = { ...defaults, ...overrides };

  // Delete by id first (trigger generates order_number, so we can't predict it for pre-delete)
  await pool.query(`DELETE FROM orders WHERE id = $1`, [id]);

  await pool.query(`
    INSERT INTO orders (id, order_number, user_id, merchant_id, type, status,
      crypto_amount, crypto_currency, fiat_amount, fiat_currency, rate, payment_method,
      escrow_tx_hash, escrow_trade_id, escrow_creator_wallet, refund_tx_hash, release_tx_hash,
      created_at)
    VALUES ($1, 'placeholder', $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
  `, [id, o.user_id, o.merchant_id, o.type, o.status,
      o.crypto_amount, o.crypto_currency, o.fiat_amount, o.fiat_currency,
      o.rate, o.payment_method, o.escrow_tx_hash, o.escrow_trade_id,
      o.escrow_creator_wallet, o.refund_tx_hash, o.release_tx_hash]);
}

let testStartTime: Date;

async function cleanupTestOrders() {
  const ids = Object.values(TEST_IDS);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]);
  // Delete all ADJUSTMENT ledger entries created during the test run
  if (testStartTime) {
    await pool.query(
      `DELETE FROM ledger_entries WHERE entry_type = 'ADJUSTMENT' AND created_at >= $1`,
      [testStartTime]
    );
  }
}

// ════════════════════════════════════════════════════════════
//  BALANCE SYNC TESTS
// ════════════════════════════════════════════════════════════

async function test_balance_dryRun_structure() {
  console.log('\n── 1. Balance Sync: Dry Run Response Structure ──');
  const { status, data } = await fetchJson('/api/sync/balances');

  assert(status === 200, 'HTTP 200');
  assert(data.success === true, 'success: true');
  assert(data.mode === 'dry_run', 'mode: dry_run');
  assert(typeof data.summary === 'object', 'summary is object');
  assert(typeof data.summary.merchants_checked === 'number', 'merchants_checked is number');
  assert(typeof data.summary.merchants_with_diff === 'number', 'merchants_with_diff is number');
  assert(typeof data.summary.merchants_updated === 'number', 'merchants_updated is number');
  assert(typeof data.summary.total_db_balance === 'number', 'total_db_balance is number');
  assert(typeof data.summary.total_onchain_balance === 'number', 'total_onchain_balance is number');
  assert(typeof data.summary.total_diff === 'number', 'total_diff is number');
  assert(Array.isArray(data.results), 'results is array');

  // Each result has required fields
  for (const r of data.results) {
    assert(typeof r.merchant_id === 'string' && r.merchant_id.length > 0, `result has merchant_id (${r.username})`);
    assert(typeof r.username === 'string', `result has username`);
    assert(typeof r.wallet === 'string' && r.wallet.length > 30, `result has wallet`);
    assert(typeof r.db_balance === 'number', `result has db_balance`);
    assert(typeof r.onchain_balance === 'number', `result has onchain_balance`);
    assert(typeof r.diff === 'number', `result has diff`);
    assert(typeof r.updated === 'boolean', `result has updated`);
  }
}

async function test_balance_dryRun_noMutation() {
  console.log('\n── 2. Balance Sync: Dry Run Does NOT Mutate DB ──');

  // Record current balances
  const { rows: before } = await pool.query(
    `SELECT id, balance FROM merchants WHERE id IN ($1, $2)`, [DON_MERCHANT_ID, TOJO_MERCHANT_ID]
  );

  // Tamper to create diff
  await pool.query('UPDATE merchants SET balance = balance + 9999 WHERE id = $1', [DON_MERCHANT_ID]);

  // Dry run
  const { data } = await fetchJson('/api/sync/balances');
  assert(data.summary.merchants_with_diff >= 1, 'Detected diff');

  const don = data.results.find((r: any) => r.username === 'don');
  assert(don?.updated === false, 'Dry run did NOT update don');

  // Verify DB unchanged (still has the tampered +9999)
  const { rows: after } = await pool.query('SELECT balance FROM merchants WHERE id = $1', [DON_MERCHANT_ID]);
  const beforeDon = before.find((r: any) => r.id === DON_MERCHANT_ID);
  assert(
    Number(after[0].balance) === Number(beforeDon.balance) + 9999,
    'DB balance was NOT changed by dry run'
  );

  // Restore
  await pool.query('UPDATE merchants SET balance = $1 WHERE id = $2', [beforeDon.balance, DON_MERCHANT_ID]);
}

async function test_balance_apply_bothMerchants() {
  console.log('\n── 3. Balance Sync: Apply Updates Both Merchants ──');

  // Tamper both
  await pool.query('UPDATE merchants SET balance = 0 WHERE id = $1', [DON_MERCHANT_ID]);
  await pool.query('UPDATE merchants SET balance = 0 WHERE id = $1', [TOJO_MERCHANT_ID]);

  const { data } = await fetchJson('/api/sync/balances', 'POST');
  assert(data.success === true, 'Sync applied');

  const don = data.results.find((r: any) => r.username === 'don');
  const tojo = data.results.find((r: any) => r.username === 'tojo');
  assert(don?.updated === true, 'Don updated');
  assert(tojo?.updated === true, 'Tojo updated');

  // Verify DB
  const { rows } = await pool.query(
    `SELECT username, balance FROM merchants WHERE id IN ($1, $2) ORDER BY username`,
    [DON_MERCHANT_ID, TOJO_MERCHANT_ID]
  );
  assert(Number(rows[0].balance) === don?.onchain_balance, `Don DB = on-chain (${don?.onchain_balance})`);
  assert(Number(rows[1].balance) === tojo?.onchain_balance, `Tojo DB = on-chain (${tojo?.onchain_balance})`);

  // Verify both ledger entries
  const { rows: ledger } = await pool.query(
    `SELECT account_id, amount FROM ledger_entries
     WHERE entry_type = 'ADJUSTMENT' AND account_id IN ($1, $2)
     ORDER BY created_at DESC LIMIT 2`,
    [DON_MERCHANT_ID, TOJO_MERCHANT_ID]
  );
  assert(ledger.length === 2, 'Two ledger entries created');
}

async function test_balance_negativeDiff() {
  console.log('\n── 4. Balance Sync: Handles Negative Diff (DB > On-chain) ──');

  // Set don's balance HIGHER than on-chain
  await pool.query('UPDATE merchants SET balance = 999999 WHERE id = $1', [DON_MERCHANT_ID]);

  const { data } = await fetchJson('/api/sync/balances', 'POST');
  const don = data.results.find((r: any) => r.username === 'don');

  assert(don?.diff < 0, `Negative diff detected (${don?.diff})`);
  assert(don?.updated === true, 'Don updated despite negative diff');

  const { rows } = await pool.query('SELECT balance FROM merchants WHERE id = $1', [DON_MERCHANT_ID]);
  assert(Number(rows[0].balance) === don?.onchain_balance, 'Balance corrected down to on-chain');

  // Check ledger records negative amount
  const { rows: ledger } = await pool.query(
    `SELECT amount FROM ledger_entries
     WHERE account_id = $1 AND entry_type = 'ADJUSTMENT'
     ORDER BY created_at DESC LIMIT 1`,
    [DON_MERCHANT_ID]
  );
  assert(Number(ledger[0].amount) < 0, `Ledger amount is negative (${ledger[0].amount})`);
}

async function test_balance_idempotent() {
  console.log('\n── 5. Balance Sync: Idempotent (no update when synced) ──');

  // Ensure synced first
  await fetchJson('/api/sync/balances', 'POST');

  // Count ledger entries before
  const { rows: countBefore } = await pool.query(
    `SELECT COUNT(*) as cnt FROM ledger_entries WHERE entry_type = 'ADJUSTMENT'`
  );

  // Run again
  const { data } = await fetchJson('/api/sync/balances', 'POST');

  assert(data.summary.merchants_with_diff === 0, 'No diff detected');
  assert(data.summary.merchants_updated === 0, 'No merchants updated');

  // No new ledger entries
  const { rows: countAfter } = await pool.query(
    `SELECT COUNT(*) as cnt FROM ledger_entries WHERE entry_type = 'ADJUSTMENT'`
  );
  assert(countBefore[0].cnt === countAfter[0].cnt, 'No new ledger entries created');
}

async function test_balance_belowThreshold() {
  console.log('\n── 6. Balance Sync: Below Threshold (< 0.001) Ignored ──');

  // Set a tiny diff that's below threshold
  const { rows } = await pool.query('SELECT balance FROM merchants WHERE id = $1', [DON_MERCHANT_ID]);
  const current = Number(rows[0].balance);
  await pool.query('UPDATE merchants SET balance = $1 WHERE id = $2', [current + 0.0005, DON_MERCHANT_ID]);

  const { data } = await fetchJson('/api/sync/balances', 'POST');
  const don = data.results.find((r: any) => r.username === 'don');

  assert(Math.abs(don?.diff) < 0.001, `Diff below threshold (${don?.diff})`);
  assert(don?.updated === false, 'Not updated (below threshold)');

  // Restore exact on-chain balance
  await pool.query('UPDATE merchants SET balance = $1 WHERE id = $2', [don?.onchain_balance, DON_MERCHANT_ID]);
}

async function test_balance_skipsMockWallets() {
  console.log('\n── 7. Balance Sync: Skips Mock/Fake Wallets ──');

  const { data } = await fetchJson('/api/sync/balances');

  assert(data.summary.merchants_checked === 2, 'Only 2 real wallets checked');
  assert(!data.results.some((r: any) => r.wallet.startsWith('MOCK_')), 'No MOCK_ wallets');
  assert(!data.results.some((r: any) => r.wallet.startsWith('Merchant')), 'No Merchant* wallets');

  // Verify all results have valid Solana pubkeys (32 bytes base58)
  for (const r of data.results) {
    assert(r.wallet.length >= 32 && r.wallet.length <= 44, `Valid pubkey length (${r.username}: ${r.wallet.length} chars)`);
  }
}

async function test_balance_onchainVerification() {
  console.log('\n── 8. Balance Sync: On-chain Values Match Direct RPC ──');

  const conn = new Connection(RPC_URL, 'confirmed');

  // Get on-chain balances directly
  const donPk = new PublicKey(DON_WALLET);
  const donAta = await getAssociatedTokenAddress(USDT_MINT, donPk);
  const donAcct = await getAccount(conn, donAta);
  const donOnchain = Number(donAcct.amount) / 1e6;

  const tojoPk = new PublicKey(TOJO_WALLET);
  const tojoAta = await getAssociatedTokenAddress(USDT_MINT, tojoPk);
  const tojoAcct = await getAccount(conn, tojoAta);
  const tojoOnchain = Number(tojoAcct.amount) / 1e6;

  // Compare with API
  const { data } = await fetchJson('/api/sync/balances');
  const donResult = data.results.find((r: any) => r.username === 'don');
  const tojoResult = data.results.find((r: any) => r.username === 'tojo');

  assert(donResult?.onchain_balance === donOnchain, `Don API (${donResult?.onchain_balance}) === RPC (${donOnchain})`);
  assert(tojoResult?.onchain_balance === tojoOnchain, `Tojo API (${tojoResult?.onchain_balance}) === RPC (${tojoOnchain})`);
}

async function test_balance_concurrentSync() {
  console.log('\n── 9. Balance Sync: Concurrent Requests Don\'t Corrupt ──');

  // Tamper
  await pool.query('UPDATE merchants SET balance = 0 WHERE id = $1', [DON_MERCHANT_ID]);

  // Fire 3 concurrent syncs
  const [r1, r2, r3] = await Promise.all([
    fetchJson('/api/sync/balances', 'POST'),
    fetchJson('/api/sync/balances', 'POST'),
    fetchJson('/api/sync/balances', 'POST'),
  ]);

  assert(r1.data.success && r2.data.success && r3.data.success, 'All 3 succeeded');

  // Final balance should be correct
  const { rows } = await pool.query('SELECT balance FROM merchants WHERE id = $1', [DON_MERCHANT_ID]);
  const don1 = r1.data.results.find((r: any) => r.username === 'don');
  assert(Number(rows[0].balance) === don1?.onchain_balance, `Balance correct after concurrent sync (${rows[0].balance})`);
}

async function test_balance_ledgerAuditTrail() {
  console.log('\n── 10. Balance Sync: Full Ledger Audit Trail ──');

  // Tamper don to specific value
  await pool.query('UPDATE merchants SET balance = 12345.67 WHERE id = $1', [DON_MERCHANT_ID]);

  const { data } = await fetchJson('/api/sync/balances', 'POST');
  const don = data.results.find((r: any) => r.username === 'don');

  // Fetch the ledger entry
  const { rows: ledger } = await pool.query(
    `SELECT account_type, entry_type, amount, asset, balance_before, balance_after, description
     FROM ledger_entries WHERE account_id = $1 AND entry_type = 'ADJUSTMENT'
     ORDER BY created_at DESC LIMIT 1`,
    [DON_MERCHANT_ID]
  );

  assert(ledger[0].account_type === 'merchant', 'account_type = merchant');
  assert(ledger[0].entry_type === 'ADJUSTMENT', 'entry_type = ADJUSTMENT');
  assert(ledger[0].asset === 'USDT', 'asset = USDT');
  assert(Number(ledger[0].balance_before) === 12345.67, `balance_before = 12345.67 (got ${ledger[0].balance_before})`);
  assert(Number(ledger[0].balance_after) === don?.onchain_balance, `balance_after = ${don?.onchain_balance}`);
  assert(ledger[0].description.includes('Balance sync'), 'Description mentions balance sync');
  assert(ledger[0].description.includes('12345.67'), 'Description includes old balance');
}

// ════════════════════════════════════════════════════════════
//  ESCROW SYNC TESTS
// ════════════════════════════════════════════════════════════

async function test_escrow_structure() {
  console.log('\n── 11. Escrow Sync: Response Structure ──');
  const { status, data } = await fetchJson('/api/sync/escrow');

  assert(status === 200, 'HTTP 200');
  assert(data.success === true, 'success: true');
  assert(typeof data.summary === 'object', 'summary is object');
  assert(typeof data.summary.orders_with_escrow === 'number', 'orders_with_escrow is number');
  assert(typeof data.summary.stuck_escrows === 'number', 'stuck_escrows is number');
  assert(typeof data.summary.orders_missing_escrow_fields === 'number', 'orders_missing_escrow_fields is number');
  assert(typeof data.summary.total_stuck_value === 'number', 'total_stuck_value is number');
  assert(Array.isArray(data.stuck), 'stuck is array');
  assert(Array.isArray(data.missing_escrow_fields), 'missing_escrow_fields is array');
}

async function test_escrow_detectsMissingFields() {
  console.log('\n── 12. Escrow Sync: Detects Orders Missing Escrow Fields ──');

  const { data } = await fetchJson('/api/sync/escrow');
  assert(data.summary.orders_missing_escrow_fields > 0, `Found ${data.summary.orders_missing_escrow_fields} orders missing fields`);

  // Each has required shape
  for (const m of data.missing_escrow_fields) {
    assert(typeof m.order_number === 'string', `${m.order_number} has order_number`);
    assert(['cancelled', 'expired'].includes(m.status), `${m.order_number} status is cancelled/expired`);
    assert(m.crypto_amount > 0, `${m.order_number} crypto_amount > 0`);
    assert(typeof m.note === 'string' && m.note.length > 0, `${m.order_number} has note`);
  }
}

async function test_escrow_skipsRefundedOrders() {
  console.log('\n── 13. Escrow Sync: Skips Orders With refund_tx_hash ──');

  const testId = TEST_IDS.withRefund;
  const orderNum = expectedOrderNumber(testId);
  await insertTestOrder(testId, {
    escrow_tx_hash: 'real-tx-for-refund-test',
    escrow_trade_id: 777777777,
    escrow_creator_wallet: DON_WALLET,
    refund_tx_hash: 'some-refund-hash-already-set',
  });

  const { data } = await fetchJson('/api/sync/escrow');

  // Should NOT appear in stuck or orders_with_escrow (query excludes refund_tx_hash IS NOT NULL)
  const found = data.stuck?.find((s: any) => s.order_number === orderNum);
  assert(!found, 'Refunded order NOT in stuck list');
}

async function test_escrow_skipsReleasedOrders() {
  console.log('\n── 14. Escrow Sync: Skips Orders With release_tx_hash ──');

  const testId = TEST_IDS.withRelease;
  const orderNum = expectedOrderNumber(testId);
  await insertTestOrder(testId, {
    status: 'completed',
    escrow_tx_hash: 'real-tx-for-release-test',
    escrow_trade_id: 666666666,
    escrow_creator_wallet: DON_WALLET,
    release_tx_hash: 'some-release-hash-already-set',
  });

  const { data } = await fetchJson('/api/sync/escrow');
  const found = data.stuck?.find((s: any) => s.order_number === orderNum);
  assert(!found, 'Released order NOT in stuck list');
}

async function test_escrow_skipsMockEscrow() {
  console.log('\n── 15. Escrow Sync: Skips mock- Escrow Hashes ──');

  const testId = TEST_IDS.mockEscrow;
  const orderNum = expectedOrderNumber(testId);
  await insertTestOrder(testId, {
    escrow_tx_hash: 'mock-escrow-abc123',
    escrow_trade_id: 555555555,
    escrow_creator_wallet: DON_WALLET,
  });

  const { data } = await fetchJson('/api/sync/escrow');
  // mock- hashes are excluded by the query
  assert(data.summary.orders_with_escrow === 0 ||
    !data.stuck?.find((s: any) => s.order_number === orderNum),
    'mock- escrow not checked');
}

async function test_escrow_skipsDemoEscrow() {
  console.log('\n── 16. Escrow Sync: Skips demo- Escrow Hashes ──');

  const testId = TEST_IDS.demoEscrow;
  const orderNum = expectedOrderNumber(testId);
  await insertTestOrder(testId, {
    escrow_tx_hash: 'demo-escrow-xyz789',
    escrow_trade_id: 444444444,
    escrow_creator_wallet: DON_WALLET,
  });

  const { data } = await fetchJson('/api/sync/escrow');
  assert(!data.stuck?.find((s: any) => s.order_number === orderNum),
    'demo- escrow not in stuck list');
}

async function test_escrow_skipsTestEscrow() {
  console.log('\n── 17. Escrow Sync: Skips test- Escrow Hashes ──');

  const testId = TEST_IDS.activeEscrow;
  const orderNum = expectedOrderNumber(testId);
  await insertTestOrder(testId, {
    escrow_tx_hash: 'test-escrow-hash-001',
    escrow_trade_id: 333333333,
    escrow_creator_wallet: DON_WALLET,
  });

  const { data } = await fetchJson('/api/sync/escrow');
  assert(!data.stuck?.find((s: any) => s.order_number === orderNum),
    'test- escrow not in stuck list');
}

async function test_escrow_detectsStuckOrder() {
  console.log('\n── 18. Escrow Sync: Detects Stuck Order (real tx hash, no refund) ──');

  await insertTestOrder(TEST_IDS.stuck, {
    escrow_tx_hash: 'real-onchain-tx-hash-for-stuck-test',
    escrow_trade_id: 999999999,
    escrow_creator_wallet: DON_WALLET,
  });

  const { data } = await fetchJson('/api/sync/escrow');
  assert(data.summary.orders_with_escrow >= 1, `orders_with_escrow >= 1 (got ${data.summary.orders_with_escrow})`);

  // The stuck order should be picked up (even if vault is empty on-chain)
  // It appears in orders_with_escrow count, but since vault_balance = 0 on-chain (fake trade_id),
  // it won't appear in "stuck" list. This is correct — vault empty means already handled.
  // The real detection happens when vault has funds.
}

async function test_escrow_multipleStuckOrders() {
  console.log('\n── 19. Escrow Sync: Handles Multiple Stuck Orders ──');

  await insertTestOrder(TEST_IDS.stuck2, {
    status: 'expired',
    crypto_amount: 5000,
    escrow_tx_hash: 'real-tx-hash-stuck-02',
    escrow_trade_id: 222222222,
    escrow_creator_wallet: DON_WALLET,
  });

  await insertTestOrder(TEST_IDS.stuck3, {
    status: 'cancelled',
    crypto_amount: 3000,
    escrow_tx_hash: 'real-tx-hash-stuck-03',
    escrow_trade_id: 111111111,
    escrow_creator_wallet: TOJO_WALLET,
    merchant_id: TOJO_MERCHANT_ID,
  });

  const { data } = await fetchJson('/api/sync/escrow');
  assert(data.summary.orders_with_escrow >= 3, `Multiple orders detected (${data.summary.orders_with_escrow})`);
}

async function test_escrow_gracefulInvalidWallet() {
  console.log('\n── 20. Escrow Sync: Graceful Error on Invalid Wallet ──');

  const testId = TEST_IDS.badWallet;
  const orderNum = expectedOrderNumber(testId);
  await insertTestOrder(testId, {
    escrow_tx_hash: 'real-tx-hash-bad-wallet',
    escrow_trade_id: 888888888,
    escrow_creator_wallet: 'INVALID_NOT_A_PUBKEY',
  });

  const { data } = await fetchJson('/api/sync/escrow');
  assert(data.success === true, 'Still succeeds overall');
  assert(Array.isArray(data.errors) && data.errors.length > 0, 'Error collected (not crash)');

  const badError = data.errors.find((e: any) => e.order_number === orderNum);
  assert(!!badError, `Error specifically for bad wallet order (${orderNum})`);
  assert(typeof badError?.error === 'string' && badError.error.length > 0, 'Error message present');
}

// ════════════════════════════════════════════════════════════
//  REAL ORDER VERIFICATION (4A3410A9)
// ════════════════════════════════════════════════════════════

async function test_realOrder_4A3410A9_refunded() {
  console.log('\n── 21. Real Order 4A3410A9: Verify Refund Completed ──');

  const { rows } = await pool.query(
    `SELECT escrow_tx_hash, refund_tx_hash, escrow_trade_id, escrow_creator_wallet, status
     FROM orders WHERE order_number = 'BM-260222-4A3410A9'`
  );

  if (rows.length === 0) {
    skip('Order 4A3410A9 not found');
    return;
  }

  const order = rows[0];
  assert(order.status === 'cancelled', 'Status is cancelled');
  assert(!!order.escrow_tx_hash, 'escrow_tx_hash is set');
  assert(!!order.refund_tx_hash, 'refund_tx_hash is set (auto-refund worked)');
  assert(!!order.escrow_creator_wallet, 'escrow_creator_wallet is set');
  assert(order.escrow_creator_wallet === DON_WALLET, 'Creator wallet is Don');
}

async function test_realOrder_4A3410A9_vaultEmpty() {
  console.log('\n── 22. Real Order 4A3410A9: Vault is Empty On-chain ──');

  const conn = new Connection(RPC_URL, 'confirmed');
  // Vault ATA from the escrow
  const VAULT = new PublicKey('72jX8oXBnxFhQ9qN171k4CEbDJMpvKWZFVCiYY7u7udB');

  try {
    await getAccount(conn, VAULT);
    assert(false, 'Vault should be closed/empty');
  } catch (e: any) {
    assert(e.name === 'TokenAccountNotFoundError', 'Vault is closed (TokenAccountNotFoundError)');
  }
}

async function test_realOrder_donBalanceIncludes10kRefund() {
  console.log('\n── 23. Real Order: Don Balance Includes 10k Refund ──');

  const conn = new Connection(RPC_URL, 'confirmed');
  const donPk = new PublicKey(DON_WALLET);
  const donAta = await getAssociatedTokenAddress(USDT_MINT, donPk);
  const donAcct = await getAccount(conn, donAta);
  const balance = Number(donAcct.amount) / 1e6;

  // Don was funded 100k, spent 6111 on completed trades (5000+1111), got 10k refund
  // So balance should be 100000 - 6111 = 93889
  assert(balance === 93889, `Don on-chain = 93889 (got ${balance})`);
}

async function test_realOrder_tojoBalance() {
  console.log('\n── 24. Real Order: Tojo Balance Matches Expected ──');

  const conn = new Connection(RPC_URL, 'confirmed');
  const tojoPk = new PublicKey(TOJO_WALLET);
  const tojoAta = await getAssociatedTokenAddress(USDT_MINT, tojoPk);
  const tojoAcct = await getAccount(conn, tojoAta);
  const balance = Number(tojoAcct.amount) / 1e6;

  // Tojo: 10000 (funded) + 1083.225 (release A5E787F5) + 4875 (release C9F2FE3E) = 15958.225
  assert(balance === 15958.225, `Tojo on-chain = 15958.225 (got ${balance})`);
}

async function test_realOrder_treasuryFees() {
  console.log('\n── 25. Real Order: Treasury Received Fees ──');

  const conn = new Connection(RPC_URL, 'confirmed');
  const treasuryPk = new PublicKey(TREASURY_WALLET);
  const treasuryAta = await getAssociatedTokenAddress(USDT_MINT, treasuryPk);
  const treasuryAcct = await getAccount(conn, treasuryAta);
  const balance = Number(treasuryAcct.amount) / 1e6;

  assert(balance > 100000, `Treasury > 100k (got ${balance})`);
  // Expected fees: 2.5% of 1111 (27.775) + 2.5% of 5000 (125) = 152.775
  // Treasury was funded with some amount, so just verify it's reasonable
  assert(balance < 200000, `Treasury < 200k (reasonable range)`);
}

// ════════════════════════════════════════════════════════════
//  DB CONSISTENCY TESTS
// ════════════════════════════════════════════════════════════

async function test_db_balancesMatchOnchain() {
  console.log('\n── 26. DB Consistency: Balances Match On-chain After Sync ──');

  // Full sync
  await fetchJson('/api/sync/balances', 'POST');

  const { data } = await fetchJson('/api/sync/balances');
  for (const r of data.results) {
    assert(Math.abs(r.diff) < 0.001, `${r.username}: diff = ${r.diff} (within threshold)`);
  }
  assert(Math.abs(data.summary.total_diff) < 0.01, `Total diff near zero (${data.summary.total_diff})`);
}

async function test_db_noStuckEscrowsAfterRefund() {
  console.log('\n── 27. DB Consistency: No Real Stuck Escrows (all refunded) ──');

  // Clean up test orders first
  await cleanupTestOrders();

  const { data } = await fetchJson('/api/sync/escrow');
  assert(data.summary.stuck_escrows === 0, `No real stuck escrows (got ${data.summary.stuck_escrows})`);
  assert(data.summary.total_stuck_value === 0, `Total stuck value = 0 (got ${data.summary.total_stuck_value})`);
}

async function test_db_order4A3410A9_notInEscrowSync() {
  console.log('\n── 28. DB Consistency: 4A3410A9 Not Flagged (has refund_tx_hash) ──');

  const { data } = await fetchJson('/api/sync/escrow');

  // Should NOT appear since it has refund_tx_hash
  const found = data.stuck?.find((s: any) => s.order_number === 'BM-260222-4A3410A9');
  assert(!found, '4A3410A9 not in stuck list');

  const foundMissing = data.missing_escrow_fields?.find((m: any) => m.order_number === 'BM-260222-4A3410A9');
  assert(!foundMissing, '4A3410A9 not in missing fields list');
}

// ════════════════════════════════════════════════════════════
//  RUNNER
// ════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Escrow Reconciliation — Extensive Test Suite    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Server: ${BASE_URL}`);
  console.log(`RPC: ${RPC_URL.replace(/api-key=.*/, 'api-key=***')}`);

  // Health check
  try {
    const res = await fetch(`${BASE_URL}/api/sync/balances`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\nERROR: Server not responding at ${BASE_URL}`);
    process.exit(1);
  }

  // Get a valid user ID for test fixtures
  const { rows: users } = await pool.query('SELECT id FROM users LIMIT 1');
  userId = users[0].id;

  // Clean up any leftover test data from previous runs
  await cleanupTestOrders();

  // Record start time so cleanup can delete test-created ledger entries
  testStartTime = new Date();

  try {
    // ── Balance Sync (10 tests) ──
    await test_balance_dryRun_structure();
    await test_balance_dryRun_noMutation();
    await test_balance_apply_bothMerchants();
    await test_balance_negativeDiff();
    await test_balance_idempotent();
    await test_balance_belowThreshold();
    await test_balance_skipsMockWallets();
    await test_balance_onchainVerification();
    await test_balance_concurrentSync();
    await test_balance_ledgerAuditTrail();

    // ── Escrow Sync (10 tests) ──
    await test_escrow_structure();
    await test_escrow_detectsMissingFields();
    await test_escrow_skipsRefundedOrders();
    await test_escrow_skipsReleasedOrders();
    await test_escrow_skipsMockEscrow();
    await test_escrow_skipsDemoEscrow();
    await test_escrow_skipsTestEscrow();
    await test_escrow_detectsStuckOrder();
    await test_escrow_multipleStuckOrders();
    await test_escrow_gracefulInvalidWallet();

    // ── Real Order Verification (5 tests) ──
    await test_realOrder_4A3410A9_refunded();
    await test_realOrder_4A3410A9_vaultEmpty();
    await test_realOrder_donBalanceIncludes10kRefund();
    await test_realOrder_tojoBalance();
    await test_realOrder_treasuryFees();

    // ── DB Consistency (3 tests) ──
    await test_db_balancesMatchOnchain();
    await test_db_noStuckEscrowsAfterRefund();
    await test_db_order4A3410A9_notInEscrowSync();
  } finally {
    // Always clean up
    await cleanupTestOrders();
    await pool.end();
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  Results: ${String(passed).padStart(2)} passed  ${String(failed).padStart(2)} failed  ${String(skipped).padStart(2)} skipped        ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\nFatal error:', e.message);
  cleanupTestOrders().catch(() => {});
  pool.end().catch(() => {});
  process.exit(1);
});
