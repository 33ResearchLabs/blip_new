"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  Crown,
  DollarSign,
  Lock,
  Percent,
  Radio,
  RefreshCw,
  Search,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { usePusher } from "@/context/PusherContext";
import {
  formatCount,
  formatCrypto,
  formatFiat,
  formatPercentage,
} from "@/lib/format";

// ─── Types (mirror /api/admin/analytics response) ──────────────────────────

interface AnalyticsResponse {
  timeframe: string;
  volume: {
    total: number;
    totalFiat: number;
    orderCount: number;
    trend: { time: string; volume: number; count: number }[];
  };
  buySell: { type: string; count: number; volume: number }[];
  revenue: { total: number; fees: number; avgFee: number };
  orders: {
    total: number;
    completed: number;
    cancelled: number;
    disputed: number;
    pending: number;
    active: number;
    successRate: number;
    avgSize: number;
    avgCompletionSeconds: number;
  };
  users: {
    newUsers: number;
    activeMerchants: number;
    topTraders: {
      name: string;
      emoji: string;
      volume: number;
      trades: number;
    }[];
  };
  risk: { disputeRate: number; failedCount: number; escrowLocked: number };
  liveFeed: {
    id: string;
    orderNumber: string;
    type: string;
    amount: number;
    fiatAmount: number;
    status: string;
    createdAt: string;
    merchant: string;
  }[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const TIMEFRAMES: { key: string; label: string }[] = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "1month", label: "30d" },
  { key: "all", label: "All" },
];

const STATUS_COLORS = {
  Completed: "#10b981",
  "In Progress": "#329dff",
  Cancelled: "#94a3b8",
  Disputed: "#ef4444",
} as const;

