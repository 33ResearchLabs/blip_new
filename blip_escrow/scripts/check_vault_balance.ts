import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  
  const tradePda = new PublicKey("7ZxABWMBrFpXkW1eoUpGFhBZfvJPLFfaDF69UBFnH23C");
  const escrowPda = new PublicKey("DVp2UkQMe6WHWCGf6wqaYx3uLpvW4FkqjrP3q7CVd4Mg");
  
  // vault authority = PDA of ["vault-authority-v2", escrow_pda]
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
    PROGRAM_ID
  );
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  
  console.log(`Trade PDA:       ${tradePda.toBase58()}`);
  console.log(`Escrow PDA:      ${escrowPda.toBase58()}`);
  console.log(`Vault authority: ${vaultAuthority.toBase58()}`);
  console.log(`Vault ATA:       ${vaultAta.toBase58()}`);
  
  try {
    const info = await conn.getTokenAccountBalance(vaultAta);
    const balance = Number(info.value.amount) / 1e6;
    console.log(`\nVault USDT balance: ${balance} USDT`);
    if (balance > 0) {
      console.log(`⚠️  FUNDS STUCK IN VAULT: ${balance} USDT`);
      console.log(`   Creator (escrow depositor): D1M4bjQkYgvCihyH31ApqUMPCEF3U42kViNgDnw4GNzi`);
      console.log(`   Action needed: refund_escrow (creator signs)`);
      console.log(`   Expires on-chain: 2026-06-08T16:48:14.000Z`);
    } else {
      console.log(`✅ No funds in vault`);
    }
  } catch (e: any) {
    console.log(`Vault ATA may not exist: ${e.message?.slice(0, 100)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
