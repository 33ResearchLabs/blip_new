"use client";

/**
 * ActiveOrderPaymentScreen
 * ────────────────────────
 * PHASE 1 of the Active Order redesign — the new architecture proven on the
 * single most complex active state: BUY → escrow locked → buyer sends payment.
 *
 * It composes the reusable foundation (ActiveOrderShell + TradeProgress +
 * CurrentStepHero) and reuses ALL existing infrastructure unchanged:
 *   • derivePaymentRows  — same "where to pay" source as the old screen
 *   • PaymentConfirmSheet — same irreversible "I've paid" guard
 *   • resolveActiveOrderView — the pure copy/view-model resolver
 *
 * Polish pass (pre-Phase-2):
 *   1. Hero stays concise (guidance only) — the detailed "where to pay" rows
 *      moved DOWN into the Payment section, so the primary action sits right
 *      under the hero instead of below a long table.
 *   2. Cash / non-bank methods never show account language.
 *   3. A subtle time-left bar lives inside the hero (glanceability, not noise).
 *
 * Props mirror OrderPaymentScreen so it's a drop-in for this one state. Every
 * money action stays delegated to OrderDetailScreen via callbacks.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Check,
  Copy,
  Shield,
  ShieldCheck,
  Landmark,
  Banknote,
  Wallet,
  ArrowDownToLine,
  ExternalLink,
  HelpCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { Order, MerchantPaymentMethod } from "@/components/user/screens/types";
import { formatCrypto } from "@/lib/format";
import { explorerUrl } from "@/lib/solana/networkLabel";
import { PaymentConfirmSheet } from "@/components/user/PaymentConfirmSheet";
import { derivePaymentRows, fiatSymbol } from "@/lib/orders/paymentRows";
import { resolveActiveOrderView } from "@/lib/orders/resolveActiveOrderView";
import { ActiveOrderShell } from "./ActiveOrderShell";
import { CurrentStepHero } from "./CurrentStepHero";
import { SummaryTile } from "./SummaryTile";
import { MerchantCard } from "./MerchantCard";
import { WaitingIndicator } from "./WaitingIndicator";

const CARD = "bg-surface-card border border-border-subtle";

/** Mirror OrderPaymentScreen's prop API so this is a drop-in for the one state. */
export interface ActiveOrderPaymentScreenProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  onOpenOverview: () => void;
  onViewOverview: () => void;
  onOpenChat: () => void;
  onViewProfile: () => void;
  onNeedHelp: () => void;
  onMarkPaymentSent: () => void;
  onAppeal: () => void;
  onCopy: (key: string, value: string) => void;
  copiedField: string | null;
  needsPayMethodPick: boolean;
  matchingPayMethods: MerchantPaymentMethod[];
  onChoosePayMethod: (pm: MerchantPaymentMethod) => void;
  isSubmitting: boolean;
  appealBanner?: React.ReactNode;
  appealActive?: boolean;
}

