"use client";

// Shared Trading Limits experience for BOTH the user app and the merchant
// Settings → Limits tab. Themed via semantic tokens (text/border/status/accent
// are per-theme in both scopes); only surface backgrounds are parameterized by
// `variant` (see SURFACES in ./types). The host provides the page title/back —
// this renders the body (subtitle + badge downward).

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  CreditCard,
  ShoppingCart,
  TrendingUp,
  ShieldCheck,
  Loader2,
  AlertCircle,
  ArrowRight,
  ArrowDown,
  ChevronRight,
  HelpCircle,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatFiat } from "@/lib/format";
import { UserXVerificationModal } from "@/components/user/UserXVerificationModal";
import { MerchantXVerificationModal } from "@/components/merchant/MerchantXVerificationModal";
import { UnlockHigherLimits } from "./UnlockHigherLimits";
import { StakeUSDTView } from "./StakeUSDTView";
import { RequestIncreaseModal } from "./RequestIncreaseModal";
import { RequestDetailModal } from "./RequestDetailModal";
import {
  SURFACES,
  type LimitsMe,
  type LimitRequest,
  type LimitsVariant,
  type RequestKind,
  type XVerif,
} from "./types";

interface Props {
  variant: LimitsVariant;
  onNavigate?: (dest: "trade" | "help") => void;
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const, delay },
});

