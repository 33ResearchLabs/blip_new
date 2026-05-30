/**
 * refund-stuck-trades.ts — emergency recovery
 *
 * Refunds 3 specific stuck Funded escrows back to their depositor (the
 * user's embedded wallet), then sweeps recovered USDT to a destination.
 *
 * Usage:
 *   SECRET_KEY_BS58=<base58> SWEEP_TO=<pubkey> npx tsx scripts/refund-stuck-trades.ts
 *
 * After running, the user MUST delete this embedded wallet from settle
 * and create a new one — the secret key was exposed in transcript.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

const STUCK_TRADES = [
  "GWLfhYg12V2h1taaC4c6pXvfsKZyQoiEZFnjWjm5Mh1P",
  "282wUt2fs6fWZbFmNaJo3iRfGt79mquGUWbhR3EqWNfp",
  "B2BVQPqcZihUQwX1NuvmSVn1D5dgLBZ9b4J3TqMiUvFU",
];

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 4): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      console.log(`   retry ${i + 1}/${max} on ${label}: ${e.message?.slice(0, 100)}`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const bs58Key = process.env.SECRET_KEY_BS58;
  if (!bs58Key) throw new Error("SECRET_KEY_BS58 env var required");
  const sweepToStr = process.env.SWEEP_TO;
  if (!sweepToStr) throw new Error("SWEEP_TO env var required");

  const secretBytes = bs58.decode(bs58Key);
  const depositor = Keypair.fromSecretKey(new Uint8Array(secretBytes));
  console.log(`Depositor: ${depositor.publicKey.toBase58()}`);

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const wallet = new anchor.Wallet(depositor);
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as any, provider);

  const sweepTo = new PublicKey(sweepToStr);
  const depositorAta = await getAssociatedTokenAddress(USDT_MINT, depositor.publicKey);

  const initialSol = await conn.getBalance(depositor.publicKey);
  console.log(`Starting SOL: ${initialSol / 1e9}`);
  let initialUsdt = 0;
  try {
    const acc = await getAccount(conn, depositorAta);
    initialUsdt = Number(acc.amount) / 1e6;
  } catch {}
  console.log(`Starting USDT: ${initialUsdt}`);

  for (const tradePdaStr of STUCK_TRADES) {
    const tradePda = new PublicKey(tradePdaStr);
    console.log(`\n──── Refunding ${tradePdaStr} ────`);

    const trade: any = await (program.account as any).trade.fetch(tradePda);
    const status = Object.keys(trade.status)[0];
    const amount = Number(trade.amount) / 1e6;
    console.log(`  status=${status}, amount=${amount} USDT, depositor=${trade.creator.toBase58()}`);

    if (status !== "funded") {
      console.log(`  ⏭️  Skipping — not in 'funded' state`);
      continue;
    }
    if (!trade.creator.equals(depositor.publicKey)) {
      console.log(`  ⏭️  Skipping — depositor mismatch (we can't sign)`);
      continue;
    }

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow-v2"), tradePda.toBuffer()],
      PROGRAM_ID
    );
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
      PROGRAM_ID
    );
    const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);

    const sig = await withRetry("refund_escrow", () =>
      (program.methods as any)
        .refundEscrow()
        .accounts({
          signer: depositor.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority,
          vaultAta,
          depositorAta,
          depositor: depositor.publicKey,
          mint: USDT_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([depositor])
        .rpc({ commitment: "confirmed" })
    );
    console.log(`  ✅ refunded: https://solscan.io/tx/${sig}`);
  }

  // Sweep all USDT back to user's main wallet
  console.log(`\n──── Sweeping recovered USDT to ${sweepToStr} ────`);
  let usdtBal = 0;
  try {
    const acc = await getAccount(conn, depositorAta);
    usdtBal = Number(acc.amount) / 1e6;
  } catch {}
  console.log(`  Current USDT: ${usdtBal}`);

  if (usdtBal > 0) {
    const sweepDestAta = await getAssociatedTokenAddress(USDT_MINT, sweepTo);
    const tx = new Transaction();
    try { await getAccount(conn, sweepDestAta); }
    catch {
      console.log(`  (creating destination ATA)`);
      tx.add(createAssociatedTokenAccountInstruction(depositor.publicKey, sweepDestAta, sweepTo, USDT_MINT));
    }
    tx.add(createTransferInstruction(depositorAta, sweepDestAta, depositor.publicKey, Math.round(usdtBal * 1e6)));
    const sweepSig = await withRetry("sweep", () =>
      sendAndConfirmTransaction(conn, tx, [depositor], { commitment: "confirmed" })
    );
    console.log(`  ✅ swept ${usdtBal} USDT to ${sweepToStr}`);
    console.log(`  tx: https://solscan.io/tx/${sweepSig}`);
  }

  const finalSol = await conn.getBalance(depositor.publicKey);
  console.log(`\nFinal SOL: ${finalSol / 1e9} (rent recovered: ${(finalSol - initialSol) / 1e9})`);
  console.log(`\n🏁 DONE.`);
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
