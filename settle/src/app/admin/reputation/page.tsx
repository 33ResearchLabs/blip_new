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
  Store,
  Star,
  Award,
  ShieldCheck,
  Gauge,
  Coins,
  Crown,
  Shield,
  Diamond,
  Flame,
  Sparkles,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { ADMIN_COOKIE_SENTINEL } from "@/lib/api/adminSession";
import { formatCount, formatCrypto } from "@/lib/format";
import { TIER_INFO, getTierFromScore } from "@/lib/reputation/types";

// ============================================
// TYPES
// ============================================

type EntityType = "user" | "merchant";

interface ReputationItem {
  id: string;
  type: EntityType;
  name: string;
  handle: string;
  walletAddress: string | null;
  blipPoints: number;
  lockedBlipPoints: number;
  rewardTotal: number;
  scored: boolean;
  reputationScore: number | null;
  trustScore: number | null;
  reviewScore: number | null;
  executionScore: number | null;
  volumeScore: number | null;
  consistencyScore: number | null;
  badges: string[];
  rating: number;
  trades: number;
  calculatedAt: string | null;
  createdAt: string;
}

interface Summary {
  total: number;
  scored: number;
  avgReputation: number;
  totalReward: number;
}

type SortKey =
  | "reputation"
  | "trust"
  | "reward"
  | "rating"
  | "trades"
  | "newest"
  | "name";

// ============================================
// HELPERS
// ============================================

const PAGE_SIZES = [10, 25, 50, 100];

const TIER_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "platinum", label: "Platinum (850+)" },
  { value: "gold", label: "Gold (750–849)" },
  { value: "silver", label: "Silver (650–749)" },
  { value: "bronze", label: "Bronze (550–649)" },
  { value: "newcomer", label: "New (450–549)" },
  { value: "risky", label: "Restricted (300–449)" },
  { value: "unscored", label: "Unscored" },
];

// Deterministic avatar variation from id (matches the Users/Merchants pages).
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

// Trust score (0–100) colour bands.
const trustColor = (score: number) =>
  score >= 70 ? "text-[var(--color-success)]"
  : score >= 40 ? "text-foreground/70"
  : "text-[var(--color-warning)]";

// ============================================
// MAIN PAGE
// ============================================

