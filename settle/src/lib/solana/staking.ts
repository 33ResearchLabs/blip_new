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
const CONFIG_DISC = Buffer.from([238, 151, 43, 3, 11, 151, 63, 176]);
const SLASH_DISC = Buffer.from([204, 141, 18, 161, 8, 177, 92, 142]);
const CHARGE_DISC = Buffer.from([26, 55, 197, 209, 93, 77, 242, 15]);

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

/**
 * Build the on-chain `unstake(amount)` instruction. amount is in base units (1e6).
 * `treasuryOwner` is the protocol authority (early-unstake 10% fee destination);
 * read it via readStakeAuthority(). Unstaking before the 30-day lock charges 10%.
 */
export function buildUnstakeInstruction(params: {
  staker: PublicKey;
  amountBaseUnits: bigint;
  mint: PublicKey;
  treasuryOwner: PublicKey;
}): TransactionInstruction {
  const config = stakeConfigPda();
  const position = stakePositionPda(params.staker);
  const vaultAuthority = stakeVaultAuthorityPda();
  const vault = stakeVaultAta(params.mint);
  const stakerAta = getAssociatedTokenAddressSync(params.mint, params.staker);
  const treasuryAta = getAssociatedTokenAddressSync(params.mint, params.treasuryOwner);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      { pubkey: params.staker, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: stakerAta, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([UNSTAKE_DISC, u64le(params.amountBaseUnits)]),
  });
}

/**
 * Build the authority-only `slash(amount)` instruction. Seizes `amountBaseUnits`
 * from `stakerToSlash`'s bond and sends it to `recipient`'s token account (the
 * wronged counterparty or treasury). Signer MUST be the on-chain config authority
 * (arbiter/compliance) or the program rejects it.
 */
export function buildSlashInstruction(params: {
  authority: PublicKey;
  stakerToSlash: PublicKey;
  amountBaseUnits: bigint;
  mint: PublicKey;
  recipient: PublicKey;
}): TransactionInstruction {
  const config = stakeConfigPda();
  const position = stakePositionPda(params.stakerToSlash);
  const vaultAuthority = stakeVaultAuthorityPda();
  const vault = stakeVaultAta(params.mint);
  const recipientAta = getAssociatedTokenAddressSync(params.mint, params.recipient);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([SLASH_DISC, u64le(params.amountBaseUnits)]),
  });
}

/**
 * Build the authority-only `charge(amount)` instruction — debits a fee/subscription
 * from `stakerToCharge`'s bond to the treasury (`treasuryOwner` must equal the
 * on-chain config authority). For protocol revenue (subscriptions, service fees).
 */
export function buildChargeInstruction(params: {
  authority: PublicKey;
  stakerToCharge: PublicKey;
  amountBaseUnits: bigint;
  mint: PublicKey;
  treasuryOwner: PublicKey;
}): TransactionInstruction {
  const config = stakeConfigPda();
  const position = stakePositionPda(params.stakerToCharge);
  const vaultAuthority = stakeVaultAuthorityPda();
  const vault = stakeVaultAta(params.mint);
  const treasuryAta = getAssociatedTokenAddressSync(params.mint, params.treasuryOwner);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([CHARGE_DISC, u64le(params.amountBaseUnits)]),
  });
}

/** Read the protocol authority (treasury owner) from the on-chain StakeConfig. */
export async function readStakeAuthority(connection: Connection): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(stakeConfigPda());
  if (!info || info.data.length < 40 || !info.data.subarray(0, 8).equals(CONFIG_DISC)) return null;
  // layout: [0..8] disc, [8..40] authority
  return new PublicKey(info.data.subarray(8, 40));
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
