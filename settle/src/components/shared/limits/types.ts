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
 * Unlock-row CTA buttons — secondary style: subtle neutral tint
 * (`bg-border-subtle`, defined in both user + merchant scopes) with
 * `text-text-primary`. Reads as a button in both modes without stacking solid
 * white blocks in dark mode; the page keeps a single solid primary CTA
 * (Request Increase) for hierarchy. No accent/yellow tint. Tone keys kept so
 * callers don't change.
 */
export const ACTION_BTN: Record<"green" | "violet" | "amber" | "blue", string> =
  {
    green: "bg-border-subtle text-text-primary border border-border-subtle hover:bg-border-subtle/70",
    violet: "bg-border-subtle text-text-primary border border-border-subtle hover:bg-border-subtle/70",
    amber: "bg-border-subtle text-text-primary border border-border-subtle hover:bg-border-subtle/70",
    blue: "bg-border-subtle text-text-primary border border-border-subtle hover:bg-border-subtle/70",
  };

/** Unlock-row icon circles — subtle neutral tint (`bg-border-subtle`, defined in
 *  BOTH user and merchant scopes) with `text-text-primary` for the glyph. No
 *  accent/yellow tint, and no harsh pure-white disc in dark mode. */
export const ACTION_ICON: Record<"green" | "violet" | "amber" | "blue", string> =
  {
    green: "bg-border-subtle text-text-primary",
    violet: "bg-border-subtle text-text-primary",
    amber: "bg-border-subtle text-text-primary",
    blue: "bg-border-subtle text-text-primary",
  };
