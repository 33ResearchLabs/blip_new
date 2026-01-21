/**
 * Escrow utilities for Settle app
 * Using Blip Protocol V2.2 for on-chain escrow
 */

import {
  Connection,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  Keypair,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';

// Re-export v2 SDK
export * from './v2';

// Legacy exports for backwards compatibility
export const USDT_DEVNET_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');
export const USDT_MAINNET_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
export const DEVNET_RPC = 'https://api.devnet.solana.com';

// Get connection
export function getConnection(network: 'devnet' | 'mainnet-beta' = 'devnet'): Connection {
  const endpoint = network === 'devnet' ? DEVNET_RPC : 'https://api.mainnet-beta.solana.com';
  return new Connection(endpoint, 'confirmed');
}

// Get USDT mint for network (legacy compatibility)
export function getLegacyUsdtMint(network: 'devnet' | 'mainnet-beta' = 'devnet'): PublicKey {
  return network === 'devnet' ? USDT_DEVNET_MINT : USDT_MAINNET_MINT;
}

// Escrow status
export type EscrowStatus = 'pending' | 'funded' | 'releasing' | 'released' | 'refunded' | 'disputed';

// Escrow data structure (off-chain tracking)
export interface EscrowData {
  id: string;
  orderId: string;
  userWallet: string;
  merchantWallet: string;
  escrowWallet: string; // This is now the on-chain escrow PDA
  tradePda?: string; // On-chain trade PDA
  tradeId?: number; // On-chain trade ID
  laneId?: number; // On-chain lane ID
  amount: number;
  currency: string;
  status: EscrowStatus;
  depositTxHash: string | null;
  releaseTxHash: string | null;
  createdAt: Date;
  fundedAt: Date | null;
  releasedAt: Date | null;
}

// Get USDT balance for a wallet
export async function getUsdtBalance(
  connection: Connection,
  wallet: PublicKey,
  network: 'devnet' | 'mainnet-beta' = 'devnet'
): Promise<number> {
  const usdtMint = getLegacyUsdtMint(network);

  try {
    const ata = await getAssociatedTokenAddress(usdtMint, wallet);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1_000_000;
  } catch {
    return 0;
  }
}

// Alias for backwards compatibility
export const getUsdcBalance = getUsdtBalance;

// Verify a transaction on-chain
export async function verifyTransaction(
  connection: Connection,
  txHash: string
): Promise<{ confirmed: boolean; slot?: number; err?: string }> {
  try {
    const status = await connection.getSignatureStatus(txHash);

    if (!status.value) {
      return { confirmed: false, err: 'Transaction not found' };
    }

    if (status.value.err) {
      return { confirmed: false, err: JSON.stringify(status.value.err) };
    }

    if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
      return { confirmed: true, slot: status.value.slot ?? undefined };
    }

    return { confirmed: false, err: 'Transaction not yet confirmed' };
  } catch (error) {
    return { confirmed: false, err: (error as Error).message };
  }
}

// Wait for transaction confirmation
export async function waitForConfirmation(
  connection: Connection,
  txHash: string,
  timeout: number = 60000
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await verifyTransaction(connection, txHash);
    if (result.confirmed) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return false;
}

// Generate a unique trade ID based on timestamp and random number
export function generateTradeId(): number {
  // Use timestamp (last 6 digits) + random (4 digits) to create unique ID
  const timestamp = Date.now() % 1_000_000;
  const random = Math.floor(Math.random() * 10000);
  return timestamp * 10000 + random;
}

// Generate a unique lane ID based on timestamp
export function generateLaneId(): number {
  // Use timestamp (last 8 digits) for lane ID
  return Date.now() % 100_000_000;
}

// Convert USDT amount to token units (6 decimals)
export function toTokenUnits(amount: number): BN {
  return new BN(Math.floor(amount * 1_000_000));
}

// Convert token units to USDT amount
export function fromTokenUnits(units: BN | number): number {
  const value = typeof units === 'number' ? units : units.toNumber();
  return value / 1_000_000;
}

// Request SOL airdrop (devnet only)
export async function requestAirdrop(
  connection: Connection,
  wallet: PublicKey,
  amount: number = 1 // SOL
): Promise<string> {
  const signature = await connection.requestAirdrop(wallet, amount * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature);
  return signature;
}

// Generate a new keypair (for testing)
export function generateKeypair(): { publicKey: string; secretKey: Uint8Array } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

// Alias for backwards compatibility
export const generateEscrowWallet = generateKeypair;
