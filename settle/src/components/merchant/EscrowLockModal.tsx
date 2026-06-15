"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Lock,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Wallet,
  Building2,
  Plus,
  Lightbulb,
} from "lucide-react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatFiat, formatCrypto, formatRate } from "@/lib/format";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SURFACES } from "@/components/shared/limits/types";
import { EscrowFlowStepper } from "@/components/shared/trade/EscrowFlowStepper";
import { TradeTrustPanel } from "@/components/shared/trade/TradeTrustPanel";
import { useCounterpartyProfile } from "@/components/shared/trade/useCounterpartyProfile";
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
  onExecute: () => void;
}

/** Lightweight shape of a merchant saved payment account (from
 *  GET /api/merchant/[id]/payment-methods). */
interface MerchantAcct {
  id: string;
  type: string;
  name: string;
  details: Record<string, string> | string;
  is_default?: boolean;
}

function acctSubtitle(a: MerchantAcct): string {
  const d = a.details;
  if (typeof d === "string") return d;
  if (!d) return "";
  return (
    d.upi_id || d.vpa || d.iban || d.account_number || d.bank_name || ""
  );
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

  // ── Receiving-account picker (visual; persistence deferred) ─────────────
  // Lists the merchant's saved accounts so the seller can pick which one the
  // buyer pays into. NOTE: the lock action does not yet persist this choice —
  // sharing the seller's pick with the buyer needs a small backend param on
  // the lock action (pay-method endpoint is buyer-only). Tracked separately.
  const [accounts, setAccounts] = useState<MerchantAcct[]>([]);
  const [selectedAcctId, setSelectedAcctId] = useState<string | null>(null);
  useEffect(() => {
    if (!showEscrowModal) return;
    let cancelled = false;
    // Use the `me` alias — the server resolves the merchant from the auth
    // token, so this never races a not-yet-hydrated merchantId from the store.
    fetchWithAuth(`/api/merchant/me/payment-methods`)
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (cancelled || !j?.success || !Array.isArray(j.data)) return;
        const list: MerchantAcct[] = (j.data as MerchantAcct[]).map((m) => ({
          id: String(m.id),
          type: m.type,
          name: m.name,
          details: m.details,
          is_default: !!m.is_default,
        }));
        setAccounts(list);
        setSelectedAcctId(
          (prev) => prev ?? (list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showEscrowModal]);

  const upiAccounts = accounts.filter((a) => a.type === "upi");
  const bankAccounts = accounts.filter((a) => a.type !== "upi");
  // "Lock Escrow" is step index 1 of the 5-step flow; advance to "Buyer Pays"
  // once the on-chain lock has landed.
  const stepIndex = escrowTxHash ? 2 : 1;

  const insufficient = (effectiveBalance || 0) < (escrowOrder?.amount ?? 0);

  const renderAccountRow = (a: MerchantAcct) => {
    const selected = selectedAcctId === a.id;
    return (
      <button
        key={a.id}
        type="button"
        onClick={() => setSelectedAcctId(a.id)}
        className={`w-full flex items-center gap-3 rounded-xl p-3 border text-left transition-colors ${
          selected
            ? "border-accent bg-accent/10"
            : `border-border-subtle ${S.inset} ${S.hover}`
        }`}
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${S.chip}`}>
          {a.type === "upi" ? (
            <Wallet className="w-4 h-4 text-text-secondary" />
          ) : (
            <Building2 className="w-4 h-4 text-text-secondary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text-primary truncate">{a.name}</p>
          {acctSubtitle(a) && (
            <p className="text-[11px] text-text-tertiary truncate font-mono">{acctSubtitle(a)}</p>
          )}
        </div>
        {a.is_default && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success-dim text-success shrink-0">
            Default
          </span>
        )}
        <span
          className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
            selected ? "border-accent" : "border-border-medium"
          }`}
        >
          {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
        </span>
      </button>
    );
  };

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
          {/* Bottom sheet across phone + tablet (merchant uses the mobile
              layout up to 1536px); centered + width-capped on large screens.
              Slides via `y` only so the animation never fights positioning. */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300, mass: 0.8 }}
            className="fixed z-50 inset-x-0 bottom-0 w-full max-w-md mx-auto"
          >
            <div className={`${S.screen} rounded-t-2xl border border-b-0 border-border-subtle shadow-2xl overflow-hidden pb-safe max-h-[90dvh] overflow-y-auto`}>
              {/* Drag handle */}
              <div className="flex justify-center pt-2.5 pb-1">
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

                {/* Select receiving account (visual — persistence deferred) */}
                {!escrowTxHash && (
                  <div className={`rounded-xl p-4 border border-border-subtle ${S.card}`}>
                    <p className="text-sm font-semibold text-text-primary">Select Receiving Account</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5 mb-3">
                      Buyer will pay to the account you select below.
                    </p>

                    {accounts.length === 0 ? (
                      <p className="text-[12px] text-text-tertiary">No saved accounts yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {upiAccounts.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] uppercase tracking-wide text-text-tertiary">UPI Accounts</p>
                            {upiAccounts.map(renderAccountRow)}
                          </div>
                        )}
                        {bankAccounts.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] uppercase tracking-wide text-text-tertiary">Bank Accounts</p>
                            {bankAccounts.map(renderAccountRow)}
                          </div>
                        )}
                      </div>
                    )}

                    <a
                      href="/market/settings"
                      className={`mt-3 w-full py-2.5 rounded-xl border border-dashed border-border-medium flex items-center justify-center gap-1.5 text-[13px] font-medium text-text-secondary ${S.hover} transition-colors`}
                    >
                      <Plus className="w-4 h-4" />
                      Add New Account
                    </a>
                  </div>
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
                        onClick={onExecute}
                        disabled={isLockingEscrow || insufficient}
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
