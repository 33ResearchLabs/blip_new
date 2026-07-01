"use client";

/**
 * OrderOverviewScreen
 * ───────────────────
 * Full-screen, itemised order overview — opened by the "Order Overview" row on
 * the matching screen and the rich tracker. Read-only detail view: status card,
 * order details, transaction breakdown, payment details and safety notes.
 *
 * Pure presentation with primitive props so it can be driven from either the
 * pre-match matching screen (no merchant yet) or a live order. The single
 * financial action (cancel) is delegated to the caller.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, Loader2, Copy, Check } from "lucide-react";
import { formatCrypto, formatRate } from "@/lib/format";

const CARD = "bg-surface-card border border-border-subtle";

type Tone = "accent" | "success" | "error" | "warning";

// Pre-escrow only: cancel is a unilateral, instant back-out while nothing is
// locked. Once escrow is locked there is no cancel button here — the exit is
// Appeal, and mutual cancellation is resolved through that flow.
const CANCELLABLE = new Set(["pending", "accepted", "escrow_pending"]);

const STATUS_LABELS: Record<string, string> = {
  // 'open' is the minimal-status form of a pending/unmatched order — without it
  // the order falls through to the generic "In progress" instead of "Matching".
  open: "Matching Merchant",
  pending: "Matching Merchant",
  accepted: "Merchant Accepted",
  escrow_pending: "Merchant Accepted",
  escrowed: "Ready to Pay",
  payment_pending: "Ready to Pay",
  payment_sent: "Payment Sent",
  payment_confirmed: "Releasing USDT",
  releasing: "Releasing USDT",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  disputed: "Under Review",
};

function statusMeta(status: string): { label: string; tone: Tone; progressText: string } {
  const s = (status || "").toLowerCase();
  const label = STATUS_LABELS[s] || "In progress";
  if (s === "completed") return { label, tone: "success", progressText: "Completed" };
  if (s === "cancelled") return { label, tone: "error", progressText: "Cancelled" };
  if (s === "expired") return { label, tone: "error", progressText: "Expired" };
  if (s === "disputed") return { label, tone: "warning", progressText: "Under review" };
  return { label, tone: "accent", progressText: "In progress" };
}

// `accent` (the in-progress tone) is neutralized to monochrome — text-accent is
// yellow in user-light mode. text-text-* / border-subtle resolve correctly in
// both light and dark scopes. Semantic tones (success/error/warning) keep their
// meaning-bearing colors.
const TONE_TEXT: Record<Tone, string> = {
  accent: "text-text-secondary",
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
};

const TONE_PILL: Record<Tone, string> = {
  accent: "bg-border-subtle text-text-secondary",
  success: "bg-success/15 text-success",
  error: "bg-error/15 text-error",
  warning: "bg-warning/15 text-warning",
};

function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "AED ";
    default: return `${(code || "AED").toUpperCase()} `;
  }
}

// Human label for a buyer payment-type code ('bank' | 'upi' | 'cash').
function payTypeLabel(t: string): string {
  switch ((t || "").toLowerCase()) {
    case "bank": return "Bank Transfer";
    case "upi": return "UPI";
    case "cash": return "Cash";
    default: return t ? t.toUpperCase() : "";
  }
}

function fmtCreatedAt(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" });
  const yr = d.getFullYear();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} ${mon} ${yr}, ${time}`;
}

export interface OrderOverviewScreenProps {
  displayId: string;
  status: string;
  type: "buy" | "sell";
  cryptoAmount: number;
  fiatAmount: number;
  rate: number;
  fiatCode: string;
  paymentMethod: "bank" | "cash";
  /** BUY (Way-1): the buyer's chosen payment-method types ('bank' | 'upi' |
      'cash'). When present, the Payment Method row lists all of them instead of
      the single coarse `paymentMethod`. */
  paymentMethods?: string[];
  createdAt: Date;
  /** Actual receiving account once assigned; null → "shown after assignment". */
  bankAccount?: string | null;
  /** Whether the merchant's escrow is locked. Only once locked may the
      counterparty (buyer) see the merchant's payment-method details. */
  paymentLocked?: boolean;
  /** Resolved payment-method rows (account name, IBAN / UPI ID, …). Rendered
      only when `paymentLocked` is true. */
  paymentRows?: { label: string; value: string; mono?: boolean }[];
  onClose: () => void;
  onCancel: () => void;
  isCancelling?: boolean;
}

