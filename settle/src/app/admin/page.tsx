"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  TrendingUp,
  Users,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Zap,
  DollarSign,
  Lock,
  Star,
  Crown,
  Search,
  ArrowRight,
  Wallet,
  Gauge,
  LogOut,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";

// ============================================
// TYPES
// ============================================

interface StatsData {
  totalTrades: number;
  totalTradesChange: number;
  openOrders: number;
  volume24h: number;
  volume24hChange: number;
  activeMerchants: number;
  escrowLocked: number;
  disputes: number;
  successRate: number;
  avgTime: number;
  revenue: number;
  totalUsers: number;
  totalMerchants: number;
  txPerMinute: number;
  txPerHour: number;
  todayRevenue: number;
  peakHour: { hour: number; count: number } | null;
  hourlyData: { hour: string; count: number; volume: number }[];
  platformBalance: number;
  totalFeesCollected: number;
}

interface ApiOrder {
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

interface ApiMerchant {
  id: string;
  name: string;
  emoji: string;
  isOnline: boolean;
  rating: number;
  trades: number;
  volume: number;
}

interface ApiActivity {
  id: string;
  type: string;
  message: string;
  status: string;
  time: string;
}

// ============================================
// HELPERS
// ============================================

const getUserEmoji = (name: string): string => {
  const emojis = ["🦊", "🦧", "🐋", "🦄", "🔥", "💎", "🐺", "🦁", "🐯", "🐻"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

const formatTimeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const getStatusStyle = (status: string) => {
  switch (status) {
    case "completed":
      return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
    case "pending":
      return "bg-white/[0.04] border-white/[0.06] text-white/40";
    case "accepted":
    case "escrowed":
    case "payment_sent":
    case "payment_confirmed":
      return "bg-orange-500/10 border-orange-500/20 text-orange-400";
    case "cancelled":
    case "expired":
      return "bg-white/[0.03] border-white/[0.04] text-white/20";
    case "disputed":
      return "bg-red-500/10 border-red-500/20 text-red-400";
    default:
      return "bg-white/[0.04] border-white/[0.06] text-white/40";
  }
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: "PENDING",
    accepted: "ACCEPTED",
    escrow_pending: "ESCROW…",
    escrowed: "ESCROWED",
    payment_pending: "PAY…",
    payment_sent: "PAID",
    payment_confirmed: "CONFIRMED",
    releasing: "RELEASING",
    completed: "DONE",
    cancelled: "CANCELLED",
    disputed: "DISPUTED",
    expired: "EXPIRED",
  };
  return labels[status] || status.toUpperCase();
};

// ============================================
// MAIN PAGE
// ============================================

export default function AdminConsolePage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);

