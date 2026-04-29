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
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
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
}

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
    type === 'bank' ? '🏦' : type === 'cash' ? '💵' : type === 'card' ? '💳' : type === 'mobile' ? '📱' : '💰';
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
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    <ArrowLeftRight className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Open Trade</h2>
                    <p className="text-[11px] text-foreground/35">Initiate a trade with a customer</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="p-2 hover:bg-card rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-foreground/35" />
                </button>
              </div>

              {/* Form */}
              <div className="p-5 space-y-4">
                {/* Trading Pair — choose which crypto/fiat corridor to trade in */}
                {activeCorridor && onCorridorChange && (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] text-foreground/40">Trading Pair</label>
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

                {/* Trade Type — semantic colors so the merchant can tell at a
                    glance which side they're on: Sell = primary, Buy = emerald. */}
                <div>
                  <label className="text-[11px] text-foreground/40 mb-1.5 block">Trade Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "sell" }))}
                      className={`py-3 rounded-xl text-xs font-medium transition-all border ${
                        openTradeForm.tradeType === "sell"
                          ? "bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20"
                          : "bg-white/[0.04] text-foreground/40 border-transparent hover:bg-card"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">Sell USDT</span>
                        <span className={`text-[9px] ${openTradeForm.tradeType === "sell" ? "text-primary/70" : "text-foreground/35"}`}>
                          You send USDT, get AED
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "buy" }))}
                      className={`py-3 rounded-xl text-xs font-medium transition-all border ${
                        openTradeForm.tradeType === "buy"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40 ring-1 ring-emerald-500/20"
                          : "bg-white/[0.04] text-foreground/40 border-transparent hover:bg-card"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">Buy USDT</span>
                        <span className={`text-[9px] ${openTradeForm.tradeType === "buy" ? "text-emerald-400/70" : "text-foreground/35"}`}>
                          You send AED, get USDT
                        </span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* USDT Amount */}
                <div>
                  <label className="text-[11px] text-foreground/40 mb-1.5 block">USDT Amount</label>
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
                      className="w-full bg-white/[0.04] rounded-xl px-4 py-3 pr-16 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-foreground/35">USDT</span>
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
                  <label className="text-[11px] text-foreground/40 mb-1.5 block">Payment Method</label>
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

                {/* Spread Preference / Speed */}
                <div>
                  <label className="text-[11px] text-foreground/40 mb-1.5 block">Match Speed & Fee</label>
                  <div className="grid grid-cols-3 gap-1.5 bg-white/[0.03] p-1.5 rounded-xl border border-white/[0.04]">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'best' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all border ${
                        openTradeForm.spreadPreference === 'best'
                          ? 'bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20'
                          : 'text-foreground/35 border-transparent hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">Best</p>
                      <p className={`text-[10px] mt-0.5 ${openTradeForm.spreadPreference === 'best' ? 'text-primary/70' : 'text-foreground/35'}`}>2.0%</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'fastest' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all border ${
                        openTradeForm.spreadPreference === 'fastest'
                          ? 'bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20'
                          : 'text-foreground/35 border-transparent hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">Fast</p>
                      <p className={`text-[10px] mt-0.5 ${openTradeForm.spreadPreference === 'fastest' ? 'text-primary/70' : 'text-foreground/35'}`}>2.5%</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'cheap' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all border ${
                        openTradeForm.spreadPreference === 'cheap'
                          ? 'bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20'
                          : 'text-foreground/35 border-transparent hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">Cheap</p>
                      <p className={`text-[10px] mt-0.5 ${openTradeForm.spreadPreference === 'cheap' ? 'text-primary/70' : 'text-foreground/35'}`}>1.5%</p>
                    </button>
                  </div>
                  <div className="mt-2 text-center">
                    <p className="text-[10px] text-foreground/35">
                      {openTradeForm.spreadPreference === 'best' && 'Instant match - Any spread above 2% is your profit'}
                      {openTradeForm.spreadPreference === 'fastest' && '<5min match - Any spread above 2.5% is your profit'}
                      {openTradeForm.spreadPreference === 'cheap' && 'Best price - Any spread above 1.5% is your profit'}
                    </p>
                  </div>
                </div>

                {/* Order Expiry */}
                <div>
                  <label className="text-[11px] text-foreground/40 mb-1.5 block">Order Expiry</label>
                  <div className="flex items-center gap-2 bg-white/[0.03] p-1.5 rounded-xl border border-white/[0.04]">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, expiryMinutes: 15 as 15 | 90 }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-center transition-all border ${
                        openTradeForm.expiryMinutes === 15
                          ? 'bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20'
                          : 'text-foreground/35 border-transparent hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">15 min</p>
                      <p className={`text-[9px] mt-0.5 ${openTradeForm.expiryMinutes === 15 ? 'text-primary/70' : 'text-foreground/35'}`}>Default</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, expiryMinutes: 90 as 15 | 90 }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-center transition-all border ${
                        openTradeForm.expiryMinutes === 90
                          ? 'bg-primary/15 text-primary border-primary/40 ring-1 ring-primary/20'
                          : 'text-foreground/35 border-transparent hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">90 min</p>
                      <p className={`text-[9px] mt-0.5 ${openTradeForm.expiryMinutes === 90 ? 'text-primary/70' : 'text-foreground/35'}`}>Extended</p>
                    </button>
                  </div>
                </div>

                {/* Trade Preview — uses the live ref price for the active
                    corridor (set via the Trading Pair dropdown above). When
                    the rate isn't loaded yet we render "—" rather than
                    inventing a fallback (CLAUDE.md: no hardcoded rates). */}
                {openTradeForm.cryptoAmount && parseFloat(openTradeForm.cryptoAmount) > 0 && (() => {
                  const usdtAmount = parseFloat(openTradeForm.cryptoAmount);
                  const fiatAmount = liveRate ? usdtAmount * liveRate : null;
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
                            {fiatAmount !== null ? `${formatCrypto(fiatAmount)} ${fiatCcy}` : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Error Message */}
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
                        : "bg-primary text-white hover:bg-primary/90"
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
