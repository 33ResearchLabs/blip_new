"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Shield,
  Zap,
  XCircle,
  Search,
  Eye,
  EyeOff,
  Filter,
  Plus,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { ADMIN_COOKIE_SENTINEL } from "@/lib/api/adminSession";
import { formatCount, formatCrypto } from "@/lib/format";

type Tab = "compliance" | "ops";
type StatusFilter = "all" | "granted" | "no_access";

interface MerchantItem {
  id: string;
  name: string;
  emoji: string;
  isOnline: boolean;
  rating: number;
  trades: number;
  volume: number;
  hasComplianceAccess: boolean;
  hasOpsAccess: boolean;
  lastSeenAt: string | null;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const formatRelativeAgo = (date: string | null | undefined): string => {
  if (!date) return "never";
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const month = Math.floor(day / 30);
  return `${month} month${month === 1 ? "" : "s"} ago`;
};

// Build a compact pagination range like [1, 2, 3, "…", 6]
const buildPageRange = (current: number, total: number): (number | "…")[] => {
  if (total <= 6) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, "…", total];
  if (current >= total - 2) return [1, "…", total - 2, total - 1, total];
  return [1, current - 1, current, current + 1, "…", total];
};

export default function AccessControlPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab: Tab =
    searchParams.get("tab") === "ops" ? "ops" : "compliance";

  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);

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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Table controls
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [pageSizeOpen, setPageSizeOpen] = useState(false);
  const [actionOpenId, setActionOpenId] = useState<string | null>(null);

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const onDown = () => {
      setFilterOpen(false);
      setPageSizeOpen(false);
      setActionOpenId(null);
    };
    if (filterOpen || pageSizeOpen || actionOpenId) {
      window.addEventListener("mousedown", onDown);
      return () => window.removeEventListener("mousedown", onDown);
    }
  }, [filterOpen, pageSizeOpen, actionOpenId]);

  // Keep ?tab= in URL in sync with state
  const switchTab = (next: Tab) => {
    setTab(next);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/admin/access-control?${params.toString()}`);
  };

  // ── Auth ──

  useEffect(() => {
    const checkSession = async () => {
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
      if (data.success && data.data?.admin) {
        localStorage.setItem("blip_admin", JSON.stringify(data.data.admin));
        setAdminToken(ADMIN_COOKIE_SENTINEL);
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

  // ── Data ──

  const fetchMerchants = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        "/api/admin/merchants?sort=volume&limit=200",
      );
      const data = await res.json();
      if (data.success) setMerchants(data.data);
    } catch (err) {
      console.error("Failed to fetch merchants:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchMerchants();
  }, [isAuthenticated, fetchMerchants]);

  const toggleAccess = async (merchantId: string, current: boolean) => {
    const token = adminTokenRef.current;
    if (!token) return;
    const field = tab === "compliance" ? "hasComplianceAccess" : "hasOpsAccess";
    setTogglingId(merchantId);
    try {
      const res = await fetchWithAuth("/api/admin/merchants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, [field]: !current }),
      });
      const data = await res.json();
      if (data.success) {
        setMerchants((prev) =>
          prev.map((m) =>
            m.id === merchantId ? { ...m, [field]: !current } : m,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to toggle access:", err);
    } finally {
      setTogglingId(null);
      setActionOpenId(null);
    }
  };

  // ── Derived ──

  const isOn = useCallback(
    (m: MerchantItem) =>
      tab === "compliance" ? m.hasComplianceAccess : m.hasOpsAccess,
    [tab],
  );

  const filtered = useMemo(() => {
    return merchants.filter((m) => {
      if (search) {
        const q = search.toLowerCase();
        if (!m.name?.toLowerCase().includes(q) && !m.id.includes(search))
          return false;
      }
      if (statusFilter === "granted" && !isOn(m)) return false;
      if (statusFilter === "no_access" && isOn(m)) return false;
      return true;
    });
  }, [merchants, search, statusFilter, isOn]);

  // Reset page when filters change and current page becomes invalid
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const pageStart = (page - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const pageRows = filtered.slice(pageStart, pageEnd);

  const grantedCount = merchants.filter(isOn).length;

  if (!mounted || isCheckingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
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
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary/10">
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
              Access Control
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
                  maxLength={50}
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
                  maxLength={100}
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
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-foreground text-sm font-bold hover:from-primary/90 hover:to-primary transition-all disabled:opacity-20 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
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

  // ── Main ──

  const tabLabel = tab === "compliance" ? "Compliance" : "Ops";
  const tabSubtitle =
    tab === "compliance"
      ? "Manage user access and compliance permissions"
      : "Manage user access and ops permissions";
  const enabledLabel = tab === "compliance" ? "Access granted" : "Ops Enabled";

  return (
    <div className="min-h-screen bg-background text-foreground">
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
                className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors"
              >
                Access Control
              </Link>
              <Link
                href="/admin/accounts"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
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
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-foreground/30 font-mono tabular-nums">
              {formatCount(grantedCount)} granted
            </div>
          </div>
        </div>
      </header>

      {/* Page header */}
      <div className="w-full px-8 pt-7 pb-3">
        <h1 className="text-2xl font-bold text-foreground">{tabLabel}</h1>
        <p className="text-[12px] text-foreground/40 mt-1">{tabSubtitle}</p>
      </div>

      {/* Tab pills */}
      <div className="w-full px-8 border-b border-section-divider">
        <div className="flex items-center gap-1">
          <TabPill
            active={tab === "compliance"}
            onClick={() => switchTab("compliance")}
            label="Compliance"
          />
          <TabPill
            active={tab === "ops"}
            onClick={() => switchTab("ops")}
            label="Ops"
          />
        </div>
      </div>

      {/* Toolbar — search + filters */}
      <div className="w-full px-8 pt-5 pb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/25" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            maxLength={100}
            className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-2.5 text-[13px] text-foreground placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Filters */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFilterOpen((o) => !o);
                setPageSizeOpen(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium border transition-colors ${
                statusFilter !== "all"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border text-foreground/60 hover:bg-accent-subtle hover:text-foreground"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
              {statusFilter !== "all" && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
            {filterOpen && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-1.5 w-52 bg-card-solid border border-border rounded-lg shadow-lg p-1 z-20"
              >
                <FilterOption
                  label="All users"
                  active={statusFilter === "all"}
                  onClick={() => {
                    setStatusFilter("all");
                    setFilterOpen(false);
                    setPage(1);
                  }}
                />
                <FilterOption
                  label="Granted only"
                  active={statusFilter === "granted"}
                  onClick={() => {
                    setStatusFilter("granted");
                    setFilterOpen(false);
                    setPage(1);
                  }}
                />
                <FilterOption
                  label="No access"
                  active={statusFilter === "no_access"}
                  onClick={() => {
                    setStatusFilter("no_access");
                    setFilterOpen(false);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </div>

          {/* Add User — focuses search to find a merchant to grant */}
          <button
            onClick={() => searchInputRef.current?.focus()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Add User
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="w-full px-8 pb-4">
        <div className="bg-card-solid border border-border rounded-xl overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[2fr_1.4fr_1.6fr_1.2fr_1fr_60px] gap-4 px-5 py-3 border-b border-section-divider bg-card">
            <div className="text-[10px] font-mono font-medium text-foreground/40 uppercase tracking-wider">
              User
            </div>
            <div className="text-[10px] font-mono font-medium text-foreground/40 uppercase tracking-wider">
              Details
            </div>
            <div className="text-[10px] font-mono font-medium text-foreground/40 uppercase tracking-wider">
              Permissions
            </div>
            <div className="text-[10px] font-mono font-medium text-foreground/40 uppercase tracking-wider">
              Status
            </div>
            <div className="text-[10px] font-mono font-medium text-foreground/40 uppercase tracking-wider">
              Last Active
            </div>
            <div className="text-[10px] font-mono font-medium text-foreground/40 uppercase tracking-wider text-right">
              Action
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : pageRows.length === 0 ? (
            <p className="text-center text-foreground/25 text-[13px] py-16 font-mono">
              No merchants found.
            </p>
          ) : (
            pageRows.map((merchant) => {
              const on = isOn(merchant);
              return (
                <UserRow
                  key={merchant.id}
                  merchant={merchant}
                  on={on}
                  enabledLabel={enabledLabel}
                  tab={tab}
                  toggling={togglingId === merchant.id}
                  actionOpen={actionOpenId === merchant.id}
                  onToggleAction={(e) => {
                    e.stopPropagation();
                    setActionOpenId((prev) =>
                      prev === merchant.id ? null : merchant.id,
                    );
                  }}
                  onToggleAccess={() => toggleAccess(merchant.id, on)}
                />
              );
            })
          )}
        </div>

        {/* Pagination footer */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <div className="text-[12px] text-foreground/40 font-mono">
              Showing {formatCount(pageStart + 1)} to{" "}
              {formatCount(Math.min(pageEnd, filtered.length))} of{" "}
              {formatCount(filtered.length)} users
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground/50 bg-card border border-border hover:bg-accent-subtle hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {buildPageRange(page, totalPages).map((p, i) =>
                p === "…" ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="px-1 text-foreground/30 text-[12px]"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-[12px] font-mono font-medium transition-colors ${
                      p === page
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border text-foreground/60 hover:bg-accent-subtle hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground/50 bg-card border border-border hover:bg-accent-subtle hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Page size */}
              <div className="relative ml-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPageSizeOpen((o) => !o);
                    setFilterOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] bg-card border border-border text-foreground/70 hover:bg-accent-subtle transition-colors"
                >
                  {pageSize} / page
                  <ChevronDown className="w-3 h-3" />
                </button>
                {pageSizeOpen && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute right-0 bottom-full mb-1.5 w-32 bg-card-solid border border-border rounded-lg shadow-lg p-1 z-20"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        onClick={() => {
                          setPageSize(size);
                          setPage(1);
                          setPageSizeOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded text-[12px] transition-colors ${
                          size === pageSize
                            ? "bg-primary/10 text-primary"
                            : "text-foreground/70 hover:bg-accent-subtle"
                        }`}
                      >
                        {size} / page
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// COMPONENTS
// ============================================

function TabPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors ${
        active ? "text-primary" : "text-foreground/45 hover:text-foreground/70"
      }`}
    >
      {label}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-primary rounded-t" />
      )}
    </button>
  );
}

function FilterOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-[12px] transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-foreground/70 hover:bg-accent-subtle"
      }`}
    >
      {label}
      {active && <Check className="w-3 h-3" />}
    </button>
  );
}

function UserRow({
  merchant,
  on,
  enabledLabel,
  tab,
  toggling,
  actionOpen,
  onToggleAction,
  onToggleAccess,
}: {
  merchant: MerchantItem;
  on: boolean;
  enabledLabel: string;
  tab: Tab;
  toggling: boolean;
  actionOpen: boolean;
  onToggleAction: (e: React.MouseEvent) => void;
  onToggleAccess: () => void;
}) {
  const permissions: string[] = on
    ? tab === "compliance"
      ? ["Read", "Trade"]
      : ["Read", "Trade", "Withdraw"]
    : ["Read Only"];

  return (
    <div className="grid grid-cols-[2fr_1.4fr_1.6fr_1.2fr_1fr_60px] gap-4 px-5 py-3.5 border-b border-section-divider/50 last:border-0 hover:bg-accent-subtle/40 transition-colors items-center">
      {/* User */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-base shrink-0">
          {merchant.emoji}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-foreground truncate">
              {merchant.name}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                merchant.isOnline
                  ? "bg-[var(--color-success)]"
                  : "bg-foreground/15"
              }`}
              title={merchant.isOnline ? "Online" : "Offline"}
            />
          </div>
          <div className="text-[10px] text-foreground/35 font-mono mt-0.5 truncate">
            {merchant.id.slice(0, 8)}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="flex items-center gap-3 text-[11px] text-foreground/55 font-mono">
        <span className="tabular-nums">
          {formatCount(merchant.trades)} trades
        </span>
        <span className="tabular-nums">
          {formatCrypto(merchant.volume, { decimals: 0 })} vol
        </span>
      </div>

      {/* Permissions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {permissions.map((p) => (
          <span
            key={p}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-card border border-border text-foreground/55"
          >
            {p}
          </span>
        ))}
      </div>

      {/* Status */}
      <div>
        {on ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 text-[var(--color-success)]">
            <Eye className="w-3 h-3" />
            {enabledLabel}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-card border border-border text-foreground/40">
            <EyeOff className="w-3 h-3" />
            No Access
          </span>
        )}
      </div>

      {/* Last Active */}
      <div
        className={`text-[11px] font-mono tabular-nums ${
          on ? "text-[var(--color-success)]/70" : "text-foreground/40"
        }`}
      >
        {formatRelativeAgo(merchant.lastSeenAt)}
      </div>

      {/* Action */}
      <div className="relative flex justify-end">
        <button
          onClick={onToggleAction}
          disabled={toggling}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground/40 hover:bg-accent-subtle hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Open actions menu"
        >
          {toggling ? (
            <div className="w-3.5 h-3.5 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
          ) : (
            <MoreHorizontal className="w-4 h-4" />
          )}
        </button>
        {actionOpen && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute right-0 top-full mt-1 w-44 bg-card-solid border border-border rounded-lg shadow-lg p-1 z-10"
          >
            <button
              onClick={onToggleAccess}
              className={`w-full text-left px-3 py-1.5 rounded text-[12px] transition-colors ${
                on
                  ? "text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
                  : "text-primary hover:bg-primary/10"
              }`}
            >
              {on ? "Revoke access" : "Grant access"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
