/**
 * On-chain verification of escrow-lock transactions.
 *
 * We verify the *effect* (USDT balance delta on the expected trade vault
 * ATA), not individual instruction shapes. This is path-agnostic: it holds
 * whether the client used `match_offer_and_lock_from_lane` (lane vault →
 * trade vault) or two-step `create_trade` + `lock_escrow` (depositor ATA
 * → trade vault). In both cases the trade vault ends up with the expected
 * amount of the expected mint, owned by the trade_vault_authority PDA
 * derived from the escrow PDA — an attacker cannot forge that delta
 * without actually interacting with the program for this specific trade.
 */

import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import {
  BLIP_V2_PROGRAM_ID,
  getUsdtMint,
} from './v2/config';
import { findEscrowPda, findVaultAuthorityPda } from './v2/pdas';

/** Signature validation — base58 check keeps RPC load down on obvious junk. */
const BASE58_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

export type VerifyEscrowFailure =
  | 'BAD_SIGNATURE_FORMAT'
  | 'TX_NOT_FOUND'
  | 'TX_NOT_CONFIRMED'
  | 'TX_FAILED'
  | 'PROGRAM_NOT_INVOKED'
  | 'TRADE_PDA_NOT_IN_TX'
  | 'VAULT_DELTA_NOT_FOUND'
  | 'AMOUNT_MISMATCH'
  | 'MINT_MISMATCH'
  | 'CREATOR_WALLET_NOT_IN_TX'
  | 'RPC_ERROR';

export type VerifyEscrowResult =
  | {
      ok: true;
      slot: number;
      blockTime: number | null;
      vaultAta: string;
      observedRawAmount: bigint;
      expectedRawAmount: bigint;
    }
  | {
      ok: false;
      code: VerifyEscrowFailure;
      detail: string;
    };

export interface VerifyEscrowInput {
  txHash: string;
  /** String pubkey of the on-chain Trade PDA submitted by the client. */
  tradePda: string;
  /** Human-readable USDT amount from the order, e.g. 100.5 */
  expectedAmount: number | string;
  /** 'USDT' — only supported currency today. */
  currency: string;
  network: 'devnet' | 'mainnet-beta';
  /** Optional — must appear somewhere in accountKeys if provided. */
  creatorWallet?: string | null;
}

/** Convert a human USDT amount to raw base units (6 decimals), exact. */
export function toRawUsdt(amount: number | string): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  // whole * 10^6 + frac (already in 10^-6 units)
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fracPadded || '0');
}

function fail(code: VerifyEscrowFailure, detail: string): VerifyEscrowResult {
  return { ok: false, code, detail };
}

/**
 * Extract the net SPL token delta on a specific (mint, owner) vault from a
 * parsed transaction. Returns raw base units (bigint) or null if the vault
 * doesn't appear in post balances (meaning no funds landed there).
 */
export function extractSplVaultDelta(
  tx: ParsedTransactionWithMeta,
  expectedVaultOwner: PublicKey,
  expectedMint: PublicKey,
): bigint | null {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const match = (b: TokenBalance) =>
    b.mint === expectedMint.toBase58() &&
    b.owner === expectedVaultOwner.toBase58();

  const postEntry = post.find(match);
  if (!postEntry) return null;

  const preEntry = pre.find(
    (b) =>
      b.accountIndex === postEntry.accountIndex &&
      b.mint === postEntry.mint,
  );

  const postRaw = BigInt(postEntry.uiTokenAmount.amount);
  const preRaw = preEntry ? BigInt(preEntry.uiTokenAmount.amount) : BigInt(0);
  return postRaw - preRaw;
}

