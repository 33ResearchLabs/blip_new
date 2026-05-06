/**
 * Blip Protocol V2 Configuration for Settle App
 *
 * Network selection is env-driven so the same code targets devnet (testing)
 * or mainnet (production):
 *   NEXT_PUBLIC_SOLANA_NETWORK = 'devnet' | 'mainnet-beta'
 *   NEXT_PUBLIC_ANCHOR_PROGRAM_ID = on-chain program ID for the chosen network
 *   NEXT_PUBLIC_TREASURY_WALLET   = treasury pubkey (where fees flow)
 *   NEXT_PUBLIC_PROTOCOL_CONFIG_PDA = ProtocolConfig PDA (derived from program ID)
 *   NEXT_PUBLIC_FEE_BPS_DEFAULT   = default tier in basis points (200 = 2%)
 *   NEXT_PUBLIC_FEE_BPS_MIN       = cheap tier (150 = 1.5%)
 *   NEXT_PUBLIC_FEE_BPS_MAX       = fastest tier (250 = 2.5%)
 */

import { PublicKey } from '@solana/web3.js';

// Devnet defaults — used when env vars unset (e.g. local dev without .env.local).
const DEVNET_PROGRAM_ID = '6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87';
const DEVNET_TREASURY = '8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB';

// Mainnet v1.0 deploy (2026-04-27) — used when NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
// and the corresponding NEXT_PUBLIC_* vars are unset. Hard-coded as a safety net.
const MAINNET_PROGRAM_ID = 'gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS';
const MAINNET_TREASURY = 'D3oNcCQ7yareg3UkzK7AQ4qk8oax9AbkZFVJcakD9vSP';
const MAINNET_PROTOCOL_CONFIG_PDA = '2K1ucbvLoS3S7H8Ft8dsLbmxo39pmwnGY4WRN9R8KJL9';

const NETWORK = (typeof process !== 'undefined'
  && process.env?.NEXT_PUBLIC_SOLANA_NETWORK) || 'devnet';

const isMainnet = NETWORK === 'mainnet-beta' || NETWORK === 'mainnet';

// V2 Program ID — env override > network default.
export const BLIP_V2_PROGRAM_ID = new PublicKey(
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ANCHOR_PROGRAM_ID)
    || (isMainnet ? MAINNET_PROGRAM_ID : DEVNET_PROGRAM_ID)
);

// V1 Program ID (legacy, devnet-only)
export const BLIP_V1_PROGRAM_ID = new PublicKey('5ggyzySMndginf1msqRXNz9ZmKP8pNLtAQVnVo8PiAX');

// USDT mints
export const USDT_DEVNET_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');
export const USDT_MAINNET_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Treasury wallet (env override > network default)
export const TREASURY_WALLET = new PublicKey(
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TREASURY_WALLET)
    || (isMainnet ? MAINNET_TREASURY : DEVNET_TREASURY)
);

// ProtocolConfig PDA — env override > mainnet default (devnet derives lazily).
// Set NEXT_PUBLIC_PROTOCOL_CONFIG_PDA to skip on-chain derivation.
export const PROTOCOL_CONFIG_PDA: PublicKey | null = (() => {
  const env = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PROTOCOL_CONFIG_PDA;
  if (env) return new PublicKey(env);
  if (isMainnet) return new PublicKey(MAINNET_PROTOCOL_CONFIG_PDA);
  return null; // devnet: derive lazily via PublicKey.findProgramAddressSync
})();

// Tiered fees (V2.3.1 — caller picks per trade in [min, max])
const parseBps = (envVal: string | undefined, fallback: number): number => {
  const n = envVal ? parseInt(envVal, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : fallback;
};

export const FEE_BPS_DEFAULT = parseBps(
  typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FEE_BPS_DEFAULT : undefined,
  isMainnet ? 200 : 250
);
export const FEE_BPS_MIN = parseBps(
  typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FEE_BPS_MIN : undefined,
  isMainnet ? 150 : 0
);
export const FEE_BPS_MAX = parseBps(
  typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FEE_BPS_MAX : undefined,
  isMainnet ? 250 : 500
);

/**
 * @deprecated Use FEE_BPS_DEFAULT (or caller-chosen tier in [FEE_BPS_MIN, FEE_BPS_MAX]).
 * Kept for backwards compatibility with existing call sites.
 */
export const FEE_BPS = FEE_BPS_DEFAULT;

// RPC — env-driven. Public Solana RPC is rate-limited; production should use
// Helius/QuickNode/Triton via NEXT_PUBLIC_SOLANA_RPC_URL.
export const DEVNET_RPC =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SOLANA_RPC_URL)
    || (isMainnet ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

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
 * Get the USDT mint for the specified network. Defaults to the active network
 * (read from NEXT_PUBLIC_SOLANA_NETWORK).
 */
export function getUsdtMint(network?: 'devnet' | 'mainnet-beta' | 'mainnet'): PublicKey {
  const target = network || (isMainnet ? 'mainnet-beta' : 'devnet');
  return target === 'devnet' ? USDT_DEVNET_MINT : USDT_MAINNET_MINT;
}

/**
 * Whether the app is currently configured for mainnet.
 */
export function isMainnetActive(): boolean {
  return isMainnet;
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
