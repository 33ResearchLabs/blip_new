"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatFiat } from "@/lib/format";
import type { RequestKind, SurfaceTokens } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  surfaces: SurfaceTokens;
  dailyCap: number;
  perTradeCap: number;
  /** Which kind to preselect when opened. */
  defaultKind: RequestKind;
  /** Called after a successful submit so the parent can refetch the list. */
  onSubmitted: () => void;
}

export function RequestIncreaseModal({
  open,
  onClose,
  surfaces,
  dailyCap,
  perTradeCap,
  defaultKind,
  onSubmitted,
}: Props) {
  const [kind, setKind] = useState<RequestKind>(defaultKind);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the modal opens (defaultKind may have changed).
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setKind(defaultKind);
    setAmount("");
    setReason("");
    setError(null);
  } else if (!open && lastOpen) {
    setLastOpen(false);
  }

  const submit = async () => {
    setError(null);
    const requestedUsd = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(requestedUsd) || requestedUsd <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    const currentUsd = kind === "daily" ? dailyCap : perTradeCap;
    if (requestedUsd <= currentUsd) {
      setError("Requested limit must be higher than your current limit.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/limits/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          requested_limit_usd: requestedUsd,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        onClose();
        onSubmitted();
      } else {
        setError(json?.error || "Couldn't submit your request.");
      }
    } catch (err) {
      console.error("Failed to submit limit request:", err);
      setError("Couldn't submit your request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-md"
          onClick={() => !submitting && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl p-6 border border-border-subtle bg-background"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-text-primary">
                Request Limit Increase
              </h3>
              <button
                onClick={() => !submitting && onClose()}
                aria-label="Close"
                className={`p-1.5 rounded-lg text-text-tertiary hover:text-text-primary ${surfaces.hover} transition-colors`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[12px] text-text-tertiary mb-2">Which limit?</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {(
                [
                  { k: "daily", label: "Daily" },
                  { k: "per_transaction", label: "Per Transaction" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setKind(opt.k)}
                  className={`px-3 py-2.5 rounded-xl text-[13px] font-medium border transition-colors ${
                    kind === opt.k
                      ? `${surfaces.chip} border-border-medium text-text-primary`
                      : `bg-transparent border-border-subtle text-text-tertiary hover:text-text-secondary`
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div
              className={`flex items-center justify-between mb-4 px-3.5 py-3 rounded-xl border border-border-subtle ${surfaces.chip}`}
            >
              <span className="text-[12px] text-text-tertiary">
                Current {kind === "daily" ? "daily" : "per-transaction"} limit
              </span>
              <span className="text-[13px] font-medium text-text-primary">
                {formatFiat(kind === "daily" ? dailyCap : perTradeCap, "USD")}
              </span>
            </div>

            <label className="block text-[12px] text-text-tertiary mb-2">
              Requested limit ($)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              maxLength={14}
              placeholder="e.g. 500"
              className={`w-full px-3.5 py-3 rounded-xl border border-border-subtle text-text-primary text-sm placeholder:text-text-quaternary focus:outline-none focus:border-border-medium mb-4 ${surfaces.chip}`}
            />

            <label className="block text-[12px] text-text-tertiary mb-2">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Tell us why you need a higher limit…"
              className={`w-full px-3.5 py-3 rounded-xl border border-border-subtle text-text-primary text-sm placeholder:text-text-quaternary focus:outline-none focus:border-border-medium resize-none mb-2 ${surfaces.chip}`}
            />

            {error && <p className="text-[12px] text-red-400 mb-2">{error}</p>}

            <div className="flex gap-3 mt-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className={`flex-1 px-4 py-3 rounded-xl border border-border-subtle text-[13px] font-medium text-text-secondary ${surfaces.chip} ${surfaces.hover} transition-colors disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 px-4 py-3 rounded-xl bg-accent text-accent-text text-[13px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
