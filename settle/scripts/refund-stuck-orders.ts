/**
 * Refund All Stuck Orders in Blip Escrow Protocol
 *
 * This script finds orders stuck in escrow and refunds them.
 *
 * Usage:
 *   DRY RUN (default): npx ts-node scripts/refund-stuck-orders.ts
 *   EXECUTE:           npx ts-node scripts/refund-stuck-orders.ts --execute
 *
 * Prerequisites:
 *   - Set DATABASE_URL or individual DB_* env vars
 *   - Have a funded wallet at ~/.config/solana/id.json (or set SOLANA_KEYPAIR_PATH)
 */

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Import from v2 library - use explicit file paths for Node compatibility
import {
  BLIP_V2_PROGRAM_ID,
  USDT_DEVNET_MINT,
  DEVNET_RPC,
} from '../src/lib/solana/v2/config';
import {
  findTradePda,
  findEscrowPda,
  findVaultAuthorityPda,
  findProtocolConfigPda,
} from '../src/lib/solana/v2/pdas';
import {
  buildRefundEscrowTx,
} from '../src/lib/solana/v2/program';
// Use V2.2 IDL which matches the deployed program (not V2.3)
import idl from '../../blipscan/indexer/blip_protocol_v2_idl.json';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Types
interface StuckOrder {
  id: string;
  order_number: string;
  status: string;
  escrow_trade_id: number;
  escrow_trade_pda: string;
  escrow_pda: string;
  escrow_creator_wallet: string;
  crypto_amount: number;
  created_at: Date;
}

interface OnChainTradeStatus {
  status: string;
  amount: number;
  depositor: string;
  canRefundDirectly: boolean;
  needsDisputeResolution: boolean;
  alreadySettled: boolean;
}

// Configuration
const DRY_RUN = !process.argv.includes('--execute');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

// Colors for console output
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

