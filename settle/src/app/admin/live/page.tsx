"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Activity,
  ArrowRight,
  Calendar,
  Zap,
  Lock,
  DollarSign,
  TrendingUp,
  Users,
  CheckCircle,
  Radio,
  Wallet,
  Gauge,
} from "lucide-react";
import Link from "next/link";
import { usePusher } from "@/context/PusherContext";
import { ADMIN_COOKIE_SENTINEL } from "@/lib/api/adminSession";
import {
  formatCount,
  formatCrypto,
  formatFiat,
  formatPercentage,
} from "@/lib/format";

// ============================================
// TYPES
// ============================================

interface LiveOrder {
  id: string;
  orderNumber: string;
  user: string;
  merchant: string;
  buyerMerchant: string | null;
  amount: number;
  fiatAmount: number;
  status: string;
  type: string;
  spreadPreference: string | null;
  feePercentage: number | null;
  feeAmount: number | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

interface LiveStats {
  totalTrades: number;
  totalTradesChange: number;
  openOrders: number;
  volume24h: number;
  volume24hChange: number;
  activeMerchants: number;
  escrowLocked: number;
  disputes: number;
  successRate: number;
  txPerMinute: number;
  todayRevenue: number;
  platformBalance: number;
  totalFeesCollected: number;
  hourlyData: { hour: string; count: number; volume: number }[];
}

// ============================================
// HELPERS
// ============================================

const getStatusConfig = (status: string) => {
  switch (status) {
    case "pending":
      return { label: "PENDING", color: "text-foreground/40", bg: "bg-card border-border", dot: "bg-foreground/30" };
    case "accepted":
      return { label: "ACCEPTED", color: "text-primary", bg: "bg-primary/10 border-primary/20", dot: "bg-primary" };
    case "escrow_pending":
      return { label: "LOCKING", color: "text-primary", bg: "bg-primary/10 border-primary/20", dot: "bg-primary animate-pulse" };
    case "escrowed":
      return { label: "ESCROWED", color: "text-primary", bg: "bg-primary/10 border-primary/20", dot: "bg-primary" };
    case "payment_pending":
    case "payment_sent":
      return { label: "PAYMENT SENT", color: "text-primary", bg: "bg-primary/10 border-primary/20", dot: "bg-primary animate-pulse" };
    case "payment_confirmed":
      return { label: "CONFIRMED", color: "text-[var(--color-success)]", bg: "bg-[var(--color-success)]/10 border-[var(--color-success)]/20", dot: "bg-[var(--color-success)] animate-pulse" };
    case "releasing":
      return { label: "RELEASING", color: "text-[var(--color-success)]", bg: "bg-[var(--color-success)]/10 border-[var(--color-success)]/20", dot: "bg-[var(--color-success)] animate-pulse" };
    case "completed":
      return { label: "COMPLETED", color: "text-[var(--color-success)]/60", bg: "bg-[var(--color-success)]/[0.06] border-[var(--color-success)]/10", dot: "bg-[var(--color-success)]/50" };
    case "disputed":
      return { label: "DISPUTED", color: "text-[var(--color-error)]", bg: "bg-[var(--color-error)]/10 border-[var(--color-error)]/20", dot: "bg-[var(--color-error)] animate-pulse" };
    case "cancelled":
    case "expired":
      return { label: status.toUpperCase(), color: "text-foreground/20", bg: "bg-card border-section-divider", dot: "bg-foreground/15" };
    default:
      return { label: status.toUpperCase(), color: "text-foreground/40", bg: "bg-card border-border", dot: "bg-foreground/30" };
  }
};

const isActiveOrder = (status: string) =>
  ["pending", "accepted", "escrow_pending", "escrowed", "payment_pending", "payment_sent", "payment_confirmed", "releasing"].includes(status);

const formatRelativeTime = (date: string | null | undefined): string => {
  if (!date) return "—";
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return "now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
};

// Compact volume display: 1234 → "$1.2k", 999 → "$999"
const formatVolumeCompact = (value: number | undefined): string => {
  if (value == null) return "—";
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${formatCrypto(value, { decimals: 0 })}`;
};

// ============================================
// LIVE DASHBOARD
// ============================================

export default function LiveDashboardPage() {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [mounted, setMounted] = useState(false);
  const [, setTickCount] = useState(0);
  const [noAuth, setNoAuth] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { subscribe, unsubscribe, isConnected } = usePusher();

  useEffect(() => {
    setMounted(true);
    // Cookie-based session: probe /api/auth/admin (cookie auto-attached).
    // For users still holding a legacy localStorage token, send it once
    // as a Bearer header so the server can migrate them onto a cookie.
    let cancelled = false;
    (async () => {
      try {
        const legacyToken = localStorage.getItem("blip_admin_token");
        const headers: Record<string, string> = {};
        if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;
        const res = await fetch("/api/auth/admin", { headers });
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && data?.data?.valid) {
          tokenRef.current = ADMIN_COOKIE_SENTINEL;
          if (legacyToken) localStorage.removeItem("blip_admin_token");
        } else {
          setNoAuth(true);
        }
      } catch {
        if (!cancelled) setNoAuth(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tick every second for timer updates
  useEffect(() => {
    const interval = setInterval(() => setTickCount((c) => c + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch data with in-flight guard and abort controller
  const fetchData = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Cookie auto-sent on same-origin fetch — no Bearer header needed.
      const [ordersRes, statsRes] = await Promise.all([
        fetch("/api/admin/orders?limit=200", { signal: controller.signal }),
        fetch("/api/admin/stats", { signal: controller.signal }),
      ]);
      const [ordersData, statsData] = await Promise.all([
        ordersRes.json(),
        statsRes.json(),
      ]);
      if (ordersData.success) setOrders(ordersData.data);
      if (statsData.success) setStats(statsData.data);
      setLastUpdate(new Date());
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error("Live fetch error:", err);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  // Debounced fetch — coalesces Pusher event storms into single call
  const debouncedFetchData = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(fetchData, 300);
  }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Polling fallback — only when Pusher is NOT connected, 10s interval
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData, isConnected]);

  // Pusher — debounced handler to avoid event storm double-fetches
  useEffect(() => {
    if (!isConnected) return;
    const channel = subscribe("private-admin");
    if (!channel) return;
    const handleUpdate = () => debouncedFetchData();
    channel.bind("order:created", handleUpdate);
    channel.bind("order:status-updated", handleUpdate);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      channel.unbind("order:created", handleUpdate);
      channel.unbind("order:status-updated", handleUpdate);
      unsubscribe("private-admin");
    };
  }, [isConnected, subscribe, unsubscribe, debouncedFetchData]);

  // Split orders
  const activeOrders = orders.filter((o) => isActiveOrder(o.status));
  const recentCompleted = orders
    .filter((o) => o.status === "completed")
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.completedAt ?? a.createdAt).getTime();
      const tb = new Date(b.completedAt ?? b.createdAt).getTime();
      return tb - ta;
    })
    .slice(0, 10);
  const disputedOrders = orders.filter((o) => o.status === "disputed");

  // Hourly buckets indexed by hour-of-day (0-23) for the activity chart
  const { hourBuckets, maxCount } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const currentHour = new Date().getHours();
    const hourly = stats?.hourlyData ?? [];

    const buckets = Array.from({ length: 24 }, (_, hour) => {
      const slotStart = todayStart + hour * 3600_000;
      const slotEnd = slotStart + 3600_000;
      const hit = hourly.find((h) => {
        const ts = new Date(h.hour).getTime();
        return ts >= slotStart && ts < slotEnd;
      });
      return {
        hour,
        count: hit?.count ?? 0,
        isFuture: hour > currentHour,
        isCurrent: hour === currentHour,
      };
    });

    const max = Math.max(...buckets.map((b) => b.count), 1);
    // Round to a nice number for the y-axis label
    const niceMax = max <= 10 ? 10
      : max <= 50 ? Math.ceil(max / 10) * 10
      : max <= 300 ? Math.ceil(max / 50) * 50
      : Math.ceil(max / 100) * 100;

    return { hourBuckets: buckets, maxCount: niceMax };
  }, [stats?.hourlyData]);

  if (noAuth) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <p className="text-foreground/40 text-sm mb-3">Not authenticated</p>
          <Link href="/admin" className="text-primary text-xs hover:underline">Sign in at Admin Console</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[30%] w-[600px] h-[400px] bg-primary/[0.015] rounded-full blur-[150px]" />
        <div className="absolute bottom-[-10%] right-[20%] w-[400px] h-[300px] bg-primary/[0.01] rounded-full blur-[120px]" />
      </div>

      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="h-[50px] flex items-center px-4 gap-3">
          {/* Logo */}
          <div className="flex items-center shrink-0">
            <Link href="/admin" className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-foreground fill-foreground" />
              <span className="text-[17px] leading-none whitespace-nowrap hidden lg:block">
                <span className="font-bold text-foreground">Blip</span>{" "}
                <span className="italic text-foreground/90">money</span>
              </span>
            </Link>
          </div>

          {/* Center: Nav pills */}
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              <Link href="/admin" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">
                Console
              </Link>
              <Link href="/admin/live" className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors">
                Live Feed
              </Link>
              <Link href="/admin/access-control" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">
                Access Control
              </Link>
              <Link href="/admin/accounts" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Accounts</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Monitor</Link>
              <Link href="/admin/observability" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Observability</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>

          {/* Right: Live stats */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <Gauge className="w-3 h-3 text-primary/40" />
              <span className="text-[10px] font-mono text-primary/70 tabular-nums">{formatCrypto(stats?.txPerMinute ?? 0)}/min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-foreground/20" />
              <span className="text-[10px] font-mono text-foreground/30 tabular-nums">{formatCount(activeOrders.length)} active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-foreground/20" />
              <span className="text-[10px] font-mono text-foreground/30 tabular-nums">${formatCrypto(stats?.escrowLocked ?? 0, { decimals: 0 })}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <div className="w-2 h-2 rounded-full bg-[var(--color-success)]/60 animate-pulse" />
              <span className="text-[9px] font-mono font-bold text-foreground/40 uppercase tracking-wider">Live</span>
            </div>
            <span className="text-[9px] font-mono text-foreground/20">{mounted ? lastUpdate.toLocaleTimeString() : "--:--:--"}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="relative z-10 p-3 h-[calc(100vh-50px)] flex flex-col gap-3 overflow-hidden">

        {/* Summary strip */}
        <div className="flex gap-2 shrink-0">
          <SummaryCard
            label="24H VOLUME"
            value={formatVolumeCompact(stats?.volume24h)}
            delta={stats?.volume24hChange}
            icon={<TrendingUp className="w-3 h-3" />}
          />
          <SummaryCard
            label="TRADES"
            value={stats != null ? formatCount(stats.totalTrades) : "—"}
            delta={stats?.totalTradesChange}
            icon={<Activity className="w-3 h-3" />}
          />
          <SummaryCard
            label="REVENUE"
            value={stats != null ? `$${formatCrypto(stats.todayRevenue)}` : "—"}
            delta={stats != null ? 0 : null}
            icon={<DollarSign className="w-3 h-3" />}
            highlight
          />
          <SummaryCard
            label="BALANCE"
            value={stats != null ? `$${formatCrypto(stats.platformBalance)}` : "—"}
            delta={null}
            icon={<Wallet className="w-3 h-3" />}
          />
          <SummaryCard
            label="ONLINE"
            value={stats != null ? formatCount(stats.activeMerchants) : "—"}
            delta={null}
            icon={<Users className="w-3 h-3" />}
          />
          <SummaryCard
            label="SUCCESS RATE"
            value={stats != null ? `${formatCrypto(stats.successRate, { decimals: 0 })}%` : "—"}
            delta={null}
            icon={<CheckCircle className="w-3 h-3" />}
          />
        </div>

        {/* Main grid: Active Orders + Side */}
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-4 gap-3 min-h-0">

          {/* Active orders — main focus */}
          <div className="xl:col-span-3 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Radio className="w-3.5 h-3.5 text-primary/40" />
              <span className="text-[10px] font-mono text-foreground/30 uppercase tracking-wider">Active Orders</span>
              <span className="text-[10px] font-mono text-foreground/30 tabular-nums">{formatCount(activeOrders.length)}</span>
              {disputedOrders.length > 0 && (
                <span className="text-[10px] font-mono text-[var(--color-error)]/60 px-1.5 py-0.5 bg-[var(--color-error)]/[0.06] rounded ml-auto">
                  {formatCount(disputedOrders.length)} disputed
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-1.5 min-h-0">
              {activeOrders.length > 0 || disputedOrders.length > 0 ? (
                [...disputedOrders, ...activeOrders]
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime(),
                  )
                  .map((order) => <OrderCard key={order.id} order={order} />)
              ) : (
                <EmptyActiveOrders />
              )}
            </div>
          </div>

          {/* Side panel */}
          <div className="flex flex-col gap-3 min-h-0">

            {/* Hourly chart */}
            <div className="bg-card border border-section-divider rounded-lg p-3 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-primary/40" />
                  <span className="text-[9px] font-mono text-foreground/30 uppercase tracking-wider">Activity</span>
                </div>
                <div className="flex items-center gap-1 px-1.5 py-0.5 bg-background border border-section-divider rounded text-[9px] font-mono text-foreground/30">
                  <Calendar className="w-2.5 h-2.5" />
                  24H
                </div>
              </div>

              <ActivityChart buckets={hourBuckets} maxCount={maxCount} />
            </div>

            {/* Recent completed */}
            <div className="flex-1 bg-card border border-section-divider rounded-lg p-3 min-h-0 flex flex-col">
              <div className="flex items-center gap-1.5 mb-2 shrink-0">
                <CheckCircle className="w-3 h-3 text-[var(--color-success)]/40" />
                <span className="text-[9px] font-mono text-foreground/30 uppercase tracking-wider">Recent Completed</span>
                <span className="text-[9px] font-mono text-foreground/40 tabular-nums">{formatCount(recentCompleted.length)}</span>
                <Link
                  href="/admin/accounts"
                  className="ml-auto text-[9px] font-mono text-primary/60 hover:text-primary transition-colors"
                >
                  View all
                </Link>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-hide space-y-0.5">
                {recentCompleted.length > 0 ? recentCompleted.map((o) => (
                  <CompletedRow key={o.id} order={o} />
                )) : (
                  <div className="h-full flex items-center justify-center text-[9px] text-foreground/15 font-mono">None yet</div>
                )}
              </div>
              {recentCompleted.length > 0 && (
                <Link
                  href="/admin/accounts"
                  className="mt-2 shrink-0 text-center py-2 text-[10px] font-mono text-foreground/40 hover:text-foreground/70 border border-section-divider rounded hover:bg-accent-subtle transition-colors"
                >
                  View all completed
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SUMMARY CARD
// ============================================

function SummaryCard({
  label,
  value,
  delta,
  icon,
  highlight,
}: {
  label: string;
  value: string | number;
  delta: number | null | undefined;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  const deltaText =
    delta == null
      ? "—"
      : delta > 0
      ? `+${formatPercentage(delta)}`
      : delta < 0
      ? `${formatPercentage(delta)}`
      : `${formatPercentage(0)}`;

  const deltaColor =
    delta == null
      ? "text-foreground/15"
      : delta > 0
      ? "text-[var(--color-success)]/70"
      : delta < 0
      ? "text-[var(--color-error)]/70"
      : "text-foreground/25";

  return (
    <div className="flex-1 bg-card border border-section-divider rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={highlight ? "text-primary/40" : "text-foreground/20"}>{icon}</span>
        <span className="text-[8px] font-mono text-foreground/30 tracking-wider uppercase">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-[15px] font-bold font-mono tabular-nums ${highlight ? "text-primary" : "text-foreground/85"}`}>
          {value}
        </span>
        <span className={`text-[10px] font-mono tabular-nums ${deltaColor}`}>
          {deltaText}
        </span>
      </div>
    </div>
  );
}

