"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Calendar,
  CreditCard,
  ArrowRight,
  Check,
  Clock,
  XCircle,
} from "lucide-react";
import { formatFiat } from "@/lib/format";
import type { LimitRequest, SurfaceTokens } from "./types";

interface Props {
  request: LimitRequest | null;
  onClose: () => void;
  surfaces: SurfaceTokens;
}

const fmtDate = (d: Date) =>
  `${d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;

export function RequestDetailModal({ request, onClose, surfaces }: Props) {
  return (
    <AnimatePresence>
      {request && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl p-6 border border-border-subtle ${surfaces.card}`}
          >
            {(() => {
              const r = request;
              const kindLabel =
                r.kind === "daily"
                  ? "Daily Limit Increase"
                  : "Per Transaction Limit Increase";
              const RowIcon = r.kind === "daily" ? Calendar : CreditCard;
              const current = Number(r.current_limit_usd);
              const requested = Number(r.requested_limit_usd);
              const increase = Math.max(requested - current, 0);
              const submitted = new Date(r.created_at);
              const reviewed = r.reviewed_at ? new Date(r.reviewed_at) : null;
              const status = {
                pending: {
                  Icon: Clock,
                  label: "Pending review",
                  style: "bg-amber-500/10 text-amber-500 border-amber-500/20",
                  message:
                    "We typically respond to limit requests within 24–48 hours.",
                },
                approved: {
                  Icon: Check,
                  label: "Approved",
                  style: "bg-green-500/10 text-green-500 border-green-500/20",
                  message: "Approved — your new limit is now active.",
                },
                rejected: {
                  Icon: XCircle,
                  label: "Not approved",
                  style: "bg-red-500/10 text-red-400 border-red-500/20",
                  message:
                    "This request wasn't approved. You can submit a new request anytime.",
                },
              }[r.status];
              const StatusIcon = status.Icon;
              return (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg border border-border-subtle flex items-center justify-center shrink-0 ${surfaces.chip}`}
                      >
                        <RowIcon className="w-4 h-4 text-text-secondary" />
                      </div>
                      <h3 className="text-[15px] font-bold text-text-primary truncate">
                        {kindLabel}
                      </h3>
                    </div>
                    <button
                      onClick={onClose}
                      aria-label="Close"
                      className={`p-1.5 rounded-lg text-text-tertiary hover:text-text-primary ${surfaces.hover} transition-colors shrink-0`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div
                    className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border mb-5 ${status.style}`}
                  >
                    <StatusIcon className="w-5 h-5 shrink-0 mt-px" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold">{status.label}</p>
                      <p className="text-[12px] opacity-80 mt-0.5">
                        {status.message}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`rounded-xl border border-border-subtle p-4 mb-3 ${surfaces.inset}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-[11px] text-text-tertiary">Current</p>
                        <p className="text-[15px] font-bold text-text-primary">
                          {formatFiat(current, "USD")}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-text-tertiary shrink-0 mx-3" />
                      <div className="min-w-0 text-right">
                        <p className="text-[11px] text-text-tertiary">
                          Requested
                        </p>
                        <p className="text-[15px] font-bold text-text-primary">
                          {formatFiat(requested, "USD")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
                      <span className="text-[12px] text-text-tertiary">
                        Increase
                      </span>
                      <span className="text-[13px] font-semibold text-text-primary">
                        +{formatFiat(increase, "USD")}
                      </span>
                    </div>
                  </div>

                  {r.reason && r.reason.trim() && (
                    <div
                      className={`rounded-xl border border-border-subtle p-4 mb-3 ${surfaces.inset}`}
                    >
                      <p className="text-[11px] text-text-tertiary mb-1">
                        Your reason
                      </p>
                      <p className="text-[13px] text-text-secondary whitespace-pre-wrap break-words">
                        {r.reason}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2.5 px-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-tertiary">
                        Submitted
                      </span>
                      <span className="text-[12px] font-medium text-text-secondary">
                        {fmtDate(submitted)}
                      </span>
                    </div>
                    {reviewed && (
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-text-tertiary">
                          Reviewed
                        </span>
                        <span className="text-[12px] font-medium text-text-secondary">
                          {fmtDate(reviewed)}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={onClose}
                    className={`w-full mt-6 px-4 py-3 rounded-xl border border-border-subtle text-[13px] font-medium text-text-secondary ${surfaces.chip} ${surfaces.hover} transition-colors`}
                  >
                    Close
                  </button>
                </>
              );
            })()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
