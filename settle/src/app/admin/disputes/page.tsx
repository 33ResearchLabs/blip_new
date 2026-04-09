"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Zap,
  XCircle,
  AlertTriangle,
  Users,
  Crown,
  RefreshCw,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

// ============================================
// TYPES
// ============================================

interface DisputeParty {
  id: string;
  name: string;
  email: string;
  disputeCount: number;
  totalTrades: number;
  disputeRate: number;
  totalDisputedAmount: number;
  lastDisputedAt: string | null;
}

interface RecentDispute {
  orderNumber: string;
  amount: number;
  status: string;
  disputedAt: string;
  disputedBy: string | null;
  disputedById: string | null;
  userName: string;
  userId: string;
  merchantName: string;
  merchantId: string;
  resolution: string | null;
}

interface DisputeSummary {
  totalDisputes: number;
  totalDisputedVolume: number;
  autoResolved: number;
  activeDisputes: number;
}

// ============================================
// HELPERS
// ============================================

const formatVolume = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const formatTimeAgo = (dateStr: string | null) => {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ============================================
// MAIN PAGE
// ============================================

export default function DisputesPage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);

  const [summary, setSummary] = useState<DisputeSummary | null>(null);
  const [merchants, setMerchants] = useState<DisputeParty[]>([]);
  const [users, setUsers] = useState<DisputeParty[]>([]);
  const [recentDisputes, setRecentDisputes] = useState<RecentDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  useEffect(() => { setMounted(true); }, []);

  // ── Auth ──
  useEffect(() => {
    const checkSession = async () => {
      try {
        const savedToken = localStorage.getItem("blip_admin_token");
        if (savedToken) {
          const res = await fetchWithAuth("/api/auth/admin", {
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
      const res = await fetchWithAuth("/api/auth/admin", {
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

  // ── Data ──
  const fetchData = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    setIsRefreshing(true);
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/disputes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSummary(data.data.summary);
        setMerchants(data.data.merchants);
        setUsers(data.data.users);
        setRecentDisputes(data.data.recentDisputes);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch disputes:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchData();
  }, [isAuthenticated, fetchData]);

  // ── Loading ──
  if (!mounted || isCheckingSession) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ── Login ──
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-primary/[0.03] rounded-full blur-[128px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-primary/[0.02] rounded-full blur-[128px] pointer-events-none" />
        <div className="relative w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-error)]/20 border border-[var(--color-error)]/20 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-8 h-8 text-[var(--color-error)]" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <Zap className="w-5 h-5 text-foreground fill-foreground" />
              <span className="text-[17px]">
                <span className="font-bold text-foreground">Blip</span>{" "}
                <span className="italic text-foreground/90">money</span>
              </span>
            </div>
            <p className="text-[11px] text-foreground/25 font-mono uppercase tracking-[0.2em]">Dispute Tracker</p>
          </div>
          <div className="relative p-[1px] rounded-2xl bg-gradient-to-b from-foreground/[0.1] to-foreground/[0.02]">
            <div className="bg-card-solid rounded-2xl p-6 space-y-4">
              {adminLoginError && (
                <div className="px-3 py-2.5 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-xl text-[11px] text-[var(--color-error)] flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  {adminLoginError}
                </div>
              )}
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">Username</label>
                <input type="text" placeholder="admin" value={adminLoginForm.username}
                  onChange={(e) => setAdminLoginForm({ ...adminLoginForm, username: e.target.value })}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none transition-all" />
              </div>
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">Password</label>
                <input type="password" placeholder="••••••••" value={adminLoginForm.password}
                  onChange={(e) => setAdminLoginForm({ ...adminLoginForm, password: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none transition-all" />
              </div>
              <button onClick={handleAdminLogin}
                disabled={isAdminLoggingIn || !adminLoginForm.username || !adminLoginForm.password}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-foreground text-sm font-bold transition-all disabled:opacity-20 disabled:cursor-not-allowed shadow-lg shadow-primary/20">
                {isAdminLoggingIn ? "Signing in..." : "Sign In"}
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

  return (
    <div className="hidden md:flex md:flex-col h-screen overflow-hidden">

      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="h-[50px] flex items-center px-4 gap-3">
          <div className="flex items-center shrink-0">
            <Link href="/admin" className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-foreground fill-foreground" />
              <span className="text-[17px] leading-none whitespace-nowrap hidden lg:block">
                <span className="font-bold text-foreground">Blip</span>{" "}
                <span className="italic text-foreground/90">money</span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              <Link href="/admin" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Console</Link>
              <Link href="/admin/live" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Live Feed</Link>              <Link href="/admin/access-control" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Access Control</Link>
              <Link href="/admin/accounts" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Accounts</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Monitor</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] font-mono text-foreground/20 tabular-nums">
              {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
            </span>
            <button onClick={fetchData} disabled={isRefreshing}
              className="p-2 rounded-lg transition-all bg-card hover:bg-accent-subtle border border-border">
              <RefreshCw className={`w-[18px] h-[18px] text-foreground/40 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <div className="w-px h-6 bg-border mx-0.5" />
            <button onClick={handleAdminLogout} className="p-2 rounded-lg hover:bg-[var(--color-error)]/10 transition-colors" title="Logout">
              <LogOut className="w-[18px] h-[18px] text-foreground/40" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== CONTENT ===== */}
      <div className="flex-1 overflow-y-auto bg-background p-4 space-y-4">

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Summary Cards ── */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "TOTAL DISPUTES", value: summary?.totalDisputes ?? 0, color: "text-[var(--color-error)]" },
                { label: "ACTIVE NOW", value: summary?.activeDisputes ?? 0, color: summary?.activeDisputes ? "text-[var(--color-error)] animate-pulse" : "text-foreground/50" },
                { label: "AUTO RESOLVED", value: summary?.autoResolved ?? 0, color: "text-[var(--color-warning)]" },
                { label: "DISPUTED VOLUME", value: formatVolume(summary?.totalDisputedVolume ?? 0), color: "text-foreground/70" },
              ].map((s) => (
                <div key={s.label} className="glass-card rounded-xl p-4 border border-border">
                  <p className="text-[10px] font-mono text-foreground/30 uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-2xl font-black font-mono tabular-nums ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* ── Two Column: Merchants & Users ── */}
            <div className="grid grid-cols-2 gap-4">

              {/* Merchants with most disputes */}
              <div className="glass-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-section-divider flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[var(--color-error)]/50" />
                  <span className="text-[11px] font-bold text-foreground/60 font-mono uppercase tracking-wider">Merchants — Most Disputed</span>
                  <span className="text-[10px] font-mono text-foreground/25 ml-auto">{merchants.length}</span>
                </div>
                <div className="divide-y divide-section-divider">
                  {merchants.length > 0 ? merchants.map((m, i) => (
                    <div key={m.id} className="px-4 py-3 flex items-center gap-3 hover:bg-accent-subtle transition-colors">
                      <span className={`text-[11px] font-mono font-bold w-5 text-right ${
                        i === 0 ? "text-[var(--color-error)]" : i < 3 ? "text-foreground/50" : "text-foreground/25"
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground/70 truncate">{m.name}</p>
                        <p className="text-[10px] font-mono text-foreground/30 truncate">{m.email || m.id.slice(0, 12)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[14px] font-black font-mono text-[var(--color-error)] tabular-nums">{m.disputeCount}</p>
                        <p className="text-[9px] font-mono text-foreground/25">of {m.totalTrades} trades</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className={`text-[11px] font-bold font-mono tabular-nums ${
                          m.disputeRate > 20 ? "text-[var(--color-error)]" :
                          m.disputeRate > 10 ? "text-[var(--color-warning)]" :
                          "text-foreground/40"
                        }`}>{m.disputeRate}%</p>
                        <p className="text-[9px] font-mono text-foreground/20">rate</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-[10px] font-mono text-foreground/40 tabular-nums">{formatVolume(m.totalDisputedAmount)}</p>
                        <p className="text-[9px] font-mono text-foreground/20">{formatTimeAgo(m.lastDisputedAt)}</p>
                      </div>
                    </div>
                  )) : (
                    <div className="px-4 py-10 text-center text-foreground/20">
                      <Shield className="w-6 h-6 mx-auto mb-2 opacity-30" />
                      <p className="text-[11px] font-mono">No merchant disputes</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Users with most disputes */}
              <div className="glass-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-section-divider flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--color-error)]/50" />
                  <span className="text-[11px] font-bold text-foreground/60 font-mono uppercase tracking-wider">Users — Most Disputed</span>
                  <span className="text-[10px] font-mono text-foreground/25 ml-auto">{users.length}</span>
                </div>
                <div className="divide-y divide-section-divider">
                  {users.length > 0 ? users.map((u, i) => (
                    <div key={u.id} className="px-4 py-3 flex items-center gap-3 hover:bg-accent-subtle transition-colors">
                      <span className={`text-[11px] font-mono font-bold w-5 text-right ${
                        i === 0 ? "text-[var(--color-error)]" : i < 3 ? "text-foreground/50" : "text-foreground/25"
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground/70 truncate">{u.name}</p>
                        <p className="text-[10px] font-mono text-foreground/30 truncate">{u.email || u.id.slice(0, 12)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[14px] font-black font-mono text-[var(--color-error)] tabular-nums">{u.disputeCount}</p>
                        <p className="text-[9px] font-mono text-foreground/25">of {u.totalTrades} trades</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className={`text-[11px] font-bold font-mono tabular-nums ${
                          u.disputeRate > 20 ? "text-[var(--color-error)]" :
                          u.disputeRate > 10 ? "text-[var(--color-warning)]" :
                          "text-foreground/40"
                        }`}>{u.disputeRate}%</p>
                        <p className="text-[9px] font-mono text-foreground/20">rate</p>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-[10px] font-mono text-foreground/40 tabular-nums">{formatVolume(u.totalDisputedAmount)}</p>
                        <p className="text-[9px] font-mono text-foreground/20">{formatTimeAgo(u.lastDisputedAt)}</p>
                      </div>
                    </div>
                  )) : (
                    <div className="px-4 py-10 text-center text-foreground/20">
                      <Shield className="w-6 h-6 mx-auto mb-2 opacity-30" />
                      <p className="text-[11px] font-mono">No user disputes</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Recent Dispute Orders ── */}
            <div className="glass-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-section-divider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--color-error)]/50" />
                <span className="text-[11px] font-bold text-foreground/60 font-mono uppercase tracking-wider">All Disputed Orders</span>
                <span className="text-[10px] font-mono text-foreground/25 ml-auto">{recentDisputes.length}</span>
              </div>

              {/* Table header */}
              <div className="grid grid-cols-[100px_80px_1fr_1fr_80px_100px_1fr] gap-2 px-4 py-2 bg-card text-[9px] font-mono text-foreground/35 uppercase tracking-wider border-b border-section-divider">
                <span>Order</span>
                <span className="text-right">Amount</span>
                <span>User</span>
                <span>Merchant</span>
                <span>Raised By</span>
                <span>Status</span>
                <span>Resolution</span>
              </div>

              <div className="divide-y divide-section-divider max-h-[300px] overflow-y-auto scrollbar-hide">
                {recentDisputes.length > 0 ? recentDisputes.map((d) => (
                  <div key={d.orderNumber} className="grid grid-cols-[100px_80px_1fr_1fr_80px_100px_1fr] gap-2 px-4 py-2.5 items-center hover:bg-accent-subtle transition-colors">
                    <span className="text-[11px] font-mono text-foreground/60 font-medium">{d.orderNumber}</span>
                    <span className="text-[11px] font-mono text-foreground/60 font-bold tabular-nums text-right">${d.amount}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-foreground/60 truncate">{d.userName}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-foreground/60 truncate">{d.merchantName}</p>
                    </div>
                    <span className={`text-[10px] font-mono font-bold ${
                      d.disputedBy === "user" ? "text-[var(--color-info)]" :
                      d.disputedBy === "merchant" ? "text-primary" :
                      "text-foreground/25"
                    }`}>
                      {d.disputedBy || "system"}
                    </span>
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border w-fit ${
                      d.status === "disputed" ? "bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]" :
                      d.status === "cancelled" ? "bg-foreground/5 border-border text-foreground/40" :
                      d.status === "completed" ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]" :
                      "bg-card border-border text-foreground/40"
                    }`}>
                      {d.status.toUpperCase()}
                    </span>
                    <p className="text-[10px] font-mono text-foreground/30 truncate">
                      {d.resolution || formatTimeAgo(d.disputedAt)}
                    </p>
                  </div>
                )) : (
                  <div className="px-4 py-10 text-center text-foreground/20">
                    <AlertTriangle className="w-6 h-6 mx-auto mb-2 opacity-20" />
                    <p className="text-[11px] font-mono">No disputes recorded</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
