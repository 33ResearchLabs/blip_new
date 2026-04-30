"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Shield,
  Zap,
  RefreshCw,
  Search,
  ArrowRight,
  LogOut,
  Radio,
  Filter,
  XCircle,
  Lock,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { ADMIN_COOKIE_SENTINEL } from "@/lib/api/adminSession";

// ============================================
// TYPES
// ============================================

interface StatsData {
  totalTrades: number;
  openOrders: number;
  volume24h: number;
  disputes: number;
  successRate: number;
  avgTime: number;
  escrowLocked: number;
  activeMerchants: number;
  txPerMinute: number;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  user: string;
  merchant: string;
  buyerMerchant: string | null;
  amount: number;
  fiatAmount: number;
  status: string;
  type: string;
  createdAt: string;
  completedAt: string | null;
}

interface Alert {
  id: string;
  timestamp: string;
  type: "rapid_order" | "multi_claim" | "payment_retry" | "auth_velocity";
  severity: "HIGH" | "MEDIUM";
  message: string;
  metadata: Record<string, unknown>;
}

// ============================================
// HELPERS
// ============================================

const formatTimeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

const formatAmount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
};

const getStatusStyle = (status: string) => {
  switch (status) {
    case "completed":
      return "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]";
    case "pending":
      return "bg-card border-border text-foreground/40";
    case "accepted":
    case "escrowed":
    case "payment_sent":
    case "payment_confirmed":
      return "bg-primary/10 border-primary/20 text-primary";
    case "cancelled":
    case "expired":
      return "bg-card border-section-divider text-foreground/20";
    case "disputed":
      return "bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]";
    default:
      return "bg-card border-border text-foreground/40";
  }
};

const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    pending: "PENDING", accepted: "ACCEPTED", escrow_pending: "ESCROW…",
    escrowed: "ESCROWED", payment_pending: "PAY…", payment_sent: "PAID",
    payment_confirmed: "CONFIRMED", releasing: "RELEASING", completed: "DONE",
    cancelled: "CANCELLED", disputed: "DISPUTED", expired: "EXPIRED",
  };
  return labels[status] || status.toUpperCase();
};

const getAlertIcon = (type: Alert["type"]) => {
  switch (type) {
    case "rapid_order": return <Zap size={14} />;
    case "multi_claim": return <Lock size={14} />;
    case "payment_retry": return <RefreshCw size={14} />;
    case "auth_velocity": return <Shield size={14} />;
  }
};

const getAlertLabel = (type: Alert["type"]) => {
  switch (type) {
    case "rapid_order": return "Rapid Orders";
    case "multi_claim": return "Multi Claim";
    case "payment_retry": return "Payment Retry";
    case "auth_velocity": return "Auth Velocity";
  }
};

// ============================================
// CIRCULAR GAUGE
// ============================================

const CircularGauge = ({ value, size = 48 }: { value: number; size?: number }) => {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min((value / 100) * circumference, circumference);
  const color = value >= 90 ? "#22c55e" : value >= 70 ? "#f97316" : "#ef4444";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={circumference - progress} strokeLinecap="round"
          className="transition-all duration-1000 ease-out" style={{ filter: `drop-shadow(0 0 6px ${color}50)` }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-black font-mono tabular-nums text-foreground/80">{value.toFixed(0)}%</span>
      </div>
    </div>
  );
};

// ============================================
// MAIN PAGE
// ============================================

