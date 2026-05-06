/**
 * Network-aware display helpers for the wallet/escrow UI.
 *
 * Single source of truth for any text or URL that depends on whether the app
 * is talking to devnet or mainnet-beta. Kept minimal — pulls from
 * `NEXT_PUBLIC_SOLANA_NETWORK` only, no other config.
 *
 * Anything user-facing that hardcoded "Devnet" should switch to one of these.
 */

export type SolanaNetwork = 'devnet' | 'mainnet-beta';

/** Read the active network from env, default to devnet for safety. */
export function getActiveNetwork(): SolanaNetwork {
  const v =
    typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_SOLANA_NETWORK
      : undefined;
  return v === 'mainnet-beta' || v === 'mainnet' ? 'mainnet-beta' : 'devnet';
}

/** True iff the app is configured for mainnet. */
export function isMainnet(): boolean {
  return getActiveNetwork() === 'mainnet-beta';
}

/**
 * Human-readable network label for display.
 *   "Solana Mainnet" or "Solana Devnet"
 */
export function networkLabel(prefix: 'Solana ' | '' = 'Solana '): string {
  return `${prefix}${isMainnet() ? 'Mainnet' : 'Devnet'}`;
}

/**
 * USDT label for the active network.
 *   mainnet → "USDT"
 *   devnet  → "Test USDT (Devnet)"
 *
 * Was previously hardcoded as "Fake USDT on Devnet" everywhere — that label
 * was wrong on mainnet and confusingly negative on devnet.
 */
export function usdtLabel(): string {
  return isMainnet() ? 'USDT' : 'Test USDT (Devnet)';
}

/**
 * URL query suffix for Solana Explorer links.
 *   mainnet → ''           (no cluster param needed)
 *   devnet  → '?cluster=devnet'
 */
export function explorerClusterParam(): string {
  return isMainnet() ? '' : '?cluster=devnet';
}

/**
 * Build a Solana Explorer URL for a tx or address, using the active cluster.
 *
 *   explorerUrl('tx', '5xY...')      → 'https://explorer.solana.com/tx/5xY...'   (mainnet)
 *   explorerUrl('address', 'D1M...') → 'https://explorer.solana.com/address/D1M...?cluster=devnet'  (devnet)
 */
export function explorerUrl(
  kind: 'tx' | 'address' | 'block',
  value: string,
): string {
  return `https://explorer.solana.com/${kind}/${value}${explorerClusterParam()}`;
}
