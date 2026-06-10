"use client";

// User-side Trading Limits screen — the user equivalent of the merchant
// Settings → Limits tab (settle/src/app/market/settings/page.tsx). Same cards
// and request/verification flows, but:
//   • themed with the user app's design tokens (light/dark aware), and
//   • driven by the user's effective daily + per-transaction caps instead of
//     the merchant-only buy/sell side limits (buy/sell come back null for users
//     from /api/limits/me).
// All three endpoints (/api/limits/me, /api/limits/requests,
// /api/limits/x-verification) already accept user actors — no backend changes.

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  CreditCard,
  TrendingUp,
  ArrowRight,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  XCircle,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatFiat } from "@/lib/format";
import { UserXVerificationModal } from "@/components/user/UserXVerificationModal";
import type { Screen } from "./types";

const CARD = "bg-surface-card border border-border-subtle";

type RequestKind = "daily" | "per_transaction";

interface LimitsData {
  effective?: { dailyUsd?: number; perTradeUsd?: number };
  trailing_24h_usd?: number;
  largest_trade_24h_usd?: number;
  headroom_usd?: number;
}

interface LimitRequest {
  id: string;
  kind: RequestKind;
  current_limit_usd: string;
  requested_limit_usd: string;
  status: "pending" | "approved" | "rejected";
  reason?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

interface XVerif {
  x_username: string;
  verified_at: string;
}

interface LimitsScreenProps {
  setScreen: (s: Screen) => void;
}

export function LimitsScreen({ setScreen }: LimitsScreenProps) {
  const [limitsData, setLimitsData] = useState<LimitsData | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  const [limitRequests, setLimitRequests] = useState<LimitRequest[]>([]);
  const [requestsViewAll, setRequestsViewAll] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<LimitRequest | null>(
    null,
  );

  const [xVerif, setXVerif] = useState<XVerif | null>(null);
  const [showXVerifyModal, setShowXVerifyModal] = useState(false);

  // Request-increase modal state.
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [reqKind, setReqKind] = useState<RequestKind>("daily");
  const [reqAmount, setReqAmount] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqSubmitting, setReqSubmitting] = useState(false);

