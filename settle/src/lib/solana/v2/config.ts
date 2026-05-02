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

// Devnet RPC. Browser uses the `/api/rpc` proxy so the keyed upstream URL
// is never shipped to clients. Server uses SOLANA_RPC_URL_PRIVATE (preferred)
// or the legacy NEXT_PUBLIC_SOLANA_RPC_URL fallback. See src/lib/solana/rpc.ts
// for the canonical resolver and src/app/api/rpc/route.ts for the proxy.
//
// Solana's `Connection` constructor rejects relative URLs ("Endpoint URL
// must start with `http:` or `https:`."), so the browser path resolves the
// proxy path against `window.location.origin` to produce an absolute URL.
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
  return 'https://api.devnet.solana.com';
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
 */
export const DEVNET_WS_ENDPOINT = (() => {
  if (typeof window !== 'undefined') {
    const override = process.env.NEXT_PUBLIC_SOLANA_WS_URL?.trim();
    if (override && /^wss?:\/\//i.test(override)) return override;
    return 'wss://api.devnet.solana.com';
  }
  const wsServer = process.env?.SOLANA_WS_URL?.trim();
  if (wsServer && /^wss?:\/\//i.test(wsServer)) return wsServer;
  return 'wss://api.devnet.solana.com';
})();

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
