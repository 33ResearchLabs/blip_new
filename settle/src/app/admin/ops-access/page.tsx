"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Zap,
  XCircle,
  Search,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

interface MerchantItem {
  id: string;
  name: string;
  emoji: string;
  isOnline: boolean;
  rating: number;
  trades: number;
  volume: number;
  hasOpsAccess: boolean;
}

export default function OpsAccessPage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);

  const [merchants, setMerchants] = useState<MerchantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  useEffect(() => { setMounted(true); }, []);

  // ── Auth (same as admin/page.tsx) ──

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

  // ── Data ──

  const fetchMerchants = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/merchants?sort=volume&limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
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

  const toggleOpsAccess = async (merchantId: string, current: boolean) => {
    const token = adminTokenRef.current;
    if (!token) return;
    setTogglingId(merchantId);
    try {
      const res = await fetchWithAuth("/api/admin/merchants", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ merchantId, hasOpsAccess: !current }),
      });
      const data = await res.json();
      if (data.success) {
        setMerchants((prev) =>
          prev.map((m) => m.id === merchantId ? { ...m, hasOpsAccess: !current } : m)
        );
      }
    } catch (err) {
      console.error("Failed to toggle ops access:", err);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Derived ──

  const filtered = merchants.filter((m) =>
    !search || m.name?.toLowerCase().includes(search.toLowerCase()) || m.id.includes(search)
  );

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
            <p className="text-[11px] text-foreground/25 font-mono uppercase tracking-[0.2em]">Ops Access Control</p>
          </div>

          <div className="relative p-[1px] rounded-2xl bg-gradient-to-b from-foreground/[0.1] to-foreground/[0.02]">
            <div className="bg-card-solid rounded-2xl p-6 space-y-4">
              {adminLoginError && (
                <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-400 flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  {adminLoginError}
                </div>
              )}
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">Username</label>
                <input
                  type="text"
                  placeholder="admin"
                  value={adminLoginForm.username}
                  onChange={(e) => setAdminLoginForm({ ...adminLoginForm, username: e.target.value })}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none focus:bg-card transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider mb-1.5 block">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={adminLoginForm.password}
                  onChange={(e) => setAdminLoginForm({ ...adminLoginForm, password: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none focus:bg-card transition-all"
                />
              </div>
              <button
                onClick={handleAdminLogin}
                disabled={isAdminLoggingIn || !adminLoginForm.username || !adminLoginForm.password}
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ===== HEADER — matches admin console ===== */}
      <header className="sticky top-0 z-50 bg-background/60 backdrop-blur-2xl border-b border-border">
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
              <Link href="/admin/live" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Live Feed</Link>
              <Link href="/admin/ops-access" className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors">Ops Access</Link>
              <Link href="/admin/compliance-access" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Compliance Access</Link>
              <Link href="/admin/merchants" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Merchants</Link>
              <Link href="/admin/users" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Users</Link>
              <Link href="/admin/disputes" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Disputes</Link>
              <Link href="/admin/monitor" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Monitor</Link>
              <Link href="/admin/usdt-inr-price" className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors">Price</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-foreground/20 font-mono">
              {merchants.filter((m) => m.hasOpsAccess).length} granted
            </div>
          </div>
        </div>
      </header>

      {/* Search */}
      <div className="max-w-4xl mx-auto px-6 pt-6 pb-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" />
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground font-mono placeholder:text-foreground/15 focus:border-primary/30 focus:outline-none focus:bg-card transition-all"
          />
        </div>
      </div>

      {/* Merchant List */}
      <div className="max-w-4xl mx-auto px-6 pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-foreground/20 text-sm py-20 font-mono">No merchants found.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((merchant) => (
              <div
                key={merchant.id}
                className="relative p-[1px] rounded-xl bg-gradient-to-b from-foreground/[0.06] to-foreground/[0.02]"
              >
                <div className="bg-card-solid rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                  {/* Left: Merchant info */}
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-xl shrink-0">{merchant.emoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {merchant.name}
                        </span>
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            merchant.isOnline ? "bg-[var(--color-success)]" : "bg-foreground/10"
                          }`}
                        />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-foreground/25 font-mono">
                        <span>{merchant.id.slice(0, 8)}</span>
                        <span>{merchant.trades} trades</span>
                        <span>{merchant.volume.toFixed(0)} vol</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Toggle */}
                  <button
                    onClick={() => toggleOpsAccess(merchant.id, merchant.hasOpsAccess)}
                    disabled={togglingId === merchant.id}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-medium transition-all shrink-0 ${
                      merchant.hasOpsAccess
                        ? "bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25"
                        : "bg-card border border-border text-foreground/30 hover:bg-accent-subtle hover:text-foreground/50"
                    } disabled:opacity-30 disabled:cursor-not-allowed`}
                  >
                    {togglingId === merchant.id ? (
                      <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    ) : merchant.hasOpsAccess ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                    {merchant.hasOpsAccess ? "Ops Enabled" : "No Access"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
