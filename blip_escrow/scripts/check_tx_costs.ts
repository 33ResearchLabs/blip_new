import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, { limit: 20 });
  
  const fees: number[] = [];
  for (const sig of sigs.slice(0, 15)) {
    const tx = await conn.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) continue;
    fees.push(tx.meta.fee);
    console.log(`  fee: ${tx.meta.fee} lamports  (${(tx.meta.fee/1e9*150).toFixed(6)} USD at $150/SOL)`);
  }
  if (!fees.length) return;
  const avg = fees.reduce((a,b)=>a+b,0)/fees.length;
  console.log(`\n  avg: ${avg.toFixed(0)} lamports = $${(avg/1e9*150).toFixed(6)}`);
  console.log(`  min: ${Math.min(...fees)} | max: ${Math.max(...fees)}`);
  
  // ATA creation cost (rent-exempt minimum for token account = 2039280 lamports)
  const ATA_RENT = 2_039_280;
  console.log(`\n  USDT ATA creation (rent): ${ATA_RENT} lamports = $${(ATA_RENT/1e9*150).toFixed(4)}`);
  console.log(`  Trade PDA rent (238 bytes): ${Math.ceil(238 * 6960 + 128 * 6960)} lamports ≈ $${(Math.ceil(238*6960+128*6960)/1e9*150).toFixed(4)}`);
  console.log(`  Escrow PDA rent (146 bytes): ${Math.ceil(146 * 6960 + 128 * 6960)} lamports ≈ $${(Math.ceil(146*6960+128*6960)/1e9*150).toFixed(4)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