export function ActiveOrderPaymentScreen({
  order,
  displayId,
  onClose,
  onOpenOverview,
  onViewOverview,
  onOpenChat,
  onViewProfile,
  onNeedHelp,
  onMarkPaymentSent,
  onAppeal,
  onCopy,
  copiedField,
  needsPayMethodPick,
  matchingPayMethods,
  onChoosePayMethod,
  isSubmitting,
  appealBanner,
  appealActive,
}: ActiveOrderPaymentScreenProps) {
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  // Payment already sent → read-only "waiting for the seller to confirm" variant.
  const isPaymentSent = dbStatus === "payment_sent";

  // "Pay within" countdown — same derivation as the existing screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expiresMs = order.expiresAt ? new Date(order.expiresAt).getTime() : null;
  const remainingSec = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : 0;
  const isUrgent = remainingSec < 60;
  // Total window for the subtle time bar — from when the merchant accepted
  // (best proxy for escrow-lock) to the deadline.
  const startMs = order.acceptedAt
    ? new Date(order.acceptedAt).getTime()
    : new Date(order.createdAt).getTime();
  const totalSec = expiresMs ? Math.max(1, Math.floor((expiresMs - startMs) / 1000)) : undefined;

  const [escrowExpanded, setEscrowExpanded] = useState(false);
  const [showPaidConfirm, setShowPaidConfirm] = useState(false);

  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = formatCrypto(parseFloat(order.cryptoAmount));
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const rows = derivePaymentRows(order, displayId);
  const canPay = !needsPayMethodPick && !isSubmitting;

  // Rail the buyer pays over — drives cash vs bank copy everywhere on-screen.
  const isCash =
    (order.merchantPaymentMethod?.type ??
      order.lockedPaymentMethod?.type ??
      order.merchant.paymentMethod) === "cash";

  // Pure view-model: titles, "what happened / do now / next", escrow note.
  const view = resolveActiveOrderView({
    type: order.type,
    dbStatus,
    fiatLabel: fiatStr,
    cryptoLabel: cryptoStr,
    needsPayMethodPick,
    paymentMethod: isCash ? "cash" : "bank",
  });

  const nameRow = rows.find((r) => /name/i.test(r.label));
  const payDestination = isCash
    ? "the merchant"
    : nameRow && nameRow.value && nameRow.value !== "—"
      ? nameRow.value
      : "the account shown";
  const paidChecklist = isCash
    ? [
        `I handed over exactly ${fiatStr} in cash`,
        "I gave it to the right merchant",
        "The merchant has the full amount",
      ]
    : [
        `I sent exactly ${fiatStr} — no more, no less`,
        "I paid the account shown",
        "The payment is complete (not pending)",
      ];
  const confirmLabel = isCash ? `Yes, I've paid ${fiatStr}` : `Yes, I've sent ${fiatStr}`;
  const primaryLabel = needsPayMethodPick
    ? "Select how to pay first"
    : isCash
      ? "I've paid the merchant"
      : "I've sent the payment";

  // "Payment sent" badge for the details header in the read-only sent variant.
  const sentBadge = isPaymentSent ? (
    <span className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-active text-[11px] font-semibold text-text-secondary shrink-0">
      <Check className="w-3 h-3" strokeWidth={3} /> Payment sent
    </span>
  ) : null;

  // ── Payment section (relocated out of the hero) ────────────────────────
  // Pick an account → cash handover → bank account rows. Always BELOW the
  // primary action so a long table never separates the task from the button.
  const paymentDetails = needsPayMethodPick ? (
    <div className={`rounded-2xl overflow-hidden ${CARD}`}>
      <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
        <Landmark className="w-4 h-4 text-text-secondary shrink-0" />
        <p className="text-[13px] font-semibold text-text-primary">Choose how to pay</p>
      </div>
      <div className="p-3 space-y-2">
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
            <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary shrink-0">
              {pm.type}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : isCash ? (
    <div className={`rounded-2xl overflow-hidden ${CARD}`}>
      <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
        <Banknote className="w-4 h-4 text-text-secondary shrink-0" />
        <p className="text-[13px] font-semibold text-text-primary">Cash payment</p>
        {sentBadge}
      </div>
      <div className="p-4">
        <p className="text-[13px] text-text-secondary leading-snug mb-3">
          {isPaymentSent
            ? "You marked this cash payment as sent."
            : "Pay this amount in cash when you meet the merchant."}
        </p>
        <CopyLine
          label="Amount"
          value={fiatStr}
          copyKey="amount"
          copyValue={order.fiatAmount}
          accent
          copiedField={copiedField}
          onCopy={onCopy}
        />
        <div className="h-px bg-border-subtle my-1" />
        <CopyLine
          label="Reference / Note"
          value={displayId}
          copyKey="ref"
          copiedField={copiedField}
          onCopy={onCopy}
        />
      </div>
      <div className="px-4 py-2.5 bg-surface-active flex items-start gap-2">
        {isPaymentSent ? (
          <Check className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" strokeWidth={3} />
        ) : (
          <AlertCircle className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
        )}
        <p className="text-[12px] text-text-secondary leading-snug">
          {isPaymentSent
            ? "Your payment is recorded. We'll notify you once the seller confirms and releases your USDT."
            : "Hand over the exact amount — no more, no less."}
        </p>
      </div>
    </div>
  ) : (
    <div className={`rounded-2xl overflow-hidden ${CARD}`}>
      <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
        <Landmark className="w-4 h-4 text-text-secondary shrink-0" />
        <p className="text-[13px] font-semibold text-text-primary">
          {isPaymentSent ? "Paid to this account" : "Pay to this account"}
        </p>
        {sentBadge}
      </div>
      <div className="px-4 divide-y divide-border-subtle">
        {rows.map((row) => (
          <CopyLine
            key={row.copyKey}
            label={row.label}
            value={row.value}
            copyKey={row.copyKey}
            copyValue={row.copyValue}
            mono={row.mono}
            accent={row.accent}
            copiedField={copiedField}
            onCopy={onCopy}
          />
        ))}
      </div>
      <div className="px-4 py-2.5 bg-surface-active flex items-start gap-2">
        {isPaymentSent ? (
          <Check className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" strokeWidth={3} />
        ) : (
          <AlertCircle className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
        )}
        <p className="text-[12px] text-text-secondary leading-snug">
          {isPaymentSent
            ? "Your payment has been recorded. We'll notify you once the seller confirms and releases your USDT."
            : "Send only the exact amount. Don't add or round up — it must match exactly."}
        </p>
      </div>
    </div>
  );

  return (
    <ActiveOrderShell
      title={`Buy ${cryptoStr} USDT`}
      subtitle={`Order #${displayId}`}
      onBack={onClose}
      onInfo={onOpenOverview}
      milestones={view.milestones}
      currentIndex={view.currentIndex}
      banner={appealBanner}
      // 1. Current Step — concise guidance only (no detailed rows here).
      hero={
        <CurrentStepHero
          hero={view.hero}
          countdown={{
            remainingSec,
            label: isPaymentSent ? "Seller confirms within" : "Pay within",
            urgent: isUrgent && !isPaymentSent,
            totalSec,
          }}
        />
      }
      // 2. Primary Action — the pay button, or a calm waiting indicator once sent.
      primaryAction={
        isPaymentSent ? (
          <WaitingIndicator label={view.waitingLabel ?? "Waiting for the seller to confirm…"} />
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowPaidConfirm(true)}
            disabled={!canPay}
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-text-primary text-surface-base disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {primaryLabel}
          </motion.button>
        )
      }
      // 3. Supporting Information — who you're trading with.
      merchant={
        <MerchantCard
          name={order.merchant.name}
          avatarUrl={order.merchant.avatarUrl}
          rating={order.merchant.rating}
          trades={order.merchant.trades}
          isOnline={order.merchant.isOnline}
          unreadCount={order.unreadCount}
          onViewProfile={onViewProfile}
          onOpenChat={onOpenChat}
        />
      }
      // 4. Payment Details — the relocated "where to pay" rows + a compact recap.
      paymentSummary={
        <div className="space-y-3">
          {paymentDetails}
          <div className="grid grid-cols-3 gap-2">
            <SummaryTile icon={<Wallet className="w-4 h-4" />} label="You pay" value={fiatStr} />
            <SummaryTile
              icon={<ArrowDownToLine className="w-4 h-4" />}
              label="You get"
              value={cryptoStr}
              sub="USDT"
            />
            <SummaryTile
              icon={isCash ? <Banknote className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
              label="Method"
              value={isCash ? "Cash" : "Bank"}
            />
          </div>
        </div>
      }
      // 5. Escrow Protection — one concise line, shown only when it adds value.
      escrowProtection={
        view.showEscrowProtection && view.escrowNote ? (
          <div className={`rounded-2xl p-3.5 flex items-center gap-3 ${CARD}`}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-active">
              <ShieldCheck className="w-5 h-5 text-text-secondary" />
            </div>
            <p className="text-[13px] text-text-secondary leading-snug">{view.escrowNote}</p>
          </div>
        ) : null
      }
      // 6. Help & Appeal.
      help={
        <div className="space-y-2">
          <button
            onClick={onViewOverview}
            className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl text-left active:bg-surface-hover ${CARD}`}
          >
            <span className="text-[14px] font-medium text-text-primary">Order overview</span>
            <ChevronDown className="w-4 h-4 text-text-tertiary -rotate-90" />
          </button>
          <div className="flex gap-2">
            {!appealActive && (
              <button
                onClick={onAppeal}
                className="flex-1 py-3 rounded-2xl text-[14px] font-semibold text-text-secondary border border-border-medium hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
              >
                <AlertCircle className="w-4 h-4" />
                Report a problem
              </button>
            )}
            <button
              onClick={onNeedHelp}
              className="flex-1 py-3 rounded-2xl text-[14px] font-medium text-text-secondary hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
            >
              <HelpCircle className="w-4 h-4" />
              Need help
            </button>
          </div>
        </div>
      }
      // 7. Order Details (collapsed) — on-chain proof.
      details={
        order.escrowTxHash ? (
          <div className={`rounded-2xl overflow-hidden ${CARD}`}>
            <button
              type="button"
              onClick={() => setEscrowExpanded((o) => !o)}
              aria-expanded={escrowExpanded}
              className="w-full flex items-center gap-2.5 p-4 text-left"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface-active">
                <Shield className="w-4 h-4 text-text-secondary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-text-primary">Order details</p>
                <p className="text-[11px] text-text-tertiary">Verify the escrow lock on-chain</p>
              </div>
              <span className="flex items-center gap-1 text-[12px] font-medium text-text-secondary shrink-0">
                {escrowExpanded ? "Hide" : "View"}
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
                  <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-border-subtle">
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
        ) : null
      }
      overlays={
        <PaymentConfirmSheet
          open={showPaidConfirm && !needsPayMethodPick}
          amountLabel={fiatStr}
          destination={payDestination}
          checklist={paidChecklist}
          confirmLabel={confirmLabel}
          loading={isSubmitting}
          onClose={() => setShowPaidConfirm(false)}
          onConfirm={onMarkPaymentSent}
        />
      }
    />
  );
}

/** One copyable label/value line — shared by the cash and bank payment cards. */
function CopyLine({
  label,
  value,
  copyKey,
  copyValue,
  mono,
  accent,
  copiedField,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copyValue?: string;
  mono?: boolean;
  accent?: boolean;
  copiedField: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[13px] text-text-secondary shrink-0">{label}</span>
      <button
        onClick={() => onCopy(copyKey, copyValue ?? value)}
        aria-label={`Copy ${label}`}
        className="flex items-center gap-1.5 min-w-0 text-right -my-1.5 -mr-2 py-1.5 pr-2 pl-1 rounded-lg active:bg-surface-hover"
      >
        <span
          className={`text-[14px] truncate text-text-primary ${
            accent ? "font-semibold" : "font-medium"
          } ${mono ? "font-mono" : ""}`}
        >
          {value}
        </span>
        {copiedField === copyKey ? (
          <span className="inline-flex items-center gap-1 shrink-0 text-[11px] font-semibold text-text-secondary">
            <Check className="w-3.5 h-3.5" strokeWidth={3} /> Copied
          </span>
        ) : (
          <Copy className="w-4 h-4 text-text-tertiary shrink-0" />
        )}
      </button>
    </div>
  );
}

/** One copyable on-chain reference row inside the collapsible Order details. */
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
