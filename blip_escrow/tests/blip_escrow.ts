import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BlipEscrow } from "../target/types/blip_escrow";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import assert from "assert";

// ---------- helpers ----------

function u8Array16FromString(s: string): number[] {
  const buf = Buffer.alloc(16);
  Buffer.from(s).copy(buf, 0, 0, 16);
  return [...buf];
}

function uniqueDealId(prefix: string): Uint8Array {
  const s = `${prefix}-${Date.now()}-${Math.random()}`;
  return Uint8Array.from(u8Array16FromString(s));
}

async function fundKeypairs(
  provider: anchor.AnchorProvider,
  from: PublicKey,
  kps: Keypair[],
  sol: number
) {
  for (const kp of kps) {
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: from,
          toPubkey: kp.publicKey,
          lamports: sol * anchor.web3.LAMPORTS_PER_SOL,
        })
      ),
      []
    );
  }
}

async function expectAnchorError(p: Promise<any>, code: string) {
  try {
    await p;
    assert.fail(`Expected error "${code}" but tx succeeded`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    assert(
      msg.includes(code),
      `Expected error "${code}" but got:\n${msg}`
    );
  }
}

// ---------- tests ----------

describe("blip_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BlipEscrow as Program<BlipEscrow>;
  const connection = provider.connection;

  const maker = (provider.wallet as anchor.Wallet).payer;

  it("create -> lock -> release (with fee + vault close)", async () => {
    const taker = Keypair.generate();
    const arbiter = Keypair.generate();
    const treasury = Keypair.generate();

    await fundKeypairs(provider, maker.publicKey, [taker, arbiter, treasury], 0.2);

    const mintPk = await createMint(connection, maker, maker.publicKey, null, 6);

    const makerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      maker.publicKey
    );

    const amount = 1_000_000n;
    await mintTo(connection, maker, mintPk, makerAta.address, maker.publicKey, amount);

    const dealId = uniqueDealId("deal-ok");

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), Buffer.from(dealId)],
      program.programId
    );

    const [escrowSignerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow-signer"), escrowPda.toBuffer()],
      program.programId
    );

    const derivedVaultAta = getAssociatedTokenAddressSync(
      mintPk,
      escrowSignerPda,
      true
    );

    const vaultAtaAcc = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      escrowSignerPda,
      true
    );
    const vaultAta = vaultAtaAcc.address;

    assert.equal(vaultAta.toBase58(), derivedVaultAta.toBase58());

    const takerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      taker.publicKey
    );

    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      treasury.publicKey
    );

    const feeBps = 50;
    const fee = (amount * BigInt(feeBps)) / 10_000n;
    const payout = amount - fee;

    await program.methods
      .createEscrow(
        Array.from(dealId) as number[],
        new anchor.BN(amount.toString()),
        feeBps
      )
      .accounts({
        maker: maker.publicKey,
        arbiter: arbiter.publicKey,
        treasury: treasury.publicKey,
        mint: mintPk,
        escrow: escrowPda,
        escrowSigner: escrowSignerPda,
        vaultAta,
        makerAta: makerAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc({ commitment: "confirmed" });

    await program.methods
      .lockForTaker()
      .accounts({ taker: taker.publicKey, escrow: escrowPda })
      .signers([taker])
      .rpc({ commitment: "confirmed" });

    const takerBalBefore = (await getAccount(connection, takerAta.address)).amount;
    const treasuryBalBefore = (await getAccount(connection, treasuryAta.address)).amount;

    await program.methods
      .releaseToTaker()
      .accounts({
        signer: maker.publicKey,
        maker: maker.publicKey,
        taker: taker.publicKey,
        treasury: treasury.publicKey,
        mint: mintPk,
        escrow: escrowPda,
        escrowSigner: escrowSignerPda,
        vaultAta,
        takerAta: takerAta.address,
        treasuryAta: treasuryAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const takerBalAfter = (await getAccount(connection, takerAta.address)).amount;
    const treasuryBalAfter = (await getAccount(connection, treasuryAta.address)).amount;

    assert.equal((takerBalAfter - takerBalBefore).toString(), payout.toString());
    assert.equal((treasuryBalAfter - treasuryBalBefore).toString(), fee.toString());

    let vaultClosed = false;
    try {
      await getAccount(connection, vaultAta);
    } catch {
      vaultClosed = true;
    }
    assert.equal(vaultClosed, true);
  });

  it("fails: non-maker/non-arbiter cannot release", async () => {
    const taker = Keypair.generate();
    const arbiter = Keypair.generate();
    const treasury = Keypair.generate();

    await fundKeypairs(provider, maker.publicKey, [taker, arbiter, treasury], 0.2);

    const mintPk = await createMint(connection, maker, maker.publicKey, null, 6);
    const makerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      maker.publicKey
    );

    const amount = 1_000_000n;
    await mintTo(connection, maker, mintPk, makerAta.address, maker.publicKey, amount);

    const dealId = uniqueDealId("deal-unauth");

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), Buffer.from(dealId)],
      program.programId
    );

    const [escrowSignerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow-signer"), escrowPda.toBuffer()],
      program.programId
    );

    const vaultAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        maker,
        mintPk,
        escrowSignerPda,
        true
      )
    ).address;

    const takerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      taker.publicKey
    );

    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintPk,
      treasury.publicKey
    );

    await program.methods
      .createEscrow(
        Array.from(dealId) as number[],
        new anchor.BN(amount.toString()),
        50
      )
      .accounts({
        maker: maker.publicKey,
        arbiter: arbiter.publicKey,
        treasury: treasury.publicKey,
        mint: mintPk,
        escrow: escrowPda,
        escrowSigner: escrowSignerPda,
        vaultAta,
        makerAta: makerAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await program.methods
      .lockForTaker()
      .accounts({ taker: taker.publicKey, escrow: escrowPda })
      .signers([taker])
      .rpc();

    await expectAnchorError(
      program.methods
        .releaseToTaker()
        .accounts({
          signer: taker.publicKey,
          maker: maker.publicKey,
          taker: taker.publicKey,
          treasury: treasury.publicKey,
          mint: mintPk,
          escrow: escrowPda,
          escrowSigner: escrowSignerPda,
          vaultAta,
          takerAta: takerAta.address,
          treasuryAta: treasuryAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([taker])
        .rpc(),
      "Unauthorized"
    );
  });

  it("fails: wrong mint ATA passed", async () => {
    const arbiter = Keypair.generate();
    const treasury = Keypair.generate();
    await fundKeypairs(provider, maker.publicKey, [arbiter, treasury], 0.2);

    const mintA = await createMint(connection, maker, maker.publicKey, null, 6);
    const mintB = await createMint(connection, maker, maker.publicKey, null, 6);

    const makerAtaWrong = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintB,
      maker.publicKey
    );

    const amount = 1_000_000n;
    await mintTo(connection, maker, mintB, makerAtaWrong.address, maker.publicKey, amount);

    const dealId = uniqueDealId("deal-wrongmint");

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), Buffer.from(dealId)],
      program.programId
    );

    const [escrowSignerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow-signer"), escrowPda.toBuffer()],
      program.programId
    );

    const vaultAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        maker,
        mintA,
        escrowSignerPda,
        true
      )
    ).address;

    await expectAnchorError(
      program.methods
        .createEscrow(
          Array.from(dealId) as number[],
          new anchor.BN(amount.toString()),
          50
        )
        .accounts({
          maker: maker.publicKey,
          arbiter: arbiter.publicKey,
          treasury: treasury.publicKey,
          mint: mintA,
          escrow: escrowPda,
          escrowSigner: escrowSignerPda,
          vaultAta,
          makerAta: makerAtaWrong.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
      "BadMint"
    );
  });
});
