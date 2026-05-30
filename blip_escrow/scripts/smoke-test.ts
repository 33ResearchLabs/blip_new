import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

async function main() {
  console.log("🧪 Running Protocol Smoke Test");
  console.log("===============================\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;

  const payer = (provider.wallet as anchor.Wallet).payer;

  // Create test accounts
  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  console.log("Seller:", seller.publicKey.toBase58());
  console.log("Buyer:", buyer.publicKey.toBase58());

  // Fund accounts
  console.log("\n💰 Funding test accounts...");
  await connection.requestAirdrop(
    seller.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await connection.requestAirdrop(
    buyer.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Create test mint
  console.log("\n🪙 Creating test USDT mint...");
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6 // USDT decimals
  );
  console.log("Mint:", mint.toBase58());

  // Create token accounts
  const sellerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    seller,
    mint,
    seller.publicKey
  );

  const buyerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    seller,
    mint,
    buyer.publicKey
  );

  // Mint tokens to seller
  const amount = 1_000_000; // 1 USDT
  await mintTo(connection, payer, mint, sellerAta.address, payer, amount);
  console.log("✅ Minted", amount / 1_000_000, "USDT to seller");

  // Get protocol config
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    program.programId
  );

  const config = await program.account.protocolConfig.fetch(protocolConfigPda);
  const treasury = config.treasury;
  const feeBps = config.feeBps;

  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    seller,
    mint,
    treasury
  );

  console.log("\n📋 Protocol config:");
  console.log("  Fee:", feeBps, "bps");
  console.log("  Treasury:", treasury.toBase58());

  // Create trade
  const tradeId = Date.now();

  const [tradePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("trade-v2"),
      seller.publicKey.toBuffer(),
      new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  console.log("\n1️⃣ Creating trade...");
  const createTx = await program.methods
    .createTrade({
      tradeId: new anchor.BN(tradeId),
      amount: new anchor.BN(amount),
      side: { sell: {} },
    })
    .accounts({
      creator: seller.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      mint: mint,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc();

  console.log("✅ Trade created:", createTx);
  console.log("   Trade PDA:", tradePda.toBase58());

  // Lock escrow
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-v2"), tradePda.toBuffer()],
    program.programId
  );

  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
    program.programId
  );

  const [vaultAta] = PublicKey.findProgramAddressSync(
    [
      vaultAuthorityPda.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );

  console.log("\n2️⃣ Locking escrow...");
  const lockTx = await program.methods
    .lockEscrow({
      counterparty: buyer.publicKey,
    })
    .accounts({
      depositor: seller.publicKey,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority: vaultAuthorityPda,
      vaultAta: vaultAta,
      depositorAta: sellerAta.address,
      mint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: new PublicKey(
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
      ),
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc();

  console.log("✅ Escrow locked:", lockTx);
  console.log("   Escrow PDA:", escrowPda.toBase58());

  // Verify vault has funds
  const vaultAccount = await getAccount(connection, vaultAta);
  console.log("   Vault balance:", Number(vaultAccount.amount) / 1_000_000, "USDT");

  // Release to buyer
  const treasuryBalBefore = (await getAccount(connection, treasuryAta.address))
    .amount;
  const buyerBalBefore = (await getAccount(connection, buyerAta.address)).amount;

  console.log("\n3️⃣ Releasing to buyer...");
  const releaseTx = await program.methods
    .releaseEscrow()
    .accounts({
      signer: seller.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority: vaultAuthorityPda,
      vaultAta: vaultAta,
      counterpartyAta: buyerAta.address,
      treasuryAta: treasuryAta.address,
      creator: seller.publicKey,
      mint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([seller])
    .rpc();

  console.log("✅ Released:", releaseTx);

  // Verify balances
  const treasuryBalAfter = (await getAccount(connection, treasuryAta.address))
    .amount;
  const buyerBalAfter = (await getAccount(connection, buyerAta.address)).amount;

  const treasuryReceived = Number(treasuryBalAfter - treasuryBalBefore);
  const buyerReceived = Number(buyerBalAfter - buyerBalBefore);

  const expectedFee = Math.floor((amount * feeBps) / 10_000);
  const expectedPayout = amount - expectedFee;

  console.log("\n📊 Settlement summary:");
  console.log("  Escrow amount:", amount / 1_000_000, "USDT");
  console.log("  Fee collected:", treasuryReceived / 1_000_000, "USDT");
  console.log("  Buyer received:", buyerReceived / 1_000_000, "USDT");
  console.log("\n  Expected fee:", expectedFee / 1_000_000, "USDT");
  console.log("  Expected payout:", expectedPayout / 1_000_000, "USDT");

  // Verify correctness
  if (treasuryReceived !== expectedFee) {
    console.log("\n❌ Fee mismatch!");
    process.exit(1);
  }

  if (buyerReceived !== expectedPayout) {
    console.log("\n❌ Payout mismatch!");
    process.exit(1);
  }

  console.log("\n✅ All checks passed!");
  console.log("\n🎉 Smoke test completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
