/**
 * Hardened on-chain USDT balance read.
 *
 * Extracted/hardened from POST /api/merchant/sync-balance. The crucial
 * difference: this distinguishes a CONFIDENT read (the ATA was read, OR the ATA
 * is provably absent → genuinely 0 USDT) from an UNKNOWN read (RPC down,
 * timeout, network blip). It returns `confident: false` for the latter so NO
 * caller ever overwrites a good DB balance with a wrong/zero value on a
 * transient error. This is the central safeguard for the balance reconciler.
 *
 * Read-only: opens no transaction, signs nothing, mutates nothing.
 */

import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { getBackendConnection } from './backendSigner';
import { getUsdtMint } from './v2/config';

export type OnChainBalanceResult =
  | { confident: true; balance: number }
  | { confident: false; balance: null; reason: string };

/** Errors that mean "the token account genuinely does not exist" → a real 0. */
function isAccountAbsent(message: string): boolean {
  return (
    /could not find account/i.test(message) ||
    /account does not exist/i.test(message) ||
    /TokenAccountNotFound/i.test(message) ||
    /failed to find account/i.test(message)
  );
}

/**
 * Read a wallet's on-chain USDT balance (whole tokens, 6-decimals applied).
 * Returns confident:true only when the value is trustworthy.
 */
export async function readOnChainUsdtBalance(
  walletAddress: string | null | undefined,
): Promise<OnChainBalanceResult> {
  if (!walletAddress) {
    return { confident: false, balance: null, reason: 'no_wallet_address' };
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    return { confident: false, balance: null, reason: 'invalid_wallet_address' };
  }

  try {
    const connection = getBackendConnection();
    const usdtMint = getUsdtMint();
    const ata = await getAssociatedTokenAddress(usdtMint, owner);
    const account = await getAccount(connection, ata);
    return { confident: true, balance: Number(account.amount) / 1_000_000 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ATA truly not initialised → confidently 0 USDT on-chain.
    if (isAccountAbsent(msg)) {
      return { confident: true, balance: 0 };
    }
    // Anything else (RPC failure, timeout, rate limit) → UNKNOWN. Never 0.
    return { confident: false, balance: null, reason: msg.slice(0, 200) };
  }
}