  const fetchLimits = useCallback(async () => {
    setLimitsLoading(true);
    setLimitsError(null);
    try {
      const res = await fetchWithAuth("/api/limits/me");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setLimitsData(json.data);
      } else {
        setLimitsError(json?.error || "Couldn't load your limits");
      }
    } catch (err) {
      console.error("Failed to load limits:", err);
      setLimitsError("Couldn't load your limits");
    } finally {
      setLimitsLoading(false);
    }
  }, []);

  const fetchLimitRequests = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/limits/requests");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        setLimitRequests(json.data);
      }
    } catch (err) {
      console.error("Failed to load limit requests:", err);
    }
  }, []);

  const fetchXVerification = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/limits/x-verification");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setXVerif(json.data ?? null);
      }
    } catch (err) {
      console.error("Failed to load X verification:", err);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
    fetchLimitRequests();
    fetchXVerification();
  }, [fetchLimits, fetchLimitRequests, fetchXVerification]);

  const openRequest = (kind: RequestKind) => {
    setReqKind(kind);
    setReqAmount("");
    setReqReason("");
    setReqError(null);
    setShowRequestModal(true);
  };

  const dailyCap = Number(limitsData?.effective?.dailyUsd ?? 0);
  const perTradeCap = Number(limitsData?.effective?.perTradeUsd ?? 0);

  const submitRequest = async () => {
    setReqError(null);
    const requestedUsd = Number(reqAmount.replace(/,/g, ""));
    if (!Number.isFinite(requestedUsd) || requestedUsd <= 0) {
      setReqError("Enter a valid amount.");
      return;
    }
    const currentUsd = reqKind === "daily" ? dailyCap : perTradeCap;
    if (requestedUsd <= currentUsd) {
      setReqError("Requested limit must be higher than your current limit.");
      return;
    }
    setReqSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/limits/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: reqKind,
          requested_limit_usd: requestedUsd,
          reason: reqReason.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setShowRequestModal(false);
        await fetchLimitRequests();
      } else {
        setReqError(json?.error || "Couldn't submit your request.");
      }
    } catch (err) {
      console.error("Failed to submit limit request:", err);
      setReqError("Couldn't submit your request.");
    } finally {
      setReqSubmitting(false);
    }
  };

  // Daily is a cumulative 24h cap, so it has real usage. Per-transaction is a
  // per-trade ceiling — there's no "used" total, so we surface the largest
  // single trade in the last 24h as how close they've come to the ceiling.
  const dailyUsed = Number(limitsData?.trailing_24h_usd ?? 0);
  const dailyRemaining =
    limitsData?.headroom_usd != null
      ? Number(limitsData.headroom_usd)
      : Math.max(dailyCap - dailyUsed, 0);
  const dailyPct = dailyCap > 0 ? Math.min(100, (dailyUsed / dailyCap) * 100) : 0;

  const largestTrade = Number(limitsData?.largest_trade_24h_usd ?? 0);
  const perTradePct =
    perTradeCap > 0 ? Math.min(100, (largestTrade / perTradeCap) * 100) : 0;

  const visibleRequests = requestsViewAll
    ? limitRequests
    : limitRequests.slice(0, 3);

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* Header */}
      <header className="px-5 pt-4 pb-4 shrink-0">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setScreen("profile")}
          aria-label="Back"
          className={`w-9 h-9 rounded-[14px] flex items-center justify-center mb-3 ${CARD}`}
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </motion.button>
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
          Trading Limits
        </p>
      </header>

      {/* Body */}
      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        <div className="w-full space-y-3">
          {limitsLoading && !limitsData ? (
            <div className={`rounded-[20px] p-12 text-center ${CARD}`}>
              <Loader2 className="w-5 h-5 text-text-tertiary mx-auto animate-spin" />
              <p className="text-xs text-text-tertiary mt-3">Loading limits…</p>
            </div>
          ) : limitsError ? (
            <div className={`rounded-[20px] p-8 text-center ${CARD}`}>
              <AlertCircle className="w-6 h-6 text-text-tertiary mx-auto mb-3" />
              <p className="text-sm text-text-secondary">{limitsError}</p>
              <button
                onClick={fetchLimits}
                className="mt-4 px-4 py-2 rounded-xl bg-surface-active border border-border-subtle text-[13px] text-text-secondary hover:bg-surface-hover transition-colors"
              >
                Retry
              </button>
            </div>
          ) : limitsData ? (
            <>
              {/* Card — Your Limits (caps, display-only) */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={`rounded-[20px] p-5 ${CARD}`}
              >
                <h3 className="text-[15px] font-bold text-text-primary mb-5">
                  Your Limits
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-0 sm:divide-x sm:divide-border-subtle">
                  {(
                    [
                      { key: "daily", label: "Daily Limit", Icon: Calendar, capUsd: dailyCap },
                      {
                        key: "perTrade",
                        label: "Per Transaction",
                        Icon: CreditCard,
                        capUsd: perTradeCap,
                      },
                    ] as const
                  ).map((b, idx) => {
                    const Icon = b.Icon;
                    return (
                      <div key={b.key} className={idx === 0 ? "sm:pr-7" : "sm:pl-7"}>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-text-secondary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] text-text-tertiary">{b.label}</p>
                            <p className="text-2xl font-bold text-text-primary leading-tight">
                              {formatFiat(b.capUsd, "USD")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              {/* Card — Limit Overview (usage) */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
                className={`rounded-[20px] p-5 ${CARD}`}
              >
                <h3 className="text-[15px] font-bold text-text-primary mb-5">
                  Limit Overview
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-0 sm:divide-x sm:divide-border-subtle">
                  {/* Daily — cumulative usage */}
                  <div className="sm:pr-7">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-9 h-9 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-text-secondary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] text-text-tertiary">Used today</p>
                        <p className="text-2xl font-bold text-text-primary leading-tight">
                          {formatFiat(dailyUsed, "USD")}
                        </p>
                        <p className="text-[12px] text-text-tertiary">
                          of {formatFiat(dailyCap, "USD")}
                        </p>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
                      <div
                        className="h-full rounded-full bg-text-primary transition-all"
                        style={{ width: `${dailyPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[12px]">
                      <span className="text-text-tertiary">
                        {Math.round(dailyPct)}% used
                      </span>
                      <span className="text-text-tertiary">
                        {formatFiat(dailyRemaining, "USD")} left
                      </span>
                    </div>
                  </div>

                  {/* Per-transaction — largest single trade vs the ceiling */}
                  <div className="sm:pl-7">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-9 h-9 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4 text-text-secondary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] text-text-tertiary">Largest trade (24h)</p>
                        <p className="text-2xl font-bold text-text-primary leading-tight">
                          {formatFiat(largestTrade, "USD")}
                        </p>
                        <p className="text-[12px] text-text-tertiary">
                          max {formatFiat(perTradeCap, "USD")} per trade
                        </p>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
                      <div
                        className="h-full rounded-full bg-text-primary transition-all"
                        style={{ width: `${perTradePct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[12px]">
                      <span className="text-text-tertiary">
                        {Math.round(perTradePct)}% of cap
                      </span>
                      <span className="text-text-tertiary">
                        {formatFiat(Math.max(perTradeCap - largestTrade, 0), "USD")} headroom
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Card — Need a higher limit? */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                className={`rounded-[20px] p-5 flex flex-col sm:flex-row sm:items-center gap-4 ${CARD}`}
              >
                <div className="w-12 h-12 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-text-primary">
                    Need a higher limit?
                  </p>
                  <p className="text-[13px] text-text-tertiary">
                    Request an increase to trade larger amounts.
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => openRequest("daily")}
                  className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent text-accent-text text-[13px] font-bold hover:opacity-90 transition-opacity"
                >
                  Request Increase
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
              </motion.div>

              {/* Card — Social Verification (X / Twitter), self-attested */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
                className={`rounded-[20px] p-5 ${CARD}`}
              >
                <h3 className="text-[15px] font-bold text-text-primary mb-4">
                  Social Verification
                </h3>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      className="w-5 h-5 text-text-secondary"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold text-text-primary">
                      Verify your X account
                    </p>
                    <p className="text-[13px] text-text-tertiary">
                      {xVerif ? (
                        <>
                          Verified as{" "}
                          <span className="text-text-secondary">@{xVerif.x_username}</span>
                        </>
                      ) : (
                        "Follow @blip_money on X and confirm your handle."
                      )}
                    </p>
                  </div>
                  {xVerif ? (
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold bg-green-500/10 text-green-500 border border-green-500/20">
                        <Check className="w-3.5 h-3.5" />
                        Verified
                      </span>
                      <button
                        onClick={() => setShowXVerifyModal(true)}
                        className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setShowXVerifyModal(true)}
                      className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-surface-active border border-border-medium text-[13px] font-bold text-text-primary hover:bg-surface-hover transition-colors"
                    >
                      Verify
                      <ArrowRight className="w-4 h-4" />
                    </motion.button>
                  )}
                </div>
              </motion.div>

              {/* Card — Recent Limit Requests */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                className={`rounded-[20px] p-5 ${CARD}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[15px] font-bold text-text-primary">
                    Recent Limit Requests
                  </h3>
                  {limitRequests.length > 3 && (
                    <button
                      onClick={() => setRequestsViewAll((v) => !v)}
                      className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
                    >
                      {requestsViewAll ? "Show less" : "View All"}
                    </button>
                  )}
                </div>

                {limitRequests.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-[13px] text-text-tertiary">
                      No limit requests yet.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {visibleRequests.map((r) => {
                      const kindLabel =
                        r.kind === "daily"
                          ? "Daily Limit Increase"
                          : "Per Transaction Limit Increase";
                      const created = new Date(r.created_at);
                      const statusStyle =
                        r.status === "approved"
                          ? "bg-green-500/10 text-green-500 border-green-500/20"
                          : r.status === "rejected"
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-amber-500/10 text-amber-500 border-amber-500/20";
                      const RowIcon = r.kind === "daily" ? Calendar : CreditCard;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedRequest(r)}
                          aria-label={`View ${kindLabel} request details`}
                          className="w-full flex items-center gap-3 py-3.5 text-left -mx-1 px-1 rounded-lg hover:bg-surface-hover transition-colors"
                        >
                          <div className="w-9 h-9 rounded-lg bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                            <RowIcon className="w-4 h-4 text-text-tertiary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-text-primary truncate">
                              {kindLabel}
                            </p>
                            <p className="text-[11px] text-text-tertiary">
                              {created.toLocaleDateString("en-US", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                              ,{" "}
                              {created.toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <span
                            className={`text-[10px] font-bold capitalize px-2 py-1 rounded-md border ${statusStyle}`}
                          >
                            {r.status}
                          </span>
                          <div className="hidden sm:flex items-center gap-2 text-[12px] text-text-secondary shrink-0">
                            <span>{formatFiat(Number(r.current_limit_usd), "USD")}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-text-tertiary" />
                            <span className="text-text-primary">
                              {formatFiat(Number(r.requested_limit_usd), "USD")}
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-text-tertiary shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>

              <p className="text-[11px] text-text-tertiary text-center pt-1 pb-4">
                We typically respond to limit requests within 24–48 hours.
              </p>
            </>
          ) : null}
        </div>
      </div>

      {/* Request-increase modal */}
      <AnimatePresence>
        {showRequestModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => !reqSubmitting && setShowRequestModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 ${CARD}`}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-text-primary">
                  Request Limit Increase
                </h3>
                <button
                  onClick={() => !reqSubmitting && setShowRequestModal(false)}
                  aria-label="Close"
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Which limit */}
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
                    onClick={() => setReqKind(opt.k)}
                    className={`px-3 py-2.5 rounded-xl text-[13px] font-medium border transition-colors ${
                      reqKind === opt.k
                        ? "bg-surface-active border-border-medium text-text-primary"
                        : "bg-surface-base border-border-subtle text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Current limit for the selected kind */}
              <div className="flex items-center justify-between mb-4 px-3.5 py-3 rounded-xl bg-surface-base border border-border-subtle">
                <span className="text-[12px] text-text-tertiary">
                  Current {reqKind === "daily" ? "daily" : "per-transaction"} limit
                </span>
                <span className="text-[13px] font-medium text-text-primary">
                  {formatFiat(reqKind === "daily" ? dailyCap : perTradeCap, "USD")}
                </span>
              </div>

              {/* Requested amount (USD) */}
              <label className="block text-[12px] text-text-tertiary mb-2">
                Requested limit ($)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={reqAmount}
                onChange={(e) => setReqAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                maxLength={14}
                placeholder="e.g. 500"
                className="w-full px-3.5 py-3 rounded-xl bg-surface-base border border-border-subtle text-text-primary text-sm placeholder:text-text-quaternary focus:outline-none focus:border-border-medium mb-4"
              />

              {/* Reason */}
              <label className="block text-[12px] text-text-tertiary mb-2">
                Reason (optional)
              </label>
              <textarea
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Tell us why you need a higher limit…"
                className="w-full px-3.5 py-3 rounded-xl bg-surface-base border border-border-subtle text-text-primary text-sm placeholder:text-text-quaternary focus:outline-none focus:border-border-medium resize-none mb-2"
              />

              {reqError && <p className="text-[12px] text-red-400 mb-2">{reqError}</p>}

              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => setShowRequestModal(false)}
                  disabled={reqSubmitting}
                  className="flex-1 px-4 py-3 rounded-xl bg-surface-active border border-border-subtle text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitRequest}
                  disabled={reqSubmitting}
                  className="flex-1 px-4 py-3 rounded-xl bg-accent text-accent-text text-[13px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {reqSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {reqSubmitting ? "Submitting…" : "Submit Request"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Request detail — status + full breakdown for a single request. */}
      <AnimatePresence>
        {selectedRequest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedRequest(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 ${CARD}`}
            >
              {(() => {
                const r = selectedRequest;
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
                const fmtDate = (d: Date) =>
                  `${d.toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}, ${d.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}`;
                const status = {
                  pending: {
                    Icon: Clock,
                    label: "Pending review",
                    style:
                      "bg-amber-500/10 text-amber-500 border-amber-500/20",
                    message:
                      "We typically respond to limit requests within 24–48 hours.",
                  },
                  approved: {
                    Icon: Check,
                    label: "Approved",
                    style:
                      "bg-green-500/10 text-green-500 border-green-500/20",
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
                    {/* Header */}
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-surface-active border border-border-subtle flex items-center justify-center shrink-0">
                          <RowIcon className="w-4 h-4 text-text-secondary" />
                        </div>
                        <h3 className="text-[15px] font-bold text-text-primary truncate">
                          {kindLabel}
                        </h3>
                      </div>
                      <button
                        onClick={() => setSelectedRequest(null)}
                        aria-label="Close"
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Status banner */}
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

                    {/* Limit change */}
                    <div className="rounded-xl bg-surface-base border border-border-subtle p-4 mb-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-[11px] text-text-tertiary">
                            Current
                          </p>
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

                    {/* Reason */}
                    {r.reason && r.reason.trim() && (
                      <div className="rounded-xl bg-surface-base border border-border-subtle p-4 mb-3">
                        <p className="text-[11px] text-text-tertiary mb-1">
                          Your reason
                        </p>
                        <p className="text-[13px] text-text-secondary whitespace-pre-wrap break-words">
                          {r.reason}
                        </p>
                      </div>
                    )}

                    {/* Timeline */}
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
                      onClick={() => setSelectedRequest(null)}
                      className="w-full mt-6 px-4 py-3 rounded-xl bg-surface-active border border-border-subtle text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
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

      {/* X (Twitter) account verification modal — bound to the user account. */}
      <UserXVerificationModal
        isOpen={showXVerifyModal}
        onClose={() => setShowXVerifyModal(false)}
        currentHandle={xVerif?.x_username}
        onVerified={() => {
          fetchXVerification();
        }}
      />
    </div>
  );
}
