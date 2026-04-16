"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  RotateCcw,
  AlertTriangle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import type { Order } from "@/types/merchant";

interface EscrowCancelModalProps {
  showCancelModal: boolean;
  cancelOrder: Order | null;
  isCancellingEscrow: boolean;
  cancelTxHash: string | null;
  cancelError: string | null;
  onClose: () => void;
  onExecute: () => void;
}

export function EscrowCancelModal({
  showCancelModal,
  cancelOrder,
  isCancellingEscrow,
  cancelTxHash,
  cancelError,
  onClose,
  onExecute,
}: EscrowCancelModalProps) {
  return (
    <AnimatePresence>
      {showCancelModal && cancelOrder && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={() => !isCancellingEscrow && onClose()}
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
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    <RotateCcw className="w-5 h-5 text-white/70" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Cancel & Withdraw</h2>
                    <p className="text-[11px] text-foreground/35">Refund escrow to your wallet</p>
                  </div>
                </div>
                {!isCancellingEscrow && (
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-card rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-foreground/35" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Order Info */}
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
                      {cancelOrder.emoji}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{cancelOrder.user}</p>
                      <p className="text-xs text-foreground/35">Buy Order - Escrow Locked</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-foreground/35 uppercase mb-1">Withdraw Amount</p>
                      <p className="text-lg font-bold text-white/70">{cancelOrder.amount} USDT</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/35 uppercase mb-1">Order Total</p>
                      <p className="text-lg font-bold text-white">د.إ {Math.round(cancelOrder.total).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Escrow Details */}
                {cancelOrder.escrowTradeId && (
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <span className="text-xs text-foreground/35">Escrow Trade ID</span>
                    <span className="text-xs font-mono text-foreground/40">#{cancelOrder.escrowTradeId}</span>
                  </div>
                )}

                {/* Transaction Status */}
                {isCancellingEscrow && !cancelTxHash && (
                  <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                      <div>
                        <p className="text-sm font-medium text-white/70">Processing Refund</p>
                        <p className="text-xs text-white/40">Please approve in your wallet...</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success State */}
                {cancelTxHash && (
                  <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Escrow Refunded!</p>
                        <p className="text-xs text-white/70">{cancelOrder.amount} USDT returned to your wallet</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(cancelTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                      {cancelOrder?.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(cancelOrder.escrowPda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          BlipScan
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Error State */}
                {cancelError && (
                  <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                      <div>
                        <p className="text-sm font-medium text-red-400">Refund Failed</p>
                        <p className="text-xs text-red-400/70">{cancelError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Warning */}
                {!cancelTxHash && !isCancellingEscrow && (
                  <>
                    {cancelOrder.escrowTradeId && cancelOrder.escrowCreatorWallet ? (
                      <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                        <p className="text-xs text-white/70">
                          This will cancel the order and return <strong>{cancelOrder.amount} USDT</strong> to your wallet. The buyer will be notified.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                        <p className="text-xs text-red-400">
                          Missing on-chain escrow details. Cannot refund.
                          {!cancelOrder.escrowTradeId && ' (No Trade ID)'}
                          {!cancelOrder.escrowCreatorWallet && ' (No Creator Wallet)'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                {cancelTxHash ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={onClose}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-accent-subtle border border-white/6 hover:border-border-strong text-white transition-all"
                  >
                    Done
                  </motion.button>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      disabled={isCancellingEscrow}
                      className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-accent-subtle transition-colors disabled:opacity-50"
                    >
                      Back
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={onExecute}
                      disabled={isCancellingEscrow || !cancelOrder.escrowTradeId || !cancelOrder.escrowCreatorWallet}
                      className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-accent-subtle border border-white/6 hover:border-border-strong text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isCancellingEscrow ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Refunding...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-4 h-4" />
                          Cancel & Withdraw
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
