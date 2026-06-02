'use client';

/**
 * Gasless transaction client helper.
 *
 * The backend builds the tx and partial-signs as feePayer so the user
 * never needs SOL. This module deserializes the partially-signed tx from
 * the server, gets the user's wallet signature, and submits.
 */

import { Transaction, Connection } from '@solana/web3.js';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export type GaslessAction =
  | 'createTrade'
  | 'fundEscrow'
  | 'acceptTrade'
  | 'lockEscrow'
  | 'releaseEscrow'
  | 'refundEscrow'
  | 'confirmPayment'
  | 'openDispute';

export interface PrepareResult {
  tx: string; // base64 partially-signed transaction
  action: GaslessAction;
}

/**
 * Ask the backend to build + partial-sign a transaction, then have the
 * user's wallet add their signature and submit.
 *
 * @param action  - which on-chain instruction to execute
 * @param params  - instruction-specific params (see prepare-tx route)
 * @param signTransaction - wallet adapter signTransaction fn
 * @param connection - Solana connection for submission
 */
export async function executeGasless(
  action: GaslessAction,
  params: Record<string, unknown>,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  connection: Connection,
): Promise<string> {
  // 1. Ask backend to build + partial sign
  const res = await fetchWithAuth('/api/solana/prepare-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `prepare-tx failed: ${res.status}`);
  }

  const { tx: base64Tx }: PrepareResult = await res.json();

  // 2. Deserialize the partially-signed tx (feePayer already signed)
  const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));

  // 3. User wallet adds their signature
  const signed = await signTransaction(tx);

  // 4. Submit
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  // 5. Confirm
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  return sig;
}
