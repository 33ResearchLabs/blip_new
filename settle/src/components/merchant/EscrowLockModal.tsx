"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Lock,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Lightbulb,
} from "lucide-react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { formatFiat, formatCrypto, formatRate } from "@/lib/format";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SURFACES } from "@/components/shared/limits/types";
import { EscrowFlowStepper } from "@/components/shared/trade/EscrowFlowStepper";
import { TradeTrustPanel } from "@/components/shared/trade/TradeTrustPanel";
import { useCounterpartyProfile } from "@/components/shared/trade/useCounterpartyProfile";
import { ReceivingAccountPicker } from "@/components/shared/trade/ReceivingAccountPicker";
import { useMerchantReceivingMethods } from "@/components/shared/trade/useMerchantReceivingMethods";
import type { ProfileEntityType } from "@/components/shared/profile/types";
import type { Order } from "@/types/merchant";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// Merchant scope surface tokens (semantic text/border/status/accent classes are
// global; only surfaces differ by app scope — see shared/limits/types.ts).
const S = SURFACES.merchant;

interface EscrowLockModalProps {
  showEscrowModal: boolean;
  escrowOrder: Order | null;
  isLockingEscrow: boolean;
  escrowTxHash: string | null;
  escrowError: string | null;
  effectiveBalance: number | null;
  onClose: () => void;
  /** methodId = the seller's chosen receiving account (shared with the buyer). */
  onExecute: (methodId?: string) => void;
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
  // ── Buyer (counterparty) trust — read-only profile fetch ────────────────
  // The party locking escrow is always the seller; the counterparty is the
  // buyer. Derive its entity from the order (M2M buyer is a merchant, else the
  // order's user).
  const cpType: ProfileEntityType | null = escrowOrder
    ? escrowOrder.isM2M || escrowOrder.buyerMerchantId
      ? "merchant"
      : "user"
    : null;
  const cpId: string | null = escrowOrder
    ? (escrowOrder.isM2M || escrowOrder.buyerMerchantId
        ? escrowOrder.buyerMerchantId
        : escrowOrder.dbOrder?.user_id) ?? null
    : null;
  const buyerTrust = useCounterpartyProfile(
    cpType,
    cpId,
    !!(showEscrowModal && cpId),
  );

  // ── Receiving-account picker — the seller picks which saved account the
  // buyer pays into; the choice is shared with the buyer on lock (req 9).
  const recv = useMerchantReceivingMethods(showEscrowModal && !escrowTxHash);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Auto-select the default (or first) until the seller explicitly picks.
  const defaultAcctId =
    recv.methods.find((m) => m.is_default)?.id ?? recv.methods[0]?.id ?? null;
  const selectedAcctId = pickedId ?? defaultAcctId;

  // "Lock Escrow" is step index 1 of the 5-step flow; advance to "Buyer Pays"
  // once the on-chain lock has landed.
  const stepIndex = escrowTxHash ? 2 : 1;

  const insufficient = (effectiveBalance || 0) < (escrowOrder?.amount ?? 0);
  // Block locking until a receiving account is selected (req 8).
  const canLock = !!selectedAcctId && !insufficient && !isLockingEscrow;

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
          {/* Bottom sheet on phone/tablet; centered + width-capped from `md`
              up, matching the other order/escrow modals on merchant desktop. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed z-50 w-full max-w-2xl inset-x-0 bottom-0 mx-auto md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <div className={`${S.screen} rounded-t-2xl md:rounded-2xl border border-b-0 md:border-b border-border-subtle shadow-2xl overflow-hidden pb-safe md:pb-0 max-h-[90dvh] overflow-y-auto`}>
              {/* Drag handle (mobile bottom-sheet affordance only) */}
              <div className="flex justify-center pt-2.5 pb-1 md:hidden">
                <span className="h-1 w-9 rounded-full bg-border-medium" />
              </div>

