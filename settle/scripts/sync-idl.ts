/**
 * Pull the on-chain IDL and write it to settle/src/lib/solana/v2/idl.json.
 * Backs up the existing file first.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { BLIP_V2_PROGRAM_ID, DEVNET_RPC } from '../src/lib/solana/v2/config';

async function fetchOnChainIdl(connection: Connection, programId: PublicKey): Promise<any> {
  const [base] = PublicKey.findProgramAddressSync([], programId);
  const idlAddress = await PublicKey.createWithSeed(base, 'anchor:idl', programId);
  const info = await connection.getAccountInfo(idlAddress, 'confirmed');
  if (!info) throw new Error('No on-chain IDL account');
  const dataLen = info.data.readUInt32LE(40);
  const compressed = info.data.subarray(44, 44 + dataLen);
  return JSON.parse(zlib.inflateSync(compressed).toString('utf8'));
}

async function main() {
  const conn = new Connection(DEVNET_RPC, 'confirmed');
  const idl = await fetchOnChainIdl(conn, BLIP_V2_PROGRAM_ID);
  const out = path.resolve(__dirname, '../src/lib/solana/v2/idl.json');
  const backup = out + '.bak-' + Date.now();
  if (fs.existsSync(out)) fs.copyFileSync(out, backup);
  fs.writeFileSync(out, JSON.stringify(idl, null, 2));
  console.log('Wrote on-chain IDL → ', out);
  console.log('Backup at          → ', backup);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
