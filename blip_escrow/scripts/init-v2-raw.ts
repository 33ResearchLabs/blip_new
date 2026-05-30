import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
// Manual u16 little-endian serialization
function serializeU16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

async function main() {
  console.log("🔧 Initializing Blip Protocol v2.2 Config (Raw)");
  console.log("================================================\n");

  const PROGRAM_ID = new PublicKey("6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87");
  const TREASURY = new PublicKey("8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB");

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load deployer keypair
  const keypairPath = `${homedir()}/.config/solana/id.json`;
  const secretKey = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Treasury:", TREASURY.toBase58());

  // Derive protocol config PDA
  const [protocolConfigPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    PROGRAM_ID
  );
  console.log("Protocol Config PDA:", protocolConfigPda.toBase58());
  console.log("Bump:", bump);

  // Check if already initialized
  const configAccount = await connection.getAccountInfo(protocolConfigPda);
  if (configAccount) {
    console.log("\n⚠️  Protocol config already initialized");
    console.log("Account owner:", configAccount.owner.toBase58());
    console.log("Account size:", configAccount.data.length, "bytes");
    return;
  }

  console.log("\n✅ Protocol config not yet initialized, proceeding...\n");

  // Parameters
  const fee_bps = 250; // 2.5%
  const max_fee_bps = 500; // 5%
  const min_fee_bps = 0; // 0%

  console.log("📋 Config parameters:");
  console.log("  Fee:", fee_bps, "bps (2.5%)");
  console.log("  Max fee cap:", max_fee_bps, "bps (5%)");
  console.log("  Min fee floor:", min_fee_bps, "bps (0%)");

  // Serialize params manually (3 u16 values)
  const paramsBuffer = Buffer.concat([
    serializeU16(fee_bps),
    serializeU16(max_fee_bps),
    serializeU16(min_fee_bps),
  ]);

  // Anchor instruction discriminator for initialize_config
  // SHA256("global:initialize_config")[0..8]
  const discriminator = Buffer.from([
    0xd0, 0x7f, 0x15, 0x01, 0xc2, 0xbe, 0xc4, 0x46,
  ]);

  const data = Buffer.concat([discriminator, Buffer.from(paramsBuffer)]);

  //Create instruction
  const keys = [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: protocolConfigPda, isSigner: false, isWritable: true },
    { pubkey: TREASURY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });

  // Create and send transaction
  console.log("\n🔄 Sending transaction...");

  const transaction = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [authority],
    { commitment: "confirmed" }
  );

  console.log("✅ Transaction confirmed:", signature);
  console.log("   Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);

  // Verify
  const verifyAccount = await connection.getAccountInfo(protocolConfigPda);
  if (verifyAccount) {
    console.log("\n📊 Protocol Config Created:");
    console.log("  PDA:", protocolConfigPda.toBase58());
    console.log("  Owner:", verifyAccount.owner.toBase58());
    console.log("  Size:", verifyAccount.data.length, "bytes");
    console.log("\n✅ V2.2 Protocol config initialized successfully!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
