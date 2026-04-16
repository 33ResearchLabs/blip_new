"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  TrendingUp,
  Zap,
  Shield,
  Star,
  Clock,
  ChevronDown,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Filter,
  RefreshCw,
  Award,
  Wallet,
} from "lucide-react";
import { BlipScoreBreakdown, SORT_OPTIONS, SortOption } from "@/lib/scoring/blipScore";
import { UserBadge } from "./UserBadge";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface MerchantInfo {
  id: string;
  display_name: string;
  business_name: string;
  rating: number;
  rating_count: number;
  total_trades: number;
  total_volume: number;
  avg_response_time_mins: number;
  is_online: boolean;
  wallet_address: string | null;
  avatar_url?: string | null;
}

interface MarketplaceOffer {
  id: string;
  merchant_id: string;
  type: "buy" | "sell";
  payment_method: "bank" | "cash";
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  is_active: boolean;
  merchant: MerchantInfo;
  bank_name?: string;
  location_name?: string;
  blipScore?: BlipScoreBreakdown;
  corridor?: string;
}

interface MarketplaceProps {
  merchantId: string;
  onTakeOffer: (offer: MarketplaceOffer) => void;
}

// Badge component for BlipScore tier
const ScoreBadge = ({ tier, score }: { tier: string; score: number }) => {
  const tierStyles = {
    diamond: "bg-white/10 text-white border-white/6",
    gold: "bg-white/10 text-white border-white/6",
    silver: "bg-gray-400/20 text-foreground/60 border-gray-400/30",
    bronze: "bg-white/10 text-white/70 border-white/6",
    unranked: "bg-gray-600/20 text-foreground/35 border-gray-600/30",
  };

  const tierIcons = {
    diamond: <Award className="w-3 h-3" />,
    gold: <Star className="w-3 h-3" />,
    silver: <Shield className="w-3 h-3" />,
    bronze: <Shield className="w-3 h-3" />,
    unranked: null,
  };

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border ${tierStyles[tier as keyof typeof tierStyles] || tierStyles.unranked}`}>
      {tierIcons[tier as keyof typeof tierIcons]}
      <span>{score}</span>
    </div>
  );
};

// Trust warning for low-trust merchants
const TrustWarning = () => (
  <div className="flex items-center gap-1 px-2 py-1 bg-white/5 text-white/70 rounded-full text-[10px]">
    <AlertTriangle className="w-3 h-3" />
    <span>New merchant</span>
  </div>
);

export function Marketplace({ merchantId, onTakeOffer }: MarketplaceProps) {
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("best");
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "buy" | "sell">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "bank" | "cash">("all");

  // Corridor reference price (updated by price feed worker via WS)
  const [refPrice, setRefPrice] = useState<{ price: number; confidence: string; updated_at: string } | null>(null);

  // Fetch initial ref price on mount
  useEffect(() => {
    fetchWithAuth("/api/corridor/dynamic-rate")
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data?.ref_price) {
          setRefPrice({
            price: data.data.ref_price,
            confidence: data.data.confidence || "low",
            updated_at: data.data.updated_at,
          });
        }
      })
      .catch(() => {}); // non-critical
  }, []);

  /** Called from parent via WS price_update events */
  const handlePriceUpdate = useCallback((data: { ref_price: number; confidence: string; updated_at: string }) => {
    setRefPrice({ price: data.ref_price, confidence: data.confidence, updated_at: data.updated_at });
  }, []);

  // Expose for parent to wire up
  // Parent can call: marketplaceRef.current?.handlePriceUpdate(data)
  // For now, we also expose it via a global event
  useEffect(() => {
    const handler = (e: CustomEvent) => handlePriceUpdate(e.detail);
    window.addEventListener("corridor-price-update" as any, handler);
    return () => window.removeEventListener("corridor-price-update" as any, handler);
  }, [handlePriceUpdate]);

  // Fetch marketplace offers
  const fetchOffers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("sort", sortBy);
      params.set("exclude_merchant_id", merchantId);

      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }
      if (paymentFilter !== "all") {
        params.set("payment_method", paymentFilter);
      }

      const res = await fetchWithAuth(`/api/marketplace/offers?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to fetch offers");
      }

      const data = await res.json();
      if (data.success) {
        setOffers(data.data || []);
      } else {
        throw new Error(data.error || "Failed to fetch offers");
      }
    } catch (err) {
      console.error("[Marketplace] Error fetching offers:", err);
      setError(err instanceof Error ? err.message : "Failed to load offers");
    } finally {
      setIsLoading(false);
    }
  }, [merchantId, sortBy, typeFilter, paymentFilter]);

  // Initial fetch and re-fetch on filter changes
  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  // Group offers by corridor
  const groupedOffers = offers.reduce((acc, offer) => {
    const corridor = offer.corridor || `USDT-AED-${offer.type}-${offer.payment_method}`;
    if (!acc[corridor]) {
      acc[corridor] = [];
    }
    acc[corridor].push(offer);
    return acc;
  }, {} as Record<string, MarketplaceOffer[]>);

  const sortOption = SORT_OPTIONS.find(o => o.value === sortBy);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-semibold">Marketplace</h2>
          <span className="text-xs text-foreground/35">({offers.length} offers)</span>
          {refPrice && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
              refPrice.confidence === "high"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : refPrice.confidence === "medium"
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-gray-500/10 text-foreground/40 border-gray-500/20"
            }`}>
              Ref: {refPrice.price.toFixed(4)} AED
            </span>
          )}
        </div>
        <button
          onClick={fetchOffers}
          disabled={isLoading}
          className="p-2 hover:bg-card rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-foreground/40 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Filters & Sorting */}
      <div className="flex flex-wrap gap-2">
        {/* Sort Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="flex items-center gap-2 px-3 py-2 bg-card-solid rounded-xl border border-white/[0.04] text-xs hover:border-border transition-colors"
          >
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span>{sortOption?.label || "Best Overall"}</span>
            <ChevronDown className="w-3.5 h-3.5 text-foreground/35" />
          </button>

          <AnimatePresence>
            {showSortDropdown && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowSortDropdown(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-0 mt-1 w-56 bg-[#1a1a1a] rounded-xl border border-white/[0.08] shadow-xl z-50 overflow-hidden"
                >
                  <div className="p-1">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setSortBy(option.value);
                          setShowSortDropdown(false);
                        }}
                        className={`w-full flex flex-col items-start px-3 py-2 rounded-lg text-left transition-colors ${
                          sortBy === option.value
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-card text-white"
                        }`}
                      >
                        <span className="text-xs font-medium">{option.label}</span>
                        <span className="text-[10px] text-foreground/35">{option.description}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Type Filter */}
        <div className="flex bg-card-solid rounded-xl p-0.5 border border-white/[0.04]">
          {(["all", "buy", "sell"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                typeFilter === type
                  ? "bg-white/[0.08] text-white"
                  : "text-foreground/35 hover:text-foreground/70"
              }`}
            >
              {type === "all" ? "All" : type === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        {/* Payment Filter */}
        <div className="flex bg-card-solid rounded-xl p-0.5 border border-white/[0.04]">
          {(["all", "bank", "cash"] as const).map((method) => (
            <button
              key={method}
              onClick={() => setPaymentFilter(method)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                paymentFilter === method
                  ? "bg-white/[0.08] text-white"
                  : "text-foreground/35 hover:text-foreground/70"
              }`}
            >
              {method === "all" ? "All" : method === "bank" ? "Bank" : "Cash"}
            </button>
          ))}
        </div>
      </div>

      {/* Ranking Notice */}
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 rounded-xl border border-primary/10">
        <TrendingUp className="w-4 h-4 text-primary" />
        <span className="text-[11px] text-foreground/40">
          Offers ranked by <span className="text-primary font-medium">BlipScore</span> — a composite of price, reliability, and speed
        </span>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
          <p className="text-sm text-foreground/35">Loading marketplace...</p>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            onClick={fetchOffers}
            className="px-4 py-2 bg-white/[0.04] hover:bg-accent-subtle rounded-lg text-xs transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && offers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Globe className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-sm font-medium text-white mb-1">No offers available</p>
          <p className="text-xs text-foreground/35 text-center max-w-xs">
            There are no active offers matching your filters. Try adjusting your filters or check back later.
          </p>
        </div>
      )}

      {/* Offers List */}
      {!isLoading && !error && offers.length > 0 && (
        <div className="space-y-3">
          {offers.map((offer) => (
            <motion.div
              key={offer.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-card-solid rounded-xl border border-white/[0.04] hover:border-border transition-all"
            >
              <div className="flex items-start gap-3">
                {/* Merchant Avatar + Name */}
                <UserBadge
                  name={offer.merchant.display_name}
                  avatarUrl={offer.merchant.avatar_url ?? undefined}
                  merchantId={offer.merchant.id}
                  size="lg"
                  showName={false}
                />

                {/* Offer Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <a href={`/merchant/profile/${offer.merchant.id}`} className="text-sm font-medium text-white truncate hover:opacity-80 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      {offer.merchant.display_name}
                    </a>
                    {offer.blipScore && (
                      <ScoreBadge tier={offer.blipScore.tier} score={offer.blipScore.total} />
                    )}
                    {offer.blipScore && !offer.blipScore.isTrusted && <TrustWarning />}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground/35 mb-2">
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-white" />
                      {offer.merchant.rating.toFixed(1)} ({offer.merchant.rating_count})
                    </span>
                    <span>•</span>
                    <span>{offer.merchant.total_trades} trades</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      ~{offer.merchant.avg_response_time_mins}m
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      offer.type === "buy"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-primary/10 text-primary"
                    }`}>
                      {offer.type === "buy" ? "BUYING USDT" : "SELLING USDT"}
                    </span>
                    <span className="px-2 py-0.5 bg-white/[0.04] rounded text-[10px] text-foreground/40">
                      {offer.payment_method === "bank" ? "Bank" : "Cash"}
                      {offer.bank_name && ` • ${offer.bank_name}`}
                      {offer.location_name && ` • ${offer.location_name}`}
                    </span>
                  </div>
                </div>

                {/* Rate & Action */}
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-white">
                    {offer.rate.toFixed(4)}
                  </p>
                  <p className="text-[10px] text-foreground/35 mb-2">
                    AED/USDT
                    {refPrice && (() => {
                      const dev = Math.abs(offer.rate - refPrice.price) / refPrice.price;
                      const devPct = (dev * 100).toFixed(1);
                      const color = dev < 0.02 ? "text-emerald-400" : dev < 0.05 ? "text-primary" : "text-red-400";
                      const sign = offer.rate >= refPrice.price ? "+" : "-";
                      return <span className={`ml-1 ${color}`}>({sign}{devPct}%)</span>;
                    })()}
                  </p>
                  <p className="text-[10px] text-foreground/35">
                    {offer.min_amount.toLocaleString()} - {offer.max_amount.toLocaleString()} USDT
                  </p>
                </div>
              </div>

              {/* Take Action */}
              <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                <div className="text-[10px] text-foreground/35">
                  Available: <span className="text-white font-medium">{offer.available_amount.toLocaleString()} USDT</span>
                </div>
                <button
                  onClick={() => onTakeOffer(offer)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary text-background rounded-lg text-xs font-medium transition-colors"
                >
                  <span>Take Offer</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Marketplace;
