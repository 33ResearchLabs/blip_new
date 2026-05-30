"use client";

/**
 * Canonical 3-component fee breakdown for every trade / quote / checkout
 * surface in Blip. Renders:
 *
 *   Merchant rate    — liquidity quote
 *   Blip service fee — protocol fee (% of base amount)
 *   Boost            — optional "Priority Liquidity" incentive (%, may be 0)
 *   ─────────────────
 *   Final settlement amount
 *
 * Never display a single blended "fee" string elsewhere — funnel through
 * this component so the language and structure stay consistent. See
 * project_fee_ui.md memory for the full ruleset (e.g. "merchant rate" not
 * "spread", "service fee" not "fee", boost label "Priority Liquidity").
 */

import { Zap, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { formatRate } from "@/lib/format";

interface FeeBreakdownProps {
  /** Crypto amount the user is sending (USDT). */
  baseAmount: number;
  /** Live merchant rate (fiat per 1 crypto). null = not loaded. */
  merchantRate: number | null;
  /** Blip protocol/service fee, as a percentage of base amount. */
  blipFeePct: number;
  /** Optional Priority Liquidity boost, as a percentage. 0/undefined hides the row. */
  boostPct?: number;
  /** Fiat currency code, used for the final amount + rate label. */
  fiatCurrency: string;
  /** Crypto currency code (default "USDT"). */
  cryptoCurrency?: string;
  /** When true, body is collapsed to a single "Final amount" line with a
   *  chevron to expand. Useful in tight rows (e.g. order list cards). */
  collapsible?: boolean;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Testing promo: flat USDT discount applied to the order. */
  promoDiscountUsdt?: number;
  /** Label for the promo row (default: "Testing reward"). */
  promoLabel?: string;
}

export function FeeBreakdown({
  baseAmount,
  merchantRate,
  blipFeePct,
  boostPct = 0,
  fiatCurrency,
  cryptoCurrency = "USDT",
  collapsible = false,
  className = "",
  promoDiscountUsdt = 0,
  promoLabel = "Testing reward ($5 off)",
}: FeeBreakdownProps) {
  const [expanded, setExpanded] = useState(!collapsible);

  const grossFiat = merchantRate != null ? baseAmount * merchantRate : null;
  const blipFee = (baseAmount * blipFeePct) / 100;
  const boostFee = (baseAmount * boostPct) / 100;
  const totalCryptoCost = baseAmount + blipFee + boostFee;
  const preFiat = merchantRate != null ? totalCryptoCost * merchantRate : null;
  const promoDiscountFiat = merchantRate != null ? promoDiscountUsdt * merchantRate : 0;
  const finalFiat = preFiat != null ? Math.max(0, preFiat - promoDiscountFiat) : null;

  const fmt = (n: number, frac = 2) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    });

  return (
    <div
      className={`rounded-xl bg-white/[0.03] border border-white/[0.06] ${className}`}
    >
      {/* Header — always visible; expand affordance only when collapsible */}
      <button
        type="button"
        onClick={() => collapsible && setExpanded((v) => !v)}
        disabled={!collapsible}
        className={`w-full px-4 py-3 flex items-center justify-between gap-2 ${
          collapsible ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="flex items-center gap-2 text-[11px] font-medium text-foreground/80">
          <Zap className="w-3.5 h-3.5" />
          Final settlement amount
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground tabular-nums">
            {finalFiat != null ? `${fmt(finalFiat, 0)} ${fiatCurrency}` : "—"}
          </span>
          {collapsible &&
            (expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-foreground/40" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-foreground/40" />
            ))}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5 text-[11px]">
          <Row
            label="Merchant rate"
            value={
              merchantRate != null
                ? `${formatRate(merchantRate)} ${fiatCurrency} / ${cryptoCurrency}`
                : "—"
            }
          />
          <Row
            label="Blip service fee"
            value={`${blipFeePct.toFixed(2)}% · ${fmt(blipFee)} ${cryptoCurrency}`}
          />
          {boostPct > 0 && (
            <Row
              label="Priority Liquidity boost"
              value={`+${boostPct.toFixed(2)}% · ${fmt(boostFee)} ${cryptoCurrency}`}
              accent
            />
          )}
          {preFiat != null && (
            <div className="pt-1.5 mt-1 border-t border-white/[0.04] space-y-1.5">
              <Row label="Subtotal" value={`${fmt(preFiat)} ${fiatCurrency}`} muted />
              {promoDiscountUsdt > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-green-400/80">🎁 {promoLabel}</span>
                  <span className="tabular-nums font-semibold text-green-400">
                    -{fmt(promoDiscountFiat)} {fiatCurrency}
                  </span>
                </div>
              )}
              <div className="pt-1 mt-0.5 border-t border-white/[0.04] flex items-center justify-between gap-2">
                <span className="font-bold text-foreground/80">Total</span>
                <span className="tabular-nums font-bold text-foreground">
                  {fmt(finalFiat ?? 0)} {fiatCurrency}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={
          accent
            ? "text-primary/80"
            : muted
              ? "text-foreground/40"
              : "text-foreground/55"
        }
      >
        {label}
      </span>
      <span
        className={`tabular-nums font-medium ${
          accent
            ? "text-primary"
            : muted
              ? "text-foreground/60"
              : "text-foreground/80"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
