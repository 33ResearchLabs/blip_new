"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  CheckCheck,
} from "lucide-react";
import { getSolscanTxUrl } from "@/lib/explorer";
import { formatFiat, formatCrypto, formatRate } from "@/lib/format";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SURFACES } from "@/components/shared/limits/types";
import type { Order } from "@/types/merchant";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";

// Merchant scope surface tokens (mirrors EscrowLockModal).
const S = SURFACES.merchant;

interface EscrowReleaseModalProps {
  showReleaseModal: boolean;
  releaseOrder: Order | null;
  isReleasingEscrow: boolean;
  releaseTxHash: string | null;
  releaseError: string | null;
  onClose: () => void;
  /** Signs the on-chain release + syncs the backend (useEscrowOperations.executeRelease). */
  onExecute: () => void;
}

/**
 * Confirm-payment / release-escrow modal for the merchant Chat tab.
 *
 * The seller confirms they received the fiat payment, then signs the on-chain
 * release that sends the escrowed USDT to the buyer and completes the order.
 * This mirrors the dashboard's confirm-payment path (it drives
 * useEscrowOperations.executeRelease) — the chat tab previously dispatched
 * CONFIRM_PAYMENT through the generic action endpoint, which only advanced the
 * DB to `payment_confirmed` and never released the crypto.
 */
export function EscrowReleaseModal({
  showReleaseModal,
  releaseOrder,
  isReleasingEscrow,
  releaseTxHash,
  releaseError,
  onClose,
  onExecute,
}: EscrowReleaseModalProps) {
  const currency =
    releaseOrder?.toCurrency || releaseOrder?.dbOrder?.fiat_currency || "";

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
          {/* Bottom sheet on phone/tablet; centered + width-capped from `md` up. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 mx-auto md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <div
              className={`${S.screen} rounded-t-2xl md:rounded-2xl border border-b-0 md:border-b border-border-subtle shadow-2xl overflow-hidden pb-safe md:pb-0 max-h-[90dvh] overflow-y-auto`}
            >
              {/* Drag handle (mobile bottom-sheet affordance only) */}
              <div className="flex justify-center pt-2.5 pb-1 md:hidden">
                <span className="h-1 w-9 rounded-full bg-border-medium" />
              </div>

              {/* Header */}
              <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${S.chip}`}
                  >
                    <CheckCheck className="w-5 h-5 text-text-secondary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-text-primary">
                      Confirm Payment &amp; Release
                    </h2>
                    <p className="text-[11px] text-text-tertiary">
                      Step 5 of 5 · Release USDT to the buyer
                    </p>
                  </div>
                </div>
                {!isReleasingEscrow && (
                  <button
                    onClick={onClose}
                    className={`p-2 rounded-lg transition-colors ${S.hover}`}
                  >
                    <X className="w-4 h-4 text-text-tertiary" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Trade summary */}
                <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <UserAvatar
                      src={releaseOrder.user_avatar}
                      seed={releaseOrder.user}
                      size={44}
                      className="rounded-xl"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {releaseOrder.user}
                      </p>
                      <p className="text-[11px] text-text-tertiary truncate">
                        {releaseOrder.orderType === "sell" ? "Sell Order" : "Buy Order"}
                        {(releaseOrder.dbOrder?.order_number || releaseOrder.id) &&
                          ` · ${releaseOrder.dbOrder?.order_number || releaseOrder.id.slice(0, 8)}`}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase mb-1">
                        You Release
                      </p>
                      <p className="text-lg font-bold text-text-primary">
                        {formatCrypto(releaseOrder.amount)} USDT
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-tertiary uppercase mb-1">
                        You Received
                      </p>
                      <p className="text-lg font-bold text-text-primary">
                        {formatFiat(releaseOrder.total, currency)}
                      </p>
                    </div>
                  </div>

                  {releaseOrder.rate > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between">
                      <span className="text-[11px] text-text-tertiary">Rate</span>
                      <span className="text-[12px] font-medium text-text-primary">
                        1 USDT = {formatRate(releaseOrder.rate)} {currency}
                      </span>
                    </div>
                  )}
                </div>

                {/* Important */}
                {!releaseTxHash && !isReleasingEscrow && (
                  <div className="rounded-xl p-4 border border-warning-border bg-warning-dim">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      <span className="text-[13px] font-semibold text-warning">
                        Release only after payment confirmed
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-[12px] text-warning list-disc pl-4">
                      <li>
                        Only confirm if the fiat payment has arrived in your account.
                      </li>
                      <li>
                        This sends the escrowed USDT to the buyer and cannot be reversed.
                      </li>
                    </ul>
                  </div>
                )}

                {/* Transaction status */}
                {isReleasingEscrow && !releaseTxHash && (
                  <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-text-secondary animate-spin" />
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          Processing Release
                        </p>
                        <p className="text-xs text-text-tertiary">
                          {IS_EMBEDDED_WALLET
                            ? "Signing and sending on-chain..."
                            : "Please approve in your wallet..."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success */}
                {releaseTxHash && (
                  <div className="rounded-xl p-4 border border-success-border bg-success-dim">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                        <Check className="w-4 h-4 text-success" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          Escrow Released!
                        </p>
                        <p className="text-xs text-text-secondary">
                          {formatCrypto(releaseOrder.amount)} USDT sent to the buyer
                        </p>
                      </div>
                    </div>
                    {!releaseTxHash.startsWith("server-release-") &&
                      !releaseTxHash.startsWith("already-released") && (
                        <a
                          href={getSolscanTxUrl(releaseTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View on Solscan
                        </a>
                      )}
                  </div>
                )}

                {/* Error */}
                {releaseError && (
                  <div className="rounded-xl p-4 border border-error-border bg-error-dim">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-error" />
                      <div>
                        <p className="text-sm font-medium text-error">Release Failed</p>
                        <p className="text-xs text-error/80">{releaseError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 space-y-3">
                <div className="flex gap-3">
                  {releaseTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={onClose}
                      className={`flex-1 py-3 rounded-xl text-sm font-bold border border-border-subtle text-text-primary ${S.card} ${S.hover} transition-all`}
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={onClose}
                        disabled={isReleasingEscrow}
                        className={`flex-1 py-3 rounded-xl text-xs font-medium text-text-secondary ${S.card} ${S.hover} transition-colors disabled:opacity-50`}
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={onExecute}
                        disabled={isReleasingEscrow}
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-accent text-accent-text transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isReleasingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Releasing...
                          </>
                        ) : (
                          <>
                            <CheckCheck className="w-4 h-4" />
                            Confirm &amp; Release {formatCrypto(releaseOrder.amount)} USDT
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-center text-text-tertiary inline-flex items-center justify-center gap-1 w-full">
                  <ShieldCheck className="w-3 h-3" />
                  Blip.money protects your trades with secure escrow
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