const TYPE_COLORS = {
  buy: "#329dff",
  sell: "#f59e0b",
} as const;

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "rgb(15 23 42 / 0.95)",
  border: "1px solid rgb(51 65 85)",
  borderRadius: 8,
  fontSize: 11,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatBucket(iso: string, timeframe: string): string {
  const d = new Date(iso);
  if (timeframe === "24h" || timeframe === "1h") {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function compactCrypto(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  return formatCrypto(v);
}

// ─── KPI card ──────────────────────────────────────────────────────────────
//
// Matches the admin-console-mockup KPI strip: small colored icon badge in the
// top-left, label upper-right, big bold value, currency suffix on the right,
// and a delta-vs-yesterday line at the bottom (▲ +12.5% vs yesterday).
//
// `delta` is the percentage change vs the comparison window (positive = up).
// Pass `null` to render an em-dash placeholder (when the backend hasn't
// supplied a previous-period total yet — graceful fallback, not an error).

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "primary" | "success" | "error" | "muted" | "warning";
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
}

function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  accent = "muted",
  hint,
  delta,
  deltaLabel = "vs yesterday",
}: KpiCardProps) {
  const accentClass =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
        ? "text-[var(--color-success)]"
        : accent === "error"
          ? "text-[var(--color-error)]"
          : accent === "warning"
            ? "text-amber-400"
            : "text-foreground/70";
  const accentBg =
    accent === "primary"
      ? "bg-primary/10 border-primary/20"
      : accent === "success"
        ? "bg-emerald-500/10 border-emerald-500/20"
        : accent === "error"
          ? "bg-red-500/10 border-red-500/20"
          : accent === "warning"
            ? "bg-amber-500/10 border-amber-500/20"
            : "bg-foreground/5 border-foreground/10";

  // Delta presentation: green up, red down, neutral when 0 / unavailable.
  const hasDelta =
    delta !== null && delta !== undefined && Number.isFinite(delta);
  const deltaUp = hasDelta && (delta as number) > 0;
  const deltaDown = hasDelta && (delta as number) < 0;
  const deltaColor = deltaUp
    ? "text-emerald-400"
    : deltaDown
      ? "text-red-400"
      : "text-foreground/30";
  const DeltaArrow = deltaUp ? ArrowUpRight : deltaDown ? ArrowDownRight : null;
  const deltaText = hasDelta
    ? `${(delta as number) > 0 ? "+" : ""}${(delta as number).toFixed(1)}%`
    : "—";

  return (
    <div className="glass-card border border-border rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div
          className={`w-6 h-6 rounded-md border flex items-center justify-center ${accentBg}`}
        >
          <Icon className={`w-3.5 h-3.5 ${accentClass}`} />
        </div>
        <span className="text-[9px] font-mono text-foreground/40 uppercase tracking-wider truncate">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5 leading-none">
        <span
          className={`text-2xl font-black font-mono tabular-nums ${accentClass}`}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[10px] font-mono text-foreground/30 uppercase tracking-wider">
            {unit}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1 mt-auto">
        {hint ? (
          <span className="text-[9px] font-mono text-foreground/30 truncate">
            {hint}
          </span>
        ) : (
          <span />
        )}
        <div
          className={`flex items-center gap-0.5 text-[10px] font-mono tabular-nums ${deltaColor}`}
        >
          {DeltaArrow ? <DeltaArrow className="w-3 h-3" /> : null}
          <span className="font-bold">{deltaText}</span>
          <span className="text-foreground/30 ml-1">{deltaLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Chart card wrapper ────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  action,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // overflow-hidden on the card itself so inner content never paints
    // outside the card's allocated slot. Without this, a tall component on a
    // short viewport will overlap the next sibling card (e.g. Order Breakdown
    // bleeding into the 24H Activity chart).
    <div
      className={`glass-card border border-border rounded-xl p-3 flex flex-col overflow-hidden ${className}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div className="min-w-0">
          <div className="text-[10px] font-bold font-mono text-foreground/60 uppercase tracking-wider">
            {title}
          </div>
          {subtitle ? (
            <div className="text-[9px] font-mono text-foreground/25 mt-0.5">
              {subtitle}
            </div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

// ─── Charts ────────────────────────────────────────────────────────────────

function VolumeTrendChart({
  trend,
  timeframe,
}: {
  trend: AnalyticsResponse["volume"]["trend"];
  timeframe: string;
}) {
  const data = useMemo(
    () =>
      trend.map((p) => ({
        t: formatBucket(p.time, timeframe),
        volume: p.volume,
        count: p.count,
      })),
    [trend, timeframe],
  );

  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/20">
        No volume data in this window
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
      >
        <defs>
          <linearGradient id="vt-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#329dff" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#329dff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="#1f2937"
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="t"
          stroke="#64748b"
          fontSize={10}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="left"
          stroke="#64748b"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v) => compactCrypto(v as number)}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke="#64748b"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#cbd5e1" }}
          formatter={(value: number, name: string) =>
            name === "Volume" ? compactCrypto(value) : formatCount(value)
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
          iconType="circle"
          iconSize={7}
        />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="volume"
          stroke="#329dff"
          strokeWidth={2}
          fill="url(#vt-fill)"
          name="Volume"
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="count"
          stroke="#10b981"
          strokeWidth={1.6}
          dot={false}
          name="Orders"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── System Health ring (admin-console mockup) ────────────────────────────
//
// Single-metric ring: success rate as %healthy, with avg fill time underneath.
// Uses the same RECharts PieChart primitive as StatusDonut for visual
// consistency, just rendered as a 2-segment donut (healthy + degraded slice).

function SystemHealthRing({
  successRate,
  avgCompletionSeconds,
}: {
  successRate: number;
  avgCompletionSeconds: number;
}) {
  const pct = Math.max(
    0,
    Math.min(100, Number.isFinite(successRate) ? successRate : 0),
  );
  const data = [
    { name: "Healthy", value: pct, color: "#10b981" },
    { name: "Degraded", value: 100 - pct, color: "rgb(255 255 255 / 0.06)" },
  ];
  const fill =
    avgCompletionSeconds < 60
      ? `~${avgCompletionSeconds.toFixed(0)}s`
      : `~${(avgCompletionSeconds / 60).toFixed(1)}m`;
  const ringColor = pct >= 95 ? "#10b981" : pct >= 80 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 min-h-0">
      <div className="grid place-items-center w-full flex-1 min-h-0">
        <div className="relative aspect-square h-full max-h-[230px] max-w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="74%"
                outerRadius="100%"
                startAngle={100}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              >
                <Cell fill={ringColor} />
                <Cell fill="rgb(255 255 255 / 0.06)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-black font-mono tabular-nums leading-none"
            style={{ color: ringColor }}
          >
            {pct.toFixed(0)}%
          </div>
        </div>
      </div>
      <span className="text-[10px] font-mono text-foreground/40 shrink-0">
        {fill} avg fill time
      </span>
    </div>
  );
}

// ─── Order Breakdown stack (admin-console mockup) ─────────────────────────
//
// Vertical list of status counts with inline bar showing share-of-total.
// Active = total - completed - cancelled - disputed (in-progress orders).

function OrderBreakdown({ orders }: { orders: AnalyticsResponse["orders"] }) {
  const total = Math.max(1, orders.total);
  // Pending and Active come from the analytics endpoint directly. Falls back
  // to a single "active" derived bucket when the API hasn't been redeployed.
  const pending =
    orders.pending ??
    Math.max(
      0,
      orders.total - orders.completed - orders.cancelled - orders.disputed,
    );
  const active = orders.active ?? 0;
  const rows: { label: string; value: number; color: string }[] = [
    { label: "Pending", value: pending, color: "#f59e0b" },
    { label: "Active", value: active, color: "#329dff" },
    { label: "Completed", value: orders.completed, color: "#10b981" },
    { label: "Cancelled", value: orders.cancelled, color: "#ef4444" },
    { label: "Disputed", value: orders.disputed, color: "#fb7185" },
  ];

  return (
    // Status rows scroll internally if the rail gets too short; Total Orders
    // stays pinned to the bottom via shrink-0 so it's always visible.
    <div className="flex h-full flex-col min-h-0">
      <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto scrollbar-hide pr-1">
        {rows.map((r) => {
          const pct = (r.value / total) * 100;
          return (
            <div key={r.label} className="flex flex-col gap-0.5 shrink-0">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="flex items-center gap-1.5 text-foreground/60">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: r.color }}
                  />
                  {r.label}
                </span>
                <span className="tabular-nums font-bold text-foreground/80">
                  {formatCount(r.value)}
                </span>
              </div>
              <div className="h-1 rounded-full bg-foreground/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: r.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="shrink-0 mt-2 pt-2 border-t border-section-divider flex items-center justify-between text-[10px] font-mono">
        <span className="text-foreground/40 uppercase tracking-wider">
          Total Orders
        </span>
        <span className="tabular-nums font-black text-foreground/90">
          {formatCount(orders.total)}
        </span>
      </div>
    </div>
  );
}

function StatusDonut({ orders }: { orders: AnalyticsResponse["orders"] }) {
  const inProgress = Math.max(
    0,
    orders.total - orders.completed - orders.cancelled - orders.disputed,
  );
  const data = [
    {
      name: "Completed",
      value: orders.completed,
      color: STATUS_COLORS.Completed,
    },
    {
      name: "In Progress",
      value: inProgress,
      color: STATUS_COLORS["In Progress"],
    },
    {
      name: "Cancelled",
      value: orders.cancelled,
      color: STATUS_COLORS.Cancelled,
    },
    { name: "Disputed", value: orders.disputed, color: STATUS_COLORS.Disputed },
  ].filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/20">
        No orders in this window
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3">
      <div className="relative h-full min-h-[140px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, n) => [formatCount(v), n]}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              stroke="none"
              paddingAngle={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[9px] font-mono text-foreground/30 uppercase tracking-wider">
            Total
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-foreground/80">
            {formatCount(total)}
          </div>
        </div>
      </div>
      <ul className="flex w-28 flex-col gap-1 text-[10px] font-mono">
        {data.map((d) => (
          <li
            key={d.name}
            className="flex items-center justify-between gap-1.5"
          >
            <span className="flex items-center gap-1.5 text-foreground/60">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: d.color }}
              />
              {d.name}
            </span>
            <span className="tabular-nums text-foreground/40">
              {formatPercentage((d.value / total) * 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunnelView({ orders }: { orders: AnalyticsResponse["orders"] }) {
  // Derived from available data: Created → Settled (paid+completed+disputed) → Completed
  const created = orders.total;
  const settled = orders.completed + orders.disputed; // reached at-least-payment-sent
  const completed = orders.completed;
  const stages = [
    { name: "Order Created", value: created, color: "#329dff" },
    { name: "Settled", value: settled, color: "#7c3aed" },
    { name: "Completed", value: completed, color: "#10b981" },
  ];
  const max = Math.max(stages[0].value, 1);

  if (created === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/20">
        No orders in this window
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-around gap-2">
      {stages.map((s, i) => {
        const width = Math.max(8, (s.value / max) * 100);
        const pct = (s.value / max) * 100;
        const dropPct =
          i > 0
            ? ((stages[i - 1].value - s.value) /
                Math.max(stages[i - 1].value, 1)) *
              100
            : 0;
        return (
          <div key={s.name} className="space-y-1">
            <div className="flex items-baseline justify-between text-[10px] font-mono">
              <span className="text-foreground/60">{s.name}</span>
              <span className="tabular-nums text-foreground/40">
                {formatCount(s.value)}{" "}
                <span className="text-foreground/25">
                  ({formatPercentage(pct)})
                </span>
              </span>
            </div>
            <div className="relative h-6 overflow-hidden rounded-md bg-card">
              <div
                className="h-full rounded-md transition-all"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, ${s.color}, ${s.color}AA)`,
                }}
              />
              {i > 0 && dropPct > 0.5 ? (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-[var(--color-error)]/70">
                  −{dropPct.toFixed(0)}%
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BuySellChart({ data }: { data: AnalyticsResponse["buySell"] }) {
  const slices = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: d.type === "buy" ? "Buy" : "Sell",
      value: d.count,
      volume: d.volume,
      color: TYPE_COLORS[d.type as keyof typeof TYPE_COLORS] ?? "#94a3b8",
    }));
  const totalCount = slices.reduce((s, d) => s + d.value, 0);
  const totalVolume = slices.reduce((s, d) => s + d.volume, 0);

  if (totalCount === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/20">
        No completed trades in this window
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3">
      <div className="relative h-full min-h-[140px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, n) => [formatCount(v), n]}
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              stroke="none"
              paddingAngle={2}
              isAnimationActive={false}
            >
              {slices.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[9px] font-mono text-foreground/30 uppercase tracking-wider">
            Volume
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-foreground/80">
            {compactCrypto(totalVolume)}
          </div>
        </div>
      </div>
      <ul className="flex w-28 flex-col gap-1 text-[10px] font-mono">
        {slices.map((d) => (
          <li
            key={d.name}
            className="flex flex-col gap-0.5 rounded-md bg-card px-2 py-1"
          >
            <span className="flex items-center gap-1.5 text-foreground/60">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: d.color }}
              />
              {d.name}
            </span>
            <span className="tabular-nums text-foreground/40">
              {formatCount(d.value)} · {compactCrypto(d.volume)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopMerchantsChart({
  traders,
}: {
  traders: AnalyticsResponse["users"]["topTraders"];
}) {
  if (!traders.length) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/20">
        No merchant activity in this window
      </div>
    );
  }
  const data = traders.slice(0, 5).map((t) => ({
    name: t.name,
    volume: t.volume,
    trades: t.trades,
    emoji: t.emoji,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
      >
        <CartesianGrid
          stroke="#1f2937"
          strokeDasharray="3 3"
          horizontal={false}
        />
        <XAxis
          type="number"
          stroke="#64748b"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => compactCrypto(v as number)}
        />
        <YAxis
          type="category"
          dataKey="name"
          stroke="#64748b"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={70}
          tickFormatter={(v) =>
            typeof v === "string" && v.length > 10 ? `${v.slice(0, 10)}…` : v
          }
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#cbd5e1" }}
          formatter={(v: number, n: string) =>
            n === "volume" ? compactCrypto(v) : formatCount(v)
          }
        />
        <Bar
          dataKey="volume"
          name="Volume"
          fill="#329dff"
          radius={[0, 3, 3, 0]}
          barSize={14}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Live feed ─────────────────────────────────────────────────────────────

function LiveFeed({ feed }: { feed: AnalyticsResponse["liveFeed"] }) {
  if (!feed.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-foreground/20">
        <Radio className="w-5 h-5 mb-1.5 opacity-30" />
        <p className="text-[10px] font-mono">No recent activity</p>
      </div>
    );
  }
  return (
    <ul className="scrollbar-hide flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
      {feed.map((item) => {
        const isCompleted = item.status === "completed";
        const isDisputed = item.status === "disputed";
        const isCancelled =
          item.status === "cancelled" || item.status === "expired";
        const Icon = isCompleted
          ? CheckCircle
          : isDisputed
            ? AlertTriangle
            : isCancelled
              ? XCircle
              : Activity;
        const iconColor = isCompleted
          ? "text-[var(--color-success)]/60"
          : isDisputed
            ? "text-[var(--color-error)]/60"
            : isCancelled
              ? "text-foreground/20"
              : "text-primary/60";
        return (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-md border border-section-divider bg-card/40 px-2 py-1.5"
          >
            <Icon className={`mt-0.5 w-3 h-3 shrink-0 ${iconColor}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-foreground/60 truncate">
                  {item.orderNumber}
                </span>
                <span
                  className={`text-[8px] font-bold font-mono ${
                    item.type === "buy"
                      ? "text-primary/60"
                      : "text-foreground/30"
                  }`}
                >
                  {item.type.toUpperCase()}
                </span>
                <span className="ml-auto text-[8px] font-mono text-foreground/20 shrink-0">
                  {formatTimeAgo(item.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[9px] font-mono text-foreground/35 truncate">
                <span className="truncate">{item.merchant}</span>
                <ArrowRight className="w-2 h-2 text-foreground/15 shrink-0" />
                <span className="tabular-nums text-foreground/55 shrink-0">
                  {compactCrypto(item.amount)}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Top Merchants leaderboard (admin-console mockup) ────────────────────
//
// Replaces the previous horizontal bar chart with a rich row design: rank
// pill, square avatar with emoji, merchant name, rating + trade count line,
// volume amount on the right, and a green online dot. Mirrors the screenshot
// the user provided — the data shape (`AnalyticsResponse['users']['topTraders']`)
// already supplies emoji + volume + trades; rating is derived as 5.0 stub
// until the backend exposes per-merchant rating in this list.

function TopMerchantsLeaderboard({
  traders,
}: {
  traders: AnalyticsResponse["users"]["topTraders"];
}) {
  if (!traders.length) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/25">
        No merchant data
      </div>
    );
  }
  return (
    <ul className="scrollbar-hide flex h-full flex-col gap-1 overflow-y-auto pr-1">
      {traders.slice(0, 8).map((t, i) => (
        <li
          key={t.name}
          className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
        >
          <span className="w-4 text-[10px] font-mono font-bold tabular-nums text-foreground/40 text-center">
            {i + 1}
          </span>
          <div className="relative w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-sm shrink-0">
            <span>{t.emoji}</span>
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-background" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-mono font-bold text-foreground/90 truncate">
              {t.name}
            </div>
            <div className="flex items-center gap-1 text-[9px] font-mono text-foreground/40">
              <Star className="w-2.5 h-2.5 fill-amber-400/80 text-amber-400/80" />
              <span className="tabular-nums">5.0</span>
              <span className="opacity-50">·</span>
              <span className="tabular-nums">{formatCount(t.trades)}T</span>
            </div>
          </div>
          <span className="text-[11px] font-mono font-bold tabular-nums text-foreground/90 shrink-0">
            ${compactCrypto(t.volume)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Activity Feed (admin-console mockup) ──────────────────────────────────
//
// Pulls from /api/admin/activity (existing route — returns `trade`, `escrow`,
// `dispute`, `user`, `merchant` events with relative time). Renders each
// event as a row: status icon (color-coded by event type) on the left, the
// human-readable message in the center, time-ago on the right.

interface ActivityEvent {
  id: string;
  type: "trade" | "escrow" | "dispute" | "user" | "merchant" | string;
  message: string;
  status: "success" | "warning" | "error" | "info" | string;
  time_ago?: string;
  created_at?: string;
}

function ActivityFeed({ adminToken }: { adminToken: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(adminToken);
  tokenRef.current = adminToken;

  useEffect(() => {
    let cancelled = false;
    const fetchFeed = async () => {
      const token = tokenRef.current;
      if (!token) return;
      try {
        const res = await fetchWithAuth("/api/admin/activity?limit=20", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!cancelled && json?.success && Array.isArray(json.data)) {
          setEvents(json.data as ActivityEvent[]);
        }
      } catch {
        /* swallow — non-critical */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchFeed();
    const id = setInterval(fetchFeed, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading && events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/25">
        Loading…
      </div>
    );
  }
  if (!events.length) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] font-mono text-foreground/25">
        No recent activity
      </div>
    );
  }

  return (
    <ul className="scrollbar-hide flex h-full flex-col gap-1 overflow-y-auto pr-1">
      {events.map((e) => {
        const Icon =
          e.type === "trade"
            ? CheckCircle
            : e.type === "dispute"
              ? AlertTriangle
              : e.type === "escrow"
                ? Lock
                : e.type === "user"
                  ? Users
                  : Activity;
        const iconColor =
          e.status === "success"
            ? "text-emerald-400/80"
            : e.status === "warning"
              ? "text-amber-400/80"
              : e.status === "error"
                ? "text-red-400/80"
                : "text-foreground/40";
        return (
          <li
            key={e.id}
            className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
          >
            <Icon className={`w-3 h-3 shrink-0 ${iconColor}`} />
            <span className="flex-1 text-[10px] font-mono text-foreground/70 truncate">
              {e.message}
            </span>
            <span className="text-[9px] font-mono text-foreground/30 shrink-0 tabular-nums">
              {e.time_ago || (e.created_at ? formatTimeAgo(e.created_at) : "")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── 24H Activity bar chart (admin-console mockup) ────────────────────────
//
// Hourly buckets across the visible window with a metric toggle (Orders /
// Volume) and a peak callout. The trend data comes from the same
// `data.volume.trend` array that VolumeTrendChart uses, so no extra fetch.
// Users metric is omitted for now — the analytics endpoint doesn't expose
// hourly active users; can be added later via a new analytics field.

function ActivityBarChart({
  trend,
  timeframe,
}: {
  trend: AnalyticsResponse["volume"]["trend"];
  timeframe: string;
}) {
  const [metric, setMetric] = useState<"orders" | "volume">("orders");

  // Fill the full bucket timeline so the chart always shows a complete grid
  // even when most buckets are empty. The API's GROUP BY only returns rows
  // with data, which leaves Recharts with 2-3 wide bars instead of 24 thin
  // ones. We synthesize the expected buckets for the window and merge in
  // the real counts.
  const data = useMemo(() => {
    const now = new Date();
    let bucketCount = 24;
    let bucketMs = 60 * 60 * 1000; // 1h default
    if (timeframe === "1h") {
      bucketCount = 60;
      bucketMs = 60 * 1000; // 1m
    } else if (timeframe === "24h") {
      bucketCount = 24;
      bucketMs = 60 * 60 * 1000; // 1h
    } else if (timeframe === "7d") {
      bucketCount = 7;
      bucketMs = 24 * 60 * 60 * 1000; // 1d
    } else if (timeframe === "1month" || timeframe === "all") {
      bucketCount = 30;
      bucketMs = 24 * 60 * 60 * 1000; // 1d
    }

    // Round `now` down to the bucket boundary so labels line up cleanly.
    const truncate = (d: Date) => {
      const t = new Date(d);
      if (bucketMs >= 24 * 60 * 60 * 1000) {
        t.setHours(0, 0, 0, 0);
      } else if (bucketMs >= 60 * 60 * 1000) {
        t.setMinutes(0, 0, 0);
      } else {
        t.setSeconds(0, 0);
      }
      return t;
    };
    const end = truncate(now);

    // Index real trend rows by bucket-start ms for O(1) merge.
    const trendByMs = new Map<number, { volume: number; count: number }>();
    for (const row of trend) {
      const ms = truncate(new Date(row.time)).getTime();
      const prev = trendByMs.get(ms) || { volume: 0, count: 0 };
      trendByMs.set(ms, {
        volume: prev.volume + (row.volume || 0),
        count: prev.count + (row.count || 0),
      });
    }

    const out: { bucket: string; value: number }[] = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
      const ts = new Date(end.getTime() - i * bucketMs);
      const real = trendByMs.get(ts.getTime());
      out.push({
        bucket: formatBucket(ts.toISOString(), timeframe),
        value: real ? (metric === "orders" ? real.count : real.volume) : 0,
      });
    }
    return out;
  }, [trend, timeframe, metric]);

  const peak = useMemo(() => {
    let max = 0;
    let bucket = "";
    for (const row of data) {
      if (row.value > max) {
        max = row.value;
        bucket = row.bucket;
      }
    }
    return { value: max, bucket };
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 mb-1.5 shrink-0">
        <div className="flex items-center gap-1">
          {(["orders", "volume"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors capitalize ${
                metric === m
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-foreground/40 hover:text-foreground/70 border border-transparent"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {peak.value > 0 && (
          <span className="text-[10px] font-mono text-foreground/40">
            Peak: <span className="text-primary font-bold">{peak.bucket}</span>{" "}
            <span className="tabular-nums">
              (
              {metric === "orders"
                ? formatCount(peak.value)
                : compactCrypto(peak.value)}
              )
            </span>
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
            barCategoryGap={1}
          >
            <CartesianGrid
              stroke="rgb(255 255 255 / 0.04)"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="bucket"
              stroke="rgb(255 255 255 / 0.25)"
              tick={{ fontSize: 9, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(0, Math.floor(data.length / 7) - 1)}
              minTickGap={4}
            />
            <YAxis
              stroke="rgb(255 255 255 / 0.25)"
              tick={{ fontSize: 9, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number) => [
                metric === "orders" ? formatCount(v) : compactCrypto(v),
                metric === "orders" ? "Orders" : "Volume",
              ]}
            />
            <Bar
              dataKey="value"
              fill="#f97316"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── All Orders panel (admin-console mockup) ──────────────────────────────
//
// Self-contained order browser with status tabs (All / Pending / Active /
// Completed / Cancelled / Disputed), Buy/Sell type filter, Newest sort, and
// a search box that matches order_number client-side. Backed by
// /api/admin/orders which already supports comma-separated status filtering.
//
// Counts on the tab pills come from `orders` (the analytics breakdown) so
// they match the rest of the dashboard without an extra round-trip. Active =
// total - completed - cancelled - disputed (in-progress).

// Matches the camelCase shape returned by /api/admin/orders.
interface AdminOrderRow {
  id: string;
  orderNumber: string;
  type: string;
  status: string;
  amount: number;
  fiatAmount: number;
  createdAt: string;
  completedAt?: string | null;
  user: string;
  merchant: string;
  buyerMerchant: string | null;
}

const ALL_ORDERS_TABS: {
  key: string;
  label: string;
  statusFilter: string | null;
}[] = [
  { key: "all", label: "All", statusFilter: null },
  { key: "pending", label: "Pending", statusFilter: "pending" },
  {
    key: "active",
    label: "Active",
    statusFilter: "accepted,escrowed,payment_sent",
  },
  { key: "completed", label: "Completed", statusFilter: "completed" },
  { key: "cancelled", label: "Cancelled", statusFilter: "cancelled,expired" },
  { key: "disputed", label: "Disputed", statusFilter: "disputed" },
];

const STATUS_PILL: Record<string, { bg: string; text: string; label: string }> =
  {
    pending: {
      bg: "bg-yellow-500/15",
      text: "text-yellow-400",
      label: "Pending",
    },
    accepted: {
      bg: "bg-emerald-500/15",
      text: "text-emerald-400",
      label: "Accepted",
    },
    escrowed: {
      bg: "bg-purple-500/15",
      text: "text-purple-400",
      label: "Escrowed",
    },
    payment_sent: {
      bg: "bg-cyan-500/15",
      text: "text-cyan-400",
      label: "Paid",
    },
    completed: {
      bg: "bg-emerald-500/15",
      text: "text-emerald-400",
      label: "Done",
    },
    cancelled: {
      bg: "bg-red-500/15",
      text: "text-red-400",
      label: "Cancelled",
    },
    expired: { bg: "bg-zinc-500/15", text: "text-zinc-400", label: "Expired" },
    disputed: {
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      label: "Disputed",
    },
  };

function AllOrdersPanel({
  adminToken,
  orderCounts,
}: {
  adminToken: string;
  orderCounts: AnalyticsResponse["orders"];
}) {
  const [tab, setTab] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "buy" | "sell">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(false);

  const tokenRef = useRef(adminToken);
  tokenRef.current = adminToken;

  const fetchOrders = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const tabDef =
        ALL_ORDERS_TABS.find((t) => t.key === tab) ?? ALL_ORDERS_TABS[0];
      const url = tabDef.statusFilter
        ? `/api/admin/orders?status=${encodeURIComponent(tabDef.statusFilter)}&limit=100`
        : "/api/admin/orders?limit=100";
      const res = await fetchWithAuth(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json?.success && Array.isArray(json.data)) {
        setOrders(json.data as AdminOrderRow[]);
      }
    } catch {
      /* swallow — non-critical */
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Counts for the tab pills come from the analytics breakdown so they match
  // the rest of the dashboard.
  const active = Math.max(
    0,
    orderCounts.total -
      orderCounts.completed -
      orderCounts.cancelled -
      orderCounts.disputed,
  );
  const tabCounts: Record<string, number> = {
    all: orderCounts.total,
    pending: 0, // not split out by analytics today; falls back to "—" in the UI
    active,
    completed: orderCounts.completed,
    cancelled: orderCounts.cancelled,
    disputed: orderCounts.disputed,
  };

  const filtered = useMemo(() => {
    let rows = orders;
    if (typeFilter !== "all") {
      rows = rows.filter((o) => (o.type || "").toLowerCase() === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) =>
        (o.orderNumber || "").toLowerCase().includes(q),
      );
    }
    rows = [...rows].sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return sort === "newest" ? db - da : da - db;
    });
    return rows;
  }, [orders, typeFilter, search, sort]);

  return (
    <div className="flex flex-col h-full">
      {/* Header: search + sort */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/30" />
          <input
            type="text"
            placeholder="Search orders..."
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-section-divider rounded-md pl-7 pr-2 py-1 text-[10px] font-mono placeholder:text-foreground/25 focus:outline-none focus:border-primary/40"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
          className="bg-card border border-section-divider rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-primary/40"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 mb-2 shrink-0">
        {ALL_ORDERS_TABS.map((t) => {
          const count = tabCounts[t.key];
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors flex items-center gap-1 ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-foreground/40 hover:text-foreground/70 border border-transparent"
              }`}
            >
              <span>{t.label}</span>
              <span className="tabular-nums opacity-60">{count}</span>
            </button>
          );
        })}
        {/* Type filter pills */}
        <span className="mx-2 h-3 w-px bg-section-divider" />
        {(["all", "buy", "sell"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors capitalize ${
              typeFilter === t
                ? "bg-foreground/10 text-foreground/90 border border-foreground/20"
                : "text-foreground/40 hover:text-foreground/70 border border-transparent"
            }`}
          >
            {t === "all" ? "All types" : t}
          </button>
        ))}
      </div>

      {/* Order rows */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-1">
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center flex-1 text-[10px] font-mono text-foreground/30">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center flex-1 text-[10px] font-mono text-foreground/25">
            No orders
          </div>
        ) : (
          filtered.map((o) => {
            const pill = STATUS_PILL[o.status] ?? STATUS_PILL.pending;
            // The API populates `buyerMerchant` for M2M orders (buyer side is
            // a merchant) and otherwise leaves it null. `user` is the buyer
            // for U2M orders (or a placeholder label like "Open Order" /
            // "M2M Buyer" for unclaimed/M2M orders).
            const initiator = o.buyerMerchant || o.user || "—";
            const counterparty = o.merchant || "—";
            const isBuy = (o.type || "").toLowerCase() === "buy";
            const typeColor = isBuy ? "text-blue-400" : "text-amber-400";
            const cryptoOk = Number.isFinite(o.amount);
            const fiatOk = Number.isFinite(o.fiatAmount) && o.fiatAmount > 0;
            return (
              <div
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-card/40 border border-section-divider hover:border-foreground/15 transition-colors"
              >
                <div
                  className={`w-5 h-5 rounded shrink-0 flex items-center justify-center text-[10px] font-bold font-mono ${typeColor} bg-foreground/[0.04]`}
                >
                  {isBuy ? "B" : "S"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <span className="font-bold text-foreground/90 truncate">
                      {o.orderNumber}
                    </span>
                    <span
                      className={`shrink-0 px-1.5 py-px rounded text-[9px] font-bold ${pill.bg} ${pill.text}`}
                    >
                      {pill.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] font-mono text-foreground/40 min-w-0">
                    <span className="truncate max-w-[110px]" title={initiator}>{initiator}</span>
                    <ArrowRight className="w-2.5 h-2.5 opacity-50 shrink-0" />
                    <span className="truncate max-w-[110px]" title={counterparty}>{counterparty}</span>
                    <span className="opacity-50 shrink-0">·</span>
                    <span className="shrink-0">{formatTimeAgo(o.createdAt)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-mono font-bold tabular-nums text-foreground/90">
                    {cryptoOk ? compactCrypto(o.amount) : "—"} USDT
                  </div>
                  <div className="text-[9px] font-mono text-foreground/40 tabular-nums">
                    {fiatOk ? compactCrypto(o.fiatAmount) : ""}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Active Orders panel (admin-console mockup) ───────────────────────────
//
// Shows the count of in-progress orders with an empty state when zero. Pulls
// the count from the analytics breakdown to stay in sync with the rest of
// the dashboard.

function ActiveOrdersPanel({
  orders,
}: {
  orders: AnalyticsResponse["orders"];
}) {
  const active = Math.max(
    0,
    orders.total - orders.completed - orders.cancelled - orders.disputed,
  );
  if (active === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-foreground/30">
        <Activity className="w-5 h-5 opacity-40" />
        <span className="text-[10px] font-mono uppercase tracking-wider">
          No active orders
        </span>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <span className="text-3xl font-black font-mono tabular-nums text-primary">
        {formatCount(active)}
      </span>
      <span className="text-[10px] font-mono text-foreground/40 uppercase tracking-wider">
        in progress
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

interface AdminDashboardProps {
  adminToken: string;
}

export default function AdminDashboard({ adminToken }: AdminDashboardProps) {
  const [timeframe, setTimeframe] = useState<string>("24h");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  // Platform balance lives behind /api/admin/balance (separate from analytics)
  // — fetched alongside analytics so the KPI strip shows it without an extra
  // round-trip on the consumer side.
  const [platformBalance, setPlatformBalance] = useState<{
    balance: number;
    locked: number;
    currency: string;
  } | null>(null);

  const tokenRef = useRef(adminToken);
  tokenRef.current = adminToken;

  const { subscribe, unsubscribe, isConnected } = usePusher();

  const fetchData = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      // Parallel: analytics + platform balance. Both back the new KPI strip.
      const headers = { Authorization: `Bearer ${token}` };
      const [analyticsRes, balanceRes] = await Promise.allSettled([
        fetchWithAuth(`/api/admin/analytics?timeframe=${timeframe}`, {
          headers,
        }),
        fetchWithAuth("/api/admin/balance", { headers }),
      ]);

      if (analyticsRes.status === "fulfilled") {
        const json = await analyticsRes.value.json();
        if (!json.success) {
          throw new Error(json.error || "Failed to load analytics");
        }
        setData(json.data as AnalyticsResponse);
      } else {
        throw analyticsRes.reason;
      }

      // Balance is non-critical — failure here doesn't block the dashboard.
      if (balanceRes.status === "fulfilled") {
        try {
          const json = await balanceRes.value.json();
          if (json.success && json.data) {
            setPlatformBalance({
              balance: Number(
                json.data.balance ?? json.data.platformBalance ?? 0,
              ),
              locked: Number(json.data.locked ?? json.data.escrowLocked ?? 0),
              currency: String(json.data.currency ?? "USDT"),
            });
          }
        } catch {
          /* swallow — balance is best-effort */
        }
      }

      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  }, [timeframe]);

  // Initial fetch + on timeframe change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Pusher real-time updates
  useEffect(() => {
    if (!isConnected) return;
    const channel = subscribe("private-admin");
    if (!channel) return;
    const handler = () => fetchData();
    channel.bind("order:created", handler);
    channel.bind("order:status-updated", handler);
    return () => {
      channel.unbind("order:created", handler);
      channel.unbind("order:status-updated", handler);
      unsubscribe("private-admin");
    };
  }, [isConnected, subscribe, unsubscribe, fetchData]);

  // ─── Render gates ─────────────────────────────────────────────────────

  if (!data && isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-[10px] font-mono text-foreground/30 uppercase tracking-widest">
            Loading dashboard
          </span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex flex-col items-center gap-2 text-[var(--color-error)]/70">
          <XCircle className="w-6 h-6" />
          <span className="text-[10px] font-mono">{error}</span>
          <button
            onClick={fetchData}
            className="mt-2 px-3 py-1 rounded-md bg-card border border-border text-[10px] font-mono text-foreground/60 hover:text-foreground"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const completionPct = data.orders.successRate;
  const subtitle = `Updated ${formatTimeAgo(lastRefresh.toISOString())}`;

  // Delta-vs-prior-period for the KPI strip. We compare the second half of
  // the trend window (most-recent N/2 buckets) against the first half. Not a
  // strict "yesterday" delta — that requires a server-side previous-period
  // query — but it's a useful momentum indicator until that lands.
  const trend = data.volume.trend ?? [];
  const half = Math.floor(trend.length / 2);
  const sumVolume = (rows: typeof trend) =>
    rows.reduce((acc, r) => acc + (r.volume || 0), 0);
  const sumCount = (rows: typeof trend) =>
    rows.reduce((acc, r) => acc + (r.count || 0), 0);
  function pctChange(prev: number, curr: number): number | null {
    if (!Number.isFinite(prev) || prev <= 0) return null;
    return ((curr - prev) / prev) * 100;
  }
  const volumeFirstHalf = sumVolume(trend.slice(0, half));
  const volumeSecondHalf = sumVolume(trend.slice(half));
  const countFirstHalf = sumCount(trend.slice(0, half));
  const countSecondHalf = sumCount(trend.slice(half));
  const volumeDelta = pctChange(volumeFirstHalf, volumeSecondHalf);
  const ordersDelta = pctChange(countFirstHalf, countSecondHalf);
  // Revenue/fees scale with volume so we use the same momentum signal as a
  // proxy until the API returns explicit previous-period totals.
  const revenueDelta = volumeDelta;
  const feesDelta = volumeDelta;
  // Escrow is a point-in-time stock, not a flow — we don't have a sensible
  // delta from a single snapshot. Render "—" until the API exposes prior
  // escrow snapshots.
  const escrowDelta: number | null = null;
  const balanceDelta: number | null = null;
  void ordersDelta; // reserved for the All Orders strip in phase 4

  return (
    <div className="flex flex-col h-full gap-2 p-2 overflow-hidden">
      {/* ─── Filter bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-foreground/30 uppercase tracking-wider">
            Range
          </span>
          <div className="flex gap-0.5 bg-card rounded-md p-0.5 border border-section-divider">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.key}
                onClick={() => setTimeframe(tf.key)}
                className={`px-2 py-1 text-[10px] font-mono font-bold rounded transition-colors ${
                  timeframe === tf.key
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-foreground/30 hover:text-foreground/60"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-foreground/25">
            Last refresh{" "}
            {lastRefresh.toLocaleTimeString("en-US", { hour12: false })}
          </span>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="p-1.5 rounded-md bg-card hover:bg-accent-subtle border border-section-divider transition-colors"
            title="Refresh"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-foreground/50 ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* ─── KPI row (5-card mockup: Platform Balance / Revenue / Escrow / Fees / 24H Volume) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 shrink-0">
        <KpiCard
          label="Platform Balance"
          value={platformBalance ? compactCrypto(platformBalance.balance) : "—"}
          unit={platformBalance?.currency ?? "USDT"}
          icon={Wallet}
          accent="warning"
          hint={
            platformBalance
              ? `${compactCrypto(platformBalance.locked)} locked`
              : undefined
          }
          delta={balanceDelta}
        />
        <KpiCard
          label="Revenue"
          value={compactCrypto(data.revenue.total)}
          icon={TrendingUp}
          accent="success"
          delta={revenueDelta}
        />
        <KpiCard
          label="Escrow"
          value={compactCrypto(data.risk.escrowLocked)}
          icon={Lock}
          accent="primary"
          delta={escrowDelta}
        />
        <KpiCard
          label="Fees"
          value={compactCrypto(data.revenue.fees)}
          icon={Percent}
          accent="success"
          delta={feesDelta}
        />
        <KpiCard
          label="24H Volume"
          value={compactCrypto(data.volume.total)}
          icon={DollarSign}
          accent="primary"
          hint={`${formatCount(data.volume.orderCount)} orders`}
          delta={volumeDelta}
        />
      </div>

      {/* ─── 4-column layout (admin-console mockup, exact proportions) ──
       *   Outer: 12-col grid split 6/6 → left half + right half
       *   Inside each half: another 12-col grid for the inner column split
       *
       *   Mockup proportions translate to:
       *     Col 1 (System Health + Order Breakdown):  17% viewport → 4 of left's 12
       *     Col 2 (All Orders):                       33% viewport → 8 of left's 12
       *     Col 3 (Active Orders + Recent Orders):    25% viewport → 6 of right's 12
       *     Col 4 (Top Merchants + Activity Feed):    25% viewport → 6 of right's 12
       *
       *   24H chart sits at the bottom of the LEFT half only — it stops at
       *   the left/right divider and never pushes the right half down.
       */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 flex-1 min-h-0">
        {/* ─── LEFT HALF (col-span-6) ─────────────────────────────── */}
        <div className="lg:col-span-6 flex flex-col gap-2 min-h-0">
          {/* Top row: Col 1 (rail) + Col 2 (All Orders) */}
          <div className="grid grid-cols-12 gap-2 flex-1 min-h-0">
            {/* Col 1 — System Health + Order Breakdown */}
            <div className="col-span-4 flex flex-col gap-2 min-h-0">
              <ChartCard
                title="System Health"
                subtitle={
                  completionPct >= 95
                    ? "Operational"
                    : completionPct >= 80
                      ? "Degraded"
                      : "Critical"
                }
                className="flex-[2] min-h-0"
              >
                <SystemHealthRing
                  successRate={completionPct}
                  avgCompletionSeconds={data.orders.avgCompletionSeconds}
                />
              </ChartCard>
              <ChartCard
                title="Order Breakdown"
                subtitle="Status distribution"
                className="flex-[3] min-h-0"
              >
                <OrderBreakdown orders={data.orders} />
              </ChartCard>
            </div>
            {/* Col 2 — All Orders */}
            <div className="col-span-8 flex flex-col min-h-0">
              <ChartCard
                title="All Orders"
                subtitle={`${formatCount(data.orders.total)} · ${compactCrypto(data.revenue.total)} / ${compactCrypto(data.volume.totalFiat)}`}
                className="flex-1 min-h-0"
              >
                <AllOrdersPanel
                  adminToken={adminToken}
                  orderCounts={data.orders}
                />
              </ChartCard>
            </div>
          </div>

          {/* Bottom: 24H Activity chart — only spans the left half. Height
           *  kept compact so the rail above it has room on shorter viewports. */}
          <ChartCard
            title="24H Activity"
            subtitle={`Hourly buckets · ${timeframe} window`}
            className="h-[140px] shrink-0"
          >
            <ActivityBarChart trend={data.volume.trend} timeframe={timeframe} />
          </ChartCard>
        </div>

        {/* ─── RIGHT HALF (col-span-6) ────────────────────────────────
         *   Two sub-columns side-by-side, each a vertical stack of cards.
         *   Right half owns its full vertical space — the 24H chart on
         *   the left has no effect on this section's layout.
         */}
        <div className="lg:col-span-6 grid grid-cols-12 gap-2 min-h-0">
          {/* Col 3 — Active Orders + Recent Orders */}
          <div className="col-span-6 flex flex-col gap-2 min-h-0">
            <ChartCard
              title="Active Orders"
              subtitle="In progress right now"
              className="flex-[2] min-h-0"
            >
              <ActiveOrdersPanel orders={data.orders} />
            </ChartCard>
            <ChartCard
              title="Recent Orders"
              subtitle={`Last ${data.liveFeed.length}`}
              className="flex-[5] min-h-0"
              action={
                <button className="text-[9px] font-mono text-primary/70 hover:text-primary transition-colors">
                  View all
                </button>
              }
            >
              <LiveFeed feed={data.liveFeed} />
            </ChartCard>
          </div>

          {/* Col 4 — Top Merchants + Activity Feed */}
          <div className="col-span-6 flex flex-col gap-2 min-h-0">
            <ChartCard
              title="Top Merchants"
              subtitle="By completed volume"
              className="flex-1 min-h-0"
              action={
                <button className="text-[9px] font-mono text-primary/70 hover:text-primary transition-colors">
                  View all
                </button>
              }
            >
              <TopMerchantsLeaderboard traders={data.users.topTraders} />
            </ChartCard>
            <ChartCard
              title="Activity Feed"
              subtitle={isConnected ? "Streaming" : "Polling"}
              className="flex-1 min-h-0"
              action={
                <span className="flex items-center gap-1 text-[9px] font-mono text-[var(--color-success)]/70">
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-success)]">
                    <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-success)] opacity-70" />
                  </span>
                  Live
                </span>
              }
            >
              <ActivityFeed adminToken={adminToken} />
            </ChartCard>
          </div>
        </div>
      </div>
    </div>
  );
}