// ============================================
// EMPTY STATE — ACTIVE ORDERS
// ============================================

function EmptyActiveOrders() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="relative w-32 h-32 mx-auto mb-5 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-primary/30 animate-ping" style={{ animationDuration: "3s" }} />
          <div className="absolute inset-4 rounded-full border border-primary/40 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.4s" }} />
          <div className="absolute inset-9 rounded-full border border-primary/60 animate-ping" style={{ animationDuration: "2s", animationDelay: "0.8s" }} />
          <div className="relative w-12 h-12 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary/80" />
          </div>
        </div>
        <p className="text-sm text-foreground/50 font-mono">No active orders</p>
        <p className="text-[10px] text-foreground/25 font-mono mt-1">Waiting for trades...</p>
      </div>
    </div>
  );
}

// ============================================
// ACTIVITY CHART
// ============================================

function ActivityChart({
  buckets,
  maxCount,
}: {
  buckets: { hour: number; count: number; isFuture: boolean; isCurrent: boolean }[];
  maxCount: number;
}) {
  const yLabels = [maxCount, Math.round(maxCount / 2), 0];
  const xLabels = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div className="flex">
      {/* Y-axis labels */}
      <div className="flex flex-col justify-between text-[8px] font-mono text-foreground/20 tabular-nums pr-2 h-20 -mt-[3px] -mb-[3px] text-right shrink-0">
        {yLabels.map((v) => (
          <span key={v}>{formatCount(v)}</span>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        {/* Bars */}
        <div className="h-20 flex items-end gap-[1px] border-b border-section-divider/40">
          {buckets.map((b) => {
            const h = (b.count / maxCount) * 100;
            return (
              <div key={b.hour} className="flex-1 h-full flex items-end">
                <div
                  style={{ height: `${Math.max(h, b.isFuture ? 0 : 2)}%` }}
                  className={`w-full rounded-t-[1px] transition-all ${
                    b.isFuture
                      ? "bg-foreground/[0.04]"
                      : b.isCurrent
                      ? "bg-primary"
                      : "bg-primary/50"
                  }`}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="relative h-3 mt-1.5 text-[8px] font-mono text-foreground/20 tabular-nums">
          {xLabels.map((h, i) => (
            <span
              key={h}
              className="absolute"
              style={{
                left: `${(h / 24) * 100}%`,
                transform:
                  i === 0
                    ? "translateX(0)"
                    : i === xLabels.length - 1
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
              }}
            >
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// COMPLETED ROW
// ============================================

function CompletedRow({ order }: { order: LiveOrder }) {
  const isBuy = order.type === "buy";
  return (
    <div className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-accent-subtle transition-colors">
      <div className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-black shrink-0 ${
        isBuy ? "bg-primary/15 text-primary/80" : "bg-foreground/[0.06] text-foreground/35"
      }`}>
        {isBuy ? "B" : "S"}
      </div>
      <span className="text-[9px] font-mono text-foreground/45 truncate flex-1 min-w-0">{order.orderNumber}</span>
      <span className={`text-[8px] font-mono font-bold uppercase shrink-0 ${
        isBuy ? "text-primary/70" : "text-foreground/35"
      }`}>
        {order.type}
      </span>
      <span className="text-[8px] font-mono text-foreground/20 tabular-nums shrink-0 w-5 text-right">
        {formatRelativeTime(order.completedAt ?? order.createdAt)}
      </span>
      <span className="text-[10px] font-mono font-bold text-foreground/55 tabular-nums shrink-0 w-12 text-right">
        ${formatCrypto(order.amount, { decimals: 0 })}
      </span>
      {order.feeAmount != null && order.feeAmount > 0 ? (
        <span className="text-[8px] font-mono text-primary/50 tabular-nums shrink-0 w-10 text-right">
          +${formatCrypto(order.feeAmount)}
        </span>
      ) : (
        <span className="shrink-0 w-10" />
      )}
    </div>
  );
}

// ============================================
// ORDER CARD
// ============================================

function OrderCard({ order }: { order: LiveOrder }) {
  const statusConfig = getStatusConfig(order.status);
  const expiresIn = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000));
  const isUrgent = expiresIn > 0 && expiresIn < 120;
  const isWarning = expiresIn > 0 && expiresIn < 300;
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000));

  const statusProgress: Record<string, number> = {
    pending: 10, accepted: 25, escrow_pending: 35, escrowed: 50,
    payment_pending: 60, payment_sent: 70, payment_confirmed: 85,
    releasing: 95, completed: 100, disputed: 50,
  };
  const progress = statusProgress[order.status] ?? 0;

  return (
    <div className={`bg-card border rounded-lg px-4 py-3 transition-all ${
      order.status === "disputed"
        ? "border-[var(--color-error)]/20 bg-[var(--color-error)]/[0.02]"
        : isUrgent
        ? "border-[var(--color-error)]/15 bg-[var(--color-error)]/[0.01]"
        : isWarning
        ? "border-primary/15 bg-primary/[0.01]"
        : "border-section-divider hover:border-border"
    }`}>
      <div className="flex items-center gap-4">
        {/* Type */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
          order.type === "buy"
            ? "bg-primary/10 border border-primary/20 text-primary"
            : "bg-card border border-border text-foreground/40"
        }`}>
          {order.type === "buy" ? "BUY" : "SELL"}
        </div>

        {/* Order info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-foreground/60">{order.orderNumber}</span>
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${statusConfig.bg} ${statusConfig.color}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusConfig.dot} mr-1`} />
              {statusConfig.label}
            </span>
            {order.spreadPreference === "fastest" && (
              <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-mono text-primary/40">
                <Zap className="w-2.5 h-2.5" /> FAST
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/25 font-mono">
            <span className="truncate max-w-[100px]">{order.buyerMerchant || order.user}</span>
            <ArrowRight className="w-3 h-3 text-foreground/10 shrink-0" />
            <span className="truncate max-w-[100px]">{order.merchant}</span>
            <span className="text-foreground/10">·</span>
            <span className="text-foreground/15">{Math.floor(elapsed / 60)}m {elapsed % 60}s elapsed</span>
          </div>
        </div>

        {/* Amount */}
        <div className="text-right shrink-0">
          <p className="text-lg font-black font-mono tabular-nums text-foreground/80">
            ${formatCrypto(order.amount, { decimals: 0 })}
          </p>
          <p className="text-[10px] font-mono text-foreground/20 tabular-nums">
            {formatFiat(order.fiatAmount, "AED")}
          </p>
        </div>

        {/* Fee */}
        {order.feeAmount != null && order.feeAmount > 0 && (
          <div className="text-right shrink-0 pl-2 border-l border-section-divider">
            <p className="text-[10px] font-mono text-primary/50">FEE</p>
            <p className="text-xs font-bold font-mono tabular-nums text-primary/70">
              ${formatCrypto(order.feeAmount)}
            </p>
            <p className="text-[9px] font-mono text-foreground/15">{formatPercentage(order.feePercentage ?? 0)}</p>
          </div>
        )}

        {/* Timer */}
        {expiresIn > 0 && (
          <div className={`shrink-0 text-right pl-3 ${
            isUrgent ? "text-[var(--color-error)]" : isWarning ? "text-primary/70" : "text-foreground/25"
          }`}>
            <p className="text-xl font-black font-mono tabular-nums">
              {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")}
            </p>
            <p className="text-[8px] font-mono opacity-50">remaining</p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-2.5 h-[2px] bg-card rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            order.status === "disputed" ? "bg-[var(--color-error)]/40" :
            order.status === "completed" ? "bg-[var(--color-success)]/30" :
            "bg-primary/30"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
