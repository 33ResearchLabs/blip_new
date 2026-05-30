import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Find Protocol Config PDA
 */
export function findProtocolConfigPda(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    programId
  );
}

/**
 * Find Trade PDA
 */
export function findTradePda(
  creator: PublicKey,
  tradeId: BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("trade-v2"),
      creator.toBuffer(),
      tradeId.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Find Escrow PDA
 */
export function findEscrowPda(
  trade: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow-v2"), trade.toBuffer()],
    programId
  );
}

/**
 * Find Vault Authority PDA
 */
export function findVaultAuthorityPda(
  escrow: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority-v2"), escrow.toBuffer()],
    programId
  );
}

/**
 * Find OfferFill PDA (replay protection)
 */
export function findOfferFillPda(
  offerHash: Uint8Array | Buffer,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("offer-fill"), Buffer.from(offerHash)],
    programId
  );
}

/**
 * V2.2: Find Lane PDA
 */
export function findLanePda(
  merchant: PublicKey,
  laneId: BN | number,
  programId: PublicKey
): [PublicKey, number] {
  const laneIdBN = laneId instanceof BN ? laneId : new BN(laneId);
  const laneIdBuffer = laneIdBN.toArrayLike(Buffer, "le", 8);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("lane-v2"), merchant.toBuffer(), laneIdBuffer],
    programId
  );
}

/**
 * V2.2: Find Lane Vault Authority PDA
 */
export function findLaneVaultAuthorityPda(
  lane: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lane-vault-authority-v2"), lane.toBuffer()],
    programId
  );
}

/**
 * Get vault ATA address (Associated Token Account for vault authority)
 */
export async function getVaultAtaAddress(
  vaultAuthority: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  const [ata] = await PublicKey.findProgramAddress(
    [
      vaultAuthority.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// Constants
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
