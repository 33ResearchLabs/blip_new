"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowLeftRight,
  AlertTriangle,
  Loader2,
  Zap,
  ChevronDown,
  Plus,
} from "lucide-react";
import type { Order } from "@/types/merchant";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { FilterDropdown } from "@/components/user/screens/ui/FilterDropdown";
import { useCorridorPrices, resolveCorridorRef } from "@/hooks/useCorridorPrices";
import { formatCrypto, formatRate } from "@/lib/format";
import { FEE_UI_V2 } from "@/lib/featureFlags";

const CORRIDOR_OPTIONS = [
  { key: "USDT_AED", label: "🇦🇪 USDT / AED" },
  { key: "USDT_INR", label: "🇮🇳 USDT / INR" },
] as const;

// Map a corridor id to its fiat currency code for labels in the preview row.
function corridorFiat(corridorId: string | undefined): "AED" | "INR" {
  return corridorId === "USDT_INR" ? "INR" : "AED";
}

interface MerchantPaymentMethod {
  id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile' | 'upi';
  name: string;
  details?: string;
  is_default?: boolean;
}

export interface OpenTradeFormState {
  tradeType: "buy" | "sell";
  cryptoAmount: string;
  paymentMethod: "bank" | "cash";
  paymentMethodId?: string;
  spreadPreference: "best" | "fastest" | "cheap";
  expiryMinutes: 15 | 90;
  /** Optional Priority Boost (0–25 %). Drives faster matching. The
   *  protocol splits the boost amount 70/30 (merchant/Blip) on the
   *  backend; the UI just exposes the slider. Default 0 = no boost. */
  boostPct?: number;
}

/** Max boost the user can dial in. Backend protocol limit per the
 *  spec. Keep in sync with any matching changes in the order engine. */
const BOOST_MAX_PCT = 25;

export interface TradeFormModalProps {
  isOpen: boolean;
  merchantId: string | null;
  openTradeForm: OpenTradeFormState;
  setOpenTradeForm: React.Dispatch<React.SetStateAction<OpenTradeFormState>>;
  effectiveBalance: number | null;
  isCreatingTrade: boolean;
  createTradeError: string | null;
  setCreateTradeError: (error: string | null) => void;
  onClose: () => void;
  onSubmit: () => void;
  // Active corridor (e.g. "USDT_AED" / "USDT_INR"). When provided, the modal
  // shows a Trading Pair selector at the top so the user can switch corridor
  // right inside the trade-creation flow.
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;
  // Opens the merchant's Payment Methods management overlay so a new method
  // can be added without leaving the trade-creation flow. When omitted, the
  // "+ Add payment method" affordance is hidden.
  onAddPaymentMethod?: () => void;
}

