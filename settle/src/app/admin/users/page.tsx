"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Zap,
  XCircle,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Star,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

// ============================================
// TYPES
// ============================================

interface UserItem {
  id: string;
  username: string;
  name: string;
  email: string;
  isPlaceholder: boolean;
  walletAddress: string | null;
  phone: string | null;
  kycStatus: string;
  kycLevel: number;
  totalTrades: number;
  volume: number;
  rating: number;
  ratingCount: number;
  balance: number;
  sinrBalance: number;
  completedCount: number;
  cancelledCount: number;
  disputesTotal: number;
  disputesRaisedByUser: number;
  disputesAgainstUser: number;
  reputationScore: number;
  createdAt: string;
  updatedAt: string;
}

type SortKey =
  | "volume" | "trades" | "rating" | "completed" | "cancelled"
  | "disputes_total" | "balance" | "reputation" | "newest" | "oldest" | "name";

// ============================================
// HELPERS
// ============================================

const PAGE_SIZE = 25;

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
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

const getKycStyle = (status: string) => {
  switch (status) {
    case "verified":
      return "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]";
    case "pending":
      return "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/20 text-[var(--color-warning)]";
    case "rejected":
      return "bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]";
    default:
      return "bg-card border-border text-foreground/40";
  }
};

// ============================================
// MAIN PAGE
// ============================================