export async function verifyEscrowTx(
  connection: Connection,
  input: VerifyEscrowInput,
): Promise<VerifyEscrowResult> {
  // ---- 1. Cheap input guards (avoid wasted RPC calls) ----------------
  if (!BASE58_SIG_RE.test(input.txHash)) {
    return fail('BAD_SIGNATURE_FORMAT', 'tx_hash is not a valid base58 signature');
  }

  // Only USDT is supported today. Fail closed on anything else.
  if (input.currency !== 'USDT') {
    return fail('MINT_MISMATCH', `unsupported currency ${input.currency}`);
  }

  let tradePda: PublicKey;
  try {
    tradePda = new PublicKey(input.tradePda);
  } catch {
    return fail('BAD_SIGNATURE_FORMAT', 'tradePda is not a valid pubkey');
  }

  const expectedMint = getUsdtMint(input.network);
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const expectedVaultAta = await getAssociatedTokenAddress(
    expectedMint,
    vaultAuthority,
    true, // allowOwnerOffCurve — vault_authority is a PDA
  );

  let expectedRaw: bigint;
  try {
    expectedRaw = toRawUsdt(input.expectedAmount);
  } catch (e) {
    return fail('AMOUNT_MISMATCH', (e as Error).message);
  }

  // ---- 2. Fetch the transaction --------------------------------------
  let tx: ParsedTransactionWithMeta | null;
  try {
    tx = await connection.getParsedTransaction(input.txHash, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
  } catch (e) {
    return fail('RPC_ERROR', (e as Error).message);
  }

  if (!tx) {
    // Transaction not yet landed (or never existed). Caller should retry;
    // we do NOT accept the lock until confirmation.
    return fail('TX_NOT_CONFIRMED', 'Transaction not found at confirmed commitment');
  }

  if (!tx.meta) {
    return fail('TX_NOT_FOUND', 'Transaction has no meta');
  }

  if (tx.meta.err) {
    return fail('TX_FAILED', `on-chain error: ${JSON.stringify(tx.meta.err)}`);
  }

  // ---- 3. Program-level binding --------------------------------------
  // Every instruction's programId is exposed in message.instructions — confirm
  // at least one invoked the Blip V2 program. Inner instructions are also
  // inspected to cover CPI-only entry points.
  const programIdStr = BLIP_V2_PROGRAM_ID.toBase58();
  const touchedProgram = (() => {
    for (const ix of tx.transaction.message.instructions) {
      if ((ix as { programId?: PublicKey }).programId?.toBase58() === programIdStr) {
        return true;
      }
    }
    for (const inner of tx.meta.innerInstructions ?? []) {
      for (const ix of inner.instructions) {
        if ((ix as { programId?: PublicKey }).programId?.toBase58() === programIdStr) {
          return true;
        }
      }
    }
    return false;
  })();
  if (!touchedProgram) {
    return fail(
      'PROGRAM_NOT_INVOKED',
      `tx does not invoke Blip V2 program ${programIdStr}`,
    );
  }

  // ---- 4. Trade PDA must be an account key of this tx ----------------
  const accountKeys = tx.transaction.message.accountKeys.map((k) =>
    ('pubkey' in k ? k.pubkey : k).toString(),
  );
  if (!accountKeys.includes(tradePda.toBase58())) {
    return fail(
      'TRADE_PDA_NOT_IN_TX',
      `Trade PDA ${tradePda.toBase58()} not referenced by this tx`,
    );
  }

  // ---- 5. (Optional) creator wallet must appear as account key -------
  if (input.creatorWallet) {
    if (!accountKeys.includes(input.creatorWallet)) {
      return fail(
        'CREATOR_WALLET_NOT_IN_TX',
        `claimed creator wallet ${input.creatorWallet} is not in tx account keys`,
      );
    }
  }

  // ---- 6. Token balance delta on the trade vault ATA -----------------
  const delta = extractSplVaultDelta(tx, vaultAuthority, expectedMint);
  if (delta === null) {
    return fail(
      'VAULT_DELTA_NOT_FOUND',
      `No post-token balance entry for (mint=${expectedMint.toBase58()}, owner=${vaultAuthority.toBase58()})`,
    );
  }
  if (delta !== expectedRaw) {
    return fail(
      'AMOUNT_MISMATCH',
      `vault delta=${delta.toString()} != expected=${expectedRaw.toString()} (raw USDT base units)`,
    );
  }

  return {
    ok: true,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    vaultAta: expectedVaultAta.toBase58(),
    observedRawAmount: delta,
    expectedRawAmount: expectedRaw,
  };
}