export default function AdminReputationPage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);

  const [entityType, setEntityType] = useState<EntityType>("user");
  const [items, setItems] = useState<ReputationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("reputation");
  const [tierFilter, setTierFilter] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

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
        const res = await fetchWithAuth("/api/auth/admin");
        const data = await res.json();
        if (data.success && data.data?.valid) {
          setAdminToken(ADMIN_COOKIE_SENTINEL);
          setIsAuthenticated(true);
        } else { localStorage.removeItem("blip_admin"); }
      } catch { localStorage.removeItem("blip_admin"); }
      finally { setIsCheckingSession(false); }
    };
    checkSession();
  }, []);

  const handleAdminLogin = async () => {
    setIsAdminLoggingIn(true); setAdminLoginError("");
    try {
      const res = await fetchWithAuth("/api/auth/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(adminLoginForm) });
      const data = await res.json();
      if (data.success && data.data?.admin) {
        localStorage.setItem("blip_admin", JSON.stringify(data.data.admin));
        setAdminToken(ADMIN_COOKIE_SENTINEL); setIsAuthenticated(true);
        window.dispatchEvent(new CustomEvent("admin:auth-changed"));
      } else { setAdminLoginError(data.error || "Login failed"); }
    } catch { setAdminLoginError("Connection failed"); }
    finally { setIsAdminLoggingIn(false); }
  };

  // ── Data ──
  const fetchData = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: entityType,
        sort: sortBy,
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (tierFilter) params.set("tier", tierFilter);

      const res = await fetchWithAuth(`/api/admin/reputation?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        setTotal(data.total || 0);
        if (data.summary) setSummary(data.summary);
      }
    } catch (err) { console.error("Failed to fetch reputation data:", err); }
    finally { setLoading(false); }
  }, [entityType, sortBy, debouncedSearch, tierFilter, page, pageSize]);

  useEffect(() => { if (isAuthenticated) fetchData(); }, [isAuthenticated, fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = page * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);

  const switchType = (t: EntityType) => {
    if (t === entityType) return;
    setEntityType(t);
    setPage(0);
    setSummary(null);
  };

  const entityLabel = entityType === "user" ? "users" : "merchants";
  // Two 20px spacer tracks add breathing room: Reward→Reputation and Trust→Rating.
  const GRID = "grid-cols-[32px_1fr_104px_20px_152px_76px_20px_88px_60px_72px]";

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
              <Award className="w-8 h-8 text-primary" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <Zap className="w-5 h-5 text-foreground fill-foreground" />
              <span className="text-[17px]"><span className="font-bold text-foreground">Blip</span>{" "}<span className="italic text-foreground/90">money</span></span>
            </div>
            <p className="text-[11px] text-foreground/25 font-mono uppercase tracking-[0.2em]">Trust Scores</p>
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

  const scoredPct = summary && summary.total > 0 ? Math.round((summary.scored / summary.total) * 100) : 0;

  return (
    <div className="hidden md:flex md:flex-col h-screen overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="p-3 flex flex-col gap-3">

          {/* ── Sub-tabs: Users | Merchants ── */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
            <button
              onClick={() => switchType("user")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                entityType === "user" ? "bg-primary text-background shadow-sm shadow-primary/20" : "text-foreground/55 hover:bg-accent-subtle"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Users
            </button>
            <button
              onClick={() => switchType("merchant")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                entityType === "merchant" ? "bg-primary text-background shadow-sm shadow-primary/20" : "text-foreground/55 hover:bg-accent-subtle"
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              Merchants
            </button>
          </div>

          {/* ── Summary cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <SummaryCard
              label={entityType === "user" ? "Total Users" : "Total Merchants"}
              value={summary != null ? formatCount(summary.total) : "—"}
              meta={<span className="text-foreground/40">in directory</span>}
              icon={entityType === "user" ? <Users className="w-4 h-4" /> : <Store className="w-4 h-4" />}
              tone="primary"
            />
            <SummaryCard
              label="Scored"
              value={summary != null ? formatCount(summary.scored) : "—"}
              meta={<span className="text-[var(--color-success)]">{scoredPct}% <span className="text-foreground/30 font-normal">have a reputation</span></span>}
              icon={<ShieldCheck className="w-4 h-4" />}
              tone="success"
            />
            <SummaryCard
              label="Avg Reputation"
              value={summary != null && summary.avgReputation > 0 ? formatCount(summary.avgReputation) : "—"}
              meta={<span className="text-foreground/40">300–900 scale</span>}
              icon={<Gauge className="w-4 h-4" />}
              tone="primary"
            />
            <SummaryCard
              label="Total Blip Points"
              value={summary != null ? formatCount(summary.totalReward) : "—"}
              meta={<span className="text-foreground/40">spendable balance</span>}
              icon={<Coins className="w-4 h-4" />}
              tone="warning"
            />
          </div>

          {/* ── Filters row ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-[360px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
              <input
                type="text"
                placeholder={`Search ${entityLabel} by name, ID, or wallet...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
                className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-[12px] text-foreground/80 placeholder:text-foreground/30 focus:border-border-strong focus:outline-none"
              />
            </div>

            <FilterSelect
              label="Tier"
              value={tierFilter}
              onChange={(v) => { setTierFilter(v); setPage(0); }}
              options={TIER_FILTER_OPTIONS}
              accent={tierFilter ? "primary" : "default"}
            />

            <FilterSelect
              label="Sort"
              value={sortBy}
              onChange={(v) => { setSortBy(v as SortKey); setPage(0); }}
              options={[
                { value: "reputation", label: "Reputation" },
                { value: "trust", label: "Trust score" },
                { value: "reward", label: "Blip points" },
                { value: "rating", label: "Rating" },
                { value: "trades", label: "Trades" },
                { value: "newest", label: "Newest" },
                { value: "name", label: "Name" },
              ]}
              accent="default"
            />
          </div>

          {/* ── Table ── */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {/* Header row */}
            <div className="px-3 py-2.5 border-b border-section-divider bg-card-solid/50">
              <div className={`grid ${GRID} gap-2 items-center`}>
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">#</span>
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider">{entityType === "user" ? "User" : "Merchant"}</span>
                <button onClick={() => { setSortBy("reward"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5" title="Reward = Blip points (available + locked).">
                  Reward {sortBy === "reward" && <ChevronDown className="w-2.5 h-2.5" />}
                </button>
                <span />
                <button onClick={() => { setSortBy("reputation"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider hover:text-foreground/60 flex items-center gap-0.5" title="Reputation score (300–900 CIBIL-style) and tier.">
                  Reputation {sortBy === "reputation" && <ChevronDown className="w-2.5 h-2.5" />}
                </button>
                <button onClick={() => { setSortBy("trust"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5" title="Trust component (0–100): disputes, KYC, verification.">
                  Trust {sortBy === "trust" && <ChevronDown className="w-2.5 h-2.5" />}
                </button>
                <span />
                <button onClick={() => { setSortBy("rating"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider hover:text-foreground/60 flex items-center gap-0.5">
                  Rating {sortBy === "rating" && <ChevronDown className="w-2.5 h-2.5" />}
                </button>
                <button onClick={() => { setSortBy("trades"); setPage(0); }} className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right hover:text-foreground/60 flex items-center justify-end gap-0.5">
                  Trades {sortBy === "trades" && <ChevronDown className="w-2.5 h-2.5" />}
                </button>
                <span className="text-[9px] font-mono text-foreground/35 uppercase tracking-wider text-right" title="When this entity's reputation was last recalculated.">Updated</span>
              </div>
            </div>

            {/* Body */}
            <div>
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-foreground/25">
                  <Award className="w-6 h-6 mb-1.5 opacity-20" />
                  <p className="text-[10px] font-mono">No {entityLabel} found</p>
                </div>
              ) : (
                items.map((it, i) => {
                  const rank = page * pageSize + i + 1;
                  const avatar = pickAvatar(it.id);
                  const AvatarIcon = avatar.Icon;
                  const tierKey = it.reputationScore != null ? getTierFromScore(it.reputationScore) : null;
                  const tier = tierKey ? TIER_INFO[tierKey] : null;

                  return (
                    <div
                      key={it.id}
                      className={`grid ${GRID} gap-2 items-center px-3 py-2 border-b border-section-divider/50 hover:bg-accent-subtle transition-colors`}
                    >
                      <span className={`text-[11px] font-mono tabular-nums ${rank === 1 ? "text-primary font-bold" : "text-foreground/35"}`}>{rank}</span>

                      {/* Identity */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${avatar.bg}`}>
                          <AvatarIcon className={`w-4 h-4 ${avatar.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[11px] truncate text-foreground/85 font-medium block">
                            {it.name || it.handle || "Unnamed"}
                          </span>
                          <span className="text-[9px] text-foreground/30 font-mono truncate block">
                            {it.walletAddress
                              ? `${it.walletAddress.slice(0, 7)}...${it.walletAddress.slice(-3)}`
                              : it.handle || `${it.id.slice(0, 8)}...`}
                          </span>
                        </div>
                      </div>

                      {/* Reward — spendable Blip points (matches what the
                          user/merchant sees on their own Points screen).
                          Locked (maturing/anti-abuse) points shown separately. */}
                      <div className="text-right">
                        <span className={`text-[11px] font-medium tabular-nums ${it.blipPoints > 0 ? "text-[var(--color-warning)]" : "text-foreground/25"}`}>
                          {it.blipPoints > 0 ? formatCount(it.blipPoints) : "—"}
                        </span>
                        {it.lockedBlipPoints > 0 && (
                          <span className="block text-[8px] text-foreground/30 font-mono tabular-nums">
                            +{formatCount(it.lockedBlipPoints)} locked
                          </span>
                        )}
                      </div>

                      <div />

                      {/* Reputation — score + tier pill */}
                      <div className="flex items-center gap-2">
                        {it.scored && it.reputationScore != null ? (
                          <>
                            <span className="text-[12px] font-bold text-foreground/85 tabular-nums">{formatCount(it.reputationScore)}</span>
                            {tier && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[8px] font-bold border uppercase tracking-wide"
                                style={{ color: tier.color, borderColor: `${tier.color}40`, backgroundColor: `${tier.color}1a` }}
                                title={tier.description}
                              >
                                {tier.name}
                              </span>
                            )}
                            {it.badges.length > 0 && (
                              <span className="text-[8px] text-foreground/30 font-mono" title={it.badges.join(", ")}>
                                +{it.badges.length}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-foreground/25 font-mono">Unscored</span>
                        )}
                      </div>

                      {/* Trust */}
                      <div className="text-right">
                        {it.trustScore != null ? (
                          <span className={`text-[11px] font-medium tabular-nums ${trustColor(it.trustScore)}`}>
                            {formatCount(it.trustScore)}<span className="text-foreground/25 text-[9px]">/100</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-foreground/25">—</span>
                        )}
                      </div>

                      <div />

                      {/* Rating */}
                      <div className="flex items-center gap-1">
                        {it.rating > 0 ? (
                          <>
                            <Star className="w-3 h-3 text-[var(--color-warning)] fill-[var(--color-warning)]" />
                            <span className="text-[11px] font-medium text-foreground/80 tabular-nums">{formatCrypto(it.rating, { decimals: 1 })}</span>
                          </>
                        ) : (
                          <span className="text-[11px] text-foreground/25 font-mono">—</span>
                        )}
                      </div>

                      {/* Trades */}
                      <div className="text-right text-[11px] text-foreground/70 tabular-nums">{formatCount(it.trades)}</div>

                      {/* Updated */}
                      <div className="text-right text-[11px] text-foreground/50 tabular-nums">
                        {it.calculatedAt ? new Date(it.calculatedAt).toLocaleDateString("en-US", { day: "2-digit", month: "short" }) : "—"}
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
                  ? `No ${entityLabel}`
                  : `Showing ${formatCount(startIndex + 1)} to ${formatCount(endIndex)} of ${formatCount(total)} ${entityLabel}`}
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
                ? "bg-primary text-background shadow-sm shadow-primary/20"
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
