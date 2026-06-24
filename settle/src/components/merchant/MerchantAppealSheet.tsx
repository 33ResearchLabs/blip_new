"use client";

/**
 * MerchantAppealSheet
 * ───────────────────
 * Merchant-side "Raise Appeal" bottom sheet. Mirrors the user AppealScreen but
 * in the merchant dark theme and without the buyer-oriented order overview.
 * The merchant picks an issue from the shared catalog (grouped resolvable vs
 * needs-dispute) + optional detail, then submits to the same endpoint the user
 * flow uses — POST /api/orders/[id]/appeal with initiated_by='merchant'.
 *
 * Opening an appeal pauses the order's auto-cancel/expiry timers and posts a
 * system message into the order chat (handled server-side). It does NOT change
 * the order status.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Flag, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { orderActionKey } from "@/lib/api/idempotencyKeys";
import { useMerchantStore } from "@/stores/merchantStore";
import { getAppealIssuesForStage, getAppealIssue } from "@/lib/appeals/issues";

export interface MerchantAppealSheetProps {
  orderId: string;
  /** Current order status — drives which issues are offered (stage-aware). */
  orderStatus: string;
  displayId?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function MerchantAppealSheet({
  orderId,
  orderStatus,
  displayId,
  onClose,
  onSubmitted,
}: MerchantAppealSheetProps) {
  const merchantId = useMerchantStore((s) => s.merchantId);
  const [issueKey, setIssueKey] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageIssues = getAppealIssuesForStage(orderStatus);
  const needsDescription = !!getAppealIssue(issueKey)?.requiresDescription;
  const isMutualCancel = issueKey === "mutual_cancel";
  const canSubmit =
    !!issueKey &&
    (!needsDescription || description.trim().length > 0) &&
    !submitting &&
    !!merchantId;

  // "Cancel & refund (mutual)" now opens a mutual_cancel APPEAL (same as every
  // other issue) — the counterparty agrees (→ cancel + refund) or rejects
  // (→ dispute), and an unanswered request auto-escalates to a dispute after the
  // appeal deadline. This unifies all post-accept resolution under the appeal
  // subsystem (no more split cancel-request path). Only offered before fiat is sent.
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/appeal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": orderActionKey(orderId, "open_appeal"),
        },
        body: JSON.stringify({
          issue_key: issueKey,
          description,
          initiated_by: "merchant",
          merchant_id: merchantId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        onSubmitted?.();
        onClose();
      } else {
        setError(data.error || "Failed to raise appeal. Please try again.");
      }
    } catch {
      setError("Failed to raise appeal. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-[480px] max-h-[88vh] overflow-y-auto scrollbar-hide rounded-t-3xl bg-[#161618] border-t border-white/[0.08]"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 32, stiffness: 320, mass: 0.8 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-[#161618] px-5 py-4 flex items-center gap-3 border-b border-white/[0.06]">
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.04] border border-white/[0.12]"
              aria-label="Back"
            >
              <ChevronLeft className="w-5 h-5 text-[#a1a1a6]" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-[16px] font-semibold text-[#f5f5f7]">Raise Appeal</h2>
              {displayId && (
                <p className="text-[12px] text-[#8e8e93] truncate">Order #{displayId}</p>
              )}
            </div>
          </div>

          <div className="px-5 py-4 space-y-4">
            <p className="text-[13px] text-[#a1a1a6] leading-snug">
              Pick the issue that best matches the situation. Most issues open a private
              appeal with the buyer; some can be escalated to a moderator.
            </p>

            {/* Reduced, stage-aware issue list */}
            <div className="space-y-2">
              {stageIssues.map((r) => {
                const on = issueKey === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setIssueKey(r.key)}
                    className={`w-full flex items-start gap-3 rounded-xl p-3 text-left border transition-colors ${
                      on
                        ? "border-white/40 bg-white/[0.08]"
                        : "border-white/[0.10] bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-[#f5f5f7]">{r.label}</p>
                        {r.escalates && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 shrink-0">
                            Moderator review
                          </span>
                        )}
                      </div>
                      <p className="text-[12.5px] text-[#a1a1a6] leading-snug">{r.desc}</p>
                    </div>
                    <span
                      className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        on ? "border-white" : "border-white/30"
                      }`}
                    >
                      {on && <span className="w-2.5 h-2.5 rounded-full bg-white" />}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Details — required when "Other" is selected */}
            <div>
              <p className="text-[13px] font-semibold text-[#f5f5f7] mb-2">
                Details {needsDescription ? "(required)" : "(optional)"}
              </p>
              <div className="relative">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add any detail that helps explain the issue..."
                  maxLength={500}
                  rows={4}
                  className="w-full rounded-xl p-3.5 pb-7 text-[14px] text-[#f5f5f7] bg-white/[0.03] border border-white/[0.10] resize-none outline-none placeholder:text-[#6b6b70]"
                />
                <span className="absolute bottom-2.5 right-3 text-[11px] text-[#6b6b70] tabular-nums">
                  {description.length}/500
                </span>
              </div>
            </div>

            {isMutualCancel && (
              <p className="text-[12px] text-[#a1a1a6] leading-snug">
                The other party must respond. If they agree, the order is cancelled and
                the escrow refunded. If they reject — or don&apos;t respond in time — it
                becomes a dispute for review.
              </p>
            )}

            {error && <p className="text-[12.5px] text-red-400">{error}</p>}

            {/* Primary action — opens an appeal (mutual_cancel included). */}
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full py-3.5 rounded-2xl text-[15px] font-semibold bg-white text-black disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Flag className="w-4 h-4" />
              )}
              {isMutualCancel ? "Request Cancellation" : "Submit Appeal"}
            </button>
            <div className="h-[max(env(safe-area-inset-bottom),0.5rem)]" />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
