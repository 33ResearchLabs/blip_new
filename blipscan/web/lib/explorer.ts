/**
 * Network-aware Solscan URL builder for the blipscan web UI.
 *
 * Reads NEXT_PUBLIC_SOLANA_NETWORK at build time. Defaults to devnet so
 * local dev keeps showing devnet links if no env is set.
 *
 * Solscan URL conventions:
 *   mainnet → no cluster query param needed (default cluster)
 *   devnet  → ?cluster=devnet
 *   testnet → ?cluster=testnet
 */

export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet';

function getNetwork(): SolanaNetwork {
  const v =
    typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_SOLANA_NETWORK
      : undefined;
  if (v === 'devnet') return 'devnet';
  if (v === 'testnet') return 'testnet';
  return 'mainnet-beta';
}

export function isMainnet(): boolean {
  return getNetwork() === 'mainnet-beta';
}

export function networkLabel(): string {
  const n = getNetwork();
  if (n === 'mainnet-beta') return 'Mainnet';
  if (n === 'testnet') return 'Testnet';
  return 'Devnet';
}

/** ?cluster=… suffix for explorer URLs (empty string on mainnet). */
export function clusterSuffix(): string {
  const n = getNetwork();
  return n === 'mainnet-beta' ? '' : `?cluster=${n}`;
}

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}${clusterSuffix()}`;
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}${clusterSuffix()}`;
}

export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}${clusterSuffix()}`;
}
