"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowLeftRight,
  AlertTriangle,
  Loader2,
  Zap,
} from "lucide-react";
import type { Order } from "@/types/merchant";

export interface OpenTradeFormState {
  tradeType: "buy" | "sell";
  cryptoAmount: string;
  paymentMethod: "bank" | "cash";
  spreadPreference: "best" | "fastest" | "cheap";
  expiryMinutes: 15 | 90;
}

export interface TradeFormModalProps {
  isOpen: boolean;
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
  openTradeForm,
  setOpenTradeForm,
  effectiveBalance,
  isCreatingTrade,
  createTradeError,
  setCreateTradeError,
  onClose,
  onSubmit,
}: TradeFormModalProps) {
  const handleClose = () => {
    onClose();
    setCreateTradeError(null);
  };

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
            <div className="bg-[#0c0c0c] rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    <ArrowLeftRight className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Open Trade</h2>
                    <p className="text-[11px] text-gray-500">Initiate a trade with a customer</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Form */}
              <div className="p-5 space-y-4">
                {/* Trade Type */}
                <div>
                  <label className="text-[11px] text-gray-400 mb-1.5 block">Trade Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "sell" }))}
                      className={`py-3 rounded-xl text-xs font-medium transition-all ${
                        openTradeForm.tradeType === "sell"
                          ? "bg-white/10 text-white border border-white/6"
                          : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>Sell USDC</span>
                        <span className="text-[9px] text-gray-500">You send USDC, get AED</span>
                      </div>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "buy" }))}
                      className={`py-3 rounded-xl text-xs font-medium transition-all ${
                        openTradeForm.tradeType === "buy"
                          ? "bg-white/10 text-white/70 border border-white/6"
                          : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>Buy USDC</span>
                        <span className="text-[9px] text-gray-500">You send AED, get USDC</span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* USDC Amount */}
                <div>
                  <label className="text-[11px] text-gray-400 mb-1.5 block">USDC Amount</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={openTradeForm.cryptoAmount}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        setOpenTradeForm(prev => ({ ...prev, cryptoAmount: value }));
                      }}
                      className="w-full bg-white/[0.04] rounded-xl px-4 py-3 pr-16 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-500">USDC</span>
                  </div>
                  {openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount || "0") > effectiveBalance && (
                    <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Exceeds your wallet balance ({effectiveBalance.toLocaleString()} USDC)
                    </p>
                  )}
                </div>

                {/* Payment Method */}
                <div>
                  <label className="text-[11px] text-gray-400 mb-1.5 block">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, paymentMethod: "bank" }))}
                      className={`py-2.5 rounded-xl text-xs font-medium transition-all ${
                        openTradeForm.paymentMethod === "bank"
                          ? "bg-white/10 text-white border border-white/20"
                          : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                      }`}
                    >
                      Bank Transfer
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, paymentMethod: "cash" }))}
                      className={`py-2.5 rounded-xl text-xs font-medium transition-all ${
                        openTradeForm.paymentMethod === "cash"
                          ? "bg-white/10 text-white border border-white/20"
                          : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                      }`}
                    >
                      Cash
                    </button>
                  </div>
                </div>

                {/* Spread Preference / Speed */}
                <div>
                  <label className="text-[11px] text-gray-400 mb-1.5 block">Match Speed & Fee</label>
                  <div className="grid grid-cols-3 gap-1.5 bg-white/[0.03] p-1.5 rounded-xl border border-white/[0.04]">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'best' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all ${
                        openTradeForm.spreadPreference === 'best'
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-gray-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <p className="text-xs font-bold">Best</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">2.0%</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'fastest' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all ${
                        openTradeForm.spreadPreference === 'fastest'
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-gray-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <p className="text-xs font-bold">Fast</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">2.5%</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'cheap' }))}
                      className={`px-3 py-3 rounded-lg text-center transition-all ${
                        openTradeForm.spreadPreference === 'cheap'
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-gray-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <p className="text-xs font-bold">Cheap</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">1.5%</p>
                    </button>
                  </div>
                  <div className="mt-2 text-center">
                    <p className="text-[10px] text-gray-500">
                      {openTradeForm.spreadPreference === 'best' && 'Instant match - Any spread above 2% is your profit'}
                      {openTradeForm.spreadPreference === 'fastest' && '<5min match - Any spread above 2.5% is your profit'}
                      {openTradeForm.spreadPreference === 'cheap' && 'Best price - Any spread above 1.5% is your profit'}
                    </p>
                  </div>
                </div>

                {/* Order Expiry */}
                <div>
                  <label className="text-[11px] text-gray-400 mb-1.5 block">Order Expiry</label>
                  <div className="flex items-center gap-2 bg-white/[0.03] p-1.5 rounded-xl border border-white/[0.04]">
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, expiryMinutes: 15 as 15 | 90 }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-center transition-all ${
                        openTradeForm.expiryMinutes === 15
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-gray-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <p className="text-xs font-bold">15 min</p>
                      <p className="text-[9px] text-gray-500 mt-0.5">Default</p>
                    </button>
                    <button
                      onClick={() => setOpenTradeForm(prev => ({ ...prev, expiryMinutes: 90 as 15 | 90 }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-center transition-all ${
                        openTradeForm.expiryMinutes === 90
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-gray-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <p className="text-xs font-bold">90 min</p>
                      <p className="text-[9px] text-gray-500 mt-0.5">Extended</p>
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
                        <span className="text-gray-500">USDC Amount</span>
                        <span className="text-white">{parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Rate (est.)</span>
                        <span className="text-white">3.67 AED/USDC</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-white/[0.04]">
                        <span className="text-gray-400">AED Amount</span>
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
                  className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] text-gray-400 hover:bg-white/[0.04] transition-colors"
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
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-white/10 text-black hover:bg-white/10'
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
