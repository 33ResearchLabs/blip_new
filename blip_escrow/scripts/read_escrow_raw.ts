import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import idl from "../target/idl/blip_protocol_v2.json";

const TRADE_PDA   = new PublicKey("7ZxABWMBrFpXkW1eoUpGFhBZfvJPLFfaDF69UBFnH23C");
const ESCROW_PDA  = new PublicKey("DVp2UkQMe6WHWCGf6wqaYx3uLpvW4FkqjrP3q7CVd4Mg");
const PROGRAM_ID  = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(conn, {} as any, {});
  const program = new anchor.Program(idl as any, provider);

  // Parse escrow using Anchor
  const escrow: any = await (program.account as any).escrow.fetch(ESCROW_PDA);
  console.log("=== ESCROW (parsed by Anchor) ===");
  console.log("  trade:           ", escrow.trade.toBase58());
  console.log("  vaultAuthority:  ", escrow.vaultAuthority.toBase58());
  console.log("  vaultAta:        ", escrow.vaultAta.toBase58());
  console.log("  depositor:       ", escrow.depositor.toBase58());
  console.log("  amount:          ", Number(escrow.amount) / 1e6, "USDT");
  console.log("  bump:            ", escrow.bump);
  console.log("  vaultBump:       ", escrow.vaultBump);

  console.log("\n  escrow.trade == TRADE_PDA:", escrow.trade.toBase58() === TRADE_PDA.toBase58());

  // Parse trade using Anchor
  const trade: any = await (program.account as any).trade.fetch(TRADE_PDA);
  console.log("\n=== TRADE (parsed by Anchor) ===");
  console.log("  creator:     ", trade.creator.toBase58());
  console.log("  tradeId:     ", trade.tradeId.toString());
  console.log("  bump:        ", trade.bump);
  console.log("  escrowBump:  ", trade.escrowBump);
  console.log("  status:      ", Object.keys(trade.status)[0]);
  console.log("  treasury:    ", trade.treasury.toBase58());

  // Re-derive the trade PDA from what Anchor parsed
  const [derivedTradePda, derivedBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("trade-v2"),
      trade.creator.toBuffer(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(trade.tradeId.toString())); return b; })()
    ],
    PROGRAM_ID
  );
  console.log("\n=== PDA Derivation Check ===");
  console.log("  Derived trade PDA:   ", derivedTradePda.toBase58());
  console.log("  Actual trade PDA:    ", TRADE_PDA.toBase58());
  console.log("  PDAs match:          ", derivedTradePda.toBase58() === TRADE_PDA.toBase58());
  console.log("  Derived bump:        ", derivedBump);
  console.log("  Stored bump:         ", trade.bump);
  console.log("  Bumps match:         ", derivedBump === trade.bump);

  // Re-derive escrow PDA
  const [derivedEscrowPda, derivedEscrowBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-v2"), TRADE_PDA.toBuffer()],
    PROGRAM_ID
  );
  console.log("\n  Derived escrow PDA:  ", derivedEscrowPda.toBase58());
  console.log("  Actual escrow PDA:   ", ESCROW_PDA.toBase58());
  console.log("  Escrow PDAs match:   ", derivedEscrowPda.toBase58() === ESCROW_PDA.toBase58());
  console.log("  Derived escrow bump: ", derivedEscrowBump);
  console.log("  Stored escrow bump:  ", escrow.bump);
}
main().catch(e => { console.error(e); process.exit(1); });
