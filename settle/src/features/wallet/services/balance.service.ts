/**
 * Balance Service — API communication for wallet balance queries
 *
 * Pure async functions for fetching on-chain and off-chain balances.
 * No React state.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getUsdtBalance, getConnection } from '@/lib/solana/escrow';

// ─── Types ────────────────────────────────────────────────────────────

export interface BalanceResult {
  usdt: number;
}

// ─── Service functions ────────────────────────────────────────────────

/** Fetch on-chain USDT balance for a wallet address */
export async function getWalletBalance(
  walletAddress: string,
  network: 'devnet' | 'mainnet-beta' = 'devnet',
): Promise<BalanceResult> {
  const connection = getConnection(network);
  const pubkey = new PublicKey(walletAddress);
  const usdt = await getUsdtBalance(connection, pubkey, network);
  return { usdt };
}

/** Fetch mock balance (dev/demo mode) */
export async function getMockBalance(
  userId: string,
  userType: 'user' | 'merchant',
): Promise<{ balance: number }> {
  const res = await fetch(
    `/api/mock/balance?userId=${encodeURIComponent(userId)}&type=${userType}`,
  );
  if (!res.ok) throw new Error('Failed to fetch mock balance');
  const data = await res.json();
  return data.data ?? { balance: 0 };
}
