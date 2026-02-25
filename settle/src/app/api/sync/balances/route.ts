import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { getUsdtMint } from '@/lib/solana/v2/config';
import { query } from '@/lib/db';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet-beta';

interface SyncResult {
  merchant_id: string;
  username: string;
  wallet: string;
  db_balance: number;
  onchain_balance: number;
  diff: number;
  updated: boolean;
}

/**
 * Check if a string is a valid Solana public key (not a MOCK_ address)
 */
function isRealWallet(address: string): boolean {
  if (!address || address.startsWith('MOCK_') || address.startsWith('Merchant')) return false;
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/sync/balances — dry run (show diffs without updating)
 * POST /api/sync/balances — apply sync (update DB balances to match on-chain)
 */
export async function GET() {
  return syncBalances(false);
}

export async function POST() {
  return syncBalances(true);
}

async function syncBalances(apply: boolean) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const mint = getUsdtMint(NETWORK);

  // Get all merchants with wallet addresses
  const merchants = await query<{
    id: string;
    username: string;
    wallet_address: string;
    balance: string;
  }>(`SELECT id, username, wallet_address, balance FROM merchants WHERE wallet_address IS NOT NULL`);

  const results: SyncResult[] = [];
  const errors: { username: string; wallet: string; error: string }[] = [];

  for (const m of merchants) {
    if (!isRealWallet(m.wallet_address)) continue;

    try {
      const walletPubkey = new PublicKey(m.wallet_address);
      const ata = await getAssociatedTokenAddress(mint, walletPubkey);

      let onchainBalance = 0;
      try {
        const tokenAccount = await getAccount(connection, ata);
        // Token has 6 decimals (USDT standard)
        onchainBalance = Number(tokenAccount.amount) / 1e6;
      } catch (e: any) {
        // Token account doesn't exist = 0 balance
        if (e.name === 'TokenAccountNotFoundError') {
          onchainBalance = 0;
        } else {
          throw e;
        }
      }

      const dbBalance = Number(m.balance) || 0;
      const diff = onchainBalance - dbBalance;

      const result: SyncResult = {
        merchant_id: m.id,
        username: m.username,
        wallet: m.wallet_address,
        db_balance: dbBalance,
        onchain_balance: onchainBalance,
        diff,
        updated: false,
      };

      if (apply && Math.abs(diff) > 0.001) {
        await query(
          `UPDATE merchants SET balance = $1 WHERE id = $2`,
          [onchainBalance, m.id]
        );
        result.updated = true;

        // Record in ledger
        await query(
          `INSERT INTO ledger_entries (account_id, account_type, entry_type, amount, asset, balance_before, balance_after, description, created_at)
           VALUES ($1, 'merchant', 'ADJUSTMENT', $2, 'USDT', $3, $4, $5, NOW())`,
          [m.id, diff, dbBalance, onchainBalance, `Balance sync: DB ${dbBalance.toFixed(2)} -> on-chain ${onchainBalance.toFixed(2)}`]
        );
      }

      results.push(result);
    } catch (e: any) {
      errors.push({
        username: m.username,
        wallet: m.wallet_address,
        error: e.message || String(e),
      });
    }
  }

  const totalDbBalance = results.reduce((s, r) => s + r.db_balance, 0);
  const totalOnchain = results.reduce((s, r) => s + r.onchain_balance, 0);

  return NextResponse.json({
    success: true,
    mode: apply ? 'applied' : 'dry_run',
    summary: {
      merchants_checked: results.length,
      merchants_with_diff: results.filter(r => Math.abs(r.diff) > 0.001).length,
      merchants_updated: results.filter(r => r.updated).length,
      total_db_balance: totalDbBalance,
      total_onchain_balance: totalOnchain,
      total_diff: totalOnchain - totalDbBalance,
    },
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}