function loadWallet(): Keypair {
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH ||
    path.join(process.env.HOME || '', '.config/solana/id.json');

  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Wallet keypair not found at ${keypairPath}. Set SOLANA_KEYPAIR_PATH env var.`);
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
      escrow_trade_id,
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

async function fetchOnChainTradeStatus(
  program: Program,
  tradePda: PublicKey
): Promise<OnChainTradeStatus | null> {
  try {
    const tradeAccount = await (program.account as any).trade.fetch(tradePda);
    const [escrowPda] = findEscrowPda(tradePda);
    const escrowAccount = await (program.account as any).escrow.fetch(escrowPda);

    // Determine on-chain status
    const statusKey = Object.keys(tradeAccount.status)[0];
    const amount = Number(escrowAccount.amount) / 1e6; // USDT has 6 decimals
    const depositor = escrowAccount.depositor.toBase58();

    // Check if already settled
    const alreadySettled = ['released', 'refunded'].includes(statusKey.toLowerCase());

    // Can refund directly: Created, Funded, Locked (before payment confirmation)
    const canRefundDirectly = ['created', 'funded', 'locked'].includes(statusKey.toLowerCase());

    // Needs dispute resolution: PaymentSent, Disputed
    const needsDisputeResolution = ['paymentsent', 'disputed'].includes(statusKey.toLowerCase());

    return {
      status: statusKey,
      amount,
      depositor,
      canRefundDirectly,
      needsDisputeResolution,
      alreadySettled,
    };
  } catch (error) {
    if (VERBOSE) {
      console.error('Error fetching on-chain trade:', error);
    }
    return null;
  }
}

async function refundDirectly(
  program: Program,
  connection: Connection,
  wallet: Keypair,
  tradePda: PublicKey,
  mint: PublicKey
): Promise<string> {
  const tx = await buildRefundEscrowTx(program, wallet.publicKey, {
    tradePda,
    mint,
  });

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const txHash = await sendAndConfirmTransaction(connection, tx, [wallet], {
    commitment: 'confirmed',
  });

  return txHash;
}

async function resolveDisputeAsRefund(
  program: Program,
  connection: Connection,
  wallet: Keypair,
  tradePda: PublicKey,
  mint: PublicKey
): Promise<string> {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);

  // Fetch escrow to get depositor
  const escrow = await (program.account as any).escrow.fetch(escrowPda);
  const depositorAta = await getAssociatedTokenAddress(mint, escrow.depositor);

  // Fetch trade to get creator
  const tradeAccount = await (program.account as any).trade.fetch(tradePda);
  const creator = tradeAccount.creator as PublicKey;

  // Get treasury ATA
  const protocolConfig = await (program.account as any).protocolConfig.fetch(protocolConfigPda);
  const treasuryAta = await getAssociatedTokenAddress(mint, protocolConfig.treasury);

  // Build resolve dispute instruction - RefundToSeller resolution
  const resolveIx = await (program.methods as any)
    .resolveDispute({ refundToSeller: {} })
    .accounts({
      arbiter: wallet.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      recipientAta: depositorAta, // Refund goes to depositor
      treasuryAta,
      creator,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const { Transaction } = await import('@solana/web3.js');
  const tx = new Transaction().add(resolveIx);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const txHash = await sendAndConfirmTransaction(connection, tx, [wallet], {
    commitment: 'confirmed',
  });

  return txHash;
}

async function updateOrderRefund(pool: Pool, orderId: string, txHash: string): Promise<void> {
  await pool.query(
    `UPDATE orders
     SET refund_tx_hash = $1,
         status = 'cancelled',
         cancelled_at = NOW(),
         cancelled_by = 'system',
         cancellation_reason = 'Bulk refund of stuck orders'
     WHERE id = $2`,
    [txHash, orderId]
  );
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('🔄 Blip Escrow - Refund Stuck Orders', 'cyan');
  console.log('='.repeat(60) + '\n');

  if (DRY_RUN) {
    log('⚠️  DRY RUN MODE - No transactions will be sent', 'yellow');
    log('   Run with --execute to actually refund orders\n', 'yellow');
  } else {
    log('🚨 EXECUTE MODE - Transactions WILL be sent!', 'red');
    log('   Press Ctrl+C within 5 seconds to abort...\n', 'red');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Load wallet
  const wallet = loadWallet();
  log(`📝 Wallet: ${wallet.publicKey.toBase58()}`, 'blue');

  // Connect to Solana
  const rpcUrl = process.env.SOLANA_RPC_URL || DEVNET_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  log(`🌐 RPC: ${rpcUrl}`, 'blue');

  // Get wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  log(`💰 SOL Balance: ${(balance / 1e9).toFixed(4)} SOL\n`, 'blue');

  if (balance < 0.01 * 1e9 && !DRY_RUN) {
    log('❌ Insufficient SOL balance for transaction fees', 'red');
    process.exit(1);
  }

  // Create Anchor program
  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
  const program = new Program(idl as any, BLIP_V2_PROGRAM_ID, provider);

  // Connect to database
  const pool = await getDbPool();
  log('✅ Connected to database\n', 'green');

  // Fetch stuck orders
  const stuckOrders = await fetchStuckOrders(pool);

  if (stuckOrders.length === 0) {
    log('✅ No stuck orders found!', 'green');
    await pool.end();
    return;
  }

  log(`📋 Found ${stuckOrders.length} stuck orders:\n`, 'magenta');

  // Process each order
  const results: { order: StuckOrder; success: boolean; txHash?: string; error?: string }[] = [];

  for (const order of stuckOrders) {
    console.log('-'.repeat(50));
    log(`Order #${order.order_number}`, 'cyan');
    log(`  ID: ${order.id}`);
    log(`  DB Status: ${order.status}`);
    log(`  Amount: ${order.crypto_amount} USDT`);
    log(`  Created: ${order.created_at}`);
    log(`  Trade PDA: ${order.escrow_trade_pda}`);

    try {
      const tradePda = new PublicKey(order.escrow_trade_pda);
      const onChainStatus = await fetchOnChainTradeStatus(program, tradePda);

      if (!onChainStatus) {
        log(`  ⚠️  Could not fetch on-chain status - account may not exist`, 'yellow');
        results.push({ order, success: false, error: 'Account not found on-chain' });
        continue;
      }

      log(`  On-chain Status: ${onChainStatus.status}`, 'blue');
      log(`  On-chain Amount: ${onChainStatus.amount} USDT`, 'blue');

      if (onChainStatus.alreadySettled) {
        log(`  ✅ Already settled (${onChainStatus.status})`, 'green');
        results.push({ order, success: true, txHash: 'already-settled' });
        continue;
      }

      if (DRY_RUN) {
        if (onChainStatus.canRefundDirectly) {
          log(`  → Would refund directly`, 'yellow');
        } else if (onChainStatus.needsDisputeResolution) {
          log(`  → Would resolve dispute as refund to seller`, 'yellow');
        } else {
          log(`  → Unknown state, skipping`, 'yellow');
        }
        results.push({ order, success: true, txHash: 'dry-run' });
        continue;
      }

      // Execute refund
      let txHash: string;
      const mint = USDT_DEVNET_MINT;

      if (onChainStatus.canRefundDirectly) {
        log(`  🔄 Executing direct refund...`, 'cyan');
        txHash = await refundDirectly(program, connection, wallet, tradePda, mint);
      } else if (onChainStatus.needsDisputeResolution) {
        log(`  🔄 Resolving dispute as refund...`, 'cyan');
        txHash = await resolveDisputeAsRefund(program, connection, wallet, tradePda, mint);
      } else {
        log(`  ⚠️  Unknown state: ${onChainStatus.status}, skipping`, 'yellow');
        results.push({ order, success: false, error: `Unknown state: ${onChainStatus.status}` });
        continue;
      }

      log(`  ✅ Refunded! TX: ${txHash}`, 'green');

      // Update database
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
