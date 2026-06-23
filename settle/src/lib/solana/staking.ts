/**
 * Client SDK for the on-chain blip_staking program.
 *
 * Instructions are built by hand (discriminator + borsh u64) so this works in
 * both the browser (wallet flow) and Node (sync endpoint) with no Anchor
 * runtime / IDL-version dependency. Discriminators + account order are taken
 * from target/idl/blip_staking.json.
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const STAKING_PROGRAM_ID = new PublicKey(
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_STAKING_PROGRAM_ID) ||
    "3HFY7MGj5uNteEGwVH2kPPWoYQPicncMG85dqK5P3wUX",
);

const CONFIG_SEED = Buffer.from("stake-config");
const POSITION_SEED = Buffer.from("stake");
const VAULT_AUTHORITY_SEED = Buffer.from("stake-vault-authority");

// From the IDL.
const STAKE_DISC = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);
const UNSTAKE_DISC = Buffer.from([90, 95, 107, 42, 205, 124, 50, 225]);
const POSITION_DISC = Buffer.from([78, 165, 30, 111, 171, 125, 11, 220]);

export function stakeConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], STAKING_PROGRAM_ID)[0];
}
export function stakeVaultAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED], STAKING_PROGRAM_ID)[0];
}
export function stakePositionPda(staker: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, staker.toBuffer()],
    STAKING_PROGRAM_ID,
  )[0];
}
export function stakeVaultAta(mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, stakeVaultAuthorityPda(), true);
}

function u64le(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

/** Build the on-chain `stake(amount)` instruction. amount is in base units (1e6). */
export function buildStakeInstruction(params: {
  staker: PublicKey;
  amountBaseUnits: bigint;
  mint: PublicKey;
}): TransactionInstruction {
  const config = stakeConfigPda();
  const position = stakePositionPda(params.staker);
  const vault = stakeVaultAta(params.mint);
  const stakerAta = getAssociatedTokenAddressSync(params.mint, params.staker);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      { pubkey: params.staker, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: stakerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([STAKE_DISC, u64le(params.amountBaseUnits)]),
  });
}

/** Build the on-chain `unstake(amount)` instruction. amount is in base units (1e6). */
export function buildUnstakeInstruction(params: {
  staker: PublicKey;
  amountBaseUnits: bigint;
  mint: PublicKey;
}): TransactionInstruction {
  const config = stakeConfigPda();
  const position = stakePositionPda(params.staker);
  const vaultAuthority = stakeVaultAuthorityPda();
  const vault = stakeVaultAta(params.mint);
  const stakerAta = getAssociatedTokenAddressSync(params.mint, params.staker);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      { pubkey: params.staker, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: stakerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([UNSTAKE_DISC, u64le(params.amountBaseUnits)]),
  });
}

/**
 * Read the on-chain staked principal for a wallet, in whole USDT (6 decimals).
 * Returns 0 if no position exists. Used by the DB-sync endpoint.
 */
export async function readStakedAmountUsdt(
  connection: Connection,
  staker: PublicKey,
): Promise<number> {
  const info = await connection.getAccountInfo(stakePositionPda(staker));
  if (!info || info.data.length < 48) return 0;
  // layout: [0..8] disc, [8..40] staker, [40..48] amount u64 LE
  if (!info.data.subarray(0, 8).equals(POSITION_DISC)) return 0;
  const amount = info.data.readBigUInt64LE(40);
  return Number(amount) / 1_000_000;
}
