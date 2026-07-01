"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  ChevronLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Banknote,
  Loader2,
  ChevronDown,
  X,
  CreditCard,
  Smartphone,
  Check,
} from "lucide-react";
import type {
  Screen,
  TradeType,
  TradePreference,
  PaymentMethod,
} from "./types";
import {
  PaymentMethodSelector,
  type PaymentMethodItem,
} from "../PaymentMethodSelector";
import { BottomNav } from "./BottomNav";
import { PayWithSheet } from "../PayWithSheet";
import { useUserPaymentMethods } from "@/context/AppContext";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { formatCrypto, formatFiat, formatPercentage } from "@/lib/format";
import { FeeBreakdown } from "@/components/shared/FeeBreakdown";
import { FEE_UI_V2 } from "@/lib/featureFlags";

type RatePair = "usdt_aed" | "usdt_inr";

interface PriceData {
  pair: string;
  price: number;
  mode: string;
  currency: string;
}

export interface TradeCreationScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  tradeType: TradeType;
  setTradeType: (t: TradeType) => void;
  tradePreference: TradePreference;
  setTradePreference: (p: TradePreference) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  amount: string;
  setAmount: (a: string) => void;
  fiatAmount: string;
  currentFees: { totalFee: number; traderCut: number };
  isLoading: boolean;
  userId: string | null;
  startTrade: () => void;
  solanaWallet: { connected: boolean; usdtBalance: number | null };
  selectedPaymentMethodId: string | null;
  onSelectPaymentMethod: (method: PaymentMethodItem | null) => void;
  // BUY orders (Way-1): the payment rails the buyer can pay with (multi-select).
  buyerPaymentTypes: string[];
  onToggleBuyerPaymentType: (t: string) => void;
  setBuyerPaymentTypes: (t: string[]) => void;
  selectedPair?: "usdt_aed" | "usdt_inr";
  onPairChange?: (pair: "usdt_aed" | "usdt_inr") => void;
  setCurrentRate?: (rate: number) => void;
  theme?: "dark" | "light";
  hideBottomNav?: boolean;
}

// iOS 26 spring physics — snappy
const SPRING = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.8 };
const SOFT_SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

function formatAmountInput(value: string): string {
  if (!value) return value;
  const [intPart, decPart] = value.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

const QUICK_AMOUNTS = ["100", "500", "1000", "5000"];

// BUY orders (Way-1): the payment rails a buyer can offer to pay with. The
// order is shown only to merchants who support at least one of these, and the
// buyer pays into the matching merchant account after a merchant accepts.
const BUY_PAY_TYPES: { key: string; label: string; Icon: typeof CreditCard }[] = [
  { key: "bank", label: "Bank", Icon: CreditCard },
  { key: "upi", label: "UPI", Icon: Smartphone },
  { key: "cash", label: "Cash", Icon: Banknote },
];

// Human label for a PaymentMethodItem.type, shown under the chosen-method card.
const PM_TYPE_LABEL: Record<string, string> = {
  bank: "Bank account",
  upi: "UPI",
  cash: "Cash",
  other: "Other",
};

const TOKENS_DARK = {
  hi: "rgba(255,255,255,0.96)",
  md: "rgba(255,255,255,0.55)",
  lo: "rgba(255,255,255,0.32)",
  xl: "rgba(255,255,255,0.16)",
  bg: "#07090F",
  surface1: "rgba(255,255,255,0.05)",
  surface2: "rgba(255,255,255,0.04)",
  surface3: "rgba(255,255,255,0.08)",
  surface4: "rgba(255,255,255,0.03)",
  border1: "rgba(255,255,255,0.08)",
  border2: "rgba(255,255,255,0.06)",
  border3: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.32)",
  borderStrongAlt: "rgba(255,255,255,0.28)",
  divider: "rgba(255,255,255,0.10)",
  handle: "rgba(255,255,255,0.14)",
  dropdownBg: "rgba(20,24,32,0.85)",
  dropdownBorder: "rgba(255,255,255,0.10)",
  activeTileBg: "#FFFFFF",
  activeTileText: "#0B0F14",
  activeTileSubText: "rgba(11,15,20,0.65)",
  activeTileBorder: "rgba(255,255,255,0.85)",
  ctaInactiveBg: "rgba(255,255,255,0.05)",
  ctaInactiveBorder: "rgba(255,255,255,0.08)",
  ctaActiveBg: "#FFFFFF",
  ctaActiveText: "#0B0F14",
  ctaActiveBorder: "rgba(255,255,255,0.30)",
  ctaActiveShadow:
    "0 16px 36px -14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.6)",
  sheetBg: "rgba(255,255,255,0.04)",
  sheetBorder: "rgba(255,255,255,0.06)",
  sheetShadow:
    "0 -16px 36px -16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
};

