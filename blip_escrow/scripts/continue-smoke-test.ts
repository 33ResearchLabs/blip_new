/**
 * continue-smoke-test.ts — pick up where mainnet-smoke-test.ts left off.
 * Use when an RPC blockhash glitch killed confirm_payment but lock_escrow
 * already committed 5 USDT to the vault.
 *
 * Reads current Trade state, runs whatever steps are still needed.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import {
  PublicKey,
  Keypair,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const TRADE_PDA = new PublicKey("HtraSmLGBayT82HiWdhGqtPzhd2Bq61FYa4z5rjYuVYw");
const ESCROW_PDA = new PublicKey("EMQz7PSd8KiqcmURoThpv414Tp7H76swy6bCvugcqyDn");
const SWEEP_TO = new PublicKey("76L7becGBuixSYUCDbwz3xLAaZgpAy3ccX8u7reCYGyD");

function loadKeypair(path: string): Keypair {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(data));
}

async function getBalance(conn: Connection, ata: PublicKey): Promise<number> {
  try {
    const acc = await getAccount(conn, ata);
    return Number(acc.amount) / 1_000_000;
  } catch {
    return 0;
  }
}

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      console.log(`   retry ${i + 1}/${max}: ${e.message || e}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(`${label} failed after ${max} retries: ${lastErr.message || lastErr}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;

  const seller = loadKeypair("keys/test-seller.json");
  const buyer = loadKeypair("keys/test-buyer.json");

  console.log(`Seller: ${seller.publicKey.toBase58()}`);
  console.log(`Buyer:  ${buyer.publicKey.toBase58()}`);

  // Read current trade state
  const trade: any = await (program.account as any).trade.fetch(TRADE_PDA);
  const status = Object.keys(trade.status)[0]; // anchor enum → string
  console.log(`Trade current status: ${status}`);
  console.log(`Trade counterparty:   ${trade.counterparty.toBase58()}`);
  console.log(`Trade amount:         ${trade.amount.toString()} (${Number(trade.amount) / 1_000_000} USDT)`);

  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    PROGRAM_ID
  );
  const config: any = await (program.account as any).protocolConfig.fetch(protocolConfigPda);
  const treasury = config.treasury as PublicKey;

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority-v2"), ESCROW_PDA.toBuffer()],
    PROGRAM_ID
  );
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  const buyerAta = await getAssociatedTokenAddress(USDT_MINT, buyer.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(USDT_MINT, treasury);

  // STEP 3: confirm_payment (if still in Locked)
  if (status === "locked") {
    console.log("\n→ Calling confirm_payment...");
    const tx3 = await withRetry("confirm_payment", () =>
      (program.methods as any)
        .confirmPayment()
        .accounts({
          buyer: buyer.publicKey,
          trade: TRADE_PDA,
          escrow: ESCROW_PDA,
        })
        .signers([buyer])
        .rpc({ commitment: "confirmed" })
    );
    console.log(`✅ confirm_payment: ${tx3}`);
    console.log(`   https://solscan.io/tx/${tx3}`);
  } else {
    console.log(`\n(skipping confirm_payment — status is ${status}, not Locked)`);
  }

  // STEP 4: release_escrow
  const trade2: any = await (program.account as any).trade.fetch(TRADE_PDA);
  const status2 = Object.keys(trade2.status)[0];
  console.log(`\nStatus before release: ${status2}`);

  if (status2 === "paymentSent" || status2 === "locked") {
    const preIxs: anchor.web3.TransactionInstruction[] = [];
    try { await getAccount(connection, buyerAta); }
    catch {
      console.log("   (creating buyer USDT ATA)");
      preIxs.push(createAssociatedTokenAccountInstruction(seller.publicKey, buyerAta, buyer.publicKey, USDT_MINT));
    }
    try { await getAccount(connection, treasuryAta); }
    catch {
      console.log("   (creating treasury USDT ATA)");
      preIxs.push(createAssociatedTokenAccountInstruction(seller.publicKey, treasuryAta, treasury, USDT_MINT));
    }

    console.log("\n→ Calling release_escrow...");
    const tx4 = await withRetry("release_escrow", () =>
      (program.methods as any)
        .releaseEscrow()
        .accounts({
          signer: seller.publicKey,
          protocolConfig: protocolConfigPda,
          trade: TRADE_PDA,
          escrow: ESCROW_PDA,
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
        .rpc({ commitment: "confirmed" })
    );
    console.log(`✅ release_escrow: ${tx4}`);
    console.log(`   https://solscan.io/tx/${tx4}`);
  } else {
    console.log(`(skipping release — status is ${status2})`);
  }

  // Verify
  console.log("\n──────── FINAL STATE ────────");
  const buyerUsdt = await getBalance(connection, buyerAta);
  const treasuryUsdt = await getBalance(connection, treasuryAta);
  console.log(`Buyer USDT:    ${buyerUsdt}`);
  console.log(`Treasury USDT: ${treasuryUsdt}`);

  // Sweep buyer's USDT back to user wallet
  if (buyerUsdt > 0) {
    console.log(`\n→ Sweeping ${buyerUsdt} USDT back to ${SWEEP_TO.toBase58()}...`);
    const sweepDestAta = await getAssociatedTokenAddress(USDT_MINT, SWEEP_TO);
    const sweepPreIxs: anchor.web3.TransactionInstruction[] = [];
    try { await getAccount(connection, sweepDestAta); }
    catch {
      console.log("   (creating destination USDT ATA)");
      sweepPreIxs.push(createAssociatedTokenAccountInstruction(buyer.publicKey, sweepDestAta, SWEEP_TO, USDT_MINT));
    }
    const sweepTx = new anchor.web3.Transaction();
    sweepTx.add(...sweepPreIxs);
    sweepTx.add(
      createTransferInstruction(
        buyerAta,
        sweepDestAta,
        buyer.publicKey,
        Math.round(buyerUsdt * 1_000_000)
      )
    );
    const sig = await withRetry("sweep", () =>
      anchor.web3.sendAndConfirmTransaction(connection, sweepTx, [buyer], { commitment: "confirmed" })
    );
    console.log(`✅ swept ${buyerUsdt} USDT — tx: ${sig}`);
    console.log(`   https://solscan.io/tx/${sig}`);
  }

  console.log("\n🏁 DONE.");
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
