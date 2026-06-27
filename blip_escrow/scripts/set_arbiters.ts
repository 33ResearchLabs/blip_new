/**
 * set_arbiters.ts — register the dispute-arbiter allowlist on devnet.
 *
 * AUTHORITY ONLY. These 4 compliance-officer wallets can each resolve disputes
 * on-chain (in addition to the protocol authority). Replaces the full list.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=/Users/apple/Documents/Jeys/blip-v3-devnet-wallet.json \
 *   npx ts-node scripts/set_arbiters.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";

// Read via fs (not a JSON import) so it works under both CJS and ESM ts-node.
// Run from the blip_escrow dir so this relative path resolves.
const idl = JSON.parse(readFileSync("target/idl/blip_protocol_v2.json", "utf8"));

const ARBITERS = [
  "FD4MqhLuobg1KFCXDok46PjMPWjPSL6P9wzLkwSvV9dr",
  "FxXGLxEQhdsR29B64i1BnbDkBVvLktrRyexdUt6BYA5Q",
  "GbYh4KnigcsMS2TVTawEB3K8eBXWkuvZURGiJ44urNGL",
  "GdaNzoQB2ezpn9g9rhe6wMNxaFrFMC1UFm38Uw7KC18C",
].map((s) => new PublicKey(s));

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = new anchor.Program(idl as any, provider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("protocol-config")], program.programId);
  const [arbiterSetPda] = PublicKey.findProgramAddressSync([Buffer.from("arbiter-set")], program.programId);

  console.log("program:        ", program.programId.toBase58());
  console.log("authority:      ", provider.wallet.publicKey.toBase58());
  console.log("protocol-config:", configPda.toBase58());
  console.log("arbiter-set PDA:", arbiterSetPda.toBase58());
  console.log("registering arbiters:");
  ARBITERS.forEach((a, i) => console.log(`  [${i}] ${a.toBase58()}`));

  const sig = await program.methods
    .setArbiters({ arbiters: ARBITERS })
    .accountsPartial({
      authority: provider.wallet.publicKey,
      protocolConfig: configPda,
      arbiterSet: arbiterSetPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("\n✅ set_arbiters tx:", sig);

  const acct: any = await program.account.arbiterSet.fetch(arbiterSetPda);
  console.log("\non-chain arbiter set — count:", acct.count);
  acct.arbiters
    .slice(0, acct.count)
    .forEach((a: PublicKey, i: number) => console.log(`  [${i}] ${a.toBase58()}`));
  console.log("authority on record:", acct.authority.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
