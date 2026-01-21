/**
 * Blip Protocol V2.2 Program Interactions
 * Lane management, trade creation, escrow lock/release/refund
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
  LockEscrowParams,
  ReleaseEscrowParams,
  RefundEscrowParams,
  Lane,
  Trade,
  Escrow,
  TradeSide,
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
    .createLane(new BN(params.laneId), params.minAmount, params.maxAmount)
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
    .fundLane(params.amount)
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
    .fundLane(params.amount)
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
    .withdrawLane(params.amount)
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
    .withdrawLane(params.amount)
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
 * Check if protocol config exists
 */
export async function checkProtocolConfigExists(
  program: Program
): Promise<boolean> {
  try {
    const [protocolConfigPda] = findProtocolConfigPda();
    await (program.account as any).protocolConfig.fetch(protocolConfigPda);
    return true;
  } catch (error) {
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

  // Build the instruction step by step to catch errors
  try {
    const methods = (program.methods as any);
    console.log('[initializeProtocolConfig] Got methods object:', !!methods);
    console.log('[initializeProtocolConfig] Has initializeConfig:', !!methods.initializeConfig);

    const methodBuilder = methods.initializeConfig(feeBps, maxFeeBps, minFeeBps);
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
    .createTrade(new BN(params.tradeId), params.amount, sideEnum)
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
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const depositorAta = await getAssociatedTokenAddress(mint, depositor);

  // Pass individual args (flattened) for IDL compatibility
  const instruction = await (program.methods as any)
    .lockEscrow(counterparty)
    .accounts({
      depositor,
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

  // Fetch trade to get creator
  let creator = releaser;
  try {
    const tradeAccount = await (program.account as any).trade.fetch(tradePda);
    if (tradeAccount.creator) {
      creator = tradeAccount.creator as PublicKey;
    }
  } catch (e) {
    console.error('Failed to fetch trade account:', e);
  }

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
      trade: tradePda,
      escrow: escrowPda,
      protocolConfig: protocolConfigPda,
      vaultAuthority,
      vaultAta,
      counterpartyAta,
      treasuryAta,
      creator,
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

  // Fetch escrow to get depositor
  const escrow = await (program.account as any).escrow.fetch(escrowPda);
  const depositorAta = await getAssociatedTokenAddress(mint, escrow.depositor);

  // Fetch trade to get creator
  let creator = refunder;
  try {
    const tradeAccount = await (program.account as any).trade.fetch(tradePda);
    if (tradeAccount.creator) {
      creator = tradeAccount.creator as PublicKey;
    }
  } catch (e) {
    console.error('Failed to fetch trade account:', e);
  }

  // refundEscrow takes no args per IDL
  const refundIx = await (program.methods as any)
    .refundEscrow()
    .accounts({
      signer: refunder,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      depositorAta,
      creator,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const transaction = new Transaction().add(refundIx);
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
  try {
    const [tradePda] = findTradePda(creator, tradeId);
    const trade = await (program.account as any).trade.fetch(tradePda);
    return trade as unknown as Trade;
  } catch (err) {
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
