/**
 * set_promo_zero_fee.ts — Flip the protocol into a 0% promotional fee state.
 *
 * Calls `update_config` with `new_min_fee_bps = 0` (and optionally
 * `new_fee_bps = 0`) so every new `create_trade` can choose any fee in
 * [0, max_fee_bps]. Reversible: rerun with `--restore N` to set min back
 * to N bps when the promo period ends.
 *
 * Usage:
 *   ts-node scripts/set_promo_zero_fee.ts <upgrade-authority.json>           # min → 0, default fee → 0
 *   ts-node scripts/set_promo_zero_fee.ts <auth.json> --restore 200          # min → 200 (2%)
 *   ts-node scripts/set_promo_zero_fee.ts <auth.json> --default-fee 50       # min → 0, default fee → 0.5%
 *
 *   Requires the same keypair that owns ProtocolConfig.authority
 *   (`6yU8cbxm3teKJHNyAgZxTtxvJmPBhvwVyWBoA9xzeCRZ` on mainnet).
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");

function loadIdl() {
  const p = path.resolve(__dirname, "../target/idl/blip_protocol_v2.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv[0] || argv[0].startsWith("--")) {
    console.error("Usage: ts-node set_promo_zero_fee.ts <auth-keypair.json> [--restore <bps>] [--default-fee <bps>] [--rpc <url>]");
    process.exit(1);
  }
  const keypairPath = argv[0];
  const restoreIdx = argv.indexOf("--restore");
  const defaultFeeIdx = argv.indexOf("--default-fee");
  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : "https://api.mainnet-beta.solana.com";

  const newMin = restoreIdx >= 0 ? parseInt(argv[restoreIdx + 1], 10) : 0;
  const newFeeArg = defaultFeeIdx >= 0 ? parseInt(argv[defaultFeeIdx + 1], 10) : 0;
  if (newMin < 0 || newMin > 1000) {
    console.error(`--restore must be 0..1000 bps (got ${newMin})`);
    process.exit(1);
  }
  if (newFeeArg < newMin) {
    console.error(`--default-fee (${newFeeArg}) cannot be below new min (${newMin})`);
    process.exit(1);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = loadIdl();
  const program = new anchor.Program(idl, provider);

  // Derive ProtocolConfig PDA
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    PROGRAM_ID
  );

  // Snapshot current state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const before = await (program.account as any).protocolConfig.fetch(protocolConfig);
  console.log(`Authority:  ${authority.publicKey.toBase58()}`);
  console.log(`RPC:        ${rpcUrl}`);
  console.log(`Config PDA: ${protocolConfig.toBase58()}`);
  console.log("\nBefore:");
  console.log(`  fee_bps:     ${before.feeBps}  (${(before.feeBps / 100).toFixed(2)}%)`);
  console.log(`  min_fee_bps: ${before.minFeeBps}  (${(before.minFeeBps / 100).toFixed(2)}%)`);
  console.log(`  max_fee_bps: ${before.maxFeeBps}  (${(before.maxFeeBps / 100).toFixed(2)}%)`);
  console.log(`  is_frozen:   ${before.isFrozen}`);
  console.log(`  treasury:    ${before.treasury.toBase58()}`);

  console.log(`\nUpdating to:  min_fee_bps=${newMin}, new_fee_bps=${newFeeArg}`);

  const sig = await program.methods
    .updateConfig({
      newAuthority: null,
      newTreasury: null,
      newFeeBps: newFeeArg,
      isFrozen: null,
      newMinFeeBps: newMin,
      newMaxFeeBps: null,
    })
    .accounts({
      authority: authority.publicKey,
      protocolConfig,
      newTreasury: null,
    })
    .rpc();
  console.log(`Tx: ${sig}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const after = await (program.account as any).protocolConfig.fetch(protocolConfig);
  console.log("\nAfter:");
  console.log(`  fee_bps:     ${after.feeBps}  (${(after.feeBps / 100).toFixed(2)}%)`);
  console.log(`  min_fee_bps: ${after.minFeeBps}  (${(after.minFeeBps / 100).toFixed(2)}%)`);
  console.log(`  max_fee_bps: ${after.maxFeeBps}  (${(after.maxFeeBps / 100).toFixed(2)}%)`);

  if (newMin === 0) {
    console.log("\nPromo mode active: any new trade may request fee_bps = 0.");
    console.log("To exit promo: ts-node scripts/set_promo_zero_fee.ts <auth.json> --restore <bps>");
  } else {
    console.log(`\nPromo ended: minimum fee is now ${newMin} bps (${(newMin / 100).toFixed(2)}%).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
