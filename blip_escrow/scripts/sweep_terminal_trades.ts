/**
 * sweep_terminal_trades.ts — Reclaim rent from terminal Trade PDAs.
 *
 * After the v2.3 close_trade upgrade is deployed, this script walks every
 * Trade PDA owned by the program, filters for status ∈ {Released, Refunded},
 * and submits `close_trade` instructions in batches. Each PDA returns
 * ~2.55M lamports (~$0.22) to its original creator.
 *
 * Permissioned: the caller can be ANY wallet (the program enforces that
 * rent flows to `trade.creator`, not the caller). A reaper bot wallet
 * with a few SOL for network fees is enough.
 *
 * Usage:
 *   # 1. Make sure the v2.3 upgrade is deployed (deploy_v2_3_close_trade.sh)
 *   # 2. Set up a wallet that just pays fees:
 *   solana-keygen new -o ~/.config/solana/reaper.json
 *   solana airdrop 1 -k ~/.config/solana/reaper.json   # for devnet
 *   # 3. Run:
 *   ts-node scripts/sweep_terminal_trades.ts ~/.config/solana/reaper.json
 *
 * Flags:
 *   --dry-run         Print plan, don't broadcast
 *   --creator <pk>    Only sweep trades by this creator (e.g. one user)
 *   --rpc <url>       Override RPC endpoint (default: mainnet-beta)
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");

// Trade.LEN as computed in state/trade.rs:
//   8 + 32 + 32 + 8 + 32 + 8 + 1 + 2 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 8 + 8 + 8 + 32
const TRADE_ACCOUNT_SIZE = 238;

// Anchor discriminator for Trade account (first 8 bytes). Confirm by
// hashing "account:Trade" with sha256 and taking the first 8 bytes.
// The IDL has the canonical value.
function loadIdl() {
  const idlPath = path.resolve(__dirname, "../target/idl/blip_protocol_v2.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

interface TerminalTradeRow {
  pda: PublicKey;
  creator: PublicKey;
  tradeId: bigint;
  status: number;
}

const STATUS_RELEASED = 5; // matches TradeStatus enum order in state/trade.rs
const STATUS_REFUNDED = 6;

async function main() {
  const argv = process.argv.slice(2);
  const keypairPath = argv[0];
  if (!keypairPath) {
    console.error("Usage: ts-node sweep_terminal_trades.ts <reaper-keypair.json> [--dry-run] [--creator <pk>] [--rpc <url>]");
    process.exit(1);
  }
  const dryRun = argv.includes("--dry-run");
  const creatorFilterIdx = argv.indexOf("--creator");
  const creatorFilter = creatorFilterIdx >= 0 ? new PublicKey(argv[creatorFilterIdx + 1]) : null;
  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : "https://api.mainnet-beta.solana.com";

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const reaper = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`Reaper:  ${reaper.publicKey.toBase58()}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log(`Mode:    ${dryRun ? "DRY-RUN" : "LIVE"}`);
  if (creatorFilter) console.log(`Filter:  creator=${creatorFilter.toBase58()}`);

  const wallet = new anchor.Wallet(reaper);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new anchor.Program(idl, provider);

  console.log("\nFetching all Trade accounts...");
  const all = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: TRADE_ACCOUNT_SIZE }],
  });
  console.log(`Found ${all.length} accounts at size ${TRADE_ACCOUNT_SIZE}`);

  const terminals: TerminalTradeRow[] = [];
  for (const acc of all) {
    // status field offset: 8 (disc) + 32 (creator) + 32 (counterparty) + 8 (trade_id) + 32 (mint) + 8 (amount) = 120
    const status = acc.account.data[120];
    if (status !== STATUS_RELEASED && status !== STATUS_REFUNDED) continue;
    const creator = new PublicKey(acc.account.data.subarray(8, 40));
    if (creatorFilter && !creator.equals(creatorFilter)) continue;
    const tradeId = acc.account.data.readBigUInt64LE(72); // 8 + 32 + 32 = 72
    terminals.push({
      pda: acc.pubkey,
      creator,
      tradeId,
      status,
    });
  }

  console.log(`\nTerminal trades to close: ${terminals.length}`);
  const totalLamports = terminals.length * 2547360;
  console.log(`Estimated rent return:    ${totalLamports} lamports (~${(totalLamports / 1e9).toFixed(6)} SOL)`);

  if (terminals.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (dryRun) {
    console.log("\nDRY-RUN — no transactions broadcast.");
    terminals.slice(0, 20).forEach((t, i) => {
      console.log(`  [${i + 1}] ${t.pda.toBase58()}  status=${t.status === 5 ? "Released" : "Refunded"}  → creator=${t.creator.toBase58()}`);
    });
    if (terminals.length > 20) console.log(`  ...and ${terminals.length - 20} more`);
    return;
  }

  // Batch: 10 close_trade ixs per tx (well under the 1232-byte tx ceiling).
  const BATCH = 10;
  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < terminals.length; i += BATCH) {
    const chunk = terminals.slice(i, i + BATCH);
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 + chunk.length * 30_000 }));
    for (const t of chunk) {
      const ix = await program.methods
        .closeTrade()
        .accounts({
          caller: reaper.publicKey,
          trade: t.pda,
          rentRecipient: t.creator,
        })
        .instruction();
      tx.add(ix);
    }
    try {
      const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      successCount += chunk.length;
      console.log(`  Batch ${Math.floor(i / BATCH) + 1}: closed ${chunk.length} trades  sig=${sig.slice(0, 24)}…`);
    } catch (err) {
      failCount += chunk.length;
      console.warn(`  Batch ${Math.floor(i / BATCH) + 1}: FAILED — ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. closed=${successCount}  failed=${failCount}`);
  console.log(`Total rent returned: ${(successCount * 2547360 / 1e9).toFixed(6)} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
