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
import * as crypto from "crypto";
import * as ed25519 from "@noble/ed25519";

describe("match_offer (v2.1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BlipProtocolV2 as Program<BlipProtocolV2>;
  const connection = provider.connection;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const treasury = Keypair.generate();

  let protocolConfigPda: PublicKey;
  let mint: PublicKey;

  // Helper: Create canonical offer bytes (MUST match on-chain Borsh serialization)
  function serializeOffer(offer: {
    creator: PublicKey;
    mint: PublicKey;
    amount: anchor.BN;
    side: any;
    tradeId: anchor.BN;
    expiry: anchor.BN;
    nonce: anchor.BN;
  }): Buffer {
    // Borsh serialization matching on-chain Offer struct
    const writer = new anchor.BorshCoder(program.idl).instruction.encode(
      "matchOffer",
      { offer: offer }
    );
    // This is simplified - in production, use proper Borsh schema
    // For now, manually construct
    const buffer = Buffer.concat([
      offer.creator.toBuffer(),
      offer.mint.toBuffer(),
      offer.amount.toArrayLike(Buffer, "le", 8),
      Buffer.from([offer.side.sell ? 1 : 0]), // TradeSide enum
      offer.tradeId.toArrayLike(Buffer, "le", 8),
      offer.expiry.toArrayLike(Buffer, "le", 8),
      offer.nonce.toArrayLike(Buffer, "le", 8),
    ]);
    return buffer;
  }

  // Helper: Hash offer
  function hashOffer(offerBytes: Buffer): Buffer {
    return crypto.createHash("sha256").update(offerBytes).digest();
  }

  before(async () => {
    await connection.requestAirdrop(
      treasury.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    [protocolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol-config")],
      program.programId
    );

    // Initialize if not exists
    try {
      await program.account.protocolConfig.fetch(protocolConfigPda);
    } catch {
      await program.methods
        .initializeConfig({
          feeBps: 250,
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

    mint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      6
    );
  });

  describe("Offer Matching - Happy Path", () => {
    it("matches valid signed offer", async () => {
      const offerCreator = Keypair.generate();
      const matcher = Keypair.generate();
      const counterparty = Keypair.generate();

      await connection.requestAirdrop(
        offerCreator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.requestAirdrop(
        matcher.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tradeId = Date.now();
      const amount = 1_000_000;
      const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const nonce = Math.floor(Math.random() * 1_000_000);

      // Create offer
      const offer = {
        creator: offerCreator.publicKey,
        mint: mint,
        amount: new anchor.BN(amount),
        side: { sell: {} },
        tradeId: new anchor.BN(tradeId),
        expiry: new anchor.BN(expiry),
        nonce: new anchor.BN(nonce),
      };

      // Serialize and hash
      const offerBytes = serializeOffer(offer);
      const offerHash = hashOffer(offerBytes);

      // Sign offer (off-chain)
      const signature = await ed25519.sign(
        offerHash,
        offerCreator.secretKey.slice(0, 32)
      );

      // Derive PDAs
      const [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          offerCreator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [offerFillPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("offer-fill"), offerHash],
        program.programId
      );

      // Match offer
      await program.methods
        .matchOffer({
          offer: offer,
          signature: Array.from(signature),
          counterparty: counterparty.publicKey,
          offerHash: Array.from(offerHash),
        })
        .accounts({
          matcher: matcher.publicKey,
          offerCreator: offerCreator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          offerFill: offerFillPda,
          ed25519Program: new PublicKey(
            "Ed25519SigVerify111111111111111111111111111"
          ),
          systemProgram: SystemProgram.programId,
        })
        .signers([matcher])
        .rpc();

      // Verify trade created
      const trade = await program.account.trade.fetch(tradePda);
      assert.equal(
        trade.creator.toBase58(),
        offerCreator.publicKey.toBase58()
      );
      assert.equal(
        trade.counterparty.toBase58(),
        counterparty.publicKey.toBase58()
      );
      assert.deepEqual(trade.status, { created: {} }); // NOT locked yet
      assert.equal(trade.amount.toString(), amount.toString());

      // Verify OfferFill created (replay protection)
      const offerFill = await program.account.offerFill.fetch(offerFillPda);
      assert.deepEqual(Buffer.from(offerFill.offerHash), offerHash);
      assert.equal(offerFill.trade.toBase58(), tradePda.toBase58());
      assert.equal(offerFill.filler.toBase58(), matcher.publicKey.toBase58());
    });
  });

  describe("Replay Protection", () => {
    it("fails to match same offer twice", async () => {
      const offerCreator = Keypair.generate();
      const matcher = Keypair.generate();
      const counterparty = Keypair.generate();

      await connection.requestAirdrop(
        offerCreator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.requestAirdrop(
        matcher.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tradeId = Date.now() + 1000;
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const nonce = Math.floor(Math.random() * 1_000_000);

      const offer = {
        creator: offerCreator.publicKey,
        mint: mint,
        amount: new anchor.BN(500_000),
        side: { sell: {} },
        tradeId: new anchor.BN(tradeId),
        expiry: new anchor.BN(expiry),
        nonce: new anchor.BN(nonce),
      };

      const offerBytes = serializeOffer(offer);
      const offerHash = hashOffer(offerBytes);
      const signature = await ed25519.sign(
        offerHash,
        offerCreator.secretKey.slice(0, 32)
      );

      const [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          offerCreator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [offerFillPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("offer-fill"), offerHash],
        program.programId
      );

      // First match - succeeds
      await program.methods
        .matchOffer({
          offer: offer,
          signature: Array.from(signature),
          counterparty: counterparty.publicKey,
          offerHash: Array.from(offerHash),
        })
        .accounts({
          matcher: matcher.publicKey,
          offerCreator: offerCreator.publicKey,
          protocolConfig: protocolConfigPda,
          trade: tradePda,
          offerFill: offerFillPda,
          ed25519Program: new PublicKey(
            "Ed25519SigVerify111111111111111111111111111"
          ),
          systemProgram: SystemProgram.programId,
        })
        .signers([matcher])
        .rpc();

      // Second match - fails (OfferFill PDA already exists)
      try {
        const tradeId2 = tradeId + 1; // Different trade ID
        const [tradePda2] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("trade-v2"),
            offerCreator.publicKey.toBuffer(),
            new anchor.BN(tradeId2).toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        await program.methods
          .matchOffer({
            offer: {
              ...offer,
              tradeId: new anchor.BN(tradeId2), // Different trade ID, SAME offer hash
            },
            signature: Array.from(signature),
            counterparty: counterparty.publicKey,
            offerHash: Array.from(offerHash), // Same hash
          })
          .accounts({
            matcher: matcher.publicKey,
            offerCreator: offerCreator.publicKey,
            protocolConfig: protocolConfigPda,
            trade: tradePda2,
            offerFill: offerFillPda, // SAME offer fill PDA
            ed25519Program: new PublicKey(
              "Ed25519SigVerify111111111111111111111111111"
            ),
            systemProgram: SystemProgram.programId,
          })
          .signers([matcher])
          .rpc();
        assert.fail("Should have failed - offer already filled");
      } catch (err) {
        // Expected - OfferFill account already exists
        assert.include(err.toString().toLowerCase(), "already in use");
      }
    });
  });

  describe("Expiry Validation", () => {
    it("fails to match expired offer", async () => {
      const offerCreator = Keypair.generate();
      const matcher = Keypair.generate();

      await connection.requestAirdrop(
        offerCreator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.requestAirdrop(
        matcher.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tradeId = Date.now() + 2000;
      const expiry = Math.floor(Date.now() / 1000) - 100; // Expired 100 seconds ago

      const offer = {
        creator: offerCreator.publicKey,
        mint: mint,
        amount: new anchor.BN(200_000),
        side: { sell: {} },
        tradeId: new anchor.BN(tradeId),
        expiry: new anchor.BN(expiry),
        nonce: new anchor.BN(12345),
      };

      const offerBytes = serializeOffer(offer);
      const offerHash = hashOffer(offerBytes);
      const signature = await ed25519.sign(
        offerHash,
        offerCreator.secretKey.slice(0, 32)
      );

      const [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          offerCreator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [offerFillPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("offer-fill"), offerHash],
        program.programId
      );

      try {
        await program.methods
          .matchOffer({
            offer: offer,
            signature: Array.from(signature),
            counterparty: Keypair.generate().publicKey,
            offerHash: Array.from(offerHash),
          })
          .accounts({
            matcher: matcher.publicKey,
            offerCreator: offerCreator.publicKey,
            protocolConfig: protocolConfigPda,
            trade: tradePda,
            offerFill: offerFillPda,
            ed25519Program: new PublicKey(
              "Ed25519SigVerify111111111111111111111111111"
            ),
            systemProgram: SystemProgram.programId,
          })
          .signers([matcher])
          .rpc();
        assert.fail("Should have failed - offer expired");
      } catch (err) {
        assert.include(err.toString(), "OfferExpired");
      }
    });
  });

  describe("Hash Validation", () => {
    it("fails if offer hash doesn't match", async () => {
      const offerCreator = Keypair.generate();
      const matcher = Keypair.generate();

      await connection.requestAirdrop(
        offerCreator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.requestAirdrop(
        matcher.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tradeId = Date.now() + 3000;
      const expiry = Math.floor(Date.now() / 1000) + 3600;

      const offer = {
        creator: offerCreator.publicKey,
        mint: mint,
        amount: new anchor.BN(100_000),
        side: { sell: {} },
        tradeId: new anchor.BN(tradeId),
        expiry: new anchor.BN(expiry),
        nonce: new anchor.BN(99999),
      };

      const offerBytes = serializeOffer(offer);
      const correctHash = hashOffer(offerBytes);
      const wrongHash = crypto.randomBytes(32); // Random wrong hash

      const signature = await ed25519.sign(
        correctHash,
        offerCreator.secretKey.slice(0, 32)
      );

      const [tradePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("trade-v2"),
          offerCreator.publicKey.toBuffer(),
          new anchor.BN(tradeId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [offerFillPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("offer-fill"), wrongHash],
        program.programId
      );

      try {
        await program.methods
          .matchOffer({
            offer: offer,
            signature: Array.from(signature),
            counterparty: Keypair.generate().publicKey,
            offerHash: Array.from(wrongHash), // Wrong hash
          })
          .accounts({
            matcher: matcher.publicKey,
            offerCreator: offerCreator.publicKey,
            protocolConfig: protocolConfigPda,
            trade: tradePda,
            offerFill: offerFillPda,
            ed25519Program: new PublicKey(
              "Ed25519SigVerify111111111111111111111111111"
            ),
            systemProgram: SystemProgram.programId,
          })
          .signers([matcher])
          .rpc();
        assert.fail("Should have failed - hash mismatch");
      } catch (err) {
        assert.include(err.toString(), "InvalidSignature");
      }
    });
  });
});
