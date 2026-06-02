/**
 * refund-balance-verify.js — READ-ONLY production verification for the
 * refund-balance fix. Runs ONLY SELECT statements. Writes NOTHING. Safe to
 * point at production.
 *
 * Purpose: before we turn on ANY balance-writing step (Step 3 auto-refresh,
 * Step 4 reconciler auto-correct, Step 5 dispute fix), gather real evidence for
 * the four assumptions the reviewer flagged:
 *
 *   A1. Do refunds/disputes ALWAYS settle on-chain? (the big one — Step 3
 *       "refresh after refund" is only correct if we refresh AFTER the on-chain
 *       refund actually lands, which the DB records as orders.refund_tx_hash.)
 *   A2. Can the on-chain read be stale-but-successful? (finality — answered by
 *       the RPC commitment level, see the printed note; not a SQL question.)
 *   A3. How do refunds behave under RPC failure / retries? (orders.refund_retry_*)
 *   A4. Concurrent-sync exposure (rapid repeated refunds on one account).
 *
 * Usage (local):       node scripts/refund-balance-verify.js
 * Usage (production):  DATABASE_URL='postgres://...readonly...' node scripts/refund-balance-verify.js
 *
 * Prefer a READ-ONLY DB role for production. This script issues no writes, but a
 * read-only role makes that guarantee enforced by the database, not by trust.
 */

const { Client } = require('pg');

const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({ host: 'localhost', port: 5432, database: 'settle', user: process.env.PGUSER || 'zeus' });

const LOOKBACK_HOURS = parseInt(process.env.VERIFY_LOOKBACK_HOURS || '720', 10); // default 30d

function h(title) {
  console.log('\n' + '='.repeat(72) + '\n' + title + '\n' + '='.repeat(72));
}

/** Run one labelled query; never let a missing column/table abort the whole run. */
async function section(title, sql, params = []) {
  h(title);
  try {
    const res = await client.query(sql, params);
    if (res.rows.length === 0) {
      console.log('(no rows)');
    } else {
      console.table(res.rows);
    }
  } catch (err) {
    console.log('SKIPPED — query failed:', err.message);
  }
}

