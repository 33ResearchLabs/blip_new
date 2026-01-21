/**
 * Blip Protocol V2.2 PDA Derivation Helpers
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getV2ProgramId } from './config';

/**
 * Find Protocol Config PDA
 * Seeds: [b"protocol-config"]
 */
export function findProtocolConfigPda(programId?: PublicKey): [PublicKey, number] {
  const pid = programId || getV2ProgramId();
  return PublicKey.findProgramAddressSync(
    [Buffer.from('protocol-config')],
    pid
  );
}

/**
 * Find Lane PDA
 * Seeds: [b"lane-v2", merchant, lane_id.to_le_bytes()]
 */
export function findLanePda(
  merchant: PublicKey,
  laneId: number,
  programId?: PublicKey
): [PublicKey, number] {
  const pid = programId || getV2ProgramId();
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('lane-v2'),
      merchant.toBuffer(),
      new BN(laneId).toArrayLike(Buffer, 'le', 8),
    ],
    pid
  );
}

/**
 * Find Lane Vault Authority PDA
 * Seeds: [b"lane-vault-authority-v2", lane.key()]
 */
export function findLaneVaultAuthorityPda(
  lane: PublicKey,
  programId?: PublicKey
): [PublicKey, number] {
  const pid = programId || getV2ProgramId();
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lane-vault-authority-v2'), lane.toBuffer()],
    pid
  );
}

/**
 * Find Trade PDA
 * Seeds: [b"trade-v2", creator, trade_id.to_le_bytes()]
 */
export function findTradePda(
  creator: PublicKey,
  tradeId: number,
  programId?: PublicKey
): [PublicKey, number] {
  const pid = programId || getV2ProgramId();
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('trade-v2'),
      creator.toBuffer(),
      new BN(tradeId).toArrayLike(Buffer, 'le', 8),
    ],
    pid
  );
}

/**
 * Find Escrow PDA
 * Seeds: [b"escrow-v2", trade.key()]
 */
export function findEscrowPda(
  trade: PublicKey,
  programId?: PublicKey
): [PublicKey, number] {
  const pid = programId || getV2ProgramId();
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow-v2'), trade.toBuffer()],
    pid
  );
}

/**
 * Find Vault Authority PDA (for Trade Escrow)
 * Seeds: [b"vault-authority-v2", escrow.key()]
 */
export function findVaultAuthorityPda(
  escrow: PublicKey,
  programId?: PublicKey
): [PublicKey, number] {
  const pid = programId || getV2ProgramId();
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority-v2'), escrow.toBuffer()],
    pid
  );
}

/**
 * Derive all lane-related PDAs at once
 */
export function deriveLanePdas(
  merchant: PublicKey,
  laneId: number,
  programId?: PublicKey
) {
  const [lanePda, laneBump] = findLanePda(merchant, laneId, programId);
  const [laneVaultAuthority, vaultBump] = findLaneVaultAuthorityPda(lanePda, programId);

  return {
    lanePda,
    laneBump,
    laneVaultAuthority,
    vaultBump,
  };
}

/**
 * Derive all trade-related PDAs at once
 */
export function deriveTradePdas(
  creator: PublicKey,
  tradeId: number,
  programId?: PublicKey
) {
  const [tradePda, tradeBump] = findTradePda(creator, tradeId, programId);
  const [escrowPda, escrowBump] = findEscrowPda(tradePda, programId);
  const [vaultAuthority, vaultBump] = findVaultAuthorityPda(escrowPda, programId);

  return {
    tradePda,
    tradeBump,
    escrowPda,
    escrowBump,
    vaultAuthority,
    vaultBump,
  };
}
