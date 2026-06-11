// Shared types + theming tokens for the Trading Limits experience, used by both
// the user app (LimitsScreen) and the merchant Settings → Limits tab.
//
// Theming note: text (`text-text-*`), border (`border-border-*`), status, and
// accent tokens are defined per-theme in BOTH globals.css (:root / [data-theme])
// and user-theme.css (.user-scope), so those classes are identical across apps.
// The ONLY divergence is surface backgrounds: `--color-surface-*` exists only in
// `.user-scope`, while the merchant app uses `--card` / raw `white/[…]` (remapped
// for light themes by the globals.css shim). So we parameterize surfaces by
// variant via SURFACES below and share everything else.

export type LimitsVariant = "user" | "merchant";
export type RequestKind = "daily" | "per_transaction";

export interface CoinTier {
  dailyUsd: number;
  perTradeUsd: number;
  costCoins: number;
  requiresKyc: number;
}

export interface LimitsMe {
  effective?: {
    dailyUsd?: number;
    perTradeUsd?: number;
    source?: string;
    kycLevel?: number;
    reputationMultiplier?: number;
    reputationTier?: string | null;
    verifications?: { phone: boolean; liveness: boolean };
  };
  trailing_24h_usd?: number;
  largest_trade_24h_usd?: number;
  headroom_usd?: number;
  base?: { dailyUsd: number; perTradeUsd: number };
  tiers?: Record<string, CoinTier>;
  buy?: { limitUsd: number; usedUsd: number } | null;
  sell?: { limitUsd: number; usedUsd: number } | null;
  verifications?: { phone: boolean; liveness: boolean; x: boolean };
  reputation?: { tier: string | null; multiplier: number };
  unsuccessful_24h?: number;
  decrease_alert?: boolean;
}

export interface LimitRequest {
  id: string;
  kind: RequestKind;
  current_limit_usd: string;
  requested_limit_usd: string;
  status: "pending" | "approved" | "rejected";
  reason?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface XVerif {
  x_username: string;
  verified_at: string;
}

export interface CoinBalance {
  balance?: number;
  locked?: number;
}

/** Surface background classes — the only per-variant theming divergence. */
export interface SurfaceTokens {
  /** Outer card background. */
  card: string;
  /** Inset panel (inside a card / modal). */
  inset: string;
  /** Small chip / icon-circle background. */
  chip: string;
  /** Hover state for interactive rows. */
  hover: string;
  /** Opaque full-screen page background (for the Stake USDT overlay). */
  screen: string;
}

export const SURFACES: Record<LimitsVariant, SurfaceTokens> = {
  user: {
    card: "bg-surface-card",
    inset: "bg-surface-base",
    chip: "bg-surface-active",
    hover: "hover:bg-surface-hover",
    screen: "bg-surface-base",
  },
  merchant: {
    card: "bg-white/[0.02]",
    inset: "bg-white/[0.02]",
    chip: "bg-white/[0.04]",
    hover: "hover:bg-white/[0.06]",
    screen: "bg-background",
  },
};

/**
 * Distinct per-action CTA colors from the mockup (green Verify, violet Liveness,
 * amber Stake, blue Trade). Uses arbitrary hex values on purpose:
 *  - `violet` is only referenced here, so the named Tailwind utility wasn't
 *    being generated (the icon/button rendered colorless); arbitrary values are
 *    always emitted regardless of palette scanning.
 *  - `text-[#fff]` (not `text-white`) escapes the user-light / merchant-light
 *    `text-white` → dark remap, so button labels stay legible on the saturated
 *    fill in every theme. Amber is light, so it pairs with dark text.
 */
export const ACTION_BTN: Record<"green" | "violet" | "amber" | "blue", string> =
  {
    green: "bg-[#10b981] hover:bg-[#0ea372] text-[#ffffff]",
    violet: "bg-[#8b5cf6] hover:bg-[#7c4ddb] text-[#ffffff]",
    amber: "bg-[#f59e0b] hover:bg-[#e08e09] text-[#1a1a1a]",
    blue: "bg-[#3b82f6] hover:bg-[#2f77ec] text-[#ffffff]",
  };

/** Soft tinted icon backgrounds matching each action color (arbitrary hex so
 *  the violet tint actually renders; /15 reads cleanly on light + dark). */
export const ACTION_ICON: Record<"green" | "violet" | "amber" | "blue", string> =
  {
    green: "bg-[#10b981]/15 text-[#10b981]",
    violet: "bg-[#8b5cf6]/15 text-[#8b5cf6]",
    amber: "bg-[#f59e0b]/15 text-[#d97706]",
    blue: "bg-[#3b82f6]/15 text-[#3b82f6]",
  };
