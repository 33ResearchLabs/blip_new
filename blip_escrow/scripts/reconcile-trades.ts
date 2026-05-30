import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import { PublicKey } from "@solana/web3.js";

async function main() {
  console.log("📊 Trade Reconciliation Report");
  console.log("===============================\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;

  // Fetch all trades
  console.log("🔍 Fetching all trades...\n");
  const trades = await program.account.trade.all();

  console.log(`Found ${trades.length} trade(s)\n`);

  // Group by status
  const byStatus: Record<string, number> = {
    created: 0,
    locked: 0,
    released: 0,
    refunded: 0,
  };

  let totalVolume = 0;
  let totalFees = 0;

  console.log("Trade Details:");
  console.log("==============\n");

  trades.forEach((trade, idx) => {
    const data = trade.account;
    const statusKey = Object.keys(data.status)[0];

    byStatus[statusKey]++;

    console.log(`[${idx + 1}] Trade ${trade.publicKey.toBase58()}`);
    console.log(`    Creator: ${data.creator.toBase58()}`);
    console.log(`    Trade ID: ${data.tradeId.toString()}`);
    console.log(
      `    Amount: ${data.amount.toString()} (fee: ${data.feeBps} bps)`
    );
    console.log(`    Status: ${statusKey.toUpperCase()}`);
    console.log(`    Side: ${Object.keys(data.side)[0].toUpperCase()}`);

    if (statusKey === "released") {
      const amount = data.amount.toNumber();
      const fee = Math.floor((amount * data.feeBps) / 10_000);
      totalVolume += amount;
      totalFees += fee;
    }

    if (data.counterparty.toBase58() !== PublicKey.default.toBase58()) {
      console.log(`    Counterparty: ${data.counterparty.toBase58()}`);
    }

    console.log(
      `    Created: ${new Date(data.createdAt.toNumber() * 1000).toISOString()}`
    );

    if (data.lockedAt.toNumber() > 0) {
      console.log(
        `    Locked: ${new Date(data.lockedAt.toNumber() * 1000).toISOString()}`
      );
    }

    if (data.settledAt.toNumber() > 0) {
      console.log(
        `    Settled: ${new Date(data.settledAt.toNumber() * 1000).toISOString()}`
      );
    }

    console.log("");
  });

  // Summary
  console.log("Summary:");
  console.log("========\n");
  console.log("Status breakdown:");
  console.log(`  Created:  ${byStatus.created}`);
  console.log(`  Locked:   ${byStatus.locked}`);
  console.log(`  Released: ${byStatus.released}`);
  console.log(`  Refunded: ${byStatus.refunded}`);
  console.log("");
  console.log(`Total volume (released): ${totalVolume} tokens`);
  console.log(`Total fees collected: ${totalFees} tokens`);
  console.log("");

  // Check for stuck trades
  const stuck = trades.filter((t) => {
    const status = Object.keys(t.account.status)[0];
    return status === "created" || status === "locked";
  });

  if (stuck.length > 0) {
    console.log("⚠️  Stuck Trades (not settled):");
    stuck.forEach((t) => {
      console.log(`  - ${t.publicKey.toBase58()} (${Object.keys(t.account.status)[0]})`);
    });
  } else {
    console.log("✅ No stuck trades");
  }

  // Fetch protocol config for reference
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    program.programId
  );

  try {
    const config = await program.account.protocolConfig.fetch(
      protocolConfigPda
    );
    console.log("\nProtocol Config:");
    console.log("================");
    console.log(`  Current fee: ${config.feeBps} bps`);
    console.log(`  Treasury: ${config.treasury.toBase58()}`);
    console.log(`  Frozen: ${config.isFrozen}`);
  } catch (err) {
    console.log("\n⚠️  Protocol config not found");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
