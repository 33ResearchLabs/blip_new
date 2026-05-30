/**
 * init-config-mainnet.ts — Initialize ProtocolConfig for v1.0 mainnet.
 *
 * Differences from init-config.ts (devnet/dev script):
 *   - Treasury and authority are SEPARATE wallets (not the same key).
 *   - Tiered fees: min=150 (1.5%), default=200 (2%), max=250 (2.5%).
 *   - Reads treasury pubkey from $TREASURY_PUBKEY env var (not derived from
 *     the signing wallet).
 *   - Refuses to run if PROTOCOL_CONFIG already exists for this program ID.
 *
 * Usage:
 *
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   ANCHOR_WALLET=./keys/config-authority.json \
 *   TREASURY_PUBKEY=D3oNcCQ7yareg3UkzK7AQ4qk8oax9AbkZFVJcakD9vSP \
 *   ts-node scripts/init-config-mainnet.ts
 *
 * The `ANCHOR_WALLET` keypair becomes the protocol authority (signs
 * `update_config`, `resolve_dispute`, `emergency_refund_v2`). The
 * deployer key is NOT used here — initialize_config does not require a
 * special signer beyond the would-be authority.
 *
 * After this runs, save the printed Protocol Config PDA address — clients
 * (Settle frontend) need it to derive the same PDA for reads.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
  console.log("🚀 Initializing Protocol Config — MAINNET v1.0");
  console.log("================================================\n");

  // ─── Provider / wallet ────────────────────────────────────────────
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;

  const authority = (provider.wallet as anchor.Wallet).payer;
  console.log("RPC:        ", provider.connection.rpcEndpoint);
  console.log("Program ID: ", program.programId.toBase58());
  console.log("Authority:  ", authority.publicKey.toBase58());
  console.log("            (this becomes protocol_config.authority)");

  // ─── Treasury (separate from authority) ───────────────────────────
  const treasuryStr = process.env.TREASURY_PUBKEY;
  if (!treasuryStr) {
    console.error(
      "\n❌ TREASURY_PUBKEY env var is required. Pass the treasury wallet pubkey:\n" +
        "   TREASURY_PUBKEY=<pubkey> ts-node scripts/init-config-mainnet.ts"
    );
    process.exit(1);
  }
  let treasury: PublicKey;
  try {
    treasury = new PublicKey(treasuryStr);
  } catch (err) {
    console.error("❌ TREASURY_PUBKEY is not a valid base58 pubkey:", treasuryStr);
    process.exit(1);
  }
  console.log("Treasury:   ", treasury.toBase58());

  // Refuse to silently use the same wallet for both roles — that would
  // defeat the whole point of splitting them.
  if (treasury.equals(authority.publicKey)) {
    console.error(
      "\n⚠️  Refusing to initialize: treasury == authority. Use separate wallets."
    );
    console.error(
      "   If this is intentional for v0 testing, edit this script to remove the guard."
    );
    process.exit(1);
  }

  // ─── PDA ──────────────────────────────────────────────────────────
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    program.programId
  );
  console.log("\nProtocol Config PDA:", protocolConfigPda.toBase58());

  // ─── Already initialized? ─────────────────────────────────────────
  try {
    const existing = await program.account.protocolConfig.fetch(protocolConfigPda);
    console.log("\n⚠️  Protocol config already initialized for this program ID.");
    console.log("    Authority:    ", existing.authority.toBase58());
    console.log("    Treasury:     ", existing.treasury.toBase58());
    console.log("    fee_bps:      ", existing.feeBps);
    console.log("    min_fee_bps:  ", existing.minFeeBps);
    console.log("    max_fee_bps:  ", existing.maxFeeBps);
    console.log("    is_frozen:    ", existing.isFrozen);
    console.log("\n   Use `update_config` instead of re-initializing.");
    process.exit(0);
  } catch (_err) {
    // Not initialized — proceed.
  }

  // ─── v1.0 mainnet parameters (tiered fees) ────────────────────────
  // Caller picks fee_bps per trade in [min_fee_bps, max_fee_bps].
  // Frontend exposes 3 buttons: 1.5% / 2% / 2.5%.
  const feeBps = 200; // default tier (2%)
  const minFeeBps = 150; // 1.5% — cheap tier
  const maxFeeBps = 250; // 2.5% — fastest tier (program hard-caps at <= 1000 = 10%)

  console.log("\n📋 Init parameters:");
  console.log("  fee_bps (default):", feeBps, "(2.0%)");
  console.log("  min_fee_bps:      ", minFeeBps, "(1.5% — cheap tier)");
  console.log("  max_fee_bps:      ", maxFeeBps, "(2.5% — fastest tier)");
  console.log("  authority:        ", authority.publicKey.toBase58());
  console.log("  treasury:         ", treasury.toBase58());

  console.log("\n🔄 Sending transaction...");

  const txSig = await program.methods
    .initializeConfig({
      feeBps,
      minFeeBps,
      maxFeeBps,
    })
    .accounts({
      authority: authority.publicKey,
      protocolConfig: protocolConfigPda,
      treasury: treasury,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  console.log("✅ Transaction confirmed:", txSig);
  console.log(
    `   View: https://solscan.io/tx/${txSig}` +
      (provider.connection.rpcEndpoint.includes("devnet")
        ? "?cluster=devnet"
        : "")
  );

  // ─── Verify ──────────────────────────────────────────────────────
  const config = await program.account.protocolConfig.fetch(protocolConfigPda);
  console.log("\n📊 Protocol Config now on-chain:");
  console.log("  Authority:   ", config.authority.toBase58());
  console.log("  Treasury:    ", config.treasury.toBase58());
  console.log("  fee_bps:     ", config.feeBps);
  console.log("  min_fee_bps: ", config.minFeeBps, "(immutable beyond max cap)");
  console.log("  max_fee_bps: ", config.maxFeeBps, "(hard ceiling: 1000 = 10%)");
  console.log("  is_frozen:   ", config.isFrozen);

  // Sanity asserts
  if (config.feeBps !== feeBps) throw new Error("fee_bps mismatch after init");
  if (config.minFeeBps !== minFeeBps) throw new Error("min_fee_bps mismatch");
  if (config.maxFeeBps !== maxFeeBps) throw new Error("max_fee_bps mismatch");
  if (!config.authority.equals(authority.publicKey))
    throw new Error("authority mismatch");
  if (!config.treasury.equals(treasury)) throw new Error("treasury mismatch");
  if (config.isFrozen) throw new Error("is_frozen unexpectedly true");

  console.log("\n✅ All sanity checks passed.\n");

  console.log("📌 Save these addresses (paste into project memory):");
  console.log("   Program ID:          ", program.programId.toBase58());
  console.log("   Protocol Config PDA: ", protocolConfigPda.toBase58());
  console.log("   Authority:           ", authority.publicKey.toBase58());
  console.log("   Treasury:            ", treasury.toBase58());
  console.log("   Init tx:             ", txSig);
  console.log(
    "\n📌 Next steps:\n" +
      "   1. Smoke test with $10 trade (one user, one merchant).\n" +
      "   2. Verify treasury wallet receives the fee.\n" +
      "   3. Update settle/.env: NEXT_PUBLIC_ANCHOR_PROGRAM_ID + NEXT_PUBLIC_PROTOCOL_CONFIG_PDA.\n" +
      "   4. Deploy settle to Railway (or restart locally to pick up new env).\n" +
      "   5. Set hard launch caps in client (max $5k/trade) — prevents blast radius.\n"
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
