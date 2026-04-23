/**
 * Server-side USDT balance lookup for a merchant's on-chain wallet.
 *
 * The bid-liquidity filter was originally wired to `merchants.balance` (the
 * DB column). That column is only maintained by the mock/in-app settlement
 * paths and stays at zero for wallets settled on-chain — which caused every
 * real-chain merchant to be rejected with `balance=0 < {amount}`. This
 * helper reads the authoritative source: the merchant's USDT associated
 * token account on Solana.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from '@solana/spl-token';
import { getBackendConnection } from './backendSigner';
import { getUsdtMint } from './v2/config';

const SOLANA_NETWORK: 'devnet' | 'mainnet-beta' =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';

const USDT_DECIMALS = 1_000_000;

// In-memory cache: avoids hammering the RPC when a merchant resubmits bids
// inside an auction window. Short TTL so a fresh settlement is picked up
// before the next auction opens.
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: number; fetchedAt: number }>();

export class OnChainBalanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnChainBalanceUnavailableError';
  }
}

/**
 * Read the USDT balance (display units) held by `walletAddress` on Solana.
 * Returns 0 when the ATA does not exist yet (wallet never received USDT).
 * Throws `OnChainBalanceUnavailableError` for RPC/network failures so the
 * caller can fail closed.
 */
export async function getOnChainUsdtBalance(walletAddress: string): Promise<number> {
  const cached = cache.get(walletAddress);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    throw new OnChainBalanceUnavailableError('invalid wallet address');
  }

  const connection: Connection = getBackendConnection();
  const mint = getUsdtMint(SOLANA_NETWORK);

  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const tokenAccount = await getAccount(connection, ata);
    const balance = Number(tokenAccount.amount) / USDT_DECIMALS;
    cache.set(walletAddress, { value: balance, fetchedAt: Date.now() });
    return balance;
  } catch (err) {
    // ATA not yet created = wallet has never received USDT. That's a legit
    // zero balance, not an RPC failure.
    if (err instanceof TokenAccountNotFoundError) {
      cache.set(walletAddress, { value: 0, fetchedAt: Date.now() });
      return 0;
    }
    throw new OnChainBalanceUnavailableError(
      err instanceof Error ? err.message : 'RPC lookup failed',
    );
  }
}