  const [stats, setStats] = useState<StatsData | null>(null);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [merchants, setMerchants] = useState<ApiMerchant[]>([]);
  const [activities, setActivities] = useState<ApiActivity[]>([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState<string>("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSort, setOrderSort] = useState<string>("newest");

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  const { playSound } = useSounds();
  const { subscribe, unsubscribe, isConnected } = usePusher();

  useEffect(() => { setMounted(true); }, []);

  // Auth
  useEffect(() => {
    const checkSession = async () => {
      try {
        const savedToken = localStorage.getItem("blip_admin_token");
        if (savedToken) {
          const res = await fetch("/api/auth/admin", {
            headers: { Authorization: `Bearer ${savedToken}` },
          });
          const data = await res.json();
          if (data.success && data.data?.valid) {
            setAdminToken(savedToken);
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem("blip_admin");
            localStorage.removeItem("blip_admin_token");
          }
        }
      } catch {
        localStorage.removeItem("blip_admin");
        localStorage.removeItem("blip_admin_token");
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkSession();
  }, []);

  const handleAdminLogin = async () => {
    setIsAdminLoggingIn(true);
    setAdminLoginError("");
    try {
      const res = await fetch("/api/auth/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminLoginForm),
      });
      const data = await res.json();
      if (data.success && data.data?.admin && data.data?.token) {
        localStorage.setItem("blip_admin", JSON.stringify(data.data.admin));
        localStorage.setItem("blip_admin_token", data.data.token);
        setAdminToken(data.data.token);
        setIsAuthenticated(true);
      } else {
        setAdminLoginError(data.error || "Login failed");
      }
    } catch {
      setAdminLoginError("Connection failed");
    } finally {
      setIsAdminLoggingIn(false);
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem("blip_admin");
    localStorage.removeItem("blip_admin_token");
    setAdminToken(null);
    setIsAuthenticated(false);
  };

  // Data fetching
  const fetchData = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setIsRefreshing(true);
    try {
      const [statsRes, ordersRes, merchantsRes, activityRes] = await Promise.all([
        fetch("/api/admin/stats", { headers }),
        fetch("/api/admin/orders?limit=500", { headers }),
        fetch("/api/admin/merchants?sort=volume&limit=20", { headers }),
        fetch("/api/admin/activity?limit=20", { headers }),
      ]);
      const [statsData, ordersData, merchantsData, activityData] = await Promise.all([
        statsRes.json(), ordersRes.json(), merchantsRes.json(), activityRes.json(),
      ]);
      if (statsData.success) setStats(statsData.data);
      if (ordersData.success) setOrders(ordersData.data);
      if (merchantsData.success) setMerchants(merchantsData.data);
      if (activityData.success) setActivities(activityData.data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Admin fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchData();
  }, [isAuthenticated, fetchData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchData]);

  // Pusher
  useEffect(() => {
    if (!isConnected || !isAuthenticated) return;
    const channel = subscribe("private-admin");
    if (!channel) return;
    const handleUpdate = () => { fetchData(); playSound("notification"); };
    channel.bind("order:created", handleUpdate);
    channel.bind("order:status-updated", handleUpdate);
    return () => {
      channel.unbind("order:created", handleUpdate);
      channel.unbind("order:status-updated", handleUpdate);
      unsubscribe("private-admin");
    };
  }, [isConnected, isAuthenticated, subscribe, unsubscribe, fetchData, playSound]);

  // Filtered orders
  const filteredOrders = orders
    .filter((o) => {
      if (orderStatusFilter === "active") return ["accepted", "escrowed", "payment_sent", "payment_confirmed"].includes(o.status);
      if (orderStatusFilter !== "all") return o.status === orderStatusFilter;
      return true;
    })
    .filter((o) => orderTypeFilter === "all" || o.type === orderTypeFilter)
    .filter((o) => {
      if (!orderSearch) return true;
      const q = orderSearch.toLowerCase();
      return o.orderNumber.toLowerCase().includes(q)
        || o.user.toLowerCase().includes(q)
        || o.merchant.toLowerCase().includes(q)
        || (o.buyerMerchant && o.buyerMerchant.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (orderSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (orderSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (orderSort === "amount-high") return b.amount - a.amount;
      if (orderSort === "amount-low") return a.amount - b.amount;
      return 0;
    });

  const statusCounts = {
    all: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    active: orders.filter((o) => ["accepted", "escrowed", "payment_sent", "payment_confirmed"].includes(o.status)).length,
    completed: orders.filter((o) => o.status === "completed").length,
    cancelled: orders.filter((o) => ["cancelled", "expired"].includes(o.status)).length,
    disputed: orders.filter((o) => o.status === "disputed").length,
  };

  const totalFilteredVolume = filteredOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalFilteredFees = filteredOrders.reduce((sum, o) => sum + (o.feeAmount || 0), 0);

  // Loading / Auth gate
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-orange-400/60" />
            </div>
            <h1 className="text-lg font-bold text-white/90">Admin Console</h1>
            <p className="text-[11px] text-white/30 mt-1">Blip Money Platform</p>
          </div>

          <div className="glass-card rounded-xl p-5 space-y-3">
            {adminLoginError && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-400">
                {adminLoginError}
              </div>
            )}
            <div>
              <label className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1 block">Username</label>
              <input
                type="text"
                placeholder="admin"
                value={adminLoginForm.username}
                onChange={(e) => setAdminLoginForm({ ...adminLoginForm, username: e.target.value })}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-white/15 focus:border-orange-500/30 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1 block">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={adminLoginForm.password}
                onChange={(e) => setAdminLoginForm({ ...adminLoginForm, password: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-white/15 focus:border-orange-500/30 focus:outline-none transition-colors"
              />
            </div>
            <button
              onClick={handleAdminLogin}
              disabled={isAdminLoggingIn || !adminLoginForm.username || !adminLoginForm.password}
              className="w-full py-2.5 rounded-lg bg-orange-500 text-black text-sm font-bold hover:bg-orange-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              {isAdminLoggingIn ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Hourly chart data
  const hourlyData = stats?.hourlyData || [];
  const maxHourlyCount = Math.max(...hourlyData.map((h) => h.count), 1);

  return (
    <div className="min-h-screen bg-[#060606] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#060606]/80 backdrop-blur-2xl border-b border-white/[0.04]">
        <div className="px-4 lg:px-6 h-12 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[11px] font-black text-orange-400">
              B
            </div>
            <div>
              <p className="text-xs font-semibold text-white/80">Blip Admin</p>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-0.5 ml-3">
            <span className="px-2.5 py-1 text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-md">
              Console
            </span>
            <Link href="/admin/live" className="px-2.5 py-1 text-[10px] font-medium text-white/30 hover:text-white/50 rounded-md hover:bg-white/[0.03] transition-colors">
              Live Feed
            </Link>
            <Link href="/merchant" className="px-2.5 py-1 text-[10px] font-medium text-white/30 hover:text-white/50 rounded-md hover:bg-white/[0.03] transition-colors">
              Merchant
            </Link>
          </nav>

          <div className="flex-1" />

          {/* Status */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.03] border border-white/[0.04] rounded-md">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-[live-dot_1.5s_ease-in-out_infinite]" />
              <span className="text-[9px] font-mono text-white/30">LIVE</span>
            </div>
            <span className="text-[9px] font-mono text-white/20 hidden sm:block">
              {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
            </span>
            <button
              onClick={fetchData}
              disabled={isRefreshing}
              className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-white/30 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Logout */}
          <button onClick={handleAdminLogout} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-white/30 hover:text-white/50 hover:bg-white/[0.03] rounded-md transition-colors border-l border-white/[0.06] ml-1 pl-3">
            <LogOut className="w-3 h-3" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="px-4 lg:px-6 py-4 max-w-[1600px] mx-auto space-y-4">

        {/* ===== STAT CARDS ROW ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {[
            { label: "Trades", value: stats?.totalTrades ?? "—", change: stats?.totalTradesChange, icon: <Activity className="w-3.5 h-3.5" /> },
            { label: "Open", value: stats?.openOrders ?? "—", icon: <Clock className="w-3.5 h-3.5" />, highlight: (stats?.openOrders ?? 0) > 0 },
            { label: "24h Vol", value: stats ? (stats.volume24h >= 1000 ? `$${(stats.volume24h / 1000).toFixed(1)}k` : `$${stats.volume24h.toFixed(0)}`) : "—", change: stats?.volume24hChange, icon: <TrendingUp className="w-3.5 h-3.5" /> },
            { label: "Merchants", value: stats ? `${stats.activeMerchants}/${stats.totalMerchants}` : "—", icon: <Users className="w-3.5 h-3.5" /> },
            { label: "Escrow", value: stats ? `$${stats.escrowLocked.toFixed(0)}` : "—", icon: <Lock className="w-3.5 h-3.5" />, highlight: (stats?.escrowLocked ?? 0) > 0 },
            { label: "Revenue", value: stats ? `$${stats.revenue.toFixed(2)}` : "—", icon: <DollarSign className="w-3.5 h-3.5" /> },
            { label: "Balance", value: stats ? `$${stats.platformBalance.toFixed(2)}` : "—", icon: <Wallet className="w-3.5 h-3.5" /> },
          ].map((stat) => (
            <div key={stat.label} className={`glass-card rounded-lg p-3 ${stat.highlight ? "border-orange-500/20" : ""}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`${stat.highlight ? "text-orange-400/60" : "text-white/20"}`}>{stat.icon}</span>
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider">{stat.label}</span>
              </div>
              <div className="flex items-end justify-between">
                <span className={`text-lg font-bold font-mono tabular-nums ${stat.highlight ? "text-orange-400" : "text-white/80"}`}>
                  {stat.value}
                </span>
                {stat.change != null && stat.change !== 0 && (
                  <div className={`flex items-center gap-0.5 ${stat.change > 0 ? "text-emerald-400/60" : "text-red-400/60"}`}>
                    {stat.change > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    <span className="text-[9px] font-mono">{Math.abs(stat.change).toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ===== QUICK METRICS + HOURLY CHART ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          {/* Quick metrics */}
          <div className="glass-card rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Gauge className="w-3.5 h-3.5 text-orange-400/50" />
              <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Real-time</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2.5">
                <p className="text-[9px] text-white/25 font-mono mb-1">TX/MIN</p>
                <p className="text-xl font-black font-mono tabular-nums text-white/80">{stats?.txPerMinute?.toFixed(2) || "0.00"}</p>
              </div>
              <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2.5">
                <p className="text-[9px] text-white/25 font-mono mb-1">TX/HOUR</p>
                <p className="text-xl font-black font-mono tabular-nums text-white/80">{stats?.txPerHour || 0}</p>
              </div>
              <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2.5">
                <p className="text-[9px] text-white/25 font-mono mb-1">TODAY REV</p>
                <p className="text-xl font-black font-mono tabular-nums text-orange-400">${(stats?.todayRevenue || 0).toFixed(2)}</p>
              </div>
              <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2.5">
                <p className="text-[9px] text-white/25 font-mono mb-1">SUCCESS</p>
                <p className="text-xl font-black font-mono tabular-nums text-white/80">{stats?.successRate?.toFixed(1) || 0}%</p>
              </div>
            </div>
            {stats?.disputes != null && stats.disputes > 0 && (
              <div className="flex items-center gap-2 px-2.5 py-2 bg-red-500/[0.06] border border-red-500/15 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400/60" />
                <span className="text-[10px] text-red-400/70 font-medium">{stats.disputes} active dispute{stats.disputes > 1 ? "s" : ""}</span>
              </div>
            )}
          </div>

          {/* Hourly chart */}
          <div className="glass-card rounded-lg p-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-white/20" />
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">24h Activity</span>
              </div>
              {stats?.peakHour && (
                <span className="text-[9px] font-mono text-white/20">
                  Peak: {stats.peakHour.hour}:00 ({stats.peakHour.count} tx)
                </span>
              )}
            </div>

            {hourlyData.length > 0 ? (
              <>
                <div className="h-20 flex items-end gap-[2px]">
                  {hourlyData.slice(-24).map((data, i) => {
                    const height = (data.count / maxHourlyCount) * 100;
                    const hour = new Date(data.hour).getHours();
                    const isNow = hour === new Date().getHours();
                    return (
                      <div
                        key={i}
                        className="flex-1 group relative"
                        style={{ height: `${Math.max(height, 3)}%` }}
                      >
                        <div className={`w-full h-full rounded-t-sm transition-colors ${
                          isNow ? "bg-orange-400" : "bg-white/[0.08] group-hover:bg-white/[0.15]"
                        }`} />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-[#1a1a1a] border border-white/[0.08] rounded text-[8px] font-mono text-white/60 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                          {data.count} tx @ {hour}:00
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1.5 px-0.5">
                  <span className="text-[8px] text-white/15 font-mono">24h ago</span>
                  <span className="text-[8px] text-white/15 font-mono">12h ago</span>
                  <span className="text-[8px] text-white/15 font-mono">Now</span>
                </div>
              </>
            ) : (
              <div className="h-20 flex items-center justify-center text-[10px] text-white/15">No hourly data</div>
            )}
          </div>
        </div>

        {/* ===== ORDERS TABLE + SIDE PANELS ===== */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-2">

          {/* Orders table - 3 cols */}
          <div className="xl:col-span-3 glass-card rounded-lg">
            {/* Table header */}
            <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-white/20" />
                <span className="text-xs font-semibold text-white/70">Orders</span>
                <span className="text-[9px] font-mono text-white/20 px-1.5 py-0.5 bg-white/[0.03] rounded">
                  {filteredOrders.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {totalFilteredFees > 0 && (
                  <span className="text-[9px] font-mono text-orange-400/60 px-1.5 py-0.5 bg-orange-500/[0.06] rounded">
                    ${totalFilteredFees.toFixed(2)} fees
                  </span>
                )}
                <span className="text-[9px] font-mono text-white/20">
                  ${totalFilteredVolume.toLocaleString()} vol
                </span>
              </div>
            </div>

            {/* Filters */}
            <div className="px-4 py-2 border-b border-white/[0.03] flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 min-w-[160px] max-w-[240px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/15" />
                <input
                  type="text"
                  placeholder="Search orders..."
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="w-full bg-white/[0.02] border border-white/[0.04] rounded-md pl-7 pr-2.5 py-1.5 text-[10px] text-white/60 font-mono placeholder:text-white/15 focus:border-white/[0.08] focus:outline-none"
                />
              </div>

              {/* Status tabs */}
              <div className="flex gap-0.5 bg-white/[0.02] rounded-md p-0.5">
                {(["all", "pending", "active", "completed", "cancelled", "disputed"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setOrderStatusFilter(f)}
                    className={`px-2 py-1 text-[9px] font-mono rounded transition-colors ${
                      orderStatusFilter === f
                        ? "bg-white/[0.06] text-white/70"
                        : "text-white/25 hover:text-white/40"
                    }`}
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                    <span className="ml-1 text-white/15">{statusCounts[f as keyof typeof statusCounts] || 0}</span>
                  </button>
                ))}
              </div>

              {/* Type filter */}
              <div className="flex gap-0.5">
                {["all", "buy", "sell"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderTypeFilter(t)}
                    className={`px-2 py-1 text-[9px] font-mono rounded transition-colors ${
                      orderTypeFilter === t
                        ? t === "buy" ? "bg-orange-500/10 text-orange-400 border border-orange-500/20" :
                          t === "sell" ? "bg-white/[0.06] text-white/60 border border-white/[0.06]" :
                          "bg-white/[0.06] text-white/60"
                        : "text-white/20 hover:text-white/40"
                    }`}
                  >
                    {t === "all" ? "All" : t.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Sort */}
              <select
                value={orderSort}
                onChange={(e) => setOrderSort(e.target.value)}
                className="bg-white/[0.02] border border-white/[0.04] rounded-md px-2 py-1 text-[9px] font-mono text-white/40 focus:outline-none cursor-pointer"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="amount-high">Highest $</option>
                <option value="amount-low">Lowest $</option>
              </select>
            </div>

            {/* Table body */}
            <div className="max-h-[600px] overflow-y-auto scrollbar-hide">
              {filteredOrders.length > 0 ? filteredOrders.map((order) => {
                const expiresIn = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000));
                const isActive = ["accepted", "escrowed", "payment_sent", "payment_confirmed"].includes(order.status);
                return (
                  <div
                    key={order.id}
                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors ${
                      isActive ? "bg-orange-500/[0.01]" : ""
                    }`}
                  >
                    {/* Type badge */}
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-black shrink-0 ${
                      order.type === "buy"
                        ? "bg-orange-500/10 border border-orange-500/20 text-orange-400"
                        : "bg-white/[0.04] border border-white/[0.06] text-white/40"
                    }`}>
                      {order.type === "buy" ? "B" : "S"}
                    </div>

                    {/* Order info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono font-medium text-white/70">{order.orderNumber}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${getStatusStyle(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </span>
                        {order.spreadPreference && (
                          <span className={`px-1 py-0.5 rounded text-[8px] font-mono ${
                            order.spreadPreference === "fastest"
                              ? "text-orange-400/50"
                              : order.spreadPreference === "best"
                              ? "text-white/30"
                              : "text-white/20"
                          }`}>
                            {order.spreadPreference === "fastest" ? "FAST" : order.spreadPreference === "best" ? "BEST" : "CHEAP"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 text-[9px] text-white/25 font-mono">
                        <span className="truncate max-w-[80px]">{order.buyerMerchant || order.user}</span>
                        <ArrowRight className="w-2.5 h-2.5 text-white/10 shrink-0" />
                        <span className="truncate max-w-[80px]">{order.merchant}</span>
                        <span className="text-white/10 shrink-0">·</span>
                        <span className="text-white/15 shrink-0">{formatTimeAgo(order.createdAt)}</span>
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold font-mono tabular-nums text-white/80">
                        ${order.amount.toLocaleString()}
                      </p>
                      <div className="flex items-center gap-1 justify-end">
                        {order.feeAmount ? (
                          <span className="text-[9px] font-mono text-orange-400/40">
                            {order.feePercentage}% fee
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono text-white/15">
                            {order.fiatAmount?.toLocaleString()} AED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Timer for active orders */}
                    {isActive && expiresIn > 0 && (
                      <div className={`text-[10px] font-mono font-bold tabular-nums shrink-0 px-1.5 py-0.5 rounded ${
                        expiresIn < 120 ? "text-red-400/80 bg-red-500/[0.06]" :
                        expiresIn < 300 ? "text-orange-400/70 bg-orange-500/[0.04]" :
                        "text-white/30"
                      }`}>
                        {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="flex items-center justify-center py-16 text-[11px] text-white/15">
                  {orderSearch ? "No matching orders" : "No orders"}
                </div>
              )}
            </div>
          </div>

          {/* Side panels */}
          <div className="space-y-2">

            {/* Top Merchants */}
            <div className="glass-card rounded-lg p-3">
              <div className="flex items-center gap-2 mb-3">
                <Crown className="w-3.5 h-3.5 text-orange-400/40" />
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Top Merchants</span>
              </div>
              <div className="space-y-1">
                {merchants.length > 0 ? merchants.slice(0, 8).map((m, i) => (
                  <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
                    <span className={`w-5 text-right text-[10px] font-mono font-bold shrink-0 ${
                      i === 0 ? "text-orange-400" : i < 3 ? "text-white/40" : "text-white/15"
                    }`}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                    </span>
                    <span className="text-sm shrink-0">{m.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-white/60 truncate">{m.name}</p>
                      <div className="flex items-center gap-1">
                        <Star className="w-2.5 h-2.5 text-orange-400/40 fill-orange-400/40" />
                        <span className="text-[9px] font-mono text-white/25">{m.rating.toFixed(1)}</span>
                        <span className="text-[9px] text-white/10">·</span>
                        <span className="text-[9px] font-mono text-white/20">{m.trades} trades</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono font-bold text-white/50 tabular-nums">
                        ${m.volume >= 1000 ? `${(m.volume / 1000).toFixed(0)}k` : m.volume.toFixed(0)}
                      </span>
                    </div>
                    {m.isOnline && (
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    )}
                  </div>
                )) : (
                  <div className="py-6 text-center text-[10px] text-white/15">No merchants</div>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="glass-card rounded-lg p-3">
              <div className="flex items-center gap-2 mb-3">
                <Radio className="w-3.5 h-3.5 text-white/20" />
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Activity</span>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-[live-dot_1.5s_ease-in-out_infinite] ml-auto" />
              </div>
              <div className="space-y-1 max-h-[300px] overflow-y-auto scrollbar-hide">
                {activities.length > 0 ? activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
                    <div className="mt-0.5 shrink-0">
                      {a.status === "success" ? <CheckCircle className="w-3 h-3 text-emerald-400/40" /> :
                       a.status === "warning" ? <AlertTriangle className="w-3 h-3 text-orange-400/40" /> :
                       a.status === "error" ? <XCircle className="w-3 h-3 text-red-400/40" /> :
                       <Activity className="w-3 h-3 text-white/15" />}
                    </div>
                    <p className="text-[10px] text-white/40 flex-1 leading-relaxed">{a.message}</p>
                    <span className="text-[8px] font-mono text-white/15 shrink-0">{a.time}</span>
                  </div>
                )) : (
                  <div className="py-6 text-center text-[10px] text-white/15">No activity</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
