"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  ArrowRight,
  Activity,
  Plus,
  Loader2,
  AlertTriangle,
  Percent,
  X,
  Globe,
  Zap,
} from "lucide-react";
import type { Order } from "@/types/merchant";
import type { Notification } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { showAlert } from "@/stores/confirmationStore";
import type { SoundType } from "@/hooks/useSounds";

// ─── Corridor Form Types ───────────────────────────────────────────────────────

export interface CorridorFormState {
  fromCurrency: string;
  toCurrency: string;
  availableAmount: string;
  minAmount: string;
  maxAmount: string;
  rate: string;
  premium: string;
}

export interface CreateCorridorModalProps {
  isOpen: boolean;
  onClose: () => void;
  corridorForm: CorridorFormState;
  setCorridorForm: React.Dispatch<React.SetStateAction<CorridorFormState>>;
  effectiveBalance: number | null;
  refreshBalance: () => void;
  merchantId: string | null;
  solanaWallet: { walletAddress: string; depositToEscrowOpen: (opts: any) => Promise<any> };
  fetchActiveOffers: () => void;
}

// ─── Open Trade Form Types ─────────────────────────────────────────────────────

export interface OpenTradeFormState {
  tradeType: "buy" | "sell";
  cryptoAmount: string;
  paymentMethod: "bank" | "cash";
  spreadPreference: "best" | "fastest" | "cheap";
  expiryMinutes: 15 | 90;
}

export interface OpenTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  openTradeForm: OpenTradeFormState;
  setOpenTradeForm: React.Dispatch<React.SetStateAction<OpenTradeFormState>>;
  effectiveBalance: number | null;
  refreshBalance: () => void;
  merchantId: string | null;
  isMockMode: boolean;
  tradeAmountWarning: string | null;
  isCreatingTrade: boolean;
  setIsCreatingTrade: React.Dispatch<React.SetStateAction<boolean>>;
  createTradeError: string | null;
  setCreateTradeError: React.Dispatch<React.SetStateAction<string | null>>;
  solanaWallet: { walletAddress: string; depositToEscrowOpen: (opts: any) => Promise<any> };
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  playSound: (sound: SoundType) => void;
  addNotification: (type: Notification["type"], message: string, orderId?: string) => void;
}

// ─── CreateCorridorModal ────────────────────────────────────────────────────────

