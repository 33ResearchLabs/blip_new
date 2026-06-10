import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/blip_protocol_v2.json";

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(conn, {} as any, {});
  const program = new anchor.Program(idl as any, provider);
  
  const trades = [
    { pda: "EndVLg7fL5RzaiHovMwPiw9Mag9yPTTPXd8aHuRKU8Qi", label: "BUY order (cancelled in DB) — BM-260607-8CA4" },
    { pda: "7ZxABWMBrFpXkW1eoUpGFhBZfvJPLFfaDF69UBFnH23C", label: "SELL order (disputed in DB) — BM-260607-7DA9" },
  ];
  
  const now = Math.floor(Date.now() / 1000);
  console.log("Now:", new Date(now * 1000).toISOString());
  
  for (const { pda, label } of trades) {
    console.log(`\n=== ${label} ===`);
    console.log(`Trade PDA: ${pda}`);
    try {
      const t: any = await (program.account as any).trade.fetch(new PublicKey(pda));
      const status = Object.keys(t.status)[0];
      const side = Object.keys(t.side)[0];
      const expiresAt = Number(t.expiresAt);
      const isExpired = expiresAt > 0 && now >= expiresAt;
      const expDate = expiresAt === 0 ? "0 (no expiry)" : new Date(expiresAt * 1000).toISOString();
      console.log(`  on-chain status: ${status}`);
      console.log(`  side: ${side}`);
      console.log(`  amount: ${Number(t.amount) / 1e6} USDT`);
      console.log(`  fee_bps: ${t.feeBps}`);
      console.log(`  creator: ${t.creator.toBase58()}`);
      console.log(`  counterparty: ${t.counterparty.toBase58()}`);
      console.log(`  expires_at: ${expDate}`);
      console.log(`  is_expired: ${isExpired}`);
      console.log(`  FUNDS STUCK: ${status === 'funded' ? '⚠️  YES — needs refund' : '✅ No (status: ' + status + ')'}`);
    } catch (e: any) {
      console.log(`  ❌ Account not found or error: ${e.message?.slice(0, 200)}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
