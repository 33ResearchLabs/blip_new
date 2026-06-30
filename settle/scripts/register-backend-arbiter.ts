#!/usr/bin/env tsx
/**
 * Register the backend arbiter in the on-chain ArbiterSet — DEVNET ONLY.
 *
 * set_arbiters REPLACES the whole allowlist, so this script first READS the
 * current on-chain set and registers the UNION (existing arbiters + the backend
 * arbiter). That guarantees:
 *   - the backend arbiter is added,
 *   - every existing human arbiter is preserved (never accidentally removed),
 *   - it is idempotent (re-running when already registered is a no-op),
 *   - the correct cluster is used (mainnet is refused outright).
 *
 * Usage
 * ─────
 *   # dry run (reads + prints the plan, signs nothing):
 *   NEXT_PUBLIC_SOLANA_NETWORK=devnet DRY_RUN=true \
 *     BACKEND_ARBITER_KEYPAIR=<base58 or set BACKEND_ARBITER_PUBKEY> \
 *     tsx scripts/register-backend-arbiter.ts
 *
 *   # execute (requires the DEVNET protocol authority key):
 *   NEXT_PUBLIC_SOLANA_NETWORK=devnet \
 *     ARBITER_REGISTRATION_AUTHORITY=<base58 secret>  # or AUTHORITY_KEYPAIR_PATH=<solana json> \
 *     BACKEND_ARBITER_KEYPAIR=<base58 secret>         # or BACKEND_ARBITER_PUBKEY=<pubkey> \
 *     tsx scripts/register-backend-arbiter.ts
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { readFileSync } from 'node:fs';
import { getV2ProgramId, isMainnetActive } from '../src/lib/solana/v2/config';
import { findProtocolConfigPda } from '../src/lib/solana/v2/pdas';
import { convertIdlToAnchor29 } from '../src/lib/solana/idlConverter';
import { createKeypairWalletAdapter } from '../src/lib/wallet/keypairWalletAdapter';
import idlRaw from '../src/lib/solana/v2/idl.json';

const MAX_ARBITERS = 10;

function rpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL_PRIVATE ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    'https://api.devnet.solana.com'
  );
}

function loadArbiterPubkey(): PublicKey {
  if (process.env.BACKEND_ARBITER_PUBKEY) return new PublicKey(process.env.BACKEND_ARBITER_PUBKEY);
  const secret = process.env.BACKEND_ARBITER_KEYPAIR || process.env.BACKEND_SIGNER_KEYPAIR;
  if (!secret) throw new Error('Set BACKEND_ARBITER_PUBKEY or BACKEND_ARBITER_KEYPAIR');
  return Keypair.fromSecretKey(bs58.decode(secret)).publicKey;
}

function loadAuthorityKeypair(): Keypair {
  if (process.env.ARBITER_REGISTRATION_AUTHORITY) {
    return Keypair.fromSecretKey(bs58.decode(process.env.ARBITER_REGISTRATION_AUTHORITY));
  }
  if (process.env.AUTHORITY_KEYPAIR_PATH) {
    const raw = JSON.parse(readFileSync(process.env.AUTHORITY_KEYPAIR_PATH, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  throw new Error('Set ARBITER_REGISTRATION_AUTHORITY (base58) or AUTHORITY_KEYPAIR_PATH (solana json)');
}

function parseArbiterSet(data: Buffer): { authority: string; arbiters: string[] } {
  // 8 disc | authority 32 | arbiters[10]*32 | count u8 | bump u8
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const count = data.readUInt8(8 + 32 + 320);
  const arbiters: string[] = [];
  for (let i = 0; i < count; i++) {
    const off = 40 + i * 32;
    arbiters.push(new PublicKey(data.subarray(off, off + 32)).toBase58());
  }
  return { authority, arbiters };
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true';
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  // Hard refuse mainnet — Phase 3 is devnet-only.
  if (isMainnetActive() || network === 'mainnet-beta' || network === 'mainnet') {
    throw new Error(`Refusing to run against mainnet (network=${network}). This script is DEVNET ONLY.`);
  }

  const programId = getV2ProgramId();
  const connection = new Connection(rpcUrl(), 'confirmed');
  const arbiterPubkey = loadArbiterPubkey();
  const [configPda] = findProtocolConfigPda();
  const [arbiterSetPda] = PublicKey.findProgramAddressSync([Buffer.from('arbiter-set')], programId);

  console.log('network:        ', network);
  console.log('program:        ', programId.toBase58());
  console.log('arbiter-set PDA:', arbiterSetPda.toBase58());
  console.log('backend arbiter:', arbiterPubkey.toBase58());

  const setInfo = await connection.getAccountInfo(arbiterSetPda);
  const existing = setInfo ? parseArbiterSet(setInfo.data).arbiters : [];
  console.log(setInfo ? `current arbiters (${existing.length}):` : 'ArbiterSet does NOT exist yet (will be created):');
  existing.forEach((a, i) => console.log(`  [${i}] ${a}`));

  if (existing.includes(arbiterPubkey.toBase58())) {
    console.log('\n✅ Backend arbiter already registered — nothing to do (idempotent no-op).');
    return;
  }

  // Union: existing first (preserved), then the backend arbiter.
  const union = [...existing, arbiterPubkey.toBase58()];
  if (union.length > MAX_ARBITERS) {
    throw new Error(`Union exceeds ${MAX_ARBITERS} arbiters (${union.length}) — remove an unused arbiter first.`);
  }
  console.log(`\nplanned arbiter set (${union.length}):`);
  union.forEach((a, i) => console.log(`  [${i}] ${a}${a === arbiterPubkey.toBase58() ? '  <-- ADDED' : ''}`));

  if (dryRun) {
    console.log('\nDRY_RUN=true — not signing. Re-run without DRY_RUN and with the authority key to execute.');
    return;
  }

  const authority = loadAuthorityKeypair();
  console.log('\nauthority:      ', authority.publicKey.toBase58());

  const idl = convertIdlToAnchor29(idlRaw) as Idl;
  const wallet = createKeypairWalletAdapter(authority);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl as any, programId, provider);

  const sig = await (program.methods as any)
    .setArbiters({ arbiters: union.map((a) => new PublicKey(a)) })
    .accounts({
      authority: authority.publicKey,
      protocolConfig: configPda,
      arbiterSet: arbiterSetPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('\n✅ set_arbiters tx:', sig);

  // Verify post-registration: backend present, existing preserved.
  const after = await connection.getAccountInfo(arbiterSetPda);
  const now = after ? parseArbiterSet(after.data).arbiters : [];
  console.log(`\non-chain arbiter set now (${now.length}):`);
  now.forEach((a, i) => console.log(`  [${i}] ${a}`));

  const backendOk = now.includes(arbiterPubkey.toBase58());
  const preserved = existing.every((a) => now.includes(a));
  if (!backendOk) throw new Error('VERIFY FAILED: backend arbiter not present after registration');
  if (!preserved) throw new Error('VERIFY FAILED: an existing arbiter was dropped');
  console.log('\n✅ verified: backend arbiter registered AND all prior arbiters preserved.');
}

main().catch((e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
