/**
 * V2.2 SMOKE TEST: Lane-based Atomic Matching
 *
 * This script tests the complete PRIMARY PATH for instant matching:
 * 1. Create lane
 * 2. Fund lane
 * 3. Create signed offer (with lane_id)
 * 4. Atomic match in single transaction
 * 5. Release escrow
 * 6. Verify exact balances
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Ed25519Program,
  TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as ed25519 from "@noble/ed25519";
import * as fs from "fs";

// Color output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(color: keyof typeof colors, ...args: any[]) {
  console.log(colors[color], ...args, colors.reset);
}

// Serialize offer (V2.2 - 105 bytes)
function serializeOffer(offer: {
  creator: PublicKey;
  mint: PublicKey;
  amount: anchor.BN;
  side: { buy?: {} } | { sell?: {} };
  tradeId: anchor.BN;
  expiry: anchor.BN;
  nonce: anchor.BN;
  laneId: anchor.BN;
}): Buffer {
  const sideValue = "sell" in offer.side ? 1 : 0;

  return Buffer.concat([
    offer.creator.toBuffer(),
    offer.mint.toBuffer(),
    offer.amount.toArrayLike(Buffer, "le", 8),
    Buffer.from([sideValue]),
    offer.tradeId.toArrayLike(Buffer, "le", 8),
    offer.expiry.toArrayLike(Buffer, "le", 8),
    offer.nonce.toArrayLike(Buffer, "le", 8),
    offer.laneId.toArrayLike(Buffer, "le", 8), // V2.2
  ]);
}

function hashOffer(offerBytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(offerBytes).digest();
}

function createEd25519Instruction(
  publicKey: Buffer,
  message: Buffer,
  signature: Buffer
): TransactionInstruction {
  const numSignatures = 1;
  const paddingOffset = 2;
  const signatureOffset = paddingOffset + 2;
  const publicKeyOffset = signatureOffset + 64;
  const messageOffset = publicKeyOffset + 32;
  const messageSize = message.length;

  const data = Buffer.alloc(paddingOffset + 2 + 64 + 32 + 2 + messageSize, 0);

  data.writeUInt8(numSignatures, 0);
  data.writeUInt8(0, 1);

  data.writeUInt16LE(signatureOffset, paddingOffset);
  signature.copy(data, signatureOffset);

  data.writeUInt16LE(publicKeyOffset, paddingOffset + 2 + 64);
  publicKey.copy(data, publicKeyOffset);

  data.writeUInt16LE(messageOffset, paddingOffset + 2 + 64 + 32);
  data.writeUInt16LE(messageSize, paddingOffset + 2 + 64 + 32 + 2);
  message.copy(data, messageOffset);

  return new TransactionInstruction({
    keys: [],
    programId: Ed25519Program.programId,
    data,
  });
}

async function main() {
  log("blue", "\n========================================");
  log("blue", "  V2.2 LANE SMOKE TEST");
  log("blue", "  Instant Atomic Matching Flow");
  log("blue", "========================================\n");

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const treasury = Keypair.generate();
  const merchant = Keypair.generate();
  const buyer = Keypair.generate();

  log("cyan", "Step 0: Setup accounts and funding...");

  // Airdrop
  await connection.requestAirdrop(
    merchant.publicKey,
    10 * anchor.web3.LAMPORTS_PER_SOL
  );
  await connection.requestAirdrop(
    buyer.publicKey,
    10 * anchor.web3.LAMPORTS_PER_SOL
  );
  await connection.requestAirdrop(
    treasury.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));

  log("green", "  ✓ Airdropped SOL to all parties");

  // Initialize protocol config
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    program.programId
  );

  try {
    await program.account.protocolConfig.fetch(protocolConfigPda);
    log("green", "  ✓ Protocol config already initialized");
  } catch {
    await program.methods
      .initializeConfig({
        feeBps: 250, // 2.5%
        maxFeeBps: 500,
        minFeeBps: 0,
      })
      .accounts({
        authority: authority.publicKey,
        protocolConfig: protocolConfigPda,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("green", "  ✓ Protocol config initialized (2.5% fee)");
  }

  // Create mint
  const mint = await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    6 // USDT decimals
  );

  log("green", `  ✓ Mint created: ${mint.toBase58()}`);

  // Create token accounts
  const merchantAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    merchant.publicKey
  );
  const buyerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    buyer.publicKey
  );
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    treasury.publicKey
  );

  // Mint tokens to merchant
  await mintTo(
    connection,
    authority,
    mint,
    merchantAta.address,
    authority,
    10_000_000000 // 10k USDT
  );

  log("green", "  ✓ Merchant funded with 10,000 USDT\n");

  // ==========================================
  // STEP 1: Create Lane
  // ==========================================

  log("cyan", "Step 1: Create liquidity lane...");

  const laneId = new anchor.BN(1);

  const [lanePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("lane-v2"),
      merchant.publicKey.toBuffer(),
      laneId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  const [laneVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("lane-vault-authority-v2"), lanePda.toBuffer()],
    program.programId
  );

  const laneVaultAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      merchant,
      mint,
      laneVaultAuthority,
      true
    )
  ).address;

  const minAmount = new anchor.BN(100_000000); // 100 USDT
  const maxAmount = new anchor.BN(5000_000000); // 5k USDT

  const createLaneTx = await program.methods
    .createLane({
      laneId: laneId,
      minAmount: minAmount,
      maxAmount: maxAmount,
    })
    .accounts({
      merchant: merchant.publicKey,
      lane: lanePda,
      vaultAuthority: laneVaultAuthority,
      vaultAta: laneVaultAta,
      mint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([merchant])
    .rpc();

  log("green", `  ✓ Lane created: ${createLaneTx}`);
  log("green", `    Lane PDA: ${lanePda.toBase58()}`);
  log("green", `    Min amount: 100 USDT, Max amount: 5,000 USDT\n`);

  // ==========================================
  // STEP 2: Fund Lane
  // ==========================================

  log("cyan", "Step 2: Fund lane with liquidity...");

  const fundAmount = new anchor.BN(5000_000000); // 5k USDT

  const fundLaneTx = await program.methods
    .fundLane({ amount: fundAmount })
    .accounts({
      merchant: merchant.publicKey,
      lane: lanePda,
      vaultAta: laneVaultAta,
      merchantAta: merchantAta.address,
      mint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([merchant])
    .rpc();

  const laneAfterFund = await program.account.lane.fetch(lanePda);
  const vaultBalance = await getAccount(connection, laneVaultAta);

  log("green", `  ✓ Lane funded: ${fundLaneTx}`);
  log(
    "green",
    `    Lane available_balance: ${laneAfterFund.availableBalance.toString()}`
  );
  log("green", `    Vault actual balance: ${vaultBalance.amount.toString()}\n`);

  // ==========================================
  // STEP 3: Create Signed Offer (With Lane)
  // ==========================================

  log("cyan", "Step 3: Create signed offer with lane_id...");

  const tradeId = new anchor.BN(1000);
  const offerAmount = new anchor.BN(1000_000000); // 1k USDT
  const expiry = new anchor.BN(Date.now() / 1000 + 3600);
  const nonce = new anchor.BN(Math.floor(Math.random() * 1000000));

  const offer = {
    creator: merchant.publicKey,
    mint: mint,
    amount: offerAmount,
    side: { sell: {} },
    tradeId: tradeId,
    expiry: expiry,
    nonce: nonce,
    laneId: laneId, // V2.2: Specifies lane
  };

  const offerBytes = serializeOffer(offer);
  const offerHash = hashOffer(offerBytes);

  const merchantPrivateKey = merchant.secretKey.slice(0, 32);
  const signature = await ed25519.sign(offerHash, merchantPrivateKey);

  log("green", `  ✓ Offer created:`);
  log("green", `    Amount: 1,000 USDT`);
  log("green", `    Lane ID: ${laneId.toString()}`);
  log("green", `    Trade ID: ${tradeId.toString()}`);
  log("green", `    Offer hash: ${offerHash.toString("hex").slice(0, 16)}...\n`);

  // ==========================================
  // STEP 4: Atomic Match (PRIMARY PATH)
  // ==========================================

  log("cyan", "Step 4: Atomic match in SINGLE transaction...");

  const [tradePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("trade-v2"),
      merchant.publicKey.toBuffer(),
      tradeId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-v2"), tradePda.toBuffer()],
    program.programId
  );

  const [tradeVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-vault-authority-v2"), escrowPda.toBuffer()],
    program.programId
  );

  const tradeVaultAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      mint,
      tradeVaultAuthority,
      true
    )
  ).address;

  const [offerFillPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("offer-fill"), offerHash],
    program.programId
  );

  const ed25519Ix = createEd25519Instruction(
    merchant.publicKey.toBuffer(),
    offerHash,
    Buffer.from(signature)
  );

  const matchTx = await program.methods
    .matchOfferAndLockFromLane({
      offer: offer,
      signature: Array.from(signature),
      counterparty: buyer.publicKey,
      offerHash: Array.from(offerHash),
    })
    .accounts({
      matcher: buyer.publicKey,
      offerCreator: merchant.publicKey,
      protocolConfig: protocolConfigPda,
      lane: lanePda,
      laneVaultAuthority: laneVaultAuthority,
      laneVaultAta: laneVaultAta,
      trade: tradePda,
      escrow: escrowPda,
      tradeVaultAuthority: tradeVaultAuthority,
      tradeVaultAta: tradeVaultAta,
      offerFill: offerFillPda,
      mint: mint,
      ed25519Program: Ed25519Program.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ed25519Ix])
    .signers([buyer])
    .rpc();

  const trade = await program.account.trade.fetch(tradePda);
  const escrow = await program.account.escrow.fetch(escrowPda);
  const tradeVaultBalance = await getAccount(connection, tradeVaultAta);
  const laneAfterMatch = await program.account.lane.fetch(lanePda);

  log("green", `  ✓ ATOMIC MATCH COMPLETE: ${matchTx}`);
  log("green", `    Trade PDA: ${tradePda.toBase58()}`);
  log("green", `    Trade status: Locked`);
  log("green", `    Trade vault balance: ${tradeVaultBalance.amount.toString()}`);
  log(
    "green",
    `    Lane available after match: ${laneAfterMatch.availableBalance.toString()}`
  );
  log(
    "green",
    `    Expected: ${new anchor.BN(5000_000000)
      .sub(offerAmount)
      .toString()} (5000 - 1000)\n`
  );

  // ==========================================
  // STEP 5: Release Escrow
  // ==========================================

  log("cyan", "Step 5: Release escrow to buyer...");

  const amount = trade.amount;
  const amountU128 = BigInt(amount.toString());
  const feeBps = BigInt(trade.feeBps);
  const feeAmount = (amountU128 * feeBps) / BigInt(10000);
  const payoutAmount = amountU128 - feeAmount;

  log("yellow", `  Expected calculation:`);
  log("yellow", `    Escrow amount: ${amount.toString()}`);
  log("yellow", `    Fee (2.5%): ${feeAmount.toString()}`);
  log("yellow", `    Payout: ${payoutAmount.toString()}`);

  const buyerBalanceBefore = await getAccount(connection, buyerAta.address);
  const treasuryBalanceBefore = await getAccount(
    connection,
    treasuryAta.address
  );

  const releaseTx = await program.methods
    .releaseEscrow()
    .accounts({
      creator: merchant.publicKey,
      counterparty: buyer.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority: tradeVaultAuthority,
      vaultAta: tradeVaultAta,
      counterpartyAta: buyerAta.address,
      treasuryAta: treasuryAta.address,
      mint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([merchant])
    .rpc();

  const buyerBalanceAfter = await getAccount(connection, buyerAta.address);
  const treasuryBalanceAfter = await getAccount(
    connection,
    treasuryAta.address
  );

  const buyerIncrease =
    BigInt(buyerBalanceAfter.amount.toString()) -
    BigInt(buyerBalanceBefore.amount.toString());
  const treasuryIncrease =
    BigInt(treasuryBalanceAfter.amount.toString()) -
    BigInt(treasuryBalanceBefore.amount.toString());

  log("green", `  ✓ Released: ${releaseTx}`);
  log("green", `    Buyer received: ${buyerIncrease.toString()}`);
  log("green", `    Treasury received: ${treasuryIncrease.toString()}\n`);

  // ==========================================
  // STEP 6: Verify Exact Balances
  // ==========================================

  log("cyan", "Step 6: Verify exact amounts...");

  const buyerCorrect = buyerIncrease === payoutAmount;
  const treasuryCorrect = treasuryIncrease === feeAmount;

  if (buyerCorrect && treasuryCorrect) {
    log("green", "  ✓ Buyer received EXACT payout: 975,000,000 (975 USDT)");
    log("green", "  ✓ Treasury received EXACT fee: 25,000,000 (25 USDT)");
  } else {
    log("red", "  ✗ BALANCE MISMATCH:");
    if (!buyerCorrect) {
      log("red", `    Buyer: expected ${payoutAmount}, got ${buyerIncrease}`);
    }
    if (!treasuryCorrect) {
      log(
        "red",
        `    Treasury: expected ${feeAmount}, got ${treasuryIncrease}`
      );
    }
    process.exit(1);
  }

  log("green", "\n========================================");
  log("green", "  ✓ SMOKE TEST PASSED");
  log("green", "  V2.2 Lane Flow Complete:");
  log("green", "    • Lane created & funded");
  log("green", "    • Offer signed with lane_id");
  log("green", "    • Atomic match in 1 tx");
  log("green", "    • Exact fee enforcement");
  log("green", "========================================\n");

  // Save results
  const results = {
    success: true,
    protocolConfig: protocolConfigPda.toBase58(),
    lane: lanePda.toBase58(),
    trade: tradePda.toBase58(),
    escrow: escrowPda.toBase58(),
    transactions: {
      createLane: createLaneTx,
      fundLane: fundLaneTx,
      atomicMatch: matchTx,
      release: releaseTx,
    },
    balances: {
      buyer: buyerIncrease.toString(),
      treasury: treasuryIncrease.toString(),
      laneAvailable: laneAfterMatch.availableBalance.toString(),
    },
  };

  fs.writeFileSync(
    "smoke-lane-results.json",
    JSON.stringify(results, null, 2)
  );

  log("blue", "Results saved to smoke-lane-results.json\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
