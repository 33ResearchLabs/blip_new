'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Lock,
  Unlock,
  RotateCcw,
  X,
  Loader2,
  Check,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { getSolscanTxUrl, getBlipscanTradeUrl } from '@/lib/explorer';
import type { Order } from '@/types/merchant';

// ---------------------------------------------------------------------------
// EscrowLockModal
// ---------------------------------------------------------------------------

export interface EscrowLockModalProps {
  showEscrowModal: boolean;
  escrowOrder: Order | null;
  isLockingEscrow: boolean;
  escrowTxHash: string | null;
  escrowError: string | null;
  effectiveBalance: number | null;
  isMockMode: boolean;
  IS_EMBEDDED_WALLET: boolean;
  closeEscrowModal: () => void;
  executeLockEscrow: () => void;
}

export function EscrowLockModal({
  showEscrowModal,
  escrowOrder,
  isLockingEscrow,
  escrowTxHash,
  escrowError,
  effectiveBalance,
  isMockMode,
  IS_EMBEDDED_WALLET,
  closeEscrowModal,
  executeLockEscrow,
}: EscrowLockModalProps) {
  return (
    <AnimatePresence>
      {showEscrowModal && escrowOrder && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={() => !isLockingEscrow && closeEscrowModal()}
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
                    <Lock className="w-5 h-5 text-white/70" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Lock Escrow</h2>
                    <p className="text-[11px] text-gray-500">Secure USDC for this trade</p>
                  </div>
                </div>
                {!isLockingEscrow && (
                  <button
                    onClick={closeEscrowModal}
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
                      {escrowOrder.emoji}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{escrowOrder.user}</p>
                      <p className="text-xs text-gray-500">{escrowOrder.orderType === 'sell' ? 'Sell Order' : 'Buy Order'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Amount</p>
                      <p className="text-lg font-bold text-white">{escrowOrder.amount} USDC</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Value</p>
                      <p className="text-lg font-bold text-white">د.إ {Math.round(escrowOrder.total).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Wallet Balance */}
                <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                  <span className="text-xs text-gray-500">Your USDC Balance</span>
                  <span className={`text-sm font-bold ${(effectiveBalance || 0) >= escrowOrder.amount ? 'text-white' : 'text-red-400'}`}>
                    {effectiveBalance?.toFixed(2) || '0.00'} USDC
                  </span>
                </div>

                {/* Transaction Status */}
                {isLockingEscrow && !escrowTxHash && (
                  <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                      <div>
                        <p className="text-sm font-medium text-white/70">Processing Transaction</p>
                        <p className="text-xs text-white/40">{IS_EMBEDDED_WALLET ? 'Signing and sending on-chain...' : 'Please approve in your wallet...'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success State */}
                {escrowTxHash && (
                  <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Escrow Locked Successfully!</p>
                        <p className="text-xs text-white/70">USDC is now secured on-chain</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(escrowTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                      {escrowOrder?.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(escrowOrder.escrowPda)}
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
                {escrowError && (
                  <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                      <div>
                        <p className="text-sm font-medium text-red-400">Transaction Failed</p>
                        <p className="text-xs text-red-400/70">{escrowError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Warning / Info */}
                {!escrowTxHash && !isLockingEscrow && (() => {
                  // Determine recipient wallet - check all possible sources
                  const validWalletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
                  const isValidWalletUI = (addr: string | undefined | null): boolean => {
                    if (!addr) return false;
                    return isMockMode ? addr.length > 0 : validWalletRegex.test(addr);
                  };
                  const hasBuyerMerchantWallet = isValidWalletUI(escrowOrder.buyerMerchantWallet);
                  const hasAcceptorWallet = isValidWalletUI(escrowOrder.acceptorWallet);
                  const hasUserWallet = isValidWalletUI(escrowOrder.userWallet);
                  const hasValidRecipient = hasBuyerMerchantWallet || hasAcceptorWallet || hasUserWallet;
                  // M2M trade: isM2M flag, buyerMerchantWallet, OR acceptorWallet (merchant accepted open order)
                  const isMerchantTrade = escrowOrder.isM2M || !!hasBuyerMerchantWallet || hasAcceptorWallet;

                  if (hasValidRecipient) {
                    return isMerchantTrade ? (
                      <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                        <p className="text-xs text-white/70">
                          🤝 <strong>Merchant Trade:</strong> You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                          This will be released to the other merchant after they pay the fiat amount.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                        <p className="text-xs text-white/70">
                          ⚠️ You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow on-chain.
                          This will be released to the buyer after they pay you the fiat amount.
                        </p>
                      </div>
                    );
                  } else {
                    // No recipient yet (SELL order before anyone accepts)
                    return (
                      <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                        <p className="text-xs text-white/70">
                          🔒 You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                          Once locked, your order will be visible to other merchants who can accept it.
                        </p>
                      </div>
                    );
                  }
                })()}

              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                {escrowTxHash ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={closeEscrowModal}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                  >
                    Done
                  </motion.button>
                ) : (
                  <>
                    <button
                      onClick={closeEscrowModal}
                      disabled={isLockingEscrow}
                      className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={executeLockEscrow}
                      disabled={
                        isLockingEscrow ||
                        (effectiveBalance || 0) < escrowOrder.amount
                      }
                      className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isLockingEscrow ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Locking...
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4" />
                          Lock {escrowOrder.amount} USDC
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

// ---------------------------------------------------------------------------
// EscrowReleaseModal
// ---------------------------------------------------------------------------

export interface EscrowReleaseModalProps {
  showReleaseModal: boolean;
  releaseOrder: Order | null;
  isReleasingEscrow: boolean;
  releaseTxHash: string | null;
  releaseError: string | null;
  isMockMode: boolean;
  closeReleaseModal: () => void;
  executeRelease: () => void;
}

export function EscrowReleaseModal({
  showReleaseModal,
  releaseOrder,
  isReleasingEscrow,
  releaseTxHash,
  releaseError,
  isMockMode,
  closeReleaseModal,
  executeRelease,
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
            onClick={() => !isReleasingEscrow && closeReleaseModal()}
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
                    onClick={closeReleaseModal}
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
                    {(isMockMode || (releaseOrder.escrowTradeId && releaseOrder.escrowCreatorWallet && releaseOrder.userWallet)) ? (
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
                    onClick={closeReleaseModal}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                  >
                    Done
                  </motion.button>
                ) : (
                  <>
                    <button
                      onClick={closeReleaseModal}
                      disabled={isReleasingEscrow}
                      className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={executeRelease}
                      disabled={isReleasingEscrow || (!isMockMode && (!releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet))}
                      className={`flex-[2] py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                        isReleasingEscrow || (!isMockMode && (!releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet))
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

// ---------------------------------------------------------------------------
// EscrowCancelModal
// ---------------------------------------------------------------------------

export interface EscrowCancelModalProps {
  showCancelModal: boolean;
  cancelOrder: Order | null;
  isCancellingEscrow: boolean;
  cancelTxHash: string | null;
  cancelError: string | null;
  closeCancelModal: () => void;
  executeCancelEscrow: () => void;
}

export function EscrowCancelModal({
  showCancelModal,
  cancelOrder,
  isCancellingEscrow,
  cancelTxHash,
  cancelError,
  closeCancelModal,
  executeCancelEscrow,
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
            onClick={() => !isCancellingEscrow && closeCancelModal()}
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
                    <RotateCcw className="w-5 h-5 text-white/70" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Cancel & Withdraw</h2>
                    <p className="text-[11px] text-gray-500">Refund escrow to your wallet</p>
                  </div>
                </div>
                {!isCancellingEscrow && (
                  <button
                    onClick={closeCancelModal}
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
                      {cancelOrder.emoji}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{cancelOrder.user}</p>
                      <p className="text-xs text-gray-500">Buy Order - Escrow Locked</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Withdraw Amount</p>
                      <p className="text-lg font-bold text-white/70">{cancelOrder.amount} USDC</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase mb-1">Order Total</p>
                      <p className="text-lg font-bold text-white">د.إ {Math.round(cancelOrder.total).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Escrow Details */}
                {cancelOrder.escrowTradeId && (
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <span className="text-xs text-gray-500">Escrow Trade ID</span>
                    <span className="text-xs font-mono text-gray-400">#{cancelOrder.escrowTradeId}</span>
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
                        <p className="text-xs text-white/70">{cancelOrder.amount} USDC returned to your wallet</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(cancelTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                      {cancelOrder?.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(cancelOrder.escrowPda)}
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
                          This will cancel the order and return <strong>{cancelOrder.amount} USDC</strong> to your wallet. The buyer will be notified.
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
                    onClick={closeCancelModal}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                  >
                    Done
                  </motion.button>
                ) : (
                  <>
                    <button
                      onClick={closeCancelModal}
                      disabled={isCancellingEscrow}
                      className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                    >
                      Back
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={executeCancelEscrow}
                      disabled={isCancellingEscrow || !cancelOrder.escrowTradeId || !cancelOrder.escrowCreatorWallet}
                      className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