export function OrderOverviewScreen({
  displayId,
  status,
  type,
  cryptoAmount,
  fiatAmount,
  rate,
  fiatCode,
  paymentMethod,
  paymentMethods,
  createdAt,
  bankAccount,
  paymentLocked,
  paymentRows,
  onClose,
  onCancel,
  isCancelling,
}: OrderOverviewScreenProps) {
  const s = (status || "").toLowerCase();
  const meta = statusMeta(s);
  const canCancel = CANCELLABLE.has(s);
  const sym = fiatSymbol(fiatCode);

  // Tap-to-copy for the Order ID.
  const [copied, setCopied] = useState(false);
  const copyOrderId = async () => {
    try {
      await navigator.clipboard.writeText(displayId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  const typeLabel = type === "buy" ? "Buy" : "Sell";
  const cryptoStr = `${formatCrypto(cryptoAmount)} USDT`;
  const fiatStr = `${sym}${formatCrypto(fiatAmount)}`;

  return (
    <div className="bg-surface-base flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="h-[max(env(safe-area-inset-top),0.5rem)]" />

      {/* Header */}
      <div className="px-5 py-2.5 flex items-center justify-between gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-[17px] font-semibold text-text-primary truncate">Order Overview</h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <div className="w-9 h-9 shrink-0" />
      </div>

      <div className="px-5 pb-4 space-y-2.5">
        {/* Status card */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`rounded-2xl p-3.5 flex items-start justify-between gap-3 ${CARD}`}
        >
          <div className="min-w-0">
            <p className="text-[20px] font-bold text-text-primary">
              {typeLabel} {cryptoStr}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[12px] text-text-tertiary mb-1.5">Order Status</p>
            <span className={`inline-flex px-2.5 py-1 rounded-full text-[12px] font-medium ${TONE_PILL[meta.tone]}`}>
              {meta.progressText}
            </span>
          </div>
        </motion.div>

        {/* Order Details */}
        <Section title="Order Details">
          <CopyRow label="Order ID" value={displayId} copied={copied} onCopy={copyOrderId} />
          <Row label="Created At" value={fmtCreatedAt(createdAt)} />
          <Row label="Order Type" value={`${typeLabel} USDT`} />
          <Row label="Status" value={meta.label} valueClassName={TONE_TEXT[meta.tone]} />
        </Section>

        {/* Transaction Details */}
        <Section title="Transaction Details">
          <Row
            label="You Get"
            value={type === "buy" ? cryptoStr : fiatStr}
            valueClassName={type === "buy" ? "text-success" : undefined}
          />
          <Row label={type === "buy" ? "You Pay" : "You Sell"} value={type === "buy" ? fiatStr : cryptoStr} />
          <Row label="Rate" value={`${sym}${formatRate(rate)} / USDT`} />
          <Row label={type === "buy" ? "Total Payable" : "Total Receivable"} value={fiatStr} valueClassName="font-bold" />
        </Section>

        {/* Payment Details — the merchant's receiving details are only
            disclosed to the buyer once the escrow is locked. Before that we
            show a waiting line instead of the account. */}
        <Section title="Payment Details">
          <Row
            label={paymentMethods && paymentMethods.length > 1 ? "Payment Methods" : "Payment Method"}
            value={
              paymentMethods && paymentMethods.length > 0
                ? paymentMethods.map(payTypeLabel).filter(Boolean).join(", ")
                : paymentMethod === "cash" ? "Cash" : "Bank Transfer"
            }
          />
          {paymentLocked && paymentRows && paymentRows.length > 0 ? (
            paymentRows.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} mono={r.mono} copyable={r.mono} />
            ))
          ) : (
            <Row
              label={paymentMethod === "cash" ? "Meeting details" : "Account details"}
              value={
                bankAccount ||
                (paymentMethod === "cash"
                  ? "Shared once the merchant locks the escrow"
                  : "Shown once the merchant locks the escrow")
              }
              valueClassName={bankAccount ? undefined : "text-text-tertiary"}
            />
          )}
        </Section>

        {/* Important Information */}
        <div className="rounded-2xl p-3.5 bg-surface-active border border-border-medium">
          <p className="text-[14px] font-semibold text-text-primary mb-1.5">Important Information</p>
          <ul className="space-y-1.5">
            {(s === "completed"
              ? [
                  // Once completed the first two tips no longer apply — only the
                  // off-platform safety note stays relevant.
                  "Never communicate or share personal information outside the platform.",
                ]
              : [
                  "Merchant details will be shown once a seller accepts the order.",
                  "Complete payment only to the payment details displayed in the app.",
                  "Never communicate or share personal information outside the platform.",
                ]
            ).map((tip) => (
              <li key={tip} className="flex gap-2 text-[13px] text-text-secondary leading-snug">
                <span className="text-text-tertiary mt-1.5 w-1 h-1 rounded-full bg-text-tertiary shrink-0" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Cancel */}
        {canCancel ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            disabled={isCancelling}
            className="w-full py-3.5 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text border border-transparent disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel Order
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text border border-transparent"
          >
            Back
          </motion.button>
        )}
      </div>
    </div>
  );
}

// Collapsible card. Closed by default so the overview opens compact; tapping
// the header toggles the body with a height animation and rotates the chevron.
function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-2xl ${CARD} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-[15px] font-semibold text-text-primary">{title}</span>
        <ChevronDown
          className={`w-5 h-5 text-text-tertiary shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-border-subtle px-4 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Order ID row with a tap-to-copy affordance.
function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-[14px] text-text-secondary shrink-0">{label}</span>
      <button
        onClick={onCopy}
        className="flex items-center gap-1.5 min-w-0 text-right"
        aria-label={`Copy ${label}`}
      >
        <span className="text-[14px] font-medium text-text-primary font-mono truncate">{value}</span>
        {copied ? (
          <Check className="w-3.5 h-3.5 text-success shrink-0" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName = "",
  mono = false,
  copyable = false,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // UPI IDs are displayed with the app name appended for context, e.g.
      // "name@bank (Google Pay)". Copy only the identifier — strip a trailing
      // parenthetical annotation so the pasted value works in a payment app.
      const copyText = value.replace(/\s*\([^()]*\)\s*$/, "");
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — silently no-op.
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-[14px] text-text-secondary shrink-0">{label}</span>
      <div className="flex items-start gap-2 min-w-0 justify-end">
        <span
          className={`text-[14px] font-medium text-text-primary text-right ${mono ? "font-mono" : ""} ${valueClassName}`}
        >
          {value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : `Copy ${label}`}
            className="shrink-0 mt-0.5 text-text-tertiary active:scale-90 transition-transform"
          >
            {copied ? (
              <Check className="w-4 h-4 text-success" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
