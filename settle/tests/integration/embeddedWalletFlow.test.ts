/**
 * Embedded Wallet — Full On-Chain Integration Test
 * Tests the complete trade lifecycle on Solana devnet:
 *   create trade → fund escrow → accept trade → confirm payment → release escrow
 *   create trade → fund escrow → refund escrow
 *   create trade → fund escrow → extend escrow
 *
 * Runs 20 transactions total across multiple lifecycle scenarios.
 *
 * Prerequisites:
 *   - Solana CLI configured to devnet with mint authority keypair
 *   - Program 6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87 deployed
 *
 * Run: npx tsx settle/tests/integration/embeddedWalletFlow.test.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  PublicKey,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Load config
const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');
const USDT_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');
const TREASURY = new PublicKey('8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB');

// Load IDL
const idlPath = path.resolve(__dirname, '../../src/lib/solana/v2/idl.json');
const idlRaw = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

// PDA helpers (inline to avoid import issues)
function findProtocolConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('protocol-config')], PROGRAM_ID);
}

function findTradePda(creator: PublicKey, tradeId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('trade-v2'), creator.toBuffer(), new BN(tradeId).toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

function findEscrowPda(trade: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow-v2'), trade.toBuffer()], PROGRAM_ID);
}

function findVaultAuthorityPda(escrow: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault-authority-v2'), escrow.toBuffer()], PROGRAM_ID);
}

// IDL conversion (same as EmbeddedWalletContext)
function convertType(type: any): any {
  if (type === 'pubkey') return 'publicKey';
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object') {
    if (type.array) return { array: [convertType(type.array[0]), type.array[1]] };
    if (type.vec) return { vec: convertType(type.vec) };
    if (type.option) return { option: convertType(type.option) };
    if (type.defined) {
      if (typeof type.defined === 'object' && type.defined.name) return { defined: type.defined.name };
      return { defined: type.defined };
    }
  }
  return type;
}

function convertFields(fields: any[]): any[] {
  if (!fields) return [];
  return fields.map((f: any) => ({ name: f.name, type: convertType(f.type) }));
}

function convertIdlToAnchor29(raw: any): Idl {
  const isNewFormat = !!(raw.address || (raw.metadata && !raw.name) || (raw.accounts?.length && !raw.accounts[0]?.type));
  if (!isNewFormat) return raw as Idl;

  const typeMap = new Map<string, any>();
  for (const td of (raw.types || [])) {
    const c: any = { name: td.name, type: { kind: td.type?.kind || 'struct' } };
    if (td.type?.kind === 'struct') c.type.fields = convertFields(td.type.fields || []);
    else if (td.type?.kind === 'enum') c.type.variants = (td.type.variants || []).map((v: any) => ({
      name: v.name, ...(v.fields ? { fields: convertFields(v.fields) } : {}),
    }));
    typeMap.set(td.name, c);
  }

  return {
    address: raw.address || raw.metadata?.address || '',
    metadata: { name: raw.metadata?.name || 'unknown', version: raw.metadata?.version || '0.1.0', spec: '0.1.0' },
    version: raw.metadata?.version || '0.1.0',
    name: raw.metadata?.name || 'unknown',
    instructions: (raw.instructions || []).map((ix: any) => ({
      name: ix.name,
      accounts: (ix.accounts || []).map((acc: any) => ({
        name: acc.name,
        isMut: acc.writable ?? acc.isMut ?? false,
        isSigner: acc.signer ?? acc.isSigner ?? false,
        ...(acc.optional || acc.isOptional ? { isOptional: true } : {}),
      })),
      args: (ix.args || []).map((arg: any) => ({ name: arg.name, type: convertType(arg.type) })),
    })),
    accounts: [],
    types: Array.from(typeMap.values()),
    errors: raw.errors || [],
    events: raw.events || [],
  } as unknown as Idl;
}

// ============ TEST HARNESS ============

const connection = new Connection(DEVNET_RPC, 'confirmed');
const idl = convertIdlToAnchor29(idlRaw);

// Load mint authority (your default keypair)
const mintAuthorityPath = path.resolve(process.env.HOME || '~', '.config/solana/id.json');
const mintAuthoritySecret = JSON.parse(fs.readFileSync(mintAuthorityPath, 'utf-8'));
const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(mintAuthoritySecret));

let txCount = 0;
let passCount = 0;
let failCount = 0;

function log(msg: string) {
  console.log(`  ${msg}`);
}

function ok(label: string, txHash?: string) {
  txCount++;
  passCount++;
  const truncHash = txHash ? ` (${txHash.slice(0, 8)}...)` : '';
  console.log(`  ✓ [${txCount}] ${label}${truncHash}`);
}

function fail(label: string, err: any) {
  txCount++;
  failCount++;
  console.log(`  ✗ [${txCount}] ${label}: ${err?.message || err}`);
}

async function fundSol(to: PublicKey, amount: number) {
  // Transfer SOL from mint authority instead of airdropping (avoids rate limits)
  const { SystemProgram } = await import('@solana/web3.js');
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mintAuthority.publicKey,
      toPubkey: to,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );
  await signAndSend(mintAuthority, tx);
}

async function mintUsdt(to: PublicKey, amount: number) {
  // Create ATA if needed
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, mintAuthority, USDT_MINT, to
  );
  // Mint tokens (amount in smallest units, USDT has 6 decimals)
  await mintTo(
    connection, mintAuthority, USDT_MINT, ata.address, mintAuthority, amount * 1_000_000
  );
  return ata.address;
}

function createWalletAdapter(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx: Transaction) => { tx.partialSign(kp); return tx; },
    signAllTransactions: async (txs: Transaction[]) => { txs.forEach(t => t.partialSign(kp)); return txs; },
  };
}

function getProgram(kp: Keypair): Program {
  const adapter = createWalletAdapter(kp);
  const provider = new AnchorProvider(connection, adapter as any, { commitment: 'confirmed' });
  return new Program(idl, PROGRAM_ID, provider);
}

async function signAndSend(kp: Keypair, transaction: Transaction): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = kp.publicKey;
  transaction.partialSign(kp);

  const txHash = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 5 });
  await connection.confirmTransaction({ signature: txHash, blockhash, lastValidBlockHeight });
  return txHash;
}

// ============ TRANSACTION BUILDERS ============

async function buildCreateTradeTx(program: Program, creator: PublicKey, tradeId: number, amount: BN, side: 'buy' | 'sell') {
  const [tradePda] = findTradePda(creator, tradeId);
  const [protocolConfigPda] = findProtocolConfigPda();
  const sideEnum = side === 'buy' ? { buy: {} } : { sell: {} };

  const instruction = await (program.methods as any)
    .createTrade(new BN(tradeId), amount, sideEnum)
    .accounts({
      creator,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      mint: USDT_MINT,
      systemProgram: PublicKey.default,
    })
    .instruction();

  return new Transaction().add(instruction);
}

async function buildFundEscrowTx(program: Program, depositor: PublicKey, tradePda: PublicKey) {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  const depositorAta = await getAssociatedTokenAddress(USDT_MINT, depositor);

  const instruction = await (program.methods as any)
    .fundEscrow()
    .accounts({
      depositor,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta,
      mint: USDT_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: PublicKey.default,
    })
    .instruction();

  return new Transaction().add(instruction);
}

async function buildAcceptTradeTx(program: Program, acceptor: PublicKey, tradePda: PublicKey) {
  const [escrowPda] = findEscrowPda(tradePda);

  const instruction = await (program.methods as any)
    .acceptTrade()
    .accounts({
      acceptor,
      trade: tradePda,
      escrow: escrowPda,
      systemProgram: PublicKey.default,
    })
    .instruction();

  return new Transaction().add(instruction);
}

async function buildConfirmPaymentTx(program: Program, buyer: PublicKey, tradePda: PublicKey) {
  const [escrowPda] = findEscrowPda(tradePda);

  const instruction = await (program.methods as any)
    .confirmPayment()
    .accounts({
      buyer,
      trade: tradePda,
      escrow: escrowPda,
    })
    .instruction();

  return new Transaction().add(instruction);
}

async function buildReleaseEscrowTx(program: Program, releaser: PublicKey, tradePda: PublicKey, counterparty: PublicKey, creator: PublicKey) {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  const counterpartyAta = await getAssociatedTokenAddress(USDT_MINT, counterparty);
  const treasuryAta = await getAssociatedTokenAddress(USDT_MINT, TREASURY);

  const tx = new Transaction();

  // Ensure counterparty ATA exists
  try {
    await getAccount(connection, counterpartyAta);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(releaser, counterpartyAta, counterparty, USDT_MINT));
  }

  // Ensure treasury ATA exists
  try {
    await getAccount(connection, treasuryAta);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(releaser, treasuryAta, TREASURY, USDT_MINT));
  }

  const instruction = await (program.methods as any)
    .releaseEscrow()
    .accounts({
      signer: releaser,
      trade: tradePda,
      escrow: escrowPda,
      protocolConfig: protocolConfigPda,
      vaultAuthority,
      vaultAta,
      counterpartyAta,
      treasuryAta,
      creator,
      mint: USDT_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  tx.add(instruction);
  return tx;
}

async function buildRefundEscrowTx(program: Program, refunder: PublicKey, tradePda: PublicKey, creator: PublicKey, depositorPk: PublicKey) {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  const depositorAta = await getAssociatedTokenAddress(USDT_MINT, depositorPk);

  const instruction = await (program.methods as any)
    .refundEscrow()
    .accounts({
      signer: refunder,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta,
      creator,
      mint: USDT_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return new Transaction().add(instruction);
}

async function buildExtendEscrowTx(program: Program, depositor: PublicKey, tradePda: PublicKey, seconds: number) {
  const [escrowPda] = findEscrowPda(tradePda);

  const instruction = await (program.methods as any)
    .extendEscrow(new BN(seconds))
    .accounts({
      depositor,
      trade: tradePda,
      escrow: escrowPda,
    })
    .instruction();

  return new Transaction().add(instruction);
}

// ============ MAIN TEST RUNNER ============

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Embedded Wallet — Full On-Chain Integration Test');
  console.log('═══════════════════════════════════════════════════\n');

  // Generate test wallets
  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  console.log(`Mint Authority: ${mintAuthority.publicKey.toBase58()}`);
  console.log(`Seller:         ${seller.publicKey.toBase58()}`);
  console.log(`Buyer:          ${buyer.publicKey.toBase58()}`);
  console.log(`Program:        ${PROGRAM_ID.toBase58()}`);
  console.log(`USDT Mint:      ${USDT_MINT.toBase58()}`);
  console.log();

  // ── Step 1: Fund wallets with SOL ──
  console.log('─── Setup: Fund SOL ───');
  try {
    await fundSol(seller.publicKey, 1);
    ok('Fund 1 SOL to seller');
  } catch (e: any) { fail('Fund SOL to seller', e); return; }

  try {
    await fundSol(buyer.publicKey, 1);
    ok('Fund 1 SOL to buyer');
  } catch (e: any) { fail('Fund SOL to buyer', e); return; }

  // ── Step 2: Mint USDT to seller ──
  console.log('\n─── Setup: Mint USDT ───');
  try {
    await mintUsdt(seller.publicKey, 1000); // 1000 USDT
    ok('Mint 1000 USDT to seller');
  } catch (e: any) { fail('Mint USDT to seller', e); return; }

  try {
    await mintUsdt(buyer.publicKey, 100); // 100 USDT for buyer (needed for ATA)
    ok('Mint 100 USDT to buyer');
  } catch (e: any) { fail('Mint USDT to buyer', e); return; }

  // ── Step 3: Ensure protocol config exists ──
  console.log('\n─── Setup: Protocol Config ───');
  const sellerProgram = getProgram(seller);
  {
    // Check if protocol config PDA account exists on-chain
    const [protocolConfigPda] = findProtocolConfigPda();
    const accountInfo = await connection.getAccountInfo(protocolConfigPda);
    if (accountInfo) {
      log('Protocol config already exists');
    } else {
      try {
        const authProgram = getProgram(mintAuthority);
        const ix = await (authProgram.methods as any)
          .initializeConfig(250, 1000, 0)
          .accounts({
            authority: mintAuthority.publicKey,
            protocolConfig: protocolConfigPda,
            treasury: TREASURY,
            systemProgram: PublicKey.default,
          })
          .instruction();
        const tx = new Transaction().add(ix);
        await signAndSend(mintAuthority, tx);
        ok('Initialize protocol config');
      } catch (e: any) {
        fail('Initialize protocol config', e);
        return;
      }
    }
  }

  // ════════════════════════════════════════════
  // TEST SCENARIO 1: Full happy path
  // create → fund → accept → confirmPayment → release
  // ════════════════════════════════════════════
  console.log('\n─── Scenario 1: Full Trade Lifecycle (Happy Path) ───');
  const tradeId1 = Date.now();
  const amount1 = new BN(10 * 1_000_000); // 10 USDT
  const [tradePda1] = findTradePda(seller.publicKey, tradeId1);

  try {
    const tx = await buildCreateTradeTx(sellerProgram, seller.publicKey, tradeId1, amount1, 'sell');
    const hash = await signAndSend(seller, tx);
    ok('Create trade #1 (sell, 10 USDT)', hash);
  } catch (e: any) { fail('Create trade #1', e); return; }

  try {
    const tx = await buildFundEscrowTx(sellerProgram, seller.publicKey, tradePda1);
    const hash = await signAndSend(seller, tx);
    ok('Fund escrow #1', hash);
  } catch (e: any) { fail('Fund escrow #1', e); return; }

  try {
    const buyerProgram = getProgram(buyer);
    const tx = await buildAcceptTradeTx(buyerProgram, buyer.publicKey, tradePda1);
    const hash = await signAndSend(buyer, tx);
    ok('Accept trade #1 (buyer joins)', hash);
  } catch (e: any) { fail('Accept trade #1', e); return; }

  try {
    const buyerProgram = getProgram(buyer);
    const tx = await buildConfirmPaymentTx(buyerProgram, buyer.publicKey, tradePda1);
    const hash = await signAndSend(buyer, tx);
    ok('Confirm payment #1', hash);
  } catch (e: any) { fail('Confirm payment #1', e); return; }

  try {
    const tx = await buildReleaseEscrowTx(sellerProgram, seller.publicKey, tradePda1, buyer.publicKey, seller.publicKey);
    const hash = await signAndSend(seller, tx);
    ok('Release escrow #1 (buyer gets USDT)', hash);
  } catch (e: any) { fail('Release escrow #1', e); }

  // ════════════════════════════════════════════
  // TEST SCENARIO 2: Refund path
  // create → fund → refund (before accept)
  // ════════════════════════════════════════════
  console.log('\n─── Scenario 2: Refund (Before Accept) ───');
  const tradeId2 = Date.now() + 1;
  const amount2 = new BN(5 * 1_000_000); // 5 USDT
  const [tradePda2] = findTradePda(seller.publicKey, tradeId2);

  try {
    const tx = await buildCreateTradeTx(sellerProgram, seller.publicKey, tradeId2, amount2, 'sell');
    const hash = await signAndSend(seller, tx);
    ok('Create trade #2 (sell, 5 USDT)', hash);
  } catch (e: any) { fail('Create trade #2', e); return; }

  try {
    const tx = await buildFundEscrowTx(sellerProgram, seller.publicKey, tradePda2);
    const hash = await signAndSend(seller, tx);
    ok('Fund escrow #2', hash);
  } catch (e: any) { fail('Fund escrow #2', e); return; }

  try {
    const tx = await buildRefundEscrowTx(sellerProgram, seller.publicKey, tradePda2, seller.publicKey, seller.publicKey);
    const hash = await signAndSend(seller, tx);
    ok('Refund escrow #2 (seller gets USDT back)', hash);
  } catch (e: any) { fail('Refund escrow #2', e); }

  // ════════════════════════════════════════════
  // TEST SCENARIO 3: Extend escrow
  // create → fund → extend → accept → release
  // ════════════════════════════════════════════
  console.log('\n─── Scenario 3: Extend Escrow ───');
  const tradeId3 = Date.now() + 2;
  const amount3 = new BN(8 * 1_000_000); // 8 USDT
  const [tradePda3] = findTradePda(seller.publicKey, tradeId3);

  try {
    const tx = await buildCreateTradeTx(sellerProgram, seller.publicKey, tradeId3, amount3, 'sell');
    const hash = await signAndSend(seller, tx);
    ok('Create trade #3 (sell, 8 USDT)', hash);
  } catch (e: any) { fail('Create trade #3', e); return; }

  try {
    const tx = await buildFundEscrowTx(sellerProgram, seller.publicKey, tradePda3);
    const hash = await signAndSend(seller, tx);
    ok('Fund escrow #3', hash);
  } catch (e: any) { fail('Fund escrow #3', e); return; }

  try {
    const tx = await buildExtendEscrowTx(sellerProgram, seller.publicKey, tradePda3, 86400); // +24h
    const hash = await signAndSend(seller, tx);
    ok('Extend escrow #3 (+24h)', hash);
  } catch (e: any) { fail('Extend escrow #3', e); }

  try {
    const buyerProgram = getProgram(buyer);
    const tx = await buildAcceptTradeTx(buyerProgram, buyer.publicKey, tradePda3);
    const hash = await signAndSend(buyer, tx);
    ok('Accept trade #3', hash);
  } catch (e: any) { fail('Accept trade #3', e); return; }

  try {
    const buyerProgram = getProgram(buyer);
    const tx = await buildConfirmPaymentTx(buyerProgram, buyer.publicKey, tradePda3);
    const hash = await signAndSend(buyer, tx);
    ok('Confirm payment #3', hash);
  } catch (e: any) { fail('Confirm payment #3', e); }

  try {
    const tx = await buildReleaseEscrowTx(sellerProgram, seller.publicKey, tradePda3, buyer.publicKey, seller.publicKey);
    const hash = await signAndSend(seller, tx);
    ok('Release escrow #3', hash);
  } catch (e: any) { fail('Release escrow #3', e); }

  // ════════════════════════════════════════════
  // TEST SCENARIO 4: Multiple rapid trades (stress)
  // 3 quick create+fund+refund cycles
  // ════════════════════════════════════════════
  console.log('\n─── Scenario 4: Rapid Fire (3 quick cycles) ───');
  for (let i = 0; i < 3; i++) {
    const tid = Date.now() + 100 + i;
    const amt = new BN((3 + i) * 1_000_000);
    const [tpda] = findTradePda(seller.publicKey, tid);

    try {
      // Create + fund in combined tx
      const createIx = await (sellerProgram.methods as any)
        .createTrade(new BN(tid), amt, { sell: {} })
        .accounts({
          creator: seller.publicKey,
          protocolConfig: findProtocolConfigPda()[0],
          trade: tpda,
          mint: USDT_MINT,
          systemProgram: PublicKey.default,
        })
        .instruction();

      const [escrowPda] = findEscrowPda(tpda);
      const [vaultAuth] = findVaultAuthorityPda(escrowPda);
      const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuth, true);
      const sellerAta = await getAssociatedTokenAddress(USDT_MINT, seller.publicKey);

      const fundIx = await (sellerProgram.methods as any)
        .fundEscrow()
        .accounts({
          depositor: seller.publicKey,
          trade: tpda,
          escrow: escrowPda,
          vaultAuthority: vaultAuth,
          vaultAta,
          depositorAta: sellerAta,
          mint: USDT_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: PublicKey.default,
        })
        .instruction();

      const tx = new Transaction().add(createIx).add(fundIx);
      const hash = await signAndSend(seller, tx);
      ok(`Rapid create+fund #${i + 1} (${3 + i} USDT)`, hash);

      // Wait a moment then refund
      const refundTx = await buildRefundEscrowTx(sellerProgram, seller.publicKey, tpda, seller.publicKey, seller.publicKey);
      const rHash = await signAndSend(seller, refundTx);
      ok(`Rapid refund #${i + 1}`, rHash);
    } catch (e: any) {
      fail(`Rapid cycle #${i + 1}`, e);
    }
  }

  // ── Final Balance Check ──
  console.log('\n─── Final Balances ───');
  try {
    const sellerSol = await connection.getBalance(seller.publicKey);
    const buyerSol = await connection.getBalance(buyer.publicKey);

    const sellerAta = await getAssociatedTokenAddress(USDT_MINT, seller.publicKey);
    const buyerAta = await getAssociatedTokenAddress(USDT_MINT, buyer.publicKey);

    let sellerUsdt = 0, buyerUsdt = 0;
    try {
      const acc = await getAccount(connection, sellerAta);
      sellerUsdt = Number(acc.amount) / 1_000_000;
    } catch {}
    try {
      const acc = await getAccount(connection, buyerAta);
      buyerUsdt = Number(acc.amount) / 1_000_000;
    } catch {}

    log(`Seller: ${(sellerSol / LAMPORTS_PER_SOL).toFixed(4)} SOL, ${sellerUsdt.toFixed(2)} USDT`);
    log(`Buyer:  ${(buyerSol / LAMPORTS_PER_SOL).toFixed(4)} SOL, ${buyerUsdt.toFixed(2)} USDT`);
  } catch (e: any) {
    log(`Balance check failed: ${e.message}`);
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Results: ${passCount} passed, ${failCount} failed, ${txCount} total`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
