"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  ArrowRight,
  Clock,
  Zap,
  Lock,
  DollarSign,
  TrendingUp,
  Users,
  AlertTriangle,
  CheckCircle,
  Radio,
  Wallet,
  Gauge,
} from "lucide-react";
import Link from "next/link";
import { usePusher } from "@/context/PusherContext";

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
  openOrders: number;
  volume24h: number;
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

// ============================================
// LIVE DASHBOARD
// ============================================

export default function LiveDashboardPage() {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [mounted, setMounted] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [noAuth, setNoAuth] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { subscribe, unsubscribe, isConnected } = usePusher();

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("blip_admin_token");
    if (!token) {
      setNoAuth(true);
    } else {
      tokenRef.current = token;
    }
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
      const headers = { Authorization: `Bearer ${token}` };
      const [ordersRes, statsRes] = await Promise.all([
        fetch("/api/admin/orders?limit=200", { headers, signal: controller.signal }),
        fetch("/api/admin/stats", { headers, signal: controller.signal }),
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
    if (isConnected) return; // Pusher handles updates — no polling needed
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
    .slice(0, 10);
  const disputedOrders = orders.filter((o) => o.status === "disputed");

  // Hourly chart
  const hourlyData = stats?.hourlyData || [];
  const maxHourly = Math.max(...hourlyData.map((h) => h.count), 1);

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

      {/* ===== HEADER — matches admin console ===== */}
      <header className="sticky top-0 z-10 bg-background/60 backdrop-blur-2xl border-b border-border">
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
              <Link href="/admin/ops-access" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">
                Ops Access
              </Link>
              <Link href="/admin/compliance-access" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">
                Compliance Access
              </Link>
              <Link href="/admin/merchants" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">
                Merchants
              </Link>
              <Link href="/admin/users" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Users</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Monitor</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>

          {/* Right: Live stats */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <Gauge className="w-3 h-3 text-primary/40" />
              <span className="text-[10px] font-mono text-primary/70 tabular-nums">{stats?.txPerMinute?.toFixed(2) || "0.00"}/min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-foreground/20" />
              <span className="text-[10px] font-mono text-foreground/30 tabular-nums">{activeOrders.length} active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-foreground/20" />
              <span className="text-[10px] font-mono text-foreground/30 tabular-nums">${stats?.escrowLocked?.toFixed(0) || 0}</span>
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
          {[
            { label: "24H VOL", value: stats ? `$${stats.volume24h >= 1000 ? (stats.volume24h / 1000).toFixed(1) + "k" : stats.volume24h.toFixed(0)}` : "—", icon: <TrendingUp className="w-3 h-3" /> },
            { label: "TRADES", value: stats?.totalTrades ?? "—", icon: <Activity className="w-3 h-3" /> },
            { label: "REVENUE", value: stats ? `$${stats.todayRevenue.toFixed(2)}` : "—", icon: <DollarSign className="w-3 h-3" />, highlight: true },
            { label: "BALANCE", value: stats ? `$${stats.platformBalance.toFixed(2)}` : "—", icon: <Wallet className="w-3 h-3" /> },
            { label: "ONLINE", value: stats?.activeMerchants ?? "—", icon: <Users className="w-3 h-3" /> },
            { label: "SUCCESS", value: stats ? `${stats.successRate.toFixed(0)}%` : "—", icon: <CheckCircle className="w-3 h-3" /> },
          ].map((s) => (
            <div key={s.label} className="flex-1 bg-card border border-section-divider rounded-lg px-3 py-2 flex items-center gap-2">
              <span className={s.highlight ? "text-primary/40" : "text-foreground/10"}>{s.icon}</span>
              <div>
                <p className="text-[8px] font-mono text-foreground/20 tracking-wider">{s.label}</p>
                <p className={`text-sm font-bold font-mono tabular-nums ${s.highlight ? "text-primary" : "text-foreground/70"}`}>{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Main grid: Active Orders + Side */}
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-4 gap-3 min-h-0">

          {/* Active orders — main focus */}
          <div className="xl:col-span-3 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Radio className="w-3.5 h-3.5 text-primary/40" />
              <span className="text-[10px] font-mono text-foreground/30 uppercase tracking-wider">Active Orders</span>
              <span className="text-[10px] font-mono text-primary/50 px-1.5 py-0.5 bg-primary/[0.06] rounded">{activeOrders.length}</span>
              {disputedOrders.length > 0 && (
                <span className="text-[10px] font-mono text-[var(--color-error)]/60 px-1.5 py-0.5 bg-[var(--color-error)]/[0.06] rounded ml-auto">
                  {disputedOrders.length} disputed
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-1.5 min-h-0">
              {activeOrders.length > 0 ? (
                <>
                  {/* Disputed first */}
                  {disputedOrders.map((order) => (
                    <OrderCard key={order.id} order={order} tickCount={tickCount} />
                  ))}
                  {/* Then active by status priority */}
                  {activeOrders
                    .sort((a, b) => {
                      const priority: Record<string, number> = {
                        releasing: 0, payment_confirmed: 1, payment_sent: 2,
                        escrowed: 3, escrow_pending: 4, accepted: 5, pending: 6,
                      };
                      return (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
                    })
                    .map((order) => (
                      <OrderCard key={order.id} order={order} tickCount={tickCount} />
                    ))}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <Clock className="w-8 h-8 text-foreground/[0.06] mx-auto mb-2" />
                    <p className="text-[11px] text-foreground/15 font-mono">No active orders</p>
                    <p className="text-[9px] text-foreground/10 font-mono mt-1">Waiting for trades...</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Side panel */}
          <div className="flex flex-col gap-3 min-h-0">

            {/* Mini hourly chart */}
            <div className="bg-card border border-section-divider rounded-lg p-3 shrink-0">
              <div className="flex items-center gap-1.5 mb-2">
                <Activity className="w-3 h-3 text-foreground/15" />
                <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-wider">24h Activity</span>
              </div>
              {hourlyData.length > 0 ? (
                <div className="h-12 flex items-end gap-[1px]">
                  {hourlyData.slice(-24).map((d, i) => {
                    const h = (d.count / maxHourly) * 100;
                    const isNow = new Date(d.hour).getHours() === new Date().getHours();
                    return (
                      <div
                        key={i}
                        className="flex-1"
                        style={{ height: `${Math.max(h, 4)}%` }}
                      >
                        <div className={`w-full h-full rounded-t-[1px] ${isNow ? "bg-primary" : "bg-accent-subtle"}`} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-12 flex items-center justify-center text-[9px] text-foreground/10">—</div>
              )}
            </div>

            {/* Recent completed */}
            <div className="flex-1 bg-card border border-section-divider rounded-lg p-3 min-h-0 flex flex-col">
              <div className="flex items-center gap-1.5 mb-2 shrink-0">
                <CheckCircle className="w-3 h-3 text-[var(--color-success)]/30" />
                <span className="text-[9px] font-mono text-foreground/20 uppercase tracking-wider">Recent Completed</span>
                <span className="text-[9px] font-mono text-foreground/15 ml-auto">{recentCompleted.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-hide space-y-0.5">
                {recentCompleted.length > 0 ? recentCompleted.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-card transition-colors">
                    <div className={`w-4 h-4 rounded flex items-center justify-center text-[7px] font-black ${
                      o.type === "buy" ? "bg-primary/10 text-primary/60" : "bg-card text-foreground/25"
                    }`}>
                      {o.type === "buy" ? "B" : "S"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] font-mono text-foreground/30 truncate block">{o.orderNumber}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-foreground/40 tabular-nums shrink-0">
                      ${o.amount.toLocaleString()}
                    </span>
                    {o.feeAmount != null && o.feeAmount > 0 && (
                      <span className="text-[8px] font-mono text-primary/30 shrink-0">
                        +${o.feeAmount.toFixed(2)}
                      </span>
                    )}
                  </div>
                )) : (
                  <div className="flex-1 flex items-center justify-center text-[9px] text-foreground/10">None yet</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// ORDER CARD COMPONENT
// ============================================

function OrderCard({ order, tickCount }: { order: LiveOrder; tickCount: number }) {
  const statusConfig = getStatusConfig(order.status);
  const expiresIn = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000));
  const isUrgent = expiresIn > 0 && expiresIn < 120;
  const isWarning = expiresIn > 0 && expiresIn < 300;
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000));

  // Progress through trade lifecycle
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
            ${order.amount.toLocaleString()}
          </p>
          <p className="text-[10px] font-mono text-foreground/20 tabular-nums">
            {order.fiatAmount?.toLocaleString()} AED
          </p>
        </div>

        {/* Fee */}
        {order.feeAmount != null && order.feeAmount > 0 && (
          <div className="text-right shrink-0 pl-2 border-l border-section-divider">
            <p className="text-[10px] font-mono text-primary/50">FEE</p>
            <p className="text-xs font-bold font-mono tabular-nums text-primary/70">
              ${order.feeAmount.toFixed(2)}
            </p>
            <p className="text-[9px] font-mono text-foreground/15">{order.feePercentage}%</p>
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
