/**
 * Backend Arbiter — server-side Solana keypair authorised to resolve disputes.
 *
 * Phase 2 of the backend-arbiter dispute-resolution work. Loads a DEDICATED
 * arbiter keypair (BACKEND_ARBITER_KEYPAIR) and, when that is unset, falls back
 * to the existing refund signer (BACKEND_SIGNER_KEYPAIR) for convenience.
 *
 * The keypair must be registered in the on-chain ArbiterSet (via set_arbiters —
 * Phase 3) before the program will accept its resolveDispute signature. The
 * whole path is GATED behind BACKEND_ARBITER_ENABLED and is a no-op until BOTH
 * the flag is on AND the key is registered on-chain.
 *
 * SECURITY: this key can direct a disputed escrow to the buyer OR the seller —
 * never to an arbitrary wallet (the on-chain program constrains the recipient
 * to the trade counterparty or the depositor). It only pays SOL tx fees; it
 * never custodies user funds.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { createKeypairWalletAdapter } from '@/lib/wallet/keypairWalletAdapter';
import { getV2ProgramId } from './v2/config';
import { getBackendConnection } from './backendSigner';
import { convertIdlToAnchor29 } from './idlConverter';
import idlRaw from './v2/idl.json';

let cachedKeypair: Keypair | null = null;

// Normalise the 0.30+ IDL to the 0.29 shape so `new Program()` doesn't throw
// (same conversion the refund signer + wallet contexts use).
const idl: Idl = convertIdlToAnchor29(idlRaw);

/**
 * Feature flag — the backend arbiter is OFF unless explicitly enabled. Until
 * Phase 3 registers the key on-chain and this is set true, the finalize route
 * keeps the existing human-compliance-wallet settlement path.
 */
export function isBackendArbiterEnabled(): boolean {
  return process.env.BACKEND_ARBITER_ENABLED === 'true';
}

/**
 * Load the arbiter keypair: dedicated BACKEND_ARBITER_KEYPAIR, else fall back
 * to BACKEND_SIGNER_KEYPAIR. Returns null when neither is configured.
 */
export function getArbiterKeypair(): Keypair | null {
  if (cachedKeypair) return cachedKeypair;
  const secret = process.env.BACKEND_ARBITER_KEYPAIR || process.env.BACKEND_SIGNER_KEYPAIR;
  if (!secret) return null;
  try {
    cachedKeypair = Keypair.fromSecretKey(bs58.decode(secret));
    return cachedKeypair;
  } catch (err) {
    console.error('[BackendArbiter] Invalid arbiter keypair:', err);
    return null;
  }
}

/** Public key of the configured arbiter (or null). Safe to log. */
export function getArbiterPublicKey(): PublicKey | null {
  return getArbiterKeypair()?.publicKey ?? null;
}

/**
 * Anchor program bound to the arbiter keypair as signer. Null if unconfigured.
 */
export function getArbiterProgram(): Program | null {
  const keypair = getArbiterKeypair();
  if (!keypair) return null;
  const connection = getBackendConnection();
  const wallet = createKeypairWalletAdapter(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new Program(idl as any, getV2ProgramId(), provider);
}