// Light theme recoloured to HomeScreen's cream look — this is the user app's
// default, so the Trade screen matches the rest: cream bg, white cards,
// #14151a / #80828c text, golden CTA.
const TOKENS_LIGHT = {
  hi: "rgba(20,21,26,0.96)",
  md: "#80828c",
  lo: "rgba(20,21,26,0.38)",
  xl: "rgba(20,21,26,0.16)",
  bg: "#f4f3f1",
  surface1: "#ffffff",
  surface2: "#ffffff",
  surface3: "rgba(20,21,26,0.05)",
  surface4: "#ffffff",
  border1: "rgba(20,21,26,0.08)",
  border2: "rgba(20,21,26,0.06)",
  border3: "rgba(20,21,26,0.12)",
  borderStrong: "rgba(20,21,26,0.28)",
  borderStrongAlt: "rgba(20,21,26,0.24)",
  divider: "rgba(20,21,26,0.10)",
  handle: "rgba(20,21,26,0.18)",
  dropdownBg: "#ffffff",
  dropdownBorder: "rgba(20,21,26,0.10)",
  activeTileBg: "#ffb02e",
  activeTileText: "#0b0b0d",
  activeTileSubText: "rgba(11,11,13,0.65)",
  activeTileBorder: "rgba(255,176,46,0.85)",
  ctaInactiveBg: "rgba(20,21,26,0.05)",
  ctaInactiveBorder: "rgba(20,21,26,0.08)",
  ctaActiveBg: "#ffb02e",
  ctaActiveText: "#0b0b0d",
  ctaActiveBorder: "rgba(255,176,46,0.40)",
  ctaActiveShadow:
    "0 16px 36px -14px rgba(255,176,46,0.40), inset 0 1px 0 rgba(255,255,255,0.55)",
  sheetBg: "#ffffff",
  sheetBorder: "rgba(20,21,26,0.06)",
  sheetShadow:
    "0 -16px 36px -16px rgba(20,21,26,0.12), inset 0 1px 0 rgba(20,21,26,0.04)",
};

