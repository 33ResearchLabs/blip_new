/**
 * Emergency Refund V2 - Refund stuck V2.2 orders using the new emergency instruction
 *
 * Usage:
 *   DRY RUN:  npx tsx scripts/emergency-refund-v2.ts
 *   EXECUTE:  npx tsx scripts/emergency-refund-v2.ts --execute
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Constants
const BLIP_V2_PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');
const USDT_DEVNET_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');
const DEVNET_RPC = 'https://api.devnet.solana.com';

// IDL for emergency_refund_v2 instruction
const idl = {
  "version": "2.0.0",
  "name": "blip_protocol_v2",
  "instructions": [
    {
      "name": "emergencyRefundV2",
      "accounts": [
        { "name": "signer", "isMut": true, "isSigner": true },
        { "name": "trade", "isMut": true, "isSigner": false },
        { "name": "escrow", "isMut": true, "isSigner": false },
        { "name": "vaultAuthority", "isMut": false, "isSigner": false },
        { "name": "vaultAta", "isMut": true, "isSigner": false },
        { "name": "depositorAta", "isMut": true, "isSigner": false },
        { "name": "creator", "isMut": true, "isSigner": false },
        { "name": "mint", "isMut": false, "isSigner": false },
        { "name": "tokenProgram", "isMut": false, "isSigner": false }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "Escrow",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "trade", "type": "publicKey" },
          { "name": "vaultAuthority", "type": "publicKey" },
          { "name": "vaultAta", "type": "publicKey" },
          { "name": "depositor", "type": "publicKey" },
          { "name": "amount", "type": "u64" },
          { "name": "bump", "type": "u8" },
          { "name": "vaultBump", "type": "u8" }
        ]
      }
    }
  ],
  "metadata": {
    "address": "6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87"
  }
};

interface StuckOrder {
  id: string;
  order_number: string;
  status: string;
  escrow_trade_pda: string;
  escrow_pda: string;
  escrow_creator_wallet: string;
  crypto_amount: number;
  created_at: Date;
}

const DRY_RUN = !process.argv.includes('--execute');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(msg: string, color?: keyof typeof colors) {
  const c = color ? colors[color] : '';
  console.log(`${c}${msg}${colors.reset}`);
}

function findEscrowPda(tradePda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow-v2'), tradePda.toBuffer()],
    BLIP_V2_PROGRAM_ID
  );
}

function findVaultAuthorityPda(escrowPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority-v2'), escrowPda.toBuffer()],
    BLIP_V2_PROGRAM_ID
  );
}

function loadWallet(): Keypair {
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH ||
    path.join(process.env.HOME || '', '.config/solana/id.json');

  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Wallet keypair not found at ${keypairPath}`);
  }

  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function getDbPool(): Promise<Pool> {
  const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'settle',
        user: process.env.DB_USER || 'zeus',
        password: process.env.DB_PASSWORD || '',
      };

  return new Pool(poolConfig);
}

async function fetchStuckOrders(pool: Pool): Promise<StuckOrder[]> {
  const result = await pool.query<StuckOrder>(`
    SELECT
      id,
      order_number,
      status,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
      crypto_amount,
      created_at
    FROM orders
    WHERE
      escrow_trade_pda IS NOT NULL
      AND escrow_pda IS NOT NULL
      AND refund_tx_hash IS NULL
      AND release_tx_hash IS NULL
      AND status IN ('disputed', 'escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing', 'cancelled')
    ORDER BY created_at ASC
  `);

  return result.rows;
}

async function parseV2TradeAccount(connection: Connection, tradePda: PublicKey): Promise<{ creator: PublicKey; status: number } | null> {
  try {
    const accountInfo = await connection.getAccountInfo(tradePda);
    if (!accountInfo || accountInfo.data.length !== 150) {
      return null;
    }

    // Parse V2.2 format: creator at offset 8-40, status at offset 120
    const creatorBytes = accountInfo.data.slice(8, 40);
    const creator = new PublicKey(creatorBytes);
    const status = accountInfo.data[120];

    return { creator, status };
  } catch (e) {
    return null;
  }
}

async function buildEmergencyRefundTx(
  program: Program,
  connection: Connection,
  signer: PublicKey,
  tradePda: PublicKey,
  mint: PublicKey
): Promise<Transaction> {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);

  // Fetch escrow to get depositor
  const escrow = await (program.account as any).escrow.fetch(escrowPda);
  const depositorAta = await getAssociatedTokenAddress(mint, escrow.depositor);

  // Parse trade to get creator
  const tradeData = await parseV2TradeAccount(connection, tradePda);
  if (!tradeData) {
    throw new Error('Could not parse V2.2 trade account');
  }

  const instruction = await (program.methods as any)
    .emergencyRefundV2()
    .accounts({
      signer,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta,
      creator: tradeData.creator,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

async function updateOrderRefund(pool: Pool, orderId: string, txHash: string): Promise<void> {
  await pool.query(
    `UPDATE orders
     SET refund_tx_hash = $1,
         status = 'cancelled',
         cancelled_at = NOW(),
         cancelled_by = 'system',
         cancellation_reason = 'Emergency V2.2 refund'
     WHERE id = $2`,
    [txHash, orderId]
  );
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('🚨 Emergency V2.2 Refund Script', 'cyan');
  console.log('='.repeat(60) + '\n');

  if (DRY_RUN) {
    log('⚠️  DRY RUN MODE - No transactions will be sent', 'yellow');
    log('   Run with --execute to actually refund orders\n', 'yellow');
  } else {
    log('🚨 EXECUTE MODE - Transactions WILL be sent!', 'red');
    log('   Press Ctrl+C within 3 seconds to abort...\n', 'red');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  const wallet = loadWallet();
  log(`📝 Wallet: ${wallet.publicKey.toBase58()}`, 'blue');

  const rpcUrl = process.env.SOLANA_RPC_URL || DEVNET_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  log(`🌐 RPC: ${rpcUrl}`, 'blue');

  const balance = await connection.getBalance(wallet.publicKey);
  log(`💰 SOL Balance: ${(balance / 1e9).toFixed(4)} SOL\n`, 'blue');

  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as any, BLIP_V2_PROGRAM_ID, provider);

  const pool = await getDbPool();
  log('✅ Connected to database\n', 'green');

  const stuckOrders = await fetchStuckOrders(pool);

  if (stuckOrders.length === 0) {
    log('✅ No stuck orders found!', 'green');
    await pool.end();
    return;
  }

  log(`📋 Found ${stuckOrders.length} stuck orders:\n`, 'magenta');

  const results: { order: StuckOrder; success: boolean; txHash?: string; error?: string }[] = [];

  for (const order of stuckOrders) {
    console.log('-'.repeat(50));
    log(`Order #${order.order_number}`, 'cyan');
    log(`  Amount: ${order.crypto_amount} USDT`);
    log(`  Trade PDA: ${order.escrow_trade_pda}`);

    try {
      const tradePda = new PublicKey(order.escrow_trade_pda);

      // Parse the V2.2 trade account
      const tradeData = await parseV2TradeAccount(connection, tradePda);
      if (!tradeData) {
        log(`  ⚠️  Could not parse trade account`, 'yellow');
        results.push({ order, success: false, error: 'Could not parse trade account' });
        continue;
      }

      const statusNames = ['Created', 'Locked', 'Released', 'Refunded'];
      log(`  V2.2 Status: ${statusNames[tradeData.status] || 'Unknown'} (${tradeData.status})`, 'blue');
      log(`  Creator: ${tradeData.creator.toBase58()}`, 'blue');

      // Check if already settled
      if (tradeData.status >= 2) {
        log(`  ✅ Already settled`, 'green');
        results.push({ order, success: true, txHash: 'already-settled' });
        continue;
      }

      if (DRY_RUN) {
        log(`  → Would execute emergency refund`, 'yellow');
        results.push({ order, success: true, txHash: 'dry-run' });
        continue;
      }

      // Execute emergency refund
      log(`  🔄 Executing emergency refund...`, 'cyan');

      const tx = await buildEmergencyRefundTx(
        program,
        connection,
        wallet.publicKey,
        tradePda,
        USDT_DEVNET_MINT
      );

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const txHash = await sendAndConfirmTransaction(connection, tx, [wallet], {
        commitment: 'confirmed',
      });

      log(`  ✅ Refunded! TX: ${txHash}`, 'green');

      await updateOrderRefund(pool, order.id, txHash);
      log(`  ✅ Database updated`, 'green');

      results.push({ order, success: true, txHash });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ❌ Error: ${errorMsg}`, 'red');
      results.push({ order, success: false, error: errorMsg });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  log('📊 SUMMARY', 'cyan');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  log(`\n✅ Successful: ${successful.length}`, 'green');
  log(`❌ Failed: ${failed.length}`, failed.length > 0 ? 'red' : 'green');

  if (failed.length > 0) {
    log('\nFailed orders:', 'red');
    for (const { order, error } of failed) {
      log(`  - #${order.order_number}: ${error}`, 'red');
    }
  }

  if (DRY_RUN) {
    log('\n⚠️  This was a dry run. Run with --execute to actually refund.', 'yellow');
  }

  await pool.end();
  console.log('\n✅ Done!\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  });
