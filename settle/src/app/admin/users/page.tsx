"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Zap,
  XCircle,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Star,
  LogOut,
  Bell,
  Activity,
  CheckCircle,
  Database,
  TrendingUp,
  Filter,
  Upload,
  Plus,
  MoreHorizontal,
  Crown,
  Shield,
  Diamond,
  Flame,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import {
  formatCount,
  formatCrypto,
  formatPercentage,
} from "@/lib/format";

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

interface Summary {
  totalUsers: number;
  activeUsers: number;
  verifiedUsers: number;
  totalVolume: number;
  totalTrades: number;
  totalUsersDelta: number;
  totalVolumeDelta: number;
  totalTradesDelta: number;
}

type SortKey =
  | "volume" | "trades" | "rating" | "completed" | "cancelled"
  | "disputes_total" | "balance" | "reputation" | "newest" | "oldest" | "name";

// ============================================
// HELPERS
// ============================================

const PAGE_SIZES = [10, 25, 50, 100];

const formatVolumeShort = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${formatCrypto(v, { decimals: 0 })}`;
};

const formatVolumeFull = (v: number): string => `$${formatCount(Math.round(v))}`;

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

// Per-user avatar variation (deterministic from id)
const AVATAR_PALETTE = [
  { Icon: Crown,    color: "text-[var(--color-warning)]/80", bg: "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/20" },
  { Icon: Diamond,  color: "text-primary/80",                bg: "bg-primary/10 border-primary/20" },
  { Icon: Shield,   color: "text-[var(--color-info)]/80",    bg: "bg-[var(--color-info)]/10 border-[var(--color-info)]/20" },
  { Icon: Zap,      color: "text-primary/80",                bg: "bg-primary/10 border-primary/20" },
  { Icon: Sparkles, color: "text-[var(--color-warning)]/80", bg: "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/20" },
  { Icon: Flame,    color: "text-primary/80",                bg: "bg-primary/10 border-primary/20" },
];

const pickAvatar = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("volume");
  const [kycFilter, setKycFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [lastActiveFilter, setLastActiveFilter] = useState("");
  const [volumeTierFilter, setVolumeTierFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort: sortBy, limit: String(pageSize), offset: String(page * pageSize) });
      if (kycFilter) params.set("kyc", kycFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (riskFilter) params.set("risk", riskFilter);
      if (lastActiveFilter) params.set("last_active", lastActiveFilter);
      if (volumeTierFilter) params.set("volume_tier", volumeTierFilter);
      if (ratingFilter) params.set("rating", ratingFilter);

      const res = await fetchWithAuth(`/api/admin/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
        setTotal(data.total || 0);
        if (data.summary) setSummary(data.summary);
      }
    } catch (err) { console.error("Failed to fetch users:", err); }
    finally { setLoading(false); }
  }, [sortBy, kycFilter, debouncedSearch, page, pageSize, riskFilter, lastActiveFilter, volumeTierFilter, ratingFilter]);

  useEffect(() => { if (isAuthenticated) fetchUsers(); }, [isAuthenticated, fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = page * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  const allOnPageSelected = users.length > 0 && users.every((u) => selected.has(u.id));

  const togglePageSelection = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) users.forEach((u) => next.delete(u.id));
      else users.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const activePct = summary && summary.totalUsers > 0 ? (summary.activeUsers / summary.totalUsers) * 100 : 0;
  const verifiedPct = summary && summary.totalUsers > 0 ? (summary.verifiedUsers / summary.totalUsers) * 100 : 0;

  return (
    <div className="hidden md:flex md:flex-col h-screen overflow-hidden bg-background">

      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border shrink-0">
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
              <Link href="/admin/live" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Live Feed</Link>
              <Link href="/admin/access-control" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Access Control</Link>
              <Link href="/admin/accounts" className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors">Accounts</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Monitor</Link>
              <Link href="/admin/observability" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Observability</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Users className="w-3.5 h-3.5 text-foreground/40" />
              <span className="text-[11px] font-medium text-foreground/70 tabular-nums">{formatCount(summary?.totalUsers ?? total)} users</span>
            </div>
            <button className="relative p-2 rounded-lg bg-card border border-border hover:bg-accent-subtle transition-colors" aria-label="Notifications">
              <Bell className="w-[18px] h-[18px] text-foreground/50" />
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-error)] text-[8px] font-bold text-foreground flex items-center justify-center tabular-nums">12</span>
            </button>
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-card border border-border">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-[11px] font-bold text-foreground shrink-0">A</div>
              <div className="hidden xl:flex flex-col leading-tight">
                <span className="text-[11px] font-medium text-foreground/80">Admin User</span>
                <span className="text-[8px] font-mono text-foreground/40 uppercase tracking-wider">Super Admin</span>
              </div>
              <ChevronDown className="w-3 h-3 text-foreground/30 hidden xl:block" />
            </div>
            <button onClick={handleAdminLogout} className="p-2 rounded-lg hover:bg-[var(--color-error)]/10 transition-colors" title="Logout">
              <LogOut className="w-[18px] h-[18px] text-foreground/40" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== CONTENT ===== */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="p-3 flex flex-col gap-3">

          {/* ── Summary cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <SummaryCard
              label="Total Users"
              value={summary != null ? formatCount(summary.totalUsers) : "—"}
              meta={summary != null ? <DeltaText delta={summary.totalUsersDelta} /> : null}
              icon={<Users className="w-4 h-4" />}
              tone="primary"
            />
            <SummaryCard
              label="Active Users"
              value={summary != null ? formatCount(summary.activeUsers) : "—"}
              meta={summary != null ? <PctText value={activePct} suffix="of total" tone="success" /> : null}
              icon={<Activity className="w-4 h-4" />}
              tone="primary"
            />
            <SummaryCard
              label="Verified Users"
              value={summary != null ? formatCount(summary.verifiedUsers) : "—"}
              meta={summary != null ? <PctText value={verifiedPct} suffix="of total" tone="warning" /> : null}
              icon={<CheckCircle className="w-4 h-4" />}
              tone="success"
            />
            <SummaryCard
              label="Total Volume"
              value={summary != null ? formatVolumeFull(summary.totalVolume) : "—"}
              meta={summary != null ? <DeltaText delta={summary.totalVolumeDelta} /> : null}
              icon={<Database className="w-4 h-4" />}
              tone="primary"
            />
            <SummaryCard
              label="Total Trades"
              value={summary != null ? formatCount(summary.totalTrades) : "—"}
              meta={summary != null ? <DeltaText delta={summary.totalTradesDelta} /> : null}
              icon={<TrendingUp className="w-4 h-4" />}
              tone="primary"
            />
          </div>

          {/* ── Filters / actions row ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-[360px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
              <input
                type="text"
                placeholder="Search by name, email, or wallet address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
                className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-[12px] text-foreground/80 placeholder:text-foreground/30 focus:border-border-strong focus:outline-none"
              />
            </div>

            <FilterSelect
              label="Risk"
              value={riskFilter}
              onChange={(v) => { setRiskFilter(v); setPage(0); }}
              options={[
                { value: "", label: "All" },
                { value: "high_dispute", label: "High Dispute (>10%)" },
                { value: "high_cancel", label: "High Cancel (>20%)" },
                { value: "zero_trades", label: "Zero Trades" },
              ]}
              accent={riskFilter ? "error" : "default"}
            />

            <FilterSelect
              label="Status"
              value={kycFilter}
              onChange={(v) => { setKycFilter(v); setPage(0); }}
              options={[
                { value: "", label: "All" },
                { value: "verified", label: "Verified" },
                { value: "pending", label: "Pending" },
                { value: "none", label: "None" },
                { value: "rejected", label: "Rejected" },
              ]}
              accent={kycFilter === "verified" ? "success" : kycFilter === "pending" ? "warning" : kycFilter === "rejected" ? "error" : "default"}
            />

            <FilterSelect
              label="Volume"
              value={volumeTierFilter}
              onChange={(v) => { setVolumeTierFilter(v); setPage(0); }}
              options={[
                { value: "", label: "All" },
                { value: "0", label: "$0" },
                { value: "1k", label: "<$1K" },
                { value: "10k", label: "$1K–$10K" },
                { value: "100k", label: "$10K+" },
              ]}
              accent={volumeTierFilter ? "success" : "default"}
            />

            <FilterSelect
              label="Rating"
              value={ratingFilter}
              onChange={(v) => { setRatingFilter(v); setPage(0); }}
              options={[
                { value: "", label: "All" },
                { value: "top", label: "4.5+ (Top)" },
                { value: "high", label: "4.0–4.5" },
                { value: "mid", label: "3.0–4.0" },
                { value: "low", label: "<3.0" },
                { value: "unrated", label: "Unrated" },
              ]}
              accent={ratingFilter ? "primary" : "default"}
            />

            <button
              onClick={() => {
                setRiskFilter(""); setKycFilter(""); setVolumeTierFilter(""); setRatingFilter(""); setLastActiveFilter("");
                setPage(0);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border text-[12px] text-foreground/70 hover:bg-accent-subtle transition-colors"
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border text-[12px] text-foreground/70 hover:bg-accent-subtle transition-colors">
                <Upload className="w-3.5 h-3.5" />
                Export
              </button>
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20">
                <Plus className="w-3.5 h-3.5" />
                Add User
              </button>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {/* Header row */}
            <div className="px-3 py-2.5 border-b border-section-divider bg-card-solid/50">
              <div className="grid grid-cols-[28px_32px_1fr_72px_84px_88px_60px_70px_60px_72px_72px_56px_64px_100px] gap-2 items-center">
                <input type="checkbox" checked={allOnPageSelected} onChange={togglePageSelection}
                  className="w-3.5 h-3.5 rounded border-border bg-card accent-primary cursor-pointer" />
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">#</span>
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">User</span>
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">KYC</span>
                <button onClick={() => { setSortBy("rating"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider hover:text-foreground/60 flex items-center gap-0.5">
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
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right">Actions</span>
              </div>
            </div>

            {/* Body */}
            <div>
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-foreground/25">
                  <Users className="w-6 h-6 mb-1.5 opacity-20" />
                  <p className="text-[10px] font-mono">No users found</p>
                </div>
              ) : (
                users.map((u, i) => {
                  const winRate = u.totalTrades > 0 ? Math.round((u.completedCount / u.totalTrades) * 100) : null;
                  const rank = page * pageSize + i + 1;
                  const avatar = pickAvatar(u.id);
                  const AvatarIcon = avatar.Icon;
                  const isSelected = selected.has(u.id);

                  // "Active" if updated within last 30 days
                  const lastActiveMs = u.updatedAt ? Date.now() - new Date(u.updatedAt).getTime() : Infinity;
                  const isActive = lastActiveMs < 30 * 24 * 60 * 60 * 1000;

                  return (
                    <div
                      key={u.id}
                      className={`grid grid-cols-[28px_32px_1fr_72px_84px_88px_60px_70px_60px_72px_72px_56px_64px_100px] gap-2 items-center px-3 py-2 border-b border-section-divider/50 hover:bg-accent-subtle transition-colors ${isSelected ? "bg-primary/[0.04]" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(u.id)}
                        className="w-3.5 h-3.5 rounded border-border bg-card accent-primary cursor-pointer"
                      />

                      <span className={`text-[11px] font-mono tabular-nums ${rank === 1 ? "text-primary font-bold" : "text-foreground/35"}`}>{rank}</span>

                      {/* User cell */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${avatar.bg}`}>
                          <AvatarIcon className={`w-4 h-4 ${avatar.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] truncate ${u.isPlaceholder ? "text-foreground/55 font-mono" : "text-foreground/85 font-medium"}`}>
                              {u.username || u.name || "Unnamed"}
                            </span>
                            {u.isPlaceholder && (
                              <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)]/80 border border-[var(--color-warning)]/15 font-mono font-bold shrink-0">GHOST</span>
                            )}
                          </div>
                          <span className="text-[9px] text-foreground/30 font-mono truncate block">
                            {u.walletAddress
                              ? `${u.walletAddress.slice(0, 7)}...${u.walletAddress.slice(-3)}`
                              : u.email || u.id.slice(0, 8) + "...-" + u.id.slice(-3)}
                          </span>
                        </div>
                      </div>

                      {/* KYC */}
                      <div>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getKycStyle(u.kycStatus)}`}>
                          {u.kycStatus.toUpperCase()}
                        </span>
                      </div>

                      {/* Rating */}
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-[var(--color-warning)] fill-[var(--color-warning)]" />
                        <span className="text-[11px] font-medium text-foreground/80 tabular-nums">
                          {u.rating > 0 ? formatCrypto(u.rating, { decimals: 1 }) : "5.0"}
                        </span>
                        <span className="text-[9px] text-foreground/35 font-mono tabular-nums">({formatCount(u.ratingCount)})</span>
                      </div>

                      {/* Volume */}
                      <div className="text-right">
                        <span className="text-[11px] font-medium text-foreground/80 tabular-nums">{formatVolumeShort(u.volume)}</span>
                      </div>

                      {/* Trades */}
                      <div className="text-right text-[11px] text-foreground/70 tabular-nums">{formatCount(u.totalTrades)}</div>

                      {/* Done */}
                      <div className="text-right">
                        {winRate != null ? (
                          <span className="text-[11px] font-medium text-[var(--color-success)] tabular-nums">{winRate}%</span>
                        ) : (
                          <span className="text-[11px] text-foreground/25">—</span>
                        )}
                      </div>

                      {/* Cancel */}
                      <div className="text-right">
                        <span className={`text-[11px] tabular-nums ${u.cancelledCount > 0 ? "text-primary/70" : "text-foreground/30"}`}>
                          {formatCount(u.cancelledCount)}
                        </span>
                      </div>

                      {/* Disputes */}
                      <div className="text-right">
                        <span className={`text-[11px] font-medium tabular-nums ${u.disputesTotal > 0 ? "text-[var(--color-error)]" : "text-foreground/30"}`}>
                          {formatCount(u.disputesTotal)}
                        </span>
                      </div>

                      {/* Balance */}
                      <div className="text-right">
                        <span className={`text-[11px] tabular-nums ${u.balance > 0 ? "text-foreground/70" : "text-foreground/25"}`}>
                          {u.balance > 0 ? formatVolumeShort(u.balance) : "—"}
                        </span>
                      </div>

                      {/* Rep */}
                      <div className="text-right">
                        <span className={`text-[11px] font-medium tabular-nums ${
                          u.reputationScore >= 80 ? "text-[var(--color-success)]" :
                          u.reputationScore >= 50 ? "text-foreground/70" :
                          u.reputationScore > 0 ? "text-[var(--color-warning)]" :
                          "text-foreground/25"
                        }`}>
                          {u.reputationScore > 0 ? formatCount(u.reputationScore) : "—"}
                        </span>
                      </div>

                      {/* Joined */}
                      <div className="text-right text-[11px] text-foreground/50 tabular-nums">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-US", { day: "2-digit", month: "short" }) : "—"}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isActive ? "text-[var(--color-success)]" : "text-foreground/35"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[var(--color-success)]" : "bg-foreground/30"}`} />
                          {isActive ? "Active" : "Idle"}
                        </span>
                        <button className="p-1 rounded hover:bg-accent-subtle transition-colors" aria-label="Row actions">
                          <MoreHorizontal className="w-3.5 h-3.5 text-foreground/40" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            <div className="px-3 py-2.5 border-t border-section-divider flex items-center justify-between bg-card-solid/40">
              <span className="text-[11px] text-foreground/50 tabular-nums">
                {total === 0
                  ? "No users"
                  : `Showing ${formatCount(startIndex + 1)} to ${formatCount(endIndex)} of ${formatCount(total)} users`}
              </span>

              <div className="flex items-center gap-3">
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(0); }}
                  className="bg-card border border-border rounded-md px-2 py-1 text-[11px] text-foreground/70 focus:outline-none cursor-pointer"
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s} className="bg-card-solid text-foreground">{s} / page</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* breathing room for floating tab switcher */}
          <div className="h-12 shrink-0" />
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
  meta,
  icon,
  tone,
}: {
  label: string;
  value: string;
  meta: React.ReactNode;
  icon: React.ReactNode;
  tone: "primary" | "success" | "warning";
}) {
  const iconBg = tone === "success"
    ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
    : tone === "warning"
    ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
    : "bg-primary/10 text-primary";

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-mono text-foreground/40 uppercase tracking-wider">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div className="text-[24px] font-bold text-foreground tabular-nums leading-none mb-2">{value}</div>
      <div className="text-[11px] tabular-nums">{meta}</div>
    </div>
  );
}