export const TradeCreationScreen = ({
  screen,
  setScreen,
  tradeType,
  setTradeType,
  tradePreference,
  setTradePreference,
  paymentMethod,
  setPaymentMethod,
  amount,
  setAmount,
  fiatAmount,
  currentFees,
  isLoading,
  userId,
  startTrade,
  solanaWallet,
  selectedPaymentMethodId,
  onSelectPaymentMethod,
  buyerPaymentTypes,
  onToggleBuyerPaymentType,
  setBuyerPaymentTypes,
  selectedPair,
  onPairChange,
  setCurrentRate,
  theme = "dark",
  hideBottomNav = false,
}: TradeCreationScreenProps) => {
  const isLight = theme === "light";
  const T = isLight ? TOKENS_LIGHT : TOKENS_DARK;
  // Priority segmented control uses a monochrome active pill (black/white) instead
  // of the orange CTA accent. Dark mode already renders the active tile white, so
  // only light mode is overridden here; the CTA and other tiles keep T.activeTile*.
  const prioActiveBg = isLight ? "#14151a" : T.activeTileBg;
  const prioActiveBorder = isLight ? "rgba(20,21,26,0.85)" : T.activeTileBorder;
  const prioActiveText = isLight ? "#ffffff" : T.activeTileText;
  const prioActiveSubText = isLight ? "rgba(255,255,255,0.65)" : T.activeTileSubText;
  // Selected quick-amount chip: monochrome (black / near-black) instead of the
  // orange accent. Light uses pure black; dark uses a #1a1a1a surface with a
  // light border so it stays visible against the near-black bg and distinct
  // from the faint unselected chips. Both pair with white text (≥17:1 contrast).
  const chipSelectedBg = isLight ? "#000000" : "#1a1a1a";
  const chipSelectedText = "#ffffff";
  const chipSelectedBorder = isLight ? "#000000" : "rgba(255,255,255,0.55)";
  const hasAmount = !!amount && parseFloat(amount) > 0;
  const isBuy = tradeType === "buy";
  // BUY needs ≥1 pay rail ticked; SELL needs a receive account chosen.
  const needsPaymentChoice = isBuy
    ? buyerPaymentTypes.length === 0
    : !selectedPaymentMethodId;
  const canSubmit = hasAmount && !needsPaymentChoice;
  // BUY now picks pay rails in the PayWith bottom sheet opened from the CTA, so
  // the CTA is actionable on amount alone; SELL still needs a receive account.
  const [showPayWith, setShowPayWith] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const ctaReady = isBuy ? hasAmount : canSubmit;
  // After the sheet sets the chosen rails, place the order on the next render
  // (so startTrade reads the fresh buyerPaymentTypes rather than a stale value).
  useEffect(() => {
    if (pendingStart && buyerPaymentTypes.length > 0) {
      setPendingStart(false);
      startTrade();
    }
  }, [pendingStart, buyerPaymentTypes, startTrade]);
  const accent = isBuy
    ? isLight ? "#059669" : "#34D399"
    : isLight ? "#DC2626" : "#F87171";

  const [ratePair, setRatePairLocal] = useState<RatePair>(
    selectedPair || "usdt_inr",
  );
  const setRatePair = (p: RatePair) => {
    setRatePairLocal(p);
    onPairChange?.(p);
  };
  const [rateData, setRateData] = useState<PriceData | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [pairOpen, setPairOpen] = useState(false);

  // ── Saved bank accounts (for BUY mode bank-transfer selection) ──
  type SavedBank = {
    id: string;
    bank?: string;
    bank_name?: string;
    name?: string;
    account_name?: string;
    iban?: string;
    is_default?: boolean;
    isDefault?: boolean;
  };
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  // "Payment methods" bottom sheet — opened from the buy flow's "Add payment
  // method" link. Hosts the full multi-type PaymentMethodSelector (the same
  // component Profile / the sell flow use) so users get the complete add form
  // (bank / UPI / cash / …), not a bank-only one. No navigation to Profile.
  const [showAddMethods, setShowAddMethods] = useState(false);
  // The method picked in the sheet — rendered as a card left of the "Add"
  // button (merchant trade-form pattern). Local so the buy flow reflects the
  // pick immediately; the order itself carries it via onSelectPaymentMethod.
  const [chosenMethod, setChosenMethod] = useState<PaymentMethodItem | null>(null);

  // Pre-select an ALREADY-SAVED payment method so the "Receive To" field is
  // filled in on open — without the user having to tap the sheet first. SELL
  // only (buy uses the pay-rail multi-select). This runs only against the
  // user's existing saved methods from the login-time cache; if they have none
  // saved, nothing is selected and the field keeps its placeholder. Crucially,
  // the in-sheet PaymentMethodSelector does NOT auto-select — so opening the
  // sheet never re-picks or auto-closes; the user can change or cancel freely.
  const { paymentMethods: cachedPaymentMethods } = useUserPaymentMethods();
  useEffect(() => {
    if (isBuy || chosenMethod || !cachedPaymentMethods.length) return;
    const pick =
      (selectedPaymentMethodId
        ? cachedPaymentMethods.find((m) => m.id === selectedPaymentMethodId)
        : null) ??
      cachedPaymentMethods.find((m) => m.is_default) ??
      cachedPaymentMethods[0];
    if (!pick) return;
    setChosenMethod(pick);
    if (!selectedPaymentMethodId) onSelectPaymentMethod(pick);
    setPaymentMethod(pick.type === "cash" ? "cash" : "bank");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedPaymentMethods, chosenMethod, selectedPaymentMethodId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchWithAuth(`/api/users/${userId}/bank-accounts`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list: SavedBank[] = j?.data || j?.banks || j || [];
        if (!Array.isArray(list)) return;
        setSavedBanks(list);
        if (list.length > 0 && !selectedBankId) {
          const def = list.find((b) => b.is_default || b.isDefault) || list[0];
          setSelectedBankId(def.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setRateData(null);
    setRateLoading(true);
    fetchWithAuth(`/api/prices/current?pair=${ratePair}`)
      .then((res) => res.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success && j.data) {
          setRateData(j.data as PriceData);
          if ((j.data as PriceData).price)
            setCurrentRate?.((j.data as PriceData).price);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ratePair]);

  const midRate = rateData?.price ?? null;
  const rateCurrency = ratePair === "usdt_aed" ? "AED" : "INR";
  const rateSymbol = ratePair === "usdt_inr" ? "₹" : "د.إ";

  // Directional rates for INR — baked in 2% backend fee: buy 103.4×0.98=101.33, sell 101.5×1.02=103.53
  const BUY_RATE_INR = 101.33;
  const SELL_RATE_INR = 103.53;
  const displayRate: number | null = ratePair === "usdt_inr"
    ? (isBuy ? BUY_RATE_INR : SELL_RATE_INR)
    : midRate;
  // For INR we don't need the API — suppress loading state
  const effectiveRateLoading = ratePair === "usdt_inr" ? false : rateLoading;

  // Promo: first 10 orders get $5 off — default optimistically active, API updates remaining count
  const [showReceipt, setShowReceipt] = useState(false);

  const [promo, setPromo] = useState<{ active: boolean; remaining: number; discount_usdt: number }>({
    active: true, remaining: 10, discount_usdt: 5,
  });
  useEffect(() => {
    fetchWithAuth('/api/promo/testing-reward')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.success) setPromo(d.data); })
      .catch(() => {});
  }, []);

  const promoDiscountInr = promo.active && displayRate !== null && ratePair === 'usdt_inr'
    ? promo.discount_usdt * displayRate
    : 0;

  const rawFiatAmount = hasAmount && displayRate !== null ? parseFloat(amount) * displayRate : 0;
  const discountedFiatAmount = Math.max(0, rawFiatAmount - promoDiscountInr);

  const fiatValue =
    hasAmount && displayRate !== null
      ? formatCrypto(discountedFiatAmount)
      : "0.00";

  return (
    <div
      className="relative flex flex-col h-dvh overflow-hidden"
      style={{ background: T.bg }}
    >
      {/* ── Ambient color glow that follows Buy / Sell ── */}
      {/* <motion.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        initial={false}
        animate={{
          background: isBuy
            ? "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(16,185,129,0.28) 0%, rgba(16,185,129,0.10) 28%, transparent 60%)"
            : "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(239,68,68,0.26) 0%, rgba(239,68,68,0.10) 28%, transparent 60%)",
        }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      /> */}

      {/* ── Header — always pinned at top ── */}
      <header className="relative z-10 max-w-[440px] md:max-w-[min(1100px,97vw)] mx-auto w-full px-5 pt-5">
        <div className="flex items-center justify-between">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setScreen("home")}
            className="flex items-center justify-center"
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              background: T.surface1,
              border: `1px solid ${T.border1}`,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <ChevronLeft
              size={18}
              strokeWidth={2.2}
              style={{ color: T.hi }}
            />
          </motion.button>

          {/* Corridor selector — animated dropdown */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setPairOpen((v) => !v)}
              className="flex items-center"
              style={{
                gap: 6,
                padding: "8px 12px",
                borderRadius: 999,
                background: T.surface1,
                border: `1px solid ${T.border1}`,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  color: T.hi,
                }}
              >
                {rateCurrency}
              </span>
              <motion.span
                animate={{ rotate: pairOpen ? 180 : 0 }}
                transition={SPRING}
                style={{ display: "inline-flex" }}
              >
                <ChevronDown size={11} strokeWidth={2.4} style={{ color: T.md }} />
              </motion.span>
            </motion.button>

            <AnimatePresence>
              {pairOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={SPRING}
                  className="absolute -right-4 mt-2 z-30"
                  style={{
                    minWidth: 100,
                    padding: 4,
                    borderRadius: 14,
                    background: T.dropdownBg,
                    border: `1px solid ${T.dropdownBorder}`,
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    boxShadow: isLight
                      ? "0 18px 32px -16px rgba(15,23,42,0.18), 0 4px 10px -4px rgba(15,23,42,0.10)"
                      : "0 18px 32px -16px rgba(0,0,0,0.55), 0 4px 10px -4px rgba(0,0,0,0.30)",
                  }}
                >
                  {(["usdt_aed", "usdt_inr"] as const).map((p) => {
                    const label = p === "usdt_aed" ? "AED" : "INR";
                    const on = p === ratePair;
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setRatePair(p);
                          setPairOpen(false);
                        }}
                        className="w-full flex items-center justify-between"
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          background: on ? T.surface3 : "transparent",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: T.hi,
                          }}
                        >
                          {label}
                        </span>
                        {on && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: accent,
                              boxShadow: `0 0 6px ${accent}`,
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ── Central section ── */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">

      {/* ── Hero amount stack ── */}
      <div className="relative z-10 max-w-[440px] md:max-w-[min(1100px,97vw)] mx-auto w-full px-5 flex flex-col items-center pt-2">
        {/* Animated You Buy / You Sell label */}
        <AnimatePresence mode="wait">
          <motion.p
            key={tradeType}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25 }}
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: T.lo,
              marginBottom: 10,
            }}
          >
            {isBuy ? "You're Buying" : "You're Selling"}
          </motion.p>
        </AnimatePresence>

        {/* Giant amount with USDT trailing — auto-shrinks to fit */}
        {(() => {
          const formatted = formatAmountInput(amount);
          const len = formatted.length || 1;
          // SF Mono char width ≈ 0.60 × fontSize. Step down as the number grows
          // so the row never overflows the column width.
          const fontSize =
            len <= 4 ? 76 :
            len <= 6 ? 64 :
            len <= 8 ? 52 :
            len <= 10 ? 42 :
            len <= 12 ? 34 : 28;
          const inputWidth = Math.max(48, Math.ceil(len * fontSize * 0.60));
          const symbolSize = Math.max(12, Math.round(fontSize * 0.24));
          return (
            <div
              className="flex items-baseline justify-center w-full"
              style={{ gap: 10, maxWidth: "100%" }}
            >
              <input
                type="text"
                inputMode="decimal"
                maxLength={18}
                value={formatted}
                onChange={(e) =>
                  setAmount(
                    clampDecimal(
                      e.target.value.replace(/,/g, ""),
                      DECIMAL_PRESETS.amount,
                    ),
                  )
                }
                placeholder="0"
                className="bg-transparent border-0 outline-none text-center"
                style={{
                  fontSize,
                  fontWeight: 800,
                  letterSpacing: "-0.05em",
                  lineHeight: 1,
                  color: hasAmount ? T.hi : T.xl,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  width: `${inputWidth}px`,
                  maxWidth: "100%",
                  caretColor: accent,
                  padding: 0,
                  transition: "font-size 180ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
              <span
                style={{
                  fontSize: symbolSize,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  color: T.lo,
                  transition: "font-size 180ms cubic-bezier(0.22,1,0.36,1)",
                  flexShrink: 0,
                }}
              >
                USDT
              </span>
            </div>
          );
        })()}

        {/* Animated conversion ticker */}
        <div style={{ marginTop: 10, minHeight: 22 }}>
          <AnimatePresence mode="wait">
            <motion.p
              key={`${fiatValue}-${rateCurrency}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22 }}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: T.md,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {effectiveRateLoading ? (
                <span className="inline-flex items-center" style={{ gap: 6 }}>
                  <Loader2 size={12} className="animate-spin" />
                  Loading…
                </span>
              ) : (
                <>≈ {rateSymbol}{fiatValue} {rateCurrency}</>
              )}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Quick-amount chips with spring snap */}
        <div className="flex items-center" style={{ gap: 8, marginTop: 18 }}>
          {QUICK_AMOUNTS.map((v) => {
            const selected = hasAmount && parseFloat(amount) === parseFloat(v);
            return (
            <motion.button
              key={v}
              whileTap={{ scale: 0.88 }}
              onClick={() =>
                setAmount(clampDecimal(v, DECIMAL_PRESETS.amount))
              }
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: selected ? chipSelectedBg : T.surface1,
                border: `1px solid ${selected ? chipSelectedBorder : T.border1}`,
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "-0.005em",
                  color: selected ? chipSelectedText : T.md,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {parseFloat(v) >= 1000
                  ? `${parseFloat(v) / 1000}K`
                  : v}
              </span>
            </motion.button>
            );
          })}
          {solanaWallet.connected &&
            solanaWallet.usdtBalance !== null &&
            solanaWallet.usdtBalance > 0 && (() => {
              const maxSelected =
                hasAmount &&
                parseFloat(amount) === solanaWallet.usdtBalance;
              return (
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() =>
                  setAmount(
                    clampDecimal(
                      String(solanaWallet.usdtBalance),
                      DECIMAL_PRESETS.amount,
                    ),
                  )
                }
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: maxSelected ? chipSelectedBg : T.surface1,
                  border: `1px solid ${maxSelected ? chipSelectedBorder : T.border1}`,
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                    color: maxSelected ? chipSelectedText : T.md,
                  }}
                >
                  MAX
                </span>
              </motion.button>
              );
            })()}
        </div>

        {/* Buy/Sell — active = white tile */}
        <div className="grid grid-cols-2 w-full  " style={{ gap: 10, marginTop: 20 }}>
          {(
            [
              {
                type: "buy" as const,
                label: "Buy",
                Icon: ArrowDownLeft,
                color: "#10B981", // emerald-500 — slightly darker for legibility on white
              },
              {
                type: "sell" as const,
                label: "Sell",
                Icon: ArrowUpRight,
                color: "#EF4444", // red-500
              },
            ] as const
          ).map((opt) => {
            const on = tradeType === opt.type;
            return (
              <motion.button
                key={opt.type}
                onClick={() => setTradeType(opt.type)}
                whileTap={{ scale: 0.97 }}
                animate={{
                  background: on ? T.activeTileBg : T.surface2,
                  borderColor: T.border1,
                  boxShadow: "none",
                }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex items-center justify-center"
                style={{
                  padding: "12px 0",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderStyle: "solid",
                  backdropFilter: on ? undefined : "blur(14px)",
                  WebkitBackdropFilter: on ? undefined : "blur(14px)",
                  gap: 8,
                }}
              >
                <motion.span
                  animate={{ color: on ? opt.color : T.lo }}
                  transition={{ duration: 0.25 }}
                  style={{ display: "inline-flex" }}
                >
                  <opt.Icon size={16} strokeWidth={2.6} />
                </motion.span>
                <motion.span
                  animate={{ color: on ? T.activeTileText : T.md }}
                  transition={{ duration: 0.25 }}
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {opt.label}
                </motion.span>
              </motion.button>
            );
          })}
        </div>
      </div>
      </div>{/* end central */}

      {/* ── Bottom drawer — slides up when amount entered ── */}
      <AnimatePresence>
      {hasAmount && (
      <motion.div
        key="trade-drawer"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="absolute bottom-0 inset-x-0 z-20 max-w-[440px] md:max-w-[572px] mx-auto overflow-y-auto"
        style={{
          maxHeight: "60dvh",
          padding: "18px 18px 24px",
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          background: T.sheetBg,
          border: `1px solid ${T.sheetBorder}`,
          backdropFilter: "blur(28px) saturate(1.4)",
          WebkitBackdropFilter: "blur(28px) saturate(1.4)",
          boxShadow: T.sheetShadow,
        }}
      >
        {/* Handle + close */}
        <div className="flex items-center justify-between mb-3">
          <div style={{ width: 32 }} />
          <span style={{ width: 36, height: 4, borderRadius: 999, background: T.handle, display: "block" }} />
          <button
            onClick={() => setAmount("")}
            style={{ width: 32, height: 32, borderRadius: 999, background: T.surface3, border: `1px solid ${T.border1}`, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={15} strokeWidth={2.4} style={{ color: T.md }} />
          </button>
        </div>

        {/* Receipt */}
        {displayRate !== null && (
            <div style={{ marginBottom: 14 }}>
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: T.surface2, border: `1px solid ${T.border2}` }}
              >
                {/* Summary row — always visible, tap to expand */}
                <button
                  onClick={() => setShowReceipt((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5"
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.hi }}>
                    {formatAmountInput(amount)} USDT → {rateSymbol}{formatCrypto(discountedFiatAmount)} {rateCurrency}
                  </span>
                  <motion.span
                    animate={{ rotate: showReceipt ? 180 : 0 }}
                    transition={SPRING}
                    style={{ display: "inline-flex" }}
                  >
                    <ChevronDown size={14} strokeWidth={2.2} style={{ color: T.lo }} />
                  </motion.span>
                </button>

                {/* Expanded receipt */}
                <AnimatePresence>
                  {showReceipt && (
                    <motion.div
                      key="receipt-detail"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={SPRING}
                      style={{ overflow: "hidden" }}
                    >
                      <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: `1px solid ${T.border2}` }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.md }}>{formatAmountInput(amount)} USDT</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: T.hi, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {rateSymbol}{formatCrypto(rawFiatAmount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: `1px solid ${T.border2}` }}>
                        <div className="flex items-center gap-1.5">
                          <span style={{ fontSize: 11, color: T.lo }}>Fees</span>
                          <span style={{ fontSize: 11, color: T.lo, textDecoration: "line-through" }}>{(currentFees.totalFee * 100).toFixed(0)}%</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80" }}>0%</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{rateSymbol}0.00</span>
                      </div>
                      {promo.active && (
                        <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: `1px solid ${T.border2}` }}>
                          <span style={{ fontSize: 11, color: "#4ade80" }}>🎁 $5 testing reward</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>-{rateSymbol}{formatCrypto(promoDiscountInr)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3 py-2.5" style={{ borderTop: `1px solid ${T.border2}`, background: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: T.hi }}>Total</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: T.hi, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{rateSymbol}{formatCrypto(discountedFiatAmount)} {rateCurrency}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
        )}


        {/* Payment method.
            BUY  → multi-select of pay rails (Bank / UPI / Cash). The buyer can
                   tick more than one; the order is shown only to merchants who
                   support one of them, and the buyer pays the merchant's match.
            SELL → single receive-account picker (unchanged). */}
        {/* BUY → pay rails are chosen in the PayWith bottom sheet opened by the
            CTA below (no inline picker). SELL → receive-account picker. */}
        {isBuy ? null : (
          <button
            onClick={() => setShowAddMethods(true)}
            className="w-full flex items-center justify-between mb-4"
            style={{ padding: "13px 16px", borderRadius: 14, background: T.surface1, border: `1px solid ${T.border1}` }}
          >
            <div className="flex items-center" style={{ gap: 10 }}>
              {chosenMethod?.type === "cash" ? (
                <Banknote size={16} strokeWidth={2} style={{ color: T.md }} />
              ) : (
                <CreditCard size={16} strokeWidth={2} style={{ color: T.md }} />
              )}
              <span style={{ fontSize: 14, fontWeight: 700, color: chosenMethod ? T.hi : T.md }}>
                {chosenMethod ? chosenMethod.label : "Select receive method"}
              </span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.lo }}>Change</span>
          </button>
        )}

        {/* Priority — sliding segmented */}
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", color: T.lo, textTransform: "uppercase", marginBottom: 6 }}>
          Priority
        </p>
        <LayoutGroup>
          <div
            className="relative grid grid-cols-3 mb-4"
            style={{ gap: 6, padding: 6, borderRadius: 18, background: T.surface2, border: `1px solid ${T.border2}` }}
          >
            {(
              [
                { key: "fast" as const, label: "Fastest", fee: "0%", oldFee: "2.9%", color: "#FBBF24" },
                { key: "best" as const, label: "Best Rate", fee: "2.5%", oldFee: null, color: "#60A5FA" },
                { key: "cheap" as const, label: "Cheapest", fee: "1.5%", oldFee: null, color: "#34D399" },
              ] as const
            ).map(({ key, label, fee, oldFee }) => {
              const on = tradePreference === key;
              return (
                <motion.button
                  key={key}
                  onClick={() => setTradePreference(key)}
                  whileTap={{ scale: 0.97 }}
                  className="relative flex flex-col items-center justify-center"
                  style={{ padding: "14px 4px", borderRadius: 13 }}
                >
                  {on && (
                    <motion.span
                      layoutId="prio-pill"
                      className="absolute inset-0"
                      style={{
                        borderRadius: 13,
                        background: prioActiveBg,
                        border: `1px solid ${prioActiveBorder}`,
                        boxShadow: isLight
                          ? "0 6px 14px -8px rgba(15,23,42,0.25)"
                          : "0 6px 14px -8px rgba(255,255,255,0.35)",
                      }}
                      transition={SPRING}
                    />
                  )}
                  <span
                    className="relative"
                    style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", color: on ? prioActiveText : T.hi }}
                  >
                    {label}
                  </span>
                  <span className="relative flex items-center gap-1" style={{ marginTop: 3 }}>
                    {oldFee && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: on ? prioActiveSubText : T.lo,
                        textDecoration: "line-through",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}>
                        {oldFee}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: on ? prioActiveSubText : T.md,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}
                    >
                      {fee}
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* CTA — lives inside the sheet so it scrolls with content. For BUY it
            opens the PayWith sheet (which then places the order on Confirm);
            for SELL it submits directly. */}
        <motion.button
          onClick={() => (isBuy ? setShowPayWith(true) : startTrade())}
          disabled={!ctaReady || isLoading || !userId}
          whileTap={ctaReady ? { scale: 0.985 } : undefined}
          animate={{
            background: ctaReady && !isLoading ? T.ctaActiveBg : T.ctaInactiveBg,
            color: ctaReady && !isLoading ? T.ctaActiveText : T.md,
            borderColor: ctaReady && !isLoading ? T.ctaActiveBorder : T.ctaInactiveBorder,
            boxShadow: ctaReady && !isLoading ? T.ctaActiveShadow : "none",
          }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full flex items-center justify-center mt-3"
          style={{
            gap: 4,
            minHeight: 56,
            borderRadius: 18,
            borderWidth: 1,
            borderStyle: "solid",
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "-0.01em",
          }}
        >
          {isLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : !hasAmount ? (
            "Enter Amount"
          ) : !isBuy && needsPaymentChoice ? (
            "Select where to receive"
          ) : (
            <>
              {isBuy ? <ArrowDownLeft size={16} strokeWidth={2.6} /> : <ArrowUpRight size={16} strokeWidth={2.6} />}
              {isBuy ? "Buy" : "Sell"} {formatAmountInput(amount)} USDT
            </>
          )}
        </motion.button>
      </motion.div>
      )}
      </AnimatePresence>

      {!hideBottomNav && !hasAmount && (
        <BottomNav
          screen={screen}
          setScreen={setScreen}
          maxW="max-w-[440px] mx-auto"
        />
      )}

      {/* PayWith — BUY pay-rail picker (bottom sheet). Confirm sets the chosen
          rails and places the order via the pendingStart effect above. */}
      <PayWithSheet
        open={showPayWith}
        onClose={() => setShowPayWith(false)}
        onConfirm={(cats) => {
          setBuyerPaymentTypes(cats);
          setShowPayWith(false);
          setPendingStart(true);
        }}
        confirmLabel={hasAmount ? `Buy ${formatAmountInput(amount)} USDT` : "Confirm"}
      />

      {/* Payment methods — merchant-style mobile bottom sheet, opened in place
          from "Add payment method" (no Profile redirect). Hosts the full
          multi-type PaymentMethodSelector (cards + complete add form for bank /
          UPI / cash / …) so it matches the Profile experience. Sized to the
          phone column (max-w-440, centered). */}
      <AnimatePresence>
        {showAddMethods && (
          <>
            <motion.div
              key="pm-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddMethods(false)}
              className="fixed inset-0 z-[120]"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
            />
            <motion.div
              key="pm-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[121] w-full max-w-[440px] md:max-w-[720px]"
              style={{
                background: T.bg,
                borderRadius: "28px 28px 0 0",
                maxHeight: "92dvh",
                overflowY: "auto",
                boxShadow: "0 -16px 44px -14px rgba(20,21,26,0.28)",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
                <div style={{ width: 38, height: 4, borderRadius: 99, background: T.handle }} />
              </div>

              <div className="flex items-center justify-between" style={{ padding: "6px 20px 8px" }}>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <div className="flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 11, background: T.activeTileBg }}>
                    <CreditCard size={16} strokeWidth={2.4} style={{ color: T.activeTileText }} />
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: T.hi }}>Payment methods</h3>
                </div>
                <button onClick={() => setShowAddMethods(false)} aria-label="Close" style={{ padding: 6, borderRadius: 10 }}>
                  <X size={18} strokeWidth={2.2} style={{ color: T.md }} />
                </button>
              </div>

              <div style={{ padding: "4px 20px 0" }}>
                <PaymentMethodSelector
                  userId={userId}
                  selectedId={selectedPaymentMethodId}
                  onSelect={(m) => {
                    onSelectPaymentMethod(m);
                    setChosenMethod(m);
                    if (m) {
                      // Keep the order's coarse payment_method in sync (bank vs
                      // cash); the exact method also rides along as its id.
                      setPaymentMethod(m.type === "cash" ? "cash" : "bank");
                      setShowAddMethods(false);
                    }
                  }}
                  hideHeader
                  alwaysExpanded
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
