"use client";

/**
 * AppealScreen
 * ────────────
 * Full-screen "Raise Appeal" form. The user picks an issue from the shared
 * catalog (grouped into "Resolve together" peer-fixable cases vs "Needs a
 * dispute" moderator cases), adds detail and (optionally) screenshots, then
 * submits — which opens the peer-to-peer appeal on the order
 * (`POST /api/orders/[id]/appeal`). Opening an appeal pauses the auto-cancel /
 * expiry timers; it does NOT change the order status.
 *
 * Pure presentation: the selected issue_key + description are lifted to the
 * parent (OrderDetailScreen via useUserOrderActions) so the submit logic lives
 * in exactly one place. Mirrors the layout language of the other order screens
 * (py-4 / 1rem header, surface-card tokens, warning-dim info banners).
 *
 * NOTE: evidence upload is still client-side only here — wiring it to real
 * storage is a follow-up phase. Files are validated + previewed so the UI is
 * complete, but they are not transmitted yet.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  HelpCircle,
  ShieldAlert,
  Star,
  MessageCircle,
  Upload,
  Lock,
  Loader2,
  Check,
  X,
} from "lucide-react";
import type { Order } from "./types";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatCrypto, formatRate, formatCount } from "@/lib/format";
import { getAppealIssuesForStage, getAppealIssue } from "@/lib/appeals/issues";

const CARD = "bg-surface-card border border-border-subtle";

function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "AED ";
    default: return `${(code || "AED").toUpperCase()} `;
  }
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED = ["image/png", "image/jpeg", "image/jpg"];

export interface AppealScreenProps {
  order: Order;
  displayId: string;
  /** Current order status — drives which issues are offered (stage-aware). */
  orderStatus: string;
  reason: string;
  description: string;
  onReasonChange: (r: string) => void;
  onDescriptionChange: (d: string) => void;
  onClose: () => void;
  onOpenChat: () => void;
  onViewProfile: () => void;
  onNeedHelp: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  /** Fires the mutual cancel-request flow when "Cancel & refund" is selected. */
  onRequestCancel?: () => void;
  isRequestingCancel?: boolean;
}

