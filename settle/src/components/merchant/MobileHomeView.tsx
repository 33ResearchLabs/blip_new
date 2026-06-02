"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  TrendingUp,
  Clock,
  Lock,
  Unlock,
  ArrowDownRight,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  QrCode,
  Loader2 as Loader2Icon,
  History,
  Plus,
  Minus,
  ChevronDown,
  Check,
  X,
  Copy,
  Settings,
  Key,
  Download,
  Trash2,
  Building2,
  DollarSign,
  CreditCard,
  Smartphone,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { BalanceSparkline } from "./BalanceSparkline";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { loadSwaps, type SwapRecord } from "@/lib/wallet/swapHistory";
import { loadDeposits, type DepositRecord } from "@/lib/wallet/depositHistory";
import {
  loadEncryptedWallet,
  decryptWallet,
  exportPrivateKey,
  clearEncryptedWallet,
  clearSessionKeypair,
} from "@/lib/wallet/embeddedWallet";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatCount, formatFiat } from "@/lib/format";
import { useCorridorPrices, resolveCorridorRef } from "@/hooks/useCorridorPrices";
import type { Order } from "@/types/merchant";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { OnboardingSetupCard } from "@/components/merchant/OnboardingSetupCard";
import { SwapModal } from "@/components/merchant/SwapModal";
import { DepositModal } from "@/components/merchant/DepositModal";
import { SendModal } from "@/components/merchant/SendModal";
import { WalletActionsMenu } from "@/components/merchant/WalletActionsMenu";

interface MobileHomeViewProps {
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  merchantInfo: any;
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];

  // Navigation
  setMobileView: (v: any) => void;
  onShowWalletModal: () => void;
  // Opens the full wallet overlay (where the unlock / setup UI lives).
  // Falls back to onShowWalletModal when not provided.
  onOpenWallet?: () => void;

  // Embedded wallet lock state — gates the balance display + reveals an unlock CTA
  embeddedWalletState?: "initializing" | "none" | "locked" | "unlocked";
  /** Active fiat corridor (e.g. "USDT_AED" or "USDT_INR"). Drives which
   *  market the merchant is trading in. Owner is the parent merchant
   *  page so a change here ripples into MerchantNavbar / order create
   *  flows that read the same prop. */
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;

  // Quick-action handlers wired into the balance-card button row.
  // Buy/Sell preselect the trade side and open the create-trade modal.
  onStartTrade?: (side: "buy" | "sell") => void;

  // Opens the full PaymentMethodModal (same one the desktop uses).
  // When omitted, the "Manage" link inside the default-payment card is hidden.
  onOpenPaymentMethods?: () => void;
}

type MerchantPaymentMethod = {
  id: string;
  type: "bank" | "cash" | "crypto" | "card" | "mobile" | "upi";
  name: string;
  details: string;
  is_default: boolean;
};

const PM_TYPE_META: Record<
  MerchantPaymentMethod["type"],
  { label: string; Icon: typeof Building2; cls: string }
> = {
  bank: { label: "Bank Account", Icon: Building2, cls: "text-foreground/60 bg-foreground/[0.04] border-foreground/[0.08]" },
  cash: { label: "Cash Meeting", Icon: DollarSign, cls: "text-foreground/60 bg-foreground/[0.04] border-foreground/[0.08]" },
  crypto: { label: "Crypto Wallet", Icon: Wallet, cls: "text-foreground/60 bg-foreground/[0.04] border-foreground/[0.08]" },
  card: { label: "Card Payment", Icon: CreditCard, cls: "text-foreground/60 bg-foreground/[0.04] border-foreground/[0.08]" },
  mobile: { label: "Mobile Money", Icon: Smartphone, cls: "text-foreground/60 bg-foreground/[0.04] border-foreground/[0.08]" },
  upi: { label: "UPI", Icon: Smartphone, cls: "text-foreground/60 bg-foreground/[0.04] border-foreground/[0.08]" },
};

