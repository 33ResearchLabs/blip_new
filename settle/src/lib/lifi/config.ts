/**
 * LI.FI cross-chain bridge integration config.
 *
 * Single source of truth for our integrator identity, fee rate, and the
 * list of source chains we surface in the cross-chain deposit UI. Every
 * quote call goes through `getCrossChainQuote()` and reads from here so
 * the % and integrator name can never drift across surfaces.
 *
 * Heads-up on fee maths: LI.FI keeps 25 bps of whatever you collect.
 * `BLIP_GROSS_FEE` is set to ~1.33% so the net Blip cut after their
 * commission lands at roughly 1% per the product spec. The UI shows
 * the gross figure (what the user actually pays) so users see a
 * single transparent line.
 */

export const LIFI_INTEGRATOR_ID = 'Blip-merchant';

/** Gross fee passed to LI.FI as the `fee` parameter (decimal fraction).
 *  LI.FI keeps 25 bps → Blip net is ~1.00%. */
export const BLIP_GROSS_FEE = 0.0133;

/** Display string for the gross fee — used in copy. Rounded for UX. */
export const BLIP_GROSS_FEE_LABEL = '1.33%';

export const LIFI_API_BASE = 'https://li.quest/v1';

/** Source chains we expose in the "Deposit from another chain" flow.
 *  Solana is intentionally absent — that's the destination. TRON is
 *  marked `comingSoon` because it needs the TronLink wallet adapter
 *  before we can sign on the source side. */
export interface ChainOption {
  /** LI.FI chain id (number for EVM, string slug for non-EVM). */
  id: number | string;
  label: string;
  symbol: string;
  flag: string;
  /** Set true when source-side signing isn't wired yet — the UI shows
   *  the row as a teaser ("Coming soon") and disables the picker. */
  comingSoon?: boolean;
  /** Typical settlement window for THIS source chain → Solana. Surfaced
   *  on the quote screen so users see the real ETA before confirming. */
  etaLabel: string;
}

export const SOURCE_CHAINS: ChainOption[] = [
  { id: 1,          label: 'Ethereum',  symbol: 'ETH',  flag: '🔷', etaLabel: '~30s' },
  { id: 8453,       label: 'Base',      symbol: 'BASE', flag: '🔵', etaLabel: '~30s' },
  { id: 42161,      label: 'Arbitrum',  symbol: 'ARB',  flag: '🌀', etaLabel: '~30s' },
  { id: 10,         label: 'Optimism',  symbol: 'OP',   flag: '🔴', etaLabel: '~30s' },
  { id: 137,        label: 'Polygon',   symbol: 'MATIC',flag: '🟣', etaLabel: '~1 min' },
  { id: 56,         label: 'BSC',       symbol: 'BNB',  flag: '🟡', etaLabel: '~1 min' },
  { id: 43114,      label: 'Avalanche', symbol: 'AVAX', flag: '🔺', etaLabel: '~1 min' },
  // TRON: LI.FI routes through Allbridge under the hood. Disabled in v1
  // until the TronLink wallet adapter is integrated on the source side.
  { id: 'TRX',      label: 'TRON',      symbol: 'TRX',  flag: '🔴', etaLabel: '~1–5 min', comingSoon: true },
];

/** Solana chain id in LI.FI's catalog. */
export const SOLANA_CHAIN_ID = 1151111081099710;

/** USDT contract addresses on each supported source chain. Used as the
 *  `fromToken` for the cross-chain deposit quote. Destination is always
 *  USDT on Solana. */
export const USDT_BY_CHAIN: Record<number | string, string> = {
  1:     '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum
  8453:  '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // Base
  42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum
  10:    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // Optimism
  137:   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
  56:    '0x55d398326f99059fF775485246999027B3197955', // BSC (USDT-BEP20)
  43114: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // Avalanche
  TRX:   'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',        // TRON USDT (TRC20)
};

/** USDT on Solana (SPL token mint). */
export const USDT_SOLANA = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