export default function AdminUsersPage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("volume");
  const [kycFilter, setKycFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [lastActiveFilter, setLastActiveFilter] = useState("");
  const [volumeTierFilter, setVolumeTierFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [page, setPage] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Auth ──
  useEffect(() => {
    const checkSession = async () => {
      try {
        const savedToken = localStorage.getItem("blip_admin_token");
        if (savedToken) {
          const res = await fetchWithAuth("/api/auth/admin", { headers: { Authorization: `Bearer ${savedToken}` } });
          const data = await res.json();
          if (data.success && data.data?.valid) { setAdminToken(savedToken); setIsAuthenticated(true); }
          else { localStorage.removeItem("blip_admin"); localStorage.removeItem("blip_admin_token"); }
        }
      } catch { localStorage.removeItem("blip_admin"); localStorage.removeItem("blip_admin_token"); }
      finally { setIsCheckingSession(false); }
    };
    checkSession();
  }, []);

  const handleAdminLogin = async () => {
    setIsAdminLoggingIn(true); setAdminLoginError("");
    try {
      const res = await fetchWithAuth("/api/auth/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(adminLoginForm) });
      const data = await res.json();
      if (data.success && data.data?.admin && data.data?.token) {
        localStorage.setItem("blip_admin", JSON.stringify(data.data.admin));
        localStorage.setItem("blip_admin_token", data.data.token);
        setAdminToken(data.data.token); setIsAuthenticated(true);
      } else { setAdminLoginError(data.error || "Login failed"); }
    } catch { setAdminLoginError("Connection failed"); }
    finally { setIsAdminLoggingIn(false); }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem("blip_admin"); localStorage.removeItem("blip_admin_token");
    setAdminToken(null); setIsAuthenticated(false);
  };

  // ── Data ──
  const fetchUsers = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    setIsRefreshing(true); setLoading(true);
    try {
      const params = new URLSearchParams({ sort: sortBy, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (kycFilter) params.set("kyc", kycFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (riskFilter) params.set("risk", riskFilter);
      if (lastActiveFilter) params.set("last_active", lastActiveFilter);
      if (volumeTierFilter) params.set("volume_tier", volumeTierFilter);
      if (ratingFilter) params.set("rating", ratingFilter);

      const res = await fetchWithAuth(`/api/admin/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) { setUsers(data.data); setTotal(data.total || 0); setLastRefresh(new Date()); }
    } catch (err) { console.error("Failed to fetch users:", err); }
    finally { setLoading(false); setIsRefreshing(false); }
  }, [sortBy, kycFilter, debouncedSearch, page, riskFilter, lastActiveFilter, volumeTierFilter, ratingFilter]);

  useEffect(() => { if (isAuthenticated) fetchUsers(); }, [isAuthenticated, fetchUsers]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Loading ──
  if (!mounted || isCheckingSession) {
    return (<div className="h-screen bg-background flex items-center justify-center"><div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" /></div>);
  }

  // ── Login ──
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-primary/[0.03] rounded-full blur-[128px] pointer-events-none" />
        <div className="relative w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/20 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary/10">
              <Users className="w-8 h-8 text-primary" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <Zap className="w-5 h-5 text-foreground fill-foreground" />
              <span className="text-[17px]"><span className="font-bold text-foreground">Blip</span>{" "}<span className="italic text-foreground/90">money</span></span>
            </div>
            <p className="text-[11px] text-foreground/25 font-mono uppercase tracking-[0.2em]">User Directory</p>
          </div>
          <div className="relative p-[1px] rounded-2xl bg-gradient-to-b from-foreground/[0.1] to-foreground/[0.02]">
            <div className="bg-card-solid rounded-2xl p-6 space-y-4">
              {adminLoginError && (<div className="px-3 py-2.5 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-xl text-[11px] text-[var(--color-error)] flex items-center gap-2"><XCircle className="w-3.5 h-3.5 shrink-0" />{adminLoginError}</div>)}
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">Username</label>
                <input type="text" placeholder="admin" value={adminLoginForm.username} onChange={(e) => setAdminLoginForm({ ...adminLoginForm, username: e.target.value })}
                  maxLength={100}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all" />
              </div>
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">Password</label>
                <input type="password" placeholder="••••••••" value={adminLoginForm.password} onChange={(e) => setAdminLoginForm({ ...adminLoginForm, password: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  maxLength={100}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all" />
              </div>
              <button onClick={handleAdminLogin} disabled={isAdminLoggingIn || !adminLoginForm.username || !adminLoginForm.password}
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
  // MAIN
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
                <span className="font-bold text-foreground">Blip</span>{" "}<span className="italic text-foreground/90">money</span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              <Link href="/admin" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Console</Link>
              <Link href="/admin/live" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Live Feed</Link>              <Link href="/admin/access-control" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Access Control</Link>
              <Link href="/admin/accounts" className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors">Accounts</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Monitor</Link>
              <Link href="/admin/error-logs" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Error Logs</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Users className="w-3 h-3 text-foreground/30" />
              <span className="text-[9px] font-mono text-foreground/30">{total} users</span>
            </div>
            <span className="text-[9px] font-mono text-foreground/20 tabular-nums">{mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}</span>
            <button onClick={fetchUsers} disabled={isRefreshing} className="p-2 rounded-lg transition-all bg-card hover:bg-accent-subtle border border-border">
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
      <div className="flex-1 overflow-hidden flex flex-col bg-background">

        {/* ── Stats Strip ── */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-section-divider text-[9px] font-mono relative overflow-hidden shrink-0">
          <div className="absolute inset-0 shimmer pointer-events-none" />
          <div className="flex items-center gap-4 relative z-10">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-primary/60" />
              <span className="text-primary/80 font-bold tracking-wide">USERS</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-foreground/25">TOTAL <span className="text-foreground/70 font-bold">{total}</span></span>
            </div>
          </div>
        </div>

        {/* ── Filters Row 1 ── */}
        <div className="px-3 py-2 border-b border-section-divider flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-[140px] max-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/25" />
            <input type="text" placeholder="Search name, email, wallet..." value={search} onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
              className="w-full bg-card border border-border rounded-md pl-7 pr-2 py-1.5 text-[10px] text-foreground/70 font-mono placeholder:text-foreground/25 focus:border-border-strong focus:outline-none" />
          </div>

          {/* KYC pills */}
          <div className="flex gap-0.5 bg-card rounded-md p-0.5">
            {(["", "none", "pending", "verified", "rejected"] as const).map((f) => (
              <button key={f} onClick={() => { setKycFilter(f); setPage(0); }}
                className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                  kycFilter === f
                    ? f === "rejected" ? "bg-[var(--color-error)]/15 text-[var(--color-error)] font-bold" :
                      f === "verified" ? "bg-[var(--color-success)]/10 text-[var(--color-success)] font-bold" :
                      f === "pending" ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-bold" :
                      "bg-accent-subtle text-foreground/80"
                    : "text-foreground/35 hover:text-foreground/60"
                }`}>
                {f === "" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value as SortKey); setPage(0); }}
            className="bg-card border border-border rounded-md px-2 py-1 text-[10px] font-mono text-foreground/60 focus:outline-none cursor-pointer">
            <option value="volume" className="bg-card-solid text-foreground">Volume</option>
            <option value="trades" className="bg-card-solid text-foreground">Trades</option>
            <option value="rating" className="bg-card-solid text-foreground">Rating</option>
            <option value="completed" className="bg-card-solid text-foreground">Completed</option>
            <option value="cancelled" className="bg-card-solid text-foreground">Cancelled</option>
            <option value="disputes_total" className="bg-card-solid text-foreground">Disputes</option>
            <option value="balance" className="bg-card-solid text-foreground">Balance</option>
            <option value="reputation" className="bg-card-solid text-foreground">Reputation</option>
            <option value="newest" className="bg-card-solid text-foreground">Newest</option>
            <option value="oldest" className="bg-card-solid text-foreground">Oldest</option>
            <option value="name" className="bg-card-solid text-foreground">Name</option>
          </select>
        </div>

        {/* ── Filters Row 2 ── */}
        <div className="px-3 py-1.5 border-b border-section-divider flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-[var(--color-error)]/40" />
            <select value={riskFilter} onChange={(e) => { setRiskFilter(e.target.value); setPage(0); }}
              className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${riskFilter ? "border-[var(--color-error)]/30 text-[var(--color-error)]" : "border-border text-foreground/60"}`}>
              <option value="" className="bg-card-solid text-foreground">Risk: All</option>
              <option value="high_dispute" className="bg-card-solid text-foreground">High Dispute (&gt;10%)</option>
              <option value="high_cancel" className="bg-card-solid text-foreground">High Cancel (&gt;20%)</option>
              <option value="zero_trades" className="bg-card-solid text-foreground">Zero Trades</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-foreground/30" />
            <select value={lastActiveFilter} onChange={(e) => { setLastActiveFilter(e.target.value); setPage(0); }}
              className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${lastActiveFilter ? "border-primary/30 text-primary" : "border-border text-foreground/60"}`}>
              <option value="" className="bg-card-solid text-foreground">Active: All</option>
              <option value="1d" className="bg-card-solid text-foreground">Last 24h</option>
              <option value="7d" className="bg-card-solid text-foreground">Last 7d</option>
              <option value="30d" className="bg-card-solid text-foreground">Last 30d</option>
              <option value="inactive" className="bg-card-solid text-foreground">Inactive (&gt;30d)</option>
            </select>
          </div>
          <select value={volumeTierFilter} onChange={(e) => { setVolumeTierFilter(e.target.value); setPage(0); }}
            className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${volumeTierFilter ? "border-[var(--color-success)]/30 text-[var(--color-success)]" : "border-border text-foreground/60"}`}>
            <option value="" className="bg-card-solid text-foreground">Vol: All</option>
            <option value="0" className="bg-card-solid text-foreground">$0</option>
            <option value="1k" className="bg-card-solid text-foreground">&lt;$1K</option>
            <option value="10k" className="bg-card-solid text-foreground">$1K–$10K</option>
            <option value="100k" className="bg-card-solid text-foreground">$10K+</option>
          </select>
          <select value={ratingFilter} onChange={(e) => { setRatingFilter(e.target.value); setPage(0); }}
            className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${ratingFilter ? "border-primary/30 text-primary" : "border-border text-foreground/60"}`}>
            <option value="" className="bg-card-solid text-foreground">Rating: All</option>
            <option value="top" className="bg-card-solid text-foreground">4.5+ (Top)</option>
            <option value="high" className="bg-card-solid text-foreground">4.0–4.5</option>
            <option value="mid" className="bg-card-solid text-foreground">3.0–4.0</option>
            <option value="low" className="bg-card-solid text-foreground">&lt;3.0</option>
            <option value="unrated" className="bg-card-solid text-foreground">Unrated</option>
          </select>
          {(riskFilter || lastActiveFilter || volumeTierFilter || ratingFilter) && (
            <button onClick={() => { setRiskFilter(""); setLastActiveFilter(""); setVolumeTierFilter(""); setRatingFilter(""); setPage(0); }}
              className="px-2 py-1 text-[10px] font-mono font-medium text-[var(--color-error)]/70 hover:text-[var(--color-error)] rounded hover:bg-[var(--color-error)]/10 transition-colors">
              Clear filters
            </button>
          )}
        </div>

        {/* ── Table Header ── */}
        <div className="px-3 py-2 border-b border-border shrink-0 bg-card">
          <div className="grid grid-cols-[32px_1fr_72px_60px_72px_52px_52px_52px_72px_60px_56px_64px] gap-1 items-center">
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">#</span>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">User</span>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">KYC</span>
            <button onClick={() => { setSortBy("rating"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Rating {sortBy === "rating" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("volume"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Volume {sortBy === "volume" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("trades"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Trades {sortBy === "trades" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("completed"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Done {sortBy === "completed" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("cancelled"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Cancel {sortBy === "cancelled" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("disputes_total"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Disputes {sortBy === "disputes_total" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("balance"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Balance {sortBy === "balance" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button onClick={() => { setSortBy("reputation"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
              Rep {sortBy === "reputation" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right">Joined</span>
          </div>
        </div>

        {/* ── Table Body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/25">
              <Users className="w-6 h-6 mb-1.5 opacity-20" />
              <p className="text-[10px] font-mono">No users found</p>
            </div>
          ) : (
            users.map((u, i) => {
              const winRate = u.totalTrades > 0 ? ((u.completedCount / u.totalTrades) * 100).toFixed(0) : "—";
              const rank = page * PAGE_SIZE + i + 1;

              return (
                <div key={u.id}
                  className="grid grid-cols-[32px_1fr_72px_60px_72px_52px_52px_52px_72px_60px_56px_64px] gap-1 items-center px-3 py-2 border-b border-section-divider hover:bg-accent-subtle transition-colors">

                  {/* Rank */}
                  <span className={`text-[10px] font-mono font-bold ${rank === 1 ? "text-primary" : rank <= 3 ? "text-foreground/50" : "text-foreground/30"}`}>
                    {rank}
                  </span>

                  {/* User */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                      u.isPlaceholder ? "bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20 text-[var(--color-warning)]/60" : "bg-card border border-border text-foreground/40"
                    }`}>
                      {u.isPlaceholder ? "?" : (u.name || u.username || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-medium truncate ${u.isPlaceholder ? "text-foreground/30 italic" : "text-foreground/60"}`}>
                          {u.name || u.username || "Unnamed"}
                        </span>
                        {u.isPlaceholder && (
                          <span className="text-[7px] px-1 py-0.5 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)]/70 border border-[var(--color-warning)]/15 font-mono font-bold shrink-0">GHOST</span>
                        )}
                      </div>
                      <span className="text-[9px] text-foreground/30 font-mono truncate block">{u.email || (u.isPlaceholder ? u.id.slice(0, 12) : u.walletAddress?.slice(0, 12) || u.id.slice(0, 8))}</span>
                    </div>
                  </div>

                  {/* KYC */}
                  <div>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${getKycStyle(u.kycStatus)}`}>
                      {u.kycStatus.toUpperCase()}
                    </span>
                  </div>

                  {/* Rating */}
                  <div className="text-right">
                    {u.rating > 0 ? (
                      <div className="flex items-center justify-end gap-0.5">
                        <Star className="w-2 h-2 text-primary/40 fill-primary/40" />
                        <span className="text-[10px] font-mono text-foreground/60">{u.rating.toFixed(1)}</span>
                        <span className="text-[8px] text-foreground/30 font-mono">({u.ratingCount})</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-foreground/25 font-mono">—</span>
                    )}
                  </div>

                  {/* Volume */}
                  <div className="text-right">
                    <span className="text-[10px] font-mono font-bold text-foreground/50 tabular-nums">{formatVolume(u.volume)}</span>
                  </div>

                  {/* Trades */}
                  <div className="text-right text-[10px] font-mono text-foreground/40 tabular-nums">{u.totalTrades}</div>

                  {/* Completed */}
                  <div className="text-right">
                    <span className="text-[10px] font-mono text-[var(--color-success)]/60 tabular-nums">{u.completedCount}</span>
                    <span className="text-[8px] text-foreground/25 font-mono ml-0.5">{winRate}%</span>
                  </div>

                  {/* Cancelled */}
                  <div className="text-right">
                    <span className={`text-[10px] font-mono tabular-nums ${u.cancelledCount > 0 ? "text-primary/60" : "text-foreground/25"}`}>{u.cancelledCount}</span>
                  </div>

                  {/* Disputes */}
                  <div className="text-right">
                    <span className={`text-[10px] font-mono font-bold tabular-nums ${u.disputesTotal > 0 ? "text-[var(--color-error)]" : "text-foreground/25"}`}>
                      {u.disputesTotal}
                    </span>
                    {u.disputesTotal > 0 && (
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className="text-[8px] font-mono text-[var(--color-info)]/50" title="Raised by user">{u.disputesRaisedByUser}&#8593;</span>
                        <span className="text-[8px] font-mono text-[var(--color-error)]/50" title="Against user">{u.disputesAgainstUser}&#8595;</span>
                      </div>
                    )}
                  </div>

                  {/* Balance */}
                  <div className="text-right">
                    <span className={`text-[10px] font-mono tabular-nums ${u.balance > 0 ? "text-foreground/40" : "text-foreground/25"}`}>
                      {u.balance > 0 ? formatVolume(u.balance) : "—"}
                    </span>
                  </div>

                  {/* Reputation */}
                  <div className="text-right">
                    <span className={`text-[10px] font-mono font-bold tabular-nums ${
                      u.reputationScore >= 80 ? "text-[var(--color-success)]/70" :
                      u.reputationScore >= 50 ? "text-foreground/50" :
                      u.reputationScore > 0 ? "text-[var(--color-warning)]/70" :
                      "text-foreground/25"
                    }`}>
                      {u.reputationScore > 0 ? u.reputationScore : "—"}
                    </span>
                  </div>

                  {/* Joined */}
                  <div className="text-right text-[10px] font-mono text-foreground/40 tabular-nums">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="px-3 py-2 border-t border-border flex items-center justify-between shrink-0 bg-card">
            <span className="text-[10px] text-foreground/40 font-mono tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded transition-colors hover:bg-accent-subtle disabled:opacity-20 disabled:cursor-not-allowed">
                <ChevronLeft className="w-3 h-3 text-foreground/30" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) pageNum = i;
                else if (page < 3) pageNum = i;
                else if (page > totalPages - 4) pageNum = totalPages - 7 + i;
                else pageNum = page - 3 + i;
                return (
                  <button key={pageNum} onClick={() => setPage(pageNum)}
                    className={`w-5 h-5 rounded text-[8px] font-mono font-medium transition-all ${
                      page === pageNum ? "bg-primary/15 text-primary border border-primary/20" : "text-foreground/25 hover:text-foreground/50 hover:bg-accent-subtle"
                    }`}>
                    {pageNum + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1 rounded transition-colors hover:bg-accent-subtle disabled:opacity-20 disabled:cursor-not-allowed">
                <ChevronRight className="w-3 h-3 text-foreground/30" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
