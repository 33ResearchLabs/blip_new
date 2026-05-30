import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount, createTransferInstruction } from "@solana/spl-token";
import * as fs from "fs";

const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const SWEEP_TO = new PublicKey("76L7becGBuixSYUCDbwz3xLAaZgpAy3ccX8u7reCYGyD");

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const buyer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("keys/test-buyer.json","utf-8"))));
  const buyerAta = await getAssociatedTokenAddress(USDT_MINT, buyer.publicKey);
  const acc = await getAccount(conn, buyerAta);
  const amount = acc.amount;
  console.log(`Buyer holds: ${Number(amount) / 1e6} USDT`);

  const destAta = await getAssociatedTokenAddress(USDT_MINT, SWEEP_TO);
  const tx = new Transaction();
  try { await getAccount(conn, destAta); console.log("Destination USDT ATA exists."); }
  catch {
    console.log("Creating destination USDT ATA...");
    tx.add(createAssociatedTokenAccountInstruction(buyer.publicKey, destAta, SWEEP_TO, USDT_MINT));
  }
  tx.add(createTransferInstruction(buyerAta, destAta, buyer.publicKey, amount));
  const sig = await sendAndConfirmTransaction(conn, tx, [buyer], { commitment: "confirmed" });
  console.log(`✅ swept ${Number(amount) / 1e6} USDT to ${SWEEP_TO.toBase58()}`);
  console.log(`   tx: https://solscan.io/tx/${sig}`);
}
main().catch(e => { console.error("❌", e); process.exit(1); });
