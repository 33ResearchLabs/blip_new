// Explorer URL helpers. `BLIPSCAN_BASE` prefers a deployed
// blipscan instance (via NEXT_PUBLIC_BLIPSCAN_URL) and falls back to
// Solscan so prod links never 404 while the real blipscan is being built.
const SOLSCAN_BASE = 'https://solscan.io';
const BLIPSCAN_BASE = process.env.NEXT_PUBLIC_BLIPSCAN_URL ?? SOLSCAN_BASE;
const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
const SOLSCAN_CLUSTER = NETWORK === 'mainnet-beta' ? '' : `?cluster=${NETWORK}`;

export function getSolscanTxUrl(txHash: string): string {
  return `${SOLSCAN_BASE}/tx/${txHash}${SOLSCAN_CLUSTER}`;
}

export function getBlipscanTradeUrl(escrowPda: string): string {
  // If BLIPSCAN_BASE is Solscan (fallback), render as an account link; if
  // it's a real blipscan host, use its /trade/ schema.
  if (BLIPSCAN_BASE === SOLSCAN_BASE) {
    return `${SOLSCAN_BASE}/account/${escrowPda}${SOLSCAN_CLUSTER}`;
  }
  return `${BLIPSCAN_BASE}/trade/${escrowPda}`;
}
