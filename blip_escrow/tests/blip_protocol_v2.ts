import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipProtocolV2 } from "../target/types/blip_protocol_v2";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("blip_protocol_v2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const treasury = Keypair.generate();

  let protocolConfigPda: PublicKey;
  let mint: PublicKey;

  before(async () => {
    // Fund treasury
    await connection.requestAirdrop(
      treasury.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Derive protocol config PDA
    [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol-config")],
      program.programId
    );

    // Create test mint
    mint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      6
    );
  });

  describe("Protocol Configuration", () => {
    it("initializes protocol config", async () => {
      await program.methods
        .initializeConfig({
          feeBps: 250, // 2.5%
          maxFeeBps: 500, // 5% cap
          minFeeBps: 0,
        })
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.protocolConfig.fetch(
        protocolConfigPda
      );

      assert.equal(config.feeBps, 250);
      assert.equal(config.maxFeeBps, 500);
      assert.equal(config.minFeeBps, 0);
      assert.equal(config.authority.toBase58(), authority.publicKey.toBase58());
      assert.equal(config.treasury.toBase58(), treasury.publicKey.toBase58());
      assert.equal(config.isFrozen, false);
    });

    it("fails to initialize again (already exists)", async () => {
      try {
        await program.methods
          .initializeConfig({
            feeBps: 100,
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
        assert.fail("Should have failed - config already exists");
      } catch (err) {
        // Expected - account already initialized
      }
    });

    it("updates protocol config (authority)", async () => {
      await program.methods
        .updateConfig({
          newAuthority: null,
          newTreasury: null,
          newFeeBps: 100, // Reduce to 1%
          isFrozen: null,
        })
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPda,
          newTreasury: null,
        })
        .rpc();

      const config = await program.account.protocolConfig.fetch(
        protocolConfigPda
      );
      assert.equal(config.feeBps, 100);
    });

    it("fails to update with fee above max", async () => {
      try {
        await program.methods
          .updateConfig({
            newAuthority: null,
            newTreasury: null,
            newFeeBps: 600, // Above max (500)
            isFrozen: null,
          })
          .accounts({
            authority: authority.publicKey,
            protocolConfig: protocolConfigPda,
            newTreasury: null,
          })
          .rpc();
        assert.fail("Should have failed - fee exceeds max");
      } catch (err) {
        assert.include(err.toString(), "FeeOutOfBounds");
      }
    });

    it("freezes protocol", async () => {
      await program.methods
        .updateConfig({
          newAuthority: null,
          newTreasury: null,
          newFeeBps: null,
          isFrozen: true,
        })
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPda,
          newTreasury: null,
        })
        .rpc();

      const config = await program.account.protocolConfig.fetch(
        protocolConfigPda
      );
      assert.equal(config.isFrozen, true);

      // Unfreeze for remaining tests
      await program.methods
        .updateConfig({
          newAuthority: null,
          newTreasury: null,
          newFeeBps: 250, // Reset to 2.5%
          isFrozen: false,
        })
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPda,
          newTreasury: null,
        })
        .rpc();
    });
  });

  describe("Trade Lifecycle - Happy Path", () => {
    let creator: Keypair;
    let counterparty: Keypair;
    let tradeId: number;
    let tradePda: PublicKey;
    let escrowPda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let creatorAta: PublicKey;
    let counterpartyAta: PublicKey;
    let treasuryAta: PublicKey;
    let vaultAta: PublicKey;

    const amount = 1_000_000; // 1 token

    before(async () => {
      creator = Keypair.generate();
      counterparty = Keypair.generate();
      tradeId = Date.now();

      // Fund accounts
      await connection.requestAirdrop(
        creator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.requestAirdrop(
        counterparty.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create token accounts
      const creatorAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        creator.publicKey
      );
      creatorAta = creatorAtaAccount.address;

      const counterpartyAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        counterparty.publicKey
      );
      counterpartyAta = counterpartyAtaAccount.address;

      const treasuryAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        treasury.publicKey
      );
      treasuryAta = treasuryAtaAccount.address;

      // Mint tokens to creator
      await mintTo(connection, creator, mint, creatorAta, authority, amount);

      // Derive PDAs
      [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          creator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [escrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow-v2"), tradePda.toBuffer()],
        program.programId
      );

      [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
        program.programId
      );

      // Get vault ATA address
      const [vaultAtaPda] = PublicKey.findProgramAddressSync(
        [
          vaultAuthorityPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
      );
      vaultAta = vaultAtaPda;
    });

    it("creates trade", async () => {
      await program.methods
        .createTrade({
          tradeId: new anchor.BN(tradeId),
          amount: new anchor.BN(amount),
          side: { sell: {} },
        })
        .accounts({
          creator: creator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          mint: mint,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const trade = await program.account.trade.fetch(tradePda);
      assert.equal(trade.creator.toBase58(), creator.publicKey.toBase58());
      assert.equal(trade.tradeId.toString(), tradeId.toString());
      assert.equal(trade.amount.toString(), amount.toString());
      assert.deepEqual(trade.status, { created: {} });
      assert.equal(trade.feeBps, 250); // Snapshot from config
    });

    it("locks escrow", async () => {
      await program.methods
        .lockEscrow({
          counterparty: counterparty.publicKey,
        })
        .accounts({
          depositor: creator.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          depositorAta: creatorAta,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: new PublicKey(
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
          ),
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const trade = await program.account.trade.fetch(tradePda);
      assert.deepEqual(trade.status, { locked: {} });
      assert.equal(
        trade.counterparty.toBase58(),
        counterparty.publicKey.toBase58()
      );

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.amount.toString(), amount.toString());
      assert.equal(escrow.depositor.toBase58(), creator.publicKey.toBase58());

      // Verify tokens transferred to vault
      const vaultAccount = await getAccount(connection, vaultAta);
      assert.equal(vaultAccount.amount.toString(), amount.toString());
    });

    it("releases to counterparty with fee", async () => {
      const counterpartyBalBefore = (
        await getAccount(connection, counterpartyAta)
      ).amount;
      const treasuryBalBefore = (await getAccount(connection, treasuryAta))
        .amount;

      // Creator releases
      await program.methods
        .releaseEscrow()
        .accounts({
          signer: creator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          counterpartyAta: counterpartyAta,
          treasuryAta: treasuryAta,
          creator: creator.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      const counterpartyBalAfter = (
        await getAccount(connection, counterpartyAta)
      ).amount;
      const treasuryBalAfter = (await getAccount(connection, treasuryAta))
        .amount;

      // Calculate expected fee (2.5% = 250 bps)
      const expectedFee = Math.floor((amount * 250) / 10_000); // 25,000
      const expectedPayout = amount - expectedFee; // 975,000

      assert.equal(
        (counterpartyBalAfter - counterpartyBalBefore).toString(),
        expectedPayout.toString()
      );
      assert.equal(
        (treasuryBalAfter - treasuryBalBefore).toString(),
        expectedFee.toString()
      );

      // Verify trade status
      const trade = await program.account.trade.fetch(tradePda);
      assert.deepEqual(trade.status, { released: {} });

      // Verify vault closed
      try {
        await getAccount(connection, vaultAta);
        assert.fail("Vault should be closed");
      } catch (err) {
        // Expected
      }
    });
  });

  describe("Trade Lifecycle - Refund Path", () => {
    let creator: Keypair;
    let counterparty: Keypair;
    let tradeId: number;
    let tradePda: PublicKey;
    let escrowPda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let creatorAta: PublicKey;
    let vaultAta: PublicKey;

    const amount = 500_000;

    before(async () => {
      creator = Keypair.generate();
      counterparty = Keypair.generate();
      tradeId = Date.now() + 1000;

      await connection.requestAirdrop(
        creator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const creatorAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        creator.publicKey
      );
      creatorAta = creatorAtaAccount.address;

      await mintTo(connection, creator, mint, creatorAta, authority, amount);

      [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          creator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [escrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow-v2"), tradePda.toBuffer()],
        program.programId
      );

      [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
        program.programId
      );

      const [vaultAtaPda] = PublicKey.findProgramAddressSync(
        [
          vaultAuthorityPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
      );
      vaultAta = vaultAtaPda;
    });

    it("creates and locks trade", async () => {
      await program.methods
        .createTrade({
          tradeId: new anchor.BN(tradeId),
          amount: new anchor.BN(amount),
          side: { sell: {} },
        })
        .accounts({
          creator: creator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          mint: mint,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      await program.methods
        .lockEscrow({
          counterparty: counterparty.publicKey,
        })
        .accounts({
          depositor: creator.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          depositorAta: creatorAta,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: new PublicKey(
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
          ),
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
    });

    it("refunds to depositor (no fee)", async () => {
      const creatorBalBefore = (await getAccount(connection, creatorAta))
        .amount;

      await program.methods
        .refundEscrow()
        .accounts({
          signer: creator.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          depositorAta: creatorAta,
          creator: creator.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      const creatorBalAfter = (await getAccount(connection, creatorAta)).amount;

      // Full amount returned (no fee on refund)
      assert.equal(
        (creatorBalAfter - creatorBalBefore).toString(),
        amount.toString()
      );

      const trade = await program.account.trade.fetch(tradePda);
      assert.deepEqual(trade.status, { refunded: {} });
    });
  });

  describe("Authorization & State Validation", () => {
    let creator: Keypair;
    let counterparty: Keypair;
    let unauthorized: Keypair;
    let tradeId: number;
    let tradePda: PublicKey;
    let escrowPda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let creatorAta: PublicKey;
    let counterpartyAta: PublicKey;
    let treasuryAta: PublicKey;
    let vaultAta: PublicKey;

    const amount = 300_000;

    before(async () => {
      creator = Keypair.generate();
      counterparty = Keypair.generate();
      unauthorized = Keypair.generate();
      tradeId = Date.now() + 2000;

      await connection.requestAirdrop(
        creator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.requestAirdrop(
        unauthorized.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const creatorAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        creator.publicKey
      );
      creatorAta = creatorAtaAccount.address;

      const counterpartyAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        counterparty.publicKey
      );
      counterpartyAta = counterpartyAtaAccount.address;

      const treasuryAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        treasury.publicKey
      );
      treasuryAta = treasuryAtaAccount.address;

      await mintTo(connection, creator, mint, creatorAta, authority, amount);

      [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          creator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [escrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow-v2"), tradePda.toBuffer()],
        program.programId
      );

      [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
        program.programId
      );

      const [vaultAtaPda] = PublicKey.findProgramAddressSync(
        [
          vaultAuthorityPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
      );
      vaultAta = vaultAtaPda;

      // Setup trade
      await program.methods
        .createTrade({
          tradeId: new anchor.BN(tradeId),
          amount: new anchor.BN(amount),
          side: { sell: {} },
        })
        .accounts({
          creator: creator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          mint: mint,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      await program.methods
        .lockEscrow({
          counterparty: counterparty.publicKey,
        })
        .accounts({
          depositor: creator.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          depositorAta: creatorAta,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: new PublicKey(
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
          ),
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
    });

    it("fails: unauthorized release", async () => {
      try {
        await program.methods
          .releaseEscrow()
          .accounts({
            signer: unauthorized.publicKey,
            protocolConfig: protocolConfigPda,
            trade: tradePda,
            escrow: escrowPda,
            vaultAuthority: vaultAuthorityPda,
            vaultAta: vaultAta,
            counterpartyAta: counterpartyAta,
            treasuryAta: treasuryAta,
            creator: creator.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorized])
          .rpc();
        assert.fail("Should have failed - unauthorized");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });

    it("succeeds: counterparty can release", async () => {
      // Counterparty is authorized to release
      await program.methods
        .releaseEscrow()
        .accounts({
          signer: counterparty.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          counterpartyAta: counterpartyAta,
          treasuryAta: treasuryAta,
          creator: creator.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([counterparty])
        .rpc();

      const trade = await program.account.trade.fetch(tradePda);
      assert.deepEqual(trade.status, { released: {} });
    });
  });

  describe("Fee Exactness Validation", () => {
    it("calculates fee exactly: 2.5% of 1,234,567", async () => {
      const creator = Keypair.generate();
      const counterparty = Keypair.generate();
      const amount = 1_234_567;
      const tradeId = Date.now() + 3000;

      await connection.requestAirdrop(
        creator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const creatorAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        creator.publicKey
      );
      const creatorAta = creatorAtaAccount.address;

      const counterpartyAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        counterparty.publicKey
      );
      const counterpartyAta = counterpartyAtaAccount.address;

      const treasuryAtaAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        creator,
        mint,
        treasury.publicKey
      );
      const treasuryAta = treasuryAtaAccount.address;

      await mintTo(connection, creator, mint, creatorAta, authority, amount);

      const [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          creator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

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

      await program.methods
        .createTrade({
          tradeId: new anchor.BN(tradeId),
          amount: new anchor.BN(amount),
          side: { sell: {} },
        })
        .accounts({
          creator: creator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          mint: mint,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      await program.methods
        .lockEscrow({
          counterparty: counterparty.publicKey,
        })
        .accounts({
          depositor: creator.publicKey,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          depositorAta: creatorAta,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: new PublicKey(
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
          ),
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const treasuryBalBefore = (await getAccount(connection, treasuryAta))
        .amount;

      await program.methods
        .releaseEscrow()
        .accounts({
          signer: creator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          escrow: escrowPda,
          vaultAuthority: vaultAuthorityPda,
          vaultAta: vaultAta,
          counterpartyAta: counterpartyAta,
          treasuryAta: treasuryAta,
          creator: creator.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      const treasuryBalAfter = (await getAccount(connection, treasuryAta))
        .amount;

      // Exact fee calculation: floor(1,234,567 * 250 / 10,000) = 30,864
      const expectedFee = Math.floor((amount * 250) / 10_000);
      const actualFee = Number(treasuryBalAfter - treasuryBalBefore);

      assert.equal(actualFee, expectedFee);
      assert.equal(expectedFee, 30_864); // Verify expected value
    });
  });
});
