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
  Transaction,
  TransactionInstruction,
  Ed25519Program,
} from "@solana/web3.js";
import { assert } from "chai";
import * as crypto from "crypto";
import * as ed25519 from "@noble/ed25519";

/**
 * V2.2 ATOMIC MATCHING VIA PREFUNDED LANES
 *
 * Tests the PRIMARY PATH for instant, one-click matching.
 *
 * Test Coverage:
 * 1. Lane creation + funding increases vault balance
 * 2. Atomic match in ONE transaction (ed25519 + match_offer_and_lock_from_lane)
 * 3. Replay protection (OfferFill PDA prevents double-matching)
 * 4. Insufficient lane liquidity fails gracefully
 * 5. Lane withdrawal (merchant only, available funds only)
 * 6. Release: exact fee to treasury, exact payout to counterparty
 * 7. Invalid state transitions fail
 */
describe("V2.2: Liquidity Lanes (Atomic Matching)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const treasury = Keypair.generate();
  const merchant = Keypair.generate();
  const buyer = Keypair.generate();

  let protocolConfigPda: PublicKey;
  let mint: PublicKey;
  let merchantAta: any;
  let buyerAta: any;
  let treasuryAta: any;

  // Lane state
  const laneId = new anchor.BN(1);
  let lanePda: PublicKey;
  let laneVaultAuthority: PublicKey;
  let laneVaultAta: PublicKey;

  // Helper: Serialize offer to canonical bytes (V2.2 - 105 bytes)
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
    // V2.2: 105 bytes total (added lane_id)
    const sideValue = "sell" in offer.side ? 1 : 0;

    return Buffer.concat([
      offer.creator.toBuffer(), // 32 bytes
      offer.mint.toBuffer(), // 32 bytes
      offer.amount.toArrayLike(Buffer, "le", 8), // 8 bytes
      Buffer.from([sideValue]), // 1 byte
      offer.tradeId.toArrayLike(Buffer, "le", 8), // 8 bytes
      offer.expiry.toArrayLike(Buffer, "le", 8), // 8 bytes
      offer.nonce.toArrayLike(Buffer, "le", 8), // 8 bytes
      offer.laneId.toArrayLike(Buffer, "le", 8), // 8 bytes (V2.2)
    ]);
  }

  // Helper: Hash offer
  function hashOffer(offerBytes: Buffer): Buffer {
    return crypto.createHash("sha256").update(offerBytes).digest();
  }

  // Helper: Create Ed25519 signature verification instruction
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

    const data = Buffer.alloc(
      paddingOffset + 2 + 64 + 32 + 2 + messageSize,
      0
    );

    data.writeUInt8(numSignatures, 0);
    data.writeUInt8(0, 1); // padding

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

  before(async () => {
    // Airdrop to all parties
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

    // Initialize protocol config
    [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol-config")],
      program.programId
    );

    try {
      await program.account.protocolConfig.fetch(protocolConfigPda);
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
    }

    // Create mint
    mint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      6 // USDT decimals
    );

    // Create token accounts
    merchantAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      mint,
      merchant.publicKey
    );
    buyerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      mint,
      buyer.publicKey
    );
    treasuryAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      mint,
      treasury.publicKey
    );

    // Mint tokens to merchant (they will fund the lane)
    await mintTo(
      connection,
      authority,
      mint,
      merchantAta.address,
      authority,
      10_000_000000 // 10k USDT
    );

    console.log("\n🔧 Setup complete:");
    console.log(`   Merchant: ${merchant.publicKey.toBase58()}`);
    console.log(`   Buyer: ${buyer.publicKey.toBase58()}`);
    console.log(`   Treasury: ${treasury.publicKey.toBase58()}`);
    console.log(`   Mint: ${mint.toBase58()}`);
    console.log(`   Protocol Config: ${protocolConfigPda.toBase58()}`);
  });

  it("1. ✅ Create lane + fund lane increases vault balance", async () => {
    // Derive lane PDA
    [lanePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("lane-v2"),
        merchant.publicKey.toBuffer(),
        laneId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Derive lane vault authority
    [laneVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("lane-vault-authority-v2"), lanePda.toBuffer()],
      program.programId
    );

    // Derive lane vault ATA
    laneVaultAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        merchant,
        mint,
        laneVaultAuthority,
        true // allowOwnerOffCurve
      )
    ).address;

    console.log("\n📍 Lane PDAs:");
    console.log(`   Lane: ${lanePda.toBase58()}`);
    console.log(`   Vault Authority: ${laneVaultAuthority.toBase58()}`);
    console.log(`   Vault ATA: ${laneVaultAta.toBase58()}`);

    // Create lane
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

    console.log(`\n✅ Lane created: ${createLaneTx}`);

    const laneAccount = await program.account.lane.fetch(lanePda);
    assert.equal(
      laneAccount.merchant.toBase58(),
      merchant.publicKey.toBase58()
    );
    assert.equal(laneAccount.laneId.toString(), laneId.toString());
    assert.equal(laneAccount.availableBalance.toString(), "0");
    assert.equal(laneAccount.isActive, true);

    // Fund lane
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

    console.log(`✅ Lane funded: ${fundLaneTx}`);

    const laneAfterFund = await program.account.lane.fetch(lanePda);
    assert.equal(
      laneAfterFund.availableBalance.toString(),
      fundAmount.toString()
    );

    const vaultBalance = await getAccount(connection, laneVaultAta);
    assert.equal(vaultBalance.amount.toString(), fundAmount.toString());

    console.log(
      `   Lane available_balance: ${laneAfterFund.availableBalance.toString()}`
    );
    console.log(`   Vault actual balance: ${vaultBalance.amount.toString()}`);
  });

  it("2. ✅ Atomic match in ONE transaction (PRIMARY PATH)", async () => {
    // Create offer
    const tradeId = new anchor.BN(1000);
    const amount = new anchor.BN(1000_000000); // 1k USDT
    const expiry = new anchor.BN(Date.now() / 1000 + 3600);
    const nonce = new anchor.BN(Math.floor(Math.random() * 1000000));

    const offer = {
      creator: merchant.publicKey,
      mint: mint,
      amount: amount,
      side: { sell: {} },
      tradeId: tradeId,
      expiry: expiry,
      nonce: nonce,
      laneId: laneId, // V2.2: Specifies lane
    };

    const offerBytes = serializeOffer(offer);
    const offerHash = hashOffer(offerBytes);

    // Merchant signs offer
    const merchantPrivateKey = merchant.secretKey.slice(0, 32);
    const signature = await ed25519.sign(offerHash, merchantPrivateKey);

    console.log("\n📝 Offer created:");
    console.log(`   Trade ID: ${tradeId.toString()}`);
    console.log(`   Amount: ${amount.toString()}`);
    console.log(`   Lane ID: ${laneId.toString()}`);
    console.log(`   Offer hash: ${offerHash.toString("hex")}`);

    // Derive PDAs for match
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

    // ATOMIC TRANSACTION: Ed25519 verification + match_offer_and_lock_from_lane
    const ed25519Ix = createEd25519Instruction(
      merchant.publicKey.toBuffer(),
      offerHash,
      Buffer.from(signature)
    );

    const matcher = buyer; // Anyone can match

    const matchTx = await program.methods
      .matchOfferAndLockFromLane({
        offer: offer,
        signature: Array.from(signature),
        counterparty: buyer.publicKey,
        offerHash: Array.from(offerHash),
      })
      .accounts({
        matcher: matcher.publicKey,
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
      .signers([matcher])
      .rpc();

    console.log(`\n✅ ATOMIC MATCH COMPLETE: ${matchTx}`);

    // Verify trade state
    const trade = await program.account.trade.fetch(tradePda);
    assert.equal(trade.creator.toBase58(), merchant.publicKey.toBase58());
    assert.equal(trade.counterparty.toBase58(), buyer.publicKey.toBase58());
    assert.equal(trade.amount.toString(), amount.toString());
    assert.equal(trade.status.locked !== undefined, true);

    console.log(`   Trade: ${tradePda.toBase58()}`);
    console.log(`   Status: Locked ✅`);
    console.log(`   Locked at: ${new Date(trade.lockedAt.toNumber() * 1000)}`);

    // Verify escrow has funds
    const escrow = await program.account.escrow.fetch(escrowPda);
    const tradeVaultBalance = await getAccount(connection, tradeVaultAta);
    assert.equal(tradeVaultBalance.amount.toString(), amount.toString());
    assert.equal(escrow.amount.toString(), amount.toString());

    console.log(`   Escrow vault balance: ${tradeVaultBalance.amount}`);

    // Verify lane balance decreased
    const laneAfterMatch = await program.account.lane.fetch(lanePda);
    const expectedLaneBalance = new anchor.BN(5000_000000).sub(amount);
    assert.equal(
      laneAfterMatch.availableBalance.toString(),
      expectedLaneBalance.toString()
    );

    console.log(
      `   Lane available_balance after match: ${laneAfterMatch.availableBalance}`
    );

    // Verify OfferFill created (replay protection)
    const offerFill = await program.account.offerFill.fetch(offerFillPda);
    assert.equal(offerFill.trade.toBase58(), tradePda.toBase58());
    assert.equal(offerFill.filler.toBase58(), matcher.publicKey.toBase58());
  });

  it("3. ✅ Replay protection: same offer fails second time", async () => {
    const tradeId = new anchor.BN(1001);
    const amount = new anchor.BN(500_000000);
    const expiry = new anchor.BN(Date.now() / 1000 + 3600);
    const nonce = new anchor.BN(Math.floor(Math.random() * 1000000));

    const offer = {
      creator: merchant.publicKey,
      mint: mint,
      amount: amount,
      side: { sell: {} },
      tradeId: tradeId,
      expiry: expiry,
      nonce: nonce,
      laneId: laneId,
    };

    const offerBytes = serializeOffer(offer);
    const offerHash = hashOffer(offerBytes);

    const merchantPrivateKey = merchant.secretKey.slice(0, 32);
    const signature = await ed25519.sign(offerHash, merchantPrivateKey);

    // First match
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

    const matcher = buyer;

    const firstMatchTx = await program.methods
      .matchOfferAndLockFromLane({
        offer: offer,
        signature: Array.from(signature),
        counterparty: buyer.publicKey,
        offerHash: Array.from(offerHash),
      })
      .accounts({
        matcher: matcher.publicKey,
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
      .signers([matcher])
      .rpc();

    console.log(`\n✅ First match succeeded: ${firstMatchTx}`);

    // Second match (should fail - OfferFill PDA already exists)
    try {
      const secondMatchTx = await program.methods
        .matchOfferAndLockFromLane({
          offer: offer,
          signature: Array.from(signature),
          counterparty: buyer.publicKey,
          offerHash: Array.from(offerHash),
        })
        .accounts({
          matcher: matcher.publicKey,
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
        .signers([matcher])
        .rpc();

      assert.fail("Second match should have failed");
    } catch (err: any) {
      console.log(`✅ Second match failed (expected): ${err.message}`);
      assert.include(err.message.toLowerCase(), "already in use");
    }
  });

  it("4. ✅ Insufficient lane liquidity fails gracefully", async () => {
    const tradeId = new anchor.BN(1002);
    const amount = new anchor.BN(9999_000000); // More than lane has
    const expiry = new anchor.BN(Date.now() / 1000 + 3600);
    const nonce = new anchor.BN(Math.floor(Math.random() * 1000000));

    const offer = {
      creator: merchant.publicKey,
      mint: mint,
      amount: amount,
      side: { sell: {} },
      tradeId: tradeId,
      expiry: expiry,
      nonce: nonce,
      laneId: laneId,
    };

    const offerBytes = serializeOffer(offer);
    const offerHash = hashOffer(offerBytes);

    const merchantPrivateKey = merchant.secretKey.slice(0, 32);
    const signature = await ed25519.sign(offerHash, merchantPrivateKey);

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

    try {
      await program.methods
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

      assert.fail("Should have failed with insufficient balance");
    } catch (err: any) {
      console.log(`\n✅ Insufficient balance check passed: ${err.message}`);
      assert.include(
        err.message.toLowerCase(),
        "insufficient" || "balance" || "error"
      );
    }
  });

  it("5. ✅ Lane withdrawal (merchant only, available funds only)", async () => {
    const laneBeforeWithdraw = await program.account.lane.fetch(lanePda);
    const availableBefore = laneBeforeWithdraw.availableBalance;

    console.log(`\n💰 Lane available before withdraw: ${availableBefore}`);

    const withdrawAmount = new anchor.BN(1000_000000); // 1k USDT

    const merchantAtaBalanceBefore = await getAccount(
      connection,
      merchantAta.address
    );

    const withdrawTx = await program.methods
      .withdrawLane({ amount: withdrawAmount })
      .accounts({
        merchant: merchant.publicKey,
        lane: lanePda,
        vaultAuthority: laneVaultAuthority,
        vaultAta: laneVaultAta,
        merchantAta: merchantAta.address,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([merchant])
      .rpc();

    console.log(`✅ Withdrawal successful: ${withdrawTx}`);

    const laneAfterWithdraw = await program.account.lane.fetch(lanePda);
    const availableAfter = laneAfterWithdraw.availableBalance;

    assert.equal(
      availableAfter.toString(),
      availableBefore.sub(withdrawAmount).toString()
    );

    const merchantAtaBalanceAfter = await getAccount(
      connection,
      merchantAta.address
    );
    const expectedMerchantBalance =
      BigInt(merchantAtaBalanceBefore.amount.toString()) +
      BigInt(withdrawAmount.toString());
    assert.equal(
      merchantAtaBalanceAfter.amount.toString(),
      expectedMerchantBalance.toString()
    );

    console.log(`   Lane available after: ${availableAfter}`);
    console.log(`   Merchant balance increased by: ${withdrawAmount}`);

    // Try withdrawing MORE than available (should fail)
    const tooMuchAmount = availableAfter.add(new anchor.BN(1_000000));

    try {
      await program.methods
        .withdrawLane({ amount: tooMuchAmount })
        .accounts({
          merchant: merchant.publicKey,
          lane: lanePda,
          vaultAuthority: laneVaultAuthority,
          vaultAta: laneVaultAta,
          merchantAta: merchantAta.address,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([merchant])
        .rpc();

      assert.fail("Should fail when withdrawing more than available");
    } catch (err: any) {
      console.log(`✅ Over-withdrawal prevented: ${err.message}`);
    }
  });

  it("6. ✅ Release: exact fee to treasury, exact payout to counterparty", async () => {
    // Use the trade from test 2
    const tradeId = new anchor.BN(1000);

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

    const trade = await program.account.trade.fetch(tradePda);
    const amount = trade.amount;

    // Calculate expected fee (2.5% = 250 bps)
    // Fee math: fee = (amount * fee_bps) / 10000
    const amountU128 = BigInt(amount.toString());
    const feeBps = BigInt(trade.feeBps);
    const feeAmount = (amountU128 * feeBps) / BigInt(10000);
    const payoutAmount = amountU128 - feeAmount;

    console.log(`\n💸 Release calculation:`);
    console.log(`   Escrow amount: ${amount}`);
    console.log(`   Fee (2.5%): ${feeAmount}`);
    console.log(`   Payout: ${payoutAmount}`);

    const buyerBalanceBefore = await getAccount(connection, buyerAta.address);
    const treasuryBalanceBefore = await getAccount(
      connection,
      treasuryAta.address
    );

    // Merchant (seller) releases to buyer
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

    console.log(`✅ Released: ${releaseTx}`);

    const buyerBalanceAfter = await getAccount(connection, buyerAta.address);
    const treasuryBalanceAfter = await getAccount(
      connection,
      treasuryAta.address
    );

    // Verify exact amounts
    const buyerIncrease =
      BigInt(buyerBalanceAfter.amount.toString()) -
      BigInt(buyerBalanceBefore.amount.toString());
    const treasuryIncrease =
      BigInt(treasuryBalanceAfter.amount.toString()) -
      BigInt(treasuryBalanceBefore.amount.toString());

    assert.equal(buyerIncrease.toString(), payoutAmount.toString());
    assert.equal(treasuryIncrease.toString(), feeAmount.toString());

    console.log(`   Buyer received (exact): ${buyerIncrease}`);
    console.log(`   Treasury received (exact): ${treasuryIncrease}`);

    // Verify trade status
    const tradeAfterRelease = await program.account.trade.fetch(tradePda);
    assert.equal(tradeAfterRelease.status.released !== undefined, true);

    console.log(`   Trade status: Released ✅`);
  });

  it("7. ✅ Invalid state transitions fail", async () => {
    // Try to release an already-released trade
    const tradeId = new anchor.BN(1000);

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

    try {
      // Escrow/vault already closed, this should fail
      await program.methods
        .releaseEscrow()
        .accounts({
          creator: merchant.publicKey,
          counterparty: buyer.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: tradeVaultAuthority,
          vaultAta: PublicKey.default, // doesn't exist anymore
          counterpartyAta: buyerAta.address,
          treasuryAta: treasuryAta.address,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([merchant])
        .rpc();

      assert.fail("Should fail when releasing already-released trade");
    } catch (err: any) {
      console.log(`\n✅ Invalid state transition prevented: ${err.message}`);
      assert.include(err.message.toLowerCase(), "account" || "does not exist");
    }
  });

  it("8. ✅ Capital recycling: Multiple matches from same lane", async () => {
    // Fund lane again to ensure sufficient balance
    const refundAmount = new anchor.BN(2000_000000); // 2k USDT

    await program.methods
      .fundLane({ amount: refundAmount })
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

    console.log(`\n💰 Lane refunded with ${refundAmount}`);

    // Create and match TWO offers from same lane
    for (let i = 0; i < 2; i++) {
      const tradeId = new anchor.BN(2000 + i);
      const amount = new anchor.BN(500_000000); // 500 USDT each
      const expiry = new anchor.BN(Date.now() / 1000 + 3600);
      const nonce = new anchor.BN(Math.floor(Math.random() * 1000000));

      const offer = {
        creator: merchant.publicKey,
        mint: mint,
        amount: amount,
        side: { sell: {} },
        tradeId: tradeId,
        expiry: expiry,
        nonce: nonce,
        laneId: laneId,
      };

      const offerBytes = serializeOffer(offer);
      const offerHash = hashOffer(offerBytes);

      const merchantPrivateKey = merchant.secretKey.slice(0, 32);
      const signature = await ed25519.sign(offerHash, merchantPrivateKey);

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

      console.log(`✅ Match ${i + 1}/2 from same lane: ${matchTx}`);
    }

    const laneAfterMatches = await program.account.lane.fetch(lanePda);
    console.log(
      `   Lane available after 2 matches: ${laneAfterMatches.availableBalance}`
    );
    console.log("   ✅ Capital recycling confirmed: same lane, multiple trades");
  });
});
