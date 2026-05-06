#!/usr/bin/env tsx
/**
 * Orphan-Escrow Recovery — backfill DB rows from on-chain tx data so the
 * existing payment-deadline-worker (Job 4: stuck on-chain escrow refund)
 * picks them up and auto-refunds.
 *
 * Why this exists
 * ───────────────
 * Pre-pipeline orphans (created before the pending_escrow flow shipped):
 * funds locked in a Trade PDA on Solana, but the matching `orders` row
 * has NULL escrow_* fields. Job 4 looks for orders where
 *   status IN ('expired','cancelled','disputed')
 *   AND escrow_tx_hash IS NOT NULL
 *   AND escrow_creator_wallet IS NOT NULL
 *   AND escrow_trade_id IS NOT NULL
 *   AND release_tx_hash IS NULL
 * — so it skips orphans missing any of those columns.
 *
 * This script reads the on-chain tx, extracts the missing fields, writes
 * them back to settle. Job 4 then runs in its normal 30 s cadence and
 * fires `refundEscrowFromBackend()` against the trade PDA, returning the
 * USDT to the merchant's wallet on-chain.
 *
 * Usage
 * ─────
 *   tsx scripts/recover-orphan-escrow.ts \
 *       --order-id <uuid> \
 *       --tx-hash  <signature> \
 *       [--dry-run]
 *
 * Defaults to dry-run when neither --execute nor --dry-run is set, so a
 * mistyped order id never silently writes.
 */

import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
dotenv({ path: resolve(__dirname, '..', '.env.local') });

import type { Connection } from '@solana/web3.js';

type Args = {
  orderId?: string;
  txHash?: string;
  dryRun: boolean;
  execute: boolean;
};

