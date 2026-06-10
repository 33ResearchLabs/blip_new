import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const SOL_PRICE = 150;

const wallets: [string, string][] = [
  ["D1M4 (compromised embedded)", "D1M4bjQkYgvCihyH31ApqUMPCEF3U42kViNgDnw4GNzi"],
  ["FFMBpn (zoopweb33 main)",     "FFMBpnJqtu461tmroQd6Fj6bi3EV2WGxiPhKPWeejJLp"],
  ["DyKspn (merchant server)",    "DyKspncDaguAyDB7aicgUVi5cpbdmRr3wd9xD7Tt5jhK"],
  ["2MgWJm (merchant 2)",         "2MgWJmN2UBPuAXSrmP9V4B4aVr8PwMewE7MNkcd7NmBc"],
  ["BEV2d9 (protocol authority)", "BEV2d9i6Vu9bn5YXkD2MmZAFVxzNCabzK3NV6Aej6C3S"],
  ["DtTPPk (trade 73x6 creator)", "DtTPPkc2XGCzS5cqsi4ySaJWeUKLaPj8ENePbygKekEF"],
];

async function main() {
  console.log("\nWallet balances:\n");
  for (const [label, addr] of wallets) {
    const bal = await conn.getBalance(new PublicKey(addr));
    const sol = bal / LAMPORTS_PER_SOL;
    console.log(`  ${label}`);
    console.log(`  ${addr}`);
    console.log(`  ${sol.toFixed(6)} SOL  ($${(sol * SOL_PRICE).toFixed(3)})`);
    const canClose = bal >= 64 * 5000 ? "✅ enough for close_all" : "❌ not enough";
    console.log(`  ${canClose}\n`);
  }

  const closeAllCost = 64 * 5000 / LAMPORTS_PER_SOL;
  const refundCost   =  2 * 9000 / LAMPORTS_PER_SOL;

  console.log("─────────────────────────────────────────");
  console.log(`close_all_trades  (64 txs): ${closeAllCost.toFixed(6)} SOL  ($${(closeAllCost * SOL_PRICE).toFixed(4)})`);
  console.log(`refund 2 stuck trades (2 txs): ${refundCost.toFixed(6)} SOL  ($${(refundCost * SOL_PRICE).toFixed(4)})`);
  console.log(`TOTAL needed: ${(closeAllCost + refundCost).toFixed(6)} SOL  ($${((closeAllCost + refundCost) * SOL_PRICE).toFixed(4)})`);
}

main().catch(console.error);
