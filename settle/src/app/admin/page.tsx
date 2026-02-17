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
  LogOut,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
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

const formatTimeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
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
// CIRCULAR GAUGE
// ============================================

const CircularGauge = ({ value, size = 56 }: { value: number; size?: number }) => {
  const strokeWidth = 4.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min((value / 100) * circumference, circumference);
  const color = value >= 90 ? "#22c55e" : value >= 70 ? "#f97316" : "#ef4444";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={{ filter: `drop-shadow(0 0 6px ${color}50)` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-black font-mono tabular-nums text-white/80">
          {value.toFixed(0)}%
        </span>
      </div>
    </div>
  );
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

  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState<string>("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSort, setOrderSort] = useState<string>("newest");

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  const { playSound } = useSounds();
  const { subscribe, unsubscribe, isConnected } = usePusher();

  useEffect(() => { setMounted(true); }, []);

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
        fetch("/api/admin/activity?limit=30", { headers }),
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

  const activeOrders = orders.filter((o) => ["accepted", "escrowed", "payment_sent", "payment_confirmed"].includes(o.status));
  const recentCompleted = orders
    .filter((o) => ["completed", "cancelled", "expired"].includes(o.status))
    .sort((a, b) => new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime())
    .slice(0, 30);

  const statusCounts = {
    all: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    active: activeOrders.length,
    completed: orders.filter((o) => o.status === "completed").length,
    cancelled: orders.filter((o) => ["cancelled", "expired"].includes(o.status)).length,
    disputed: orders.filter((o) => o.status === "disputed").length,
  };

  const totalFilteredVolume = filteredOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalFilteredFees = filteredOrders.reduce((sum, o) => sum + (o.feeAmount || 0), 0);

  // ============================================
  // LOADING GATE
  // ============================================

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
          <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Authenticating</span>
        </div>
      </div>
    );
  }

  // ============================================
  // LOGIN SCREEN
  // ============================================

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-orange-500/[0.03] rounded-full blur-[128px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-orange-600/[0.02] rounded-full blur-[128px] pointer-events-none" />

        <div className="relative w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/20 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-orange-500/10 animate-float">
              <Shield className="w-8 h-8 text-orange-400" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <Zap className="w-5 h-5 text-white fill-white" />
              <span className="text-[17px]">
                <span className="font-bold text-white">Blip</span>{" "}
                <span className="italic text-white/90">money</span>
              </span>
            </div>
            <p className="text-[11px] text-white/25 font-mono uppercase tracking-[0.2em]">Admin Console</p>
          </div>

          <div className="relative p-[1px] rounded-2xl bg-gradient-to-b from-white/[0.1] to-white/[0.02]">
            <div className="bg-[#0a0a0a] rounded-2xl p-6 space-y-4">
              {adminLoginError && (
                <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-400 flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  {adminLoginError}
                </div>
              )}
              <div>
                <label className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1.5 block">Username</label>
                <input
                  type="text"
                  placeholder="admin"
                  value={adminLoginForm.username}
                  onChange={(e) => setAdminLoginForm({ ...adminLoginForm, username: e.target.value })}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-white/15 focus:border-orange-500/30 focus:outline-none focus:bg-white/[0.04] transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1.5 block">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={adminLoginForm.password}
                  onChange={(e) => setAdminLoginForm({ ...adminLoginForm, password: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-white/15 focus:border-orange-500/30 focus:outline-none focus:bg-white/[0.04] transition-all"
                />
              </div>
              <button
                onClick={handleAdminLogin}
                disabled={isAdminLoggingIn || !adminLoginForm.username || !adminLoginForm.password}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-bold hover:from-orange-400 hover:to-orange-500 transition-all disabled:opacity-20 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20"
              >
                {isAdminLoggingIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  "Sign In"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // MAIN DASHBOARD
  // ============================================

  const hourlyData = stats?.hourlyData || [];
  const maxHourlyCount = Math.max(...hourlyData.map((h) => h.count), 1);

  return (
    <div className="hidden md:flex md:flex-col h-screen overflow-hidden">

      {/* ===== HEADER — matches merchant dashboard ===== */}
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="h-[50px] flex items-center px-4 gap-3">
          {/* Logo — same as merchant */}
          <div className="flex items-center shrink-0">
            <Link href="/admin" className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-white fill-white" />
              <span className="text-[17px] leading-none whitespace-nowrap hidden lg:block">
                <span className="font-bold text-white">Blip</span>{" "}
                <span className="italic text-white/90">money</span>
              </span>
            </Link>
          </div>

          {/* Center: Nav pills */}
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-[3px]">
              <Link
                href="/admin"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-white/[0.08] text-white transition-colors"
              >
                Console
              </Link>
              <Link
                href="/admin/live"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                Live Feed
              </Link>
              <Link
                href="/merchant"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                Merchant
              </Link>
            </nav>
          </div>

          {/* Right: Live badge + actions */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
              <div className="w-2 h-2 rounded-full bg-emerald-500/60 animate-pulse" />
              <span className="text-[9px] font-mono font-bold text-white/40 uppercase tracking-wider">Live</span>
              {stats && (
                <>
                  <span className="text-white/[0.08]">|</span>
                  <span className="text-[9px] font-mono text-white/30">{stats.txPerMinute?.toFixed(1)}/min</span>
                </>
              )}
            </div>

            <span className="text-[9px] font-mono text-white/20 tabular-nums">
              {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
            </span>

            <button
              onClick={fetchData}
              disabled={isRefreshing}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
            >
              <RefreshCw className={`w-[18px] h-[18px] text-white/40 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>

            <div className="w-px h-6 bg-white/[0.06] mx-0.5" />

            <button
              onClick={handleAdminLogout}
              className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
              title="Logout"
            >
              <LogOut className="w-[18px] h-[18px] text-white/40" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== 4-PANEL RESIZABLE LAYOUT — matches merchant ===== */}
      <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">

        {/* ===== LEFT PANEL: Platform Stats + Real-time ===== */}
        <Panel defaultSize={24} minSize={16} maxSize={35} id="left">
          <div className="flex flex-col h-full bg-[#060606] overflow-y-auto p-2 gap-2">

            {/* Widget 1: Platform Stats Hero */}
            <div className="glass-card rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.06]" style={{ minHeight: "260px" }}>
              {/* Live ticker strip — matches merchant StatusCard */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-white/[0.02] border-b border-white/[0.04] text-[9px] font-mono relative overflow-hidden">
                <div className="absolute inset-0 shimmer pointer-events-none" />
                <div className="flex items-center gap-4 relative z-10">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-live-dot" />
                    <span className="text-orange-400/80 font-bold tracking-wide">ADMIN</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-white/25">TX/H <span className="text-white/70 font-bold">{stats?.txPerHour || 0}</span></span>
                    <span className="text-white/25">WIN <span className="text-white/70 font-bold">{stats?.successRate?.toFixed(0) || 0}%</span></span>
                    <span className="text-white/25">MER <span className="text-white/70 font-bold">{stats?.activeMerchants ?? 0}/{stats?.totalMerchants ?? 0}</span></span>
                  </div>
                </div>
              </div>

              {/* Big balance hero — matches merchant style */}
              <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-24 bg-orange-500/[0.03] rounded-full blur-[60px]" />
                </div>

                <div className="flex items-center gap-1.5 mb-1 relative z-10">
                  <Wallet className="w-3 h-3 text-white/20" />
                  <span className="text-[10px] text-white/30 font-mono uppercase tracking-widest">Platform Balance</span>
                </div>

                <div className="relative z-10 text-center">
                  <div className="text-4xl font-black text-white font-mono tabular-nums tracking-tight leading-none">
                    {stats?.platformBalance?.toFixed(2) || "0.00"}
                  </div>
                  <div className="text-[11px] text-white/20 font-mono mt-1 tabular-nums">
                    {stats?.escrowLocked ? `${stats.escrowLocked.toFixed(0)} locked in escrow` : "0 locked"}
                  </div>
                </div>

                {/* Revenue badge */}
                {(stats?.todayRevenue ?? 0) > 0 && (
                  <div className="mt-2.5 flex items-center gap-1 px-2 py-0.5 bg-orange-500/[0.06] border border-orange-500/15 rounded-full relative z-10">
                    <TrendingUp className="w-2.5 h-2.5 text-orange-400" />
                    <span className="text-[10px] font-bold text-orange-400 font-mono tabular-nums">
                      +{stats!.todayRevenue.toFixed(2)} USDT
                    </span>
                    <span className="text-[9px] text-orange-400/50 font-mono">today</span>
                  </div>
                )}
              </div>

              {/* Bottom stats grid */}
              <div className="px-3 pb-2.5 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="glass-card rounded-lg p-2">
                    <div className="flex items-center gap-1 mb-1">
                      <DollarSign className="w-2.5 h-2.5 text-orange-400/40" />
                      <span className="text-[9px] text-white/25 font-mono">REVENUE</span>
                    </div>
                    <span className="text-sm font-bold text-orange-400 font-mono tabular-nums">${stats?.revenue?.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="glass-card rounded-lg p-2">
                    <div className="flex items-center gap-1 mb-1">
                      <Lock className="w-2.5 h-2.5 text-orange-400/40" />
                      <span className="text-[9px] text-white/25 font-mono">ESCROW</span>
                    </div>
                    <span className={`text-sm font-bold font-mono tabular-nums ${(stats?.escrowLocked ?? 0) > 0 ? "text-orange-400" : "text-white/50"}`}>
                      ${stats?.escrowLocked?.toFixed(0) || "0"}
                    </span>
                  </div>
                  <div className="glass-card rounded-lg p-2">
                    <div className="flex items-center gap-1 mb-1">
                      <Wallet className="w-2.5 h-2.5 text-white/20" />
                      <span className="text-[9px] text-white/25 font-mono">FEES</span>
                    </div>
                    <span className="text-sm font-bold text-white/60 font-mono tabular-nums">${stats?.totalFeesCollected?.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="glass-card rounded-lg p-2">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendingUp className="w-2.5 h-2.5 text-white/20" />
                      <span className="text-[9px] text-white/25 font-mono">24H VOL</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-bold text-white/60 font-mono tabular-nums">
                        ${stats ? (stats.volume24h >= 1000 ? `${(stats.volume24h / 1000).toFixed(1)}k` : stats.volume24h.toFixed(0)) : "0"}
                      </span>
                      {stats?.volume24hChange != null && stats.volume24hChange !== 0 && (
                        <span className={`text-[8px] font-mono ${stats.volume24hChange > 0 ? "text-emerald-400/60" : "text-red-400/60"}`}>
                          {stats.volume24hChange > 0 ? "+" : ""}{stats.volume24hChange.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Trades + users row */}
                <div className="flex items-center justify-between px-1 text-[9px] font-mono text-white/20">
                  <span>{stats?.totalTrades ?? 0} trades</span>
                  <span className="text-white/10">·</span>
                  <span>{stats?.totalUsers ?? 0} users</span>
                  <span className="text-white/10">·</span>
                  <span>{stats?.openOrders ?? 0} open</span>
                </div>
              </div>
            </div>

            {/* Widget 2: Real-time Metrics */}
            <div className="glass-card rounded-xl overflow-hidden flex-1 min-h-0 border border-white/[0.06] p-3">
              {/* Success Rate with Circular Gauge */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-3.5 h-3.5 text-orange-400/50" />
                    <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Health</span>
                  </div>
                  <p className="text-lg font-black font-mono tabular-nums text-white/90">
                    {stats?.successRate?.toFixed(1) || "0"}%
                  </p>
                  <span className="text-[9px] font-mono text-white/20">~{stats?.avgTime?.toFixed(0) || "0"}s avg fill</span>
                </div>
                <CircularGauge value={stats?.successRate ?? 0} />
              </div>

              {/* Disputes alert */}
              {stats?.disputes != null && stats.disputes > 0 && (
                <div className="flex items-center gap-2 px-2.5 py-2 mb-3 bg-red-500/[0.06] border border-red-500/15 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400/60" />
                  <span className="text-[10px] text-red-400/70 font-medium">{stats.disputes} active dispute{stats.disputes > 1 ? "s" : ""}</span>
                </div>
              )}

              {/* Order Breakdown */}
              <div className="pt-2 border-t border-white/[0.04] space-y-1">
                <p className="text-[8px] text-white/20 font-mono uppercase tracking-wider mb-1.5">Order Breakdown</p>
                {Object.entries(statusCounts).filter(([k]) => k !== "all").map(([key, count]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-white/30 capitalize">{key}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            key === "active" ? "bg-orange-400/60" :
                            key === "completed" ? "bg-emerald-400/60" :
                            key === "disputed" ? "bg-red-400/60" :
                            "bg-white/10"
                          }`}
                          style={{ width: `${statusCounts.all > 0 ? (count / statusCounts.all) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono tabular-nums text-white/40 w-6 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* ===== CENTER-LEFT: Orders Table + Chart ===== */}
        <Panel defaultSize={27} minSize={18} maxSize={40} id="center-left">
          <div className="flex flex-col h-full bg-black">

            {/* Orders Table — 60% */}
            <div style={{ height: "60%" }} className="flex flex-col border-b border-white/[0.04]">
              {/* Header */}
              <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-white/20" />
                  <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">All Orders</span>
                  <span className="text-[9px] font-mono text-white/20 px-1.5 py-0.5 bg-white/[0.03] rounded">{filteredOrders.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {totalFilteredFees > 0 && (
                    <span className="text-[8px] font-mono text-orange-400/60 px-1 py-0.5 bg-orange-500/[0.06] rounded">
                      ${totalFilteredFees.toFixed(2)}
                    </span>
                  )}
                  <span className="text-[8px] font-mono text-white/20">${totalFilteredVolume.toLocaleString()}</span>
                </div>
              </div>

              {/* Filters */}
              <div className="px-3 py-1.5 border-b border-white/[0.03] flex flex-wrap items-center gap-1.5 shrink-0">
                <div className="relative flex-1 min-w-[120px] max-w-[180px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-white/15" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    className="w-full bg-white/[0.02] border border-white/[0.04] rounded-md pl-6 pr-2 py-1 text-[9px] text-white/60 font-mono placeholder:text-white/15 focus:border-white/[0.08] focus:outline-none"
                  />
                </div>

                <div className="flex gap-0.5 bg-white/[0.02] rounded-md p-0.5">
                  {(["all", "pending", "active", "completed", "cancelled", "disputed"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setOrderStatusFilter(f)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono rounded transition-colors ${
                        orderStatusFilter === f
                          ? f === "disputed" ? "bg-red-500/15 text-red-400 font-bold" :
                            f === "active" ? "bg-orange-500/10 text-orange-400 font-bold" :
                            "bg-white/[0.06] text-white/70"
                          : "text-white/25 hover:text-white/40"
                      }`}
                    >
                      {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                      <span className="ml-0.5 text-white/15">{statusCounts[f as keyof typeof statusCounts] || 0}</span>
                    </button>
                  ))}
                </div>

                <div className="flex gap-0.5">
                  {["all", "buy", "sell"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setOrderTypeFilter(t)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono rounded transition-colors ${
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

                <select
                  value={orderSort}
                  onChange={(e) => setOrderSort(e.target.value)}
                  className="bg-white/[0.02] border border-white/[0.04] rounded-md px-1.5 py-0.5 text-[8px] font-mono text-white/40 focus:outline-none cursor-pointer"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="amount-high">High $</option>
                  <option value="amount-low">Low $</option>
                </select>
              </div>

              {/* Table body */}
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                {filteredOrders.length > 0 ? filteredOrders.map((order) => {
                  const expiresIn = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000));
                  const isActive = ["accepted", "escrowed", "payment_sent", "payment_confirmed"].includes(order.status);
                  return (
                    <div
                      key={order.id}
                      className={`flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors ${
                        isActive ? "bg-orange-500/[0.01]" : ""
                      }`}
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center text-[8px] font-black shrink-0 ${
                        order.type === "buy"
                          ? "bg-orange-500/10 border border-orange-500/20 text-orange-400"
                          : "bg-white/[0.04] border border-white/[0.06] text-white/40"
                      }`}>
                        {order.type === "buy" ? "B" : "S"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono font-medium text-white/70">{order.orderNumber}</span>
                          <span className={`px-1 py-0 rounded text-[7px] font-bold border ${getStatusStyle(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[8px] text-white/25 font-mono">
                          <span className="truncate max-w-[60px]">{order.buyerMerchant || order.user}</span>
                          <ArrowRight className="w-2 h-2 text-white/10 shrink-0" />
                          <span className="truncate max-w-[60px]">{order.merchant}</span>
                          <span className="text-white/10">·</span>
                          <span className="text-white/15">{formatTimeAgo(order.createdAt)}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-[10px] font-bold font-mono tabular-nums text-white/80">${order.amount.toLocaleString()}</p>
                        {order.feeAmount ? (
                          <span className="text-[8px] font-mono text-orange-400/40">{order.feePercentage}%</span>
                        ) : (
                          <span className="text-[8px] font-mono text-white/15">{order.fiatAmount?.toLocaleString()} AED</span>
                        )}
                      </div>

                      {isActive && expiresIn > 0 && (
                        <span className={`text-[9px] font-mono font-bold tabular-nums shrink-0 px-1 py-0.5 rounded ${
                          expiresIn < 120 ? "text-red-400/80 bg-red-500/[0.06] animate-pulse" :
                          expiresIn < 300 ? "text-orange-400/70 bg-orange-500/[0.04]" :
                          "text-white/30"
                        }`}>
                          {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                  );
                }) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-white/15">
                    {orderSearch ? "No matching orders" : "No orders"}
                  </div>
                )}
              </div>
            </div>

            {/* Hourly Chart — 40% */}
            <div style={{ height: "40%" }} className="flex flex-col p-3">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-white/20" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">24h Activity</span>
                </div>
                {stats?.peakHour && (
                  <span className="text-[8px] font-mono text-white/20">
                    Peak: {stats.peakHour.hour}:00 ({stats.peakHour.count} tx)
                  </span>
                )}
              </div>

              {hourlyData.length > 0 ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 flex items-end gap-[2px]">
                    {hourlyData.slice(-24).map((data, i) => {
                      const height = (data.count / maxHourlyCount) * 100;
                      const hour = new Date(data.hour).getHours();
                      const isNow = hour === new Date().getHours();
                      const intensity = data.count / maxHourlyCount;
                      return (
                        <div
                          key={i}
                          className="flex-1 group relative flex items-end"
                          style={{ height: "100%" }}
                        >
                          <div
                            className={`w-full rounded-t-sm transition-all duration-300 ${
                              isNow ? "animate-glow-pulse" : "group-hover:opacity-100 opacity-80"
                            }`}
                            style={{
                              height: `${Math.max(height, 3)}%`,
                              background: isNow
                                ? "linear-gradient(to top, rgba(249, 115, 22, 0.4), rgba(249, 115, 22, 0.8))"
                                : `linear-gradient(to top, rgba(249, 115, 22, ${0.1 + intensity * 0.2}), rgba(249, 115, 22, ${0.2 + intensity * 0.4}))`,
                              boxShadow: isNow ? "0 0 12px rgba(249, 115, 22, 0.3)" : "none",
                            }}
                          />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-[#1a1a1a] border border-white/[0.08] rounded text-[7px] font-mono text-white/60 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                            <span className="font-bold text-white/80">{data.count}</span> tx @ {hour}:00
                            {data.volume > 0 && <span className="text-orange-400/60 ml-1">${data.volume.toFixed(0)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1.5 shrink-0">
                    <span className="text-[7px] text-white/15 font-mono">24h ago</span>
                    <span className="text-[7px] text-white/15 font-mono">12h ago</span>
                    <span className="text-[7px] text-orange-400/40 font-mono font-bold">Now</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[10px] text-white/15">No hourly data</div>
              )}
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* ===== CENTER-RIGHT: Active Orders + Recent ===== */}
        <Panel defaultSize={27} minSize={18} maxSize={40} id="center-right">
          <div className="flex flex-col h-full bg-black">

            {/* Active Orders — 50% */}
            <div style={{ height: "50%" }} className="flex flex-col border-b border-white/[0.04]">
              <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-orange-400/50" />
                  <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">Active</span>
                  {activeOrders.length > 0 && (
                    <span className="text-[9px] font-mono text-orange-400 px-1.5 py-0.5 bg-orange-500/[0.08] border border-orange-500/20 rounded animate-pulse">
                      {activeOrders.length}
                    </span>
                  )}
                </div>
                {activeOrders.length > 0 && (
                  <div className="w-2 h-2 rounded-full bg-emerald-500/60 animate-pulse" />
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide p-1.5 space-y-1">
                {activeOrders.length > 0 ? activeOrders.map((order) => {
                  const expiresIn = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000));
                  const statusProgress = order.status === "accepted" ? 25 : order.status === "escrowed" ? 50 : order.status === "payment_sent" ? 75 : 90;
                  const isUrgent = expiresIn < 120 && expiresIn > 0;
                  return (
                    <div key={order.id} className={`glass-card rounded-lg p-2.5 border transition-colors ${
                      isUrgent ? "border-red-500/15 bg-red-500/[0.02]" : "border-white/[0.04] hover:border-white/[0.08]"
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-[8px] font-black ${
                            order.type === "buy"
                              ? "bg-orange-500/10 border border-orange-500/20 text-orange-400"
                              : "bg-white/[0.04] border border-white/[0.06] text-white/40"
                          }`}>
                            {order.type === "buy" ? "B" : "S"}
                          </span>
                          <span className="text-[10px] font-mono font-medium text-white/70">{order.orderNumber}</span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold border ${getStatusStyle(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </span>
                      </div>

                      <div className="w-full h-1 bg-white/[0.04] rounded-full mb-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${isUrgent ? "bg-red-400" : "bg-gradient-to-r from-orange-500/60 to-orange-400"}`}
                          style={{ width: `${statusProgress}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-[8px] text-white/25 font-mono">
                          <span className="truncate max-w-[50px]">{order.buyerMerchant || order.user}</span>
                          <ArrowRight className="w-2 h-2 text-white/10" />
                          <span className="truncate max-w-[50px]">{order.merchant}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold font-mono tabular-nums text-white/80">${order.amount.toLocaleString()}</span>
                          {expiresIn > 0 && (
                            <span className={`text-[8px] font-mono font-bold tabular-nums ${
                              isUrgent ? "text-red-400/80 animate-pulse" : expiresIn < 300 ? "text-orange-400/70" : "text-white/25"
                            }`}>
                              {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex flex-col items-center justify-center h-full text-white/15">
                    <Zap className="w-6 h-6 mb-1.5 opacity-20" />
                    <p className="text-[10px] font-mono">No active orders</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Completed — 50% */}
            <div style={{ height: "50%" }} className="flex flex-col">
              <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400/40" />
                  <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">Recent</span>
                  <span className="text-[9px] font-mono text-white/20 px-1.5 py-0.5 bg-white/[0.03] rounded">
                    {recentCompleted.length}
                  </span>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                {recentCompleted.length > 0 ? recentCompleted.map((order) => (
                  <div key={order.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <div className="shrink-0">
                      {order.status === "completed" ? (
                        <CheckCircle className="w-3 h-3 text-emerald-400/40" />
                      ) : (
                        <XCircle className="w-3 h-3 text-white/15" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-white/50">{order.orderNumber}</span>
                        <span className={`text-[7px] font-bold ${order.type === "buy" ? "text-orange-400/40" : "text-white/20"}`}>
                          {order.type.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[8px] text-white/20 font-mono">
                        <span className="truncate max-w-[60px]">{order.buyerMerchant || order.user}</span>
                        <ArrowRight className="w-2 h-2 text-white/10" />
                        <span className="truncate max-w-[60px]">{order.merchant}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[10px] font-bold font-mono tabular-nums ${order.status === "completed" ? "text-white/60" : "text-white/20"}`}>
                        ${order.amount.toLocaleString()}
                      </p>
                      <span className="text-[8px] font-mono text-white/15">
                        {formatTimeAgo(order.completedAt || order.createdAt)}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-white/15">No recent activity</div>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* ===== RIGHT PANEL: Merchants + Activity ===== */}
        <Panel defaultSize={22} minSize={15} maxSize={35} id="right">
          <div className="flex flex-col h-full bg-[#060606] overflow-hidden">

            {/* Top Merchants */}
            <div style={{ maxHeight: "50%" }} className="flex flex-col border-b border-white/[0.04] overflow-hidden shrink-0">
              <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
                <div className="flex items-center gap-2">
                  <Crown className="w-3.5 h-3.5 text-orange-400/40" />
                  <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">Top Merchants</span>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide p-1.5">
                {merchants.length > 0 ? merchants.slice(0, 10).map((m, i) => (
                  <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
                    <span className={`w-4 text-right text-[9px] font-mono font-bold shrink-0 ${
                      i === 0 ? "text-orange-400" : i < 3 ? "text-white/40" : "text-white/15"
                    }`}>
                      {i + 1}
                    </span>
                    <span className="text-sm shrink-0">{m.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-white/60 truncate">{m.name}</p>
                      <div className="flex items-center gap-1">
                        <Star className="w-2 h-2 text-orange-400/40 fill-orange-400/40" />
                        <span className="text-[8px] font-mono text-white/25">{m.rating.toFixed(1)}</span>
                        <span className="text-[8px] text-white/10">·</span>
                        <span className="text-[8px] font-mono text-white/20">{m.trades}t</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[9px] font-mono font-bold text-white/50 tabular-nums">
                        ${m.volume >= 1000 ? `${(m.volume / 1000).toFixed(0)}k` : m.volume.toFixed(0)}
                      </span>
                    </div>
                    {m.isOnline && (
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    )}
                  </div>
                )) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-white/15">No merchants</div>
                )}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-white/20" />
                    <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">Activity</span>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-emerald-500/60 animate-pulse" />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide p-1.5 space-y-0.5">
                {activities.length > 0 ? activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
                    <div className="mt-0.5 shrink-0">
                      {a.status === "success" ? <CheckCircle className="w-2.5 h-2.5 text-emerald-400/40" /> :
                       a.status === "warning" ? <AlertTriangle className="w-2.5 h-2.5 text-orange-400/40" /> :
                       a.status === "error" ? <XCircle className="w-2.5 h-2.5 text-red-400/40" /> :
                       <Activity className="w-2.5 h-2.5 text-white/15" />}
                    </div>
                    <p className="text-[9px] text-white/40 flex-1 leading-relaxed">{a.message}</p>
                    <span className="text-[7px] font-mono text-white/15 shrink-0">{a.time}</span>
                  </div>
                )) : (
                  <div className="flex flex-col items-center justify-center h-full text-white/15">
                    <Radio className="w-6 h-6 mb-1.5 opacity-20" />
                    <p className="text-[10px] font-mono">No activity</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>

      </PanelGroup>
    </div>
  );
}
