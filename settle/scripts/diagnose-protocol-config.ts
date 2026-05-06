/**
 * Diagnose AccountDiscriminatorMismatch on protocol_config.
 *
 * Compares the on-chain ProtocolConfig PDA's discriminator (first 8 bytes
 * of its data) against the discriminator in the locally bundled idl.json.
 *
 * Also fetches the on-chain IDL account (Anchor stores a copy at a derived
 * address) so we can detect IDL drift after a redeploy.
 *
 * Usage: npx tsx scripts/diagnose-protocol-config.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as zlib from 'zlib';
import idl from '../src/lib/solana/v2/idl.json';
import {
  BLIP_V2_PROGRAM_ID,
  DEVNET_RPC,
} from '../src/lib/solana/v2/config';
import { findProtocolConfigPda } from '../src/lib/solana/v2/pdas';

function bytesEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hexBytes(buf: Buffer | Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

async function fetchOnChainIdl(connection: Connection, programId: PublicKey): Promise<any | null> {
  // Anchor IDL account address: PDA([], programId) then base = first PDA derivation,
  // and the actual address is `createWithSeed(base, "anchor:idl", programId)`.
  const [base] = PublicKey.findProgramAddressSync([], programId);
  const idlAddress = await PublicKey.createWithSeed(base, 'anchor:idl', programId);
  const info = await connection.getAccountInfo(idlAddress, 'confirmed');
  if (!info) return null;
  // Layout (Anchor): [8 disc][32 authority][4 dataLen][zlib-compressed JSON]
  const data = info.data;
  if (data.length < 44) return null;
  const dataLen = data.readUInt32LE(40);
  const compressed = data.subarray(44, 44 + dataLen);
  try {
    const json = zlib.inflateSync(compressed).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function main() {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const [pcPda] = findProtocolConfigPda();

  console.log('Program ID:           ', BLIP_V2_PROGRAM_ID.toBase58());
  console.log('Local IDL version:    ', (idl as any).metadata?.version ?? '(unknown)');
  console.log('protocol_config PDA:  ', pcPda.toBase58());
  console.log('');

  // 1) Inspect the on-chain ProtocolConfig PDA
  const acct = await connection.getAccountInfo(pcPda, 'confirmed');
  if (!acct) {
    console.log('❌ protocol_config PDA does NOT exist on chain.');
    console.log('   Run: npx tsx scripts/init-protocol.ts');
    return;
  }

  console.log('On-chain account:');
  console.log('  owner:     ', acct.owner.toBase58());
  console.log('  data len:  ', acct.data.length);
  console.log('  lamports:  ', acct.lamports);

  const onChainDisc = acct.data.subarray(0, 8);
  const idlPC = (idl as any).accounts?.find((a: any) => a.name === 'ProtocolConfig');
  const idlDisc = Buffer.from(idlPC?.discriminator ?? []);

  console.log('  on-chain discriminator: ', hexBytes(onChainDisc));
  console.log('  local IDL discriminator:', hexBytes(idlDisc));

  const ownerOk = acct.owner.equals(BLIP_V2_PROGRAM_ID);
  const discOk = bytesEqual(onChainDisc, idlDisc);

  if (!ownerOk) {
    console.log('');
    console.log('❌ Owner mismatch. PDA is owned by a DIFFERENT program.');
    console.log('   Expected:', BLIP_V2_PROGRAM_ID.toBase58());
    console.log('   Got:     ', acct.owner.toBase58());
  } else if (!discOk) {
    console.log('');
    console.log('❌ Discriminator mismatch.');
    console.log('   The PDA exists and is owned by the program, but the first 8 bytes');
    console.log('   do not match the local IDL\'s ProtocolConfig discriminator. This means');
    console.log('   either the on-chain account was written by a different struct version,');
    console.log('   or the local idl.json is stale relative to the deployed program.');
  } else {
    console.log('');
    console.log('✅ PDA discriminator matches local IDL.');
  }

  // 2) Fetch on-chain IDL and compare ProtocolConfig discriminator
  console.log('');
  console.log('--- On-chain IDL ---');
  const onChainIdl = await fetchOnChainIdl(connection, BLIP_V2_PROGRAM_ID);
  if (!onChainIdl) {
    console.log('(no IDL account found on chain — `anchor idl init` was never run)');
  } else {
    console.log('on-chain IDL version: ', onChainIdl.metadata?.version ?? '(unknown)');
    const onChainPC = onChainIdl.accounts?.find((a: any) => a.name === 'ProtocolConfig');
    const onChainPCDisc = Buffer.from(onChainPC?.discriminator ?? []);
    console.log('on-chain IDL discriminator:', hexBytes(onChainPCDisc));

    const idlMatchesAcct = bytesEqual(onChainPCDisc, onChainDisc);
    const idlMatchesLocal = bytesEqual(onChainPCDisc, idlDisc);
    console.log('on-chain IDL matches account bytes?', idlMatchesAcct);
    console.log('on-chain IDL matches local IDL?   ', idlMatchesLocal);

    if (idlMatchesAcct && !idlMatchesLocal) {
      console.log('');
      console.log('==> DIAGNOSIS: local idl.json is STALE.');
      console.log('    Replace settle/src/lib/solana/v2/idl.json with the on-chain IDL.');
    } else if (!idlMatchesAcct && idlMatchesLocal) {
      console.log('');
      console.log('==> DIAGNOSIS: on-chain protocol_config PDA was written by an OLDER');
      console.log('    program version. The deployed program and local IDL agree, but the');
      console.log('    PDA bytes are stale. Requires an on-chain `close_config` (not in IDL)');
      console.log('    OR a program redeploy with a new PDA seed.');
    } else if (!idlMatchesAcct && !idlMatchesLocal) {
      console.log('');
      console.log('==> DIAGNOSIS: three-way mismatch — investigate manually.');
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
