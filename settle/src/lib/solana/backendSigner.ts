/**
 * Backend Signer — Server-side Solana keypair for automated escrow refunds
 *
 * Loads a keypair from BACKEND_SIGNER_KEYPAIR env var (base58 secret key).
 * Used by the payment-deadline worker to auto-refund stuck on-chain escrows
 * when orders expire without merchant acceptance.
 *
 * SECURITY: This keypair only needs SOL for tx fees. It does NOT hold user funds.
 * The on-chain program returns escrowed USDT to the original depositor's wallet.
 */

import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { createKeypairWalletAdapter } from '@/lib/wallet/keypairWalletAdapter';
import { getV2ProgramId } from './v2/config';
import idl from './v2/idl.json';

let cachedKeypair: Keypair | null = null;
let cachedConnection: Connection | null = null;

/**
 * Load the backend signer keypair from env.
 * Returns null if not configured (feature disabled).
 */
export function getBackendKeypair(): Keypair | null {
  if (cachedKeypair) return cachedKeypair;

  const secretKeyStr = process.env.BACKEND_SIGNER_KEYPAIR;
  if (!secretKeyStr) return null;

  try {
    const secretKey = bs58.decode(secretKeyStr);
    cachedKeypair = Keypair.fromSecretKey(secretKey);
    return cachedKeypair;
  } catch (err) {
    console.error('[BackendSigner] Invalid BACKEND_SIGNER_KEYPAIR:', err);
    return null;
  }
}

/**
 * Get a Solana connection for backend use.
 */
export function getBackendConnection(): Connection {
  if (cachedConnection) return cachedConnection;

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  cachedConnection = new Connection(rpcUrl, 'confirmed');
  return cachedConnection;
}

/**
 * Get an Anchor Program instance using the backend signer.
 * Returns null if backend signer is not configured.
 */
export function getBackendProgram(): Program | null {
  const keypair = getBackendKeypair();
  if (!keypair) return null;

  const connection = getBackendConnection();
  const wallet = createKeypairWalletAdapter(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const programId = getV2ProgramId();

  return new Program(idl as any, programId, provider);
}

/**
 * Check if backend signer is configured and has enough SOL for tx fees.
 */
export async function isBackendSignerReady(): Promise<boolean> {
  const keypair = getBackendKeypair();
  if (!keypair) return false;

  try {
    const connection = getBackendConnection();
    const balance = await connection.getBalance(keypair.publicKey);
    // Need at least 0.01 SOL for tx fees
    return balance >= 10_000_000;
  } catch {
    return false;
  }
}
