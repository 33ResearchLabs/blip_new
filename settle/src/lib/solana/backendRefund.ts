/**
 * Backend Escrow Refund — Automated on-chain refund for expired orders
 *
 * When an order expires with USDT locked on-chain (v2 escrow-first flow),
 * this module builds, signs, and submits the refundEscrow transaction
 * using the backend signer keypair.
 *
 * The on-chain program returns funds to the original depositor's wallet.
 * The backend signer only pays the SOL transaction fee (~0.000005 SOL).
 */

import { PublicKey } from '@solana/web3.js';
import { getBackendKeypair, getBackendConnection, getBackendProgram } from './backendSigner';
import { buildRefundEscrowTx } from './v2/program';
import { findTradePda, findProtocolConfigPda } from './v2/pdas';
import { getUsdtMint } from './v2/config';
import { logger } from '@/lib/logger';

export interface BackendRefundResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Attempt to refund an on-chain escrow using the backend signer.
 *
 * @param escrowCreatorWallet - The wallet that created the on-chain trade (used to derive trade PDA)
 * @param escrowTradeId - The on-chain trade ID (bigint)
 * @returns Result with tx hash on success, error message on failure
 */
export async function refundEscrowFromBackend(
  escrowCreatorWallet: string,
  escrowTradeId: number,
): Promise<BackendRefundResult> {
  const keypair = getBackendKeypair();
  if (!keypair) {
    return { success: false, error: 'Backend signer not configured' };
  }

  const program = getBackendProgram();
  if (!program) {
    return { success: false, error: 'Failed to initialize Anchor program' };
  }

  const connection = getBackendConnection();

  try {
    const creatorPk = new PublicKey(escrowCreatorWallet);
    const [tradePda] = findTradePda(creatorPk, escrowTradeId);
    const mint = getUsdtMint();
    const [protocolConfigPda] = findProtocolConfigPda();

    // Build the refund transaction with backend signer as the signer
    // Pass protocolConfigPda so the on-chain program can verify this is the protocol authority
    const transaction = await buildRefundEscrowTx(program, keypair.publicKey, {
      tradePda,
      mint,
      protocolConfigPda,
    });

    // Set recent blockhash and fee payer
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;

    // Sign with backend keypair
    transaction.sign(keypair);

    // Submit
    const txHash = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Confirm
    await connection.confirmTransaction({
      signature: txHash,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    logger.info('[BackendRefund] Escrow refunded on-chain', {
      txHash,
      escrowCreatorWallet,
      escrowTradeId,
      signerWallet: keypair.publicKey.toBase58(),
    });

    return { success: true, txHash };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Check for common on-chain errors
    if (errMsg.includes('already been processed') || errMsg.includes('AlreadyRefunded')) {
      logger.info('[BackendRefund] Escrow already refunded', { escrowCreatorWallet, escrowTradeId });
      return { success: true, txHash: 'already-refunded' };
    }

    // Escrow account doesn't exist (already closed/refunded)
    if (errMsg.includes('does not exist') || errMsg.includes('no data')) {
      logger.info('[BackendRefund] Escrow account already closed', { escrowCreatorWallet, escrowTradeId });
      return { success: true, txHash: 'escrow-already-closed' };
    }

    // Signer not authorized — program constraint failure
    if (errMsg.includes('ConstraintRaw') || errMsg.includes('Unauthorized') || errMsg.includes('2003') || errMsg.includes('2012')) {
      logger.warn('[BackendRefund] Backend signer not authorized by on-chain program', {
        escrowCreatorWallet,
        escrowTradeId,
        signerWallet: keypair.publicKey.toBase58(),
        error: errMsg,
      });
      return { success: false, error: 'Backend signer not authorized — user must claim refund from app' };
    }

    logger.error('[BackendRefund] Failed to refund escrow', {
      escrowCreatorWallet,
      escrowTradeId,
      error: errMsg,
    });

    return { success: false, error: errMsg };
  }
}
