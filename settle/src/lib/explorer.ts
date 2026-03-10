const BLIPSCAN_BASE = process.env.NEXT_PUBLIC_BLIPSCAN_URL ?? 'http://localhost:3001';
const SOLSCAN_BASE = 'https://solscan.io';

export function getSolscanTxUrl(txHash: string): string {
  return `${SOLSCAN_BASE}/tx/${txHash}`;
}

export function getBlipscanTradeUrl(escrowPda: string): string {
  return `${BLIPSCAN_BASE}/trade/${escrowPda}`;
}
