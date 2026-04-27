/**
 * Blip Protocol V2.3 Program Interactions
 * Lane management, trade creation, escrow lock/release/refund
 * Payment confirmation and dispute resolution
 */

import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
  Program,
  AnchorProvider,
  Idl,
  BN,
} from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import {
  findLanePda,
  findLaneVaultAuthorityPda,
  findTradePda,
  findEscrowPda,
  findVaultAuthorityPda,
  findProtocolConfigPda,
} from './pdas';
import {
  CreateLaneParams,
  FundLaneParams,
  WithdrawLaneParams,
  CreateTradeParams,
  FundEscrowParams,
  AcceptTradeParams,
  LockEscrowParams,
  ReleaseEscrowParams,
  RefundEscrowParams,
  ExtendEscrowParams,
  ConfirmPaymentParams,
  OpenDisputeParams,
  ResolveDisputeParams,
  Lane,
  Trade,
  Escrow,
  TradeSide,
  DisputeResolution,
} from './types';
import {
  getV2ProgramId,
  getFeeTreasury,
  getUsdtMint,
} from './config';
import idl from './idl.json';

// Cast IDL to any for Anchor compatibility
const programIdl = idl as any;

/**
 * Get the Anchor program instance
 */
export function getProgram(connection: Connection, wallet: any): Program {
  const provider = new AnchorProvider(
    connection,
    wallet,
    { commitment: 'confirmed' }
  );
  const programId = getV2ProgramId();
  return new Program(programIdl, programId, provider);
}

// ============ LANE MANAGEMENT ============

/**
 * Build create lane transaction
 */
export async function buildCreateLaneTx(
  connection: Connection,
  merchant: PublicKey,
  params: CreateLaneParams
): Promise<Transaction> {
  const [lanePda] = findLanePda(merchant, params.laneId);
  const [laneVaultAuthority] = findLaneVaultAuthorityPda(lanePda);
  const laneVaultAta = await getAssociatedTokenAddress(
    params.mint,
    laneVaultAuthority,
    true
  );

  const transaction = new Transaction();

  // The program will create the lane PDA and vault ATA
  // We need to add the instruction data manually since we don't have a full Program instance
  // For now, return a transaction that can be built with the program

  return transaction;
}

/**
 * Create a new liquidity lane (corridor)
 */
export async function createLane(
  program: Program,
  merchant: PublicKey,
  params: CreateLaneParams
): Promise<string> {
  const [lanePda] = findLanePda(merchant, params.laneId);
  const [laneVaultAuthority] = findLaneVaultAuthorityPda(lanePda);
  const laneVaultAta = await getAssociatedTokenAddress(
    params.mint,
    laneVaultAuthority,
    true
  );

  // Pass individual args (flattened) for IDL compatibility
  const tx = await (program.methods as any)
    .createLane({ laneId: new BN(params.laneId), minAmount: params.minAmount, maxAmount: params.maxAmount })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAuthority: laneVaultAuthority,
      vaultAta: laneVaultAta,
      mint: params.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  return tx;
}

/**
 * Build fund lane transaction
 */
