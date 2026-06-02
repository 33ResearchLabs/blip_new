"use client";

import { useState, useEffect, useMemo, memo, lazy, Suspense } from "react";
import {
  Zap,
  Target,
  TrendingDown,
  ChevronUp,
  ChevronDown,
  Loader2,
  Flame,
  ArrowRightLeft,
  Plus,
} from "lucide-react";
import dynamic from "next/dynamic";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { MyOffers } from "@/components/merchant/MyOffers";
import { ChevronRight, Package } from "lucide-react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";

// Use the same rich modal merchant settings uses, so the form fields adapt
// per-type (bank → IBAN/account/SWIFT, cash → location, mobile → provider/
// phone, crypto → wallet, card → cardholder/last4). Replaces the previous
// generic 2-input inline form which forced merchants to cram type-specific
// data (UPI ID, IBAN, etc.) into a free-text "details" field.
const PaymentMethodModal = dynamic(
  () =>
    import("@/components/merchant/PaymentMethodModal").then((m) => ({
      default: m.PaymentMethodModal,
    })),
  { ssr: false },
);

// Validation for payment-method name/details now lives in
// PaymentMethodModal.tsx — the modal owns the form so the regex previously
// duplicated here was removed. Single source of truth: the server-side
// validator in /api/merchant/[id]/payment-methods + the modal's per-type
// validators (validateBank, validateCash, ...).

interface MerchantPaymentMethod {
  id: string;
  type: "bank" | "cash" | "crypto" | "card" | "mobile" | "upi";
  name: string;
  details?: string;
  is_default?: boolean;
}

interface ConfigPanelProps {
  merchantId: string | null;
  merchantInfo: any;
  effectiveBalance: number | null;
  activeCorridor?: string;
  openTradeForm: {
    tradeType: "buy" | "sell";
    cryptoAmount: string;
    paymentMethod: "bank" | "cash";
    paymentMethodId?: string;
    spreadPreference: "best" | "fastest" | "cheap";
  };
  setOpenTradeForm: (form: any) => void;
  isCreatingTrade: boolean;
  onCreateOrder: (
    tradeType?: "buy" | "sell",
    priorityFee?: number,
    pair?: "usdt_aed" | "usdt_inr",
  ) => void;
  refreshBalance: () => void;
}

const PRICING_TIERS = {
  fastest: { label: "Fast", base: 0, range: 5, icon: Zap },
  best: { label: "Best", base: 2.0, range: 3, icon: Target },
  cheap: { label: "Cheap", base: 1.5, range: 2, icon: TrendingDown },
} as const;

// Priority fee decay: full for first 15s, linear decay 15s→60s, 0 after 60s
function getDecayedFee(maxFee: number, elapsedSec: number): number {
  if (elapsedSec <= 15) return maxFee;
  if (elapsedSec >= 60) return 0;
  return maxFee * (1 - (elapsedSec - 15) / 45);
}

