"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowLeftRight,
  AlertTriangle,
  Loader2,
  Zap,
  ChevronDown,
} from "lucide-react";
import type { Order } from "@/types/merchant";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

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
}: TradeFormModalProps) {
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>([]);
  const [showPmDropdown, setShowPmDropdown] = useState(false);

  useEffect(() => {
    if (!isOpen || !merchantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.success && Array.isArray(data.data)) {
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
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, merchantId]);

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
                {/* Trade Type */}
                <div>
                  <label className="text-[11px] text-foreground/40 mb-1.5 block">Trade Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "sell" }))}
                      className={`py-3 rounded-xl text-xs font-medium transition-all ${
                        openTradeForm.tradeType === "sell"
                          ? "bg-white/10 text-white border border-white/6"
                          : "bg-white/[0.04] text-foreground/40 border border-transparent hover:bg-card"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>Sell USDT</span>
                        <span className="text-[9px] text-foreground/35">You send USDT, get AED</span>
                      </div>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "buy" }))}
                      className={`py-3 rounded-xl text-xs font-medium transition-all ${
                        openTradeForm.tradeType === "buy"
                          ? "bg-white/10 text-white/70 border border-white/6"
                          : "bg-white/[0.04] text-foreground/40 border border-transparent hover:bg-card"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>Buy USDT</span>
                        <span className="text-[9px] text-foreground/35">You send AED, get USDT</span>
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
                      onClick={() => setShowPmDropdown(!showPmDropdown)}
                      disabled={paymentMethods.length === 0}
                      className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] transition-all disabled:opacity-60"
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
                        <span className="text-[11px] text-foreground/40">
                          No payment methods — add one in Settings → Payments
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
                      className={`px-3 py-3 rounded-lg text-center transition-all ${
                        openTradeForm.spreadPreference === 'best'
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-foreground/35 hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">Best</p>
                      <p className="text-[10px] text-foreground/35 mt-0.5">2.0%</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'fastest' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all ${
                        openTradeForm.spreadPreference === 'fastest'
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-foreground/35 hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">Fast</p>
                      <p className="text-[10px] text-foreground/35 mt-0.5">2.5%</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'cheap' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all ${
                        openTradeForm.spreadPreference === 'cheap'
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-foreground/35 hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">Cheap</p>
                      <p className="text-[10px] text-foreground/35 mt-0.5">1.5%</p>
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
                      className={`flex-1 px-3 py-2.5 rounded-lg text-center transition-all ${
                        openTradeForm.expiryMinutes === 15
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-foreground/35 hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">15 min</p>
                      <p className="text-[9px] text-foreground/35 mt-0.5">Default</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, expiryMinutes: 90 as 15 | 90 }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-center transition-all ${
                        openTradeForm.expiryMinutes === 90
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-foreground/35 hover:text-foreground hover:bg-card'
                      }`}
                    >
                      <p className="text-xs font-bold">90 min</p>
                      <p className="text-[9px] text-foreground/35 mt-0.5">Extended</p>
                    </button>
                  </div>
                </div>

                {/* Trade Preview */}
                {openTradeForm.cryptoAmount && parseFloat(openTradeForm.cryptoAmount) > 0 && (
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-3.5 h-3.5 text-white" />
                      <span className="text-[11px] font-medium text-white">Trade Preview</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-foreground/35">USDT Amount</span>
                        <span className="text-white">{parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDT</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground/35">Rate (est.)</span>
                        <span className="text-white">3.67 AED/USDT</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-white/[0.04]">
                        <span className="text-foreground/40">AED Amount</span>
                        <span className="text-white font-bold">
                          {(parseFloat(openTradeForm.cryptoAmount) * 3.67).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED
                        </span>
                      </div>
                    </div>
                  </div>
                )}

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
              <div className="px-5 py-4 border-t border-white/[0.04] flex gap-3">
                <button
                  onClick={handleClose}
                  className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] text-foreground/40 hover:bg-card transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={
                    isCreatingTrade ||
                    !openTradeForm.cryptoAmount ||
                    parseFloat(openTradeForm.cryptoAmount) <= 0 ||
                    (openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount) > effectiveBalance)
                  }
                  onClick={onSubmit}
                  className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                    isCreatingTrade ||
                    !openTradeForm.cryptoAmount ||
                    parseFloat(openTradeForm.cryptoAmount) <= 0 ||
                    (openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount) > effectiveBalance)
                      ? 'bg-gray-600 text-foreground/40 cursor-not-allowed'
                      : 'bg-white/10 text-background hover:bg-accent-subtle'
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
