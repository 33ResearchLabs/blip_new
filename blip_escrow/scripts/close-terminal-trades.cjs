/**
 * close-terminal-trades.cjs
 * Sweeps all Released/Refunded Trade PDAs and calls close_trade on each.
 * Rent (~0.002547 SOL each) returned to original trade creator.
 *
 * close_trade is NOT in the deployed IDL so we build the instruction manually
 * using the Anchor discriminator: sha256("global:close_trade")[0..8]
 *
 * Usage:
 *   KEYPAIR_FILE=/tmp/blip-burner.json node scripts/close-terminal-trades.cjs
 */

const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const fs = require("fs");

const RPC = "https://mainnet.helius-rpc.com/?api-key=c3ebc957-8f5f-4cdb-bb55-12af1de09403";
const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const STATUS_OFFSET = 120;
const LAMPORTS_PER_SOL = 1e9;
const STATUS = ["Created","Funded","Locked","PaymentSent","Disputed","Released","Refunded"];

// Anchor discriminator for close_trade = sha256("global:close_trade")[0..8]
const CLOSE_TRADE_IX_DATA = Buffer.from([161, 199, 69, 82, 9, 63, 203, 42]);

function loadKeypair() {
  if (process.env.KEYPAIR) {
    const bs58mod = bs58.default || bs58;
    return Keypair.fromSecretKey(bs58mod.decode(process.env.KEYPAIR));
  }
  if (process.env.KEYPAIR_FILE) {
    const raw = JSON.parse(fs.readFileSync(process.env.KEYPAIR_FILE, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  throw new Error("Set KEYPAIR or KEYPAIR_FILE");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildCloseTradeTx(caller, tradePda, rentRecipient) {
  // Accounts: caller (mut, signer), trade (mut), rentRecipient (mut), systemProgram
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    data: CLOSE_TRADE_IX_DATA,
    keys: [
      { pubkey: caller,        isSigner: true,  isWritable: true  },
      { pubkey: tradePda,      isSigner: false, isWritable: true  },
      { pubkey: rentRecipient, isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
  return ix;
}

async function main() {
  const keypair = loadKeypair();
  const conn = new Connection(RPC, "confirmed");

  console.log("Caller:", keypair.publicKey.toBase58());
  const bal = await conn.getBalance(keypair.publicKey);
  console.log("Balance:", (bal / LAMPORTS_PER_SOL).toFixed(6), "SOL\n");

  const accounts = await conn.getProgramAccounts(PROGRAM_ID, { filters: [{ dataSize: 238 }] });
  console.log("Total Trade PDAs:", accounts.length);

  const terminal = accounts.filter(a => {
    const s = a.account.data[STATUS_OFFSET];
    return s === 5 || s === 6;
  });
  console.log("Terminal to close:", terminal.length);
  console.log("Estimated SOL returned to users: ~" + (terminal.length * 0.002547).toFixed(4) + " SOL ($" + (terminal.length * 0.002547 * 160).toFixed(2) + ")\n");

  let closed = 0, failed = 0, skipped = 0;

  for (const { pubkey, account } of terminal) {
    const status = STATUS[account.data[STATUS_OFFSET]];
    const creator = new PublicKey(account.data.slice(8, 40));

    process.stdout.write(`[${status}] ${pubkey.toBase58().slice(0,16)}... -> ${creator.toBase58().slice(0,12)}... `);

    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: keypair.publicKey, recentBlockhash: blockhash });
      tx.add(buildCloseTradeTx(keypair.publicKey, pubkey, creator));
      tx.sign(keypair);

      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

      console.log("✓", sig.slice(0, 20) + "...");
      closed++;
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes("already") || msg.includes("3012") || msg.includes("custom program error: 0x0")) {
        console.log("⚠ skip (already closed)");
        skipped++;
      } else {
        console.log("✗ FAILED:", msg.slice(0, 120));
        failed++;
      }
    }

    await sleep(400);
  }

  const balAfter = await conn.getBalance(keypair.publicKey);
  console.log("\n═══ DONE ═══");
  console.log("Closed:", closed, "| Skipped:", skipped, "| Failed:", failed);
  console.log("SOL returned to users: ~" + (closed * 0.002547).toFixed(4), "SOL (~$" + (closed * 0.002547 * 160).toFixed(2) + ")");
  console.log("Gas spent by burner:", ((bal - balAfter) / LAMPORTS_PER_SOL).toFixed(6), "SOL (~$" + ((bal - balAfter) / LAMPORTS_PER_SOL * 160).toFixed(4) + ")");
}

main().catch(e => { console.error(e); process.exit(1); });
