/**
 * sync-balances.js — reconcile the DB `balance` cache to on-chain USDT truth.
 *
 * One-directional and safe: it sets DB `balance` := the CONFIDENT on-chain USDT
 * balance. It can never lose or invent money — at worst it makes the cache equal
 * the chain, or (on an uncertain RPC read) does nothing. It is NOT on any order
 * code path; the only write it ever makes is a single-row
 *   UPDATE <merchants|users> SET balance = <on-chain> WHERE id = <id>
 * inside a transaction with FOR UPDATE + write-only-if-changed. No error_logs, no
 * destructive ops.
 *
 * DRY-RUN BY DEFAULT — it prints exactly what it WOULD change and writes nothing.
 * Pass --apply to actually write.
 *
 * Scope:
 *   (default)        accounts with a recent ESCROW_REFUND  (the refund-drift case)
 *   --scope=all      every merchant + user that has a wallet_address (full sweep)
 *   --merchant=<id>  just one merchant
 *   --user=<id>      just one user
 *
 * Usage:
 *   node scripts/sync-balances.js                          # dry-run, refunds scope
 *   node scripts/sync-balances.js --scope=all              # dry-run, ALL wallets
 *   node scripts/sync-balances.js --apply                  # APPLY, refunds scope
 *   node scripts/sync-balances.js --merchant=<id> --apply  # APPLY, one merchant
 *
 * Env:
 *   DATABASE_URL      (required)  Postgres connection
 *   SOLANA_RPC_URL    default https://api.mainnet-beta.solana.com
 *   SOLANA_NETWORK    'mainnet' (default) | 'devnet'  → picks the USDT mint
 *   USDT_MINT         explicit mint override (else network default)
 *   LOOKBACK_HOURS    default 720   (refunds scope window)
 *   DRIFT_THRESHOLD   default 0.01  (ignore sub-cent noise)
 *   RPC_DELAY_MS      default 200   (pause between on-chain reads — be nice to RPC)
 *
 * "Auto" operation: schedule this with --apply on a cron (e.g. every 15 min) to
 * keep the cache continuously reconciled. Use a PRIVATE RPC for --scope=all.
 */

const { Client } = require('pg');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');

// ---- config ----------------------------------------------------------------
const APPLY = process.argv.includes('--apply');
const argVal = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : null;
};
const SCOPE = argVal('scope') || 'refunds';
const ONE_MERCHANT = argVal('merchant');
const ONE_USER = argVal('user');
const LOOKBACK = parseInt(process.env.LOOKBACK_HOURS || '720', 10);
const THRESHOLD = parseFloat(process.env.DRIFT_THRESHOLD || '0.01');
const RPC_DELAY_MS = parseInt(process.env.RPC_DELAY_MS || '200', 10);

