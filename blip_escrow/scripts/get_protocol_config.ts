import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/blip_protocol_v2.json";

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(conn, {} as any, {});
  const program = new anchor.Program(idl as any, provider);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("protocol-config")], program.programId);
  console.log("Config PDA:", configPda.toBase58());
  const config: any = await (program.account as any).protocolConfig.fetch(configPda);
  console.log("authority:  ", config.authority.toBase58());
  console.log("treasury:   ", config.treasury.toBase58());
  console.log("fee_bps:    ", config.feeBps);
}
main().catch(e => { console.error(e); process.exit(1); });
