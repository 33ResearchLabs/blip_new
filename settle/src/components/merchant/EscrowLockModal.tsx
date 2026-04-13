"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Lock,
  AlertTriangle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import type { Order } from "@/types/merchant";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

interface EscrowLockModalProps {
  showEscrowModal: boolean;
  escrowOrder: Order | null;
  isLockingEscrow: boolean;
  escrowTxHash: string | null;
  escrowError: string | null;
  effectiveBalance: number | null;
  onClose: () => void;
  onExecute: () => void;
}

export function EscrowLockModal({
  showEscrowModal,
  escrowOrder,
  isLockingEscrow,
  escrowTxHash,
  escrowError,
  effectiveBalance,
  onClose,
  onExecute,
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
            onClick={() => !isLockingEscrow && onClose()}
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
                    <Lock className="w-5 h-5 text-white/70" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Lock Escrow</h2>
                    <p className="text-[11px] text-foreground/35">Secure USDC for this trade</p>
                  </div>
                </div>
                {!isLockingEscrow && (
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
                      {escrowOrder.emoji}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{escrowOrder.user}</p>
                      <p className="text-xs text-foreground/35">
                        {escrowOrder.orderType === 'sell'
                          ? 'Sell Order — anyone can accept'
                          : `Buy Order — ${escrowOrder.user}`}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-foreground/35 uppercase mb-1">Amount</p>
                      <p className="text-lg font-bold text-white">{escrowOrder.amount} USDC</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground/35 uppercase mb-1">Fiat Value</p>
                      <p className="text-lg font-bold text-white">د.إ {Math.round(escrowOrder.total).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Wallet Balance */}
                <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                  <span className="text-xs text-foreground/35">Your USDC Balance</span>
                  <span className={`text-sm font-bold ${(effectiveBalance || 0) >= escrowOrder.amount ? 'text-white' : 'text-red-400'}`}>
                    {effectiveBalance != null ? effectiveBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'} USDC
                  </span>
                </div>

                {/* Counterparty Wallet */}
                {(() => {
                  const counterpartyWallet = escrowOrder.buyerMerchantWallet || escrowOrder.acceptorWallet || escrowOrder.userWallet;
                  if (!counterpartyWallet) return null;
                  const short = `${counterpartyWallet.slice(0, 6)}...${counterpartyWallet.slice(-4)}`;
                  return (
                    <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-foreground/35">Counterparty Wallet</span>
                      <a
                        href={`https://solscan.io/account/${counterpartyWallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-sm font-mono text-primary hover:text-primary/80 transition-colors"
                      >
                        {short}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  );
                })()}

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
                        className="flex items-center gap-2 text-xs text-white hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                      {escrowOrder?.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(escrowOrder.escrowPda)}
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
                  const validWalletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
                  const isValidWalletUI = (addr: string | undefined | null): boolean => {
                    if (!addr) return false;
                    return validWalletRegex.test(addr);
                  };
                  const hasBuyerMerchantWallet = isValidWalletUI(escrowOrder.buyerMerchantWallet);
                  const hasAcceptorWallet = isValidWalletUI(escrowOrder.acceptorWallet);
                  const hasUserWallet = isValidWalletUI(escrowOrder.userWallet);
                  const hasValidRecipient = hasBuyerMerchantWallet || hasAcceptorWallet || hasUserWallet;
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
                    onClick={onClose}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-accent-subtle border border-white/6 hover:border-border-strong text-white transition-all"
                  >
                    Done
                  </motion.button>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      disabled={isLockingEscrow}
                      className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-accent-subtle transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={onExecute}
                      disabled={
                        isLockingEscrow ||
                        (effectiveBalance || 0) < escrowOrder.amount
                      }
                      className="flex-[2] py-3 rounded-xl text-sm font-bold bg-primary hover:bg-primary/80 text-background transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
