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
  Crown,
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

interface MerchantItem {
  id: string;
  name: string;
  displayName: string;
  email: string;
  phone: string | null;
  status: string;
  emoji: string;
  isOnline: boolean;
  rating: number;
  ratingCount: number;
  trades: number;
  volume: number;
  completedCount: number;
  cancelledCount: number;
  disputedCount: number;
  disputesTotal: number;
  disputesRaisedByMerchant: number;
  disputesAgainstMerchant: number;
  avgResponseTimeMins: number;
  verificationLevel: number;
  autoAcceptEnabled: boolean;
  balance: number;
  sinrBalance: number;
  lastSeenAt: string | null;
  createdAt: string;
  hasOpsAccess: boolean;
  hasComplianceAccess: boolean;
  riskScore: number;
  riskLevel: string;
}

type SortKey =
  | "volume"
  | "trades"
  | "rating"
  | "completed"
  | "cancelled"
  | "disputed"
  | "response_time"
  | "balance"
  | "newest"
  | "oldest"
  | "name"
  | "status"
  | "online"
  | "risk"
  | "disputes_total";

// ============================================
// HELPERS
// ============================================

const PAGE_SIZE = 25;

const formatVolume = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const formatTime = (mins: number): string => {
  if (mins < 1) return "<1m";
  if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
  return `${Math.round(mins)}m`;
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

const getStatusStyle = (status: string) => {
  switch (status) {
    case "active":
      return "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]";
    case "pending":
      return "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/20 text-[var(--color-warning)]";
    case "suspended":
      return "bg-primary/10 border-primary/20 text-primary";
    case "banned":
      return "bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]";
    default:
      return "bg-card border-border text-foreground/40";
  }
};

const getRiskStyle = (level: string) => {
  switch (level) {
    case "critical":
      return "bg-[var(--color-error)]/15 border-[var(--color-error)]/25 text-[var(--color-error)]";
    case "high":
      return "bg-primary/12 border-primary/25 text-primary";
    case "medium":
      return "bg-[var(--color-warning)]/12 border-[var(--color-warning)]/25 text-[var(--color-warning)]";
    default:
      return "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]/70";
  }
};

// ============================================
// MAIN PAGE
// ============================================

export default function MerchantsPage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminLoginForm, setAdminLoginForm] = useState({
    username: "",
    password: "",
  });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);

  const [merchants, setMerchants] = useState<MerchantItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("volume");
  const [statusFilter, setStatusFilter] = useState("");
  const [onlineFilter, setOnlineFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [lastActiveFilter, setLastActiveFilter] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("");
  const [volumeTierFilter, setVolumeTierFilter] = useState("");
  const [responseFilter, setResponseFilter] = useState("");
  const [autoAcceptFilter, setAutoAcceptFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [page, setPage] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

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

  const fetchMerchants = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    setIsRefreshing(true);
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sort: sortBy,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (statusFilter) params.set("status", statusFilter);
      if (onlineFilter) params.set("online", onlineFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (riskFilter) params.set("risk", riskFilter);
      if (lastActiveFilter) params.set("last_active", lastActiveFilter);
      if (verificationFilter) params.set("verification", verificationFilter);
      if (volumeTierFilter) params.set("volume_tier", volumeTierFilter);
      if (responseFilter) params.set("response", responseFilter);
      if (autoAcceptFilter) params.set("auto_accept", autoAcceptFilter);
      if (ratingFilter) params.set("rating", ratingFilter);

      const res = await fetchWithAuth(`/api/admin/merchants?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setMerchants(data.data);
        setTotal(data.total || 0);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch merchants:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [
    sortBy,
    statusFilter,
    onlineFilter,
    debouncedSearch,
    page,
    riskFilter,
    lastActiveFilter,
    verificationFilter,
    volumeTierFilter,
    responseFilter,
    autoAcceptFilter,
    ratingFilter,
  ]);

  useEffect(() => {
    if (isAuthenticated) fetchMerchants();
  }, [isAuthenticated, fetchMerchants]);

  // ── Derived ──

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const onlineCount = merchants.filter((m) => m.isOnline).length;

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
            <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/20 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary/10">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <Zap className="w-5 h-5 text-foreground fill-foreground" />
              <span className="text-[17px]">
                <span className="font-bold text-foreground">Blip</span>{" "}
                <span className="italic text-foreground/90">money</span>
              </span>
            </div>
            <p className="text-[11px] text-foreground/25 font-mono uppercase tracking-[0.2em]">
              Merchant Directory
            </p>
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
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">
                  Username
                </label>
                <input
                  type="text"
                  placeholder="admin"
                  value={adminLoginForm.username}
                  onChange={(e) =>
                    setAdminLoginForm({
                      ...adminLoginForm,
                      username: e.target.value,
                    })
                  }
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none focus:bg-card transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={adminLoginForm.password}
                  onChange={(e) =>
                    setAdminLoginForm({
                      ...adminLoginForm,
                      password: e.target.value,
                    })
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none focus:bg-card transition-all"
                />
              </div>
              <button
                onClick={handleAdminLogin}
                disabled={
                  isAdminLoggingIn ||
                  !adminLoginForm.username ||
                  !adminLoginForm.password
                }
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-foreground text-sm font-bold hover:from-primary/90 hover:to-primary/70 transition-all disabled:opacity-20 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
              >
                {isAdminLoggingIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
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

  return (
    <div className="hidden md:flex md:flex-col h-screen overflow-hidden">
      {/* ===== HEADER — matches admin console ===== */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
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
              <Link
                href="/admin"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Console
              </Link>
              <Link
                href="/admin/live"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Live Feed
              </Link>
              <Link
                href="/admin/access-control"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Access Control
              </Link>
              <Link
                href="/admin/accounts"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors"
              >
                Accounts
              </Link>
              <Link
                href="/admin/disputes"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Disputes
              </Link>
              <Link
                href="/admin/monitor"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Monitor
              </Link>
              <Link
                href="/admin/observability"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Observability
              </Link>
              <Link
                href="/admin/usdt-inr-price"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Price
              </Link>
            </nav>
          </div>

          {/* Right: Live badge + actions */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <div className="w-2 h-2 rounded-full bg-[var(--color-success)]/60 animate-pulse" />
              <span className="text-[9px] font-mono font-bold text-foreground/40 uppercase tracking-wider">
                Live
              </span>
              <span className="text-foreground/[0.08]">|</span>
              <span className="text-[9px] font-mono text-foreground/30">
                {onlineCount} online
              </span>
            </div>

            <span className="text-[9px] font-mono text-foreground/20 tabular-nums">
              {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
            </span>

            <button
              onClick={fetchMerchants}
              disabled={isRefreshing}
              className="p-2 rounded-lg transition-all bg-card hover:bg-accent-subtle border border-border"
            >
              <RefreshCw
                className={`w-[18px] h-[18px] text-foreground/40 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>

            <div className="w-px h-6 bg-border mx-0.5" />

            <button
              onClick={handleAdminLogout}
              className="p-2 rounded-lg hover:bg-[var(--color-error)]/10 transition-colors"
              title="Logout"
            >
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
              <Crown className="w-3 h-3 text-primary/60" />
              <span className="text-primary/80 font-bold tracking-wide">
                MERCHANTS
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-foreground/25">
                TOTAL{" "}
                <span className="text-foreground/70 font-bold">{total}</span>
              </span>
              <span className="text-foreground/25">
                ONLINE{" "}
                <span className="text-[var(--color-success)]/70 font-bold">
                  {onlineCount}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="px-3 py-2 border-b border-section-divider flex flex-wrap items-center gap-2 shrink-0">
          {/* Search */}
          <div className="relative flex-1 min-w-[140px] max-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/25" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-card border border-border rounded-md pl-7 pr-2 py-1.5 text-[10px] text-foreground/70 font-mono placeholder:text-foreground/25 focus:border-border-strong focus:outline-none"
            />
          </div>

          {/* Status pills */}
          <div className="flex gap-0.5 bg-card rounded-md p-0.5">
            {(["", "active", "pending", "suspended", "banned"] as const).map(
              (f) => (
                <button
                  key={f}
                  onClick={() => {
                    setStatusFilter(f);
                    setPage(0);
                  }}
                  className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                    statusFilter === f
                      ? f === "banned"
                        ? "bg-[var(--color-error)]/15 text-[var(--color-error)] font-bold"
                        : f === "suspended"
                          ? "bg-primary/10 text-primary font-bold"
                          : f === "active"
                            ? "bg-[var(--color-success)]/10 text-[var(--color-success)] font-bold"
                            : "bg-accent-subtle text-foreground/80"
                      : "text-foreground/35 hover:text-foreground/60"
                  }`}
                >
                  {f === "" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ),
            )}
          </div>

          {/* Online pills */}
          <div className="flex gap-0.5 bg-card rounded-md p-0.5">
            {(["", "true", "false"] as const).map((val) => (
              <button
                key={val}
                onClick={() => {
                  setOnlineFilter(val);
                  setPage(0);
                }}
                className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                  onlineFilter === val
                    ? val === "true"
                      ? "bg-[var(--color-success)]/10 text-[var(--color-success)] font-bold"
                      : val === "false"
                        ? "bg-accent-subtle text-foreground/60 font-bold"
                        : "bg-accent-subtle text-foreground/80"
                    : "text-foreground/35 hover:text-foreground/60"
                }`}
              >
                {val === "" ? "All" : val === "true" ? "Online" : "Offline"}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as SortKey);
              setPage(0);
            }}
            className="bg-card border border-border rounded-md px-2 py-1 text-[10px] font-mono text-foreground/60 focus:outline-none cursor-pointer"
          >
            <option value="volume" className="bg-card-solid text-foreground">
              Volume
            </option>
            <option value="trades" className="bg-card-solid text-foreground">
              Trades
            </option>
            <option value="rating" className="bg-card-solid text-foreground">
              Rating
            </option>
            <option value="completed" className="bg-card-solid text-foreground">
              Completed
            </option>
            <option value="cancelled" className="bg-card-solid text-foreground">
              Cancelled
            </option>
            <option value="disputed" className="bg-card-solid text-foreground">
              Disputed (Active)
            </option>
            <option
              value="disputes_total"
              className="bg-card-solid text-foreground"
            >
              Disputes (All)
            </option>
            <option
              value="response_time"
              className="bg-card-solid text-foreground"
            >
              Response
            </option>
            <option value="balance" className="bg-card-solid text-foreground">
              Balance
            </option>
            <option value="newest" className="bg-card-solid text-foreground">
              Newest
            </option>
            <option value="oldest" className="bg-card-solid text-foreground">
              Oldest
            </option>
            <option value="name" className="bg-card-solid text-foreground">
              Name
            </option>
            <option value="online" className="bg-card-solid text-foreground">
              Online
            </option>
            <option value="risk" className="bg-card-solid text-foreground">
              Risk Score
            </option>
          </select>
        </div>

        {/* ── Advanced Filters Row ── */}
        <div className="px-3 py-1.5 border-b border-section-divider flex flex-wrap items-center gap-2 shrink-0">
          {/* Risk */}
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-[var(--color-error)]/40" />
            <select
              value={riskFilter}
              onChange={(e) => {
                setRiskFilter(e.target.value);
                setPage(0);
              }}
              className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${
                riskFilter
                  ? "border-[var(--color-error)]/30 text-[var(--color-error)]"
                  : "border-border text-foreground/60"
              }`}
            >
              <option value="" className="bg-card-solid text-foreground">
                Risk: All
              </option>
              <option
                value="critical"
                className="bg-card-solid text-foreground"
              >
                Critical (&ge;80)
              </option>
              <option
                value="high_risk"
                className="bg-card-solid text-foreground"
              >
                High Risk (&gt;60)
              </option>
              <option
                value="high_dispute"
                className="bg-card-solid text-foreground"
              >
                High Dispute (&gt;10%)
              </option>
              <option
                value="high_cancel"
                className="bg-card-solid text-foreground"
              >
                High Cancel (&gt;20%)
              </option>
              <option
                value="zero_trades"
                className="bg-card-solid text-foreground"
              >
                Zero Trades
              </option>
            </select>
          </div>

          {/* Last Active */}
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-foreground/30" />
            <select
              value={lastActiveFilter}
              onChange={(e) => {
                setLastActiveFilter(e.target.value);
                setPage(0);
              }}
              className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${
                lastActiveFilter
                  ? "border-primary/30 text-primary"
                  : "border-border text-foreground/60"
              }`}
            >
              <option value="" className="bg-card-solid text-foreground">
                Active: All
              </option>
              <option value="1d" className="bg-card-solid text-foreground">
                Last 24h
              </option>
              <option value="7d" className="bg-card-solid text-foreground">
                Last 7d
              </option>
              <option value="30d" className="bg-card-solid text-foreground">
                Last 30d
              </option>
              <option value="90d" className="bg-card-solid text-foreground">
                Last 90d
              </option>
              <option
                value="inactive"
                className="bg-card-solid text-foreground"
              >
                Inactive (&gt;30d)
              </option>
              <option value="never" className="bg-card-solid text-foreground">
                Never Seen
              </option>
            </select>
          </div>

          {/* Verification Level */}
          <div className="flex items-center gap-1">
            <Shield className="w-3 h-3 text-foreground/30" />
            <select
              value={verificationFilter}
              onChange={(e) => {
                setVerificationFilter(e.target.value);
                setPage(0);
              }}
              className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${
                verificationFilter
                  ? "border-[var(--color-info)]/30 text-[var(--color-info)]"
                  : "border-border text-foreground/60"
              }`}
            >
              <option value="" className="bg-card-solid text-foreground">
                KYC: All
              </option>
              <option value="0" className="bg-card-solid text-foreground">
                Level 0 (None)
              </option>
              <option value="1" className="bg-card-solid text-foreground">
                Level 1
              </option>
              <option value="2" className="bg-card-solid text-foreground">
                Level 2
              </option>
              <option value="3" className="bg-card-solid text-foreground">
                Level 3
              </option>
            </select>
          </div>

          {/* Volume Tier */}
          <select
            value={volumeTierFilter}
            onChange={(e) => {
              setVolumeTierFilter(e.target.value);
              setPage(0);
            }}
            className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${
              volumeTierFilter
                ? "border-[var(--color-success)]/30 text-[var(--color-success)]"
                : "border-border text-foreground/60"
            }`}
          >
            <option value="" className="bg-card-solid text-foreground">
              Vol: All
            </option>
            <option value="0" className="bg-card-solid text-foreground">
              $0 (No vol)
            </option>
            <option value="1k" className="bg-card-solid text-foreground">
              &lt;$1K
            </option>
            <option value="10k" className="bg-card-solid text-foreground">
              $1K–$10K
            </option>
            <option value="100k" className="bg-card-solid text-foreground">
              $10K–$100K
            </option>
            <option value="whale" className="bg-card-solid text-foreground">
              $100K+
            </option>
          </select>

          {/* Response Time */}
          <select
            value={responseFilter}
            onChange={(e) => {
              setResponseFilter(e.target.value);
              setPage(0);
            }}
            className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${
              responseFilter
                ? "border-[var(--color-warning)]/30 text-[var(--color-warning)]"
                : "border-border text-foreground/60"
            }`}
          >
            <option value="" className="bg-card-solid text-foreground">
              Resp: All
            </option>
            <option value="fast" className="bg-card-solid text-foreground">
              &lt;5m (Fast)
            </option>
            <option value="medium" className="bg-card-solid text-foreground">
              5–15m (Med)
            </option>
            <option value="slow" className="bg-card-solid text-foreground">
              &gt;15m (Slow)
            </option>
          </select>

          {/* Rating */}
          <select
            value={ratingFilter}
            onChange={(e) => {
              setRatingFilter(e.target.value);
              setPage(0);
            }}
            className={`bg-card border rounded-md px-2 py-1 text-[10px] font-mono focus:outline-none cursor-pointer ${
              ratingFilter
                ? "border-primary/30 text-primary"
                : "border-border text-foreground/60"
            }`}
          >
            <option value="" className="bg-card-solid text-foreground">
              Rating: All
            </option>
            <option value="top" className="bg-card-solid text-foreground">
              4.5+ (Top)
            </option>
            <option value="high" className="bg-card-solid text-foreground">
              4.0–4.5
            </option>
            <option value="mid" className="bg-card-solid text-foreground">
              3.0–4.0
            </option>
            <option value="low" className="bg-card-solid text-foreground">
              &lt;3.0
            </option>
            <option value="unrated" className="bg-card-solid text-foreground">
              Unrated
            </option>
          </select>

          {/* Auto-Accept */}
          <div className="flex gap-0.5 bg-card rounded-md p-0.5">
            {(["", "true", "false"] as const).map((val) => (
              <button
                key={`aa-${val}`}
                onClick={() => {
                  setAutoAcceptFilter(val);
                  setPage(0);
                }}
                className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                  autoAcceptFilter === val
                    ? val === "true"
                      ? "bg-[var(--color-info)]/10 text-[var(--color-info)] font-bold"
                      : val === "false"
                        ? "bg-accent-subtle text-foreground/60 font-bold"
                        : "bg-accent-subtle text-foreground/80"
                    : "text-foreground/35 hover:text-foreground/60"
                }`}
              >
                {val === ""
                  ? "Auto: All"
                  : val === "true"
                    ? "Auto ON"
                    : "Manual"}
              </button>
            ))}
          </div>

          {/* Clear all filters */}
          {(riskFilter ||
            lastActiveFilter ||
            verificationFilter ||
            volumeTierFilter ||
            responseFilter ||
            autoAcceptFilter ||
            ratingFilter) && (
            <button
              onClick={() => {
                setRiskFilter("");
                setLastActiveFilter("");
                setVerificationFilter("");
                setVolumeTierFilter("");
                setResponseFilter("");
                setAutoAcceptFilter("");
                setRatingFilter("");
                setPage(0);
              }}
              className="px-2 py-1 text-[10px] font-mono font-medium text-[var(--color-error)]/70 hover:text-[var(--color-error)] rounded hover:bg-[var(--color-error)]/10 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* ── Table Header ── */}
        <div className="px-3 py-2 border-b border-border shrink-0 bg-card">
          <div className="grid grid-cols-[32px_1fr_70px_62px_60px_72px_52px_52px_52px_72px_52px_60px_56px_64px] gap-1 items-center">
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">
              #
            </span>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">
              Merchant
            </span>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">
              Status
            </span>
            <button
              onClick={() => {
                setSortBy("risk");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Risk{" "}
              {sortBy === "risk" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button
              onClick={() => {
                setSortBy("rating");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Rating{" "}
              {sortBy === "rating" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button
              onClick={() => {
                setSortBy("volume");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Volume{" "}
              {sortBy === "volume" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button
              onClick={() => {
                setSortBy("trades");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Trades{" "}
              {sortBy === "trades" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <button
              onClick={() => {
                setSortBy("completed");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Done{" "}
              {sortBy === "completed" && (
                <ChevronDown className="w-2.5 h-2.5" />
              )}
            </button>
            <button
              onClick={() => {
                setSortBy("cancelled");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Cancel{" "}
              {sortBy === "cancelled" && (
                <ChevronDown className="w-2.5 h-2.5" />
              )}
            </button>
            <button
              onClick={() => {
                setSortBy("disputes_total");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Disputes{" "}
              {sortBy === "disputes_total" && (
                <ChevronDown className="w-2.5 h-2.5" />
              )}
            </button>
            <button
              onClick={() => {
                setSortBy("response_time");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Resp{" "}
              {sortBy === "response_time" && (
                <ChevronDown className="w-2.5 h-2.5" />
              )}
            </button>
            <button
              onClick={() => {
                setSortBy("balance");
                setPage(0);
              }}
              className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5"
            >
              Balance{" "}
              {sortBy === "balance" && <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right">
              Seen
            </span>
            <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right">
              Joined
            </span>
          </div>
        </div>

        {/* ── Table Body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : merchants.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/15">
              <Users className="w-6 h-6 mb-1.5 opacity-20" />
              <p className="text-[10px] font-mono">No merchants found</p>
            </div>
          ) : (
            merchants.map((m, i) => {
              const winRate =
                m.trades > 0
                  ? ((m.completedCount / m.trades) * 100).toFixed(0)
                  : "—";
              const rank = page * PAGE_SIZE + i + 1;

              return (
                <div
                  key={m.id}
                  className={`grid grid-cols-[32px_1fr_70px_62px_60px_72px_52px_52px_52px_72px_52px_60px_56px_64px] gap-1 items-center px-3 py-2 border-b border-section-divider hover:bg-accent-subtle transition-colors cursor-pointer ${
                    m.status === "banned"
                      ? "bg-[var(--color-error)]/[0.01]"
                      : m.status === "suspended"
                        ? "bg-primary/[0.01]"
                        : ""
                  }`}
                >
                  {/* Rank */}
                  <span
                    className={`text-[10px] font-mono font-bold ${
                      rank === 1
                        ? "text-primary"
                        : rank <= 3
                          ? "text-foreground/50"
                          : "text-foreground/30"
                    }`}
                  >
                    {rank}
                  </span>

                  {/* Merchant */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm shrink-0">{m.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-foreground/60 truncate">
                          {m.name}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.isOnline ? "bg-[var(--color-success)]" : "bg-foreground/10"}`}
                        />
                        {m.autoAcceptEnabled && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-info)]/10 text-[var(--color-info)]/70 border border-[var(--color-info)]/20 font-mono font-bold">
                            AUTO
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-foreground/30 font-mono truncate">
                          {m.email || m.id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${getStatusStyle(m.status)}`}
                    >
                      {m.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Risk */}
                  <Link
                    href={`/admin/risk-profile/${m.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-end gap-1 group"
                    title={`Risk score: ${m.riskScore} — Click for full profile`}
                  >
                    <span
                      className={`text-[9px] font-mono font-bold tabular-nums ${
                        m.riskScore >= 80
                          ? "text-[var(--color-error)]"
                          : m.riskScore >= 60
                            ? "text-primary"
                            : m.riskScore >= 30
                              ? "text-[var(--color-warning)]"
                              : "text-foreground/30"
                      }`}
                    >
                      {m.riskScore > 0 ? m.riskScore : "—"}
                    </span>
                    {m.riskScore > 0 && (
                      <span
                        className={`px-1 py-0.5 rounded text-[7px] font-bold border leading-none ${getRiskStyle(m.riskLevel)}`}
                      >
                        {m.riskLevel === "critical"
                          ? "CRIT"
                          : m.riskLevel.toUpperCase().slice(0, 3)}
                      </span>
                    )}
                  </Link>

                  {/* Rating */}
                  <div className="text-right">
                    {m.rating > 0 ? (
                      <div className="flex items-center justify-end gap-0.5">
                        <Star className="w-2 h-2 text-primary/40 fill-primary/40" />
                        <span className="text-[9px] font-mono text-foreground/60">
                          {m.rating.toFixed(1)}
                        </span>
                        <span className="text-[8px] text-foreground/30 font-mono">
                          ({m.ratingCount})
                        </span>
                      </div>
                    ) : (
                      <span className="text-[9px] text-foreground/25 font-mono">
                        —
                      </span>
                    )}
                  </div>

                  {/* Volume */}
                  <div className="text-right">
                    <span className="text-[9px] font-mono font-bold text-foreground/50 tabular-nums">
                      {formatVolume(m.volume)}
                    </span>
                  </div>

                  {/* Trades */}
                  <div className="text-right text-[9px] font-mono text-foreground/40 tabular-nums">
                    {m.trades}
                  </div>

                  {/* Completed */}
                  <div className="text-right">
                    <span className="text-[9px] font-mono text-[var(--color-success)]/60 tabular-nums">
                      {m.completedCount}
                    </span>
                    <span className="text-[8px] text-foreground/25 font-mono ml-0.5">
                      {winRate}%
                    </span>
                  </div>

                  {/* Cancelled */}
                  <div className="text-right">
                    <span
                      className={`text-[9px] font-mono tabular-nums ${m.cancelledCount > 0 ? "text-primary/60" : "text-foreground/25"}`}
                    >
                      {m.cancelledCount}
                    </span>
                  </div>

                  {/* Disputes */}
                  <div className="text-right">
                    <span
                      className={`text-[10px] font-mono font-bold tabular-nums ${m.disputesTotal > 0 ? "text-[var(--color-error)]" : "text-foreground/25"}`}
                    >
                      {m.disputesTotal}
                    </span>
                    {m.disputesTotal > 0 && (
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span
                          className="text-[8px] font-mono text-primary/50"
                          title="Raised by merchant"
                        >
                          {m.disputesRaisedByMerchant}&#8593;
                        </span>
                        <span
                          className="text-[8px] font-mono text-[var(--color-error)]/50"
                          title="Against merchant"
                        >
                          {m.disputesAgainstMerchant}&#8595;
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Response Time */}
                  <div className="text-right text-[10px] font-mono text-foreground/40 tabular-nums">
                    {m.avgResponseTimeMins > 0
                      ? formatTime(m.avgResponseTimeMins)
                      : "—"}
                  </div>

                  {/* Balance */}
                  <div className="text-right">
                    <span
                      className={`text-[9px] font-mono tabular-nums ${m.balance > 0 ? "text-foreground/40" : "text-foreground/25"}`}
                    >
                      {m.balance > 0 ? formatVolume(m.balance) : "—"}
                    </span>
                  </div>

                  {/* Last Seen */}
                  <div className="text-right text-[10px] font-mono text-foreground/45 tabular-nums">
                    {formatTimeAgo(m.lastSeenAt)}
                  </div>

                  {/* Joined */}
                  <div className="text-right text-[10px] font-mono text-foreground/40 tabular-nums">
                    {m.createdAt
                      ? new Date(m.createdAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })
                      : "—"}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Pagination Footer ── */}
        {totalPages > 1 && (
          <div className="px-3 py-2 border-t border-border flex items-center justify-between shrink-0 bg-card">
            <span className="text-[10px] text-foreground/40 font-mono tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}{" "}
              of {total}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 rounded transition-colors hover:bg-accent-subtle disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3 h-3 text-foreground/30" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i;
                } else if (page < 3) {
                  pageNum = i;
                } else if (page > totalPages - 4) {
                  pageNum = totalPages - 7 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-5 h-5 rounded text-[8px] font-mono font-medium transition-all ${
                      page === pageNum
                        ? "bg-primary/15 text-primary border border-primary/20"
                        : "text-foreground/25 hover:text-foreground/50 hover:bg-accent-subtle"
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1 rounded transition-colors hover:bg-accent-subtle disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3 h-3 text-foreground/30" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
