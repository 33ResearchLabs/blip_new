// Read the raw bytes of the trade PDA to understand its actual structure
import { Connection, PublicKey } from "@solana/web3.js";

const TRADE_PDA   = new PublicKey("7ZxABWMBrFpXkW1eoUpGFhBZfvJPLFfaDF69UBFnH23C");
const ESCROW_PDA  = new PublicKey("DVp2UkQMe6WHWCGf6wqaYx3uLpvW4FkqjrP3q7CVd4Mg");

// Expected discriminators
const DISC_V2_3 = [132, 139, 123, 31, 157, 196, 244, 190]; // sha256("account:Trade")[0..8]

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  for (const [label, pda] of [["TRADE", TRADE_PDA], ["ESCROW", ESCROW_PDA]] as const) {
    const info = await conn.getAccountInfo(pda);
    if (!info) { console.log(`${label}: account not found`); continue; }
    const d = info.data;
    console.log(`\n=== ${label} PDA: ${pda.toBase58()} ===`);
    console.log(`  Total bytes: ${d.length}`);
    console.log(`  Owner: ${info.owner.toBase58()}`);
    
    // First 8 bytes = discriminator
    const disc = Array.from(d.slice(0, 8));
    const expectedDisc = DISC_V2_3;
    const discMatches = disc.every((b, i) => b === expectedDisc[i]);
    console.log(`  Discriminator bytes: [${disc.join(', ')}]`);
    console.log(`  V2.3 Trade discriminator: [${expectedDisc.join(', ')}]`);
    console.log(`  Discriminator matches V2.3: ${discMatches}`);
    
    if (label === "TRADE") {
      // Parse the layout we know
      const creator = new PublicKey(d.slice(8, 40));
      const counterparty = new PublicKey(d.slice(40, 72));
      const tradeId = d.readBigUInt64LE(72);
      const mint = new PublicKey(d.slice(80, 112));
      const amount = d.readBigUInt64LE(112);
      const statusByte = d[120];
      
      console.log(`\n  Parsed (assuming V2.2 layout):`);
      console.log(`  creator:       ${creator.toBase58()}`);
      console.log(`  counterparty:  ${counterparty.toBase58()}`);
      console.log(`  trade_id:      ${tradeId}`);
      console.log(`  mint:          ${mint.toBase58()}`);
      console.log(`  amount:        ${Number(amount) / 1e6} USDT`);
      console.log(`  status byte:   ${statusByte}`);
      console.log(`  V2.2 status:   ${['Created','Locked','Released','Refunded'][statusByte] ?? 'unknown'}`);
      console.log(`  V2.3 status:   ${['Created','Funded','Locked','PaymentSent','Disputed','Released','Refunded'][statusByte] ?? 'unknown'}`);
      
      if (d.length === 238) {
        // V2.3 layout has treasury at [123..155]
        const feeBps = d.readUInt16LE(121);
        const treasury = new PublicKey(d.slice(123, 155));
        const escrowBump = d[155];
        const bump = d[156];
        console.log(`\n  Parsed (assuming V2.3 layout at 238 bytes):`);
        console.log(`  fee_bps: ${feeBps}`);
        console.log(`  treasury: ${treasury.toBase58()}`);
        console.log(`  escrow_bump: ${escrowBump}`);
        console.log(`  bump: ${bump}`);
      } else if (d.length === 150) {
        // V2.2 layout
        const feeBps = d.readUInt16LE(121);
        const escrowBump = d[123];
        const bump = d[124];
        console.log(`\n  Parsed (V2.2 layout at 150 bytes):`);
        console.log(`  fee_bps: ${feeBps}`);
        console.log(`  escrow_bump: ${escrowBump}`);
        console.log(`  bump: ${bump}`);
        console.log(`  created_at: ${new Date(Number(d.readBigInt64LE(125)) * 1000).toISOString()}`);
        console.log(`  side byte: ${d[149]}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