function DeltaText({ delta }: { delta: number }) {
  const sign = delta > 0 ? "+" : "";
  const tone = delta > 0
    ? "text-[var(--color-success)]"
    : delta < 0
    ? "text-[var(--color-error)]"
    : "text-foreground/40";
  return (
    <span className={tone}>
      {sign}{formatPercentage(delta)} <span className="text-foreground/30 font-normal">vs last month</span>
    </span>
  );
}

function PctText({ value, suffix, tone }: { value: number; suffix: string; tone: "success" | "warning" }) {
  const cls = tone === "success" ? "text-[var(--color-success)]" : "text-[var(--color-warning)]";
  return (
    <span className={cls}>
      {formatPercentage(value)} <span className="text-foreground/30 font-normal">{suffix}</span>
    </span>
  );
}

// ============================================
// FILTER SELECT
// ============================================

function FilterSelect({
  label,
  value,
  onChange,
  options,
  accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  accent: "default" | "primary" | "success" | "warning" | "error";
}) {
  const accentClass = value === "" || accent === "default"
    ? "border-border text-foreground/70"
    : accent === "primary"
    ? "border-primary/30 text-primary"
    : accent === "success"
    ? "border-[var(--color-success)]/30 text-[var(--color-success)]"
    : accent === "warning"
    ? "border-[var(--color-warning)]/30 text-[var(--color-warning)]"
    : "border-[var(--color-error)]/30 text-[var(--color-error)]";

  const display = options.find((o) => o.value === value)?.label ?? "All";

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none bg-card border rounded-lg pl-3 pr-7 py-2 text-[12px] focus:outline-none cursor-pointer ${accentClass}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-card-solid text-foreground">
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/40 pointer-events-none" />
      <span className="sr-only">{display}</span>
    </div>
  );
}

// ============================================
// PAGINATION
// ============================================

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const buildPages = (): (number | "ellipsis")[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    const pages: (number | "ellipsis")[] = [];
    pages.push(0);
    if (page > 2) pages.push("ellipsis");
    const start = Math.max(1, page - 1);
    const end = Math.min(totalPages - 2, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 3) pages.push("ellipsis");
    pages.push(totalPages - 1);
    return pages;
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="w-7 h-7 rounded-md flex items-center justify-center border border-border bg-card hover:bg-accent-subtle disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5 text-foreground/50" />
      </button>
      {buildPages().map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e-${i}`} className="w-7 h-7 flex items-center justify-center text-[11px] text-foreground/30">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`w-7 h-7 rounded-md text-[11px] font-medium transition-colors ${
              p === page
                ? "bg-primary text-foreground shadow-sm shadow-primary/20"
                : "border border-border bg-card text-foreground/60 hover:bg-accent-subtle"
            }`}
          >
            {p + 1}
          </button>
        )
      )}
      <button
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="w-7 h-7 rounded-md flex items-center justify-center border border-border bg-card hover:bg-accent-subtle disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-3.5 h-3.5 text-foreground/50" />
      </button>
    </div>
  );
}
