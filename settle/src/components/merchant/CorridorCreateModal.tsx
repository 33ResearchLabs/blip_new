"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Activity,
  ArrowRight,
  ArrowLeftRight,
  Globe,
  Percent,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { showAlert } from '@/context/ModalContext';

export interface CorridorFormState {
  fromCurrency: string;
  toCurrency: string;
  availableAmount: string;
  minAmount: string;
  maxAmount: string;
  rate: string;
  premium: string;
}

export interface CorridorCreateModalProps {
  isOpen: boolean;
  corridorForm: CorridorFormState;
  setCorridorForm: React.Dispatch<React.SetStateAction<CorridorFormState>>;
  effectiveBalance: number | null;
  merchantId: string | null;
  solanaWalletAddress: string | null;
  onClose: () => void;
  onRefreshBalance: () => void;
  onFetchActiveOffers: () => void;
}

export function CorridorCreateModal({
  isOpen,
  corridorForm,
  setCorridorForm,
  effectiveBalance,
  merchantId,
  solanaWalletAddress,
  onClose,
  onRefreshBalance,
  onFetchActiveOffers,
}: CorridorCreateModalProps) {
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
            <div className="bg-card-solid rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center">
                    <ArrowLeftRight className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Open Corridor</h2>
                    <p className="text-[11px] text-foreground/35">Set your trading parameters</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-card rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-foreground/35" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Wallet Balance Banner */}
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">&#x20AE;</span>
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
                      onClick={onRefreshBalance}
                      className="p-2 hover:bg-card rounded-lg transition-colors"
                      title="Refresh balance"
                    >
                      <Activity className="w-4 h-4 text-white/70" />
                    </button>
                  </div>
                </div>

                {/* Currency Pair */}
                <div>
                  <label className="text-[11px] text-foreground/35 uppercase tracking-wide mb-2 block">Currency Pair</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold">&#x20AE;</span>
                      </div>
                      <div>
                        <p className="text-xs font-medium">USDT</p>
                        <p className="text-[10px] text-foreground/35">From</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-600" />
                    <div className="flex-1 bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
                      <span className="text-lg">{'\uD83C\uDDE6\uD83C\uDDEA'}</span>
                      <div>
                        <p className="text-xs font-medium">AED</p>
                        <p className="text-[10px] text-foreground/35">To</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Available Amount */}
                <div>
                  <label className="text-[11px] text-foreground/35 uppercase tracking-wide mb-2 block">Amount to Offer (USDT)</label>
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/70 font-medium hover:text-foreground/50"
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
                  <p className="text-[10px] text-foreground/35 mt-1 ml-1">Total USDT you want to make available for trading</p>
                </div>

                {/* Order Range */}
                <div>
                  <label className="text-[11px] text-foreground/35 uppercase tracking-wide mb-2 block">Order Range (USDT)</label>
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
                      <p className="text-[10px] text-foreground/35 mt-1 ml-1">Min per order</p>
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
                      <p className="text-[10px] text-foreground/35 mt-1 ml-1">Max per order</p>
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
                    <label className="text-[11px] text-foreground/35 uppercase tracking-wide mb-2 block">Base Rate</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="3.67"
                        value={corridorForm.rate}
                        onChange={(e) => setCorridorForm(prev => ({ ...prev, rate: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-foreground/35">AED</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-foreground/35 uppercase tracking-wide mb-2 block">Your Fee</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.25"
                        value={corridorForm.premium}
                        onChange={(e) => setCorridorForm(prev => ({ ...prev, premium: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                      />
                      <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/35" />
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-white/5 border border-white/6 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-3.5 h-3.5 text-white" />
                    <span className="text-[11px] font-medium text-white">Corridor Preview</span>
                  </div>
                  <p className="text-xs text-foreground/40">
                    Offering <span className="text-white/70 font-medium">{corridorForm.availableAmount || "0"} USDT</span> total. Accept orders from <span className="text-white font-medium">{corridorForm.minAmount || "100"}</span> to <span className="text-white font-medium">{corridorForm.maxAmount || "10,000"}</span> USDT at <span className="text-white font-medium">{corridorForm.rate || "3.67"}</span> AED + <span className="text-white font-medium">{corridorForm.premium || "0.25"}%</span> fee
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-accent-subtle transition-colors"
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
                    const availableAmount = parseFloat(corridorForm.availableAmount || "0");
                    if (availableAmount > (effectiveBalance || 0)) {
                      showAlert('Invalid Amount', 'Amount exceeds your wallet balance', 'warning');
                      return;
                    }
                    if (availableAmount <= 0) {
                      showAlert('Invalid Amount', 'Please enter a valid amount', 'warning');
                      return;
                    }
                    try {
                      const rate = parseFloat(corridorForm.rate || "3.67");
                      const premium = parseFloat(corridorForm.premium || "0.25") / 100;
                      const effectiveRate = rate * (1 + premium);

                      const res = await fetchWithAuth("/api/merchant/offers", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          merchant_id: merchantId,
                          type: "sell",
                          payment_method: "bank",
                          rate: effectiveRate,
                          min_amount: parseFloat(corridorForm.minAmount || "100"),
                          max_amount: parseFloat(corridorForm.maxAmount || "10000"),
                          available_amount: availableAmount,
                          bank_name: "Emirates NBD",
                          bank_account_name: "QuickSwap LLC",
                          bank_iban: "AE070331234567890123456",
                          wallet_address: solanaWalletAddress,
                        }),
                      });
                      if (!res.ok) {
                        console.error("Failed to create offer:", res.status);
                        return;
                      }
                      const data = await res.json();
                      if (data.success) {
                        onClose();
                        onFetchActiveOffers();
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
                      ? 'bg-gray-600 text-foreground/40 cursor-not-allowed'
                      : 'bg-white text-background hover:bg-accent'
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
