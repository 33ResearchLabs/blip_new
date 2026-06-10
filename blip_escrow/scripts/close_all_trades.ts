/**
 * close_all_trades.ts
 * Calls close_trade on every terminal Trade PDA (released/refunded).
 * Rent (~0.002547 SOL each) is returned to the original trade.creator.
 * Caller just pays the ~5000 lamport tx fee per close.
 *
 * Usage:
 *   SECRET_KEY_BS58=<any funded wallet> npx tsx scripts/close_all_trades.ts
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const DRY_RUN = process.env.DRY_RUN === "true";

const TERMINAL = new Set(['released', 'refunded']);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function withRetry<T>(label: string, fn: () => Promise<T>, max = 5): Promise<T> {
  let last: any;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e: any) {
      last = e;
      console.log(`  [retry ${i+1}/${max} on ${label}]: ${e.message?.slice(0,80)}`);
      await sleep(3000 * (i + 1));
    }
  }
  throw last;
}

async function main() {
  const bs58Key = process.env.SECRET_KEY_BS58;
  if (!bs58Key) throw new Error("SECRET_KEY_BS58 env var required");

  const caller = Keypair.fromSecretKey(new Uint8Array(bs58.decode(bs58Key)));
  const conn = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(caller), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as any, provider);

  console.log(`\nCaller: ${caller.publicKey.toBase58()}`);
  const callerBal = await conn.getBalance(caller.publicKey);
  console.log(`Caller SOL: ${(callerBal / 1e9).toFixed(6)}`);
  if (DRY_RUN) console.log(`\n[DRY RUN — no transactions will be sent]\n`);

  console.log("\nFetching all trades…");
  const trades = await withRetry("trade.all", () => (program.account as any).trade.all());
  console.log(`Found ${trades.length} trades\n`);

  const terminal = trades.filter((t: any) => TERMINAL.has(Object.keys(t.account.status)[0]));
  const skip     = trades.filter((t: any) => !TERMINAL.has(Object.keys(t.account.status)[0]));

  console.log(`Terminal (closeable): ${terminal.length}`);
  console.log(`Skipped (open/funded): ${skip.length}`);
  if (skip.length > 0) {
    for (const t of skip) {
      const status = Object.keys(t.account.status)[0];
      console.log(`  SKIP [${status}] trade_id=${t.account.tradeId} ${t.publicKey.toBase58()}`);
    }
  }
  console.log();

  let closed = 0, failed = 0, totalRentReclaimed = 0;
  const RENT_PER_TRADE = 0.002547;

  for (const t of terminal) {
    const tradePda = t.publicKey;
    const creator  = t.account.creator as PublicKey;
    const status   = Object.keys(t.account.status)[0];
    const tradeId  = t.account.tradeId.toString();

    process.stdout.write(`[${status}] trade_id=${tradeId} → `);

    if (DRY_RUN) {
      console.log(`DRY RUN — would close, rent → ${creator.toBase58()}`);
      closed++;
      totalRentReclaimed += RENT_PER_TRADE;
      continue;
    }

    try {
      const sig = await withRetry(`close:${tradeId}`, () =>
        (program.methods as any)
          .closeTrade()
          .accounts({
            caller: caller.publicKey,
            trade: tradePda,
            rentRecipient: creator,
          })
          .signers([caller])
          .rpc({ commitment: "confirmed" })
      );
      console.log(`✅ https://solscan.io/tx/${sig}`);
      closed++;
      totalRentReclaimed += RENT_PER_TRADE;
      await sleep(400); // gentle rate limit
    } catch (e: any) {
      console.log(`❌ ${e.message?.slice(0, 100)}`);
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Closed:  ${closed}  trades`);
  console.log(`  Failed:  ${failed}  trades`);
  console.log(`  Rent reclaimed: ~${totalRentReclaimed.toFixed(4)} SOL → creators`);
  console.log(`  Tx fees paid by caller: ~${(closed * 0.000005).toFixed(4)} SOL`);
  console.log(`${'─'.repeat(60)}\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
