/**
 * mainnet-smoke-test.ts — End-to-end on-chain trade flow on Solana mainnet.
 *
 * Flow:
 *   1. create_trade   — seller posts an intent (5 USDT, fee 200 bps)
 *   2. lock_escrow    — seller funds the escrow vault, sets counterparty=buyer
 *   3. confirm_payment — buyer signs (off-chain "fiat sent" marker)
 *   4. release_escrow  — seller releases → 4.9 USDT to buyer, 0.1 USDT to treasury
 *   5. sweep          — return buyer's 4.9 USDT to a recovery wallet (if SWEEP_TO set)
 *
 * Required env:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
 *   PROGRAM_ID=gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS
 *   USDT_MINT=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
 *   SELLER_KEYPAIR=keys/test-seller.json
 *   BUYER_KEYPAIR=keys/test-buyer.json
 *
 * Optional:
 *   SWEEP_TO=<pubkey>     # if set, returns buyer's USDT here after release
 *   AMOUNT_USDT=5         # default 5 USDT
 *   FEE_BPS=200           # default 200 (2%)
 *
 * Pre-requisites:
 *   - Seller has >= AMOUNT_USDT in their USDT ATA + ~0.05 SOL
 *   - Buyer has ~0.05 SOL
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS"
);
const USDT_MINT = new PublicKey(
  process.env.USDT_MINT || "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);
const AMOUNT_USDT = parseFloat(process.env.AMOUNT_USDT || "5");
const FEE_BPS = parseInt(process.env.FEE_BPS || "200", 10);
const AMOUNT_BASE = Math.round(AMOUNT_USDT * 1_000_000); // USDT has 6 decimals
const SWEEP_TO = process.env.SWEEP_TO;

const SELLER_KEYPAIR = process.env.SELLER_KEYPAIR || "keys/test-seller.json";
const BUYER_KEYPAIR = process.env.BUYER_KEYPAIR || "keys/test-buyer.json";

function loadKeypair(path: string): Keypair {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(data));
}

function logStep(n: number, label: string) {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`STEP ${n}: ${label}`);
  console.log("─".repeat(70));
}

async function getBalance(conn: Connection, ata: PublicKey): Promise<number> {
  try {
    const acc = await getAccount(conn, ata);
    return Number(acc.amount) / 1_000_000;
  } catch {
    return 0;
  }
}

async function main() {
  console.log("🚀 MAINNET SMOKE TEST — Blip Protocol v1.0");
  console.log("===========================================");
  console.log(`Program ID:  ${PROGRAM_ID.toBase58()}`);
  console.log(`USDT mint:   ${USDT_MINT.toBase58()}`);
  console.log(`Amount:      ${AMOUNT_USDT} USDT (${AMOUNT_BASE} base units)`);
  console.log(`Fee tier:    ${FEE_BPS} bps (${FEE_BPS / 100}%)`);

  // ─── Provider / program ────────────────────────────────────────────
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;
  console.log(`RPC:         ${connection.rpcEndpoint}`);

  const seller = loadKeypair(SELLER_KEYPAIR);
  const buyer = loadKeypair(BUYER_KEYPAIR);

  console.log(`\nSeller:      ${seller.publicKey.toBase58()}`);
  console.log(`Buyer:       ${buyer.publicKey.toBase58()}`);

  // ─── Pre-flight: balances ──────────────────────────────────────────
  logStep(0, "Pre-flight balance check");

  const sellerSol = await connection.getBalance(seller.publicKey);
  const buyerSol = await connection.getBalance(buyer.publicKey);
  console.log(`Seller SOL:  ${sellerSol / LAMPORTS_PER_SOL}`);
  console.log(`Buyer SOL:   ${buyerSol / LAMPORTS_PER_SOL}`);

  if (sellerSol < 0.02 * LAMPORTS_PER_SOL) {
    throw new Error(`Seller needs at least 0.02 SOL, has ${sellerSol / LAMPORTS_PER_SOL}`);
  }
  if (buyerSol < 0.005 * LAMPORTS_PER_SOL) {
    throw new Error(`Buyer needs at least 0.005 SOL, has ${buyerSol / LAMPORTS_PER_SOL}`);
  }

  const sellerAta = await getAssociatedTokenAddress(USDT_MINT, seller.publicKey);
  const buyerAta = await getAssociatedTokenAddress(USDT_MINT, buyer.publicKey);
  const sellerUsdt = await getBalance(connection, sellerAta);
  const buyerUsdtBefore = await getBalance(connection, buyerAta);
  console.log(`Seller USDT: ${sellerUsdt}`);
  console.log(`Buyer USDT:  ${buyerUsdtBefore}`);

  if (sellerUsdt < AMOUNT_USDT) {
    throw new Error(`Seller needs at least ${AMOUNT_USDT} USDT, has ${sellerUsdt}`);
  }

  // Get treasury from on-chain config (snapshot will use this on the trade)
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    PROGRAM_ID
  );
  const config = await (program.account as any).protocolConfig.fetch(protocolConfigPda);
  const treasury = config.treasury as PublicKey;
  console.log(`Treasury (on-chain): ${treasury.toBase58()}`);

  const treasuryAta = await getAssociatedTokenAddress(USDT_MINT, treasury);
  const treasuryUsdtBefore = await getBalance(connection, treasuryAta);
  console.log(`Treasury USDT before: ${treasuryUsdtBefore}`);

  // ─── PDAs ──────────────────────────────────────────────────────────
  const tradeId = Math.floor(Date.now() / 1000); // unique per-run
  const [tradePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("trade-v2"),
      seller.publicKey.toBuffer(),
      new BN(tradeId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-v2"), tradePda.toBuffer()],
    PROGRAM_ID
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
    PROGRAM_ID
  );
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);

  console.log(`\nPDAs for this trade:`);
  console.log(`  Trade:    ${tradePda.toBase58()}`);
  console.log(`  Escrow:   ${escrowPda.toBase58()}`);
  console.log(`  Vault:    ${vaultAta.toBase58()}`);

  // ─── STEP 1: create_trade ──────────────────────────────────────────
  logStep(1, "create_trade");
  const tx1 = await (program.methods as any)
    .createTrade({
      tradeId: new BN(tradeId),
      amount: new BN(AMOUNT_BASE),
      side: { sell: {} },
      feeBps: FEE_BPS,
    })
    .accounts({
      creator: seller.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      mint: USDT_MINT,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc({ commitment: "confirmed" });
  console.log(`✅ create_trade tx: ${tx1}`);
  console.log(`   https://solscan.io/tx/${tx1}`);

  // ─── STEP 2: lock_escrow ───────────────────────────────────────────
  logStep(2, "lock_escrow (seller deposits USDT, sets buyer as counterparty)");
  const tx2 = await (program.methods as any)
    .lockEscrow({ counterparty: buyer.publicKey })
    .accounts({
      depositor: seller.publicKey,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta: sellerAta,
      mint: USDT_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc({ commitment: "confirmed" });
  console.log(`✅ lock_escrow tx: ${tx2}`);
  console.log(`   https://solscan.io/tx/${tx2}`);

  const vaultUsdt = await getBalance(connection, vaultAta);
  console.log(`   Vault now holds: ${vaultUsdt} USDT (expected ${AMOUNT_USDT})`);
  if (Math.abs(vaultUsdt - AMOUNT_USDT) > 0.0001) {
    throw new Error(`Vault balance mismatch`);
  }

  // ─── STEP 3: confirm_payment ───────────────────────────────────────
  logStep(3, "confirm_payment (buyer signs — pretend fiat sent off-chain)");
  const tx3 = await (program.methods as any)
    .confirmPayment()
    .accounts({
      buyer: buyer.publicKey,
      trade: tradePda,
      escrow: escrowPda,
    })
    .signers([buyer])
    .rpc({ commitment: "confirmed" });
  console.log(`✅ confirm_payment tx: ${tx3}`);
  console.log(`   https://solscan.io/tx/${tx3}`);

  // ─── STEP 4: release_escrow ────────────────────────────────────────
  logStep(4, "release_escrow (seller releases USDT to buyer + fee to treasury)");

  // Build extra ATA-creation instructions if buyer/treasury ATAs don't exist
  const preIxs: anchor.web3.TransactionInstruction[] = [];

  try {
    await getAccount(connection, buyerAta);
  } catch {
    console.log(`   (creating buyer USDT ATA — first-time)`);
    preIxs.push(
      createAssociatedTokenAccountInstruction(seller.publicKey, buyerAta, buyer.publicKey, USDT_MINT)
    );
  }
  try {
    await getAccount(connection, treasuryAta);
  } catch {
    console.log(`   (creating treasury USDT ATA — first-time, costs ~$0.40 in SOL)`);
    preIxs.push(
      createAssociatedTokenAccountInstruction(seller.publicKey, treasuryAta, treasury, USDT_MINT)
    );
  }

  const tx4 = await (program.methods as any)
    .releaseEscrow()
    .accounts({
      signer: seller.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      counterpartyAta: buyerAta,
      treasuryAta,
      depositor: seller.publicKey,
      mint: USDT_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preIxs)
    .signers([seller])
    .rpc({ commitment: "confirmed" });
  console.log(`✅ release_escrow tx: ${tx4}`);
  console.log(`   https://solscan.io/tx/${tx4}`);

  // ─── Verify ────────────────────────────────────────────────────────
  logStep(5, "verify");
  const buyerUsdtAfter = await getBalance(connection, buyerAta);
  const treasuryUsdtAfter = await getBalance(connection, treasuryAta);
  const sellerUsdtAfter = await getBalance(connection, sellerAta);

  const expectedFee = AMOUNT_USDT * (FEE_BPS / 10000);
  const expectedPayout = AMOUNT_USDT - expectedFee;

  console.log(`Buyer USDT:    ${buyerUsdtBefore} → ${buyerUsdtAfter}    (gained ${(buyerUsdtAfter - buyerUsdtBefore).toFixed(6)})`);
  console.log(`Treasury USDT: ${treasuryUsdtBefore} → ${treasuryUsdtAfter}    (gained ${(treasuryUsdtAfter - treasuryUsdtBefore).toFixed(6)})`);
  console.log(`Seller USDT:   ${sellerUsdt} → ${sellerUsdtAfter}    (lost ${(sellerUsdt - sellerUsdtAfter).toFixed(6)})`);
  console.log(`\nExpected: payout=${expectedPayout}, fee=${expectedFee}`);

  const buyerOk = Math.abs(buyerUsdtAfter - buyerUsdtBefore - expectedPayout) < 0.001;
  const treasuryOk = Math.abs(treasuryUsdtAfter - treasuryUsdtBefore - expectedFee) < 0.001;

  if (!buyerOk) throw new Error(`Buyer payout mismatch`);
  if (!treasuryOk) throw new Error(`Treasury fee mismatch`);

  console.log("\n✅ ✅ ✅  ALL CHECKS PASSED  ✅ ✅ ✅");
  console.log("\nMainnet trade flow works end-to-end:");
  console.log(`  Seller deposited: ${AMOUNT_USDT} USDT`);
  console.log(`  Buyer received:   ${expectedPayout} USDT (97.${100 - FEE_BPS / 100}%)`);
  console.log(`  Treasury fee:     ${expectedFee} USDT (${FEE_BPS / 100}%)`);

  // ─── Optional sweep ────────────────────────────────────────────────
  if (SWEEP_TO) {
    logStep(6, `sweep buyer's USDT back to ${SWEEP_TO}`);
    const sweepDest = new PublicKey(SWEEP_TO);
    const sweepDestAta = await getAssociatedTokenAddress(USDT_MINT, sweepDest);

    const sweepPreIxs: anchor.web3.TransactionInstruction[] = [];
    try {
      await getAccount(connection, sweepDestAta);
    } catch {
      console.log(`   (creating destination USDT ATA)`);
      sweepPreIxs.push(
        createAssociatedTokenAccountInstruction(buyer.publicKey, sweepDestAta, sweepDest, USDT_MINT)
      );
    }

    const sweepTx = new anchor.web3.Transaction();
    sweepTx.add(...sweepPreIxs);
    sweepTx.add(
      createTransferInstruction(
        buyerAta,
        sweepDestAta,
        buyer.publicKey,
        Math.round(buyerUsdtAfter * 1_000_000)
      )
    );
    const sweepSig = await anchor.web3.sendAndConfirmTransaction(connection, sweepTx, [buyer], {
      commitment: "confirmed",
    });
    console.log(`✅ swept ${buyerUsdtAfter} USDT to ${SWEEP_TO}`);
    console.log(`   tx: ${sweepSig}`);
    console.log(`   https://solscan.io/tx/${sweepSig}`);
  }

  console.log("\n🏁 DONE.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Smoke test FAILED:");
    console.error(err);
    process.exit(1);
  });