function parseArgs(): Args {
  const a: Args = { dryRun: false, execute: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--order-id') { a.orderId = v; i++; }
    else if (k === '--tx-hash') { a.txHash = v; i++; }
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--execute') a.execute = true;
  }
  // Default to dry-run if neither flag set — money-moving safety.
  if (!a.dryRun && !a.execute) a.dryRun = true;
  return a;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/**
 * Pull from the on-chain tx exactly the fields the orders row needs:
 *   - escrow_creator_wallet  (the signer / first signed account)
 *   - escrow_trade_id        (parsed from "Trade created: id=<n>" log line)
 *   - escrow_trade_pda       (parsed from "Escrow funded: trade=<base58>")
 *   - escrow_address         (the SPL token account that received USDT)
 *   - escrow_debited_amount  (post - pre on the creator's USDT account)
 *
 * The on-chain program emits a structured log on every fund/lock_escrow
 * call; this is the cheapest way to recover the trade_id without re-deriving
 * the PDA manually.
 */
async function decodeTx(_connection: Connection, sig: string) {
  // Some RPC providers (Helius) return a `meta.innerInstructions` shape
  // that web3.js's strict superstruct validator rejects when we ask for
  // `jsonParsed`. We don't need parsed instructions — only logs +
  // preTokenBalances + postTokenBalances + accountKeys — so issue the
  // RPC call directly and read the raw JSON-RPC payload.
  const RPC =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com';
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [
        sig,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const payload = (await res.json()) as { result: any; error?: { message: string } };
  if (payload.error) throw new Error(`RPC error: ${payload.error.message}`);
  const tx = payload.result;
  if (!tx) throw new Error(`tx not found on-chain: ${sig}`);
  if (tx.meta?.err) throw new Error(`tx landed with error: ${JSON.stringify(tx.meta.err)}`);

  // Logs we expect:
  //   Trade created: id=<bigint>, amount=<u64>, side=<...>, fee_bps=<n>
  //   Escrow funded (open for acceptance): trade=<base58>, amount=<u64>
  // OR for lock_escrow (legacy): "Escrow locked" pattern
  const logs = tx.meta?.logMessages || [];
  let tradeId: string | undefined;
  let tradePda: string | undefined;
  let escrowAmountU64: string | undefined;

  for (const l of logs) {
    const idMatch = l.match(/Trade created: id=(\d+)/);
    if (idMatch) tradeId = idMatch[1];
    const tradeMatch = l.match(/trade=([1-9A-HJ-NP-Za-km-z]{32,44}),\s*amount=(\d+)/);
    if (tradeMatch) {
      tradePda = tradeMatch[1];
      escrowAmountU64 = tradeMatch[2];
    }
  }

  if (!tradeId || !tradePda) {
    throw new Error(
      `couldn't extract trade_id / trade_pda from tx logs — is this an escrow-funding tx?`,
    );
  }

  // Find the merchant's USDT debit and the escrow's USDT credit.
  // pre/postTokenBalances includes accountIndex which we cross-reference
  // with `accountKeys` to get base58 addresses.
  const pre = (tx.meta?.preTokenBalances || []) as Array<{
    accountIndex: number;
    owner?: string;
    uiTokenAmount: { uiAmountString?: string };
  }>;
  const post = (tx.meta?.postTokenBalances || []) as Array<{
    accountIndex: number;
    owner?: string;
    uiTokenAmount: { uiAmountString?: string };
  }>;
  const accountKeys = (
    tx.transaction.message?.accountKeys || []
  ) as Array<{ pubkey: string }>;

  let creatorWallet: string | undefined;
  let escrowAta: string | undefined;
  let debitedUi = 0;
  let creditedUi = 0;

  for (const b of post) {
    const acctKey = accountKeys[b.accountIndex]?.pubkey;
    if (!acctKey) continue;
    const before = pre.find((p) => p.accountIndex === b.accountIndex);
    const beforeUi = parseFloat(before?.uiTokenAmount.uiAmountString || '0');
    const afterUi = parseFloat(b.uiTokenAmount.uiAmountString || '0');
    const delta = afterUi - beforeUi;
    if (delta < 0 && b.owner) {
      // negative delta = the wallet that paid into escrow
      if (Math.abs(delta) > Math.abs(debitedUi)) {
        debitedUi = delta;
        creatorWallet = b.owner;
      }
    } else if (delta > 0 && b.owner) {
      // positive delta = the escrow ATA receiving funds
      if (delta > creditedUi) {
        creditedUi = delta;
        escrowAta = acctKey;
      }
    }
  }

  if (!creatorWallet) {
    throw new Error('could not identify creator wallet (no negative USDT delta found)');
  }
  if (!escrowAta) {
    throw new Error('could not identify escrow ATA (no positive USDT delta found)');
  }

  const blockTime = tx.blockTime
    ? new Date(tx.blockTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    sig,
    tradeId,
    tradePda,
    creatorWallet,
    escrowAta,
    escrowAmountU64,
    debitedUi: Math.abs(debitedUi),
    creditedUi,
    blockTime,
  };
}

async function main() {
  const args = parseArgs();
  if (!args.orderId) fail('missing --order-id');
  if (!args.txHash) fail('missing --tx-hash');

  // ── DB connection ───────────────────────────────────────────────────
  const { query } = await import('../src/lib/db');

  const orderRows = await query<{
    id: string;
    status: string;
    crypto_amount: string;
    escrow_tx_hash: string | null;
    escrow_creator_wallet: string | null;
    escrow_trade_id: string | null;
    release_tx_hash: string | null;
    merchant_id: string | null;
  }>(
    `SELECT id, status, crypto_amount, escrow_tx_hash, escrow_creator_wallet,
            escrow_trade_id, release_tx_hash, merchant_id
       FROM orders WHERE id = $1`,
    [args.orderId],
  );

  if (orderRows.length === 0) fail(`order ${args.orderId} not found`);
  const order = orderRows[0];

  if (order.release_tx_hash) {
    console.log(`✓ already refunded (release_tx_hash=${order.release_tx_hash}) — nothing to do`);
    process.exit(0);
  }

  // ── On-chain decode (uses raw JSON-RPC, no Connection needed) ──────
  const RPC =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com';

  console.log(`→ decoding tx ${args.txHash} on ${RPC}…`);
  const decoded = await decodeTx(null as unknown as Connection, args.txHash);

  // ── Plan the UPDATE ─────────────────────────────────────────────────
  console.log('');
  console.log('On-chain extract:');
  console.log(`  trade_id          : ${decoded.tradeId}`);
  console.log(`  trade_pda         : ${decoded.tradePda}`);
  console.log(`  escrow_ata        : ${decoded.escrowAta}`);
  console.log(`  creator_wallet    : ${decoded.creatorWallet}`);
  console.log(`  debited (USDT)    : ${decoded.debitedUi}`);
  console.log(`  credited (USDT)   : ${decoded.creditedUi}`);
  console.log(`  blockTime         : ${decoded.blockTime}`);
  console.log('');
  console.log('Order before:');
  console.log(`  id                : ${order.id}`);
  console.log(`  status            : ${order.status}`);
  console.log(`  crypto_amount     : ${order.crypto_amount}`);
  console.log(`  escrow_tx_hash    : ${order.escrow_tx_hash || '(NULL)'}`);
  console.log(`  creator_wallet    : ${order.escrow_creator_wallet || '(NULL)'}`);
  console.log(`  trade_id          : ${order.escrow_trade_id || '(NULL)'}`);
  console.log('');

  // Sanity check: the on-chain credit should match the order amount.
  const expected = parseFloat(order.crypto_amount);
  if (Math.abs(decoded.creditedUi - expected) > 1e-6) {
    fail(
      `on-chain amount (${decoded.creditedUi}) does not match order amount (${expected}). Refusing to backfill — wrong tx?`,
    );
  }

  if (args.dryRun) {
    console.log('[DRY-RUN] Would execute the following UPDATE:');
    console.log(`
UPDATE orders SET
  escrow_tx_hash             = '${args.txHash}',
  escrow_address             = '${decoded.escrowAta}',
  escrow_trade_pda           = '${decoded.tradePda}',
  escrow_trade_id            = ${decoded.tradeId},
  escrow_creator_wallet      = '${decoded.creatorWallet}',
  escrow_debited_entity_type = 'merchant',
  escrow_debited_entity_id   = '${order.merchant_id}',
  escrow_debited_amount      = ${decoded.debitedUi},
  escrow_debited_at          = COALESCE(escrow_debited_at, '${decoded.blockTime}'),
  escrowed_at                = COALESCE(escrowed_at, '${decoded.blockTime}'),
  order_version              = order_version + 1,
  updated_at                 = NOW()
WHERE id = '${order.id}';
`);
    console.log('Re-run with --execute to apply.');
    console.log('After applying, payment-deadline-worker Job 4 will refund within ~30s.');
    process.exit(0);
  }

  // ── Execute ──────────────────────────────────────────────────────────
  const result = await query(
    `UPDATE orders SET
       escrow_tx_hash             = $2,
       escrow_address             = COALESCE(escrow_address, $3),
       escrow_trade_pda           = COALESCE(escrow_trade_pda, $4),
       escrow_trade_id            = COALESCE(escrow_trade_id, $5),
       escrow_creator_wallet      = COALESCE(escrow_creator_wallet, $6),
       escrow_debited_entity_type = 'merchant',
       escrow_debited_entity_id   = COALESCE(escrow_debited_entity_id, $7),
       escrow_debited_amount      = COALESCE(escrow_debited_amount, $8),
       escrow_debited_at          = COALESCE(escrow_debited_at, $9::timestamptz),
       escrowed_at                = COALESCE(escrowed_at, $9::timestamptz),
       order_version              = order_version + 1,
       updated_at                 = NOW()
     WHERE id = $1
     RETURNING id, status, escrow_tx_hash, escrow_creator_wallet, escrow_trade_id`,
    [
      order.id,
      args.txHash,
      decoded.escrowAta,
      decoded.tradePda,
      decoded.tradeId,
      decoded.creatorWallet,
      order.merchant_id,
      decoded.debitedUi,
      decoded.blockTime,
    ],
  );

  if (result.length === 0) {
    fail('UPDATE affected 0 rows — order not modified');
  }
  console.log('✓ backfill applied:');
  console.log(JSON.stringify(result[0], null, 2));
  console.log('');
  console.log(
    'Payment-deadline-worker Job 4 will pick this up on its next tick (~30s)',
  );
  console.log(
    'and submit refund_escrow on-chain via the BACKEND_SIGNER. Watch:',
  );
  console.log('  tail -f /tmp/bm-settle.log | grep -iE "stuck|refund|backendrefund"');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ error:', (err as Error).message);
  process.exit(1);
});
