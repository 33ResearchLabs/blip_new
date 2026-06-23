"use client";

/**
 * OrderPaymentScreen
 * ──────────────────
 * Buyer's payment view for a BUY order once a merchant has accepted. Replaces
 * the step-based layout on OrderDetailScreen for the accepted → escrowed phase.
 *
 * SAFETY: bank details are revealed and "I have made the payment" is enabled
 * ONLY after escrow is actually locked (dbStatus === "escrowed"). Before that
 * the buyer sees an "escrow not locked yet" waiting state — they must never pay
 * before the merchant has secured the USDT.
 *
 * Pure presentation. Every money action (mark-paid, cancel, copy, choose
 * account) is delegated to OrderDetailScreen via callbacks so the state-machine
 * logic lives in exactly one place.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  HelpCircle,
  Check,
  Copy,
  Clock,
  Shield,
  ShieldCheck,
  CheckCircle2,
  Landmark,
  Lightbulb,
  Wallet,
  ArrowDownToLine,
  // Info,
  AlertCircle,
  ExternalLink,
  MessageCircle,
  Star,
  Loader2,
} from "lucide-react";
import type { Order, MerchantPaymentMethod } from "./types";
import { formatCrypto, formatCount } from "@/lib/format";
import { explorerUrl } from "@/lib/solana/networkLabel";
import { UserAvatar } from "@/components/ui/UserAvatar";

const CARD = "bg-surface-card border border-border-subtle";

function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "AED ";
    default: return `${(code || "AED").toUpperCase()} `;
  }
}

function fmtCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtLockedAt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${time}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

interface PaymentRow {
  label: string;
  value: string;
  copyKey: string;
  copyValue?: string;
  mono?: boolean;
  accent?: boolean;
}

/**
 * Builds the labelled payment-detail rows from whichever source the order
 * carries — mirrors OrderDetailScreen's precedence: merchantPaymentMethod →
 * lockedPaymentMethod → raw merchant fields.
 */
function derivePaymentRows(order: Order, displayId: string): PaymentRow[] {
  const rows: PaymentRow[] = [];
  const mpm = order.merchantPaymentMethod;
  const lpm = order.lockedPaymentMethod;

  if (mpm) {
    const t = (mpm.type || "").toLowerCase();
    const isUpi = t === "upi" || (typeof mpm.details === "string" && mpm.details.includes("@"));
    rows.push({ label: isUpi ? "UPI Name" : "Account Name", value: mpm.name || "—", copyKey: "pm-name" });
    rows.push({ label: isUpi ? "UPI ID" : "Account No. / IBAN", value: mpm.details || "—", copyKey: "pm-id", mono: true });
  } else if (lpm) {
    const d = lpm.details || {};
    if (d.bank_name) rows.push({ label: "Bank Name", value: d.bank_name, copyKey: "bank" });
    if (d.account_name) rows.push({ label: "Account Name", value: d.account_name, copyKey: "name" });
    if (d.iban) rows.push({ label: "IBAN / Account No.", value: d.iban, copyKey: "iban", mono: true });
    if (d.upi_id) rows.push({ label: "UPI ID", value: d.upi_id, copyKey: "upi", mono: true });
  } else {
    if (order.merchant.bank) rows.push({ label: "Bank Name", value: order.merchant.bank, copyKey: "bank" });
    if (order.merchant.accountName) rows.push({ label: "Account Name", value: order.merchant.accountName, copyKey: "name" });
    if (order.merchant.iban) rows.push({ label: "IBAN / Account No.", value: order.merchant.iban, copyKey: "iban", mono: true });
  }

  const sym = fiatSymbol(order.fiatCode);
  rows.push({
    label: "Amount",
    value: `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`,
    copyKey: "amount",
    copyValue: order.fiatAmount,
    accent: true,
  });
  rows.push({ label: "Reference / Note", value: displayId, copyKey: "ref" });
  return rows;
}

export interface OrderPaymentScreenProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  onOpenOverview: () => void;
  onViewOverview: () => void;
  onOpenChat: () => void;
  onViewProfile: () => void;
  onNeedHelp: () => void;
  onMarkPaymentSent: () => void;
  onCancel: () => void;
  onAppeal: () => void;
  onCopy: (key: string, value: string) => void;
  copiedField: string | null;
  needsPayMethodPick: boolean;
  matchingPayMethods: MerchantPaymentMethod[];
  onChoosePayMethod: (pm: MerchantPaymentMethod) => void;
  isSubmitting: boolean;
  isCancelling: boolean;
}

