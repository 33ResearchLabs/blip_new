"use client";

// Full-screen "Stake USDT" experience reached from the Trading Limits page.
// Shared by the user app, merchant desktop, and merchant mobile — themed via
// SURFACES[variant] + semantic tokens (same contract as the other shared limits
// components, so it reads correctly in both `.user-scope` and merchant scope).
//
// Staking moves real USDT (users/merchants.balance) into a position that accrues
// rewards at an APY and raises the trading-limit floor. Backed by /api/staking/*.

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Loader2,
  Gift,
  TrendingUp,
  Percent,
  ShieldCheck,
  Lock,
  ArrowRight,
  Clock,
  History,
  Info,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatCrypto, formatFiat, formatPercentage, formatCount } from "@/lib/format";
import type { SurfaceTokens } from "./types";

interface Props {
  surfaces: SurfaceTokens;
  onBack: () => void;
  /** Called after a successful stake/unstake/claim so the parent can refetch limits. */
  onStaked: () => void;
}

interface Snapshot {
  principal: number;
  pendingRewards: number;
  lifetimeRewards: number;
  apyBps: number;
  availableBalance: number;
  totalValue: number;
  estDaily: number;
  estMonthly: number;
  lastAccruedAt: string | null;
  stakedUsers: number;
}

interface EventRow {
  id: string;
  event_type: "STAKE" | "UNSTAKE" | "CLAIM";
  amount: string;
  principal_after: string | null;
  rewards_after: string | null;
  created_at: string;
}

type Mode = "stake" | "unstake";

const PERCENTS = [25, 50, 75, 100] as const;

