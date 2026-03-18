"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Unlock,
  AlertTriangle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import type { Order } from "@/types/merchant";

interface EscrowReleaseModalProps {
  showReleaseModal: boolean;
  releaseOrder: Order | null;
  isReleasingEscrow: boolean;
  releaseTxHash: string | null;
  releaseError: string | null;
  onClose: () => void;
  onExecute: () => void;
}

export function EscrowReleaseModal({
  showReleaseModal,
  releaseOrder,
  isReleasingEscrow,
  releaseTxHash,
  releaseError,
  onClose,
  onExecute,
}: EscrowReleaseModalProps) {
  return (
    <AnimatePresence>
      {showReleaseModal && releaseOrder && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={() => !isReleasingEscrow && onClose()}
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
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    <Unlock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Release Escrow</h2>
                    <p className="text-[11px] text-gray-500">Confirm payment & release USDC</p>
                  </div>
                </div>
                {!isReleasingEscrow && (
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Order Info */}
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
                      {releaseOrder.emoji}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{releaseOrder.user}</p>
                      <p className="text-xs text-gray-500">Buy Order - Payment Received</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Release Amount</p>
                      <p className="text-lg font-bold text-white">{releaseOrder.amount} USDC</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Received</p>
                      <p className="text-lg font-bold text-white">د.إ {Math.round(releaseOrder.total).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Escrow Details */}
                {releaseOrder.escrowTradeId && (
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <span className="text-xs text-gray-500">Escrow Trade ID</span>
                    <span className="text-xs font-mono text-gray-400">#{releaseOrder.escrowTradeId}</span>
                  </div>
                )}

                {/* Transaction Status */}
                {isReleasingEscrow && !releaseTxHash && (
                  <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                      <div>
                        <p className="text-sm font-medium text-white">Processing Release</p>
                        <p className="text-xs text-white/70">Please approve in your wallet...</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success State */}
                {releaseTxHash && (
                  <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Escrow Released!</p>
                        <p className="text-xs text-white/70">{releaseOrder.amount} USDC sent to buyer</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(releaseTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                      {releaseOrder?.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(releaseOrder.escrowPda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          BlipScan
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Error State */}
                {releaseError && (
                  <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                      <div>
                        <p className="text-sm font-medium text-red-400">Release Failed</p>
                        <p className="text-xs text-red-400/70">{releaseError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Warning / Info */}
                {!releaseTxHash && !isReleasingEscrow && (
                  <>
                    {(releaseOrder.escrowTradeId && releaseOrder.escrowCreatorWallet && releaseOrder.userWallet) ? (
                      <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.08]">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                            <Check className="w-4 h-4 text-white/70" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white/70 mb-1">Ready to Release</p>
                            <p className="text-xs text-white/70">
                              Confirm you received <strong className="text-white">{releaseOrder.amount} USDC worth of AED</strong>.
                              Once released, the crypto will be sent to the buyer and <strong className="text-white">cannot be reversed</strong>.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-red-400 mb-1">Cannot Release Escrow</p>
                            <p className="text-xs text-red-400/80">
                              Missing on-chain escrow details. This order may not have been locked on-chain yet.
                            </p>
                            <ul className="text-xs text-red-400/70 mt-2 space-y-1">
                              {!releaseOrder.escrowTradeId && <li>• Missing Trade ID</li>}
                              {!releaseOrder.escrowCreatorWallet && <li>• Missing Creator Wallet</li>}
                              {!releaseOrder.userWallet && <li>• Missing Buyer Wallet</li>}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                {releaseTxHash ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={onClose}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                  >
                    Done
                  </motion.button>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      disabled={isReleasingEscrow}
                      className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={onExecute}
                      disabled={isReleasingEscrow || !releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet}
                      className={`flex-[2] py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                        isReleasingEscrow || !releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet
                          ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                          : 'bg-orange-500 hover:bg-orange-400 text-black'
                      }`}
                    >
                      {isReleasingEscrow ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Releasing...
                        </>
                      ) : (
                        <>
                          <Unlock className="w-4 h-4" />
                          Release Escrow
                        </>
                      )}
                    </motion.button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
