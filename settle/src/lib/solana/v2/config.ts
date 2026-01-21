/**
 * Blip Protocol V2.2 Configuration for Settle App
 */

import { PublicKey } from '@solana/web3.js';

// V2.2 Program ID (deployed to devnet)
export const BLIP_V2_PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');

// V1 Program ID (legacy)
export const BLIP_V1_PROGRAM_ID = new PublicKey('5ggyzySMndginf1msqRXNz9ZmKP8pNLtAQVnVo8PiAX');

// USDT Mint on Devnet (custom test token)
export const USDT_DEVNET_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');

// USDT Mint on Mainnet
export const USDT_MAINNET_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Treasury wallet for protocol fees
export const TREASURY_WALLET = new PublicKey('8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB');

// Fee basis points (2.5% = 250 bps)
export const FEE_BPS = 250;

// Devnet RPC
export const DEVNET_RPC = 'https://api.devnet.solana.com';

// Compliance/DAO wallets for dispute resolution
// These wallets have authority to release or refund escrow in disputed orders
// In production, this would be a multi-sig or DAO-controlled wallet
export const COMPLIANCE_WALLETS: PublicKey[] = [
  // Placeholder - user will provide actual compliance wallet addresses
  // new PublicKey('YOUR_COMPLIANCE_WALLET_HERE'),
];

// Environment variable override for compliance wallets
const envComplianceWallets = process.env.NEXT_PUBLIC_COMPLIANCE_WALLETS;
if (envComplianceWallets) {
  try {
    const wallets = envComplianceWallets.split(',').map(w => new PublicKey(w.trim()));
    COMPLIANCE_WALLETS.push(...wallets);
  } catch (e) {
    console.warn('Invalid NEXT_PUBLIC_COMPLIANCE_WALLETS format:', e);
  }
}

/**
 * Check if a wallet is authorized as compliance
 */
export function isComplianceWallet(wallet: PublicKey | string): boolean {
  const walletStr = typeof wallet === 'string' ? wallet : wallet.toBase58();
  return COMPLIANCE_WALLETS.some(w => w.toBase58() === walletStr);
}

/**
 * Add a compliance wallet dynamically (for testing/admin)
 */
export function addComplianceWallet(wallet: PublicKey | string): void {
  const pubkey = typeof wallet === 'string' ? new PublicKey(wallet) : wallet;
  if (!isComplianceWallet(pubkey)) {
    COMPLIANCE_WALLETS.push(pubkey);
  }
}

/**
 * Get the V2.2 program ID
 */
export function getV2ProgramId(): PublicKey {
  return BLIP_V2_PROGRAM_ID;
}

/**
 * Get the USDT mint for the specified network
 */
export function getUsdtMint(network: 'devnet' | 'mainnet-beta' = 'devnet'): PublicKey {
  return network === 'devnet' ? USDT_DEVNET_MINT : USDT_MAINNET_MINT;
}

/**
 * Get the treasury wallet
 */
export function getFeeTreasury(): PublicKey {
  return TREASURY_WALLET;
}

/**
 * Get the fee in basis points
 */
export function getFeeBps(): number {
  return FEE_BPS;
}