async function run() {
  await client.connect();
  console.log(`Connected. Lookback window = ${LOOKBACK_HOURS}h.`);
  console.log(process.env.DATABASE_URL ? '(using DATABASE_URL)' : '(using localhost defaults)');

  // ---------------------------------------------------------------------------
  // A0. Mode / sanity — is this DB running REAL on-chain settlement or mock?
  //     Real Solana signatures are base58 ~87-88 chars. Mock/sim hashes are
  //     short or prefixed. If most escrow hashes are short, "refresh from chain"
  //     is meaningless here (MOCK_MODE) and Step 3 would be wrong to enable.
  // ---------------------------------------------------------------------------
  await section(
    'A0. Escrow tx-hash shape (real vs mock) — last ' + LOOKBACK_HOURS + 'h',
    `SELECT
        CASE
          WHEN escrow_tx_hash IS NULL THEN 'no_escrow'
          WHEN length(escrow_tx_hash) >= 80 THEN 'looks_real_(>=80 chars)'
          ELSE 'looks_mock_(<80 chars)'
        END AS escrow_hash_kind,
        COUNT(*) AS orders
       FROM orders
      WHERE created_at > NOW() - ($1 || ' hours')::interval
      GROUP BY 1
      ORDER BY 2 DESC`,
    [String(LOOKBACK_HOURS)],
  );

  // ---------------------------------------------------------------------------
  // A1 (CORE). Refund settlement coverage. For every order that HAD escrow and
  //     ended up cancelled, did the refund actually settle on-chain
  //     (refund_tx_hash set)? This is the single most important number: if a
  //     meaningful share are NULL, then "refresh from chain after a refund"
  //     could copy a not-yet-credited balance — so Step 3 MUST gate on
  //     refund_tx_hash IS NOT NULL, not merely on "a refund was requested".
  // ---------------------------------------------------------------------------
  await section(
    'A1. Refund settlement coverage (escrowed orders that were cancelled)',
    `SELECT
        status,
        COUNT(*)                                                              AS escrowed_cancellations,
        COUNT(refund_tx_hash)                                                 AS refund_settled_onchain,
        COUNT(*) FILTER (WHERE refund_tx_hash IS NULL AND COALESCE(refund_retry_count,0) > 0)  AS refund_stuck_retrying,
        COUNT(*) FILTER (WHERE refund_tx_hash IS NULL AND COALESCE(refund_retry_count,0) = 0)  AS refund_no_onchain_signal
       FROM orders
      WHERE escrow_tx_hash IS NOT NULL
        AND status IN ('cancelled','disputed','expired')
        AND created_at > NOW() - ($1 || ' hours')::interval
      GROUP BY status
      ORDER BY status`,
    [String(LOOKBACK_HOURS)],
  );

  // ---------------------------------------------------------------------------
  // A3. Stuck / retrying refunds — escrow locked, but refund never settled.
  //     These are exactly the cases where the cache would (correctly) stay low
  //     because the money has NOT come back on-chain yet. Confirms Step 3 alone
  //     can't "fix" a stuck refund — the on-chain refund has to complete first.
  // ---------------------------------------------------------------------------
  await section(
    'A3. Stuck refunds (escrow set, refund_tx_hash NULL, cancelled >1h ago)',
    `SELECT
        order_number,
        status,
        escrow_debited_entity_id,
        COALESCE(refund_retry_count,0)            AS retries,
        refund_retry_after,
        LEFT(COALESCE(refund_last_error,''),100)  AS last_error,
        cancelled_at,
        date_trunc('second', NOW() - cancelled_at)::text AS age
       FROM orders
      WHERE escrow_tx_hash IS NOT NULL
        AND refund_tx_hash IS NULL
        AND status = 'cancelled'
        AND cancelled_at < NOW() - INTERVAL '1 hour'
      ORDER BY cancelled_at DESC
      LIMIT 50`,
  );

  // ---------------------------------------------------------------------------
  // A1b. The reconciler's candidate set — entities with a recent ESCROW_REFUND,
  //     their wallet, and current cached DB balance. This is EXACTLY who Step 3
  //     would refresh. Eyeball whether any wallet is missing (can't refresh).
  // ---------------------------------------------------------------------------
  await section(
    'A1b. Accounts with recent ESCROW_REFUND + cached balance + wallet',
    `SELECT
        le.account_type,
        le.account_id,
        COUNT(*)                                              AS refund_entries,
        date_trunc('second', MAX(le.created_at))              AS last_refund,
        COALESCE(m.balance, u.balance)                        AS db_balance,
        (COALESCE(m.wallet_address, u.wallet_address) IS NOT NULL) AS has_wallet
       FROM ledger_entries le
       LEFT JOIN merchants m ON le.account_type = 'merchant' AND m.id = le.account_id
       LEFT JOIN users     u ON le.account_type = 'user'     AND u.id = le.account_id
      WHERE le.entry_type = 'ESCROW_REFUND'
        AND le.created_at > NOW() - ($1 || ' hours')::interval
      GROUP BY le.account_type, le.account_id, m.balance, u.balance, m.wallet_address, u.wallet_address
      ORDER BY last_refund DESC
      LIMIT 50`,
    [String(LOOKBACK_HOURS)],
  );

  // ---------------------------------------------------------------------------
  // A4. Concurrent-sync exposure — accounts that got several refunds inside a
  //     short window. These are where two refreshes could previously race; the
  //     new per-account advisory lock in syncOnChainBalance.ts covers them.
  // ---------------------------------------------------------------------------
  await section(
    'A4. Accounts with >=2 refunds within any 10-min window (race-prone)',
    `WITH refunds AS (
        SELECT account_type, account_id, created_at,
               COUNT(*) OVER (
                 PARTITION BY account_type, account_id
                 ORDER BY created_at
                 RANGE BETWEEN INTERVAL '10 minutes' PRECEDING AND CURRENT ROW
               ) AS burst
          FROM ledger_entries
         WHERE entry_type = 'ESCROW_REFUND'
           AND created_at > NOW() - ($1 || ' hours')::interval
      )
      SELECT account_type, account_id, MAX(burst) AS max_refunds_in_10min
        FROM refunds
       GROUP BY account_type, account_id
      HAVING MAX(burst) >= 2
      ORDER BY max_refunds_in_10min DESC
      LIMIT 50`,
    [String(LOOKBACK_HOURS)],
  );

  // ---------------------------------------------------------------------------
  // A5. Detector output (if Step 1 has run) — any drift it already logged.
  //     Surfaces the real-world size of the problem from the detection-only run.
  // ---------------------------------------------------------------------------
  await section(
    'A5. Drift already detected by the Step-1 reconciler (error_logs)',
    `SELECT severity, COUNT(*) AS events, date_trunc('second', MAX(created_at)) AS latest
       FROM error_logs
      WHERE type = 'balance.onchain_drift'
        AND created_at > NOW() - ($1 || ' hours')::interval
      GROUP BY severity
      ORDER BY severity`,
    [String(LOOKBACK_HOURS)],
  );

  h('DONE — read-only. No rows were written.');
  console.log('Next: interpret A0 (real vs mock), A1 (settlement coverage), A3 (stuck refunds).');
}

run()
  .catch((e) => { console.error('verify failed:', e.message); process.exitCode = 1; })
  .finally(() => client.end());
