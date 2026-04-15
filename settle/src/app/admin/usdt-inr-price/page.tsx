"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Wifi,
  WifiOff,
  Database,
  Globe,
  Zap,
  Clock,
  ToggleLeft,
  ToggleRight,
  Save,
} from "lucide-react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

// ============================================
// TYPES
// ============================================

interface PriceData {
  pair: string;
  label: string;
  livePrice: number;
  avgPrice: number;
  timeframe: string;
  source: "coingecko" | "binance" | "cache" | "db";
  history: { time: string; value: number }[];
  tickCount: number;
}

interface ChartPoint {
  time: string;
  displayTime: string;
  value: number;
}

// ============================================
// CONSTANTS
// ============================================

const PAIRS = [
  { id: "usdt_inr", label: "USDT / INR" },
  { id: "usdt_aed", label: "USDT / AED" },
];

const TIMEFRAMES = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
];

const REFRESH_INTERVAL = 25_000; // match worker tick rate

// ============================================
// HELPERS
// ============================================

const fiatSymbol: Record<string, string> = {
  usdt_inr: "\u20B9",
  usdt_aed: "AED ",
};

const formatPrice = (pair: string, n: number) => {
  const sym = fiatSymbol[pair] || "";
  return `${sym}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const sourceLabel: Record<string, string> = {
  coingecko: "CoinGecko",
  binance: "Binance",
  cache: "Cache",
  db: "Database",
};

const sourceIcon: Record<string, typeof Globe> = {
  coingecko: Globe,
  binance: Globe,
  cache: Database,
  db: Database,
};

// ============================================
// PAGE
// ============================================

export default function UsdtPricePage() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  const [activePair, setActivePair] = useState("usdt_inr");
  const [activeTimeframe, setActiveTimeframe] = useState("5m");
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [prevLivePrice, setPrevLivePrice] = useState<number | null>(null);

  // Secondary pair quick-glance
  const [secondaryPrice, setSecondaryPrice] = useState<PriceData | null>(null);

  // Price mode (LIVE / MANUAL)
  const [priceMode, setPriceMode] = useState<"LIVE" | "MANUAL">("LIVE");
  const [adminPrice, setAdminPrice] = useState<string>("");
  const [adminPriceSaved, setAdminPriceSaved] = useState<number | null>(null);
  const [isSavingMode, setIsSavingMode] = useState(false);
  const [modeSaveMsg, setModeSaveMsg] = useState<string | null>(null);
  const [inputError, setInputError] = useState(false);
  const [priceModeExpanded, setPriceModeExpanded] = useState(false);

  // ---------- Auth ----------
  useEffect(() => {
    setMounted(true);
  }, []);

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

  // ---------- Data fetching ----------
  const fetchPrice = useCallback(
    async (silent = false) => {
      const token = adminTokenRef.current;
      if (!token) return;

      if (!silent) setIsRefreshing(true);
      try {
        const headers = { Authorization: `Bearer ${token}` };

        // Fetch active pair + secondary pair in parallel
        const otherPair = PAIRS.find((p) => p.id !== activePair)?.id;
        const [mainRes, secRes] = await Promise.all([
          fetchWithAuth(
            `/api/admin/usdt-inr-price?pair=${activePair}&timeframe=${activeTimeframe}`,
            { headers },
          ),
          otherPair
            ? fetchWithAuth(
                `/api/admin/usdt-inr-price?pair=${otherPair}&timeframe=${activeTimeframe}`,
                { headers },
              )
            : Promise.resolve(null),
        ]);

        const mainJson = await mainRes.json();
        if (mainJson.success && mainJson.data) {
          setPriceData((prev) => {
            if (prev && prev.pair === mainJson.data.pair) {
              setPrevLivePrice(prev.livePrice);
            } else {
              setPrevLivePrice(null);
            }
            return mainJson.data;
          });
          setError(null);
        } else {
          setError(mainJson.error || "Failed to fetch price");
        }

        if (secRes) {
          const secJson = await secRes.json();
          if (secJson.success && secJson.data) setSecondaryPrice(secJson.data);
        }

        setLastRefresh(new Date());
      } catch {
        setError("Connection failed");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [activePair, activeTimeframe],
  );

  // Fetch price config (LIVE/MANUAL mode) for active pair.
  // Uses the admin-authed GET on /api/admin/set-price-mode — the public
  // /api/prices/current endpoint rejects admin tokens (it only accepts
  // user/merchant/compliance tokens via requireAuth), which used to silently
  // 401 and leave the manual price input empty after every page refresh.
  const fetchPriceConfig = useCallback(async () => {
    const token = adminTokenRef.current;
    if (!token) return;
    try {
      const res = await fetchWithAuth(
        `/api/admin/set-price-mode?pair=${activePair}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const json = await res.json();
      if (json.success && json.data) {
        setPriceMode(json.data.mode || "LIVE");
        if (json.data.adminPrice != null && json.data.adminPrice > 0) {
          setAdminPrice(String(json.data.adminPrice));
          setAdminPriceSaved(json.data.adminPrice);
        } else {
          // No manual price stored — clear stale UI state from a prior pair
          setAdminPrice("");
          setAdminPriceSaved(null);
        }
      }
    } catch {
      /* non-critical */
    }
  }, [activePair]);

  // Save price mode
  const savePriceMode = async (mode: "LIVE" | "MANUAL", price?: number) => {
    const token = adminTokenRef.current;
    if (!token) return;
    setIsSavingMode(true);
    setModeSaveMsg(null);
    try {
      const res = await fetchWithAuth("/api/admin/set-price-mode", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pair: activePair,
          price_mode: mode,
          admin_price: mode === "MANUAL" ? price : null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setPriceMode(mode);
        if (mode === "MANUAL" && price) setAdminPriceSaved(price);
        setModeSaveMsg(
          mode === "MANUAL"
            ? `Manual price set: ${price}`
            : "Switched to LIVE mode",
        );
        setTimeout(() => setModeSaveMsg(null), 3000);
      } else {
        setModeSaveMsg(json.error || "Failed to save");
      }
    } catch {
      setModeSaveMsg("Connection failed");
    } finally {
      setIsSavingMode(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      setIsLoading(true);
      fetchPrice();
      fetchPriceConfig();
    }
  }, [isAuthenticated, fetchPrice, fetchPriceConfig]);

  // Auto-refresh
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => fetchPrice(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [isAuthenticated, fetchPrice]);

  // ---------- Derived ----------
  const chartData: ChartPoint[] = priceData
    ? priceData.history.map((h) => ({
        time: h.time,
        displayTime: formatTime(h.time),
        value: h.value,
      }))
    : [];

  const values = chartData.map((p) => p.value);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 100;
  const range = maxVal - minVal;
  // When price is flat (stablecoin), use 0.5% of value as padding so the line is visible mid-chart
  const padding = range > 0 ? range * 0.15 : (minVal || 1) * 0.005;
  const yMin = parseFloat((minVal - padding).toFixed(4));
  const yMax = parseFloat((maxVal + padding).toFixed(4));

  const priceDirection =
    prevLivePrice !== null && priceData
      ? priceData.livePrice > prevLivePrice
        ? "up"
        : priceData.livePrice < prevLivePrice
          ? "down"
          : "flat"
      : "flat";

  // ---------- Render guards ----------
  if (!mounted || isCheckingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground/40 text-sm">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-foreground/60">Admin authentication required</p>
          <Link href="/admin" className="text-primary underline text-sm">
            Go to Admin Login
          </Link>
        </div>
      </div>
    );
  }

  const SourceIcon = priceData ? sourceIcon[priceData.source] || Globe : Globe;

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
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
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
                href="/admin/error-logs"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Error Logs
              </Link>
              <Link
                href="/admin/usdt-inr-price"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors"
              >
                Price
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {priceData && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border text-[10px] text-foreground/60">
                <SourceIcon className="w-3 h-3" />
                {sourceLabel[priceData.source]}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs">
              {error ? (
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-green-400" />
              )}
            </div>
            <button
              onClick={() => fetchPrice()}
              disabled={isRefreshing}
              className="p-2 hover:bg-card rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ===== CONTENT ===== */}
      <div className="p-6 max-w-6xl mx-auto space-y-5">
        {error && !priceData && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-9 w-28 rounded-lg bg-card border border-border animate-pulse"
                />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 rounded-xl bg-card border border-border animate-pulse"
                />
              ))}
            </div>
            <div className="h-80 rounded-xl bg-card border border-border animate-pulse" />
          </div>
        ) : priceData ? (
          <>
            {/* ===== PAIR TABS + TIMEFRAME SELECTOR ===== */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Pair tabs */}
              <div className="flex items-center gap-2">
                {PAIRS.map((p) => {
                  const isActive = activePair === p.id;
                  const pData =
                    p.id === priceData.pair
                      ? priceData
                      : secondaryPrice?.pair === p.id
                        ? secondaryPrice
                        : null;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        if (p.id === activePair) return;
                        // Clear everything so loading shows immediately
                        setPriceData(null);
                        setIsLoading(true);
                        setPrevLivePrice(null);
                        setPriceMode("LIVE");
                        setAdminPrice("");
                        setAdminPriceSaved(null);
                        setModeSaveMsg(null);
                        setPriceModeExpanded(false);
                        setActivePair(p.id);
                      }}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? "bg-card border border-primary/30 text-foreground shadow-sm"
                          : "bg-card/50 border border-border text-foreground/50 hover:text-foreground/70"
                      }`}
                    >
                      <span>{p.label}</span>
                      {pData && (
                        <span className="text-xs font-mono tabular-nums text-foreground/40">
                          {isActive && priceMode === "MANUAL" && adminPriceSaved
                            ? formatPrice(p.id, adminPriceSaved)
                            : formatPrice(p.id, pData.livePrice)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Timeframe buttons */}
              <div className="flex items-center gap-1 bg-card rounded-lg p-[3px] border border-border">
                <Clock className="w-3.5 h-3.5 text-foreground/30 ml-2 mr-1" />
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.id}
                    onClick={() => setActiveTimeframe(tf.id)}
                    className={`px-3 py-[5px] rounded-md text-[12px] font-medium transition-colors ${
                      activeTimeframe === tf.id
                        ? "bg-accent-subtle text-foreground"
                        : "text-foreground/40 hover:text-foreground/70"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ===== PRICE CARDS ===== */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Live Price */}
              <div className="rounded-xl bg-card border border-border p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-foreground/40 uppercase tracking-wider">
                    Live Price
                  </span>
                  {priceDirection === "up" ? (
                    <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  ) : priceDirection === "down" ? (
                    <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                  ) : null}
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums transition-colors duration-300 ${
                    priceDirection === "up"
                      ? "text-green-400"
                      : priceDirection === "down"
                        ? "text-red-400"
                        : "text-foreground"
                  }`}
                >
                  {formatPrice(priceData.pair, priceData.livePrice)}
                </div>
                <div className="text-[10px] text-foreground/30 mt-1">
                  Source: {sourceLabel[priceData.source]} &middot;{" "}
                  {priceData.tickCount} ticks in window
                </div>
              </div>

              {/* Final Price — what all users/merchants see */}
              <div className={`rounded-xl p-5 border ${
                priceMode === "MANUAL"
                  ? "bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20"
                  : "bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20"
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-medium uppercase tracking-wider ${
                    priceMode === "MANUAL" ? "text-primary/60" : "text-primary/60"
                  }`}>
                    Final Price
                  </span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    priceMode === "MANUAL"
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-green-500/10 text-green-400 border border-green-500/20"
                  }`}>
                    {priceMode}
                  </span>
                </div>
                <div className={`text-2xl font-bold tabular-nums ${
                  priceMode === "MANUAL" ? "text-primary" : "text-primary"
                }`}>
                  {priceMode === "MANUAL" && adminPriceSaved
                    ? formatPrice(priceData.pair, adminPriceSaved)
                    : formatPrice(priceData.pair, priceData.livePrice)}
                </div>
                <div className={`text-[10px] mt-1 ${
                  priceMode === "MANUAL" ? "text-primary/40" : "text-primary/40"
                }`}>
                  {priceMode === "MANUAL"
                    ? "Admin-set manual price"
                    : `Live from ${priceData.tickCount} ticks`}
                </div>
              </div>
            </div>

            {/* ===== PRICE MODE CONTROL (collapsible) ===== */}
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              {/* Collapsed header — always visible, click to expand */}
              <button
                onClick={() => setPriceModeExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-foreground/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold">Price Mode</h2>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    priceMode === "MANUAL"
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-green-500/10 text-green-400 border border-green-500/20"
                  }`}>
                    {priceMode}
                  </span>
                  {priceMode === "MANUAL" && adminPriceSaved && (
                    <span className="text-xs font-mono tabular-nums text-primary">
                      {formatPrice(priceData.pair, adminPriceSaved)}
                    </span>
                  )}
                  {modeSaveMsg && (
                    <span className="text-[10px] text-primary/70">{modeSaveMsg}</span>
                  )}
                </div>
                <svg className={`w-4 h-4 text-foreground/30 transition-transform ${priceModeExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>

              {/* Expandable body */}
              {priceModeExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-foreground/[0.04] space-y-4">
                  <p className="text-[10px] text-foreground/30">
                    Controls the final price shown to all merchants and users
                  </p>

                  <div className="flex items-center gap-4">
                    {/* Toggle */}
                    <button
                      onClick={() => {
                        if (priceMode === "LIVE") {
                          const price = parseFloat(adminPrice);
                          if (!price || price <= 0) {
                            setModeSaveMsg("Enter a valid price first");
                            setInputError(true);
                            setTimeout(() => { setModeSaveMsg(null); setInputError(false); }, 2000);
                            return;
                          }
                          savePriceMode("MANUAL", price);
                        } else {
                          savePriceMode("LIVE");
                          setAdminPrice("");
                          setAdminPriceSaved(null);
                        }
                      }}
                      disabled={isSavingMode}
                      className="flex items-center gap-2 shrink-0"
                    >
                      {priceMode === "LIVE" ? (
                        <ToggleLeft className="w-10 h-10 text-foreground/30" />
                      ) : (
                        <ToggleRight className="w-10 h-10 text-primary" />
                      )}
                      <span className={`text-xs font-bold uppercase tracking-wider ${
                        priceMode === "MANUAL" ? "text-primary" : "text-foreground/40"
                      }`}>
                        {priceMode}
                      </span>
                    </button>

                    {/* Manual price input */}
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        value={adminPrice}
                        onChange={(e) => setAdminPrice(e.target.value)}
                        placeholder={
                          priceMode === "MANUAL"
                            ? "Enter manual price..."
                            : "Type a price to switch to MANUAL"
                        }
                        step={activePair === "usdt_aed" ? "0.0001" : "0.01"}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm font-mono outline-none transition-all ${
                          inputError
                            ? "bg-green-500/[0.08] border-2 border-green-500/50 text-green-400 ring-1 ring-green-500/20 animate-pulse placeholder-green-400/60"
                            : priceMode === "MANUAL"
                              ? "bg-green-500/[0.06] border-2 border-green-500/40 text-green-400 ring-1 ring-green-500/20 focus:border-green-500/60 placeholder-green-400/40"
                              : "bg-foreground/[0.03] border border-foreground/[0.08] text-foreground/70 focus:border-primary/30"
                        }`}
                      />
                      <button
                        onClick={() => {
                          const price = parseFloat(adminPrice);
                          if (price && price > 0) {
                            savePriceMode("MANUAL", price);
                          }
                        }}
                        disabled={isSavingMode || !adminPrice}
                        className="px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 text-xs font-bold text-primary transition-all disabled:opacity-30"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ===== CHART ===== */}
            <div className="rounded-xl bg-card border border-border p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold">
                    {priceData.label} &mdash;{" "}
                    {TIMEFRAMES.find((t) => t.id === activeTimeframe)?.label}{" "}
                    Chart
                  </h2>
                  <p className="text-[10px] text-foreground/30 mt-0.5">
                    Tick-based &middot; 1 point every 25s
                  </p>
                </div>
                {lastRefresh && (
                  <span className="text-[10px] text-foreground/30">
                    Updated{" "}
                    {lastRefresh.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </span>
                )}
              </div>

              {chartData.length > 1 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.04)"
                    />
                    <XAxis
                      dataKey="displayTime"
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={50}
                    />
                    <YAxis
                      domain={[yMin, yMax]}
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => v.toFixed(2)}
                      width={55}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(0,0,0,0.85)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#fff",
                      }}
                      formatter={(value: number) => [
                        formatPrice(priceData.pair, value),
                        "Price",
                      ]}
                      labelFormatter={(label: string) => `Time: ${label}`}
                    />
                    {/* Avg price reference line */}
                    <ReferenceLine
                      y={priceData.avgPrice}
                      stroke="#6366f1"
                      strokeDasharray="6 4"
                      strokeOpacity={0.5}
                      label={{
                        value: `Avg ${priceData.avgPrice.toFixed(2)}`,
                        position: "right",
                        fill: "#6366f1",
                        fontSize: 10,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#22c55e" }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-80 flex flex-col items-center justify-center text-foreground/20 text-sm gap-2">
                  <Clock className="w-6 h-6" />
                  <span>
                    Waiting for ticks... Worker collects data every 25s.
                  </span>
                  <span className="text-[10px]">
                    Switch to a longer timeframe or wait for more data.
                  </span>
                </div>
              )}
            </div>

            {/* ===== SECONDARY PAIR CARD ===== */}
            {secondaryPrice && (
              <button
                onClick={() => {
                  setPriceData(null);
                  setIsLoading(true);
                  setPrevLivePrice(null);
                  setPriceMode("LIVE");
                  setAdminPrice("");
                  setAdminPriceSaved(null);
                  setModeSaveMsg(null);
                  setPriceModeExpanded(false);
                  setActivePair(secondaryPrice.pair);
                }}
                className="w-full rounded-xl bg-card/50 border border-border p-4 flex items-center justify-between hover:bg-card/70 transition-colors text-left"
              >
                <div>
                  <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">
                    {secondaryPrice.label}
                  </div>
                  <div className="text-lg font-bold tabular-nums">
                    {formatPrice(secondaryPrice.pair, secondaryPrice.livePrice)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">
                    Avg (
                    {TIMEFRAMES.find((t) => t.id === activeTimeframe)?.label})
                  </div>
                  <div className="text-lg font-bold tabular-nums text-primary">
                    {formatPrice(secondaryPrice.pair, secondaryPrice.avgPrice)}
                  </div>
                </div>
              </button>
            )}

            {/* ===== FOOTER ===== */}
            <div className="flex flex-wrap items-center gap-4 text-[10px] text-foreground/25">
              <span>Auto-refresh: 25s</span>
              <span>Cache: 20s server-side</span>
              <span>Fallback: CoinGecko → Binance → DB</span>
              <span>Cleanup: ticks older than 24h auto-deleted</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
