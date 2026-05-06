/**
 * Diff every instruction's account list between the locally bundled idl.json
 * and the IDL stored on-chain by `anchor idl init`. If any instruction's
 * required accounts differ, the frontend is sending a transaction that the
 * deployed program will reject — this is the most common cause of mysterious
 * AccountDiscriminatorMismatch / wrong-account errors after a redeploy.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as zlib from 'zlib';
import localIdl from '../src/lib/solana/v2/idl.json';
import { BLIP_V2_PROGRAM_ID, DEVNET_RPC } from '../src/lib/solana/v2/config';

async function fetchOnChainIdl(connection: Connection, programId: PublicKey): Promise<any | null> {
  const [base] = PublicKey.findProgramAddressSync([], programId);
  const idlAddress = await PublicKey.createWithSeed(base, 'anchor:idl', programId);
  const info = await connection.getAccountInfo(idlAddress, 'confirmed');
  if (!info) return null;
  const data = info.data;
  if (data.length < 44) return null;
  const dataLen = data.readUInt32LE(40);
  const compressed = data.subarray(44, 44 + dataLen);
  return JSON.parse(zlib.inflateSync(compressed).toString('utf8'));
}

function ixSummary(ix: any): { disc: string; accs: string[] } {
  return {
    disc: (ix.discriminator || []).join(','),
    accs: (ix.accounts || []).map((a: any) => a.name),
  };
}

async function main() {
  const conn = new Connection(DEVNET_RPC, 'confirmed');
  const onChain = await fetchOnChainIdl(conn, BLIP_V2_PROGRAM_ID);
  if (!onChain) {
    console.log('No on-chain IDL account.');
    return;
  }

  const local = localIdl as any;
  console.log('Local IDL version:    ', local.metadata?.version);
  console.log('On-chain IDL version: ', onChain.metadata?.version);
  console.log('');

  const localIxs = new Map<string, any>(local.instructions.map((i: any) => [i.name, i]));
  const chainIxs = new Map<string, any>(onChain.instructions.map((i: any) => [i.name, i]));

  let diffs = 0;
  for (const [name, lix] of localIxs) {
    const cix = chainIxs.get(name);
    if (!cix) {
      console.log(`⚠  ${name}: in local IDL but not on chain`);
      diffs++;
      continue;
    }
    const l = ixSummary(lix);
    const c = ixSummary(cix);
    if (l.disc !== c.disc) {
      console.log(`⚠  ${name}: discriminator differs`);
      console.log(`   local:    [${l.disc}]`);
      console.log(`   on-chain: [${c.disc}]`);
      diffs++;
    }
    if (JSON.stringify(l.accs) !== JSON.stringify(c.accs)) {
      console.log(`⚠  ${name}: account list differs`);
      console.log(`   local:    [${l.accs.join(', ')}]`);
      console.log(`   on-chain: [${c.accs.join(', ')}]`);
      diffs++;
    }
  }
  for (const [name] of chainIxs) {
    if (!localIxs.has(name)) {
      console.log(`⚠  ${name}: on chain but not in local IDL`);
      diffs++;
    }
  }

  // Also diff account-struct discriminators
  const localAccs = new Map<string, any>((local.accounts || []).map((a: any) => [a.name, a]));
  const chainAccs = new Map<string, any>((onChain.accounts || []).map((a: any) => [a.name, a]));
  for (const [name, la] of localAccs) {
    const ca = chainAccs.get(name);
    if (!ca) { console.log(`⚠  account ${name}: in local but not on chain`); diffs++; continue; }
    if ((la.discriminator || []).join(',') !== (ca.discriminator || []).join(',')) {
      console.log(`⚠  account ${name}: discriminator differs`);
      console.log(`   local:    [${la.discriminator}]`);
      console.log(`   on-chain: [${ca.discriminator}]`);
      diffs++;
    }
  }
  for (const [name] of chainAccs) {
    if (!localAccs.has(name)) { console.log(`⚠  account ${name}: on chain but not local`); diffs++; }
  }

  console.log('');
  console.log(diffs === 0 ? '✅ No structural differences.' : `❌ ${diffs} difference(s) found.`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
