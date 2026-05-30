import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/blip_protocol_v2.json";

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(conn, {} as any, {});
  const program = new anchor.Program(idl as any, provider);
  const trades = [
    "GWLfhYg12V2h1taaC4c6pXvfsKZyQoiEZFnjWjm5Mh1P",
    "282wUt2fs6fWZbFmNaJo3iRfGt79mquGUWbhR3EqWNfp",
    "B2BVQPqcZihUQwX1NuvmSVn1D5dgLBZ9b4J3TqMiUvFU",
  ];
  const now = Math.floor(Date.now() / 1000);
  console.log("Now:", new Date(now * 1000).toISOString(), "(unix:", now, ")");
  for (const pda of trades) {
    const t: any = await (program.account as any).trade.fetch(new PublicKey(pda));
    const status = Object.keys(t.status)[0];
    const expiresAt = Number(t.expiresAt);
    const isExpired = expiresAt > 0 && now >= expiresAt;
    const expDate = expiresAt === 0 ? "0 (no expiry)" : new Date(expiresAt * 1000).toISOString();
    console.log(`\n${pda}`);
    console.log(`  status: ${status}`);
    console.log(`  amount: ${Number(t.amount) / 1e6} USDT`);
    console.log(`  fee_bps: ${t.feeBps}`);
    console.log(`  creator: ${t.creator.toBase58()}`);
    console.log(`  expires_at: ${expDate}`);
    console.log(`  is_expired: ${isExpired}`);
    console.log(`  can_auto_refund (anyone): ${status === 'funded' && isExpired}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
