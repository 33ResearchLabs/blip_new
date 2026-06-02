/**
 * close-terminal-trades.ts
 *
 * Sweeps all Released/Refunded Trade PDAs and calls close_trade on each.
 * Rent (~0.002547 SOL each) is returned to the original trade creator.
 *
 * Usage:
 *   KEYPAIR=<base58-secret-key> npx ts-node scripts/close-terminal-trades.ts
 *
 * Or with a keypair file:
 *   KEYPAIR_FILE=~/.config/solana/id.json npx ts-node scripts/close-terminal-trades.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import idl from "../../settle/src/lib/solana/v2/idl.json";

const RPC = "https://mainnet.helius-rpc.com/?api-key=c3ebc957-8f5f-4cdb-bb55-12af1de09403";
const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const STATUS_OFFSET = 120;
const LAMPORTS_PER_SOL = 1e9;

function loadKeypair(): Keypair {
  if (process.env.KEYPAIR) {
    return Keypair.fromSecretKey(bs58.decode(process.env.KEYPAIR));
  }
  if (process.env.KEYPAIR_FILE) {
    const raw = JSON.parse(fs.readFileSync(process.env.KEYPAIR_FILE, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  throw new Error("Set KEYPAIR (base58) or KEYPAIR_FILE env var");
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const keypair = loadKeypair();
  const conn = new Connection(RPC, "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl as any, provider);

  console.log("Caller (pays gas):", keypair.publicKey.toBase58());
  const bal = await conn.getBalance(keypair.publicKey);
  console.log("Caller balance:", (bal / LAMPORTS_PER_SOL).toFixed(6), "SOL");

  // Fetch all Trade PDAs
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 238 }],
  });
  console.log("Total Trade PDAs:", accounts.length);

  // Filter terminal (Released=5, Refunded=6)
  const terminal = accounts.filter(a => {
    const s = a.account.data[STATUS_OFFSET];
    return s === 5 || s === 6;
  });

  const STATUS = ["Created","Funded","Locked","PaymentSent","Disputed","Released","Refunded"];
  console.log("Terminal (Released/Refunded):", terminal.length);
  console.log("SOL to be returned to users:", (terminal.length * 0.002547).toFixed(6), "SOL\n");

  let closed = 0;
  let failed = 0;

  for (const { pubkey, account } of terminal) {
    const status = STATUS[account.data[STATUS_OFFSET]];
    const creator = new PublicKey(account.data.slice(8, 40));
    const tradeIdBuf = account.data.slice(72, 80);
    const tradeId = tradeIdBuf.readBigUInt64LE(0);

    process.stdout.write(`[${status}] ${pubkey.toBase58().slice(0,12)}... creator:${creator.toBase58().slice(0,12)}... `);

    try {
      const tx = await (program.methods as any)
        .closeTrade()
        .accounts({
          caller: keypair.publicKey,
          trade: pubkey,
          rentRecipient: creator,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc({ commitment: "confirmed" });

      console.log("✓ closed", tx.slice(0, 16) + "...");
      closed++;
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("already") || msg.includes("closed") || msg.includes("0x0")) {
        console.log("⚠ already closed, skip");
      } else {
        console.log("✗ FAILED:", msg.slice(0, 120));
        failed++;
      }
    }

    await sleep(300); // avoid rate limiting
  }

  console.log("\n═══ DONE ═══");
  console.log("Closed:", closed, "| Failed:", failed);
  console.log("SOL returned to users: ~" + (closed * 0.002547).toFixed(4), "SOL (~$" + (closed * 0.002547 * 160).toFixed(2) + ")");

  const balAfter = await conn.getBalance(keypair.publicKey);
  console.log("Gas spent:", ((bal - balAfter) / LAMPORTS_PER_SOL).toFixed(6), "SOL (~$" + ((bal - balAfter) / LAMPORTS_PER_SOL * 160).toFixed(4) + ")");
}

main().catch(e => { console.error(e); process.exit(1); });