// SVG decay curve visualization
function DecayChart({ maxFee }: { maxFee: number }) {
  const w = 180;
  const h = 40;
  const padL = 16;
  const padR = 4;
  const padT = 3;
  const padB = 12;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const points: string[] = [];
  for (let t = 0; t <= 60; t += 1) {
    const fee = getDecayedFee(maxFee, t);
    const x = padL + (t / 60) * chartW;
    const y = padT + chartH - (fee / Math.max(maxFee, 1)) * chartH;
    points.push(`${x},${y}`);
  }
  const linePath = `M${points.join(" L")}`;
  const firstPoint = `${padL},${padT + chartH}`;
  const lastPoint = `${padL + chartW},${padT + chartH}`;
  const fillPath = `M${firstPoint} L${points.join(" L")} L${lastPoint} Z`;

  return (
    <svg
      width={w}
      height={h}
      className="w-full"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <line
        x1={padL}
        y1={padT + chartH}
        x2={padL + chartW}
        y2={padT + chartH}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth="0.5"
      />
      <line
        x1={padL + (15 / 60) * chartW}
        y1={padT}
        x2={padL + (15 / 60) * chartW}
        y2={padT + chartH}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="0.5"
        strokeDasharray="2,2"
      />
      <path d={fillPath} fill="url(#decayGrad)" />
      <path
        d={linePath}
        fill="none"
        stroke="rgb(249,115,22)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <text
        x={padL}
        y={h - 1}
        fill="rgba(255,255,255,0.2)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        0s
      </text>
      <text
        x={padL + (15 / 60) * chartW - 3}
        y={h - 1}
        fill="rgba(255,255,255,0.25)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        15s
      </text>
      <text
        x={padL + chartW - 10}
        y={h - 1}
        fill="rgba(255,255,255,0.2)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        60s
      </text>
      <text
        x={1}
        y={padT + 5}
        fill="rgba(255,255,255,0.2)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        {maxFee}%
      </text>
      <defs>
        <linearGradient id="decayGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(249,115,22)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="rgb(249,115,22)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export const ConfigPanel = memo(function ConfigPanel({
  merchantId,
  merchantInfo,
  effectiveBalance,
  activeCorridor = "USDT_INR",
  openTradeForm,
  setOpenTradeForm,
  isCreatingTrade,
  onCreateOrder,
  refreshBalance,
}: ConfigPanelProps) {
  // Derive pair from activeCorridor (set in StatusCard trading pair selector)
  const pair =
    activeCorridor === "USDT_INR" ? "usdt_inr" : ("usdt_aed" as const);

  // Merchant payment methods (replaces the static Bank/Cash buttons).
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>(
    [],
  );
  // showAddPm now toggles the dedicated PaymentMethodModal (bottom of file)
  // instead of an inline 2-input form. The modal renders type-specific fields
  // (bank → IBAN/account/SWIFT, cash → location, mobile → provider/phone,
  // crypto → wallet, card → cardholder/last4) and writes through the same
  // POST /api/merchant/{id}/payment-methods endpoint, so server validation
  // and the resulting row shape are unchanged. The previous inline form +
  // its handler (`newPm`/`handleAddPaymentMethod`) is removed; modal owns it.
  const [showAddPm, setShowAddPm] = useState(false);
  const [showPmDropdown, setShowPmDropdown] = useState(false);

  // The `me` alias is resolved server-side from auth.actorId. We do NOT
  // depend on the `merchantId` prop here — that prop hydrates from
  // localStorage which can race the session-token hydration and lead
  // to an empty payload (the dropdown then shows "No payment methods"
  // permanently because the effect never re-runs). With `me`, the
  // request only depends on the auth cookie/token being present, which
  // fetchWithAuth handles via its automatic refresh-on-401 path.
  const fetchPaymentMethods = async () => {
    try {
      const res = await fetchWithAuth(`/api/merchant/me/payment-methods`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setPaymentMethods(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch payment methods:", err);
    }
  };

  useEffect(() => {
    fetchPaymentMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [currentRate, setCurrentRate] = useState<number>(3.67);
  const [priorityFee, setPriorityFee] = useState<number>(0);
  const [showPriorityInput, setShowPriorityInput] = useState(false);
  const [showOffers, setShowOffers] = useState(false);

  // Currency labels derived from the selected pair.
  const fiatLabel = pair === "usdt_inr" ? "INR" : "AED";
  const fiatSymbol = pair === "usdt_inr" ? "₹" : "";
  const fiatSuffix = pair === "usdt_aed" ? " AED" : "";

  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/corridor/dynamic-rate?pair=${pair}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data.ref_price) {
            setCurrentRate(data.data.ref_price);
          }
        }
      } catch (err) {
        console.error("Failed to fetch rate:", err);
      }
    };

    fetchRate();
    const interval = setInterval(fetchRate, 30000);
    return () => clearInterval(interval);
  }, [pair]);

  const tier = PRICING_TIERS[openTradeForm.spreadPreference];
  const cryptoAmount = parseFloat(openTradeForm.cryptoAmount) || 0;
  const maxAmount = effectiveBalance || 0;

  const PROMO_DISCOUNT_USDT = 5;
  const [promoActive, setPromoActive] = useState(true);
  useEffect(() => {
    fetchWithAuth('/api/promo/testing-reward')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.success) setPromoActive(d.data.active); })
      .catch(() => {});
  }, []);

  const pricing = useMemo(() => {
    const totalSpread = tier.base + priorityFee;
    const baseRate = Math.round(currentRate * 100) / 100;
    // Use merchant's configured rates if set, else use Blip's fixed INR rates
    const merchantBuyRate = merchantInfo?.buy_rate ? parseFloat(String(merchantInfo.buy_rate)) : null;
    const merchantSellRate = merchantInfo?.sell_rate ? parseFloat(String(merchantInfo.sell_rate)) : null;
    const INR_BUY = 99.47;   // 101.5 - 2% backend fee absorbed
    const INR_SELL = 105.47; // 103.4 + 2% backend fee absorbed
    const isInr = pair === 'usdt_inr';
    const buyRate = merchantBuyRate ?? (isInr ? INR_BUY : baseRate * (1 - totalSpread / 100));
    const sellRate = merchantSellRate ?? (isInr ? INR_SELL : baseRate * (1 + totalSpread / 100));
    const promoDeductFiat = promoActive ? PROMO_DISCOUNT_USDT * buyRate : 0;
    const promoAddFiat = promoActive ? PROMO_DISCOUNT_USDT * sellRate : 0;
    const buyAed = Math.max(0, cryptoAmount * buyRate - promoDeductFiat);
    const sellAed = Math.max(0, cryptoAmount * sellRate - promoAddFiat);

    return { totalSpread, buyRate, sellRate, buyAed, sellAed };
  }, [currentRate, tier, priorityFee, cryptoAmount, merchantInfo, promoActive, pair]);

  const handlePriorityChange = (val: number) => {
    setPriorityFee(Math.min(50, Math.max(0, val)));
  };

  const isDisabled =
    isCreatingTrade ||
    !openTradeForm.cryptoAmount ||
    parseFloat(openTradeForm.cryptoAmount) <= 0;

  // SHRINK-TO-FIT stays the default (overflow-hidden, no scroll). But entering
  // an amount injects three extra shrink-0 rows (the ≈fiat preview, the
  // BUY/SELL sub-prices, and the spread summary) that can push past a short
  // panel's height — so once an amount is present we switch to overflow-y-auto
  // and let it scroll instead of clipping. overflow-x-hidden is paired
  // explicitly: setting only overflow-y makes the x-axis compute to "auto",
  // which would add a stray horizontal scrollbar.
  const overflowClass =
    cryptoAmount > 0 ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden";

  // Row sizing pairs with overflowClass. While empty, rows are `flex-1
  // min-h-0` so the shrink-to-fit model can compress all five into the panel
  // with no scroll. The catch: min-h-0 lets every row shrink to exactly fill
  // the container, so the rows NEVER collectively overflow — the container's
  // overflow-y-auto can't fire, and the Amount row's ≈fiat preview line
  // instead spills out of its own compressed row onto the Payment card below.
  // So once an amount is entered we drop min-h-0 (keep flex-1): each row is now
  // at least as tall as its content, the preview stays inside the Amount row
  // (pushing Payment down rather than overlapping it), and the panel scrolls
  // once the rows no longer fit.
  const rowSizing = cryptoAmount > 0 ? "flex-1" : "flex-1 min-h-0";

  return (
    <div className="flex flex-col h-full">
      {/* SHRINK-TO-FIT responsive model (no scroll while the form is empty).
          The form is a 5-row vertical flex; every row is `flex-1` (weights
          below) and grows to fill a tall panel. To survive SHORT panels
          without scrolling, each control's min-height FLOOR is itself
          laddered down by height, so the rows keep shrinking until all five
          fit. `overflow-hidden` enforces the no-scroll contract — EXCEPT once
          an amount is entered, where it flips to `overflow-y-auto` so the
          three extra preview rows can scroll rather than clip (see
          `overflowClass` above the return).

          Breakpoints follow a 7-tier ladder per axis, with each property
          bound to ONE axis to avoid container-query specificity collisions
          (width and height variants have equal specificity — source order,
          not "the tighter axis", would otherwise decide the winner):
            • vertical-spacing + the hero number  → HEIGHT (@max-h-[…])
            • horizontal text + show/hide          → WIDTH  (@max-[…])
          Padding is split px/py so each axis drives the side it controls. */}
      <div
        className={`flex-1 min-h-0 flex flex-col px-3 @max-[320px]:px-2.5 @max-[240px]:px-2 @max-[200px]:px-1.5 py-3 @max-h-[480px]:py-2.5 @max-h-[400px]:py-2 @max-h-[320px]:py-1.5 @max-h-[240px]:py-1 gap-4 @max-h-[520px]:gap-3.5 @max-h-[480px]:gap-3 @max-h-[440px]:gap-2.5 @max-h-[400px]:gap-2 @max-h-[320px]:gap-1.5 @max-h-[240px]:gap-1 ${overflowClass}`}
      >
        {/* Amount — hero input (weight 1). Grows to fill on tall panels;
            its floor is laddered down by HEIGHT so it keeps shrinking until
            all five rows fit without scrolling. Amount + Bank carry the
            smallest floors since they're single controls (no inner grid), so
            they yield space first on short panels and don't overlap. */}
        <div className={`${rowSizing} flex flex-col`}>
          <div className="flex items-center justify-between mb-2 @max-h-[400px]:mb-1.5 @max-h-[320px]:mb-1 @max-h-[240px]:mb-0.5 gap-1 min-w-0 shrink-0">
            <div className="flex items-center gap-1.5 @max-[240px]:gap-1 min-w-0">
              <ArrowRightLeft className="w-3.5 h-3.5 @max-[240px]:w-3 @max-[240px]:h-3 text-[#f5f5f7]/60 shrink-0" />
              <span className="text-[11px] @max-[280px]:text-[10px] @max-[220px]:text-[9px] font-bold text-foreground/50 uppercase tracking-wider">
                Amount
              </span>
              {/* Corridor badge — driven by StatusCard trading pair. Below
                  280px the "USDT /" prefix is dropped to save width. */}
              <span className="ml-2 @max-[320px]:ml-1 px-1.5 @max-[240px]:px-1 py-0.5 rounded text-[9px] @max-[240px]:text-[8px] font-bold font-mono tracking-wider bg-white/[0.06] text-[#f5f5f7] border border-white/[0.12] whitespace-nowrap">
                <span className="@max-[280px]:hidden">USDT / </span>
                {pair === "usdt_inr" ? "INR" : "AED"}
              </span>
            </div>
            <button
              onClick={() =>
                setOpenTradeForm({
                  ...openTradeForm,
                  cryptoAmount: maxAmount.toFixed(0),
                })
              }
              className="text-[10px] @max-[280px]:text-[9px] @max-[220px]:text-[8px] text-[#f5f5f7]/70 hover:text-white font-mono font-bold transition-colors px-1.5 @max-[240px]:px-1 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.08] shrink-0 whitespace-nowrap"
            >
              MAX
              {/* The numeric value is dropped below 200px so the button
                  doesn't crowd out the label. */}
              <span className="@max-[200px]:hidden">
                {" "}
                {maxAmount.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </button>
          </div>
          {/* Input wrapper fills the section above its floor. The floor is
              height-laddered so the field stays tappable while shrinking to
              fit short panels. */}
          <div className="relative flex-1 min-h-[2.75rem] @max-h-[440px]:min-h-[2.5rem] @max-h-[400px]:min-h-[2.25rem] @max-h-[360px]:min-h-[2rem] @max-h-[320px]:min-h-[1.75rem] @max-h-[280px]:min-h-[1.5rem] @max-h-[240px]:min-h-[1.375rem]">
            <input
              type="text"
              inputMode="decimal"
              maxLength={14}
              value={openTradeForm.cryptoAmount}
              onChange={(e) => {
                const clamped = clampDecimal(
                  e.target.value,
                  DECIMAL_PRESETS.amount,
                );
                setOpenTradeForm({ ...openTradeForm, cryptoAmount: clamped });
              }}
              placeholder="0"
              className="absolute inset-0 w-full h-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl px-4 @max-[240px]:px-3 text-xl @max-h-[480px]:text-lg @max-h-[400px]:text-base @max-h-[320px]:text-sm @max-h-[240px]:text-xs font-bold text-foreground placeholder:text-foreground/10 outline-none focus:border-white/[0.12] focus:bg-foreground/[0.04] transition-all font-mono tabular-nums"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-foreground/25 font-mono pointer-events-none">
              USDT
            </span>
          </div>
          {cryptoAmount > 0 && (
            <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] font-mono shrink-0">
              <span className="text-foreground/30">
                ≈ {fiatSymbol}
                {(cryptoAmount * currentRate).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                {fiatSuffix}
              </span>
              <span className="text-foreground/20">
                @ {currentRate.toFixed(4)}
              </span>
            </div>
          )}
        </div>

        {/* Payment Methods — dropdown (weight 1). Height-laddered floor so
            the selector content (icon + name + account number) stays legible
            while shrinking to fit. */}
        <div className={`relative ${rowSizing} flex flex-col z-30`}>
          {/* Label — this row was the ONLY control without one (Amount,
              Spread, Boost all have a label above their control). That made
              the gap below the dropdown (gap + the Spread label) read as
              larger than the gap above it (gap only). Mirrors the Spread
              label's classes so every row now carries the same label-gap and
              the box-to-box spacing is even top-and-bottom. */}
          <label className="text-[10px] @max-[220px]:text-[9px] text-foreground/30 mb-1 @max-h-[360px]:mb-0.5 flex items-center gap-1 font-mono uppercase tracking-wider font-bold shrink-0">
            Payment
          </label>
          {(() => {
            const pmIcon = (type: string) =>
              type === "bank"
                ? "🏦"
                : type === "cash"
                  ? "💵"
                  : type === "card"
                    ? "💳"
                    : type === "mobile" || type === "upi"
                      ? "📱"
                      : "💰";
            const selectedPm =
              paymentMethods.find(
                (pm) => pm.id === openTradeForm.paymentMethodId,
              ) ||
              paymentMethods.find(
                (pm) => pm.type === openTradeForm.paymentMethod,
              );
            return (
              <>
                <button
                  onClick={() => setShowPmDropdown(!showPmDropdown)}
                  className="w-full flex-[0.75] min-h-[2.75rem] @max-h-[440px]:min-h-[2.5rem] @max-h-[400px]:min-h-[2.25rem] @max-h-[360px]:min-h-[2rem] @max-h-[320px]:min-h-[1.75rem] @max-h-[280px]:min-h-[1.5rem] @max-h-[240px]:min-h-[1.375rem] flex items-center justify-between gap-2 @max-[240px]:gap-1 px-3 @max-[240px]:px-2 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:border-foreground/[0.15] transition-all"
                >
                  {selectedPm ? (
                    <div className="flex items-center gap-2 @max-[240px]:gap-1.5 min-w-0 flex-1">
                      <span className="text-[11px] @max-[240px]:text-[10px] shrink-0">
                        {pmIcon(selectedPm.type)}
                      </span>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5 @max-[240px]:gap-1">
                          <span className="text-[11px] @max-[280px]:text-[10px] @max-[220px]:text-[9px] font-bold text-foreground/80 truncate">
                            {selectedPm.name}
                          </span>
                          {/* `type` tag dropped below 240px to free width. */}
                          <span className="text-[9px] @max-[240px]:hidden text-foreground/30 font-mono uppercase shrink-0">
                            {selectedPm.type}
                          </span>
                        </div>
                        {selectedPm.details && (
                          <div className="text-[10px] @max-[280px]:text-[9px] @max-[220px]:text-[8px] text-foreground/45 font-mono truncate">
                            {selectedPm.details}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : paymentMethods.length === 0 ? (
                    <span className="text-[11px] text-foreground/30">
                      No payment methods
                    </span>
                  ) : (
                    <span className="text-[11px] text-foreground/40">
                      Select payment method
                    </span>
                  )}
                  <ChevronDown
                    className={`w-3.5 h-3.5 @max-[220px]:w-3 @max-[220px]:h-3 text-foreground/30 transition-transform shrink-0 ${showPmDropdown ? "rotate-180" : ""}`}
                  />
                </button>

                {showPmDropdown && (
                  <div className="absolute z-30 top-full left-0 right-0 mt-1 rounded-xl border border-foreground/[0.08] bg-card-solid shadow-lg overflow-hidden">
                    {paymentMethods.map((pm) => {
                      const isSelected = openTradeForm.paymentMethodId
                        ? openTradeForm.paymentMethodId === pm.id
                        : openTradeForm.paymentMethod === pm.type;
                      return (
                        <button
                          key={pm.id}
                          onClick={() => {
                            setOpenTradeForm({
                              ...openTradeForm,
                              paymentMethod: pm.type as "bank" | "cash",
                              paymentMethodId: pm.id,
                            });
                            setShowPmDropdown(false);
                          }}
                          className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? "bg-white/[0.06] text-foreground/90"
                              : "hover:bg-foreground/[0.04] text-foreground/60"
                          }`}
                        >
                          <span className="text-[11px] mt-0.5 shrink-0">
                            {pmIcon(pm.type)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-bold truncate">
                                {pm.name}
                              </span>
                              <span className="text-[9px] text-foreground/25 font-mono uppercase shrink-0 ml-auto">
                                {pm.type}
                              </span>
                            </div>
                            {pm.details && (
                              <div className="text-[10px] text-foreground/40 font-mono truncate mt-0.5">
                                {pm.details}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        setShowAddPm(true);
                        setShowPmDropdown(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-foreground/[0.06] hover:bg-foreground/[0.04] transition-colors"
                    >
                      <Plus className="w-3 h-3 text-[#f5f5f7]/60" />
                      <span className="text-[11px] font-bold text-[#f5f5f7]/70">
                        Add Payment Method
                      </span>
                    </button>
                  </div>
                )}
              </>
            );
          })()}

          {/* Add-payment-method modal — replaces the previous inline 2-input
              form. Same modal merchant-settings uses, so the form fields
              adapt per-type (bank → IBAN/account/SWIFT, cash → location,
              mobile → provider/phone, crypto → wallet, card → cardholder/last4).
              On close we refresh the dropdown so a newly-added method is
              immediately selectable in the trade form. */}
          {showAddPm && merchantId && (
            <PaymentMethodModal
              isOpen={showAddPm}
              merchantId={merchantId}
              onClose={() => {
                setShowAddPm(false);
                fetchPaymentMethods();
              }}
            />
          )}
        </div>

        {/* Spread Tier (weight 1). */}
        <div data-tour="spread" className={`${rowSizing} flex flex-col`}>
          <label className="text-[10px] @max-[220px]:text-[9px] text-foreground/30 mb-1 @max-h-[360px]:mb-0.5 flex items-center gap-1 font-mono uppercase tracking-wider font-bold shrink-0">
            Spread
            <InfoTooltip
              side="bottom"
              title="Spread"
              description="Your profit margin per trade. Pick the balance between speed and profit."
              items={[
                {
                  label: "Fast",
                  value: "+2.5% — matches quickly, lower profit",
                },
                {
                  label: "Best",
                  value: "+2% — balanced speed and profit",
                },
                {
                  label: "Cheap",
                  value: "+1.5% — highest profit, slower match",
                },
              ]}
            />
          </label>

          <div className="flex gap-1.5 @max-[240px]:gap-1 flex-1 min-h-[2.5rem] @max-h-[440px]:min-h-[2.25rem] @max-h-[400px]:min-h-[2rem] @max-h-[360px]:min-h-[1.875rem] @max-h-[320px]:min-h-[1.75rem] @max-h-[280px]:min-h-[1.5rem] @max-h-[240px]:min-h-[1.375rem]">
            {(
              Object.entries(PRICING_TIERS) as [
                keyof typeof PRICING_TIERS,
                (typeof PRICING_TIERS)[keyof typeof PRICING_TIERS],
              ][]
            ).map(([key, t]) => {
              const isSelected = openTradeForm.spreadPreference === key;
              const TierIcon = t.icon;

              return (
                <button
                  key={key}
                  onClick={() =>
                    setOpenTradeForm({
                      ...openTradeForm,
                      spreadPreference: key,
                    })
                  }
                  className={`flex-1 h-full rounded-xl transition-all border flex flex-col items-center justify-center gap-0.5 px-1 min-w-0 ${
                    isSelected
                      ? "bg-white/[0.06] border-white/[0.12]"
                      : "bg-foreground/[0.02] hover:bg-foreground/[0.04] border-foreground/[0.04]"
                  }`}
                >
                  {/* icon + label dropped progressively by WIDTH: icon below
                      240px, label below 200px. The "+2.5%" value always
                      stays — it's the meaningful part. (Previously these two
                      classNames had a broken template concat that produced
                      `@max-h-[500px]:hiddentext-primary`, so the colour never
                      applied; rewritten cleanly here.) */}
                  <div className="flex items-center gap-1 @max-[200px]:hidden">
                    <TierIcon
                      className={`w-3 h-3 shrink-0 @max-[240px]:hidden ${
                        isSelected ? "text-[#f5f5f7]" : "text-foreground/20"
                      }`}
                    />
                    <span
                      className={`text-[10px] @max-[280px]:text-[9px] font-bold ${
                        isSelected ? "text-foreground" : "text-foreground/35"
                      }`}
                    >
                      {t.label}
                    </span>
                  </div>
                  {key === 'fastest' ? (
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-[10px] font-black font-mono tabular-nums text-foreground/20 line-through">+2.5%</span>
                      <span className="text-[11px] font-black font-mono tabular-nums text-[#f5f5f7]">0%</span>
                    </div>
                  ) : (
                    <div className={`text-[11px] font-black font-mono tabular-nums ${isSelected ? "text-[#f5f5f7]" : "text-white/25"}`}>
                      +{t.base}%
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Priority Fee / Boost — hidden for now */}
        {false && <div data-tour="boost">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider font-bold flex items-center gap-1">
              <Flame className="w-3 h-3 text-[#f5f5f7]/40" />
              Boost
              <InfoTooltip
                side="bottom"
                title="Boost"
                description="Priority fee that pushes your order ahead of other merchants in the queue."
                items={[
                  { label: "0%", value: "No boost — standard queue priority" },
                  { label: "5%", value: "Low boost — slightly faster match" },
                  {
                    label: "10%",
                    value: "Medium boost — preferred in busy markets",
                  },
                  { label: "15%", value: "High boost — top of the queue" },
                ]}
              />
            </label>
            <button
              onClick={() => setShowPriorityInput(!showPriorityInput)}
              className="text-[9px] text-[#f5f5f7]/50 hover:text-white font-mono font-bold transition-colors"
            >
              {showPriorityInput ? "hide" : "manual"}
            </button>
          </div>
          <div className="flex gap-1.5 @max-[280px]:gap-1 @max-[240px]:gap-0.5 flex-1 min-h-[2.25rem] @max-h-[400px]:min-h-[2rem] @max-h-[360px]:min-h-[1.875rem] @max-h-[320px]:min-h-[1.75rem] @max-h-[280px]:min-h-[1.5rem] @max-h-[240px]:min-h-[1.375rem]">
            {[0, 5, 10, 15].map((val) => (
              <button
                key={val}
                onClick={() => setPriorityFee(val)}
                className={`flex-1 h-full rounded-lg text-[10px] @max-[280px]:text-[9px] @max-[220px]:text-[8px] font-bold font-mono transition-all border min-w-0 ${
                  priorityFee === val
                    ? "bg-foreground/[0.08] text-foreground/90 border-foreground/[0.12]"
                    : "bg-foreground/[0.02] text-foreground/25 hover:bg-foreground/[0.05] border-foreground/[0.04]"
                }`}
              >
                {val === 0 ? "0" : `${val}%`}
              </button>
            ))}
          </div>

          {showPriorityInput && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                onClick={() => handlePriorityChange(priorityFee - 0.5)}
                className="p-1 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.06] text-foreground/30"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                value={priorityFee}
                onChange={(e) =>
                  handlePriorityChange(parseFloat(e.target.value) || 0)
                }
                min={0}
                max={50}
                step={0.5}
                className="flex-1 bg-foreground/[0.03] border border-foreground/[0.06] rounded-lg px-2 py-1 text-[11px] text-foreground font-mono text-center outline-none focus:border-foreground/15"
              />
              <button
                onClick={() => handlePriorityChange(priorityFee + 0.5)}
                className="p-1 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.06] text-foreground/30"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-foreground/20 font-mono font-bold">
                %
              </span>
            </div>
          )}

          {priorityFee > 0 && (
            <div className="mt-1.5 @max-h-[400px]:hidden rounded-xl bg-foreground/[0.02] border border-foreground/[0.04] p-1.5">
              <div className="flex items-center justify-between px-1 mb-0.5">
                <span className="text-[9px] text-foreground/15 font-mono font-bold">
                  DECAY
                </span>
                <span className="text-[9px] text-[#f5f5f7]/50 font-mono font-bold">
                  {priorityFee}% → 0%
                </span>
              </div>
              <DecayChart maxFee={priorityFee} />
            </div>
          )}
        </div>}

        {/* Testing rewards banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.08]/[0.08] border border-white/[0.09]">
          <span className="text-base">🎁</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#f5f5f7] leading-tight">$5 testing rewards</p>
            <p className="text-[10px] text-[#f5f5f7]/60 leading-tight">Earn for completing your first trades</p>
          </div>
        </div>

        {/* BUY / SELL Buttons (weight 1.1).
            Accurate section weights for this fill model:
              Amount 1 · Bank 1 · Spread 1 · Boost 1 · BUY/SELL 1.1
              = 5.1 total → 19.6% / 19.6% / 19.6% / 19.6% / 21.6%.
            Floor is height-laddered so the buttons stay tappable while the
            panel shrinks. Label font is HEIGHT-bound; the sub-price font and
            the gap/radius are WIDTH-bound (one axis per property). */}
        <div className="flex gap-2 @max-[280px]:gap-1.5 @max-[240px]:gap-1 flex-[1.1] min-h-[2.5rem] @max-h-[440px]:min-h-[2.25rem] @max-h-[400px]:min-h-[2rem] @max-h-[360px]:min-h-[1.875rem] @max-h-[320px]:min-h-[1.75rem] @max-h-[280px]:min-h-[1.5rem] @max-h-[240px]:min-h-[1.375rem]">
          <button
            onClick={() => {
              setOpenTradeForm({ ...openTradeForm, tradeType: "buy" });
              onCreateOrder("buy", priorityFee, pair);
            }}
            disabled={isDisabled}
            className="flex-1 h-full rounded-xl @max-[240px]:rounded-lg font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed press-effect flex flex-col items-center justify-center gap-0.5 min-w-0 px-1"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--background)",
              boxShadow: "0 2px 12px var(--primary-dim)",
            }}
          >
            {isCreatingTrade && openTradeForm.tradeType === "buy" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm @max-h-[400px]:text-xs @max-h-[320px]:text-[11px] font-black tracking-wide">
                  BUY
                </span>
                {cryptoAmount > 0 && (
                  <span className="text-[10px] @max-[240px]:text-[9px] @max-[200px]:text-[8px] font-mono font-bold opacity-60 truncate max-w-full px-1">
                    {fiatSymbol}
                    {pricing.buyAed.toFixed(2)}
                    {fiatSuffix || ` ${fiatLabel}`}
                  </span>
                )}
              </>
            )}
          </button>
          <button
            onClick={() => {
              setOpenTradeForm({ ...openTradeForm, tradeType: "sell" });
              onCreateOrder("sell", priorityFee, pair);
            }}
            disabled={isDisabled}
            className="flex-1 h-full rounded-xl @max-[240px]:rounded-lg bg-foreground/[0.06] text-foreground font-bold hover:bg-foreground/[0.10] transition-all disabled:opacity-30 disabled:cursor-not-allowed press-effect border border-foreground/[0.08] flex flex-col items-center justify-center gap-0.5 min-w-0 px-1"
          >
            {isCreatingTrade && openTradeForm.tradeType === "sell" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm @max-h-[400px]:text-xs @max-h-[320px]:text-[11px] font-black tracking-wide">
                  SELL
                </span>
                {cryptoAmount > 0 && (
                  <span className="text-[10px] @max-[240px]:text-[9px] @max-[200px]:text-[8px] font-mono font-bold text-foreground/40 truncate max-w-full px-1">
                    {fiatSymbol}
                    {pricing.sellAed.toFixed(2)}
                    {fiatSuffix || ` ${fiatLabel}`}
                  </span>
                )}
              </>
            )}
          </button>
        </div>

        {/* Spread summary — least-critical line, hidden on very short
            panels so the five primary rows always fit without scrolling. */}
        {cryptoAmount > 0 && (
          <div className="flex items-center justify-between px-1 text-[9px] font-mono text-foreground/20">
            {promoActive && (
              <span className="text-[#f5f5f7]/60">🎁 -$5 applied</span>
            )}
            <span className="tabular-nums ml-auto">
              B {pricing.buyRate.toFixed(4)} · S {pricing.sellRate.toFixed(4)}
            </span>
          </div>
        )}

        {/* My Offers Toggle */}
        {/* <button
          onClick={() => setShowOffers(!showOffers)}
          className="w-full flex items-center justify-between px-3 py-2.5 mt-1 rounded-xl bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] transition-all"
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[#f5f5f7]/60" />
            <span className="text-[11px] font-semibold text-foreground/70">My Offers</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-foreground/30 transition-transform duration-200 ${showOffers ? 'rotate-90' : ''}`} />
        </button> */}

        {/* My Offers Panel (inline) */}
        {/* {showOffers && merchantId && (
          <div className="mt-1 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-2 overflow-y-auto max-h-[400px]">
            <MyOffers merchantId={merchantId} />
          </div>
        )} */}
      </div>
    </div>
  );
});
