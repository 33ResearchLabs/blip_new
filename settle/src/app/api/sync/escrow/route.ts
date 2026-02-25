import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { getUsdtMint, BLIP_V2_PROGRAM_ID } from '@/lib/solana/v2/config';
import { findEscrowPda, findVaultAuthorityPda, findTradePda } from '@/lib/solana/v2/pdas';
import { query } from '@/lib/db';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet-beta';

interface StuckEscrow {
  order_id: string;
  order_number: string;
  status: string;
  crypto_amount: number;
  escrow_tx_hash: string;
  escrow_creator_wallet: string;
  escrow_trade_id: number;
  onchain_status: string;
  vault_balance: number;
  depositor: string;
  trade_expired: boolean;
  action_needed: string;
}

/**
 * GET /api/sync/escrow — Scan for stuck escrows
 * Finds orders where DB says cancelled/expired but on-chain vault still has funds.
 * Also finds orders with escrow on-chain but no escrow_tx_hash in DB.
 */
export async function GET() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const mint = getUsdtMint(NETWORK);

  // 1. Find orders with escrow fields set but no refund
  const dbStuck = await query<{
    id: string;
    order_number: string;
    status: string;
    crypto_amount: string;
    escrow_tx_hash: string;
    escrow_creator_wallet: string;
    escrow_trade_id: string;
    refund_tx_hash: string | null;
    release_tx_hash: string | null;
  }>(`
    SELECT id, order_number, status, crypto_amount, escrow_tx_hash,
           escrow_creator_wallet, escrow_trade_id, refund_tx_hash, release_tx_hash
    FROM orders
    WHERE escrow_tx_hash IS NOT NULL
      AND escrow_tx_hash NOT LIKE 'mock-%'
      AND escrow_tx_hash NOT LIKE 'demo-%'
      AND escrow_tx_hash NOT LIKE 'test-%'
      AND escrow_trade_id IS NOT NULL
      AND escrow_creator_wallet IS NOT NULL
      AND refund_tx_hash IS NULL
      AND release_tx_hash IS NULL
    ORDER BY created_at DESC
  `);

  // 2. Also find cancelled/expired orders where escrow fields are missing
  // (like the 4A3410A9 bug — on-chain escrow exists but DB doesn't know)
  const dbMissing = await query<{
    id: string;
    order_number: string;
    status: string;
    crypto_amount: string;
    merchant_id: string;
    buyer_merchant_id: string | null;
  }>(`
    SELECT id, order_number, status, crypto_amount, merchant_id, buyer_merchant_id
    FROM orders
    WHERE status IN ('cancelled', 'expired')
      AND escrow_tx_hash IS NULL
      AND crypto_amount > 0
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
  `);

  const results: StuckEscrow[] = [];
  const errors: { order_number: string; error: string }[] = [];

  // Check known escrows
  for (const order of dbStuck) {
    try {
      const creatorPk = new PublicKey(order.escrow_creator_wallet);
      const tradeId = Number(order.escrow_trade_id);
      const [tradePda] = findTradePda(creatorPk, tradeId);
      const [escrowPda] = findEscrowPda(tradePda);
      const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
      const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);

      let vaultBalance = 0;
      let onchainStatus = 'unknown';
      let depositor = '';
      let tradeExpired = false;

      // Check vault balance
      try {
        const tokenAcct = await getAccount(connection, vaultAta);
        vaultBalance = Number(tokenAcct.amount) / 1e6;
      } catch (e: any) {
        if (e.name === 'TokenAccountNotFoundError') {
          vaultBalance = 0;
          onchainStatus = 'vault_empty';
        }
      }

      // Read trade state
      try {
        const idl = JSON.parse(fs.readFileSync(
          path.resolve(process.cwd(), 'src/lib/solana/v2/idl.json'), 'utf8'
        ));
        const provider = new AnchorProvider(connection, {} as any, { commitment: 'confirmed' });
        const program = new Program(idl as any, BLIP_V2_PROGRAM_ID, provider);

        const trade = await (program.account as any).trade.fetch(tradePda);
        onchainStatus = Object.keys(trade.status)[0] || 'unknown';
        const expiresAt = trade.expiresAt?.toNumber() || 0;
        tradeExpired = expiresAt > 0 && Date.now() / 1000 > expiresAt;

        const escrow = await (program.account as any).escrow.fetch(escrowPda);
        depositor = (escrow.depositor as PublicKey).toBase58();
      } catch {
        // Account might be closed already
      }

      // Determine if stuck
      const isStuck = vaultBalance > 0 && ['cancelled', 'expired'].includes(order.status);
      const alreadyHandled = vaultBalance === 0;

      if (isStuck) {
        results.push({
          order_id: order.id,
          order_number: order.order_number,
          status: order.status,
          crypto_amount: Number(order.crypto_amount),
          escrow_tx_hash: order.escrow_tx_hash,
          escrow_creator_wallet: order.escrow_creator_wallet,
          escrow_trade_id: Number(order.escrow_trade_id),
          onchain_status: onchainStatus,
          vault_balance: vaultBalance,
          depositor,
          trade_expired: tradeExpired,
          action_needed: tradeExpired
            ? 'REFUND_READY (trade expired, depositor can refund)'
            : 'WAITING_EXPIRY (trade not yet expired)',
        });
      }
    } catch (e: any) {
      errors.push({ order_number: order.order_number, error: e.message });
    }
  }

  return NextResponse.json({
    success: true,
    summary: {
      orders_with_escrow: dbStuck.length,
      stuck_escrows: results.length,
      orders_missing_escrow_fields: dbMissing.length,
      total_stuck_value: results.reduce((s, r) => s + r.vault_balance, 0),
    },
    stuck: results,
    missing_escrow_fields: dbMissing.map(o => ({
      order_number: o.order_number,
      status: o.status,
      crypto_amount: Number(o.crypto_amount),
      note: 'Cancelled/expired order with no escrow tracking — may have on-chain escrow. Needs manual check.',
    })),
    errors: errors.length > 0 ? errors : undefined,
  });
}
