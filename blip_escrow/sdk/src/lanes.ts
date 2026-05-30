import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import BN from "bn.js";
import {
  CreateLaneParams,
  FundLaneParams,
  WithdrawLaneParams,
} from "./types";

/**
 * V2.2 LANE MANAGEMENT
 *
 * Lanes are prefunded liquidity pools that enable atomic, one-click matching.
 */

/**
 * Find lane PDA address
 *
 * Seeds: [b"lane-v2", merchant, lane_id.to_le_bytes()]
 */
export function findLanePda(
  programId: PublicKey,
  merchant: PublicKey,
  laneId: BN | number
): [PublicKey, number] {
  const laneIdBN = laneId instanceof BN ? laneId : new BN(laneId);
  const laneIdBuffer = laneIdBN.toArrayLike(Buffer, "le", 8);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("lane-v2"), merchant.toBuffer(), laneIdBuffer],
    programId
  );
}

/**
 * Find lane vault authority PDA
 *
 * Seeds: [b"lane-vault-authority-v2", lane_pda]
 */
export function findLaneVaultAuthorityPda(
  programId: PublicKey,
  lanePda: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lane-vault-authority-v2"), lanePda.toBuffer()],
    programId
  );
}

/**
 * Create a liquidity lane
 *
 * One-time setup for a merchant to enable atomic matching.
 */
export async function createLane(
  program: Program,
  params: CreateLaneParams
): Promise<Transaction> {
  const { merchant, laneId, mint, minAmount, maxAmount } = params;

  const laneIdBN = laneId instanceof BN ? laneId : new BN(laneId);
  const minAmountBN = minAmount instanceof BN ? minAmount : new BN(minAmount);
  const maxAmountBN = maxAmount instanceof BN ? maxAmount : new BN(maxAmount);

  const [lanePda] = findLanePda(program.programId, merchant, laneIdBN);
  const [vaultAuthority] = findLaneVaultAuthorityPda(program.programId, lanePda);

  const vaultAta = await getAssociatedTokenAddress(
    mint,
    vaultAuthority,
    true // allowOwnerOffCurve
  );

  const tx = await program.methods
    .createLane({
      laneId: laneIdBN,
      minAmount: minAmountBN,
      maxAmount: maxAmountBN,
    })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAuthority,
      vaultAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: PublicKey.default,
    })
    .transaction();

  return tx;
}

/**
 * Fund a liquidity lane (deposit tokens)
 *
 * Increases lane.available_balance and vault token balance.
 */
export async function fundLane(
  program: Program,
  params: FundLaneParams
): Promise<Transaction> {
  const { merchant, laneId, mint, amount } = params;

  const laneIdBN = laneId instanceof BN ? laneId : new BN(laneId);
  const amountBN = amount instanceof BN ? amount : new BN(amount);

  const [lanePda] = findLanePda(program.programId, merchant, laneIdBN);
  const [vaultAuthority] = findLaneVaultAuthorityPda(program.programId, lanePda);

  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const merchantAta = await getAssociatedTokenAddress(mint, merchant);

  const tx = await program.methods
    .fundLane({ amount: amountBN })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAta,
      merchantAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  return tx;
}

/**
 * Withdraw from liquidity lane (withdraw available funds)
 *
 * Only merchant can call. Only withdraws available_balance (not locked funds).
 */
export async function withdrawLane(
  program: Program,
  params: WithdrawLaneParams
): Promise<Transaction> {
  const { merchant, laneId, mint, amount } = params;

  const laneIdBN = laneId instanceof BN ? laneId : new BN(laneId);
  const amountBN = amount instanceof BN ? amount : new BN(amount);

  const [lanePda] = findLanePda(program.programId, merchant, laneIdBN);
  const [vaultAuthority] = findLaneVaultAuthorityPda(program.programId, lanePda);

  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const merchantAta = await getAssociatedTokenAddress(mint, merchant);

  const tx = await program.methods
    .withdrawLane({ amount: amountBN })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAuthority,
      vaultAta,
      merchantAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  return tx;
}

/**
 * Build atomic match transaction (V2.2 PRIMARY PATH)
 *
 * Single transaction with:
 * 1. Ed25519 signature verification instruction
 * 2. match_offer_and_lock_from_lane instruction
 *
 * Result: Instant, one-click matching from prefunded lane.
 */
export async function buildAtomicMatchFromLaneTx(
  program: Program,
  params: {
    signedOffer: {
      offer: any;
      signature: Uint8Array;
      offerHash: Uint8Array;
    };
    matcher: PublicKey;
    counterparty: PublicKey;
    protocolConfigPda: PublicKey;
    ed25519Instruction: TransactionInstruction; // Pre-built ed25519 verification ix
  }
): Promise<Transaction> {
  const { signedOffer, matcher, counterparty, protocolConfigPda, ed25519Instruction } = params;
  const { offer, signature, offerHash } = signedOffer;

  // Derive PDAs
  const [lanePda] = findLanePda(
    program.programId,
    offer.creator,
    offer.laneId
  );

  const [laneVaultAuthority] = findLaneVaultAuthorityPda(
    program.programId,
    lanePda
  );

  const laneVaultAta = await getAssociatedTokenAddress(
    offer.mint,
    laneVaultAuthority,
    true
  );

  const tradeIdBuffer = offer.tradeId.toArrayLike(Buffer, "le", 8);
  const [tradePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trade-v2"), offer.creator.toBuffer(), tradeIdBuffer],
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

  const tradeVaultAta = await getAssociatedTokenAddress(
    offer.mint,
    tradeVaultAuthority,
    true
  );

  const [offerFillPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("offer-fill"), Buffer.from(offerHash)],
    program.programId
  );

  // Build match instruction
  const matchIx = await program.methods
    .matchOfferAndLockFromLane({
      offer,
      signature: Array.from(signature),
      counterparty,
      offerHash: Array.from(offerHash),
    })
    .accounts({
      matcher,
      offerCreator: offer.creator,
      protocolConfig: protocolConfigPda,
      lane: lanePda,
      laneVaultAuthority,
      laneVaultAta,
      trade: tradePda,
      escrow: escrowPda,
      tradeVaultAuthority,
      tradeVaultAta,
      offerFill: offerFillPda,
      mint: offer.mint,
      ed25519Program: new PublicKey("Ed25519SigVerify111111111111111111111111111"),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: PublicKey.default,
    })
    .instruction();

  // Build transaction with ed25519 pre-instruction
  const tx = new Transaction();
  tx.add(ed25519Instruction); // CRITICAL: Must come first
  tx.add(matchIx);

  return tx;
}

/**
 * Get lane account data
 */
export async function getLane(
  program: Program,
  merchant: PublicKey,
  laneId: BN | number
): Promise<any> {
  const [lanePda] = findLanePda(program.programId, merchant, laneId);
  return program.account.lane.fetch(lanePda);
}

/**
 * Get lane available balance
 */
export async function getLaneAvailableBalance(
  program: Program,
  merchant: PublicKey,
  laneId: BN | number
): Promise<BN> {
  const lane = await getLane(program, merchant, laneId);
  return lane.availableBalance;
}
