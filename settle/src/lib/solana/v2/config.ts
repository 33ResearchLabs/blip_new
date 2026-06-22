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
// v3 deploy (2026-06-14): boxed-accounts build, full lifecycle verified.
const DEVNET_PROGRAM_ID = 'AzhunmkEJEBa7RBjhgwvax8WdKZGMfmF8EHbMG1a4ez8';
const DEVNET_TREASURY = 'K2WFxzYizWadkTeVqPGZ8Hx64pco7CeMbaP2CPy2pFp';

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

// USDT mints — env-overridable so the CA can be swapped without a code change.
//   NEXT_PUBLIC_USDT_DEVNET_MINT  / NEXT_PUBLIC_USDT_MAINNET_MINT
// Devnet default (2026-06-14): our own mint, authority = K2WFxz…, so we can
// mint test USDT to team wallets on demand.
export const USDT_DEVNET_MINT = new PublicKey(
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_USDT_DEVNET_MINT)
    || '5AzTK6KUfGT5yim4hwfbwcyf2wB5Aw72dxgKdBtCjdzn'
);
export const USDT_MAINNET_MINT = new PublicKey(
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_USDT_MAINNET_MINT)
    || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
);

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

// Tiered fees (V2.3.1 — caller picks per trade in [min, max]).
// Frontend exposes 3 tier buttons (1.5% / 2% / 2.5% on mainnet); on-chain
// program enforces values fall within the protocol's [min_fee_bps, max_fee_bps]
// range and hard-caps at 1000 bps (10%).
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

// RPC. Browser uses the `/api/rpc` proxy so the keyed upstream URL is
// never shipped to clients. Server uses SOLANA_RPC_URL_PRIVATE (preferred)
// or the legacy NEXT_PUBLIC_SOLANA_RPC_URL fallback. See src/lib/solana/rpc.ts
// for the canonical resolver and src/app/api/rpc/route.ts for the proxy.
//
// Network-aware fallback: `mainnet-beta` resolves to mainnet's public RPC
// when no env override is set; `devnet` (default) resolves to devnet.
//
// Solana's `Connection` constructor rejects relative URLs ("Endpoint URL
// must start with `http:` or `https:`."), so the browser path resolves the
// proxy path against `window.location.origin` to produce an absolute URL.
const PUBLIC_HTTP_FALLBACK = isMainnet
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';
const PUBLIC_WS_FALLBACK = isMainnet
  ? 'wss://api.mainnet-beta.solana.com'
  : 'wss://api.devnet.solana.com';

export const DEVNET_RPC = (() => {
  if (typeof window !== 'undefined') {
    const override = process.env.NEXT_PUBLIC_SOLANA_RPC_PROXY_URL?.trim();
    if (override && /^https?:\/\//i.test(override)) return override;
    // Default proxy path — make it absolute so `new Connection(...)` accepts it.
    const proxyPath = override || '/api/rpc';
    return `${window.location.origin}${proxyPath.startsWith('/') ? '' : '/'}${proxyPath}`;
  }
  const priv = process.env?.SOLANA_RPC_URL_PRIVATE?.trim();
  if (priv) return priv;
  const pub = process.env?.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (pub) return pub;
  return PUBLIC_HTTP_FALLBACK;
})();

/**
 * WebSocket endpoint for Solana subscriptions (account/signature watches).
 *
 * web3.js's `Connection` auto-derives a wsEndpoint from the http URL by
 * swapping the scheme. For our `/api/rpc` proxy that yields
 * `ws://<origin>/api/rpc` — which is NOT a websocket server, so the lib
 * surfaces "ws error: undefined" in the console every time
 * `confirmTransaction` (or any subscription path) opens a watch.
 *
 * We point the WS at a real public Solana endpoint instead. Subscriptions
 * only return public chain state, so there's no quota-leak concern in
 * sending them direct from the browser. The proxied http URL stays in front
 * of the keyed RPC for everything else.
 *
 * Network-aware: `mainnet-beta` -> wss://api.mainnet-beta.solana.com, else devnet.
 */
export const DEVNET_WS_ENDPOINT = (() => {
  if (typeof window !== 'undefined') {
    const override = process.env.NEXT_PUBLIC_SOLANA_WS_URL?.trim();
    if (override && /^wss?:\/\//i.test(override)) return override;
    return PUBLIC_WS_FALLBACK;
  }
  const wsServer = process.env?.SOLANA_WS_URL?.trim();
  if (wsServer && /^wss?:\/\//i.test(wsServer)) return wsServer;
  return PUBLIC_WS_FALLBACK;
})();

// Compliance/DAO wallets for dispute resolution
// These wallets have authority to release or refund escrow in disputed orders
// In production, this would be a multi-sig or DAO-controlled wallet
export const COMPLIANCE_WALLETS: PublicKey[] = [
  new PublicKey('5wA1UMxTdkypE4arpgckZPzA9Gv53QhUUw7dCm7tZYK2'),
  new PublicKey('AcptbLFa7CrUQFWG5BZr2iycZR2MQwprSbrrHUuAnyYM'),
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

// Cache-bust 20260506130748 — force Railway to rebuild settle bundle with current NEXT_PUBLIC_* env vars baked in.

