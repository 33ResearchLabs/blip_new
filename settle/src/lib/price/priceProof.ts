/**
 * Price Proof — Ed25519 signed attestation of corridor reference price
 *
 * At order creation, the server signs { corridor_id, ref_price, order_rate, deviation_bps, timestamp }
 * proving the rate was within bounds at that moment. Stored on the order for audit/dispute resolution.
 *
 * Uses tweetnacl (already installed) + bs58 (already installed).
 * Pattern mirrors settle/src/lib/solana/verifySignature.ts
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';

const PROOF_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PriceProofPayload {
  corridor_id: string;
  ref_price: number;
  order_rate: number;
  deviation_bps: number;
  timestamp: number;
  expires_at: number;
}

export interface PriceProofResult {
  sig: string;        // base58-encoded ed25519 signature
  pubkey: string;     // base58-encoded public key
  expires_at: number; // unix ms
}

// Lazy-loaded keypair singleton
let cachedKeyPair: nacl.SignKeyPair | null = null;

function getKeyPair(): nacl.SignKeyPair {
  if (cachedKeyPair) return cachedKeyPair;

  const hex = process.env.PRICE_AUTHORITY_KEYPAIR;
  if (!hex || hex.length !== 64) {
    console.warn('[PriceProof] PRICE_AUTHORITY_KEYPAIR not set or invalid — using ephemeral key (dev only)');
    cachedKeyPair = nacl.sign.keyPair();
  } else {
    cachedKeyPair = nacl.sign.keyPair.fromSeed(Buffer.from(hex, 'hex'));
  }
  return cachedKeyPair;
}

/**
 * Get the price authority public key (base58).
 * Useful for storing in corridor_prices.price_authority_pubkey
 */
export function getPriceAuthorityPubkey(): string {
  return bs58.encode(getKeyPair().publicKey);
}

/**
 * Sign a price proof attestation.
 */
export function signPriceProof(params: {
  corridor_id: string;
  ref_price: number;
  order_rate: number;
  deviation_bps: number;
  timestamp: number;
}): PriceProofResult {
  const kp = getKeyPair();
  const expires_at = params.timestamp + PROOF_TTL_MS;

  const payload: PriceProofPayload = {
    corridor_id: params.corridor_id,
    ref_price: params.ref_price,
    order_rate: params.order_rate,
    deviation_bps: params.deviation_bps,
    timestamp: params.timestamp,
    expires_at,
  };

  const msgBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sigBytes = nacl.sign.detached(msgBytes, kp.secretKey);

  return {
    sig: bs58.encode(sigBytes),
    pubkey: bs58.encode(kp.publicKey),
    expires_at,
  };
}

/**
 * Verify a price proof signature.
 * Used during dispute resolution to prove what ref_price was at order creation.
 */
export function verifyPriceProof(
  sig: string,
  pubkey: string,
  payload: PriceProofPayload
): boolean {
  try {
    const sigBytes = bs58.decode(sig);
    const pubkeyBytes = bs58.decode(pubkey);
    const msgBytes = new TextEncoder().encode(JSON.stringify(payload));
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}
