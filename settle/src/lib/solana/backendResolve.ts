/**
 * Backend Dispute Settlement — server-side resolveDispute signed by the backend
 * arbiter keypair.
 *
 * Mirrors backendRefund.ts (build → sign → confirm → return hash). Used by the
 * compliance finalize route when the backend-arbiter feature is enabled, so the
 * on-chain settlement happens server-side and is CONFIRMED before the DB is
 * finalized.
 *
 * The on-chain program directs funds to the buyer (ReleaseToBuyer) or the
 * depositor/seller (RefundToSeller) — never an arbitrary wallet. The arbiter
 * keypair only pays the SOL tx fee.
 */

import { PublicKey } from '@solana/web3.js';
import { getArbiterKeypair, getArbiterProgram } from './backendArbiter';
import { getBackendConnection } from './backendSigner';
import { buildResolveDisputeTx } from './v2/program';
import { findTradePda } from './v2/pdas';
import { getUsdtMint } from './v2/config';
import { DisputeResolution } from './v2/types';
import { logger } from '@/lib/logger';

export interface BackendResolveResult {
  success: boolean;
  txHash?: string;
  error?: string;
  /** True when the on-chain trade is already settled (DB needs reconciliation, not a new tx). */
  alreadySettled?: boolean;
}

/**
 * Settle a disputed escrow on-chain using the backend arbiter keypair.
 *
 * @param escrowCreatorWallet wallet that created the on-chain trade (derives the trade PDA)
 * @param escrowTradeId       on-chain trade id
 * @param resolution          'release_to_buyer' (buyer wins) | 'refund_to_seller' (seller wins)
 */
export async function resolveDisputeFromBackend(
  escrowCreatorWallet: string,
  escrowTradeId: number,
  resolution: 'release_to_buyer' | 'refund_to_seller',
): Promise<BackendResolveResult> {
  const keypair = getArbiterKeypair();
  if (!keypair) return { success: false, error: 'Backend arbiter not configured' };

  const program = getArbiterProgram();
  if (!program) return { success: false, error: 'Failed to initialize arbiter program' };

  const connection = getBackendConnection();

  try {
    const creatorPk = new PublicKey(escrowCreatorWallet);
    const [tradePda] = findTradePda(creatorPk, escrowTradeId);
    const mint = getUsdtMint();
    const disputeResolution =
      resolution === 'release_to_buyer'
        ? DisputeResolution.ReleaseToBuyer
        : DisputeResolution.RefundToSeller;

    const transaction = await buildResolveDisputeTx(program, keypair.publicKey, {
      tradePda,
      resolution: disputeResolution,
      mint,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    const txHash = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(
      { signature: txHash, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    logger.info('[BackendResolve] Dispute settled on-chain', {
      txHash,
      escrowCreatorWallet,
      escrowTradeId,
      resolution,
      arbiterWallet: keypair.publicKey.toBase58(),
    });

    return { success: true, txHash };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Trade already in a terminal on-chain state — funds already moved. The DB
    // should be reconciled (Phase 4), not re-settled; do NOT invent a hash.
    if (
      errMsg.includes('already been processed') ||
      errMsg.includes('AlreadyResolved') ||
      errMsg.includes('Released') ||
      errMsg.includes('Refunded') ||
      errMsg.includes('does not exist') ||
      errMsg.includes('no data')
    ) {
      logger.info('[BackendResolve] Dispute appears already settled on-chain', {
        escrowCreatorWallet,
        escrowTradeId,
      });
      return {
        success: false,
        alreadySettled: true,
        error: 'Dispute already settled on-chain — needs reconciliation, not re-settlement',
      };
    }

    // Arbiter not authorised — the key is not in the on-chain ArbiterSet
    // (Phase 3 registration missing). Fall back to a human compliance wallet.
    if (
      errMsg.includes('NotArbiter') ||
      errMsg.includes('6023') ||
      errMsg.includes('ConstraintRaw') ||
      errMsg.includes('Unauthorized') ||
      errMsg.includes('2003') ||
      errMsg.includes('2012')
    ) {
      logger.warn('[BackendResolve] Backend arbiter not authorised on-chain', {
        escrowCreatorWallet,
        escrowTradeId,
        arbiterWallet: keypair.publicKey.toBase58(),
        error: errMsg,
      });
      return {
        success: false,
        error: 'Backend arbiter not registered on-chain — use a human compliance wallet',
      };
    }

    logger.error('[BackendResolve] Failed to settle dispute on-chain', {
      escrowCreatorWallet,
      escrowTradeId,
      error: errMsg,
    });
    return { success: false, error: errMsg };
  }
}
