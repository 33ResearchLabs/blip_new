/**
 * Script to extend program data account and deploy updated program
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87");
const RPC_URL = "https://api.devnet.solana.com";
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

async function main() {
  // Load keypair
  const keypairPath = process.env.HOME + "/.config/solana/id.json";
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log("Payer:", payer.publicKey.toString());

  // Connect
  const connection = new Connection(RPC_URL, "confirmed");

  // Get balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  // Get program info
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    console.log("Program not found - need fresh deploy");
    return;
  }

  console.log("Program exists, checking data account...");

  // The program account contains the programData address at bytes 4-36
  const programDataAddress = new PublicKey(programInfo.data.slice(4, 36));
  console.log("Program data address:", programDataAddress.toString());

  const programDataInfo = await connection.getAccountInfo(programDataAddress);
  if (!programDataInfo) {
    console.log("Program data not found");
    return;
  }

  const currentSize = programDataInfo.data.length;
  console.log("Current program data size:", currentSize);

  // Read new program binary
  const programPath = "/Users/zeus/Downloads/blip-money-webapp-main/blip_escrow/target/deploy/blip_protocol_v2.so";
  const programData = fs.readFileSync(programPath);
  console.log("New program size:", programData.length);

  const neededSize = programData.length + 45; // Header overhead

  if (neededSize > currentSize) {
    const additionalBytes = neededSize - currentSize;
    console.log(`Need to extend by ${additionalBytes} bytes`);

    // Calculate rent
    const rent = await connection.getMinimumBalanceForRentExemption(neededSize);
    const currentRent = await connection.getMinimumBalanceForRentExemption(currentSize);
    const additionalRent = rent - currentRent;
    console.log(`Additional rent needed: ${additionalRent / 1e9} SOL`);

    // Build extend instruction
    // ExtendProgram instruction: index 6 in BPF Upgradeable Loader
    // Data: [6 (u32 LE), additional_bytes (u32 LE)]
    const extendData = Buffer.alloc(8);
    extendData.writeUInt32LE(6, 0); // ExtendProgram instruction index
    extendData.writeUInt32LE(additionalBytes, 4);

    const extendIx = new TransactionInstruction({
      keys: [
        { pubkey: programDataAddress, isSigner: false, isWritable: true },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: true }, // Program must be writable
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      ],
      programId: BPF_UPGRADEABLE_LOADER,
      data: extendData,
    });

    console.log("Sending extend transaction...");
    const tx = new Transaction().add(extendIx);

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });
      console.log("✅ Extended program! Signature:", sig);
    } catch (err: any) {
      console.error("❌ Extend failed:", err.message);
      if (err.logs) {
        console.error("Logs:", err.logs);
      }
      return;
    }
  } else {
    console.log("Program data account is large enough, no extension needed");
  }

  console.log("\n🚀 Program extended. Now run:");
  console.log("anchor upgrade target/deploy/blip_protocol_v2.so --program-id 6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87 --provider.cluster devnet");
}

main().catch(console.error);
