/**
 * lifecycle_test.ts — full devnet end-to-end test of blip_protocol_v2.
 * Run: ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *      ANCHOR_WALLET=/Users/apple/Documents/Jeys/blip-v3-devnet-wallet.json \
 *      npx tsx scripts/lifecycle_test.ts
 *
 * Seller/creator/depositor = the provider wallet (funded). Buyer = generated
 * (needs 0 SOL). Tests: create→lock→release (fee split) + close_trade, and
 * create→fund→refund (the paths that were broken on the dead mainnet v2).
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const ok = (c: boolean, m: string) => { console.log(`   ${c ? "✅" : "❌"} ${m}`); if (!c) { failed = true; } };
let failed = false;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as anchor.Program<any>;
  const conn = provider.connection;
  const seller = (provider.wallet as anchor.Wallet).payer;
  const buyer = Keypair.generate();
  const pid = program.programId;
  console.log("Program:", pid.toBase58());
  console.log("Seller :", seller.publicKey.toBase58());
  console.log("Buyer  :", buyer.publicKey.toBase58(), "(0 SOL)\n");

  const [cfgPda] = PublicKey.findProgramAddressSync([Buffer.from("protocol-config")], pid);
  const cfg: any = await program.account.protocolConfig.fetch(cfgPda);
  const feeBps = cfg.feeBps;
  console.log("🪙 Creating test mint (6 dp) + minting 5 to seller...");
  const mint = await createMint(conn, seller, seller.publicKey, null, 6);
  const sellerAta = await getOrCreateAssociatedTokenAccount(conn, seller, mint, seller.publicKey);
  const buyerAta = await getOrCreateAssociatedTokenAccount(conn, seller, mint, buyer.publicKey);
  const treasuryAta = await getOrCreateAssociatedTokenAccount(conn, seller, mint, cfg.treasury);
  await mintTo(conn, seller, mint, sellerAta.address, seller, 5_000_000);
  console.log("   mint:", mint.toBase58(), "\n");

  const pdas = (tradeId: anchor.BN) => {
    const [trade] = PublicKey.findProgramAddressSync(
      [Buffer.from("trade-v2"), seller.publicKey.toBuffer(), tradeId.toArrayLike(Buffer, "le", 8)], pid);
    const [escrow] = PublicKey.findProgramAddressSync([Buffer.from("escrow-v2"), trade.toBuffer()], pid);
    const [va] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority-v2"), escrow.toBuffer()], pid);
    const vaultAta = getAssociatedTokenAddressSync(mint, va, true);
    return { trade, escrow, va, vaultAta };
  };
  const amount = new anchor.BN(1_000_000); // 1.0 token

  // ─────────── TRADE 1: create → lock → release → close ───────────
  console.log("════ TRADE 1: release path ════");
  const id1 = new anchor.BN(Date.now());
  const t1 = pdas(id1);
  await program.methods.createTrade({ tradeId: id1, amount, side: { sell: {} }, feeBps })
    .accountsPartial({ creator: seller.publicKey, protocolConfig: cfgPda, trade: t1.trade, mint, systemProgram: SystemProgram.programId })
    .signers([seller]).rpc();
  console.log("1️⃣ created");
  await program.methods.lockEscrow({ counterparty: buyer.publicKey })
    .accountsPartial({ depositor: seller.publicKey, protocolConfig: cfgPda, trade: t1.trade, escrow: t1.escrow,
      vaultAuthority: t1.va, vaultAta: t1.vaultAta, depositorAta: sellerAta.address, mint,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([seller]).rpc();
  const vaultBal = Number((await getAccount(conn, t1.vaultAta)).amount);
  console.log("2️⃣ locked — vault holds", vaultBal / 1e6);
  ok(vaultBal === amount.toNumber(), "vault funded with full amount");

  const buyBefore = Number((await getAccount(conn, buyerAta.address)).amount);
  const treBefore = Number((await getAccount(conn, treasuryAta.address)).amount);
  await program.methods.releaseEscrow()
    .accountsPartial({ signer: seller.publicKey, protocolConfig: cfgPda, trade: t1.trade, escrow: t1.escrow,
      vaultAuthority: t1.va, vaultAta: t1.vaultAta, counterpartyAta: buyerAta.address, treasuryAta: treasuryAta.address,
      depositor: seller.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([seller]).rpc();
  const buyGot = Number((await getAccount(conn, buyerAta.address)).amount) - buyBefore;
  const treGot = Number((await getAccount(conn, treasuryAta.address)).amount) - treBefore;
  const expFee = Math.floor(amount.toNumber() * feeBps / 10000);
  console.log("3️⃣ released — buyer +", buyGot / 1e6, "| treasury +", treGot / 1e6);
  ok(treGot === expFee, `fee correct (${expFee / 1e6})`);
  ok(buyGot === amount.toNumber() - expFee, `payout correct (${(amount.toNumber() - expFee) / 1e6})`);

  const t1info = await conn.getAccountInfo(t1.trade);
  const e1info = await conn.getAccountInfo(t1.escrow);
  console.log("4️⃣ release auto-closed accounts (rent → depositor)");
  ok(t1info === null, "trade PDA auto-closed by release");
  ok(e1info === null, "escrow PDA auto-closed by release");

  // ─────────── TRADE 2: create → fund → refund ───────────
  console.log("\n════ TRADE 2: refund path ════");
  const id2 = new anchor.BN(Date.now() + 1);
  const t2 = pdas(id2);
  await program.methods.createTrade({ tradeId: id2, amount, side: { sell: {} }, feeBps })
    .accountsPartial({ creator: seller.publicKey, protocolConfig: cfgPda, trade: t2.trade, mint, systemProgram: SystemProgram.programId })
    .signers([seller]).rpc();
  console.log("1️⃣ created");
  await program.methods.fundEscrow()
    .accountsPartial({ depositor: seller.publicKey, protocolConfig: cfgPda, trade: t2.trade, escrow: t2.escrow,
      vaultAuthority: t2.va, vaultAta: t2.vaultAta, depositorAta: sellerAta.address, mint,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([seller]).rpc();
  console.log("2️⃣ funded (no counterparty)");
  const refBefore = Number((await getAccount(conn, sellerAta.address)).amount);
  await program.methods.refundEscrow()
    .accountsPartial({ signer: seller.publicKey, trade: t2.trade, escrow: t2.escrow, vaultAuthority: t2.va,
      vaultAta: t2.vaultAta, depositorAta: sellerAta.address, depositor: seller.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([seller]).rpc();
  const refGot = Number((await getAccount(conn, sellerAta.address)).amount) - refBefore;
  console.log("3️⃣ refunded — seller +", refGot / 1e6);
  ok(refGot === amount.toNumber(), "full amount refunded (no fee)");

  console.log("\n" + (failed ? "❌ SOME CHECKS FAILED" : "🎉 ALL CHECKS PASSED — full lifecycle works on devnet"));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