export function TradingLimitsView({ variant, onNavigate }: Props) {
  const surfaces = SURFACES[variant];

  const [data, setData] = useState<LimitsMe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [requests, setRequests] = useState<LimitRequest[]>([]);
  const [viewAll, setViewAll] = useState(false);
  const [selected, setSelected] = useState<LimitRequest | null>(null);

  const [xVerif, setXVerif] = useState<XVerif | null>(null);
  const [showX, setShowX] = useState(false);
  const [showStake, setShowStake] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [reqKind, setReqKind] = useState<RequestKind>("daily");
  const [showDecreaseInfo, setShowDecreaseInfo] = useState(false);

  const fetchLimits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/limits/me");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setData(json.data);
      else setError(json?.error || "Couldn't load your limits");
    } catch (err) {
      console.error("Failed to load limits:", err);
      setError("Couldn't load your limits");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/limits/requests");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && Array.isArray(json.data))
        setRequests(json.data);
    } catch (err) {
      console.error("Failed to load limit requests:", err);
    }
  }, []);

  const fetchX = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/limits/x-verification");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setXVerif(json.data ?? null);
    } catch (err) {
      console.error("Failed to load X verification:", err);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
    fetchRequests();
    fetchX();
  }, [fetchLimits, fetchRequests, fetchX]);

  const openRequest = (kind: RequestKind) => {
    setReqKind(kind);
    setShowRequest(true);
  };

  // Derived values.
  const dailyCap = Number(data?.effective?.dailyUsd ?? 0);
  const perTradeCap = Number(data?.effective?.perTradeUsd ?? 0);
  const dailyUsed = Number(data?.trailing_24h_usd ?? 0);
  const dailyRemaining =
    data?.headroom_usd != null
      ? Number(data.headroom_usd)
      : Math.max(dailyCap - dailyUsed, 0);
  const dailyPct = dailyCap > 0 ? Math.min(100, (dailyUsed / dailyCap) * 100) : 0;
  const largestTrade = Number(data?.largest_trade_24h_usd ?? 0);
  const perTradePct =
    perTradeCap > 0 ? Math.min(100, (largestTrade / perTradeCap) * 100) : 0;

  const visibleRequests = viewAll ? requests : requests.slice(0, 3);

  // Summary cards (top two).
  const summary = [
    {
      key: "daily",
      label: "Daily Limit",
      Icon: Calendar,
      value: dailyCap,
      sub: `of ${formatFiat(dailyCap, "USD")}`,
    },
    {
      key: "perTrade",
      label: "Per Transaction",
      Icon: CreditCard,
      value: perTradeCap,
      sub: "max per trade",
    },
  ] as const;

  // Merchant-only per-side caps (buy/sell), enforced on order creation.
  const sideCaps =
    variant === "merchant"
      ? [
          {
            key: "buy",
            label: "Buy Limit",
            Icon: ShoppingCart,
            cap: Number(data?.buy?.limitUsd ?? 0),
            used: Number(data?.buy?.usedUsd ?? 0),
          },
          {
            key: "sell",
            label: "Sell Limit",
            Icon: TrendingUp,
            cap: Number(data?.sell?.limitUsd ?? 0),
            used: Number(data?.sell?.usedUsd ?? 0),
          },
        ]
      : [];

  return (
    <div className="w-full space-y-3">
      {/* Subtitle + Secure & Verified badge */}
      <h2 className="text-lg font-bold text-text-primary mb-1">Limits</h2>
      <div className="flex items-start justify-between gap-3 pb-1">
        <p className="text-[13px] text-text-tertiary leading-snug max-w-[60ch]">
          Complete the steps below to unlock higher trading limits and trade
          more.
        </p>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold bg-text-primary text-surface-base shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          Secure &amp; Verified
        </span>
      </div>

      {loading && !data ? (
        <div
          className={`rounded-[20px] p-12 text-center border border-border-subtle ${surfaces.card}`}
        >
          <Loader2 className="w-5 h-5 text-text-tertiary mx-auto animate-spin" />
          <p className="text-xs text-text-tertiary mt-3">Loading limits…</p>
        </div>
      ) : error ? (
        <div
          className={`rounded-[20px] p-8 text-center border border-border-subtle ${surfaces.card}`}
        >
          <AlertCircle className="w-6 h-6 text-text-tertiary mx-auto mb-3" />
          <p className="text-sm text-text-secondary">{error}</p>
          <button
            onClick={fetchLimits}
            className={`mt-4 px-4 py-2 rounded-xl border border-border-subtle text-[13px] text-text-secondary ${surfaces.chip} ${surfaces.hover} transition-colors`}
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <>
          {/* Summary — Daily + Per Transaction */}
          <motion.div {...fade()} className="grid grid-cols-2 gap-3">
            {summary.map((b) => {
              const Icon = b.Icon;
              // Daily limit "decreased" state — red ↓ + reason + tappable popup.
              const isDailyDecrease = b.key === "daily" && !!data.decrease_alert;
              const unsuccessful = Number(data.unsuccessful_24h ?? 0);
              return (
                <div
                  key={b.key}
                  onClick={
                    isDailyDecrease ? () => setShowDecreaseInfo(true) : undefined
                  }
                  role={isDailyDecrease ? "button" : undefined}
                  tabIndex={isDailyDecrease ? 0 : undefined}
                  className={`rounded-[20px] p-4 border border-border-subtle ${surfaces.card} ${
                    isDailyDecrease
                      ? `cursor-pointer ${surfaces.hover} transition-colors`
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div
                      className={`w-8 h-8 rounded-full border border-border-subtle flex items-center justify-center shrink-0 ${surfaces.chip}`}
                    >
                      <Icon className="w-4 h-4 text-text-secondary" />
                    </div>
                    <p className="text-[12px] text-text-tertiary">{b.label}</p>
                  </div>
                  <p className="text-[22px] font-extrabold text-text-primary leading-none tracking-[-0.02em] inline-flex items-center gap-1">
                    {formatFiat(b.value, "USD")}
                    {isDailyDecrease && (
                      <ArrowDown className="w-4 h-4 text-red-500" />
                    )}
                  </p>
                  {isDailyDecrease ? (
                    <p className="text-[11px] text-red-500 mt-1">
                      Due to {unsuccessful} unsuccessful trade
                    </p>
                  ) : (
                    <p className="text-[11px] text-text-tertiary mt-1">{b.sub}</p>
                  )}
                </div>
              );
            })}
          </motion.div>

          {/* Unlock Higher Limits */}
          <motion.div {...fade(0.05)}>
            <UnlockHigherLimits
              variant={variant}
              data={data}
              xVerif={xVerif}
              surfaces={surfaces}
              onRefetch={fetchLimits}
              onOpenStake={() => setShowStake(true)}
              onOpenX={() => setShowX(true)}
            />
          </motion.div>

          {/* Your Current Limits (Active) */}
          <motion.div
            {...fade(0.1)}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-text-primary">
                Your Current Limits
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-text-primary text-surface-base">
                Active
              </span>
            </div>

            <div className="space-y-5">
              <UsageBar
                Icon={Calendar}
                label="Daily Limit"
                used={dailyUsed}
                cap={dailyCap}
                pct={dailyPct}
                leftLabel={`${Math.round(dailyPct)}% used`}
                rightLabel={`${formatFiat(dailyRemaining, "USD")} left`}
                surfaces={surfaces}
              />
              <UsageBar
                Icon={CreditCard}
                label="Per Transaction (24h)"
                used={largestTrade}
                cap={perTradeCap}
                pct={perTradePct}
                leftLabel={`${Math.round(perTradePct)}% of cap`}
                rightLabel={`${formatFiat(Math.max(perTradeCap - largestTrade, 0), "USD")} headroom`}
                surfaces={surfaces}
              />

              {/* Merchant-only per-side caps */}
              {sideCaps.map((s) => {
                const pct = s.cap > 0 ? Math.min(100, (s.used / s.cap) * 100) : 0;
                return (
                  <UsageBar
                    key={s.key}
                    Icon={s.Icon}
                    label={s.label}
                    used={s.used}
                    cap={s.cap}
                    pct={pct}
                    leftLabel={`${Math.round(pct)}% used`}
                    rightLabel={`${formatFiat(Math.max(s.cap - s.used, 0), "USD")} remaining`}
                    surfaces={surfaces}
                  />
                );
              })}
            </div>
          </motion.div>

          {/* Need a higher limit? */}
          <motion.div
            {...fade(0.15)}
            className={`rounded-[20px] p-5 flex flex-col sm:flex-row sm:items-center gap-4 border border-border-subtle ${surfaces.card}`}
          >
            <div
              className={`w-12 h-12 rounded-full border border-border-subtle flex items-center justify-center shrink-0 ${surfaces.chip}`}
            >
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
              className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-text-primary text-surface-base text-[13px] font-bold hover:opacity-90 transition-opacity"
            >
              Request Increase
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </motion.div>

          {/* Recent Limit Requests — only shown when requests exist */}
          {requests.length > 0 && (
          <motion.div
            {...fade(0.2)}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[15px] font-bold text-text-primary">
                Recent Limit Requests
              </h3>
              {requests.length > 3 && (
                <button
                  onClick={() => setViewAll((v) => !v)}
                  className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {viewAll ? "Show less" : "View All"}
                </button>
              )}
            </div>

            <div className="divide-y divide-border-subtle">
                {visibleRequests.map((r) => {
                  const kindLabel =
                    r.kind === "daily"
                      ? "Daily Limit Increase"
                      : "Per Transaction Limit Increase";
                  const created = new Date(r.created_at);
                  const statusStyle =
                    r.status === "approved"
                      ? "bg-text-primary text-surface-base border-text-primary"
                      : r.status === "rejected"
                        ? "bg-red-500/10 text-red-400 border-red-500/20"
                        : "bg-border-subtle text-text-secondary border-border-subtle";
                  const RowIcon = r.kind === "daily" ? Calendar : CreditCard;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelected(r)}
                      aria-label={`View ${kindLabel} request details`}
                      className={`w-full flex items-center gap-3 py-3.5 text-left -mx-1 px-1 rounded-lg ${surfaces.hover} transition-colors`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg border border-border-subtle flex items-center justify-center shrink-0 ${surfaces.chip}`}
                      >
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
                        {r.status === "pending" ? "In Review" : r.status}
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
          </motion.div>
          )}

          {/* Need Help? */}
          <motion.button
            {...fade(0.25)}
            whileTap={{ scale: 0.99 }}
            onClick={() => onNavigate?.("help")}
            className={`w-full rounded-[20px] p-5 flex items-center gap-3.5 text-left border border-border-subtle ${surfaces.card} ${surfaces.hover} transition-colors`}
          >
            <div
              className={`w-10 h-10 rounded-full border border-border-subtle flex items-center justify-center shrink-0 ${surfaces.chip}`}
            >
              <HelpCircle className="w-5 h-5 text-text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-text-primary">
                Need Help?
              </p>
              <p className="text-[12px] text-text-tertiary">
                Learn more about trading limits and increase requirements.
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" />
          </motion.button>

          <p className="text-[11px] text-text-tertiary text-center pt-1 pb-4">
            We typically respond to limit requests within 24–48 hours.
          </p>
        </>
      ) : null}

      {/* Daily-limit decrease popup — opened by tapping the Daily Limit card. */}
      <AnimatePresence>
        {showDecreaseInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDecreaseInfo(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-sm rounded-2xl p-6 border border-border-subtle ${surfaces.card}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">
                  <ArrowDown className="w-5 h-5" />
                </div>
                <button
                  onClick={() => setShowDecreaseInfo(false)}
                  aria-label="Close"
                  className={`p-1.5 rounded-lg text-text-tertiary hover:text-text-primary ${surfaces.hover} transition-colors`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[15px] font-bold text-text-primary mb-1.5">
                Trade now and get back your full trade limit.
              </p>
              <p className="text-[13px] text-text-tertiary leading-relaxed">
                Maintain a good reputation score and complete successful trades to
                automatically restore reduced limits.
              </p>
              <button
                onClick={() => setShowDecreaseInfo(false)}
                className="mt-5 w-full px-4 py-3 rounded-xl bg-accent text-accent-text text-[13px] font-bold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <RequestIncreaseModal
        open={showRequest}
        onClose={() => setShowRequest(false)}
        surfaces={surfaces}
        dailyCap={dailyCap}
        perTradeCap={perTradeCap}
        defaultKind={reqKind}
        onSubmitted={fetchRequests}
      />
      <RequestDetailModal
        request={selected}
        onClose={() => setSelected(null)}
        surfaces={surfaces}
      />
      {/* Stake USDT — full-screen overlay (works identically in the user app,
          merchant desktop, and merchant mobile; no host-routing changes). */}
      {showStake && (
        <div
          className={`fixed inset-0 z-[120] overflow-y-auto scrollbar-hide ${surfaces.screen} ${variant === "merchant" ? "text-white" : ""}`}
        >
          <StakeUSDTView
            surfaces={surfaces}
            onBack={() => setShowStake(false)}
            onStaked={fetchLimits}
            onHelp={() => onNavigate?.("help")}
          />
        </div>
      )}
      {variant === "merchant" ? (
        <MerchantXVerificationModal
          isOpen={showX}
          onClose={() => setShowX(false)}
          currentHandle={xVerif?.x_username}
          onVerified={() => {
            fetchX();
            fetchLimits();
          }}
        />
      ) : (
        <UserXVerificationModal
          isOpen={showX}
          onClose={() => setShowX(false)}
          currentHandle={xVerif?.x_username}
          onVerified={() => {
            fetchX();
            fetchLimits();
          }}
        />
      )}
    </div>
  );
}

function UsageBar({
  Icon,
  label,
  used,
  cap,
  pct,
  leftLabel,
  rightLabel,
  surfaces,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  cap: number;
  pct: number;
  leftLabel: string;
  rightLabel: string;
  surfaces: { chip: string };
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-9 h-9 rounded-full border border-border-subtle flex items-center justify-center shrink-0 ${surfaces.chip}`}
        >
          <Icon className="w-4 h-4 text-text-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-text-tertiary">{label}</p>
          <p className="text-[15px] font-bold text-text-primary leading-tight">
            {formatFiat(used, "USD")}{" "}
            <span className="text-text-tertiary font-medium text-[13px]">
              / {formatFiat(cap, "USD")}
            </span>
          </p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
        <div
          className="h-full rounded-full bg-text-tertiary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-[12px]">
        <span className="text-text-tertiary">{leftLabel}</span>
        <span className="text-text-tertiary">{rightLabel}</span>
      </div>
    </div>
  );
}