export default function MonitorPage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [stats, setStats] = useState<StatsData | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [alertSeverity, setAlertSeverity] = useState<"all" | "HIGH" | "MEDIUM">("all");

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = adminToken;

  useEffect(() => { setMounted(true); }, []);

  // ── Auth ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const check = async () => {
      try {
        const legacyToken = localStorage.getItem("blip_admin_token");
        const headers: Record<string, string> = {};
        if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;
        const res = await fetchWithAuth("/api/auth/admin", { headers });
        const data = await res.json();
        if (data.success && data.data?.valid) {
          setAdminToken(ADMIN_COOKIE_SENTINEL);
          setIsAuthenticated(true);
          if (legacyToken) localStorage.removeItem("blip_admin_token");
        } else {
          localStorage.removeItem("blip_admin");
          localStorage.removeItem("blip_admin_token");
        }
      } catch {
        localStorage.removeItem("blip_admin");
        localStorage.removeItem("blip_admin_token");
      } finally {
        setIsCheckingSession(false);
      }
    };
    check();
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetchWithAuth("/api/auth/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (data.success && data.data?.admin) {
        localStorage.setItem("blip_admin", JSON.stringify(data.data.admin));
        setAdminToken(ADMIN_COOKIE_SENTINEL);
        setIsAuthenticated(true);
      } else {
        setLoginError(data.error || "Login failed");
      }
    } catch {
      setLoginError("Connection failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try { await fetchWithAuth("/api/auth/admin/logout", { method: "POST" }); } catch { /* ignore */ }
    localStorage.removeItem("blip_admin");
    setAdminToken(null);
    setIsAuthenticated(false);
  };

  // ── Data Fetching ────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    // Auth cookie auto-attached on same-origin requests.
    setIsRefreshing(true);
    try {
      const [statsRes, ordersRes, alertsRes] = await Promise.all([
        fetchWithAuth("/api/admin/stats"),
        fetchWithAuth("/api/admin/orders?limit=200"),
        fetchWithAuth("/api/admin/alerts?limit=100"),
      ]);
      const [statsData, ordersData, alertsData] = await Promise.all([
        statsRes.json(), ordersRes.json(), alertsRes.json(),
      ]);
      if (statsData.success) setStats(statsData.data);
      if (ordersData.success) setOrders(ordersData.data);
      if (alertsData.success) setAlerts(alertsData.data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Monitor fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchData();
  }, [isAuthenticated, fetchData]);

  useEffect(() => {
    if (!isAuthenticated || !autoRefresh) return;
    const interval = setInterval(fetchData, 8000); // 8s polling
    return () => clearInterval(interval);
  }, [isAuthenticated, autoRefresh, fetchData]);

  // ── Filters ──────────────────────────────────────────────────────────

  const filteredOrders = orders
    .filter((o) => statusFilter === "all" || o.status === statusFilter)
    .filter((o) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        o.id.toLowerCase().includes(q) ||
        o.orderNumber?.toLowerCase().includes(q) ||
        o.user?.toLowerCase().includes(q) ||
        o.merchant?.toLowerCase().includes(q) ||
        (o.buyerMerchant && o.buyerMerchant.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filteredAlerts = alerts.filter(
    (a) => alertSeverity === "all" || a.severity === alertSeverity
  );

  // Computed metrics
  const activeOrders = orders.filter((o) =>
    ["pending", "accepted", "escrowed", "payment_sent", "payment_confirmed", "releasing"].includes(o.status)
  ).length;
  const disputedOrders = orders.filter((o) => o.status === "disputed").length;

  // ── Loading ──────────────────────────────────────────────────────────

  if (!mounted || isCheckingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Login Screen ─────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-full max-w-sm p-8 bg-card border border-border rounded-xl">
          <div className="flex items-center gap-2 mb-6">
            <Shield size={20} className="text-primary" />
            <h1 className="text-lg font-bold text-foreground">Monitor Access</h1>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Username"
              value={loginForm.username}
              onChange={(e) => setLoginForm((f) => ({ ...f, username: e.target.value }))}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary"
            />
            <input
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary"
            />
            {loginError && <p className="text-xs text-[var(--color-error)]">{loginError}</p>}
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {isLoggingIn ? "Authenticating…" : "Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────

  const statusTabs = [
    { key: "all", label: "All" },
    { key: "escrowed", label: "Escrowed" },
    { key: "payment_sent", label: "Payment Sent" },
    { key: "disputed", label: "Disputed" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 h-12 flex items-center justify-between">
          {/* Left: Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <Radio size={14} className="text-[var(--color-success)] animate-pulse" />
            <span className="text-sm font-bold">Admin</span>
            {autoRefresh && (
              <span className="text-[10px] text-foreground/30 font-mono">
                {isRefreshing ? "syncing…" : `${formatTimeAgo(lastRefresh.toISOString())} ago`}
              </span>
            )}
          </div>

          {/* Center: Nav pills */}
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              <Link href="/admin" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Console</Link>
              <Link href="/admin/live" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Live Feed</Link>              <Link href="/admin/access-control" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Access Control</Link>
              <Link href="/admin/accounts" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Accounts</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors">Monitor</Link>
              <Link href="/admin/observability" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Observability</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2 py-1 rounded text-[10px] font-mono ${autoRefresh ? "bg-[var(--color-success)]/10 text-[var(--color-success)]" : "bg-card text-foreground/40"}`}
            >
              {autoRefresh ? "LIVE" : "PAUSED"}
            </button>
            <button onClick={fetchData} className="p-1 text-foreground/30 hover:text-foreground">
              <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
            </button>
            <button onClick={handleLogout} className="p-1 text-foreground/30 hover:text-foreground">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        {/* ── Metrics Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          <MetricCard label="Orders Today" value={stats?.totalTrades ?? 0} icon={<Activity size={14} />} />
          <MetricCard label="Active" value={activeOrders} icon={<Zap size={14} />} accent="primary" />
          <MetricCard label="Disputed" value={disputedOrders} icon={<AlertTriangle size={14} />} accent={disputedOrders > 0 ? "error" : undefined} />
          <MetricCard label="Escrow Locked" value={`$${formatAmount(stats?.escrowLocked ?? 0)}`} icon={<Lock size={14} />} />
          <MetricCard label="Volume 24h" value={`$${formatAmount(stats?.volume24h ?? 0)}`} icon={<TrendingUp size={14} />} />
          <MetricCard label="Merchants" value={stats?.activeMerchants ?? 0} icon={<Shield size={14} />} />
          <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
            <CircularGauge value={stats?.successRate ?? 0} size={40} />
            <div>
              <div className="text-[10px] text-foreground/40 uppercase tracking-wider">Success</div>
              <div className="text-xs font-mono font-bold text-foreground/80">
                {stats?.avgTime ? `~${Math.round(stats.avgTime / 60)}m avg` : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main Grid: Orders + Alerts ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* ── Orders Table (2/3) ── */}
          <div className="xl:col-span-2 bg-card border border-border rounded-lg flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
            {/* Toolbar */}
            <div className="p-3 border-b border-border space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold flex items-center gap-1.5">
                  <Activity size={14} className="text-primary" />
                  Live Orders
                  <span className="text-[10px] text-foreground/30 font-mono ml-1">{filteredOrders.length}</span>
                </h2>
              </div>
              {/* Status tabs */}
              <div className="flex items-center gap-1 flex-wrap">
                {statusTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      statusFilter === tab.key
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-foreground/40 hover:text-foreground/60"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <Search size={12} className="text-foreground/30" />
                  <input
                    type="text"
                    placeholder="Search ID, user, merchant…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    maxLength={100}
                    className="w-40 bg-transparent border-none text-xs text-foreground placeholder:text-foreground/20 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1 scrollbar-hide">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-foreground/30 text-[10px] uppercase tracking-wider">
                    <th className="text-left px-3 py-2 font-medium">Order</th>
                    <th className="text-left px-3 py-2 font-medium">User</th>
                    <th className="text-left px-3 py-2 font-medium">Merchant</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                    <th className="text-center px-3 py-2 font-medium">Status</th>
                    <th className="text-right px-3 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredOrders.slice(0, 100).map((order) => (
                    <tr key={order.id} className="hover:bg-foreground/[0.02] transition-colors">
                      <td className="px-3 py-2">
                        <div className="font-mono text-foreground/60">{order.orderNumber || order.id.slice(0, 8)}</div>
                        <div className="text-[10px] text-foreground/20">{order.type.toUpperCase()}</div>
                      </td>
                      <td className="px-3 py-2 text-foreground/50 font-mono">
                        {order.user ? order.user.slice(0, 8) + "…" : "—"}
                      </td>
                      <td className="px-3 py-2 text-foreground/50 font-mono">
                        {order.merchant ? order.merchant.slice(0, 8) + "…" : (
                          <span className="text-foreground/20 italic">unclaimed</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground/70">
                        <div>{formatAmount(order.amount)} <span className="text-foreground/20">USDT</span></div>
                        {order.fiatAmount > 0 && (
                          <div className="text-[10px] text-foreground/20">{formatAmount(order.fiatAmount)} AED</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${getStatusStyle(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-foreground/30 font-mono text-[10px]">
                        {formatTimeAgo(order.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-foreground/20 text-xs">
                        No orders match filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Alerts Panel (1/3) ── */}
          <div className="bg-card border border-border rounded-lg flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
            <div className="p-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold flex items-center gap-1.5">
                  <Shield size={14} className="text-[var(--color-error)]" />
                  Security Alerts
                  {filteredAlerts.length > 0 && (
                    <span className="ml-1 w-5 h-5 rounded-full bg-[var(--color-error)]/20 text-[var(--color-error)] text-[10px] font-bold flex items-center justify-center">
                      {filteredAlerts.length}
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex gap-1">
                {(["all", "HIGH", "MEDIUM"] as const).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setAlertSeverity(sev)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      alertSeverity === sev
                        ? sev === "HIGH"
                          ? "bg-[var(--color-error)]/10 text-[var(--color-error)] border border-[var(--color-error)]/20"
                          : sev === "MEDIUM"
                          ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20"
                          : "bg-primary/10 text-primary border border-primary/20"
                        : "text-foreground/40 hover:text-foreground/60"
                    }`}
                  >
                    {sev === "all" ? "All" : sev}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 scrollbar-hide">
              {filteredAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-foreground/20">
                  <CheckCircle size={24} className="mb-2" />
                  <span className="text-xs">No alerts — system healthy</span>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredAlerts.map((alert) => (
                    <div key={alert.id} className="px-3 py-2.5 hover:bg-foreground/[0.02] transition-colors">
                      <div className="flex items-start gap-2">
                        <div className={`mt-0.5 ${alert.severity === "HIGH" ? "text-[var(--color-error)]" : "text-[var(--color-warning)]"}`}>
                          {getAlertIcon(alert.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[10px] font-bold px-1 py-0 rounded ${
                              alert.severity === "HIGH"
                                ? "bg-[var(--color-error)]/10 text-[var(--color-error)]"
                                : "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                            }`}>
                              {alert.severity}
                            </span>
                            <span className="text-[10px] text-foreground/30">{getAlertLabel(alert.type)}</span>
                            <span className="ml-auto text-[10px] text-foreground/20 font-mono">
                              {formatTimeAgo(alert.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-foreground/60 leading-tight">{alert.message}</p>
                          {alert.metadata && (() => {
                            const m = alert.metadata;
                            return (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {!!m.userId && (
                                  <span className="text-[10px] font-mono px-1 rounded bg-foreground/[0.04] text-foreground/30">
                                    user:{String(m.userId).slice(0, 8)}
                                  </span>
                                )}
                                {!!m.orderId && (
                                  <span className="text-[10px] font-mono px-1 rounded bg-foreground/[0.04] text-foreground/30">
                                    order:{String(m.orderId).slice(0, 8)}
                                  </span>
                                )}
                                {!!m.merchantId && (
                                  <span className="text-[10px] font-mono px-1 rounded bg-foreground/[0.04] text-foreground/30">
                                    merch:{String(m.merchantId).slice(0, 8)}
                                  </span>
                                )}
                                {!!m.attemptsInWindow && (
                                  <span className="text-[10px] font-mono px-1 rounded bg-[var(--color-error)]/10 text-[var(--color-error)]">
                                    {String(m.attemptsInWindow)}x/min
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// METRIC CARD
// ============================================

function MetricCard({ label, value, icon, accent }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: "primary" | "error";
}) {
  const accentClass = accent === "error"
    ? "text-[var(--color-error)]"
    : accent === "primary"
    ? "text-primary"
    : "text-foreground/50";

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={accentClass}>{icon}</span>
        <span className="text-[10px] text-foreground/30 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-lg font-black font-mono tabular-nums ${accentClass}`}>
        {value}
      </div>
    </div>
  );
}
