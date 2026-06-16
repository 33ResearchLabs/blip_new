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
import { ChevronDown, ChevronLeft, Loader2 } from "lucide-react";
import { formatCrypto, formatRate } from "@/lib/format";

const CARD = "bg-surface-card border border-border-subtle";

type Tone = "accent" | "success" | "error" | "warning";

const CANCELLABLE = new Set(["pending", "accepted", "escrowed"]);

const STATUS_LABELS: Record<string, string> = {
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

const TONE_TEXT: Record<Tone, string> = {
  accent: "text-accent",
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
};

const TONE_DOT: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  error: "bg-error",
  warning: "bg-warning",
};

const TONE_PILL: Record<Tone, string> = {
  accent: "bg-accent/15 text-accent",
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
  const typeLabel = type === "buy" ? "Buy" : "Sell";
  const cryptoStr = `${formatCrypto(cryptoAmount)} USDT`;
  const fiatStr = `${sym}${formatCrypto(fiatAmount)}`;

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
          <h1 className="text-[17px] font-semibold text-text-primary truncate">Order Overview</h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <div className="w-9 h-9 shrink-0" />
      </div>

      <div className="px-5 pb-10 space-y-4">
        {/* Status card */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="rounded-2xl p-4 flex items-start justify-between gap-3 bg-warning-dim border border-warning-border"
        >
          <div className="min-w-0">
            <p className="text-[20px] font-bold text-text-primary mb-1">
              {typeLabel} {cryptoStr}
            </p>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${TONE_DOT[meta.tone]}`} />
              <span className={`text-[15px] font-semibold ${TONE_TEXT[meta.tone]}`}>{meta.label}</span>
            </div>
            <span className={`inline-flex px-2.5 py-1 rounded-full text-[12px] font-medium ${TONE_PILL[meta.tone]}`}>
              {meta.progressText}
            </span>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[12px] text-text-tertiary mb-1">Order Status</p>
            <p className={`text-[14px] font-semibold ${TONE_TEXT[meta.tone]}`}>{meta.progressText}</p>
          </div>
        </motion.div>

        {/* Order Details */}
        <Section title="Order Details">
          <Row label="Order ID" value={displayId} mono />
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
          <Row label="Payment Method" value={paymentMethod === "cash" ? "Cash" : "Bank Transfer"} />
          {paymentLocked && paymentRows && paymentRows.length > 0 ? (
            paymentRows.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} mono={r.mono} />
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
        <div className="rounded-2xl p-4 bg-warning-dim border border-warning-border">
          <p className="text-[14px] font-semibold text-text-primary mb-2">Important Information</p>
          <ul className="space-y-1.5">
            {[
              "Merchant details will be shown once a seller accepts the order.",
              "Complete payment only to the bank account displayed by the app.",
              "Never communicate or share personal information outside the platform.",
            ].map((tip) => (
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
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-error-dim text-error border border-error-border disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel Order
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-surface-active text-text-primary border border-border-subtle"
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
        className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left"
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

function Row({
  label,
  value,
  valueClassName = "",
  mono = false,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-[14px] text-text-secondary shrink-0">{label}</span>
      <span
        className={`text-[14px] font-medium text-text-primary text-right ${mono ? "font-mono" : ""} ${valueClassName}`}
      >
        {value}
      </span>
    </div>
  );
}