export function CreateCorridorModal({
  isOpen,
  onClose,
  corridorForm,
  setCorridorForm,
  effectiveBalance,
  refreshBalance,
  merchantId,
  solanaWallet,
  fetchActiveOffers,
}: CreateCorridorModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <div className="bg-[#0c0c0c] rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center">
                    <ArrowLeftRight className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Open Corridor</h2>
                    <p className="text-[11px] text-gray-500">Set your trading parameters</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Wallet Balance Banner */}
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">₮</span>
                      </div>
                      <div>
                        <p className="text-[10px] text-white/70 uppercase tracking-wide">Available Balance</p>
                        <p className="text-sm font-bold text-white/70">
                          {effectiveBalance !== null
                            ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                            : 'Loading...'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => refreshBalance()}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                      title="Refresh balance"
                    >
                      <Activity className="w-4 h-4 text-white/70" />
                    </button>
                  </div>
                </div>

                {/* Currency Pair */}
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Currency Pair</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold">₮</span>
                      </div>
                      <div>
                        <p className="text-xs font-medium">USDT</p>
                        <p className="text-[10px] text-gray-500">From</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-600" />
                    <div className="flex-1 bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
                      <span className="text-lg">🇦🇪</span>
                      <div>
                        <p className="text-xs font-medium">AED</p>
                        <p className="text-[10px] text-gray-500">To</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Available Amount */}
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Amount to Offer (USDT)</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="1,000"
                      value={corridorForm.availableAmount}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        setCorridorForm(prev => ({ ...prev, availableAmount: value }));
                      }}
                      className={`w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 ${
                        parseFloat(corridorForm.availableAmount || '0') > (effectiveBalance || 0)
                          ? 'focus:ring-red-500/50 border border-red-500/30'
                          : 'focus:ring-white/20'
                      }`}
                    />
                    <button
                      onClick={() => {
                        if (effectiveBalance !== null) {
                          setCorridorForm(prev => ({ ...prev, availableAmount: effectiveBalance!.toString() }));
                        }
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/70 font-medium hover:text-white/50"
                    >
                      MAX
                    </button>
                  </div>
                  {parseFloat(corridorForm.availableAmount || '0') > (effectiveBalance || 0) && (
                    <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Exceeds your wallet balance
                    </p>
                  )}
                  <p className="text-[10px] text-gray-500 mt-1 ml-1">Total USDT you want to make available for trading</p>
                </div>

                {/* Order Range */}
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Order Range (USDT)</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="100"
                        value={corridorForm.minAmount}
                        onChange={(e) => setCorridorForm(prev => ({ ...prev, minAmount: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                      />
                      <p className="text-[10px] text-gray-500 mt-1 ml-1">Min per order</p>
                    </div>
                    <span className="text-gray-600">&mdash;</span>
                    <div className="flex-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="10,000"
                        value={corridorForm.maxAmount}
                        onChange={(e) => setCorridorForm(prev => ({ ...prev, maxAmount: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className={`w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 ${
                          parseFloat(corridorForm.maxAmount || '0') > parseFloat(corridorForm.availableAmount || '0') && corridorForm.availableAmount
                            ? 'focus:ring-white/20 border border-white/6'
                            : 'focus:ring-white/20'
                        }`}
                      />
                      <p className="text-[10px] text-gray-500 mt-1 ml-1">Max per order</p>
                    </div>
                  </div>
                  {parseFloat(corridorForm.maxAmount || '0') > parseFloat(corridorForm.availableAmount || '0') && corridorForm.availableAmount && (
                    <p className="text-[10px] text-white/70 mt-1 ml-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Max order exceeds available amount
                    </p>
                  )}
                </div>

                {/* Rate & Premium */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Base Rate</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="3.67"
                        value={corridorForm.rate}
                        onChange={(e) => setCorridorForm(prev => ({ ...prev, rate: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">AED</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Your Fee</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.25"
                        value={corridorForm.premium}
                        onChange={(e) => setCorridorForm(prev => ({ ...prev, premium: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                      />
                      <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-white/5 border border-white/6 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-3.5 h-3.5 text-white" />
                    <span className="text-[11px] font-medium text-white">Corridor Preview</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Offering <span className="text-white/70 font-medium">{corridorForm.availableAmount || "0"} USDT</span> total. Accept orders from <span className="text-white font-medium">{corridorForm.minAmount || "100"}</span> to <span className="text-white font-medium">{corridorForm.maxAmount || "10,000"}</span> USDT at <span className="text-white font-medium">{corridorForm.rate || "3.67"}</span> AED + <span className="text-white font-medium">{corridorForm.premium || "0.25"}%</span> fee
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={
                    !corridorForm.availableAmount ||
                    parseFloat(corridorForm.availableAmount) <= 0 ||
                    parseFloat(corridorForm.availableAmount) > (effectiveBalance || 0)
                  }
                  onClick={async () => {
                    if (!merchantId) return;
                    // Validate against wallet balance
                    const availableAmount = parseFloat(corridorForm.availableAmount || "0");
                    if (availableAmount > (effectiveBalance || 0)) {
                      showAlert({ title: 'Error', message: "Amount exceeds your wallet balance", variant: 'warning' });
                      return;
                    }
                    if (availableAmount <= 0) {
                      showAlert({ title: 'Validation', message: "Please enter a valid amount", variant: 'warning' });
                      return;
                    }
                    try {
                      const rate = parseFloat(corridorForm.rate || "3.67");
                      const premium = parseFloat(corridorForm.premium || "0.25") / 100;
                      const effectiveRate = rate * (1 + premium);

                      const res = await fetch("/api/merchant/offers", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          merchant_id: merchantId,
                          type: "sell", // Merchant sells AED, user buys AED
                          payment_method: "bank",
                          rate: effectiveRate,
                          min_amount: parseFloat(corridorForm.minAmount || "1"),
                          max_amount: parseFloat(corridorForm.maxAmount || "10000"),
                          available_amount: availableAmount,
                          bank_name: "Emirates NBD",
                          bank_account_name: "QuickSwap LLC",
                          bank_iban: "AE070331234567890123456",
                          wallet_address: solanaWallet.walletAddress, // Store merchant wallet
                        }),
                      });
                      if (!res.ok) {
                        console.error("Failed to create offer:", res.status);
                        return;
                      }
                      const data = await res.json();
                      if (data.success) {
                        onClose();
                        // Refresh active offers list
                        fetchActiveOffers();
                        // Reset form
                        setCorridorForm({
                          fromCurrency: "USDT",
                          toCurrency: "AED",
                          availableAmount: "",
                          minAmount: "",
                          maxAmount: "",
                          rate: "3.67",
                          premium: "0.25",
                        });
                      }
                    } catch (error) {
                      console.error("Error creating corridor:", error);
                    }
                  }}
                  className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                    !corridorForm.availableAmount ||
                    parseFloat(corridorForm.availableAmount) <= 0 ||
                    parseFloat(corridorForm.availableAmount) > (effectiveBalance || 0)
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-white text-black hover:bg-white/90'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Open Corridor
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── OpenTradeModal ─────────────────────────────────────────────────────────────

export function OpenTradeModal({
  isOpen,
  onClose,
  openTradeForm,
  setOpenTradeForm,
  effectiveBalance,
  refreshBalance,
  merchantId,
  isMockMode,
  tradeAmountWarning,
  isCreatingTrade,
  setIsCreatingTrade,
  createTradeError,
  setCreateTradeError,
  solanaWallet,
  setOrders,
  playSound,
  addNotification,
}: OpenTradeModalProps) {
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
                  {tradeAmountWarning && (
                    <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {tradeAmountWarning}
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

                {/* Spread Preference / Speed - Horizontal Minimal */}
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
                      {openTradeForm.spreadPreference === 'best' && '\u26A1 Instant match \u2022 Any spread above 2% is your profit'}
                      {openTradeForm.spreadPreference === 'fastest' && '\uD83D\uDE80 <5min match \u2022 Any spread above 2.5% is your profit'}
                      {openTradeForm.spreadPreference === 'cheap' && '\uD83D\uDCB0 Best price \u2022 Any spread above 1.5% is your profit'}
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
                  onClick={async () => {
                    if (!merchantId) return;

                    // For SELL orders: Lock escrow FIRST, then create order
                    // For BUY orders: Create order immediately (acceptor will lock escrow)

                    if (openTradeForm.tradeType === "sell") {
                      // Step 1: Find matching merchant and validate
                      setIsCreatingTrade(true);
                      setCreateTradeError(null);

                      try {
                        // Check balance first
                        if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
                          setCreateTradeError(`Insufficient USDC balance. You need ${openTradeForm.cryptoAmount} USDC but have ${effectiveBalance.toFixed(2)} USDC.`);
                          setIsCreatingTrade(false);
                          return;
                        }

                        // Find a merchant BUY offer to match with
                        const offerParams = new URLSearchParams({
                          amount: openTradeForm.cryptoAmount,
                          type: 'buy', // We're selling, so we need buy offers
                          payment_method: openTradeForm.paymentMethod,
                          exclude_merchant: merchantId, // Don't match with ourselves
                        });
                        const offerRes = await fetch(`/api/offers?${offerParams}`);
                        const offerData = await offerRes.json();

                        let matchedOffer: { id: string; merchant?: { wallet_address?: string; display_name?: string } } | null = null;
                        if (offerRes.ok && offerData.success && offerData.data) {
                          matchedOffer = offerData.data;
                        }

                        // Validate counterparty wallet (skip in mock mode)
                        if (!isMockMode) {
                          const counterpartyWallet = matchedOffer?.merchant?.wallet_address;
                          const isValidWallet = counterpartyWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(counterpartyWallet);

                          if (!isValidWallet) {
                            setCreateTradeError('No matching merchant with a linked wallet found. Please try a different amount or wait for merchants to add liquidity.');
                            setIsCreatingTrade(false);
                            return;
                          }
                        }

                        // Step 2: Lock escrow directly (no modal)

                        let escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string };
                        if (isMockMode) {
                          // Mock mode: skip on-chain, generate demo tx hash
                          const mockTxHash = `mock-escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                          escrowResult = { success: true, txHash: mockTxHash };
                        } else {
                          escrowResult = await solanaWallet.depositToEscrowOpen({
                            amount: parseFloat(openTradeForm.cryptoAmount),
                            side: 'sell',
                          });
                        }

                        if (!escrowResult.success || !escrowResult.txHash) {
                          throw new Error(escrowResult.error || 'Escrow transaction failed');
                        }


                        // Step 3: Create order with escrow details
                        const res = await fetch("/api/merchant/orders", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            merchant_id: merchantId,
                            type: openTradeForm.tradeType,
                            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
                            payment_method: openTradeForm.paymentMethod,
                            spread_preference: openTradeForm.spreadPreference,
                            matched_offer_id: matchedOffer?.id,
                            escrow_tx_hash: escrowResult.txHash,
                            escrow_trade_id: escrowResult.tradeId,
                            escrow_trade_pda: escrowResult.tradePda,
                            escrow_pda: escrowResult.escrowPda,
                            escrow_creator_wallet: solanaWallet.walletAddress,
                          }),
                        });

                        const data = await res.json();

                        if (!res.ok || !data.success) {
                          console.error('[Merchant] Create sell order failed:', data);
                          setCreateTradeError(data.error || "Failed to create order after escrow lock");
                          setIsCreatingTrade(false);
                          return;
                        }


                        // Add to orders list
                        if (data.data) {
                          const newOrder = mapDbOrderToUI(data.data, merchantId);
                          setOrders(prev => [newOrder, ...prev]);
                          playSound('trade_complete');
                          addNotification('escrow', `Sell order created! ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC locked in escrow`, data.data?.id);
                        }

                        // Refresh balance
                        refreshBalance();

                        // Success - close modal
                        onClose();
                        setOpenTradeForm({
                          tradeType: "sell",
                          cryptoAmount: "",
                          paymentMethod: "bank",
                          spreadPreference: "fastest",
                          expiryMinutes: 15,
                        });

                      } catch (error) {
                        console.error("Error creating sell order:", error);
                        const errorMsg = error instanceof Error ? error.message : 'Network error';
                        setCreateTradeError(errorMsg);
                      } finally {
                        setIsCreatingTrade(false);
                      }
                      return;
                    }

                    // For BUY orders: Create order immediately (no escrow needed from creator)
                    setIsCreatingTrade(true);
                    setCreateTradeError(null);

                    try {
                      const res = await fetch("/api/merchant/orders", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          merchant_id: merchantId,
                          type: openTradeForm.tradeType,
                          crypto_amount: parseFloat(openTradeForm.cryptoAmount),
                          payment_method: openTradeForm.paymentMethod,
                          spread_preference: openTradeForm.spreadPreference,
                        }),
                      });

                      const data = await res.json();

                      if (!res.ok || !data.success) {
                        console.error('[Merchant] Create trade failed:', data);
                        setCreateTradeError(data.error || "Failed to create trade");
                        return;
                      }


                      // Add to orders list
                      if (data.data) {
                        const newOrder = mapDbOrderToUI(data.data, merchantId);
                        setOrders(prev => [newOrder, ...prev]);
                        addNotification('order', `Buy order created for ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC`, data.data?.id);
                      }

                      // Success - close modal
                      onClose();
                      setOpenTradeForm({
                        tradeType: "sell",
                        cryptoAmount: "",
                        paymentMethod: "bank",
                        spreadPreference: "fastest",
                        expiryMinutes: 15,
                      });
                    } catch (error) {
                      console.error("Error creating buy order:", error);
                      setCreateTradeError("Network error. Please try again.");
                    } finally {
                      setIsCreatingTrade(false);
                    }
                  }}
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
