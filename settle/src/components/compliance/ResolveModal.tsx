"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Shield, Scale, Loader2, Wallet } from "lucide-react";
import type { DisputeOrder, ResolveForm } from "@/hooks/useDisputeManagement";
import { getEmoji } from "./DisputeCard";

interface ResolveModalProps {
  showResolveModal: boolean;
  selectedDispute: DisputeOrder | null;
  resolveForm: ResolveForm;
  setResolveForm: React.Dispatch<React.SetStateAction<ResolveForm>>;
  isProcessingOnChain: boolean;
  walletConnected: boolean;
  walletAddress: string | null;
  memberWalletAddress: string | null | undefined;
  onResolve: () => void;
  onFinalize: () => void;
  onClose: () => void;
}

export default function ResolveModal({
  showResolveModal,
  selectedDispute,
  resolveForm,
  setResolveForm,
  isProcessingOnChain,
  walletConnected,
  walletAddress,
  memberWalletAddress,
  onResolve,
  onFinalize,
  onClose,
}: ResolveModalProps) {
  return (
    <AnimatePresence>
      {showResolveModal && selectedDispute && (
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
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <Scale className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Resolve Dispute</h2>
                    <p className="text-xs text-gray-500">
                      #{selectedDispute.orderNumber} • ${selectedDispute.cryptoAmount.toLocaleString()}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5">
                {/* Parties Summary */}
                <div className="flex items-center gap-4 p-4 bg-[#1a1a1a] rounded-xl">
                  <div className="flex-1 text-center">
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-lg mx-auto mb-2">
                      {getEmoji(selectedDispute.user.name)}
                    </div>
                    <p className="text-xs font-medium">{selectedDispute.user.name}</p>
                    <p className="text-[10px] text-gray-500">{selectedDispute.user.trades} trades</p>
                  </div>
                  <div className="text-gray-600">vs</div>
                  <div className="flex-1 text-center">
                    <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-lg mx-auto mb-2">
                      {getEmoji(selectedDispute.merchant.name)}
                    </div>
                    <p className="text-xs font-medium">{selectedDispute.merchant.name}</p>
                    <p className="text-[10px] text-gray-500">{selectedDispute.merchant.trades} trades</p>
                  </div>
                </div>

                {/* Resolution Options */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-3 block">Resolution</label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => setResolveForm((prev) => ({ ...prev, resolution: "user" }))}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        resolveForm.resolution === "user"
                          ? "border-blue-500/50 bg-blue-500/10"
                          : "border-white/[0.04] hover:border-white/[0.08] bg-[#1a1a1a]"
                      }`}
                    >
                      <span className="text-2xl">{"\u{1F464}"}</span>
                      <span className="text-xs font-medium">Favor User</span>
                    </button>

                    <button
                      onClick={() => setResolveForm((prev) => ({ ...prev, resolution: "split" }))}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        resolveForm.resolution === "split"
                          ? "border-orange-500/50 bg-orange-500/10"
                          : "border-white/[0.04] hover:border-white/[0.08] bg-[#1a1a1a]"
                      }`}
                    >
                      <span className="text-2xl">{"\u2696\uFE0F"}</span>
                      <span className="text-xs font-medium">Split</span>
                    </button>

                    <button
                      onClick={() => setResolveForm((prev) => ({ ...prev, resolution: "merchant" }))}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        resolveForm.resolution === "merchant"
                          ? "border-purple-500/50 bg-purple-500/10"
                          : "border-white/[0.04] hover:border-white/[0.08] bg-[#1a1a1a]"
                      }`}
                    >
                      <span className="text-2xl">{"\u{1F3EA}"}</span>
                      <span className="text-xs font-medium">Favor Merchant</span>
                    </button>
                  </div>
                </div>

                {/* Split Percentages */}
                {resolveForm.resolution === "split" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-2 block">User Gets</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={resolveForm.splitUser}
                          onChange={(e) => {
                            const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                            setResolveForm((prev) => ({
                              ...prev,
                              splitUser: val,
                              splitMerchant: 100 - val,
                            }));
                          }}
                          className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-2 block">Merchant Gets</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={resolveForm.splitMerchant}
                          onChange={(e) => {
                            const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                            setResolveForm((prev) => ({
                              ...prev,
                              splitMerchant: val,
                              splitUser: 100 - val,
                            }));
                          }}
                          className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Notes (Optional)</label>
                  <textarea
                    value={resolveForm.notes}
                    onChange={(e) => setResolveForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Add resolution notes..."
                    rows={3}
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 resize-none focus:ring-1 focus:ring-orange-500/30"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 pb-6 space-y-3">
                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 rounded-xl text-sm font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={onResolve}
                    disabled={!resolveForm.resolution}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-orange-500 text-black hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Propose
                  </motion.button>
                </div>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={onFinalize}
                  disabled={!resolveForm.resolution || isProcessingOnChain}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                >
                  {isProcessingOnChain ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing on-chain...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      Finalize &amp; Release/Refund Escrow
                    </>
                  )}
                </motion.button>
                <p className="text-[10px] text-gray-500 text-center">
                  {memberWalletAddress && walletConnected ? (
                    <span className="text-purple-400">Wallet connected - will process on-chain automatically</span>
                  ) : (
                    "Finalize will update the order status. Connect wallet for automatic on-chain processing."
                  )}
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