export function AppealScreen({
  order,
  displayId,
  orderStatus,
  reason,
  description,
  onReasonChange,
  onDescriptionChange,
  onClose,
  onOpenChat,
  onViewProfile,
  onNeedHelp,
  onSubmit,
  isSubmitting,
  onRequestCancel,
  isRequestingCancel,
}: AppealScreenProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = `${formatCrypto(parseFloat(order.cryptoAmount))} USDT`;
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFileError(null);
    const incoming = Array.from(list);
    const next: File[] = [...files];
    for (const f of incoming) {
      if (next.length >= MAX_FILES) {
        setFileError(`You can attach up to ${MAX_FILES} files.`);
        break;
      }
      if (!ACCEPTED.includes(f.type)) {
        setFileError("Only PNG, JPG or JPEG files are allowed.");
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setFileError("Each file must be 10MB or smaller.");
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  const stageIssues = getAppealIssuesForStage(orderStatus);
  const selectedIssue = getAppealIssue(reason);
  const isDisputeIssue = selectedIssue?.group === "dispute";
  const isMutualCancel = selectedIssue?.key === "mutual_cancel" && !!onRequestCancel;
  const needsDescription = !!selectedIssue?.requiresDescription;
  const canSubmit =
    !!reason &&
    (!needsDescription || description.trim().length > 0) &&
    !isSubmitting &&
    !isRequestingCancel;

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
          <h1 className="text-[17px] font-semibold text-text-primary truncate">Raise Appeal</h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <button
          onClick={onNeedHelp}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Help"
        >
          <HelpCircle className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="px-5 pb-10 space-y-4">
        {/* Need help? banner */}
        <div className="rounded-2xl p-4 flex gap-3 bg-warning-dim border border-warning-border">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-warning/15">
            <ShieldAlert className="w-5 h-5 text-warning" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary mb-0.5">Need help?</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              If you face any issue with this order, you can raise an appeal. Our support team will
              review and help resolve it.
            </p>
          </div>
        </div>

        {/* Order overview */}
        <div className={`rounded-2xl p-4 ${CARD}`}>
          <p className="text-[15px] font-semibold text-text-primary mb-3">Order overview</p>
          <div className="grid grid-cols-4 gap-3">
            <OverviewCell label="You pay" value={fiatStr} />
            <OverviewCell label="You will receive" value={cryptoStr} />
            <OverviewCell label="Rate" value={`${sym}${formatRate(order.merchant.rate)}`} />
            <OverviewCell label="Payment method" value={order.merchant.paymentMethod === "cash" ? "Cash" : "Bank Transfer"} />
          </div>
        </div>

        {/* Merchant card */}
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}>
          <button
            onClick={() => order.merchant.name && onViewProfile()}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
            aria-label="View merchant profile"
          >
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-border-subtle flex items-center justify-center">
                <UserAvatar
                  src={order.merchant.avatarUrl}
                  seed={order.merchant.name || order.merchant.username}
                  size={48}
                  alt={order.merchant.name}
                />
              </div>
              {order.merchant.isOnline && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface-card" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[15px] font-semibold text-text-primary truncate">{order.merchant.name}</p>
                {order.merchant.rating > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-text-secondary shrink-0">
                    <Star className="w-3.5 h-3.5 text-warning fill-warning" />
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
            className="shrink-0 flex flex-col items-center gap-0.5 w-14 h-14 rounded-xl justify-center bg-surface-active border border-border-subtle"
            aria-label="Chat with merchant"
          >
            <MessageCircle className="w-5 h-5 text-text-secondary" />
            <span className="text-[10px] text-text-tertiary">Chat</span>
          </button>
        </div>

        {/* What's the issue? — reduced, stage-aware list */}
        <div className={`rounded-2xl p-4 ${CARD}`}>
          <p className="text-[15px] font-semibold text-text-primary">What&apos;s the issue?</p>
          <p className="text-[13px] text-text-tertiary mb-3">Pick the option that best matches your situation.</p>
          <div className="space-y-2.5">
            {stageIssues.map((r) => {
              const on = reason === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => onReasonChange(r.key)}
                  className={`w-full flex items-start gap-3 rounded-xl p-3.5 text-left border transition-colors ${
                    on ? "border-warning bg-warning-dim" : "border-border-subtle bg-surface-base"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-text-primary">{r.label}</p>
                      {r.escalates && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-warning-dim text-warning shrink-0">
                          Moderator review
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-text-secondary leading-snug">{r.desc}</p>
                  </div>
                  <span
                    className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      on ? "border-warning" : "border-border-medium"
                    }`}
                  >
                    {on && <span className="w-2.5 h-2.5 rounded-full bg-warning" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Details — required when "Other" is selected */}
        <div className={`rounded-2xl p-4 ${CARD}`}>
          <p className="text-[15px] font-semibold text-text-primary">
            Details{" "}
            <span className="text-text-tertiary font-normal">
              {needsDescription ? "(Required)" : "(Optional)"}
            </span>
          </p>
          <p className="text-[13px] text-text-tertiary mb-3">
            {needsDescription
              ? "Describe your issue so the other party can understand and help."
              : "Add any extra detail about the issue."}
          </p>
          <div className="relative">
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Describe your issue in detail..."
              maxLength={500}
              rows={4}
              className="w-full rounded-xl p-3.5 pb-7 text-[14px] text-text-primary bg-surface-base border border-border-medium resize-none outline-none placeholder:text-text-quaternary"
            />
            <span className="absolute bottom-2.5 right-3 text-[11px] text-text-tertiary tabular-nums">
              {description.length}/500
            </span>
          </div>
        </div>

        {/* Add supporting evidence */}
        <div className={`rounded-2xl p-4 ${CARD}`}>
          <p className="text-[15px] font-semibold text-text-primary">
            Add supporting evidence <span className="text-text-tertiary font-normal">(Optional)</span>
          </p>
          <p className="text-[13px] text-text-tertiary mb-3">
            Upload screenshots or proof to help us understand the issue better.
          </p>

          <label className="block cursor-pointer">
            <input
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="rounded-xl border border-dashed border-border-medium py-7 px-4 flex flex-col items-center justify-center gap-1.5 text-center">
              <Upload className="w-5 h-5 text-text-secondary" />
              <p className="text-[14px] font-medium text-text-primary">Upload screenshot</p>
              <p className="text-[12px] text-text-tertiary">PNG, JPG, JPEG (Max. 10MB each)</p>
            </div>
          </label>

          {fileError && <p className="text-[12px] text-error mt-2">{fileError}</p>}

          {files.length > 0 && (
            <div className="mt-3 space-y-2">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl px-3 py-2 bg-surface-active border border-border-subtle">
                  <Check className="w-4 h-4 text-success shrink-0" />
                  <span className="text-[13px] text-text-primary truncate flex-1 min-w-0">{f.name}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-text-tertiary"
                    aria-label="Remove file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* What happens next? — copy adapts to the selected issue group */}
        <div className="rounded-2xl p-4 flex gap-3 bg-warning-dim border border-warning-border">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-warning/15">
            <Lock className="w-5 h-5 text-warning" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary mb-0.5">What happens next?</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              {isMutualCancel
                ? "Requesting a cancellation needs the other party to accept. If they agree, the order is cancelled and the escrow is refunded. (Only available before the buyer has paid.)"
                : isDisputeIssue
                ? "This type of issue is reviewed by a moderator. Your appeal can be escalated to a formal dispute, and the escrow stays locked until it's resolved."
                : "Your appeal opens a private resolution with the other party. The escrow stays locked and auto-timeouts are paused while you sort it out — if it isn't resolved, it can be escalated to a moderator."}
            </p>
          </div>
        </div>

        {/* Primary action — becomes "Request Cancellation" when the user picks
            Cancel & refund, firing the existing mutual cancel-request flow. */}
        {isMutualCancel ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onRequestCancel}
            disabled={!!isRequestingCancel || isSubmitting}
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRequestingCancel && <Loader2 className="w-4 h-4 animate-spin" />}
            Request Cancellation
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Appeal
          </motion.button>
        )}
      </div>
    </div>
  );
}

function OverviewCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-tertiary mb-1 leading-tight">{label}</p>
      <p className="text-[14px] font-semibold text-text-primary leading-tight break-words">{value}</p>
    </div>
  );
}