export function MobileHomeView({
  effectiveBalance,
  totalTradedVolume,
  todayEarnings,
  pendingEarnings,
  merchantInfo,
  pendingOrders,
  ongoingOrders,
  completedOrders,
  setMobileView,
  onShowWalletModal,
  onOpenWallet,
  embeddedWalletState,
  activeCorridor = "USDT_INR",
  onCorridorChange,
  onStartTrade,
  onOpenPaymentMethods,
}: MobileHomeViewProps) {
  const openWallet = onOpenWallet ?? onShowWalletModal;

  // Read SOL balance directly from the wallet context so we can render
  // it inline next to the USDT balance — saves a tile in the action
  // grid and matches the "everything you need to know in one card" UX.
  const solanaWallet = useSolanaWallet();
  const [cardVariant, setCardVariant] = useState<1 | 2 | 3>(3);
  const [addressCopied, setAddressCopied] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Bumps when a swap completes so the Recent Activity feed re-reads
  // localStorage. Initial mount pulls swaps once via useMemo (below).
  const [swapHistoryTick, setSwapHistoryTick] = useState(0);
  // Same pattern for cross-chain deposits — bumped from the LI.FI bridge
  // success callback so a freshly-landed deposit shows in the activity
  // feed without waiting for the on-chain TX poll to find the signature.
  const [depositHistoryTick, setDepositHistoryTick] = useState(0);

  const merchantIdForWallet: string | undefined = merchantInfo?.id;

  // Corridor catalogue — list of all USDT⇄fiat markets. Only entries
  // with `available: true` are selectable; the rest render as
  // "Coming soon" so merchants know the roadmap without being able to
  // pick a market that has no liquidity yet.
  const CORRIDORS: {
    id: string;
    fiat: string;
    country: string;
    flag: string;
    available?: boolean;
  }[] = [
    { id: "USDT_INR", fiat: "INR", country: "India", flag: "🇮🇳", available: true },
    { id: "USDT_AED", fiat: "AED", country: "United Arab Emirates", flag: "🇦🇪" },
    { id: "USDT_USD", fiat: "USD", country: "United States", flag: "🇺🇸" },
    { id: "USDT_EUR", fiat: "EUR", country: "Eurozone", flag: "🇪🇺" },
    { id: "USDT_GBP", fiat: "GBP", country: "United Kingdom", flag: "🇬🇧" },
    { id: "USDT_PKR", fiat: "PKR", country: "Pakistan", flag: "🇵🇰" },
    { id: "USDT_NGN", fiat: "NGN", country: "Nigeria", flag: "🇳🇬" },
    { id: "USDT_BRL", fiat: "BRL", country: "Brazil", flag: "🇧🇷" },
    { id: "USDT_PHP", fiat: "PHP", country: "Philippines", flag: "🇵🇭" },
    { id: "USDT_KES", fiat: "KES", country: "Kenya", flag: "🇰🇪" },
    { id: "USDT_TRY", fiat: "TRY", country: "Turkey", flag: "🇹🇷" },
    { id: "USDT_VND", fiat: "VND", country: "Vietnam", flag: "🇻🇳" },
    { id: "USDT_THB", fiat: "THB", country: "Thailand", flag: "🇹🇭" },
    { id: "USDT_IDR", fiat: "IDR", country: "Indonesia", flag: "🇮🇩" },
    { id: "USDT_ZAR", fiat: "ZAR", country: "South Africa", flag: "🇿🇦" },
    { id: "USDT_MXN", fiat: "MXN", country: "Mexico", flag: "🇲🇽" },
  ];
  const activeCorridorMeta =
    CORRIDORS.find((c) => c.id === activeCorridor) ?? CORRIDORS[0];

  const [corridorPickerOpen, setCorridorPickerOpen] = useState(false);
  const [corridorSearch, setCorridorSearch] = useState("");
  const filteredCorridors = useMemo(() => {
    const q = corridorSearch.trim().toLowerCase();
    if (!q) return CORRIDORS;
    return CORRIDORS.filter(
      (c) =>
        c.fiat.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridorSearch]);

  // Merchant custom rate — informational only for now (no backend
  // endpoint to write merchants.synthetic_rate; that column is flagged
  // "internal-only config" in repositories/merchants.ts). Persisted to
  // localStorage so the merchant's preferred quote is at least visible
  // to them across reloads. TODO: build PATCH /api/merchant/:id/rate
  // and remove the localStorage fallback once the endpoint lands.
  const [showRatePanel, setShowRatePanel] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [savedRate, setSavedRate] = useState<number | null>(null);
  const rateStorageKey = merchantIdForWallet
    ? `merchantPreferredRate:${merchantIdForWallet}`
    : null;
  useEffect(() => {
    if (!rateStorageKey) return;
    const raw = localStorage.getItem(rateStorageKey);
    const n = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(n) && n > 0) setSavedRate(n);
  }, [rateStorageKey]);
  const handleSaveRate = () => {
    if (!rateStorageKey) return;
    const n = parseFloat(rateInput);
    if (!Number.isFinite(n) || n <= 0) return;
    localStorage.setItem(rateStorageKey, String(n));
    setSavedRate(n);
    setRateInput("");
    setShowRatePanel(false);
  };

  // Recent Activity tab — Trades is the default so the panel doesn't
  // fire the on-chain fetch on first mount (the merchant's own trades
  // are already in memory). TX is fetched lazily on first activation
  // of the TX or All tab and then cached for the wallet — no refetch
  // unless the address changes.
  const [activityTab, setActivityTab] = useState<"all" | "trades" | "tx">("trades");
  interface OnChainTx {
    signature: string;
    blockTime: number | null;
    err: unknown;
    slot: number;
  }
  const TX_LIMIT = 10;
  const [onchainTxs, setOnchainTxs] = useState<OnChainTx[] | null>(null);
  const [onchainTxsLoading, setOnchainTxsLoading] = useState(false);
  const [onchainTxsError, setOnchainTxsError] = useState<string | null>(null);
  const onchainTxsFetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    const addr = solanaWallet?.walletAddress;
    if (!addr) return;
    if (activityTab !== "tx" && activityTab !== "all") return;
    // Single-fetch cache: if we already loaded for this address, skip.
    if (onchainTxsFetchedForRef.current === addr) return;
    let cancelled = false;
    (async () => {
      setOnchainTxsLoading(true);
      setOnchainTxsError(null);
      try {
        const res = await fetch("/api/rpc", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignaturesForAddress",
            params: [addr, { limit: TX_LIMIT }],
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.error) throw new Error(json.error.message || "RPC error");
        setOnchainTxs(json.result ?? []);
        onchainTxsFetchedForRef.current = addr;
      } catch (e) {
        if (cancelled) return;
        setOnchainTxsError(
          e instanceof Error ? e.message : "Failed to load transactions",
        );
      } finally {
        if (!cancelled) setOnchainTxsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activityTab, solanaWallet?.walletAddress]);

  const explorerBaseUrl = (() => {
    const network =
      typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_SOLANA_NETWORK
        : undefined;
    const isMainnet = network === "mainnet-beta" || network === "mainnet";
    return isMainnet
      ? "https://solscan.io"
      : "https://solscan.io/?cluster=devnet";
  })();

  // ─── INR cash (off-chain physical cash the merchant holds) ─────────
  // Persisted per merchant in localStorage — same key the desktop
  // StatusCard uses, so the value stays in sync across viewports.
  const merchantId: string | undefined = merchantInfo?.id;
  const [inrBalance, setInrBalance] = useState<number>(0);
  const [showInrPanel, setShowInrPanel] = useState(false);
  const [inrInputValue, setInrInputValue] = useState("");
  const [inrInputMode, setInrInputMode] = useState<"add" | "subtract">("add");

  useEffect(() => {
    if (typeof window === "undefined" || !merchantId) return;
    const saved = localStorage.getItem(`inr_cash_${merchantId}`);
    setInrBalance(saved ? parseFloat(saved) || 0 : 0);
  }, [merchantId]);

  useEffect(() => {
    if (typeof window === "undefined" || !merchantId) return;
    localStorage.setItem(`inr_cash_${merchantId}`, inrBalance.toString());
  }, [merchantId, inrBalance]);

  const MAX_INR_INPUT = 100_000_000; // 10 crore ceiling per submission
  const handleInrSubmit = () => {
    const amount = parseFloat(inrInputValue);
    if (Number.isNaN(amount) || amount <= 0) return;
    if (amount > MAX_INR_INPUT) return;
    setInrBalance((prev) =>
      inrInputMode === "add" ? prev + amount : Math.max(0, prev - amount),
    );
    setInrInputValue("");
    setShowInrPanel(false);
  };

  // Payment methods — surface the default one inline on the home card,
  // with an expand toggle for the rest and a "Manage" link that opens
  // the full PaymentMethodModal (same one the desktop uses).
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>([]);
  const [paymentMethodsLoaded, setPaymentMethodsLoaded] = useState(false);
  const [paymentMethodsExpanded, setPaymentMethodsExpanded] = useState(false);
  useEffect(() => {
    if (!merchantIdForWallet) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/merchant/${merchantIdForWallet}/payment-methods`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (json?.success && Array.isArray(json.data)) {
          setPaymentMethods(
            json.data.map((m: any) => ({
              id: String(m.id),
              type: m.type,
              name: String(m.name ?? ""),
              details: String(m.details ?? ""),
              is_default: !!m.is_default,
            })),
          );
        }
      } catch {
        // Swallow — the card just hides itself when there's no data.
      } finally {
        if (!cancelled) setPaymentMethodsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [merchantIdForWallet]);
  const defaultPaymentMethod =
    paymentMethods.find((m) => m.is_default) ?? paymentMethods[0] ?? null;
  const otherPaymentMethods = paymentMethods.filter(
    (m) => m.id !== defaultPaymentMethod?.id,
  );

  // ── Live corridor price for the market switch pill ──────────────────
  const corridorPrices = useCorridorPrices();
  const liveRate = resolveCorridorRef(corridorPrices, activeCorridor, activeCorridorMeta.fiat);

  // ── Balance count-up on mount ─────────────────────────────────────────
  const [displayBalance, setDisplayBalance] = useState(effectiveBalance ?? 0);
  const countUpTarget = useRef(effectiveBalance ?? 0);
  useEffect(() => {
    const target = effectiveBalance ?? 0;
    countUpTarget.current = target;
    const dur = 1150, t0 = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setDisplayBalance(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplayBalance(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [effectiveBalance]);

  // ── Greeting ──────────────────────────────────────────────────────────
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
  const avatarLetter = (merchantInfo?.display_name || merchantInfo?.business_name || "M")[0].toUpperCase();

  // Recent activity — merge pending + ongoing + recent completed
  const recentOrders = [
    ...pendingOrders.slice(0, 5),
    ...ongoingOrders.slice(0, 5),
    ...completedOrders.slice(0, 6),
  ].slice(0, 6);

  return (
    <div className="space-y-4" style={{ position: "relative" }}>

      {/* ── Corridor picker sheet ── */}
      {corridorPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { setCorridorPickerOpen(false); setCorridorSearch(""); }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full md:max-w-sm bg-background border-t md:border border-foreground/[0.08] md:rounded-2xl rounded-t-2xl p-4 max-h-[70vh] flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">Select market</h3>
              <button
                onClick={() => { setCorridorPickerOpen(false); setCorridorSearch(""); }}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={corridorSearch}
              onChange={(e) => setCorridorSearch(e.target.value)}
              placeholder="Search currency or country…"
              maxLength={50}
              autoFocus
              className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder-foreground/30 focus:outline-none focus:border-foreground/30 mb-2"
            />
            <div className="overflow-y-auto -mx-1 px-1 space-y-1">
              {filteredCorridors.length === 0 ? (
                <p className="text-[12px] text-foreground/40 text-center py-6">No markets match "{corridorSearch}"</p>
              ) : (
                filteredCorridors.map((c) => {
                  const isActive = activeCorridor === c.id;
                  const available = !!c.available;
                  return (
                    <button
                      key={c.id}
                      disabled={!available}
                      onClick={() => {
                        if (!available) return;
                        // onCorridorChange is declared optional on the prop
                        // type — outer wrapper at line ~293 already guards
                        // its render, but TS still requires the call to be
                        // optional-chained.
                        onCorridorChange?.(c.id);
                        setCorridorPickerOpen(false);
                        setCorridorSearch("");
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        isActive
                          ? "bg-foreground/[0.08]"
                          : available
                            ? "hover:bg-foreground/[0.04]"
                            : "opacity-40 cursor-not-allowed"
                      }`}
                    >
                      <span className="text-lg">{c.flag}</span>
                      <span className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground">
                          USDT → {c.fiat}
                        </p>
                        <p className="text-[11px] text-foreground/40 truncate">{c.country}</p>
                      </span>
                      {isActive ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : !available ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/40 bg-foreground/[0.06] rounded-md px-2 py-0.5 shrink-0">
                          Soon
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}


      {/* ── AMBIENT MESH ── */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "55%", pointerEvents: "none", zIndex: 0, overflow: "hidden", filter: "blur(46px)", opacity: 0.9 }}>
        <div style={{ position: "absolute", width: 280, height: 280, left: "-6%", top: "-10%", borderRadius: "50%", background: "radial-gradient(circle, rgba(120,134,224,0.55), transparent 62%)", mixBlendMode: "screen", animation: "z2drift1 16s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 260, height: 260, right: "-10%", top: "0%", borderRadius: "50%", background: "radial-gradient(circle, rgba(196,138,224,0.42), transparent 62%)", mixBlendMode: "screen", animation: "z2drift2 19s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 240, height: 240, left: "30%", top: "14%", borderRadius: "50%", background: "radial-gradient(circle, rgba(224,176,128,0.30), transparent 64%)", mixBlendMode: "screen", animation: "z2drift1 22s ease-in-out infinite reverse" }} />
      </div>
      <style>{`
        @keyframes z2drift1{0%{transform:translate(0,0) scale(1)} 50%{transform:translate(12%,8%) scale(1.18)} 100%{transform:translate(0,0) scale(1)}}
        @keyframes z2drift2{0%{transform:translate(0,0) scale(1.1)} 50%{transform:translate(-10%,10%) scale(0.92)} 100%{transform:translate(0,0) scale(1.1)}}
        @keyframes z2pulse{0%{box-shadow:0 0 0 0 rgba(184,233,212,.5)} 70%{box-shadow:0 0 0 7px rgba(184,233,212,0)} 100%{box-shadow:0 0 0 0 rgba(184,233,212,0)}}
        @keyframes z2rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .z2tick{width:7px;height:7px;border-radius:999px;background:#b8e9d4;animation:z2pulse 2.6s infinite;flex-shrink:0}
        .z2rise{animation:z2rise 0.85s cubic-bezier(0.22,1,0.36,1) backwards}
        @media(prefers-reduced-motion:reduce){.z2rise,.z2tick{animation:none!important}}
      `}</style>

      {/* ── HEADER ── */}
      <div className="z2rise" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, paddingBottom: 4, animationDelay: "40ms" }}>
        <div>
          <div style={{ color: "#86868b", fontSize: 12.5, fontWeight: 600 }}>{dateLabel}</div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 1, color: "#f5f5f7" }}>{greeting}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onOpenPaymentMethods?.()}
            style={{ width: 42, height: 42, borderRadius: 999, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", color: "#aeaeb2", position: "relative", cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3.2"/><path d="M2.5 9.5h19"/></svg>
            {defaultPaymentMethod && (
              <span style={{ position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: 9, background: "#7b54e0", boxShadow: "0 0 0 2px #08080a" }} />
            )}
          </button>
          <button style={{ width: 42, height: 42, borderRadius: 999, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", color: "#aeaeb2", cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          </button>
          <div style={{ width: 42, height: 42, borderRadius: 999, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", overflow: "hidden" }}>
            {merchantInfo?.avatar_url && /^https?:|^\//.test(merchantInfo.avatar_url)
              ? <img src={merchantInfo.avatar_url} style={{ width: 42, height: 42, objectFit: "cover" }} alt="" />
              : <span style={{ fontWeight: 800, color: "#f5f5f7", fontSize: 17 }}>{avatarLetter}</span>}
          </div>
        </div>
      </div>

      {/* ── HERO BALANCE ── */}
      <div className="z2rise" style={{ position: "relative", zIndex: 1, paddingTop: 18, animationDelay: "120ms" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span className="z2tick" />
          <span style={{ color: "#86868b", fontSize: 12, fontWeight: 700, letterSpacing: "0.16em" }}>LIVE BALANCE</span>
        </div>
        {embeddedWalletState === "locked" ? (
          <button onClick={openWallet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderRadius: 18, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", color: "#aeaeb2", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Unlock to view balance
          </button>
        ) : embeddedWalletState === "none" ? (
          <button onClick={openWallet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderRadius: 18, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", color: "#aeaeb2", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
            Set Up Wallet
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 64, lineHeight: 0.92, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: "#f5f5f7" }}>
              {displayBalance.toFixed(2)}
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#86868b" }}>USDT</span>
          </div>
        )}

        {/* Market switch pill */}
        <button
          onClick={() => setCorridorPickerOpen(true)}
          style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 9, padding: "8px 14px", borderRadius: 999, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", color: "#f5f5f7", cursor: "pointer", backdropFilter: "blur(20px)" }}>
          <span style={{ fontSize: 14 }}>{activeCorridorMeta.flag}</span>
          <span style={{ fontWeight: 800, fontSize: 13.5, whiteSpace: "nowrap" }}>USDT / {activeCorridorMeta.fiat}</span>
          {liveRate && <>
            <span style={{ width: 1, height: 13, background: "rgba(255,255,255,0.16)", flexShrink: 0 }} />
            <span style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatFiat(liveRate, activeCorridorMeta.fiat).replace(/\.00$/, '')}
            </span>
          </>}
          <span style={{ color: "#86868b", display: "flex" }}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>
          </span>
        </button>
      </div>

      {/* ── BUY / SELL ── */}
      {embeddedWalletState !== "locked" && embeddedWalletState !== "none" && (
        <div className="z2rise" style={{ display: "flex", gap: 12, position: "relative", zIndex: 1, animationDelay: "200ms" }}>
          {/* Buy — blocked, priority feature coming soon */}
          <div style={{ flex: 1, padding: 16, borderRadius: 18, background: "#f5f5f7", color: "#0b0b0c", textAlign: "left", opacity: 0.45, position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10M17 7 7 17"/></svg>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "rgba(0,0,0,0.12)", borderRadius: 6, padding: "2px 6px" }}>Soon</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 16 }}>Buy</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.55 }}>Acquire USDT</div>
          </div>
          {/* Sell — blocked, priority feature coming soon */}
          <div style={{ flex: 1, padding: 16, borderRadius: 18, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.16)", color: "#f5f5f7", textAlign: "left", backdropFilter: "blur(20px)", opacity: 0.45, position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#aeaeb2" }}>
              <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 17H7V7M7 17 17 7"/></svg>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "rgba(255,255,255,0.10)", borderRadius: 6, padding: "2px 6px", color: "#86868b" }}>Soon</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 16 }}>Sell</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#86868b" }}>Offload USDT</div>
          </div>
        </div>
      )}

      {/* ── QUICK ACTIONS ── */}
      {embeddedWalletState !== "locked" && embeddedWalletState !== "none" && (
        <div className="z2rise" style={{ display: "flex", gap: 10, position: "relative", zIndex: 1, animationDelay: "280ms" }}>
          {([
            { label: "Deposit", action: () => setDepositOpen(true), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg> },
            { label: "Swap", action: () => setSwapOpen(true), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg> },
            { label: "Send", action: () => setSendOpen(true), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V8m0 0-4 4m4-4 4 4M5 4h14"/></svg> },
          ] as const).map(({ label, action, icon }) => (
            <button
              key={label} onClick={action}
              style={{ flex: 1, padding: "14px 0", borderRadius: 18, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", color: "#aeaeb2", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, cursor: "pointer", backdropFilter: "blur(20px)", transition: "transform 0.14s" }}
              onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
              onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
              onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              {icon}
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#86868b" }}>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── RECENT ACTIVITY ── */}
      <div className="z2rise" style={{ position: "relative", zIndex: 1, animationDelay: "380ms" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em", color: "#f5f5f7" }}>Recent activity</span>
          <button
            onClick={() => setMobileView("history")}
            style={{ display: "flex", alignItems: "center", gap: 3, color: "#86868b", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", background: "none", border: "none", cursor: "pointer" }}>
            See all
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
          </button>
        </div>

        {/* New order highlight — shows first pending order */}
        {pendingOrders.length > 0 && (() => {
          const o = pendingOrders[0];
          const fiatCur = (o as any).toCurrency || activeCorridorMeta.fiat;
          const fiatTotal = formatFiat(Math.round((o as any).total ?? 0), fiatCur).replace(/\.00$/, '');
          const cryptoAmt = Math.round((o as any).amount ?? 0);
          const earningFiat = ((o as any).amount ?? 0) * ((o as any).protocolFeePercent ?? 0.5) / 100 * ((o as any).rate || 1);
          const earnLabel = earningFiat > 0 ? `+${formatFiat(earningFiat, fiatCur).replace(/\.?0+$/, '')}` : null;
          return (
            <button
              onClick={() => setMobileView("orders")}
              style={{ width: "100%", textAlign: "left", padding: 13, borderRadius: 18, display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(184,233,212,0.28)", backdropFilter: "blur(20px)", cursor: "pointer", marginBottom: 10, boxSizing: "border-box", transition: "transform 0.14s" }}
              onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
              onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
              onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(184,233,212,0.12)", color: "#b8e9d4" }}>
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10M17 7 7 17"/></svg>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span className="z2tick" />
                  <span style={{ fontWeight: 800, fontSize: 14, color: "#fff", whiteSpace: "nowrap" }}>New order</span>
                </span>
                <span style={{ display: "block", color: "#aeaeb2", fontSize: 12.5, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {cryptoAmt} USDT → {fiatTotal}
                  {earnLabel && <> · earn <b style={{ color: "#b8e9d4" }}>{earnLabel}</b></>}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ color: "#5a5a60", fontSize: 11, fontWeight: 700 }}>now</span>
                <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="#aeaeb2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
              </span>
            </button>
          );
        })()}

        {/* Events list */}
        {recentOrders.length > 0 ? (
          <div style={{ borderRadius: 20, overflow: "hidden", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(20px)" }}>
            {recentOrders.map((order, idx) => {
              const isBuy = order.orderType === "buy" || order.dbOrder?.type === "buy";
              const status = order.dbOrder?.status || order.status;
              const statusLabel = status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : status === "escrowed" || status === "escrow" ? "In Progress" : status === "payment_sent" ? "Pmt Sent" : "Pending";
              const statusColor = status === "completed" ? "#22e29a" : status === "cancelled" ? "#ff4d4f" : "#b8e9d4";
              const fiatCur = (order as any).toCurrency || activeCorridorMeta.fiat;
              const dt = (order.dbOrder as { created_at?: string } | undefined)?.created_at;
              const ageSec = dt ? Math.floor((Date.now() - new Date(dt).getTime()) / 1000) : null;
              const ageLabel = !ageSec ? "" : ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m` : ageSec < 86400 ? `${Math.floor(ageSec / 3600)}h` : `${Math.floor(ageSec / 86400)}d`;
              return (
                <button
                  key={order.id}
                  onClick={() => { if (status === "completed" || status === "cancelled") setMobileView("history"); else if (status === "pending") setMobileView("orders"); else setMobileView("escrow"); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", borderTop: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.09)", boxSizing: "border-box" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "#aeaeb2" }}>
                      {isBuy
                        ? <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10M17 7 7 17"/></svg>
                        : <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 17H7V7M7 17 17 7"/></svg>}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: "#f5f5f7" }}>{isBuy ? "Buy" : "Sell"} · {order.user || "Open Order"}</span>
                      <span style={{ color: statusColor, fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{statusLabel}</span>
                    </span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13.5, fontWeight: 700, color: "#f5f5f7", whiteSpace: "nowrap" }}>{(order as any).amount} USDT</div>
                    <div style={{ color: "#5a5a60", fontSize: 11, fontWeight: 600, marginTop: 2 }}>{ageLabel}</div>
                  </span>
                </button>
              );
            })}
          </div>
        ) : pendingOrders.length === 0 ? (
          <div style={{ borderRadius: 20, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", padding: "24px 16px", textAlign: "center" }}>
            <p style={{ color: "#5a5a60", fontSize: 13, margin: 0 }}>No recent activity</p>
            <button onClick={() => onStartTrade?.("buy")} style={{ marginTop: 10, padding: "8px 18px", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.12)", background: "none", color: "#86868b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Post your first trade</button>
          </div>
        ) : null}
      </div>

      {/* ── Onboarding ── */}
      <OnboardingSetupCard onOpenSettings={openWallet} />

      {/* ── Activity feed (advanced — TX / Swaps / Deposits) ── */}
      {(onchainTxs !== null || swapHistoryTick >= 0) && (() => {
        type Item =
          | { kind: "swap"; key: string; ts: number; data: ReturnType<typeof loadSwaps>[number] }
          | { kind: "deposit"; key: string; ts: number; data: ReturnType<typeof loadDeposits>[number] }
          | { kind: "tx"; key: string; ts: number; data: OnChainTx };
        const items: Item[] = [];
        void swapHistoryTick;
        const swaps = loadSwaps(merchantIdForWallet);
        for (const s of swaps) items.push({ kind: "swap", key: `s-${s.signature}`, ts: s.blockTime ?? 0, data: s });
        void depositHistoryTick;
        const deposits = loadDeposits(merchantIdForWallet);
        for (const d of deposits) items.push({ kind: "deposit", key: `d-${d.destSignature}`, ts: d.blockTime ?? 0, data: d });
        for (const t of (onchainTxs ?? []).slice(0, TX_LIMIT)) items.push({ kind: "tx", key: `x-${t.signature}`, ts: t.blockTime ?? 0, data: t });
        items.sort((a, b) => b.ts - a.ts);
        if (items.length === 0) return null;
        return (
          <div style={{ borderRadius: 20, overflow: "hidden", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(20px)" }}>
            {items.map((item, idx) => {
              const ageSec = Math.max(0, Math.floor(Date.now() / 1000 - item.ts));
              const ageLabel = ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m` : ageSec < 86400 ? `${Math.floor(ageSec / 3600)}h` : `${Math.floor(ageSec / 86400)}d`;
              const borderTop = idx > 0 ? "1px solid rgba(255,255,255,0.09)" : "none";
              if (item.kind === "swap") {
                const s = item.data;
                return (
                  <a key={item.key} href={`${explorerBaseUrl}/tx/${s.signature}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop, textDecoration: "none" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "#aeaeb2", flexShrink: 0 }}>
                        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>
                      </span>
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5, color: "#f5f5f7" }}>Swap {s.inputSymbol} → {s.outputSymbol}</span>
                        <span style={{ color: "#86868b", fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{s.inputAmount.toFixed(2)} {s.inputSymbol}</span>
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13.5, fontWeight: 700, color: "#f5f5f7", whiteSpace: "nowrap" }}>+{s.outputAmount.toFixed(2)} {s.outputSymbol}</div>
                      <div style={{ color: "#5a5a60", fontSize: 11, fontWeight: 600, marginTop: 2 }}>{ageLabel}</div>
                    </span>
                  </a>
                );
              }
              if (item.kind === "deposit") {
                const d = item.data;
                return (
                  <a key={item.key} href={`${explorerBaseUrl}/tx/${d.destSignature}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop, textDecoration: "none" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(34,226,154,0.1)", color: "#22e29a", flexShrink: 0 }}>
                        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>
                      </span>
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5, color: "#f5f5f7" }}>Deposit · {d.sourceChain}</span>
                        <span style={{ color: "#86868b", fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>Bank</span>
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13.5, fontWeight: 700, color: "#22e29a", whiteSpace: "nowrap" }}>+{d.amountUsdt.toFixed(2)} USDT</div>
                      <div style={{ color: "#5a5a60", fontSize: 11, fontWeight: 600, marginTop: 2 }}>{ageLabel}</div>
                    </span>
                  </a>
                );
              }
              const tx = item.data;
              return (
                <a key={item.key} href={`${explorerBaseUrl}/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop, textDecoration: "none" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: !tx.err ? "#22e29a" : "#ff4d4f", flexShrink: 0, marginLeft: 14 }} />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 700, fontSize: 12, fontFamily: "monospace", color: "#f5f5f7" }}>{tx.signature.slice(0, 8)}…{tx.signature.slice(-6)}</span>
                      <span style={{ color: "#86868b", fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>Slot {tx.slot.toLocaleString()}</span>
                    </span>
                  </span>
                  <span style={{ color: "#5a5a60", fontSize: 11, fontWeight: 600 }}>{ageLabel}</span>
                </a>
              );
            })}
          </div>
        );
      })()}

      {/* ── INR / Rate panels (utility, toggled by payment method header icon) ── */}
      {showInrPanel && (
        <div className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-4 space-y-3">
          <div className="flex bg-foreground/[0.04] rounded-lg p-0.5">
            <button onClick={() => setInrInputMode("add")} className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${inrInputMode === "add" ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}><Plus className="w-3 h-3" />Add</button>
            <button onClick={() => setInrInputMode("subtract")} className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${inrInputMode === "subtract" ? "bg-foreground/[0.08] text-foreground/80" : "text-foreground/40"}`}><Minus className="w-3 h-3" />Subtract</button>
          </div>
          <div className="flex items-center bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2 focus-within:border-primary/30 transition-colors">
            <span className="text-sm text-foreground/40 mr-1">₹</span>
            <input type="text" inputMode="decimal" value={inrInputValue}
              onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); const parts = v.split("."); const sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : v; if (sanitized === "" || sanitized === ".") { setInrInputValue(sanitized); return; } const num = parseFloat(sanitized); if (Number.isNaN(num) || num > MAX_INR_INPUT) return; setInrInputValue(sanitized); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleInrSubmit(); if (e.key === "Escape") setShowInrPanel(false); }}
              placeholder="0" maxLength={14} className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground/20 tabular-nums" autoFocus />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowInrPanel(false); setInrInputValue(""); }} className="flex-1 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] font-semibold text-foreground/60 flex items-center justify-center gap-1"><X className="w-3.5 h-3.5" />Cancel</button>
            <button onClick={handleInrSubmit} disabled={!inrInputValue || parseFloat(inrInputValue) <= 0 || parseFloat(inrInputValue) > MAX_INR_INPUT} className="flex-1 py-2 rounded-lg bg-primary text-background text-[12px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" />{inrInputMode === "add" ? "Add INR Cash" : "Subtract"}</button>
          </div>
        </div>
      )}
      {showRatePanel && (
        <div className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-4 space-y-3">
          <p className="text-[11px] text-foreground/30 leading-relaxed">Set your {activeCorridorMeta.fiat}/USDT rate. Saved locally for now.</p>
          <div className="flex items-center bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2 focus-within:border-primary/30 transition-colors">
            <input type="number" inputMode="decimal" step="0.0001" value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveRate(); if (e.key === "Escape") setShowRatePanel(false); }}
              placeholder={savedRate !== null ? savedRate.toFixed(2) : "99"} maxLength={10}
              className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground/20 tabular-nums" autoFocus />
            <span className="text-[11px] text-foreground/40 ml-2">{activeCorridorMeta.fiat}/USDT</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowRatePanel(false); setRateInput(""); }} className="flex-1 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] font-semibold text-foreground/60 flex items-center justify-center gap-1"><X className="w-3.5 h-3.5" />Cancel</button>
            <button onClick={handleSaveRate} disabled={!rateInput || parseFloat(rateInput) <= 0} className="flex-1 py-2 rounded-lg bg-primary text-background text-[12px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" />Save Rate</button>
          </div>
        </div>
      )}


      {/* ── Swap modal — Jupiter v6, real on-chain swap, live rates ── */}
      <SwapModal
        isOpen={swapOpen}
        onClose={() => setSwapOpen(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
        signTransaction={solanaWallet?.signTransaction ?? null}
        solBalance={solanaWallet?.solBalance ?? null}
        usdtBalance={solanaWallet?.usdtBalance ?? null}
        usdcBalance={solanaWallet?.usdcBalance ?? null}
        actorId={merchantIdForWallet}
        onSwapSuccess={() => {
          solanaWallet?.refreshBalances?.();
          // Bump a local counter so the activity feed re-reads the
          // swap-history slice from localStorage on the next render.
          // Otherwise the newly-recorded swap wouldn't appear until
          // some other re-render landed.
          setSwapHistoryTick((n) => n + 1);
        }}
      />

      {/* ── Deposit modal — wallet-address QR for inbound transfers ── */}
      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
        actorId={merchantIdForWallet}
        onDepositSuccess={() => {
          solanaWallet?.refreshBalances?.();
          // Re-read the deposit-history slice so the newly-recorded
          // deposit appears in Recent Activity immediately.
          setDepositHistoryTick((n) => n + 1);
        }}
      />

      {/* ── Send modal — outbound transfer of SOL / USDT / USDC ── */}
      <SendModal
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
        signTransaction={solanaWallet?.signTransaction ?? null}
        solBalance={solanaWallet?.solBalance ?? null}
        usdtBalance={solanaWallet?.usdtBalance ?? null}
        usdcBalance={solanaWallet?.usdcBalance ?? null}
        onSendSuccess={() => solanaWallet?.refreshBalances?.()}
      />

      {/* Export/Backup password modal moved into <WalletActionsMenu />. */}
    </div>
  );
}
