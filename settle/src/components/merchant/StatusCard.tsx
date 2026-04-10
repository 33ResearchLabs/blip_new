"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  Wallet,
  Loader2,
  X,
  AlertCircle,
  Check,
  Plus,
  Minus,
  TrendingUp,
  TrendingDown,
  Activity,
  Radio,
  ChevronRight,
  ChevronDown,
  Shield,
  Clock,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

const CORRIDORS = [
  { id: "USDT_AED", label: "USDT / AED", flag: "🇦🇪", fiat: "AED" },
  { id: "USDT_INR", label: "USDT / INR", flag: "🇮🇳", fiat: "INR" },
] as const;

interface StatusCardProps {
  balance: number;
  lockedInEscrow: number;
  todayEarnings: number;
  completedOrders: number;
  cancelledOrders: number;
  rank: number;
  isOnline: boolean;
  merchantId?: string;
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;
  onToggleOnline?: () => void;
  onOpenCorridor?: () => void;
}

interface CorridorData {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  avg_fill_time_sec: number;
  active_merchants_count: number;
  updated_at: string;
  calculation_method?: string;
  orders_analyzed?: number;
  is_fallback?: boolean;
  confidence?: "low" | "medium" | "high";
}

export const StatusCard = memo(function StatusCard({
  balance,
  lockedInEscrow,
  todayEarnings,
  completedOrders,
  cancelledOrders,
  rank,
  isOnline,
  merchantId,
  activeCorridor = "USDT_AED",
  onCorridorChange,
  onToggleOnline,
  onOpenCorridor,
}: StatusCardProps) {
  const [corridor, setCorridor] = useState<CorridorData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [customRefPrice, setCustomRefPrice] = useState<number | null>(null);
  const [showRefPriceInput, setShowRefPriceInput] = useState(false);
  const [refPriceInputValue, setRefPriceInputValue] = useState("");

  const [saedBalance, setSaedBalance] = useState(0);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [conversionDirection, setConversionDirection] = useState<
    "usdt_to_saed" | "saed_to_usdt"
  >("usdt_to_saed");
  const [conversionAmount, setConversionAmount] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionSuccess, setConversionSuccess] = useState<string | null>(
    null,
  );

  const [reputationTier, setReputationTier] = useState<{
    name: string;
    tier: string;
    score: number;
  } | null>(null);

  // Smart Market Price Panel state
  const [marketPair, setMarketPair] = useState<"usdt_aed" | "usdt_inr">(
    "usdt_aed",
  );
  const [marketTimeframe, setMarketTimeframe] = useState<
    "1m" | "5m" | "15m" | "1h"
  >("5m");
  const [marketData, setMarketData] = useState<{
    avg_5m: number;
    last_price: number;
    final_price: number;
    price_mode: string;
    currency: string;
    tickCount: number;
    source: string;
  } | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState(false);
  const [showCashMarket, setShowCashMarket] = useState(false);
  const [corridorPrices, setCorridorPrices] = useState<Record<string, number>>(
    {},
  );
  const prevAvgRef = useRef<number | null>(null);

  const [inrBalance, setInrBalance] = useState<number>(() => {
    if (typeof window !== "undefined" && merchantId) {
      const saved = localStorage.getItem(`inr_cash_${merchantId}`);
      return saved ? parseFloat(saved) : 0;
    }
    return 0;
  });
  const [showInrInput, setShowInrInput] = useState(false);
  const [inrInputValue, setInrInputValue] = useState("");
  const [inrInputMode, setInrInputMode] = useState<"add" | "subtract">("add");

  useEffect(() => {
    if (typeof window !== "undefined" && merchantId) {
      localStorage.setItem(`inr_cash_${merchantId}`, inrBalance.toString());
    }
  }, [inrBalance, merchantId]);

  // Fetch admin-set prices for both corridors
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const [aedRes, inrRes] = await Promise.all([
          fetchWithAuth("/api/corridor/dynamic-rate?pair=usdt_aed"),
          fetchWithAuth("/api/corridor/dynamic-rate?pair=usdt_inr"),
        ]);
        const prices: Record<string, number> = {};
        if (aedRes.ok) {
          const d = await aedRes.json();
          if (d.success && d.data?.ref_price)
            prices["USDT_AED"] = d.data.ref_price;
        }
        if (inrRes.ok) {
          const d = await inrRes.json();
          if (d.success && d.data?.ref_price)
            prices["USDT_INR"] = d.data.ref_price;
        }
        setCorridorPrices(prices);
      } catch {}
    };
    fetchPrices();
    const id = setInterval(fetchPrices, 30_000);
    return () => clearInterval(id);
  }, []);

  // Market price: fetch on pair/timeframe change + poll every 25s
  const fetchMarketPrice = useCallback(async () => {
    try {
      const res = await fetchWithAuth(
        `/api/price?pair=${marketPair}&timeframe=${marketTimeframe}`,
      );
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setMarketData((prev) => {
            if (prev) prevAvgRef.current = prev.avg_5m;
            return json.data;
          });
          setMarketError(false);
        }
      }
    } catch {
      setMarketError(true);
    } finally {
      setMarketLoading(false);
    }
  }, [marketPair, marketTimeframe]);

  useEffect(() => {
    setMarketLoading(true);
    fetchMarketPrice();
    const id = setInterval(fetchMarketPrice, 25_000);
    return () => clearInterval(id);
  }, [fetchMarketPrice]);

  // Reputation: fetch once on mount per merchantId (changes rarely, no polling needed)
  useEffect(() => {
    if (!merchantId) return;
    fetchWithAuth(`/api/reputation?entityId=${merchantId}&entityType=merchant`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.score) {
          setReputationTier({
            name: data.data.tierInfo.name,
            tier: data.data.score.tier,
            score: data.data.score.total_score,
          });
        }
      })
      .catch(() => {});
  }, [merchantId]);

  const fetchCorridorData = async () => {
    try {
      const res = await fetchWithAuth("/api/corridor/dynamic-rate");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setCorridor(data.data);
        }
      }
    } catch (error) {
      console.error("Failed to fetch corridor data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSaedBalance = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth(
        `/api/convert?userId=${merchantId}&type=merchant`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.balances) {
          setSaedBalance(data.balances.saed);
        }
      }
    } catch (err) {
      console.error("Failed to fetch sAED balance:", err);
    }
  }, [merchantId]);

  // Unified polling: corridor + sAED balance in a single 30s interval
  useEffect(() => {
    const fetchAll = () => {
      fetchCorridorData();
      if (merchantId) fetchSaedBalance();
    };
    fetchAll(); // initial fetch
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [merchantId, fetchSaedBalance]);

  const handleConvert = async () => {
    const amount = parseFloat(conversionAmount);
    if (isNaN(amount) || amount <= 0) {
      setConversionError("Please enter a valid amount");
      return;
    }
    if (conversionDirection === "usdt_to_saed" && amount > balance) {
      setConversionError("Insufficient USDT balance");
      return;
    }
    if (conversionDirection === "saed_to_usdt") {
      const saedInAED = saedBalance / 100;
      if (amount > saedInAED) {
        setConversionError("Insufficient sAED balance");
        return;
      }
    }

    setIsConverting(true);
    setConversionError(null);

    try {
      const amountInSmallestUnits =
        conversionDirection === "usdt_to_saed"
          ? Math.floor(amount * 1_000_000)
          : Math.floor(amount * 100);

      const response = await fetchWithAuth("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: conversionDirection,
          amount: amountInSmallestUnits,
          accountType: "merchant",
          accountId: merchantId,
          idempotencyKey: `${merchantId}-${Date.now()}-${Math.random()}`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        await fetchSaedBalance();
        const successMsg =
          conversionDirection === "usdt_to_saed"
            ? `Converted ${amount.toFixed(6)} USDT to sAED`
            : `Converted ${amount.toFixed(2)} AED to USDT`;
        setConversionSuccess(successMsg);
        setShowConversionModal(false);
        setConversionAmount("");
        setTimeout(() => setConversionSuccess(null), 3000);
      } else {
        setConversionError(data.error || "Conversion failed");
      }
    } catch (err) {
      console.error("Conversion error:", err);
      setConversionError("Network error. Please try again.");
    } finally {
      setIsConverting(false);
    }
  };

  const handleInrSubmit = () => {
    const amount = parseFloat(inrInputValue);
    if (isNaN(amount) || amount <= 0) return;
    setInrBalance((prev) =>
      inrInputMode === "add" ? prev + amount : Math.max(0, prev - amount),
    );
    setInrInputValue("");
    setShowInrInput(false);
  };

  const totalTrades = completedOrders + cancelledOrders;
  const winRate = totalTrades > 0 ? (completedOrders / totalTrades) * 100 : 0;
  const refPrice = customRefPrice || corridor?.ref_price || 3.67;
  const aedEquivalent = balance * refPrice;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-foreground/20 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Live ticker strip — sticky at top while sidebar scrolls */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-3 py-2.5 bg-background border-b border-foreground/[0.04] text-[9px] font-mono overflow-hidden"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div className="absolute inset-0 shimmer pointer-events-none" />
        <div className="flex items-center gap-4 relative z-10">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-live-dot" />
            <span className="text-primary/80 font-bold tracking-wide">
              LIVE
            </span>
          </div>
          <div className="flex items-center gap-3">
            {reputationTier && (
              <span className="flex items-center gap-0.5">
                <Shield className="w-2.5 h-2.5 text-primary/60" />
                <span className="text-primary/70 font-bold uppercase">
                  {reputationTier.name}
                </span>
              </span>
            )}
            <span className="text-foreground/25">
              RNK{" "}
              <span className="text-foreground/70 font-bold">
                {rank > 0 ? `#${rank}` : "—"}
              </span>
            </span>
            <span className="text-foreground/25">
              WIN{" "}
              <span className="text-foreground/70 font-bold">
                {winRate > 0 ? `${winRate.toFixed(0)}%` : "—"}
              </span>
            </span>
            <span className="text-foreground/25">
              FILL{" "}
              <span className="text-foreground/70 font-bold">
                {corridor?.avg_fill_time_sec
                  ? `${corridor.avg_fill_time_sec}s`
                  : "—"}
              </span>
            </span>
          </div>
        </div>
        {/* Active toggle */}
        <button
          onClick={onToggleOnline}
          className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full transition-all border ${
            isOnline
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-foreground/[0.03] border-foreground/[0.08] text-foreground/30"
          }`}
          title={isOnline ? "ACTIVE" : "OFFLINE"}
        >
          <Radio className={`w-3 h-3 ${isOnline ? "animate-live-dot" : ""}`} />
        </button>
      </div>

      {/* Main balance hero */}
      <div className="flex flex-col items-center justify-center px-4 py-3 relative">
        {/* Ambient glow behind amount */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-48 h-24 bg-primary/[0.03] rounded-full blur-[60px]" />
        </div>

        {/* USDT Label */}
        <div className="flex items-center gap-1.5 mb-1 relative z-10">
          <Wallet className="w-3 h-3 text-foreground/20" />
          <span className="text-[10px] text-foreground/30 font-mono uppercase tracking-widest">
            Available Balance
          </span>
        </div>

        {/* Big USDT Amount */}
        <div className="relative z-10 text-center">
          <div className="text-4xl font-black text-white font-mono tabular-nums tracking-tight leading-none">
            {balance.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}
          </div>
          <div className="text-[11px] text-foreground/20 font-mono mt-1 tabular-nums">
            ≈{" "}
            {aedEquivalent.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}{" "}
            AED
          </div>
        </div>

        {/* 24h Earnings badge */}
        {todayEarnings !== 0 && (
          <div className="mt-2.5 flex items-center gap-1 px-2 py-0.5 bg-primary/[0.06] border border-primary/15 rounded-full relative z-10">
            <TrendingUp className="w-2.5 h-2.5 text-primary" />
            <span className="text-[10px] font-bold text-primary font-mono tabular-nums">
              {todayEarnings > 0 ? "+" : ""}
              {todayEarnings.toFixed(2)} USDT
            </span>
            <span className="text-[9px] text-primary/50 font-mono">24h</span>
          </div>
        )}

        {/* Locked escrow indicator */}
        {lockedInEscrow > 0 && (
          <div className="mt-1.5 text-[9px] text-foreground/15 font-mono relative z-10">
            {lockedInEscrow.toFixed(0)} locked in escrow
          </div>
        )}
      </div>

      {/* Bottom section — corridor + secondary balances + rate */}
      <div className="px-3 pb-2.5 space-y-1.5">
        {/* Active Corridor Selector */}
        <div className="glass-card rounded-lg p-2">
          <span className="text-[9px] text-foreground/25 font-mono uppercase tracking-wider block mb-1.5">
            corridir Pair
          </span>
          <div className="flex gap-1.5">
            {CORRIDORS.map((c) => {
              const isActive = activeCorridor === c.id;
              const price = corridorPrices[c.id];
              return (
                <button
                  key={c.id}
                  onClick={() => onCorridorChange?.(c.id)}
                  className={`flex-1 py-2 px-2 rounded-lg text-center transition-all border ${
                    isActive
                      ? "bg-primary/[0.08] border-primary/25 ring-1 ring-primary/10"
                      : "bg-foreground/[0.02] border-foreground/[0.06] hover:bg-foreground/[0.05]"
                  }`}
                >
                  <span
                    className={`text-[10px] font-bold font-mono block ${isActive ? "text-primary" : "text-foreground/35"}`}
                  >
                    {c.fiat}
                  </span>
                  {price ? (
                    <span
                      className={`text-[13px] font-black font-mono tabular-nums block mt-0.5 ${isActive ? "text-foreground" : "text-foreground/25"}`}
                    >
                      {c.fiat === "INR" ? "₹" : ""}
                      {price.toFixed(2)}
                      {c.fiat === "AED" ? " AED" : ""}
                    </span>
                  ) : (
                    <span className="text-[10px] text-foreground/15 font-mono block mt-0.5">
                      —
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cash & Market — collapsible */}
        <button
          onClick={() => setShowCashMarket(!showCashMarket)}
          className="w-full flex items-center justify-between py-1.5 px-2.5 glass-card rounded-lg hover:bg-foreground/[0.04] transition-all"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-foreground/30 font-mono uppercase tracking-wider">
              Cash & Market
            </span>
            {!showCashMarket && inrBalance > 0 && (
              <span className="text-[9px] text-foreground/40 font-mono">
                ₹{inrBalance.toLocaleString()}
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-3 h-3 text-foreground/25 transition-transform duration-200 ${showCashMarket ? "" : "-rotate-90"}`}
          />
        </button>

        {showCashMarket && (
          <div className="space-y-1.5">
            {/* INR row */}
            <div className="grid grid-cols-1 gap-1.5">
              {/* INR */}
              <div className="glass-card rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-foreground/25 font-mono">
                    INR CASH
                  </span>
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => {
                        setInrInputMode("add");
                        setShowInrInput(true);
                      }}
                      className="p-0.5 rounded bg-foreground/[0.04] hover:bg-accent-subtle border border-foreground/[0.06] text-foreground/25 transition-all"
                    >
                      <Plus className="w-2 h-2" />
                    </button>
                    <button
                      onClick={() => {
                        setInrInputMode("subtract");
                        setShowInrInput(true);
                      }}
                      className="p-0.5 rounded bg-foreground/[0.04] hover:bg-accent-subtle border border-foreground/[0.06] text-foreground/25 transition-all"
                    >
                      <Minus className="w-2 h-2" />
                    </button>
                  </div>
                </div>
                {showInrInput ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-foreground/25 font-mono">
                      {inrInputMode === "add" ? "+" : "-"}
                    </span>
                    <input
                      type="number"
                      value={inrInputValue}
                      onChange={(e) => setInrInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInrSubmit();
                        if (e.key === "Escape") setShowInrInput(false);
                      }}
                      placeholder="0"
                      className="w-14 bg-foreground/[0.03] border border-foreground/[0.08] rounded px-1 py-0.5 text-[10px] text-white font-mono outline-none focus:border-white/20"
                      autoFocus
                    />
                    <button
                      onClick={handleInrSubmit}
                      className="px-1 py-0.5 rounded bg-foreground/[0.06] border border-foreground/[0.08] text-[8px] text-foreground/50 font-bold"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <span className="text-sm font-bold text-foreground/70 font-mono tabular-nums">
                    {inrBalance > 0 ? `₹${inrBalance.toLocaleString()}` : "₹0"}
                  </span>
                )}
              </div>
            </div>

            {/* Success toast */}
            {conversionSuccess && (
              <div className="flex items-center gap-1.5 py-1 px-2 bg-primary/[0.06] border border-primary/20 rounded">
                <Check className="w-3 h-3 text-primary" />
                <span className="text-[9px] text-primary">
                  {conversionSuccess}
                </span>
              </div>
            )}

            {/* Smart Market Price Panel */}
            <div className="glass-card rounded-lg p-2.5 space-y-2">
              {/* Header: title + pair tabs */}
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-foreground/25 font-mono uppercase tracking-wider">
                  Market
                </span>
                <div className="flex items-center gap-0.5 bg-foreground/[0.03] rounded-md p-[2px]">
                  {(["usdt_aed", "usdt_inr"] as const).map((pair) => (
                    <button
                      key={pair}
                      onClick={() => {
                        if (pair !== marketPair) {
                          setMarketData(null);
                          setMarketPair(pair);
                        }
                      }}
                      className={`px-2 py-[3px] rounded text-[8px] font-mono font-bold transition-all ${
                        marketPair === pair
                          ? "bg-foreground/[0.08] text-foreground/70"
                          : "text-foreground/25 hover:text-foreground/40"
                      }`}
                    >
                      {pair === "usdt_aed" ? "USDT/AED" : "USDT/INR"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeframe pills */}
              <div className="flex items-center gap-0.5">
                {/* <Clock className="w-2.5 h-2.5 text-foreground/15 mr-0.5" /> */}
                {/* {(['1m', '5m', '15m', '1h'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => { if (tf !== marketTimeframe) { setMarketData(null); setMarketTimeframe(tf); } }}
                className={`px-1.5 py-[2px] rounded text-[8px] font-mono font-bold transition-all ${
                  marketTimeframe === tf
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-foreground/20 hover:text-foreground/35'
                }`}
              >
                {tf}
              </button>
            ))} */}
              </div>

              {/* Price display */}
              {marketLoading && !marketData ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="w-3.5 h-3.5 text-foreground/15 animate-spin" />
                </div>
              ) : marketError && !marketData ? (
                <div className="text-[9px] text-foreground/25 font-mono text-center py-2">
                  Market unavailable
                </div>
              ) : marketData ? (
                <div className="space-y-1.5">
                  {/* Final price — admin-set, primary */}
                  <div>
                    {/* <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8px] text-foreground/25 font-mono">
                    Price
                  </span>
                  <span
                    className={`text-[7px] font-mono px-1 py-[1px] rounded ${
                      marketData.price_mode === "MANUAL"
                        ? "bg-primary/10 text-primary border border-primary/15"
                        : "bg-green-500/10 text-green-400 border border-green-500/15"
                    }`}
                  >
                    {marketData.price_mode}
                  </span>
                </div> */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-lg font-bold font-mono tabular-nums ${
                          marketData.price_mode === "MANUAL"
                            ? "text-primary"
                            : "text-white"
                        }`}
                      >
                        {marketPair === "usdt_inr" ? "₹" : ""}
                        {marketData.final_price.toFixed(2)}
                        {marketPair === "usdt_aed" ? " AED" : ""}
                      </span>
                      {prevAvgRef.current !== null &&
                        prevAvgRef.current !== marketData.avg_5m &&
                        (marketData.avg_5m > prevAvgRef.current ? (
                          <TrendingUp className="w-3 h-3 text-green-400" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-red-400" />
                        ))}
                    </div>
                  </div>

                  {/* Avg + Last price — secondary row */}
                  {/* <div className="flex items-center justify-between">
                <span className="text-[8px] text-foreground/20 font-mono">
                  Avg ({marketTimeframe})
                </span>
                <span className="text-[10px] text-foreground/40 font-mono tabular-nums">
                  {marketPair === "usdt_inr" ? "₹" : ""}
                  {marketData.avg_5m.toFixed(2)}
                  {marketPair === "usdt_aed" ? " AED" : ""}
                </span>
              </div> */}
                  {/* <div className="flex items-center justify-between">
                <span className="text-[8px] text-foreground/20 font-mono">
                  Last Price
                </span>
                <span className="text-[10px] text-foreground/40 font-mono tabular-nums">
                  {marketPair === "usdt_inr" ? "₹" : ""}
                  {marketData.last_price.toFixed(2)}
                  {marketPair === "usdt_aed" ? " AED" : ""}
                </span>
              </div> */}

                  {/* Divider */}
                  <div className="border-t border-foreground/[0.04]" />

                  {/* Your Price input */}
                  {!showRefPriceInput ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[8px] text-foreground/20 font-mono">
                          Your Price
                        </span>
                        {customRefPrice && marketData.avg_5m > 0 && (
                          <span
                            className={`ml-1.5 text-[8px] font-mono font-bold ${
                              ((customRefPrice - marketData.avg_5m) /
                                marketData.avg_5m) *
                                100 >
                              0
                                ? "text-red-400"
                                : "text-green-400"
                            }`}
                          >
                            {((customRefPrice - marketData.avg_5m) /
                              marketData.avg_5m) *
                              100 >
                            0
                              ? "+"
                              : ""}
                            {(
                              ((customRefPrice - marketData.avg_5m) /
                                marketData.avg_5m) *
                              100
                            ).toFixed(2)}
                            %
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setShowRefPriceInput(true)}
                        className="px-2 py-1 rounded bg-foreground/[0.04] hover:bg-accent-subtle border border-primary/20 text-[9px] text-primary font-bold transition-all"
                      >
                        {customRefPrice
                          ? `${marketPair === "usdt_inr" ? "₹" : ""}${customRefPrice.toFixed(2)}${marketPair === "usdt_aed" ? " AED" : ""}`
                          : "SET PRICE"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={refPriceInputValue}
                          onChange={(e) =>
                            setRefPriceInputValue(e.target.value)
                          }
                          placeholder={marketData.avg_5m.toFixed(2)}
                          step={marketPair === "usdt_aed" ? "0.0001" : "0.01"}
                          className="flex-1 bg-foreground/[0.02] border border-foreground/[0.06] rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-primary/30"
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            const price = parseFloat(refPriceInputValue);
                            if (!isNaN(price) && price > 0) {
                              setCustomRefPrice(price);
                              setRefPriceInputValue("");
                              setShowRefPriceInput(false);
                            }
                          }}
                          className="px-2 py-1 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded text-[9px] text-primary font-bold"
                        >
                          Set
                        </button>
                        <button
                          onClick={() => {
                            setCustomRefPrice(null);
                            setRefPriceInputValue("");
                            setShowRefPriceInput(false);
                          }}
                          className="px-1 py-1 text-foreground/15 hover:text-foreground/30"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      {/* Live spread preview */}
                      {refPriceInputValue && marketData.avg_5m > 0 && (
                        <div className="text-[8px] font-mono text-foreground/25">
                          Spread:{" "}
                          <span
                            className={`font-bold ${
                              ((parseFloat(refPriceInputValue) -
                                marketData.avg_5m) /
                                marketData.avg_5m) *
                                100 >
                              0
                                ? "text-red-400"
                                : "text-green-400"
                            }`}
                          >
                            {((parseFloat(refPriceInputValue) -
                              marketData.avg_5m) /
                              marketData.avg_5m) *
                              100 >
                            0
                              ? "+"
                              : ""}
                            {(
                              ((parseFloat(refPriceInputValue) -
                                marketData.avg_5m) /
                                marketData.avg_5m) *
                              100
                            ).toFixed(2)}
                            %
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tick count indicator */}
                  <div className="text-[7px] text-foreground/10 font-mono text-right">
                    {marketData.tickCount} ticks · {marketData.source}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Corridor button */}
        <button
          onClick={onOpenCorridor}
          className="w-full flex items-center justify-between py-1.5 px-2.5 glass-card rounded-lg hover:bg-foreground/[0.04] transition-all group"
        >
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-foreground/20" />
            <span className="text-[9px] text-foreground/30 font-mono uppercase tracking-wider">
              Corridor
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-foreground/40 font-mono tabular-nums">
              {corridor?.active_merchants_count || 0} online · vol{" "}
              {corridor?.volume_5m ? corridor.volume_5m.toFixed(0) : "0"}
            </span>
            <ChevronRight className="w-3 h-3 text-foreground/15 group-hover:text-foreground/30 transition-colors" />
          </div>
        </button>

        {/* Quick stats row */}
        <div className="flex items-center justify-between px-1 text-[9px] font-mono text-foreground/20">
          <span>{completedOrders} done</span>
          <span className="text-white/10">·</span>
          <span>{cancelledOrders} cancelled</span>
          <span className="text-white/10">·</span>
          <span>{totalTrades} total</span>
        </div>
      </div>

      {/* sAED conversion modal removed — not in this version */}
    </div>
  );
});