export function OrderPaymentScreen({
  order,
  displayId,
  onClose,
  onOpenOverview,
  onViewOverview,
  onOpenChat,
  onViewProfile,
  onNeedHelp,
  onMarkPaymentSent,
  onCancel,
  onAppeal,
  onCopy,
  copiedField,
  needsPayMethodPick,
  matchingPayMethods,
  onChoosePayMethod,
  isSubmitting,
  isCancelling,
}: OrderPaymentScreenProps) {
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const escrowLocked = dbStatus === "escrowed" || dbStatus === "payment_pending";
  const paymentSent = dbStatus === "payment_sent";
  // Escrow is locked in both the ready-to-pay and payment-sent phases.
  const fundsLocked = escrowLocked || paymentSent;

  // "Pay within" countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // On-chain escrow proof — collapsed by default.
  const [escrowExpanded, setEscrowExpanded] = useState(false);
  const expiresMs = order.expiresAt ? new Date(order.expiresAt).getTime() : null;
  const remainingSec = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : 0;
  const isUrgent = remainingSec < 60;

  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = `${formatCrypto(parseFloat(order.cryptoAmount))}`;
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const rows = derivePaymentRows(order, displayId);
  const canPay = escrowLocked && !needsPayMethodPick && !isSubmitting;

  return (
    <div className="bg-surface-base flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="h-[max(env(safe-area-inset-top),1rem)]" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-[17px] font-semibold text-text-primary truncate">
            Buy {cryptoStr} USDT
          </h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <button
          onClick={onOpenOverview}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Order info"
        >
          <HelpCircle className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="px-5 pb-10 space-y-4">
        {/* Accepted banner */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-border-subtle`}>
            {fundsLocked ? (
              <CheckCircle2 className="w-7 h-7 text-text-secondary" />
            ) : (
              <ShieldCheck className="w-6 h-6 text-text-secondary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-text-primary">
              {paymentSent ? "Payment marked as completed!" : "Merchant accepted your order!"}
            </p>
            {paymentSent ? (
              <p className="text-[13px] text-text-secondary leading-snug">
                We&apos;ve notified the seller. They will confirm once they receive your payment.
              </p>
            ) : escrowLocked ? (
              <>
                <p className="text-[13px] text-text-secondary leading-snug">Escrow is locked by seller.</p>
                <p className="text-[13px] text-text-secondary leading-snug">Please complete the payment within the time limit.</p>
              </>
            ) : (
              <p className="text-[13px] text-text-secondary leading-snug">Please wait while the merchant secures the funds.</p>
            )}
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-border-subtle shrink-0">
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-text-secondary"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
            <span className="text-[11px] font-semibold text-text-secondary">LIVE</span>
          </div>
        </motion.div>

        {/* Escrow status */}
        <div className={`rounded-2xl p-4 ${CARD}`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${fundsLocked ? "bg-success/15" : "bg-surface-active"}`}>
              {fundsLocked ? <ShieldCheck className="w-5 h-5 text-success" /> : <Shield className="w-5 h-5 text-text-secondary" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[15px] font-semibold text-text-primary">Escrow status</p>
                {/* <Info className="w-4 h-4 text-text-tertiary shrink-0" /> */}
              </div>
              <p className={`text-[13px] font-medium ${fundsLocked ? "text-success" : "text-text-secondary"}`}>
                {fundsLocked ? "Escrow is locked by seller" : "Escrow is not locked yet"}
              </p>
              <div className="flex items-end justify-between gap-2">
                <p className="text-[12px] text-text-tertiary leading-snug">
                  {paymentSent
                    ? "Your funds are safe. Waiting for seller to confirm."
                    : escrowLocked
                      ? "Your funds are safe. Pay now to receive USDT."
                      : "Bank details appear once the merchant locks the funds."}
                </p>
                {fundsLocked && (
                  <span className="shrink-0 inline-flex px-2 py-1 rounded-md text-[11px] font-semibold bg-border-subtle text-text-secondary whitespace-nowrap">
                    {cryptoStr} USDT Locked
                  </span>
                )}
              </div>
            </div>
          </div>

          {fundsLocked && (
            <>
              {/* Locked by / Locked at */}
              <div className="mt-3 rounded-xl border border-border-subtle grid grid-cols-2 divide-x divide-border-subtle">
                <div className="p-3 min-w-0">
                  <p className="text-[11px] text-text-tertiary mb-0.5">Locked by</p>
                  <p className="text-[14px] font-medium text-text-primary truncate">{order.merchant.name}</p>
                </div>
                <div className="p-3 min-w-0">
                  <p className="text-[11px] text-text-tertiary mb-0.5">Locked at</p>
                  <p className="text-[14px] font-medium text-text-primary truncate">
                    {order.acceptedAt ? fmtLockedAt(order.acceptedAt) : "—"}
                  </p>
                </div>
              </div>

              {/* On-chain escrow proof — collapsible. Lets the buyer verify the
                  seller's USDT is genuinely locked on Solana. Mirrors the
                  merchant's EscrowInfoCard, themed for the user app. */}
              {order.escrowTxHash && (
                <div className="mt-3 rounded-xl border border-border-subtle overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setEscrowExpanded((o) => !o)}
                    aria-expanded={escrowExpanded}
                    className="w-full flex items-center gap-2.5 p-3 text-left"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-border-subtle">
                      <Shield className="w-4 h-4 text-text-secondary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-text-primary">Escrow details</p>
                      <p className="text-[11px] text-text-tertiary">Verify the lock on-chain</p>
                    </div>
                    <span className="flex items-center gap-1 text-[12px] font-medium text-text-secondary shrink-0">
                      {escrowExpanded ? "Hide" : "Details"}
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${escrowExpanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {escrowExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 pt-3 space-y-2.5 border-t border-border-subtle">
                          <EscrowDetailRow
                            label="Transaction ID"
                            value={order.escrowTxHash}
                            copyKey="escrowTx"
                            href={explorerUrl("tx", order.escrowTxHash)}
                            copiedField={copiedField}
                            onCopy={onCopy}
                          />
                          {order.escrowTradePda && (
                            <EscrowDetailRow
                              label="Trade Account"
                              value={order.escrowTradePda}
                              copyKey="escrowTradePda"
                              copiedField={copiedField}
                              onCopy={onCopy}
                            />
                          )}
                          {order.escrowTradeId != null && (
                            <EscrowDetailRow
                              label="Trade ID"
                              value={String(order.escrowTradeId)}
                              copyKey="escrowTradeId"
                              copiedField={copiedField}
                              onCopy={onCopy}
                            />
                          )}
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] text-text-tertiary shrink-0">Network</span>
                            <span className="text-[12px] font-medium text-text-secondary">Solana</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Confirmation progress — only after the buyer has paid */}
              {paymentSent && (
                <div className="mt-3 flex items-center justify-between gap-1">
                  <ConfirmStep state="done" label="Payment made" sub="Just now" />
                  <div className="flex-1 h-0.5 bg-border-medium mt-[-18px]" />
                  <ConfirmStep state="active" label="Seller confirming" sub="In progress" />
                  <div className="flex-1 h-0.5 bg-border-medium mt-[-18px]" />
                  <ConfirmStep state="pending" label="USDT release" sub="Pending" />
                </div>
              )}

              {/* Appeal */}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {paymentSent ? (
                    <p className="text-[13px] text-text-secondary">
                      Seller has up to <span className="font-semibold text-text-primary tabular-nums">{fmtCountdown(remainingSec)}</span> to confirm receipt of your payment.
                    </p>
                  ) : (
                    <>
                      <p className="text-[13px] font-medium text-text-primary">Need help?</p>
                      <p className="text-[12px] text-text-tertiary">You can appeal if you face any issues.</p>
                    </>
                  )}
                </div>
                <button
                  onClick={onAppeal}
                  className="shrink-0 px-4 py-2 rounded-xl text-[13px] font-semibold text-error border border-error-border hover:bg-error-dim"
                >
                  Appeal
                </button>
              </div>
            </>
          )}
        </div>

        {/* Payment details */}
        <div className={`rounded-2xl overflow-hidden ${CARD}`}>
          <div className="p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-border-subtle">
              <Landmark className="w-5 h-5 text-text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">Payment details</p>
              <p className="text-[13px] text-text-secondary leading-snug">
                {paymentSent
                  ? "Payment sent to the account below."
                  : escrowLocked
                    ? "Send the exact amount to the account below."
                    : "Available after escrow is locked."}
              </p>
            </div>
            {paymentSent ? (
              <div className="shrink-0 flex flex-col items-end px-2.5 py-1.5 rounded-lg bg-border-subtle">
                <span className="text-[10px] text-text-secondary leading-none mb-0.5 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Payment sent
                </span>
                <span className="text-[13px] font-bold tabular-nums leading-none text-text-primary">
                  {order.paymentSentAt ? order.paymentSentAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
                </span>
              </div>
            ) : escrowLocked ? (
              <div className={`shrink-0 flex flex-col items-end px-2.5 py-1.5 rounded-lg ${isUrgent ? "bg-error/15" : "bg-surface-active"}`}>
                <span className="text-[10px] text-text-tertiary leading-none mb-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Pay within
                </span>
                <span className={`text-[15px] font-bold tabular-nums leading-none ${isUrgent ? "text-error" : "text-text-secondary"}`}>
                  {fmtCountdown(remainingSec)}
                </span>
              </div>
            ) : null}
          </div>

          {!fundsLocked ? (
            <div className="px-4 pb-4">
              <div className="rounded-xl p-4 flex items-center gap-3 bg-surface-active border border-border-medium">
                <Loader2 className="w-4 h-4 animate-spin text-text-secondary shrink-0" />
                <p className="text-[13px] text-text-secondary">
                  Waiting for the merchant to lock the funds. Don&apos;t pay yet — account details will show here.
                </p>
              </div>
            </div>
          ) : escrowLocked && needsPayMethodPick ? (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Choose where to pay</p>
              {matchingPayMethods.map((pm) => (
                <button
                  key={pm.id}
                  disabled={isSubmitting}
                  onClick={() => onChoosePayMethod(pm)}
                  className="w-full flex items-center justify-between gap-2 rounded-xl p-3 border border-border-medium hover:bg-surface-hover disabled:opacity-50 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-text-primary truncate">{pm.name}</p>
                    <p className="text-[12px] text-text-secondary truncate font-mono">{pm.details}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary shrink-0">{pm.type}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="px-4 pb-1 divide-y divide-border-subtle border-t border-border-subtle">
                {rows.map((row) => (
                  <div key={row.copyKey} className="flex items-center justify-between gap-3 py-3">
                    <span className="text-[13px] text-text-secondary shrink-0">{row.label}</span>
                    <button
                      onClick={() => onCopy(row.copyKey, row.copyValue ?? row.value)}
                      className="flex items-center gap-1.5 min-w-0 text-right"
                    >
                      <span className={`text-[14px] font-medium truncate ${row.accent ? "text-text-primary font-semibold" : "text-text-primary"} ${row.mono ? "font-mono" : ""}`}>
                        {row.value}
                      </span>
                      {copiedField === row.copyKey ? (
                        <Check className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              {paymentSent ? (
                <div className="mx-4 mb-4 mt-1 rounded-xl px-3 py-2.5 flex items-start gap-2 bg-surface-active border border-border-medium">
                  <Check className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                  <p className="text-[12px] text-text-secondary">
                    <span className="font-semibold text-text-primary">Your payment has been recorded.</span> We&apos;ll notify you once the seller confirms and releases your USDT.
                  </p>
                </div>
              ) : (
                <div className="mx-4 mb-4 mt-1 rounded-xl px-3 py-2.5 flex items-start gap-2 bg-surface-active border border-border-subtle">
                  <AlertCircle className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                  <p className="text-[12px] text-text-secondary">Important: Send only the exact amount. Do not add any extra.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Merchant card */}
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}>
          {/* Avatar + name open the merchant profile sheet (was inert — the
              parent never wired a profile handler for this screen). */}
          <button
            onClick={() => order.merchant.name && onViewProfile()}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
            aria-label="View merchant profile"
          >
            <div className="relative shrink-0">
              <UserAvatar
                src={order.merchant.avatarUrl}
                seed={order.merchant.name}
                size={48}
                alt={order.merchant.name}
                className="rounded-full"
              />
              {order.merchant.isOnline && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-text-secondary border-2 border-surface-card" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[15px] font-semibold text-text-primary truncate">{order.merchant.name}</p>
                {order.merchant.rating > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-text-secondary shrink-0">
                    <Star className="w-3.5 h-3.5 text-text-secondary fill-text-tertiary" />
                    {formatCrypto(order.merchant.rating, { decimals: 1 })}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-text-tertiary">
                {order.merchant.trades > 0 ? `${formatCount(order.merchant.trades)} trades` : "New merchant"}
                {order.merchant.isOnline ? " · Online" : ""}
              </p>
            </div>
          </button>
          <button
            onClick={onOpenChat}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-surface-active"
            aria-label="Chat with merchant"
          >
            <MessageCircle className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile icon={<Wallet className="w-4 h-4" />} label="You pay" value={fiatStr} />
          <SummaryTile icon={<ArrowDownToLine className="w-4 h-4" />} label="You get" value={cryptoStr} sub="USDT" />
          <SummaryTile icon={<Landmark className="w-4 h-4" />} label="Method" value={order.merchant.paymentMethod === "cash" ? "Cash" : "Bank"} />
        </div>

        {/* Tip */}
        <div className="rounded-2xl p-4 flex gap-3 bg-surface-active border border-border-subtle">
          <Lightbulb className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary mb-0.5">Order tip</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              {paymentSent
                ? "The seller will confirm once they receive your payment. You'll get your USDT instantly after confirmation."
                : "Make the payment using your registered account details and tap “I have made the payment” once completed."}
            </p>
          </div>
        </div>

        {/* Order Overview — opens the itemised order-detail view directly
            (one tap; the header info button still opens the step tracker).
            Mirrors the card on the matching/tracking screens. */}
        <div className={`rounded-2xl overflow-hidden ${CARD}`}>
          <button
            onClick={onViewOverview}
            className="w-full flex items-center gap-3 px-5 py-4 text-left active:bg-surface-hover"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-border-subtle">
              <FileText className="w-5 h-5 text-text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-medium text-text-primary">Order Overview</p>
              <p className="text-[13px] text-text-tertiary">View order details</p>
            </div>
            <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" />
          </button>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {escrowLocked && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onMarkPaymentSent}
              disabled={!canPay}
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-text-primary text-surface-base disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {needsPayMethodPick ? "Select an account first" : "I have made the payment"}
            </motion.button>
          )}
          {/* Cancel is offered ONLY before escrow is locked (accepted /
              escrow_pending — nothing is at stake, so the buyer can back out
              instantly and unilaterally). Once the seller has locked USDT
              (escrowed / payment_pending / payment_sent) there is no cancel
              button: the buyer raises an Appeal instead (rendered above when
              fundsLocked), and any mutual cancellation is resolved there. */}
          {!fundsLocked && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onCancel}
              disabled={isCancelling}
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-foreground/[0.05] text-foreground/70 border border-foreground/[0.08] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
              Cancel Order
            </motion.button>
          )}
          {/* Need help — always available support path (navigation only). */}
          <button
            onClick={onNeedHelp}
            className="w-full py-3 rounded-2xl text-[14px] font-medium text-text-secondary hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
          >
            <HelpCircle className="w-4 h-4" />
            Need help
          </button>
        </div>
      </div>
    </div>
  );
}

/** One copyable on-chain reference row inside the collapsible Escrow details.
 *  Long values are shortened (6…6); copy state is driven by the shared
 *  copiedField/onCopy pair so it matches the payment-detail rows above. */
function EscrowDetailRow({
  label,
  value,
  copyKey,
  href,
  copiedField,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  href?: string;
  copiedField: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  const short = value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-text-tertiary shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={() => onCopy(copyKey, value)}
          className="flex items-center gap-1 font-mono text-[12px] text-text-secondary hover:text-text-primary transition-colors min-w-0"
          title="Copy"
        >
          <span className="truncate">{short}</span>
          {copiedField === copyKey ? (
            <Check className="w-3 h-3 text-text-secondary shrink-0" strokeWidth={3} />
          ) : (
            <Copy className="w-3 h-3 text-text-tertiary shrink-0" />
          )}
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-secondary hover:opacity-80 transition-opacity shrink-0"
            title="View on explorer"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function ConfirmStep({
  state,
  label,
  sub,
}: {
  state: "done" | "active" | "pending";
  label: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col items-center text-center min-w-0 px-1">
      {state === "done" ? (
        <div className="w-7 h-7 rounded-full bg-text-primary flex items-center justify-center shrink-0">
          <Check className="w-4 h-4 text-surface-base" strokeWidth={3} />
        </div>
      ) : state === "active" ? (
        <div className="w-7 h-7 rounded-full bg-surface-active border border-warning flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-text-secondary" />
        </div>
      ) : (
        <div className="w-7 h-7 rounded-full border-2 border-border-medium shrink-0" />
      )}
      <p className={`text-[11px] font-medium mt-1.5 leading-tight ${state === "pending" ? "text-text-tertiary" : "text-text-primary"}`}>
        {label}
      </p>
      <p className={`text-[10px] leading-tight ${state === "active" ? "text-text-secondary" : "text-text-tertiary"}`}>{sub}</p>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className={`rounded-xl p-2.5 text-center ${CARD}`}>
      <div className="flex items-center justify-center text-text-tertiary mb-1">{icon}</div>
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-text-tertiary leading-tight">{sub}</p>}
    </div>
  );
}