export async function buildFundLaneTx(
  program: Program,
  merchant: PublicKey,
  mint: PublicKey,
  params: FundLaneParams
): Promise<Transaction> {
  const [lanePda] = findLanePda(merchant, params.laneId);
  const [laneVaultAuthority] = findLaneVaultAuthorityPda(lanePda);
  const laneVaultAta = await getAssociatedTokenAddress(
    mint,
    laneVaultAuthority,
    true
  );
  const merchantAta = await getAssociatedTokenAddress(mint, merchant);

  // Pass individual args (flattened) for IDL compatibility
  const instruction = await (program.methods as any)
    .fundLane({ amount: params.amount })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAta: laneVaultAta,
      merchantAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Fund a liquidity lane
 */
export async function fundLane(
  program: Program,
  merchant: PublicKey,
  mint: PublicKey,
  params: FundLaneParams
): Promise<string> {
  const [lanePda] = findLanePda(merchant, params.laneId);
  const [laneVaultAuthority] = findLaneVaultAuthorityPda(lanePda);
  const laneVaultAta = await getAssociatedTokenAddress(
    mint,
    laneVaultAuthority,
    true
  );
  const merchantAta = await getAssociatedTokenAddress(mint, merchant);

  // Pass individual args (flattened) for IDL compatibility
  const tx = await (program.methods as any)
    .fundLane({ amount: params.amount })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAta: laneVaultAta,
      merchantAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc({ commitment: 'confirmed' });

  return tx;
}

/**
 * Build withdraw lane transaction
 */
export async function buildWithdrawLaneTx(
  program: Program,
  merchant: PublicKey,
  mint: PublicKey,
  params: WithdrawLaneParams
): Promise<Transaction> {
  const [lanePda] = findLanePda(merchant, params.laneId);
  const [laneVaultAuthority] = findLaneVaultAuthorityPda(lanePda);
  const laneVaultAta = await getAssociatedTokenAddress(
    mint,
    laneVaultAuthority,
    true
  );
  const merchantAta = await getAssociatedTokenAddress(mint, merchant);

  // Pass individual args (flattened) for IDL compatibility
  const instruction = await (program.methods as any)
    .withdrawLane({ amount: params.amount })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAuthority: laneVaultAuthority,
      vaultAta: laneVaultAta,
      merchantAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Withdraw from liquidity lane
 */
export async function withdrawLane(
  program: Program,
  merchant: PublicKey,
  mint: PublicKey,
  params: WithdrawLaneParams
): Promise<string> {
  const [lanePda] = findLanePda(merchant, params.laneId);
  const [laneVaultAuthority] = findLaneVaultAuthorityPda(lanePda);
  const laneVaultAta = await getAssociatedTokenAddress(
    mint,
    laneVaultAuthority,
    true
  );
  const merchantAta = await getAssociatedTokenAddress(mint, merchant);

  // Pass individual args (flattened) for IDL compatibility
  const tx = await (program.methods as any)
    .withdrawLane({ amount: params.amount })
    .accounts({
      merchant,
      lane: lanePda,
      vaultAuthority: laneVaultAuthority,
      vaultAta: laneVaultAta,
      merchantAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc({ commitment: 'confirmed' });

  return tx;
}

/**
 * Fetch lane account data
 */
export async function fetchLane(
  program: Program,
  merchant: PublicKey,
  laneId: number
): Promise<Lane | null> {
  try {
    const [lanePda] = findLanePda(merchant, laneId);
    const lane = await (program.account as any).lane.fetch(lanePda);
    return lane as unknown as Lane;
  } catch (err) {
    return null;
  }
}

// ============ PROTOCOL INITIALIZATION ============

/**
 * Check if protocol config exists.
 *
 * Uses raw `getAccountInfo` instead of `program.account.protocolConfig.fetch()`
 * because our IDL converter (`convertIdlToAnchor29`) intentionally ships an
 * empty `accounts` array in the converted IDL — otherwise anchor@0.29 crashes
 * at `new Program()` trying to build account coders for the 0.30+ IDL's new
 * account definition shape. With `accounts: []`, `program.account.protocolConfig`
 * is `undefined` and the old `fetch` path always threw → this function always
 * returned `false`, which made every `initializeConfig` call try to re-create
 * an already-existing PDA and fail with `already in use (0x0)`.
 *
 * Existence is what we actually need, not a decoded struct — `getAccountInfo`
 * is both sufficient and independent of the Anchor account coder.
 */
export async function checkProtocolConfigExists(
  program: Program
): Promise<boolean> {
  try {
    const [protocolConfigPda] = findProtocolConfigPda();
    const info = await program.provider.connection.getAccountInfo(
      protocolConfigPda,
      'confirmed'
    );
    return info !== null;
  } catch {
    return false;
  }
}

/**
 * Initialize protocol config (must be called by authority)
 * This is required before any trades can be created
 */
export async function initializeProtocolConfig(
  program: Program,
  authority: PublicKey,
  treasury?: PublicKey,
  feeBps: number = 250,  // 2.5%
  maxFeeBps: number = 1000, // 10%
  minFeeBps: number = 0
): Promise<string> {
  const [protocolConfigPda] = findProtocolConfigPda();
  const treasuryPubkey = treasury || getFeeTreasury();

  console.log('[initializeProtocolConfig] Parameters:');
  console.log('  authority:', authority.toString());
  console.log('  protocolConfigPda:', protocolConfigPda.toString());
  console.log('  treasuryPubkey:', treasuryPubkey.toString());
  console.log('  systemProgram:', SystemProgram.programId.toString());
  console.log('  feeBps:', feeBps, typeof feeBps);
  console.log('  maxFeeBps:', maxFeeBps, typeof maxFeeBps);
  console.log('  minFeeBps:', minFeeBps, typeof minFeeBps);

  // Validate parameters
  if (!authority) throw new Error('Authority is required');
  if (!treasuryPubkey) throw new Error('Treasury is required');
  if (typeof feeBps !== 'number') throw new Error('feeBps must be a number');
  if (typeof maxFeeBps !== 'number') throw new Error('maxFeeBps must be a number');
  if (typeof minFeeBps !== 'number') throw new Error('minFeeBps must be a number');

  console.log('[initializeProtocolConfig] Calling initializeConfig...');

  // Belt-and-braces: if the PDA already exists on-chain, don't try to
  // allocate it again (the system program rejects with 0x0 "account
  // already in use"). This makes the function idempotent under any
  // caller that doesn't pre-check via `checkProtocolConfigExists`.
  const existing = await program.provider.connection.getAccountInfo(
    protocolConfigPda,
    'confirmed'
  );
  if (existing) {
    console.log('[initializeProtocolConfig] Already initialized at', protocolConfigPda.toBase58());
    return 'already-initialized';
  }

  // Build the instruction step by step to catch errors
  try {
    const methods = (program.methods as any);
    console.log('[initializeProtocolConfig] Got methods object:', !!methods);
    console.log('[initializeProtocolConfig] Has initializeConfig:', !!methods.initializeConfig);

    // 0.30+ IDL: `initialize_config` takes a single `params: InitializeConfigParams`
    // struct ({ fee_bps, max_fee_bps, min_fee_bps }). Anchor TS client
    // camelCase-maps snake_case field names automatically.
    const methodBuilder = methods.initializeConfig({ feeBps, maxFeeBps, minFeeBps });
    console.log('[initializeProtocolConfig] Method builder created:', !!methodBuilder);

    const accountsBuilder = methodBuilder.accounts({
      authority,
      protocolConfig: protocolConfigPda,
      treasury: treasuryPubkey,
      systemProgram: SystemProgram.programId,
    });
    console.log('[initializeProtocolConfig] Accounts builder created:', !!accountsBuilder);

    console.log('[initializeProtocolConfig] About to call RPC...');
    const tx = await accountsBuilder.rpc({ commitment: 'confirmed' });
    console.log('[initializeProtocolConfig] RPC call succeeded!');

    return tx;
  } catch (error) {
    console.error('[initializeProtocolConfig] Error during RPC call:', error);
    console.error('[initializeProtocolConfig] Error details:', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// ============ TRADE MANAGEMENT ============

/**
 * Build create trade transaction
 * Note: Protocol config must be initialized first via initializeProtocolConfig
 */
export async function buildCreateTradeTx(
  program: Program,
  creator: PublicKey,
  mint: PublicKey,
  params: CreateTradeParams
): Promise<Transaction> {
  const [tradePda] = findTradePda(creator, params.tradeId);
  const [protocolConfigPda] = findProtocolConfigPda();

  // Check if protocol config exists
  const configExists = await checkProtocolConfigExists(program);
  if (!configExists) {
    throw new Error(
      'Protocol config not initialized. Please initialize the protocol first by calling initializeProtocolConfig with an authority wallet.'
    );
  }

  const sideEnum = params.side === TradeSide.Buy ? { buy: {} } : { sell: {} };

  // Pass individual args (flattened) for IDL compatibility
  const instruction = await (program.methods as any)
    .createTrade({ tradeId: new BN(params.tradeId), amount: params.amount, side: sideEnum })
    .accounts({
      creator,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      mint,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Build fund escrow transaction (WITHOUT counterparty)
 * Use this when you want to fund the escrow first and let someone join later.
 *
 * Flow: create_trade → fund_escrow (Funded) → accept_trade (Locked) → release_escrow
 */
export async function buildFundEscrowTx(
  program: Program,
  depositor: PublicKey,
  tradePda: PublicKey,
  mint: PublicKey
): Promise<Transaction> {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const depositorAta = await getAssociatedTokenAddress(mint, depositor);

  // fundEscrow takes no args - counterparty is set later via acceptTrade
  const instruction = await (program.methods as any)
    .fundEscrow()
    .accounts({
      depositor,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Build accept trade transaction (counterparty joins a funded escrow)
 * Use this after fund_escrow to join as the counterparty.
 *
 * Flow: create_trade → fund_escrow (Funded) → accept_trade (Locked) → release_escrow
 */
export async function buildAcceptTradeTx(
  program: Program,
  acceptor: PublicKey,
  tradePda: PublicKey
): Promise<Transaction> {
  const [escrowPda] = findEscrowPda(tradePda);
  const [protocolConfigPda] = findProtocolConfigPda();

  // acceptTrade takes no args - the signer becomes the counterparty
  const instruction = await (program.methods as any)
    .acceptTrade()
    .accounts({
      acceptor,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Build lock escrow transaction
 */
export async function buildLockEscrowTx(
  program: Program,
  depositor: PublicKey,
  tradePda: PublicKey,
  counterparty: PublicKey,
  mint: PublicKey
): Promise<Transaction> {
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const depositorAta = await getAssociatedTokenAddress(mint, depositor);

  // Pass individual args (flattened) for IDL compatibility
  const instruction = await (program.methods as any)
    .lockEscrow({ counterparty })
    .accounts({
      depositor,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Build release escrow transaction
 */
export async function buildReleaseEscrowTx(
  program: Program,
  releaser: PublicKey,
  params: ReleaseEscrowParams
): Promise<Transaction> {
  const { tradePda, counterparty, mint } = params;
  const connection = program.provider.connection;

  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const counterpartyAta = await getAssociatedTokenAddress(mint, counterparty);
  const treasury = getFeeTreasury();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);

  // The on-chain program needs the escrow's depositor (whoever funded it).
  // Escrow.depositor sits at offset 8(disc) + 32(trade) + 32(vault_auth) + 32(vault_ata) = 104.
  const escrowInfo = await connection.getAccountInfo(escrowPda, 'confirmed');
  if (!escrowInfo || escrowInfo.data.length < 136) {
    throw new Error(
      `Escrow account does not exist or has no data (${escrowPda.toString()}).`,
    );
  }
  const depositor = new PublicKey(escrowInfo.data.subarray(104, 136));

  const transaction = new Transaction();

  // Check if counterparty ATA exists, create if it doesn't
  try {
    await getAccount(connection, counterpartyAta);
  } catch (error) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      releaser,
      counterpartyAta,
      counterparty,
      mint
    );
    transaction.add(createAtaIx);
  }

  // Check if treasury ATA exists, create if it doesn't
  try {
    await getAccount(connection, treasuryAta);
  } catch (error) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      releaser,
      treasuryAta,
      treasury,
      mint
    );
    transaction.add(createAtaIx);
  }

  // releaseEscrow takes no args per IDL
  const releaseIx = await (program.methods as any)
    .releaseEscrow()
    .accounts({
      signer: releaser,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      counterpartyAta,
      treasuryAta,
      depositor,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  transaction.add(releaseIx);
  return transaction;
}

/**
 * Build refund escrow transaction
 */
export async function buildRefundEscrowTx(
  program: Program,
  refunder: PublicKey,
  params: RefundEscrowParams
): Promise<Transaction> {
  const { tradePda, mint } = params;

  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);

  const connection = program.provider.connection;

  // Fetch escrow via raw getAccountInfo (Anchor .fetch() broken under
  // converted IDL). Escrow.depositor is at offset 8+32+32+32 = 104.
  const escrowInfo = await connection.getAccountInfo(escrowPda, 'confirmed');
  if (!escrowInfo || escrowInfo.data.length < 136) {
    throw new Error(
      `Escrow account does not exist or has no data (${escrowPda.toString()}). It may have already been refunded or was never funded on-chain.`,
    );
  }
  const escrowDepositor = new PublicKey(escrowInfo.data.subarray(104, 136));
  const depositorAta = await getAssociatedTokenAddress(mint, escrowDepositor);

  // Fetch trade to get creator (offset 8..40).
  let creator = refunder;
  try {
    const info = await connection.getAccountInfo(tradePda, 'confirmed');
    if (info && info.data.length >= 40) {
      creator = new PublicKey(info.data.subarray(8, 40));
    }
  } catch (e) {
    console.error('Failed to fetch trade account:', e);
  }

  // refundEscrow takes no args per IDL
  const accounts: Record<string, any> = {
    signer: refunder,
    trade: tradePda,
    escrow: escrowPda,
    vaultAuthority,
    vaultAta,
    depositorAta,
    creator,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    protocolConfig: params.protocolConfigPda ?? null,
  };

  const refundIx = await (program.methods as any)
    .refundEscrow()
    .accounts(accounts)
    .instruction();

  const transaction = new Transaction().add(refundIx);
  return transaction;
}

/**
 * Build extend escrow transaction (depositor only)
 * Extends the escrow expiration time. Only the depositor who funded can extend.
 * Cannot extend if already expired.
 */
export async function buildExtendEscrowTx(
  program: Program,
  depositor: PublicKey,
  params: ExtendEscrowParams
): Promise<Transaction> {
  const { tradePda, extensionSeconds } = params;
  const [escrowPda] = findEscrowPda(tradePda);

  const instruction = await (program.methods as any)
    .extendEscrow({ extensionSeconds })
    .accounts({
      depositor,
      trade: tradePda,
      escrow: escrowPda,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

// ============ V2.3: PAYMENT CONFIRMATION & DISPUTES ============

/**
 * Build confirm payment transaction (buyer only)
 * Buyer confirms they have sent fiat payment.
 * Transitions: Locked → PaymentSent
 *
 * CRITICAL: After this, auto-refund is FORBIDDEN.
 * Only dispute resolution can adjudicate.
 */
export async function buildConfirmPaymentTx(
  program: Program,
  buyer: PublicKey,
  params: ConfirmPaymentParams
): Promise<Transaction> {
  const { tradePda } = params;
  const [escrowPda] = findEscrowPda(tradePda);

  const instruction = await (program.methods as any)
    .confirmPayment()
    .accounts({
      buyer,
      trade: tradePda,
      escrow: escrowPda,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Build open dispute transaction (either party)
 * Either buyer or seller can open a dispute when trade is Locked or PaymentSent.
 * Transitions: Locked/PaymentSent → Disputed
 *
 * Funds are frozen until arbiter resolves.
 */
export async function buildOpenDisputeTx(
  program: Program,
  initiator: PublicKey,
  params: OpenDisputeParams
): Promise<Transaction> {
  const { tradePda } = params;
  const [escrowPda] = findEscrowPda(tradePda);

  const instruction = await (program.methods as any)
    .openDispute()
    .accounts({
      initiator,
      trade: tradePda,
      escrow: escrowPda,
    })
    .instruction();

  const transaction = new Transaction().add(instruction);
  return transaction;
}

/**
 * Build resolve dispute transaction (arbiter only)
 * Protocol authority (arbiter) resolves the dispute.
 * Transitions: Disputed → Released (ReleaseToBuyer) or Refunded (RefundToSeller)
 */
export async function buildResolveDisputeTx(
  program: Program,
  arbiter: PublicKey,
  params: ResolveDisputeParams
): Promise<Transaction> {
  const { tradePda, resolution, mint } = params;
  const connection = program.provider.connection;

  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const treasury = getFeeTreasury();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);

  // Fetch trade + escrow via raw getAccountInfo (Anchor .fetch() broken
  // under converted IDL). Offsets per state/*.rs:
  //   Trade.counterparty   = 8(disc) + 32(creator)                      = 40
  //   Escrow.depositor     = 8(disc) + 32(trade) + 32(vault_auth) + 32(vault_ata) = 104
  const tradeInfo = await connection.getAccountInfo(tradePda, 'confirmed');
  const escrowInfo = await connection.getAccountInfo(escrowPda, 'confirmed');
  if (!tradeInfo || !escrowInfo) throw new Error('Trade or escrow account not on-chain');
  const tradeCounterparty = new PublicKey(tradeInfo.data.subarray(40, 72));
  const escrowDepositor = new PublicKey(escrowInfo.data.subarray(104, 136));

  const buyerAta = await getAssociatedTokenAddress(mint, tradeCounterparty);
  const sellerAta = await getAssociatedTokenAddress(mint, escrowDepositor);

  const transaction = new Transaction();

  // Ensure buyer ATA exists
  try {
    await getAccount(connection, buyerAta);
  } catch (error) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      arbiter,
      buyerAta,
      tradeCounterparty,
      mint
    );
    transaction.add(createAtaIx);
  }

  // Ensure treasury ATA exists
  try {
    await getAccount(connection, treasuryAta);
  } catch (error) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      arbiter,
      treasuryAta,
      treasury,
      mint
    );
    transaction.add(createAtaIx);
  }

  // Convert resolution enum to Anchor format
  const resolutionEnum = resolution === DisputeResolution.ReleaseToBuyer
    ? { releaseToBuyer: {} }
    : { refundToSeller: {} };

  const instruction = await (program.methods as any)
    .resolveDispute({ resolution: resolutionEnum })
    .accounts({
      arbiter,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      buyerAta,
      sellerAta,
      treasuryAta,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  transaction.add(instruction);
  return transaction;
}

/**
 * Fetch trade account data
 */
export async function fetchTrade(
  program: Program,
  creator: PublicKey,
  tradeId: number
): Promise<Trade | null> {
  // `program.account.trade.fetch()` doesn't work under our converted IDL
  // (`convertIdlToAnchor29` sets accounts:[] to prevent `new Program()`
  // from crashing on 0.30+ account defs; the trade-off is `program.account.X`
  // is undefined). Use raw getAccountInfo + stable byte-offset decoding
  // instead. Layout mirrors state/trade.rs:
  //   0..8    discriminator
  //   8..40   creator (Pubkey)
  //   40..72  counterparty (Pubkey)
  //   72..80  trade_id (u64 LE)
  //   80..112 mint (Pubkey)
  //   112..120 amount (u64 LE)
  //   120     status (u8)
  // Only `counterparty` is read by downstream release/refund code paths;
  // other fields are filled in best-effort so the Trade shape is honored.
  try {
    const [tradePda] = findTradePda(creator, tradeId);
    const info = await program.provider.connection.getAccountInfo(tradePda, 'confirmed');
    if (!info || info.data.length < 121) return null;
    const data = info.data;
    return {
      creator: new PublicKey(data.subarray(8, 40)),
      counterparty: new PublicKey(data.subarray(40, 72)),
      tradeId: new BN(data.subarray(72, 80), 'le'),
      mint: new PublicKey(data.subarray(80, 112)),
      amount: new BN(data.subarray(112, 120), 'le'),
      status: data[120] as unknown as Trade['status'],
      feeBps: 0,
      escrowBump: 0,
      bump: 0,
      createdAt: new BN(0),
      lockedAt: new BN(0),
      settledAt: new BN(0),
      side: 0 as unknown as Trade['side'],
      expiresAt: new BN(0),
      paymentConfirmedAt: new BN(0),
      disputedAt: new BN(0),
      disputeInitiator: PublicKey.default,
    } as Trade;
  } catch {
    return null;
  }
}

/**
 * Fetch escrow account data
 */
export async function fetchEscrow(
  program: Program,
  tradePda: PublicKey
): Promise<Escrow | null> {
  try {
    const [escrowPda] = findEscrowPda(tradePda);
    const escrow = await (program.account as any).escrow.fetch(escrowPda);
    return escrow as unknown as Escrow;
  } catch (err) {
    return null;
  }
}
