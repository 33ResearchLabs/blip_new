/**
 * Refund stuck on-chain escrows for expired/cancelled orders.
 * Scans DB for orders with escrow_tx_hash but no refund_tx_hash,
 * then calls the Solana program's refundEscrow instruction.
 *
 * The refund MUST be signed by the depositor (creator) wallet.
 * By default uses ~/.config/solana/id.json, but you can pass a custom keypair.
 *
 * Usage:
 *   npx tsx settle/scripts/refund-escrow.ts [--dry-run] [--keypair <path>] [--order <order-id>]
 *
 * Options:
 *   --dry-run             Check state without sending transactions
 *   --keypair <path>      Path to depositor's keypair JSON (default: ~/.config/solana/id.json)
 *   --order <id>          Refund a specific order ID only
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

// ── Config ───────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');
const USDT_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');
const RPC = 'https://api.devnet.solana.com';

const IDL_PATH = path.resolve(__dirname, '../src/lib/solana/v2/idl.json');
const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));

// ── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const keypairIdx = args.indexOf('--keypair');
const orderIdx = args.indexOf('--order');

const KEYPAIR_PATH = keypairIdx !== -1 && args[keypairIdx + 1]
  ? args[keypairIdx + 1]
  : path.join(process.env.HOME!, '.config/solana/id.json');

const ORDER_FILTER = orderIdx !== -1 && args[orderIdx + 1]
  ? args[orderIdx + 1]
  : null;

const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

// ── PDA helpers ──────────────────────────────────────────────────────
function findTradePda(creator: PublicKey, tradeId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('trade-v2'), creator.toBuffer(), new BN(tradeId).toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

function findEscrowPda(trade: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow-v2'), trade.toBuffer()],
    PROGRAM_ID
  );
}

function findVaultAuthorityPda(escrow: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority-v2'), escrow.toBuffer()],
    PROGRAM_ID
  );
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`Signer: ${payer.publicKey.toBase58()}`);
  console.log(`Mode:   ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (ORDER_FILTER) console.log(`Filter: order ${ORDER_FILTER}`);
  console.log('');

  const pool = new pg.Pool({
    host: 'localhost',
    port: 5432,
    database: 'settle',
    user: 'zeus',
  });

  // Find stuck escrows: real on-chain tx (not mock), expired/cancelled, no refund
  let queryText = `
    SELECT id, order_number, escrow_trade_id, escrow_creator_wallet,
           escrow_pda, escrow_trade_pda, escrow_tx_hash, crypto_amount, status, merchant_id
    FROM orders
    WHERE status IN ('expired', 'cancelled')
      AND escrow_tx_hash IS NOT NULL
      AND refund_tx_hash IS NULL
      AND escrow_tx_hash NOT LIKE 'mock-%'
      AND escrow_tx_hash NOT LIKE 'demo-%'
      AND escrow_tx_hash NOT LIKE 'test-%'
      AND escrow_trade_id IS NOT NULL
      AND escrow_creator_wallet IS NOT NULL
  `;
  const queryParams: string[] = [];
  if (ORDER_FILTER) {
    queryText += ` AND (id::text = $1 OR order_number = $1)`;
    queryParams.push(ORDER_FILTER);
  }
  queryText += ` ORDER BY created_at DESC`;

  const { rows: stuckOrders } = await pool.query(queryText, queryParams);

  if (stuckOrders.length === 0) {
    console.log('No stuck on-chain escrows found.');
    await pool.end();
    return;
  }

  console.log(`Found ${stuckOrders.length} stuck escrow(s):\n`);

  // Set up Solana
  const connection = new Connection(RPC, 'confirmed');
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx: Transaction) => { tx.sign(payer); return tx; },
    signAllTransactions: async (txs: Transaction[]) => { txs.forEach(tx => tx.sign(payer)); return txs; },
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
  const program = new Program(idl as any, PROGRAM_ID, provider);

  let refunded = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of stuckOrders) {
    const { id, order_number, escrow_trade_id, escrow_creator_wallet, crypto_amount } = order;
    console.log(`── ${order_number} ──`);
    console.log(`   Trade ID: ${escrow_trade_id}`);
    console.log(`   Creator:  ${escrow_creator_wallet}`);
    console.log(`   Amount:   ${crypto_amount} USDT  |  Status: ${order.status}`);

    try {
      const creatorPk = new PublicKey(escrow_creator_wallet);
      const [tradePda] = findTradePda(creatorPk, Number(escrow_trade_id));
      const [escrowPda] = findEscrowPda(tradePda);
      const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
      const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);

      // Verify on-chain state
      let depositor: PublicKey;
      let creator: PublicKey;
      try {
        const escrowAccount = await (program.account as any).escrow.fetch(escrowPda);
        depositor = escrowAccount.depositor as PublicKey;
        console.log(`   On-chain: depositor=${depositor.toBase58()}, amount=${escrowAccount.amount?.toString()}`);
      } catch {
        console.log(`   Escrow account closed (already refunded). Marking in DB.`);
        await pool.query(`UPDATE orders SET refund_tx_hash = 'already-closed' WHERE id = $1`, [id]);
        skipped++;
        console.log('');
        continue;
      }

      try {
        const tradeAccount = await (program.account as any).trade.fetch(tradePda);
        creator = tradeAccount.creator as PublicKey;
      } catch {
        creator = creatorPk;
      }

      // Check if our signer matches the depositor/creator
      const signerIsAuthorized =
        payer.publicKey.equals(depositor) || payer.publicKey.equals(creator);

      if (!signerIsAuthorized) {
        console.log(`   SKIP: Signer ${payer.publicKey.toBase58()} is not the depositor/creator.`);
        console.log(`         Need keypair for: ${depositor.toBase58()}`);
        skipped++;
        console.log('');
        continue;
      }

      const depositorAta = await getAssociatedTokenAddress(USDT_MINT, depositor);

      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would refund ${crypto_amount} USDT to ${depositor.toBase58()}`);
        console.log('');
        continue;
      }

      // Build and send refund tx
      const refundIx = await (program.methods as any)
        .refundEscrow()
        .accounts({
          signer: payer.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority,
          vaultAta,
          depositorAta,
          creator,
          mint: USDT_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction().add(refundIx);
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(payer);

      const txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      console.log(`   TX sent: ${txHash}`);

      await connection.confirmTransaction(txHash, 'confirmed');
      console.log(`   Confirmed!`);

      // Update DB
      await pool.query(`UPDATE orders SET refund_tx_hash = $1 WHERE id = $2`, [txHash, id]);
      console.log(`   DB updated.\n`);
      refunded++;
    } catch (e: any) {
      console.error(`   ERROR: ${e.message}`);
      if (e.logs) {
        const errorLog = e.logs.find((l: string) => l.includes('Error Message:'));
        if (errorLog) console.error(`   Program: ${errorLog.trim()}`);
      }
      failed++;
      console.log('');
    }
  }

  await pool.end();
  console.log(`\nSummary: ${refunded} refunded, ${skipped} skipped, ${failed} failed`);
}

main().catch(console.error);
