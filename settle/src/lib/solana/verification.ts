/**
 * On-Chain State Verification for Blip Protocol V2.2
 *
 * CRITICAL: Always verify on-chain state before performing actions.
 * This prevents failed transactions and ensures consistency.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { findTradePda, findEscrowPda } from './v2/pdas';

/**
 * Trade status enum (matches on-chain Rust enum)
 */
export enum TradeStatus {
  Created = 'Created',
  Locked = 'Locked',
  Released = 'Released',
  Refunded = 'Refunded',
}

/**
 * Verification result interface
 */
export interface VerificationResult {
  canProceed: boolean;
  error?: string;
  status?: string;
  details?: any;
}

/**
 * Verify that a trade can be released
 *
 * Checks:
 * 1. Trade account exists
 * 2. Escrow account exists
 * 3. Trade status is "Locked"
 * 4. Caller is authorized (creator)
 *
 * @param connection Solana connection
 * @param program Anchor program instance
 * @param tradePda Trade PDA address
 * @param releaser PublicKey of the wallet attempting to release
 */
export async function verifyCanRelease(
  connection: Connection,
  program: Program,
  tradePda: PublicKey,
  releaser: PublicKey
): Promise<VerificationResult> {
  try {
    console.log('[Verification] Checking if trade can be released...', {
      tradePda: tradePda.toString(),
      releaser: releaser.toString(),
    });

    // Fetch trade account
    let tradeAccount: any;
    try {
      tradeAccount = await program.account.trade.fetch(tradePda);
    } catch (error) {
      return {
        canProceed: false,
        error: 'Trade account not found. Trade may not exist or PDA derivation is incorrect.',
      };
    }

    console.log('[Verification] Trade account fetched:', {
      creator: tradeAccount.creator.toString(),
      counterparty: tradeAccount.counterparty?.toString(),
      status: tradeAccount.status,
      amount: tradeAccount.amount.toString(),
    });

    // Check if status is Locked
    const statusKey = Object.keys(tradeAccount.status)[0];
    if (statusKey !== 'locked') {
      return {
        canProceed: false,
        error: `Trade status is "${statusKey}", must be "locked" to release. Current status: ${JSON.stringify(tradeAccount.status)}`,
        status: statusKey,
      };
    }

    // Verify releaser is the creator
    if (!tradeAccount.creator.equals(releaser)) {
      return {
        canProceed: false,
        error: `Only the creator can release. Creator: ${tradeAccount.creator.toString()}, Releaser: ${releaser.toString()}`,
      };
    }

    // Verify escrow account exists
    const [escrowPda] = findEscrowPda(tradePda, program.programId);
    try {
      const escrowAccount: any = await program.account.escrow.fetch(escrowPda);
      console.log('[Verification] Escrow account verified:', {
        escrowPda: escrowPda.toString(),
        depositor: escrowAccount.depositor.toString(),
        amount: escrowAccount.amount.toString(),
      });
    } catch (error) {
      return {
        canProceed: false,
        error: 'Escrow account not found. Funds may not be locked.',
      };
    }

    console.log('[Verification] ✅ All checks passed - can release');
    return {
      canProceed: true,
      status: 'locked',
      details: {
        creator: tradeAccount.creator.toString(),
        counterparty: tradeAccount.counterparty?.toString(),
        amount: tradeAccount.amount.toString(),
      },
    };
  } catch (error) {
    console.error('[Verification] Error during verification:', error);
    return {
      canProceed: false,
      error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Verify that a trade can be refunded
 *
 * Checks:
 * 1. Trade account exists
 * 2. Trade status is "Locked" (can only refund locked trades)
 * 3. Caller is authorized (creator or depositor)
 *
 * @param connection Solana connection
 * @param program Anchor program instance
 * @param tradePda Trade PDA address
 * @param refunder PublicKey of the wallet attempting to refund
 */
export async function verifyCanRefund(
  connection: Connection,
  program: Program,
  tradePda: PublicKey,
  refunder: PublicKey
): Promise<VerificationResult> {
  try {
    console.log('[Verification] Checking if trade can be refunded...', {
      tradePda: tradePda.toString(),
      refunder: refunder.toString(),
    });

    // Fetch trade account
    let tradeAccount: any;
    try {
      tradeAccount = await program.account.trade.fetch(tradePda);
    } catch (error) {
      return {
        canProceed: false,
        error: 'Trade account not found. Trade may not exist or PDA derivation is incorrect.',
      };
    }

    console.log('[Verification] Trade account fetched:', {
      creator: tradeAccount.creator.toString(),
      status: tradeAccount.status,
      amount: tradeAccount.amount.toString(),
    });

    // Check if status is Locked
    const statusKey = Object.keys(tradeAccount.status)[0];
    if (statusKey !== 'locked') {
      return {
        canProceed: false,
        error: `Trade status is "${statusKey}", must be "locked" to refund. Current status: ${JSON.stringify(tradeAccount.status)}`,
        status: statusKey,
      };
    }

    // Verify refunder is the creator
    if (!tradeAccount.creator.equals(refunder)) {
      return {
        canProceed: false,
        error: `Only the creator can refund. Creator: ${tradeAccount.creator.toString()}, Refunder: ${refunder.toString()}`,
      };
    }

    // Verify escrow account exists
    const [escrowPda] = findEscrowPda(tradePda, program.programId);
    try {
      const escrowAccount: any = await program.account.escrow.fetch(escrowPda);
      console.log('[Verification] Escrow account verified:', {
        escrowPda: escrowPda.toString(),
        depositor: escrowAccount.depositor.toString(),
        amount: escrowAccount.amount.toString(),
      });
    } catch (error) {
      return {
        canProceed: false,
        error: 'Escrow account not found. Funds may not be locked.',
      };
    }

    console.log('[Verification] ✅ All checks passed - can refund');
    return {
      canProceed: true,
      status: 'locked',
      details: {
        creator: tradeAccount.creator.toString(),
        amount: tradeAccount.amount.toString(),
      },
    };
  } catch (error) {
    console.error('[Verification] Error during verification:', error);
    return {
      canProceed: false,
      error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Fetch trade state from blockchain
 *
 * @param program Anchor program instance
 * @param tradePda Trade PDA address
 */
export async function fetchTradeState(
  program: Program,
  tradePda: PublicKey
): Promise<any | null> {
  try {
    const tradeAccount = await program.account.trade.fetch(tradePda);
    return tradeAccount;
  } catch (error) {
    console.error('[Verification] Failed to fetch trade state:', error);
    return null;
  }
}

/**
 * Fetch escrow state from blockchain
 *
 * @param program Anchor program instance
 * @param escrowPda Escrow PDA address
 */
export async function fetchEscrowState(
  program: Program,
  escrowPda: PublicKey
): Promise<any | null> {
  try {
    const escrowAccount = await program.account.escrow.fetch(escrowPda);
    return escrowAccount;
  } catch (error) {
    console.error('[Verification] Failed to fetch escrow state:', error);
    return null;
  }
}

/**
 * Get trade status as a human-readable string
 *
 * @param status Trade status object from on-chain account
 */
export function getTradeStatusString(status: any): string {
  if (!status) return 'unknown';
  const statusKey = Object.keys(status)[0];
  return statusKey || 'unknown';
}