              {/* Header */}
              <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${S.chip}`}>
                    <Lock className="w-5 h-5 text-text-secondary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-text-primary">Lock Escrow</h2>
                    <p className="text-[11px] text-text-tertiary">Step 2 of 5 · Secure USDT for this trade</p>
                  </div>
                </div>
                {!isLockingEscrow && (
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
                {/* Progress stepper */}
                <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                  <EscrowFlowStepper
                    steps={["Accepted", "Lock Escrow", "Buyer Pays", "Verify Payment", "Release USDT"]}
                    currentIndex={stepIndex}
                    surfaces={S}
                  />
                </div>

                {/* Trade summary */}
                <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <UserAvatar
                      src={escrowOrder.user_avatar}
                      seed={escrowOrder.user}
                      size={44}
                      className="rounded-xl"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{escrowOrder.user}</p>
                      <p className="text-[11px] text-text-tertiary truncate">
                        {escrowOrder.orderType === "sell" ? "Sell Order" : "Buy Order"}
                        {(escrowOrder.dbOrder?.order_number || escrowOrder.id) &&
                          ` · ${escrowOrder.dbOrder?.order_number || escrowOrder.id.slice(0, 8)}`}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const currency = escrowOrder.toCurrency || escrowOrder.dbOrder?.fiat_currency || "";
                    const isInr = currency === "INR";
                    const isBuy = escrowOrder.orderType === "buy";
                    const INR_RATE = isBuy ? 101.33 : 103.53;
                    const promoDiscountFiat = isInr ? 5 * INR_RATE : 0;
                    const discountedTotal = Math.max(0, escrowOrder.total - promoDiscountFiat);
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] text-text-tertiary uppercase mb-1">Amount</p>
                          <p className="text-lg font-bold text-text-primary">
                            {formatCrypto(escrowOrder.amount)} USDT
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-text-tertiary uppercase mb-1">Fiat Value</p>
                          {isInr ? (
                            <>
                              <p className="text-lg font-bold text-text-primary">
                                {formatFiat(discountedTotal, currency)}
                              </p>
                              <p className="text-[10px] text-text-secondary mt-0.5 flex items-center gap-1">
                                🎁 -₹{promoDiscountFiat.toFixed(0)} testing reward
                              </p>
                            </>
                          ) : (
                            <p className="text-lg font-bold text-text-primary">
                              {formatFiat(escrowOrder.total, currency)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {escrowOrder.rate > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between">
                      <span className="text-[11px] text-text-tertiary inline-flex items-center gap-1">
                        <Lock className="w-3 h-3 text-success" /> Rate Locked
                      </span>
                      <span className="text-[12px] font-medium text-text-primary">
                        1 USDT = {formatRate(escrowOrder.rate)}{" "}
                        {escrowOrder.toCurrency || escrowOrder.dbOrder?.fiat_currency || ""}
                      </span>
                    </div>
                  )}
                </div>

                {/* Buyer trust */}
                <TradeTrustPanel
                  title="Buyer Trust"
                  profile={buyerTrust.profile}
                  loading={buyerTrust.loading}
                  surfaces={S}
                />

                {/* Select receiving account — shared with the buyer on lock */}
                {!escrowTxHash && (
                  <ReceivingAccountPicker
                    methods={recv.methods}
                    selectedId={selectedAcctId}
                    onSelect={setPickedId}
                    onAddNew={() => {
                      window.location.href = "/market/settings";
                    }}
                    loading={recv.loading}
                    surfaces={S}
                    error={
                      !recv.loading && recv.methods.length === 0
                        ? "Add a payment method to lock escrow."
                        : null
                    }
                  />
                )}

                {/* Tips */}
                {!escrowTxHash && !isLockingEscrow && (
                  <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="w-4 h-4 text-text-secondary" />
                      <span className="text-[13px] font-semibold text-text-primary">Tips</span>
                    </div>
                    <ul className="space-y-1.5 text-[12px] text-text-secondary list-disc pl-4">
                      <li>Choose the account where you can quickly verify payments.</li>
                      <li>This account cannot be changed after escrow is locked.</li>
                    </ul>
                  </div>
                )}

                {/* Important */}
                {!escrowTxHash && !isLockingEscrow && (
                  <div className="rounded-xl p-4 border border-warning-border bg-warning-dim">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      <span className="text-[13px] font-semibold text-warning">Important</span>
                    </div>
                    <ul className="space-y-1.5 text-[12px] text-warning list-disc pl-4">
                      <li>Only lock escrow if you are available to complete this trade.</li>
                      <li>Do not release USDT until funds arrive in your bank account.</li>
                    </ul>
                  </div>
                )}

                {/* What Happens Next */}
                {!escrowTxHash && !isLockingEscrow && (
                  <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                    <p className="text-[13px] font-semibold text-text-primary mb-3">
                      What Happens Next?
                    </p>
                    <ol className="space-y-2.5">
                      {[
                        "Your selected account is shared with the buyer",
                        `Escrow locks ${formatCrypto(escrowOrder.amount)} USDT`,
                        `Buyer sends ${escrowOrder.toCurrency || escrowOrder.dbOrder?.fiat_currency || "fiat"} payment`,
                        "Buyer marks payment as sent",
                        "You verify payment in your account",
                        "Release USDT to complete trade",
                      ].map((step, i) => (
                        <li key={step} className="flex items-start gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-success-dim text-success text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-[12px] text-text-secondary leading-snug">
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Transaction status */}
                {isLockingEscrow && !escrowTxHash && (
                  <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-text-secondary animate-spin" />
                      <div>
                        <p className="text-sm font-medium text-text-primary">Processing Transaction</p>
                        <p className="text-xs text-text-tertiary">
                          {IS_EMBEDDED_WALLET ? "Signing and sending on-chain..." : "Please approve in your wallet..."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success */}
                {escrowTxHash && (
                  <div className="rounded-xl p-4 border border-success-border bg-success-dim">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                        <Check className="w-4 h-4 text-success" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">Escrow Locked Successfully!</p>
                        <p className="text-xs text-text-secondary">USDT is now secured on-chain</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(escrowTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                      {escrowOrder?.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(escrowOrder.escrowPda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          BlipScan
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Error */}
                {escrowError && (
                  <div className="rounded-xl p-4 border border-error-border bg-error-dim">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-error" />
                      <div>
                        <p className="text-sm font-medium text-error">Transaction Failed</p>
                        <p className="text-xs text-error/80">{escrowError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 space-y-3">
                {!escrowTxHash && (
                  <div className={`flex items-center justify-between rounded-xl p-3 border border-border-subtle ${S.card}`}>
                    <div>
                      <p className="text-[11px] text-text-tertiary">You Will Lock</p>
                      <p className="text-sm font-bold text-text-primary">{formatCrypto(escrowOrder.amount)} USDT</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-text-tertiary">Your USDT Balance</p>
                      <p className={`text-sm font-bold ${insufficient ? "text-error" : "text-text-primary"}`}>
                        {formatCrypto(effectiveBalance ?? 0)} USDT
                      </p>
                      {insufficient && (
                        <p className="text-[10px] text-error">Insufficient Balance</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  {escrowTxHash ? (
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
                        disabled={isLockingEscrow}
                        className={`flex-1 py-3 rounded-xl text-xs font-medium text-text-secondary ${S.card} ${S.hover} transition-colors disabled:opacity-50`}
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => onExecute(selectedAcctId ?? undefined)}
                        disabled={!canLock}
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-accent text-accent-text transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isLockingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Locking...
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4" />
                            Lock {formatCrypto(escrowOrder.amount)} USDT &amp; Share Details
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
                {!escrowTxHash && !selectedAcctId && (
                  <p className="text-[11px] text-center text-error">
                    Please select a receiving account before locking escrow.
                  </p>
                )}
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