const MAINNET_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const DEVNET_USDT = 'FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z';
const NETWORK = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
const MINT_ADDR = process.env.USDT_MINT || (NETWORK.startsWith('main') ? MAINNET_USDT : DEVNET_USDT);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const conn = new Connection(RPC_URL, 'confirmed');
const MINT = new PublicKey(MINT_ADDR);
const client = new Client({ connectionString: process.env.DATABASE_URL });
// Swallow post-close socket resets from proxied DBs (Railway) so they don't crash us.
client.on('error', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CONFIDENT on-chain USDT read: number on success, null when uncertain. */
async function readOnChain(wallet) {
  try {
    const ata = await getAssociatedTokenAddress(MINT, new PublicKey(wallet));
    const acc = await getAccount(conn, ata);
    return { confident: true, balance: Number(acc.amount) / 1e6 };
  } catch (e) {
    const m = String(e && e.message || e);
    if (/could not find account|account does not exist|TokenAccountNotFound|failed to find account/i.test(m)) {
      return { confident: true, balance: 0 }; // ATA truly absent → real 0
    }
    return { confident: false, reason: m.slice(0, 60) }; // RPC blip → never act
  }
}

/** Build the candidate list (account_type + id) for the chosen scope. */
async function candidates() {
  if (ONE_MERCHANT) return [{ account_type: 'merchant', account_id: ONE_MERCHANT }];
  if (ONE_USER) return [{ account_type: 'user', account_id: ONE_USER }];
  if (SCOPE === 'all') {
    return (await client.query(
      `SELECT 'merchant' AS account_type, id::text AS account_id FROM merchants WHERE wallet_address IS NOT NULL
       UNION ALL
       SELECT 'user' AS account_type, id::text AS account_id FROM users WHERE wallet_address IS NOT NULL`,
    )).rows;
  }
  // default: refunds scope
  return (await client.query(
    `SELECT DISTINCT account_type, account_id::text AS account_id
       FROM ledger_entries
      WHERE entry_type = 'ESCROW_REFUND' AND account_id IS NOT NULL
        AND created_at > NOW() - ($1 || ' hours')::interval`,
    [String(LOOKBACK)],
  )).rows;
}

/** Apply the correction for one account in a locked transaction. Returns result. */
async function applyWrite(table, id, target) {
  await client.query('BEGIN');
  try {
    const cur = await client.query(`SELECT balance FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    if (cur.rowCount === 0) { await client.query('ROLLBACK'); return { changed: false, reason: 'gone' }; }
    const prev = Number(cur.rows[0].balance || 0);
    if (Math.abs(prev - target) <= THRESHOLD) { await client.query('ROLLBACK'); return { changed: false, prev }; }
    await client.query(`UPDATE ${table} SET balance = $1 WHERE id = $2`, [target, id]);
    await client.query('COMMIT');
    return { changed: true, prev };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

async function run() {
  await client.connect();
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (no writes)'} | scope: ${ONE_MERCHANT ? 'merchant '+ONE_MERCHANT : ONE_USER ? 'user '+ONE_USER : SCOPE}`);
  console.log(`Network: ${NETWORK} | mint: ${MINT_ADDR} | rpc: ${RPC_URL}`);
  console.log(`Threshold: ${THRESHOLD} | lookback(refunds): ${LOOKBACK}h\n`);

  const ents = await candidates();
  console.log(`Candidates: ${ents.length}\n`);

  let drift = 0, applied = 0, skipped = 0, inSync = 0;
  for (const e of ents) {
    const table = e.account_type.toLowerCase().startsWith('merchant') ? 'merchants' : 'users';
    const tag = `${e.account_type} ${String(e.account_id).slice(0, 8)}`;
    let row;
    try {
      row = (await client.query(`SELECT wallet_address, balance FROM ${table} WHERE id = $1`, [e.account_id])).rows[0];
    } catch (err) { skipped++; console.log(`- ${tag}: db read failed → skip (${err.message.slice(0,40)})`); continue; }
    if (!row || !row.wallet_address) { skipped++; console.log(`- ${tag}: no wallet → skip`); continue; }

    const oc = await readOnChain(row.wallet_address);
    await sleep(RPC_DELAY_MS);
    if (!oc.confident) { skipped++; console.log(`- ${tag}: uncertain on-chain read → skip (${oc.reason})`); continue; }

    const db = Number(row.balance || 0);
    const diff = oc.balance - db;
    if (Math.abs(diff) <= THRESHOLD) { inSync++; continue; } // already correct — quiet

    drift++;
    if (APPLY) {
      try {
        const res = await applyWrite(table, e.account_id, oc.balance);
        if (res.changed) { applied++; console.log(`- ${tag}: APPLIED  ${res.prev} → ${oc.balance}  (was off by ${diff.toFixed(6)})`); }
        else console.log(`- ${tag}: no change (${res.reason || 'already in sync at write time'})`);
      } catch (err) { console.log(`- ${tag}: WRITE FAILED → ${err.message.slice(0,60)}`); }
    } else {
      console.log(`- ${tag}: WOULD CORRECT  ${db} → ${oc.balance}  (drift ${diff.toFixed(6)})`);
    }
  }

  console.log(`\nSUMMARY: candidates=${ents.length} inSync=${inSync} drift=${drift} ${APPLY ? `applied=${applied}` : '(dry-run — nothing written)'} skipped=${skipped}`);
}

run()
  .then(() => client.end().catch(() => {}))
  .then(() => process.exit(0))
  .catch((e) => { console.error('sync-balances failed:', e.message); process.exit(1); });
