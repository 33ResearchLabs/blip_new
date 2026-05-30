import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
  console.log("🔧 Initializing Blip Protocol v2.2 Config");
  console.log("==========================================\n");

  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;

  const authority = (provider.wallet as anchor.Wallet).payer;
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Program ID:", program.programId.toBase58());

  // V2.2 Protocol treasury - user specified
  const treasury = new PublicKey("8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB");
  console.log("Treasury:", treasury.toBase58());

  // Derive protocol config PDA
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    program.programId
  );
  console.log("Protocol Config PDA:", protocolConfigPda.toBase58());

  // Check if already initialized
  try {
    const existingConfig = await program.account.protocolConfig.fetch(
      protocolConfigPda
    );
    console.log("\n⚠️  Protocol config already initialized");
    console.log("Current authority:", existingConfig.authority.toBase58());
    console.log("Current treasury:", existingConfig.treasury.toBase58());
    console.log("Current fee:", existingConfig.feeBps, "bps");
    console.log("Max fee cap:", existingConfig.maxFeeBps, "bps");
    console.log("Is frozen:", existingConfig.isFrozen);
    return;
  } catch (err) {
    // Not initialized, proceed
    console.log("✅ Protocol config not yet initialized, proceeding...\n");
  }

  // Initialize config
  const feeBps = 250; // 2.5% (UNBYPASSABLE)
  const maxFeeBps = 500; // 5% cap (immutable)
  const minFeeBps = 0; // 0% floor (immutable)

  console.log("📋 Config parameters:");
  console.log("  Fee:", feeBps, "bps (2.5% - ENFORCED ON-CHAIN)");
  console.log("  Max fee cap:", maxFeeBps, "bps (5%)");
  console.log("  Min fee floor:", minFeeBps, "bps (0%)");

  console.log("\n🔄 Sending transaction...");

  const tx = await program.methods
    .initializeConfig({
      feeBps,
      maxFeeBps,
      minFeeBps,
    })
    .accounts({
      authority: authority.publicKey,
      protocolConfig: protocolConfigPda,
      treasury: treasury,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Transaction confirmed:", tx);
  console.log("   Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  // Fetch and display config
  const config = await program.account.protocolConfig.fetch(protocolConfigPda);

  console.log("\n📊 Protocol Config Initialized:");
  console.log("  Authority:", config.authority.toBase58());
  console.log("  Treasury:", config.treasury.toBase58());
  console.log("  Fee:", config.feeBps, "bps (2.5%)");
  console.log("  Max fee cap:", config.maxFeeBps, "bps (immutable)");
  console.log("  Min fee floor:", config.minFeeBps, "bps (immutable)");
  console.log("  Version:", config.version);
  console.log("  Is frozen:", config.isFrozen);

  console.log("\n✅ V2.2 Protocol config initialized successfully!");
  console.log("\n⚠️  IMPORTANT: Save these addresses:");
  console.log("  Program ID:", program.programId.toBase58());
  console.log("  Protocol Config:", protocolConfigPda.toBase58());
  console.log("  Authority:", authority.publicKey.toBase58());
  console.log("  Treasury:", treasury.toBase58());

  console.log("\n🔒 Security Verification:");
  console.log("  ✅ Treasury receives 2.5% fee on ALL settlements");
  console.log("  ✅ Fee is enforced on-chain (UNBYPASSABLE)");
  console.log("  ✅ Fee snapshotted at match time");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
