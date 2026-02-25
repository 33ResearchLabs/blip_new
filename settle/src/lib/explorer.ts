// Centralized explorer URL helpers — one source of truth for all components

const BLIPSCAN_URL = process.env.NEXT_PUBLIC_BLIPSCAN_URL || 'http://localhost:3002';
const SOLANA_NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

function clusterParam(): string {
  return SOLANA_NETWORK === 'mainnet-beta' ? '' : `?cluster=${SOLANA_NETWORK}`;
}

/** BlipScan trade page — takes escrow PDA */
export function getBlipscanTradeUrl(escrowPda: string): string {
  return `${BLIPSCAN_URL}/trade/${escrowPda}`;
}

/** BlipScan merchant profile page */
export function getBlipscanMerchantUrl(pubkey: string): string {
  return `${BLIPSCAN_URL}/merchant/${pubkey}`;
}

/** Solscan TX link — for on-chain verification */
export function getSolscanTxUrl(txHash: string): string {
  return `https://solscan.io/tx/${txHash}${clusterParam()}`;
}
