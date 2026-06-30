#!/usr/bin/env tsx
/**
 * Generate a DEDICATED backend arbiter keypair.
 *
 * Prints the public key (to register on-chain via register-backend-arbiter.ts)
 * and the base58 secret (to store in the BACKEND_ARBITER_KEYPAIR env var, in a
 * secrets manager — NEVER commit it).
 *
 * Why dedicated: the arbiter key can direct a disputed escrow to the buyer or
 * the seller. Keeping it separate from the refund fee-payer (BACKEND_SIGNER_KEYPAIR)
 * means the two privileges can be rotated and monitored independently.
 *
 * Usage:  tsx scripts/generate-arbiter-keypair.ts
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.generate();

console.log('Backend arbiter keypair (DEVNET) — store the secret securely, never commit:\n');
console.log('  Public key (register this on-chain):');
console.log('   ', kp.publicKey.toBase58(), '\n');
console.log('  BACKEND_ARBITER_KEYPAIR (base58 secret — put in your secrets manager / .env.local):');
console.log('   ', bs58.encode(kp.secretKey), '\n');
console.log('Next: fund this pubkey with devnet SOL (airdrop), set BACKEND_ARBITER_KEYPAIR,');
console.log('then run: DRY_RUN=true tsx scripts/register-backend-arbiter.ts   (then without DRY_RUN with the authority key).');