export function TradeFormModal({
  isOpen,
  merchantId,
  openTradeForm,
  setOpenTradeForm,
  effectiveBalance,
  isCreatingTrade,
  createTradeError,
  setCreateTradeError,
  onClose,
  onSubmit,
  activeCorridor,
  onCorridorChange,
  onAddPaymentMethod,
}: TradeFormModalProps) {
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>([]);
  const [showPmDropdown, setShowPmDropdown] = useState(false);
  // Live ref price for the active corridor — drives the Trade Preview row
  // so it always matches what the user picked at the top (USDT/AED vs USDT/INR).
  const corridorPrices = useCorridorPrices();
  const fiatCcy = corridorFiat(activeCorridor);
  const liveRate = resolveCorridorRef(corridorPrices, activeCorridor, fiatCcy);

  // Centralised "why is the submit button disabled" reason. Mirrored by the
  // disabled check on the button itself so the visual + accessibility state
  // and the human-readable explanation can never disagree.
  const cryptoAmountNum = parseFloat(openTradeForm.cryptoAmount || "0");
  const disabledReason: string | null = (() => {
    if (isCreatingTrade) return null;
    if (!openTradeForm.cryptoAmount || cryptoAmountNum <= 0) {
      return "Enter a USDT amount to continue";
    }
    if (
      openTradeForm.tradeType === "sell" &&
      effectiveBalance !== null &&
      cryptoAmountNum > effectiveBalance
    ) {
      return `Insufficient USDT — wallet has ${formatCrypto(effectiveBalance)} USDT`;
    }
    return null;
  })();
  const submitDisabled = isCreatingTrade || disabledReason !== null;

  // Refetch helper — also called when the dropdown reopens so a payment
  // method just added via the management overlay shows up immediately.
  const loadPaymentMethods = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setPaymentMethods(data.data);
        // Auto-select default method if nothing is selected yet
        if (!openTradeForm.paymentMethodId) {
          const defaultPm = data.data.find((pm: MerchantPaymentMethod) => pm.is_default) || data.data[0];
          if (defaultPm) {
            setOpenTradeForm(prev => ({
              ...prev,
              paymentMethod: (defaultPm.type === 'cash' ? 'cash' : 'bank') as 'bank' | 'cash',
              paymentMethodId: defaultPm.id,
            }));
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch payment methods:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  useEffect(() => {
    if (!isOpen || !merchantId) return;
    loadPaymentMethods();
  }, [isOpen, merchantId, loadPaymentMethods]);

  // Refetch on every dropdown open so new methods picked up after the
  // management overlay closes don't require a modal remount.
  useEffect(() => {
    if (showPmDropdown) loadPaymentMethods();
  }, [showPmDropdown, loadPaymentMethods]);

  const handleClose = () => {
    onClose();
    setCreateTradeError(null);
    setShowPmDropdown(false);
  };

  const pmIcon = (type: string) =>
    type === 'bank' ? '🏦' : type === 'cash' ? '💵' : type === 'card' ? '💳' : type === 'mobile' || type === 'upi' ? '📱' : '💰';
  const selectedPm =
    paymentMethods.find((pm) => pm.id === openTradeForm.paymentMethodId) ||
    paymentMethods.find((pm) => pm.type === openTradeForm.paymentMethod);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed z-50 w-full max-w-md max-h-[90vh] overflow-y-auto inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <div className="bg-card-solid rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
              {/* Header — slim, matches the compact pill aesthetic of the
                  home card. No big icon block. */}
              <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Open Trade</h2>
                <button
                  onClick={handleClose}
                  className="p-1.5 hover:bg-card rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-foreground/40" />
                </button>
              </div>

              {/* Form */}
              <div className="p-4 space-y-3">
                {/* Trading Pair — inline pill on the right */}
                {activeCorridor && onCorridorChange && (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">Pair</label>
                    <FilterDropdown<string>
                      value={activeCorridor}
                      onChange={onCorridorChange}
                      ariaLabel="Select trading pair"
                      align="right"
                      variant="square"
                      options={CORRIDOR_OPTIONS.map((c) => ({
                        key: c.key,
                        label: c.label,
                      }))}
                    />
                  </div>
                )}

                {/* Trade Type — segmented pill toggle. Buy = emerald,
                    Sell = primary, semantic colours preserved. */}
                <div>
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium mb-1.5 block">Trade Type</label>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "sell" }))}
                      className={`py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                        openTradeForm.tradeType === "sell"
                          ? "bg-primary/15 text-primary"
                          : "text-foreground/40 hover:text-foreground/70"
                      }`}
                    >
                      Sell USDT
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "buy" }))}
                      className={`py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                        openTradeForm.tradeType === "buy"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "text-foreground/40 hover:text-foreground/70"
                      }`}
                    >
                      Buy USDT
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-foreground/35 px-1">
                    {openTradeForm.tradeType === "sell"
                      ? `You send USDT, get ${fiatCcy}`
                      : `You send ${fiatCcy}, get USDT`}
                  </p>
                </div>

                {/* Amount */}
                <div>
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium mb-1.5 block">Amount</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={14}
                      placeholder="0.00"
                      value={openTradeForm.cryptoAmount}
                      onChange={(e) => {
                        const value = clampDecimal(e.target.value, DECIMAL_PRESETS.amount);
                        setOpenTradeForm(prev => ({ ...prev, cryptoAmount: value }));
                      }}
                      className="w-full bg-white/[0.04] rounded-xl px-3 py-2.5 pr-14 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-foreground/35 font-medium">USDT</span>
                  </div>
                  {openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount || "0") > effectiveBalance && (
                    <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Exceeds your wallet balance ({effectiveBalance.toLocaleString()} USDT)
                    </p>
                  )}
                </div>

                {/* Payment Method */}
                <div>
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium mb-1.5 block">Payment Method</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        // When there are no methods, the dropdown body itself
                        // is empty — opening it is pointless. Jump straight to
                        // the management overlay if the host wired one in.
                        if (paymentMethods.length === 0 && onAddPaymentMethod) {
                          onAddPaymentMethod();
                          return;
                        }
                        setShowPmDropdown(!showPmDropdown);
                      }}
                      className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] transition-all"
                    >
                      {selectedPm ? (
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-[12px] shrink-0">{pmIcon(selectedPm.type)}</span>
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium text-white/80 truncate">{selectedPm.name}</span>
                              <span className="text-[9px] text-foreground/35 font-mono uppercase shrink-0">{selectedPm.type}</span>
                            </div>
                            {selectedPm.details && (
                              <div className="text-[10px] text-foreground/40 font-mono truncate">
                                {selectedPm.details}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : paymentMethods.length === 0 ? (
                        <span className="text-[11px] text-foreground/40 flex items-center gap-1.5">
                          {onAddPaymentMethod ? (
                            <>
                              <Plus className="w-3.5 h-3.5" /> Add a payment method
                            </>
                          ) : (
                            <>No payment methods — add one in Settings → Payments</>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-foreground/40">Select payment method</span>
                      )}
                      <ChevronDown className={`w-3.5 h-3.5 text-foreground/30 transition-transform shrink-0 ${showPmDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showPmDropdown && paymentMethods.length > 0 && (
                      <div className="absolute z-30 top-full left-0 right-0 mt-1 rounded-xl border border-white/[0.08] bg-card-solid shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                        {paymentMethods.map((pm) => {
                          const isSelected = openTradeForm.paymentMethodId === pm.id;
                          return (
                            <button
                              key={pm.id}
                              type="button"
                              onClick={() => {
                                setOpenTradeForm(prev => ({
                                  ...prev,
                                  paymentMethod: (pm.type === 'cash' ? 'cash' : 'bank') as 'bank' | 'cash',
                                  paymentMethodId: pm.id,
                                }));
                                setShowPmDropdown(false);
                              }}
                              className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                                isSelected
                                  ? "bg-white/[0.08] text-white"
                                  : "hover:bg-white/[0.04] text-foreground/60"
                              }`}
                            >
                              <span className="text-[12px] mt-0.5 shrink-0">{pmIcon(pm.type)}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[12px] font-medium truncate">{pm.name}</span>
                                  <span className="text-[9px] text-foreground/30 font-mono uppercase shrink-0 ml-auto">{pm.type}</span>
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
                        {/* Add new — opens the merchant's payment-methods overlay
                            without dismissing the trade modal. The dropdown will
                            refetch on its next open so a freshly added method
                            appears immediately. */}
                        {onAddPaymentMethod && (
                          <button
                            type="button"
                            onClick={() => {
                              onAddPaymentMethod();
                              setShowPmDropdown(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-white/[0.06] text-primary hover:bg-primary/[0.06] transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="text-[12px] font-semibold">
                              Add payment method
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Speed/spread row was here previously — three pills
                    (Best / Fast / Cheap) doubling as fee-tier picker. The
                    new fee model removes per-trade fee tiers: Open Trade
                    is always the 0%-fee "normal" path. Speed/priority is
                    expressed on the user side via the Boost slider, not
                    by the merchant when opening a trade. So the row is
                    deleted; spreadPreference still lives in the form
                    state for backwards-compat with downstream consumers
                    (defaults to 'best') until those are migrated. */}

                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">Expires in</label>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-white/[0.03] border border-white/[0.04]">
                    {([15, 90] as const).map((mins) => (
                      <button
                        key={mins}
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, expiryMinutes: mins as 15 | 90 }))}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                          openTradeForm.expiryMinutes === mins
                            ? 'bg-primary/15 text-primary'
                            : 'text-foreground/40 hover:text-foreground/70'
                        }`}
                      >
                        {mins} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trade preview — new 3-component breakdown (Merchant
                    rate · Blip service fee · Boost · Final). Legacy
                    "Trade Preview" card preserved below the flag so we
                    can flip back instantly if needed. */}
                {/* Settlement breakdown — shows merchant rate, optional
                    priority boost adjustment, then the final amount the
                    merchant nets. Normal trades (boost = 0) reduce to
                    a one-line "rate × amount = final" without noise,
                    matching the no-breakdown-for-0%-fee spec; the boost
                    rows only appear when the slider is non-zero. */}
                {openTradeForm.cryptoAmount && parseFloat(openTradeForm.cryptoAmount) > 0 && (() => {
                  const usdtAmount = parseFloat(openTradeForm.cryptoAmount);
                  const baseFiat = liveRate ? usdtAmount * liveRate : null;
                  const boost = openTradeForm.boostPct ?? 0;
                  // Boost direction: a SELL-USDT order creator gives
                  // up a slice of their fiat to attract a buyer faster
                  // (received fiat goes DOWN); a BUY-USDT creator pays
                  // a premium to attract a seller (paid fiat goes UP).
                  // From the merchant's POV the "you receive" line
                  // tracks fiat for sell and crypto for buy, so the
                  // adjustment is always a deduction visually.
                  const boostFiat = baseFiat !== null ? baseFiat * (boost / 100) : null;
                  const finalFiat =
                    baseFiat !== null && boostFiat !== null
                      ? openTradeForm.tradeType === "sell"
                        ? baseFiat - boostFiat
                        : baseFiat + boostFiat
                      : baseFiat;
                  if (FEE_UI_V2) {
                    return (
                      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06]">
                        {/* Header row — always shows */}
                        <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-white/[0.04]">
                          <span className="flex flex-col">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">
                              {openTradeForm.tradeType === "sell" ? "You receive" : "You pay"}
                            </span>
                            {liveRate && (
                              <span className="text-[10px] text-foreground/35 mt-0.5">
                                @ {formatRate(liveRate)} {fiatCcy} / USDT
                              </span>
                            )}
                          </span>
                          <span className="text-sm font-bold tabular-nums text-foreground">
                            {finalFiat !== null
                              ? `${formatCrypto(finalFiat)} ${fiatCcy}`
                              : "—"}
                          </span>
                        </div>
                        {/* Boost breakdown — only rendered when active */}
                        {boost > 0 && (
                          <div className="px-4 py-2.5 space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="text-foreground/55">Merchant rate</span>
                              <span className="tabular-nums font-medium text-foreground/80">
                                {baseFiat !== null ? `${formatCrypto(baseFiat)} ${fiatCcy}` : "—"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-primary/80">
                                Priority Boost ({boost.toFixed(0)}%)
                              </span>
                              <span className="tabular-nums font-medium text-primary">
                                {boostFiat !== null
                                  ? `${openTradeForm.tradeType === "sell" ? "−" : "+"}${formatCrypto(boostFiat)} ${fiatCcy}`
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-3.5 h-3.5 text-white" />
                        <span className="text-[11px] font-medium text-white">Trade Preview</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-foreground/35">USDT Amount</span>
                          <span className="text-white">{formatCrypto(usdtAmount)} USDT</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-foreground/35">Rate (est.)</span>
                          <span className="text-white">
                            {liveRate ? `${formatRate(liveRate)} ${fiatCcy}/USDT` : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-white/[0.04]">
                          <span className="text-foreground/40">{fiatCcy} Amount</span>
                          <span className="text-white font-bold">
                            {baseFiat !== null ? `${formatCrypto(baseFiat)} ${fiatCcy}` : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Error Message */}
                {/* Priority Boost — optional, collapsed by default so a
                    normal trade stays a one-tap flow. Tap to reveal a
                    slider that lets the merchant offer up to BOOST_MAX_PCT
                    extra on top of the rate to attract faster matches.
                    The 70/30 backend split is hidden — the user just
                    sees the % they're offering and what it does for
                    them ("faster matching"). */}
                {FEE_UI_V2 && (() => {
                  const boost = openTradeForm.boostPct ?? 0;
                  const boostOn = boost > 0;
                  return (
                    <div
                      className={`rounded-xl border ${
                        boostOn
                          ? "bg-primary/[0.06] border-primary/30"
                          : "bg-white/[0.03] border-white/[0.06]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenTradeForm((prev) => ({
                            ...prev,
                            boostPct: boostOn ? 0 : 5,
                          }))
                        }
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                      >
                        <span className="flex items-center gap-2">
                          <Zap
                            className={`w-3.5 h-3.5 ${
                              boostOn ? "text-primary" : "text-foreground/40"
                            }`}
                          />
                          <span
                            className={`text-[11px] font-semibold uppercase tracking-wider ${
                              boostOn ? "text-primary" : "text-foreground/55"
                            }`}
                          >
                            Priority Boost
                          </span>
                          {boostOn && (
                            <span className="text-[11px] font-mono tabular-nums text-primary">
                              +{boost.toFixed(0)}%
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] font-medium text-foreground/40">
                          {boostOn ? "Remove" : "Add"}
                        </span>
                      </button>

                      {boostOn && (
                        <div className="px-3 pb-3 space-y-1.5">
                          <input
                            type="range"
                            min={1}
                            max={BOOST_MAX_PCT}
                            step={1}
                            value={boost}
                            onChange={(e) =>
                              setOpenTradeForm((prev) => ({
                                ...prev,
                                boostPct: parseInt(e.target.value, 10),
                              }))
                            }
                            aria-label="Priority Boost percentage"
                            className="w-full accent-primary"
                          />
                          <p className="text-[10px] text-foreground/45">
                            Higher boost = faster acceptance from any
                            merchant. Capped at {BOOST_MAX_PCT}%.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Fees footnote — quiet disclosure so the merchant
                    knows what's actually charged without a clinical
                    breakdown above. Per the fee-UI spec fees are a
                    "processing thing", not a screen element. */}
                {FEE_UI_V2 && (
                  <p className="text-[10px] text-foreground/40 leading-relaxed text-center px-2">
                    No processing fee on regular trades. Priority Boost
                    is an optional incentive to merchants for faster
                    matching.
                  </p>
                )}

                {createTradeError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="text-xs text-red-400 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {createTradeError}
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-white/[0.04]">
                {/* Disabled reason — shown right above the action buttons so
                    the user immediately sees WHY Open Trade is greyed out
                    instead of guessing. */}
                {disabledReason && (
                  <div className="px-5 pt-3 -mb-1">
                    <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{disabledReason}</span>
                    </p>
                  </div>
                )}
                <div className="px-5 py-4 flex gap-3">
                  <button
                    onClick={handleClose}
                    className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] text-foreground/40 hover:bg-card transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={submitDisabled}
                    onClick={onSubmit}
                    className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                      submitDisabled
                        ? "bg-gray-600 text-foreground/40 cursor-not-allowed"
                        : "bg-primary text-background hover:bg-primary/90"
                    }`}
                  >
                    {isCreatingTrade ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        Open Trade
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