export function StakeUSDTView({ surfaces, onBack, onStaked }: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("stake");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<EventRow[] | null>(null);

  const fetchSnap = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/staking/me");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setSnap(json.data as Snapshot);
    } catch (err) {
      console.error("Failed to load staking snapshot:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/staking/history");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && Array.isArray(json.data)) setHistory(json.data);
    } catch (err) {
      console.error("Failed to load staking history:", err);
    }
  }, []);

  useEffect(() => {
    fetchSnap();
  }, [fetchSnap]);

  const apyPct = snap ? snap.apyBps / 100 : 8;
  const available = mode === "stake" ? snap?.availableBalance ?? 0 : snap?.principal ?? 0;
  const amountNum = Number(amount) || 0;

  // Live earnings estimate from the typed amount (falls back to current principal).
  const previewPrincipal = amountNum > 0 ? amountNum : snap?.principal ?? 0;
  const dailyRate = (apyPct / 100) / 365;
  const estDaily = previewPrincipal * dailyRate;
  const estMonthly = estDaily * 30;

  const setPct = (pct: number) => {
    const v = (available * pct) / 100;
    setAmount(v > 0 ? String(Math.floor(v * 1e8) / 1e8) : "");
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (amountNum <= 0) {
      setError("Enter an amount.");
      return;
    }
    if (amountNum > available) {
      setError(mode === "stake" ? "Amount exceeds your available USDT." : "Amount exceeds your staked balance.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/staking/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountNum }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setAmount("");
        setNotice(mode === "stake" ? "USDT staked." : "USDT unstaked.");
        await fetchSnap();
        if (showHistory) await fetchHistory();
        onStaked();
        return;
      }
      setError(json?.error || `Couldn't ${mode}.`);
    } catch (err) {
      console.error(`Failed to ${mode}:`, err);
      setError(`Couldn't ${mode}.`);
    } finally {
      setSubmitting(false);
    }
  };

  const claimRewards = async () => {
    setError(null);
    setNotice(null);
    setClaiming(true);
    try {
      const res = await fetchWithAuth("/api/staking/claim", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setNotice(`Claimed ${formatCrypto(json.data?.claimed)} USDT.`);
        await fetchSnap();
        if (showHistory) await fetchHistory();
        onStaked();
        return;
      }
      setError(json?.error || "Couldn't claim rewards.");
    } catch (err) {
      console.error("Failed to claim rewards:", err);
      setError("Couldn't claim rewards.");
    } finally {
      setClaiming(false);
    }
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history == null) fetchHistory();
  };

  const fade = (delay = 0) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const, delay },
  });

  return (
    <div className="w-full max-w-2xl mx-auto px-5 pt-4 pb-12 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-1">
        <div className="flex items-start gap-3 min-w-0">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onBack}
            aria-label="Back"
            className={`w-9 h-9 rounded-[14px] flex items-center justify-center shrink-0 border border-border-subtle ${surfaces.card}`}
          >
            <ChevronLeft className="w-5 h-5 text-text-secondary" />
          </motion.button>
          <div className="min-w-0">
            <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
              Stake USDT
            </h1>
            <p className="text-[13px] text-text-tertiary leading-snug mt-1.5 max-w-[44ch]">
              Stake USDT and earn rewards while supporting higher trading limits.
            </p>
          </div>
        </div>
        <div
          className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-border-subtle ${surfaces.card}`}
        >
          <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <div className="leading-tight">
            <p className="text-[10px] text-text-tertiary">Staked users</p>
            <p className="text-[13px] font-bold text-text-primary">
              {snap ? `${formatCount(snap.stakedUsers)}+` : "—"}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={`rounded-[20px] p-12 text-center border border-border-subtle ${surfaces.card}`}>
          <Loader2 className="w-5 h-5 text-text-tertiary mx-auto animate-spin" />
          <p className="text-xs text-text-tertiary mt-3">Loading…</p>
        </div>
      ) : (
        <>
          {/* Balance / value / rewards */}
          <motion.div
            {...fade()}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[12px] text-text-tertiary">Your Staked Balance</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                    <span className="text-[13px] font-extrabold">$</span>
                  </div>
                  <p className="text-[22px] font-extrabold text-text-primary leading-none tracking-[-0.02em]">
                    {formatCrypto(snap?.principal)}{" "}
                    <span className="text-[12px] text-text-tertiary font-semibold">USDT</span>
                  </p>
                </div>
                <p className="text-[11px] text-text-tertiary mt-1">
                  ≈ {formatFiat(snap?.principal, "USD")}
                </p>
              </div>
              <div>
                <p className="text-[12px] text-text-tertiary">Total Value</p>
                <p className="text-[22px] font-extrabold text-text-primary leading-none tracking-[-0.02em] mt-1.5">
                  {formatFiat(snap?.totalValue, "USD")}
                </p>
                <p className="text-[11px] text-emerald-500 font-semibold mt-1">
                  {formatPercentage(apyPct)} APY
                </p>
              </div>
            </div>

            <div className="h-px bg-border-subtle my-4" />

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-text-tertiary inline-flex items-center gap-1.5">
                  Pending Rewards <Info className="w-3 h-3" />
                </p>
                <p className="text-[15px] font-bold text-text-primary mt-0.5">
                  {formatCrypto(snap?.pendingRewards)}{" "}
                  <span className="text-[11px] text-text-tertiary font-semibold">USDT</span>
                </p>
                <p className="text-[11px] text-text-tertiary">
                  ≈ {formatFiat(snap?.pendingRewards, "USD")}
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={claimRewards}
                disabled={claiming || !snap || snap.pendingRewards <= 0}
                className="shrink-0 inline-flex items-center justify-center gap-2 px-4 h-11 rounded-xl text-[13px] font-bold border border-emerald-500/30 text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors disabled:opacity-50"
              >
                {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                Claim Rewards
              </motion.button>
            </div>
          </motion.div>

          {/* Estimated Benefits */}
          <motion.div
            {...fade(0.05)}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <h3 className="text-[14px] font-bold text-text-primary mb-4">Estimated Benefits</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Benefit
                icon={<TrendingUp className="w-4 h-4" />}
                tone="emerald"
                title="Higher Limits"
                desc="Increase your trading limits up to 10x"
              />
              <Benefit
                icon={<Percent className="w-4 h-4" />}
                tone="blue"
                title="Earn Rewards"
                desc="Earn daily rewards on your staked USDT"
              />
              <Benefit
                icon={<ShieldCheck className="w-4 h-4" />}
                tone="violet"
                title="Secure & Transparent"
                desc="Your funds are safe and fully backed"
              />
            </div>
          </motion.div>

          {/* Stake / Unstake form */}
          <motion.div
            {...fade(0.1)}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-text-primary">
                {mode === "stake" ? "Stake USDT" : "Unstake USDT"}
              </h3>
              <div className={`inline-flex rounded-xl p-0.5 border border-border-subtle ${surfaces.inset}`}>
                {(["stake", "unstake"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setAmount("");
                      setError(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold capitalize transition-colors ${
                      mode === m ? "bg-accent text-accent-text" : "text-text-tertiary"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className={`rounded-2xl p-4 border border-border-subtle ${surfaces.inset}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-text-tertiary inline-flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-500 inline-flex items-center justify-center text-[10px] font-extrabold">
                    $
                  </span>
                  Amount
                </span>
                <span className="text-[11px] text-text-tertiary">
                  Available: {formatCrypto(available)} USDT
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  max={available}
                  maxLength={14}
                  className="flex-1 min-w-0 bg-transparent text-[24px] font-extrabold text-text-primary outline-none placeholder:text-text-quaternary"
                />
                <span className="text-[13px] font-bold text-text-tertiary">USDT</span>
                <button
                  onClick={() => setPct(100)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold text-text-secondary border border-border-subtle ${surfaces.chip} ${surfaces.hover} transition-colors`}
                >
                  Max
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-3">
              {PERCENTS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPct(p)}
                  className={`py-2 rounded-xl text-[12px] font-semibold text-text-secondary border border-border-subtle ${surfaces.inset} ${surfaces.hover} transition-colors`}
                >
                  {p}%
                </button>
              ))}
            </div>

            {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}
            {notice && <p className="text-[12px] text-emerald-600 mt-3">{notice}</p>}

            <motion.button
              whileTap={{ scale: 0.99 }}
              onClick={submit}
              disabled={submitting}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-accent text-accent-text text-[14px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === "stake" ? "Stake USDT" : "Unstake USDT"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>

            <div className="flex items-center gap-2 mt-3 px-3.5 py-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07]">
              <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <p className="text-[12px] text-text-tertiary">
                Your USDT will be locked securely and you can unstake anytime.
              </p>
            </div>
          </motion.div>

          {/* Est. Earnings */}
          <motion.div
            {...fade(0.15)}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <h3 className="text-[14px] font-bold text-text-primary mb-4">Est. Earnings</h3>
            <div className="grid grid-cols-3 gap-3">
              <EarnStat label="Est. APY" value={formatPercentage(apyPct)} sub="Annual" />
              <EarnStat
                label="Est. Daily Reward"
                value={`${formatCrypto(estDaily)} USDT`}
                sub={`≈ ${formatFiat(estDaily, "USD")}`}
              />
              <EarnStat
                label="Est. Monthly Reward"
                value={`${formatCrypto(estMonthly)} USDT`}
                sub={`≈ ${formatFiat(estMonthly, "USD")}`}
              />
            </div>
          </motion.div>

          {/* Staking Overview */}
          <motion.div
            {...fade(0.2)}
            className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-text-primary">Your Staking Overview</h3>
              <button
                onClick={toggleHistory}
                className="text-[12px] text-emerald-600 font-semibold inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
              >
                <History className="w-3.5 h-3.5" />
                {showHistory ? "Hide History" : "View History"}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <OverviewStat
                icon={<span className="text-[12px] font-extrabold">$</span>}
                tone="emerald"
                label="Total Staked"
                value={`${formatCrypto(snap?.principal)} USDT`}
                sub={`≈ ${formatFiat(snap?.principal, "USD")}`}
              />
              <OverviewStat
                icon={<Lock className="w-3.5 h-3.5" />}
                tone="blue"
                label="Lock Period"
                value="Flexible"
                sub="No lock-in"
              />
              <OverviewStat
                icon={<Gift className="w-3.5 h-3.5" />}
                tone="violet"
                label="Total Rewards"
                value={`${formatCrypto(snap?.lifetimeRewards)} USDT`}
                sub={`≈ ${formatFiat(snap?.lifetimeRewards, "USD")}`}
              />
              <OverviewStat
                icon={<Clock className="w-3.5 h-3.5" />}
                tone="amber"
                label="Next Reward"
                value={snap && snap.principal > 0 ? "Daily" : "—"}
                sub={snap && snap.principal > 0 ? "Accruing" : "Not available"}
              />
            </div>

            {showHistory && (
              <div className="mt-4 border-t border-border-subtle pt-3">
                {history == null ? (
                  <div className="py-6 text-center">
                    <Loader2 className="w-4 h-4 text-text-tertiary mx-auto animate-spin" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-text-tertiary">
                    No staking activity yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {history.map((e) => {
                      const isOut = e.event_type === "STAKE";
                      const label =
                        e.event_type === "STAKE"
                          ? "Staked"
                          : e.event_type === "UNSTAKE"
                            ? "Unstaked"
                            : "Reward Claimed";
                      const d = new Date(e.created_at);
                      return (
                        <div key={e.id} className="flex items-center gap-3 py-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              isOut ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
                            }`}
                          >
                            {isOut ? (
                              <ArrowUpRight className="w-4 h-4" />
                            ) : (
                              <ArrowDownLeft className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-text-primary">{label}</p>
                            <p className="text-[11px] text-text-tertiary">
                              {d.toLocaleDateString("en-US", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                              ,{" "}
                              {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            </p>
                          </div>
                          <span className="text-[13px] font-bold text-text-primary shrink-0">
                            {isOut ? "−" : "+"}
                            {formatCrypto(e.amount)} USDT
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </motion.div>

          <div className="flex items-start gap-3 p-4 rounded-[20px] border border-blue-500/20 bg-blue-500/[0.07]">
            <div className="w-8 h-8 rounded-full bg-blue-500/15 text-blue-500 flex items-center justify-center shrink-0">
              <Info className="w-4 h-4" />
            </div>
            <p className="text-[12px] text-text-tertiary leading-snug">
              You can unstake anytime. Rewards are calculated daily and credited to your
              balance when you claim.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const TONE: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-500",
  blue: "bg-blue-500/10 text-blue-500",
  violet: "bg-violet-500/10 text-violet-500",
  amber: "bg-amber-500/10 text-amber-500",
};

function Benefit({
  icon,
  tone,
  title,
  desc,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE | string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${TONE[tone]}`}>
        {icon}
      </div>
      <p className="text-[12px] font-bold text-text-primary">{title}</p>
      <p className="text-[10px] text-text-tertiary leading-snug mt-0.5">{desc}</p>
    </div>
  );
}

function EarnStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-[11px] text-text-tertiary inline-flex items-center gap-1">
        {label} <Info className="w-2.5 h-2.5" />
      </p>
      <p className="text-[15px] font-extrabold text-text-primary leading-tight mt-1">{value}</p>
      <p className="text-[10px] text-text-tertiary mt-0.5">{sub}</p>
    </div>
  );
}

function OverviewStat({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE | string;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${TONE[tone]}`}>
          {icon}
        </div>
        <p className="text-[11px] text-text-tertiary truncate">{label}</p>
      </div>
      <p className="text-[14px] font-bold text-text-primary leading-tight">{value}</p>
      <p className="text-[10px] text-text-tertiary mt-0.5">{sub}</p>
    </div>
  );
}
