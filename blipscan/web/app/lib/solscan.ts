/**
 * Solscan link helpers — cluster is selected by NEXT_PUBLIC_SOLANA_NETWORK
 * ('devnet' | 'mainnet-beta' | 'mainnet'). Mainnet Solscan needs no cluster
 * query param, devnet does.
 */

const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet').toLowerCase();
const IS_MAINNET = NETWORK === 'mainnet-beta' || NETWORK === 'mainnet';

const SUFFIX = IS_MAINNET ? '' : '?cluster=devnet';

export const solscanTx = (signature: string) =>
  `https://solscan.io/tx/${signature}${SUFFIX}`;

export const solscanAccount = (address: string) =>
  `https://solscan.io/account/${address}${SUFFIX}`;
