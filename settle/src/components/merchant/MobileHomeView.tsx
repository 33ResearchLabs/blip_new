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
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { formatCrypto, formatFiat, formatCount } from "@/lib/format";
import {
  loadEncryptedWallet,
  decryptWallet,
  exportPrivateKey,
  clearEncryptedWallet,
  clearSessionKeypair,
} from "@/lib/wallet/embeddedWallet";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { Order } from "@/types/merchant";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { OnboardingSetupCard } from "@/components/merchant/OnboardingSetupCard";
import { SwapModal } from "@/components/merchant/SwapModal";
import { DepositModal } from "@/components/merchant/DepositModal";
import { SendModal } from "@/components/merchant/SendModal";
import { WalletActionsMenu } from "@/components/merchant/WalletActionsMenu";
import { MobilePaymentMethodChip } from "@/components/merchant/MobilePaymentMethodChip";

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
}

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
}: MobileHomeViewProps) {
  const openWallet = onOpenWallet ?? onShowWalletModal;

  // Read SOL balance directly from the wallet context so we can render
  // it inline next to the USDT balance — saves a tile in the action
  // grid and matches the "everything you need to know in one card" UX.
  const solanaWallet = useSolanaWallet();
  const [addressCopied, setAddressCopied] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

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
  // are already in memory). The All tab is trades-only too — the raw
  // on-chain signatures duplicate every trade (escrow lock / release /
  // fee) and clutter the feed, so they're scoped to the dedicated TX
  // tab. TX is fetched lazily on first activation of the TX tab and
  // then cached for the wallet — no refetch unless the address changes.
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
    if (activityTab !== "tx") return;
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

  const handleInrSubmit = () => {
    const amount = parseFloat(inrInputValue);
    if (Number.isNaN(amount) || amount <= 0) return;
    setInrBalance((prev) =>
      inrInputMode === "add" ? prev + amount : Math.max(0, prev - amount),
    );
    setInrInputValue("");
    setShowInrPanel(false);
  };

  // Recent activity — merge pending + ongoing + recent completed
  const recentOrders = [
    ...pendingOrders.slice(0, 5),
    ...ongoingOrders.slice(0, 5),
    ...completedOrders.slice(0, 6),
  ].slice(0, 6);

  return (
    <div className="space-y-4">
      {/* ── Corridor selector ──
          Tappable pill showing the active corridor; opens a searchable
          dropdown sheet so the merchant can pick from any supported
          market. The active state is owned by the parent merchant page,
          so this propagates into desktop navbar + trade flows. */}
      {onCorridorChange && (
        <button
          onClick={() => setCorridorPickerOpen(true)}
          className="w-full flex items-center justify-between bg-foreground/[0.04] hover:bg-foreground/[0.06] rounded-xl px-4 py-2.5 text-left transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <span className="text-base">{activeCorridorMeta.flag}</span>
            <span className="flex flex-col">
              <span className="text-[9px] text-foreground/40 uppercase tracking-wider font-medium">
                Market
              </span>
              <span className="text-[13px] font-semibold text-foreground tabular-nums">
                USDT → {activeCorridorMeta.fiat}
                <span className="text-foreground/40 font-normal ml-1.5">· {activeCorridorMeta.country}</span>
              </span>
            </span>
          </span>
          <ChevronDown className="w-4 h-4 text-foreground/40" />
        </button>
      )}

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

      {/* ── Balance Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-3xl p-6"
      >
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="text-[11px] text-foreground/40 uppercase tracking-wider font-medium">
            Available Balance
          </span>
          {/* Shared wallet-actions menu — same component the desktop
              StatusCard renders. Owns its own state and modals so
              MobileHomeView stays slim. */}
          <WalletActionsMenu actorId={merchantIdForWallet} />
        </div>
        {/* Locked / no wallet → hide the misleading "0.00" and surface a CTA */}
        {embeddedWalletState === "locked" ? (
          <div className="mt-2 space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-foreground/40" />
              <span className="text-base font-semibold text-foreground/60">
                Wallet Locked
              </span>
            </div>
            <p className="text-[12px] text-foreground/40">
              Unlock your wallet to view your balance and start trading.
            </p>
            <button
              onClick={openWallet}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Unlock className="w-4 h-4" />
              Unlock Wallet
            </button>
          </div>
        ) : embeddedWalletState === "none" ? (
          <div className="mt-2 space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-foreground/40" />
              <span className="text-base font-semibold text-foreground/60">
                No Wallet
              </span>
            </div>
            <p className="text-[12px] text-foreground/40">
              Create or import a wallet to view your balance.
            </p>
            <button
              onClick={openWallet}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Wallet className="w-4 h-4" />
              Set Up Wallet
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-5xl font-bold text-foreground tracking-tight">
                {effectiveBalance !== null
                  ? effectiveBalance.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "0.00"}
              </span>
              <span className="text-base text-foreground/40 font-medium">
                USDT
              </span>
            </div>

            {/* Wallet address — truncated, tap to copy, with a QR shortcut
                next to it that opens the deposit (receive) sheet. Pulled
                Deposit out of the action grid so we stay at 4 buttons —
                the address row IS the deposit affordance. */}
            {solanaWallet?.walletAddress && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={async () => {
                    await copyToClipboard(solanaWallet.walletAddress!);
                    setAddressCopied(true);
                    setTimeout(() => setAddressCopied(false), 1400);
                  }}
                  className="flex items-center gap-1.5 text-foreground/40 hover:text-foreground/70 transition-colors"
                  aria-label="Copy wallet address"
                >
                  <span className="text-[11px] font-mono tabular-nums">
                    {solanaWallet.walletAddress.slice(0, 6)}…{solanaWallet.walletAddress.slice(-4)}
                  </span>
                  {addressCopied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {solanaWallet?.solBalance !== null && solanaWallet?.solBalance !== undefined && (
                    <span className="ml-2 text-[11px] text-foreground/30 font-mono tabular-nums">
                      · {solanaWallet.solBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setDepositOpen(true)}
                  className="p-1 rounded-md text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.04] transition-colors"
                  aria-label="Show deposit QR"
                  title="Show deposit QR"
                >
                  <QrCode className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {todayEarnings !== 0 && (
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[12px] text-emerald-400 font-medium">
                  +{todayEarnings.toFixed(2)} USDT (24h)
                </span>
              </div>
            )}

            {/* Quick actions — neutral monochrome (no green/orange) so the
                card reads as a single calm surface. The Wallet button is
                gone — tapping the "Available Balance" header above opens
                the wallet, and the USDT/SOL balances are already visible
                here, so a separate Wallet tile was redundant. */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              <button
                onClick={() => onStartTrade?.("buy")}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-foreground/[0.05] border border-foreground/[0.08] text-foreground hover:bg-foreground/[0.08] transition-colors"
              >
                <ArrowDownRight className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Buy
                </span>
              </button>
              <button
                onClick={() => onStartTrade?.("sell")}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-foreground/[0.05] border border-foreground/[0.08] text-foreground hover:bg-foreground/[0.08] transition-colors"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Sell
                </span>
              </button>
              <button
                onClick={() => setSwapOpen(true)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-foreground/[0.05] border border-foreground/[0.08] text-foreground hover:bg-foreground/[0.08] transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Swap
                </span>
              </button>
              <button
                onClick={() => setSendOpen(true)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-foreground/[0.05] border border-foreground/[0.08] text-foreground hover:bg-foreground/[0.08] transition-colors"
              >
                <ArrowUpFromLine className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Send
                </span>
              </button>
            </div>

            {/* Default payment method chip — shows current default with
                a picker to switch, or an "Add payment method" CTA when
                none is configured. Sits below the action grid so it's
                the next thing the merchant sees after the balance &
                trading actions. */}
            <div className="mt-3">
              <MobilePaymentMethodChip merchantId={merchantIdForWallet ?? null} />
            </div>

            {/* INR Cash + My Rate — minimal inline row, no boxes. Each
                "pill" is just a tap target with the value inline next to
                the label. Separated by a subtle vertical hairline.
                Removes the heavy box-on-box stacking that the boxed
                version was producing. */}
            <div className="mt-4 flex items-center justify-between px-1">
              <button
                onClick={() => setShowInrPanel((v) => !v)}
                aria-expanded={showInrPanel}
                className="flex items-center gap-2 py-1.5 -m-1 px-1 rounded-md hover:bg-foreground/[0.04] transition-colors"
              >
                <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
                  INR
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  ₹{inrBalance.toLocaleString()}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-foreground/30 transition-transform ${showInrPanel ? "rotate-180" : ""}`}
                />
              </button>

              <span className="w-px h-4 bg-foreground/[0.06]" />

              <button
                onClick={() => setShowRatePanel((v) => !v)}
                aria-expanded={showRatePanel}
                className="flex items-center gap-2 py-1.5 -m-1 px-1 rounded-md hover:bg-foreground/[0.04] transition-colors"
              >
                <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium">
                  Rate
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {savedRate !== null ? savedRate.toFixed(2) : "—"}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-foreground/30 transition-transform ${showRatePanel ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {/* INR cash editor — appears below the paired row when its
                pill is tapped. */}
            <div>
              {showInrPanel && (
                <div className="mt-2 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl p-3 space-y-2.5">
                  {/* Add / subtract toggle */}
                  <div className="flex bg-foreground/[0.04] rounded-lg p-0.5">
                    <button
                      onClick={() => setInrInputMode("add")}
                      className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                        inrInputMode === "add"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "text-foreground/40"
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                    <button
                      onClick={() => setInrInputMode("subtract")}
                      className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                        inrInputMode === "subtract"
                          ? "bg-rose-500/15 text-rose-400"
                          : "text-foreground/40"
                      }`}
                    >
                      <Minus className="w-3 h-3" />
                      Subtract
                    </button>
                  </div>

                  {/* Amount input */}
                  <div className="flex items-center bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2 focus-within:border-primary/30 transition-colors">
                    <span className="text-sm text-foreground/40 mr-1">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={inrInputValue}
                      onChange={(e) => setInrInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInrSubmit();
                        if (e.key === "Escape") setShowInrPanel(false);
                      }}
                      placeholder="0"
                      maxLength={14}
                      className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground/20 tabular-nums"
                      autoFocus
                    />
                  </div>

                  {/* Submit / cancel */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowInrPanel(false);
                        setInrInputValue("");
                      }}
                      className="flex-1 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] font-semibold text-foreground/60 hover:bg-foreground/[0.06] transition-colors flex items-center justify-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={handleInrSubmit}
                      disabled={
                        !inrInputValue || parseFloat(inrInputValue) <= 0
                      }
                      className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {inrInputMode === "add" ? "Add INR Cash" : "Subtract"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* My Rate editor — the pill itself is in the paired row at
                the top of this section; here we just render the editor
                that opens when that pill is tapped. Same persistence
                contract as INR cash (localStorage only for now). */}
            <div>
              {showRatePanel && (
                <div className="mt-2 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl p-3 space-y-2.5">
                  <p className="text-[11px] text-foreground/40 leading-relaxed">
                    Set the {activeCorridorMeta.fiat} per USDT rate you want to honor. Saved locally for now — backend wiring lands in the next PR.
                  </p>
                  <div className="flex items-center bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2 focus-within:border-primary/30 transition-colors">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRate();
                        if (e.key === "Escape") setShowRatePanel(false);
                      }}
                      placeholder={savedRate !== null ? savedRate.toFixed(2) : "99"}
                      maxLength={10}
                      className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground/20 tabular-nums"
                      autoFocus
                    />
                    <span className="text-[11px] text-foreground/40 ml-2">{activeCorridorMeta.fiat}/USDT</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowRatePanel(false);
                        setRateInput("");
                      }}
                      className="flex-1 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] font-semibold text-foreground/60 flex items-center justify-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveRate}
                      disabled={!rateInput || parseFloat(rateInput) <= 0}
                      className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save Rate
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* ── Onboarding setup checklist — under the balance card so the
          wallet/balances are the first thing the merchant sees, with
          progressive setup right below as the next call-to-action.
          Self-hides via internal conditions (status null / all-done /
          skipped). ── */}
      <OnboardingSetupCard onOpenSettings={openWallet} />

      {/* Quick Trade card removed — the floating + FAB at the bottom-right
          opens the full trade modal. */}

      {/* ── Recent Activity ── (formerly "Active Market" — the label was
          misleading because this section shows the merchant's own recent
          orders, not the marketplace feed.) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-3"
      >
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              Recent Activity
            </span>
          </div>
          {/* Three tabs — All / Trades / TX. The "All" link button next
              to the tab strip was removed so the strip's width is stable
              when switching tabs (no layout shift). */}
          <div className="flex items-center bg-foreground/[0.04] rounded-lg p-0.5">
            {(["all", "trades", "tx"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActivityTab(t)}
                className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors ${
                  activityTab === t
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-foreground/40"
                }`}
              >
                {t === "all" ? "All" : t === "trades" ? "Trades" : "TX"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Unified activity list ──
            ONE container, ONE map. The items array is derived from the
            active tab — when the user toggles tabs the container stays
            mounted, only its children change. No layout shift, no
            transitional "Loading…" when re-entering a tab whose data
            is already cached. ── */}
        {(() => {
          type Item =
            | { kind: "trade"; key: string; ts: number; data: typeof recentOrders[number] }
            | { kind: "tx"; key: string; ts: number; data: OnChainTx };
          const items: Item[] = [];
          if (activityTab === "trades" || activityTab === "all") {
            for (const o of recentOrders) {
              const dt = (o.dbOrder as { created_at?: string } | undefined)?.created_at;
              items.push({
                kind: "trade",
                key: `t-${o.id}`,
                ts: dt ? new Date(dt).getTime() / 1000 : Date.now() / 1000,
                data: o,
              });
            }
          }
          if (activityTab === "tx") {
            for (const t of (onchainTxs ?? []).slice(0, TX_LIMIT)) {
              items.push({
                kind: "tx",
                key: `x-${t.signature}`,
                ts: t.blockTime ?? 0,
                data: t,
              });
            }
          }
          if (activityTab === "all") {
            items.sort((a, b) => b.ts - a.ts);
          }

          // Loading is only shown if we're on the TX tab AND haven't
          // resolved the fetch yet — Trades/All tabs never block for RPC.
          const txFetchActive =
            activityTab === "tx" && onchainTxsLoading && !onchainTxs;

          return (
            <div className="space-y-2">
              {txFetchActive ? (
                <div className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-2xl p-6 text-center">
                  <p className="text-sm text-foreground/30">Loading transactions…</p>
                </div>
              ) : items.length === 0 ? (
                <div className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-2xl p-8 text-center">
                  <Clock className="w-8 h-8 text-foreground/15 mx-auto mb-2" />
                  <p className="text-sm text-foreground/30">
                    {activityTab === "tx" ? "No on-chain transactions" : "No recent activity"}
                  </p>
                  {activityTab !== "tx" && (
                    <p className="text-[11px] text-foreground/20 mt-1">
                      Your trades will appear here
                    </p>
                  )}
                </div>
              ) : (
                items.map((item) => {
                  if (item.kind === "trade") {
                    const order = item.data;
                    const isBuy =
                      order.orderType === "buy" || order.dbOrder?.type === "buy";
                    const status = order.dbOrder?.status || order.status;
                    const statusLabel =
                      status === "completed"
                        ? "COMPLETED"
                        : status === "cancelled"
                          ? "CANCELLED"
                          : status === "escrowed" || status === "escrow"
                            ? "IN PROGRESS"
                            : status === "payment_sent"
                              ? "PAYMENT SENT"
                              : "PENDING";
                    const statusColor =
                      status === "completed"
                        ? "text-emerald-400"
                        : status === "cancelled"
                          ? "text-red-400"
                          : "text-primary";
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          if (status === "completed" || status === "cancelled") {
                            setMobileView("history");
                          } else if (status === "pending") {
                            setMobileView("orders");
                          } else {
                            setMobileView("escrow");
                          }
                        }}
                        className="w-full flex items-center gap-3 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl p-3 hover:bg-foreground/[0.05] transition-colors text-left"
                      >
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${
                            isBuy
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {isBuy ? "BUY" : "SELL"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {order.user}
                          </p>
                          <p className="text-[11px] text-foreground/40">
                            {order.dbOrder?.order_number || `${formatCrypto(order.amount)} USDT`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-foreground">
                            {formatCrypto(order.amount)} USDT
                            <span className="text-foreground/30 mx-1">→</span>
                            <span className="text-primary">
                              {formatFiat(order.total, activeCorridorMeta.fiat)}
                            </span>
                          </p>
                          <p className={`text-[10px] font-medium ${statusColor}`}>
                            {statusLabel}
                          </p>
                        </div>
                      </button>
                    );
                  }
                  // tx row
                  const tx = item.data;
                  const success = !tx.err;
                  const ageSec = tx.blockTime
                    ? Math.max(0, Math.floor(Date.now() / 1000 - tx.blockTime))
                    : null;
                  const ageLabel = !ageSec
                    ? "—"
                    : ageSec < 60
                      ? `${ageSec}s`
                      : ageSec < 3600
                        ? `${Math.floor(ageSec / 60)}m`
                        : ageSec < 86400
                          ? `${Math.floor(ageSec / 3600)}h`
                          : `${Math.floor(ageSec / 86400)}d`;
                  return (
                    <a
                      key={item.key}
                      href={`${explorerBaseUrl.includes("?") ? explorerBaseUrl.replace("/?", `/tx/${tx.signature}?`) : `${explorerBaseUrl}/tx/${tx.signature}`}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center gap-3 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl p-3 hover:bg-foreground/[0.05] transition-colors"
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          success
                            ? "bg-foreground/[0.06] text-foreground/60"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        TX
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-mono text-foreground/80 truncate">
                          {tx.signature.slice(0, 8)}…{tx.signature.slice(-8)}
                        </p>
                        <p className="text-[10px] text-foreground/40">
                          Slot {formatCount(tx.slot)} · {ageLabel} ago
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-medium shrink-0 ${
                          success ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {success ? "SUCCESS" : "FAILED"} ↗
                      </span>
                    </a>
                  );
                })
              )}
              {onchainTxsError && activityTab === "tx" && (
                <p className="text-[10px] text-rose-400/70 text-center">
                  {onchainTxsError}
                </p>
              )}
            </div>
          );
        })()}
      </motion.div>

      {/* Delete / Export / Backup / Init-fees flows moved into the
          shared <WalletActionsMenu /> component rendered above next to
          the balance card. Deleted blocks removed below. */}

      {/* Init-fee-accounts toast moved into <WalletActionsMenu />. */}

      {/* ── Swap modal — Jupiter v6, real on-chain swap, live rates ── */}
      <SwapModal
        isOpen={swapOpen}
        onClose={() => setSwapOpen(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
        signTransaction={solanaWallet?.signTransaction ?? null}
        solBalance={solanaWallet?.solBalance ?? null}
        usdtBalance={solanaWallet?.usdtBalance ?? null}
        usdcBalance={solanaWallet?.usdcBalance ?? null}
        onSwapSuccess={() => solanaWallet?.refreshBalances?.()}
      />

      {/* ── Deposit modal — wallet-address QR for inbound transfers ── */}
      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
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
