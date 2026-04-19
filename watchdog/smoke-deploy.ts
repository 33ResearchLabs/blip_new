// Quick smoke: verify the deployed devnet program exposes the new
// instructions (resolve_dispute_timeout, cancel_trade_mutual) and
// still exposes the old ones. Uses the regenerated IDL.
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Idl, Program, Wallet } from '@coral-xyz/anchor';
import fs from 'node:fs';
import { convertIdlToAnchor29 } from './src/idlConverter';

const PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');
const RPC = 'https://api.devnet.solana.com';

const rawIdl = JSON.parse(
  fs.readFileSync('/Users/zeus/Documents/Vscode/BM/settle/src/lib/solana/v2/idl.json', 'utf8'),
);
const idl = convertIdlToAnchor29(rawIdl) as Idl;

const conn = new Connection(RPC, 'confirmed');
const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), {});
const program = new Program(idl, PROGRAM_ID, provider);

function ok(s: string) { console.log(`✓ ${s}`); }
function fail(s: string) { console.error(`✗ ${s}`); process.exitCode = 1; }

const required = [
  'createTrade',
  'fundEscrow',
  'lockEscrow',
  'releaseEscrow',
  'refundEscrow',
  'extendEscrow',
  'confirmPayment',
  'openDispute',
  'resolveDispute',
  'resolveDisputeTimeout',   // new
  'cancelTradeMutual',        // new
  'matchOffer',
  'matchOfferAndLockFromLane',
  'emergencyRefundV2',
  'createLane',
  'fundLane',
  'withdrawLane',
  'initializeConfig',
  'updateConfig',
];

const methods = Object.keys((program.methods as any));
for (const name of required) {
  if (methods.includes(name)) ok(`method present: ${name}`);
  else                       fail(`method MISSING:  ${name}`);
}

// Sanity-check that the Params types expose the new ed25519_ix_index field.
// (The instruction itself takes a single `params` arg — the field sits on
// the Params struct in idl.types.)
const types = (program.idl as any).types || [];
for (const paramName of ['MatchOfferParams', 'MatchOfferAndLockFromLaneParams']) {
  const t = types.find((x: any) => x.name === paramName);
  const fields: string[] = (t?.type?.fields || []).map((f: any) => f.name);
  const has = fields.some((n) => n === 'ed25519_ix_index' || n === 'ed25519IxIndex');
  if (has) ok(`${paramName} includes ed25519_ix_index field`);
  else      fail(`${paramName} missing ed25519_ix_index field (have: ${fields.join(',')})`);
}

// Check network connectivity: fetch the program account.
conn.getAccountInfo(PROGRAM_ID).then((info) => {
  if (info && info.executable) ok(`on-chain: program account exists and is executable (owner=${info.owner.toBase58()})`);
  else                         fail('on-chain: program account missing or not executable');
}).catch((e) => fail(`on-chain fetch error: ${e.message}`));
