"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import { Plus, CaretDown, Lightning } from "@phosphor-icons/react";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { useMerchantStore } from "@/stores/merchantStore";
import { FilterDropdown } from "@/components/user/screens/ui/FilterDropdown";
import { useCorridorPrices, resolveCorridorRef } from "@/hooks/useCorridorPrices";
import { formatCrypto, formatRate } from "@/lib/format";
import { FEE_UI_V2 } from "@/lib/featureFlags";

const CORRIDOR_OPTIONS = [
  { key: "USDT_AED", label: "🇦🇪 USDT / AED" },
  { key: "USDT_INR", label: "🇮🇳 USDT / INR" },
] as const;

function corridorFiat(corridorId: string | undefined): "AED" | "INR" {
  return corridorId === "USDT_INR" ? "INR" : "AED";
}

export interface OpenTradeFormState {
  tradeType: "buy" | "sell";
  cryptoAmount: string;
  paymentMethod: "bank" | "cash";
  paymentMethodId?: string;
  spreadPreference: "best" | "fastest" | "cheap";
  expiryMinutes: 15 | 90;
  boostPct?: number;
}

const BOOST_MAX_PCT = 25;

export interface TradeFormModalProps {
  isOpen: boolean;
  merchantId: string | null;
  openTradeForm: OpenTradeFormState;
  setOpenTradeForm: React.Dispatch<React.SetStateAction<OpenTradeFormState>>;
  effectiveBalance: number | null;
  isCreatingTrade: boolean;
  createTradeError: string | null;
  setCreateTradeError: (error: string | null) => void;
  onClose: () => void;
  onSubmit: () => void;
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;
  onAddPaymentMethod?: () => void;
}

function pmIcon(type: string) {
  return type === "bank" ? "🏦" : type === "cash" ? "💵" : type === "card" ? "💳" : type === "mobile" || type === "upi" ? "📱" : "💰";
}

export function TradeFormModal({
  isOpen,
  merchantId,
  openTradeForm,
  setOpenTradeForm,
  effectiveBalance,
  isCreatingTrade,
  createTradeError,
  setCreateTradeError,
  onClose,
  onSubmit,
  activeCorridor,
  onCorridorChange,
  onAddPaymentMethod,
}: TradeFormModalProps) {
  const paymentMethods = useMerchantStore((s) => s.paymentMethods);
  const paymentMethodsLoaded = useMerchantStore((s) => s.paymentMethodsLoaded);
  const refreshPaymentMethods = useMerchantStore((s) => s.fetchPaymentMethods);
  const [showPmDropdown, setShowPmDropdown] = useState(false);

  const corridorPrices = useCorridorPrices();
  const fiatCcy = corridorFiat(activeCorridor);
  const liveRate = resolveCorridorRef(corridorPrices, activeCorridor, fiatCcy);

  const isSell = openTradeForm.tradeType === "sell";
  const cryptoAmountNum = parseFloat(openTradeForm.cryptoAmount || "0");
  const overBalance =
    isSell && effectiveBalance !== null && cryptoAmountNum > effectiveBalance && cryptoAmountNum > 0;

  const disabledReason: string | null = (() => {
    if (isCreatingTrade) return null;
    if (!openTradeForm.cryptoAmount || cryptoAmountNum <= 0) return "Enter a USDT amount to continue";
    if (overBalance) return `Insufficient USDT — wallet has ${formatCrypto(effectiveBalance!)} USDT`;
    return null;
  })();
  const submitDisabled = isCreatingTrade || disabledReason !== null;

  const loadPaymentMethods = useCallback(() => {
    if (!merchantId) return;
    void refreshPaymentMethods(merchantId);
  }, [merchantId, refreshPaymentMethods]);

  useEffect(() => {
    if (!isOpen || openTradeForm.paymentMethodId || paymentMethods.length === 0) return;
    const def = paymentMethods.find((pm) => pm.is_default) || paymentMethods[0];
    if (def) {
      setOpenTradeForm((p) => ({
        ...p,
        paymentMethod: (def.type === "cash" ? "cash" : "bank") as "bank" | "cash",
        paymentMethodId: def.id,
      }));
    }
  }, [isOpen, paymentMethods, openTradeForm.paymentMethodId, setOpenTradeForm]);

  useEffect(() => {
    if (!isOpen || !merchantId) return;
    loadPaymentMethods();
  }, [isOpen, merchantId, loadPaymentMethods]);

  useEffect(() => {
    if (showPmDropdown) loadPaymentMethods();
  }, [showPmDropdown, loadPaymentMethods]);

  const handleClose = () => {
    onClose();
    setCreateTradeError(null);
    setShowPmDropdown(false);
  };

  const selectedPm =
    paymentMethods.find((pm) => pm.id === openTradeForm.paymentMethodId) ||
    paymentMethods.find((pm) => pm.type === openTradeForm.paymentMethod);

  const usdtAmt = cryptoAmountNum;
  const baseFiat = liveRate && usdtAmt > 0 ? usdtAmt * liveRate : null;
  const boost = openTradeForm.boostPct ?? 0;
  const boostFiat = baseFiat !== null ? baseFiat * (boost / 100) : null;
  const finalFiat =
    baseFiat !== null && boostFiat !== null
      ? isSell ? baseFiat - boostFiat : baseFiat + boostFiat
      : baseFiat;

  // Accent by trade side
  const sideColor = isSell ? "#b8e9d4" : "#7da0ff";
  const sideDim   = isSell ? "rgba(184,233,212,0.12)" : "rgba(125,160,255,0.12)";
  const sideBorder= isSell ? "rgba(184,233,212,0.25)" : "rgba(125,160,255,0.25)";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
            onClick={handleClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", damping: 28, stiffness: 340, mass: 0.8 }}
            className="fixed z-50 inset-x-4 bottom-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-[400px]"
            style={{ maxHeight: "90dvh", overflowY: "auto" }}
          >
            <div style={{
              background: "#111113",
              borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
              overflow: "hidden",
            }}>

              {/* ── Header ── */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 18px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.055)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  {/* Animated side indicator dot */}
                  <motion.div
                    key={openTradeForm.tradeType}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    style={{ width: 8, height: 8, borderRadius: 99, background: sideColor, boxShadow: `0 0 8px ${sideColor}88` }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#f5f5f7", letterSpacing: "-0.01em" }}>
                    Open Trade
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Corridor pill */}
                  {activeCorridor && onCorridorChange && (
                    <FilterDropdown<string>
                      value={activeCorridor}
                      onChange={onCorridorChange}
                      ariaLabel="Select trading pair"
                      align="right"
                      variant="square"
                      options={CORRIDOR_OPTIONS.map((c) => ({ key: c.key, label: c.label }))}
                    />
                  )}
                  <button
                    onClick={handleClose}
                    style={{
                      width: 28, height: 28, borderRadius: 99,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", color: "rgba(255,255,255,0.4)",
                    }}
                  >
                    <X style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              </div>

              {/* ── Body ── */}
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>

                {/* Buy / Sell toggle */}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5,
                  padding: 4,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 14,
                }}>
                  {(["sell", "buy"] as const).map((side) => {
                    const active = openTradeForm.tradeType === side;
                    const color  = side === "sell" ? "#b8e9d4" : "#7da0ff";
                    const bg     = side === "sell" ? "rgba(184,233,212,0.1)" : "rgba(125,160,255,0.1)";
                    const border = side === "sell" ? "rgba(184,233,212,0.22)" : "rgba(125,160,255,0.22)";
                    return (
                      <motion.button
                        key={side}
                        onClick={() => setOpenTradeForm((p) => ({ ...p, tradeType: side }))}
                        whileTap={{ scale: 0.97 }}
                        style={{
                          padding: "9px 0",
                          borderRadius: 10,
                          border: active ? `1px solid ${border}` : "1px solid transparent",
                          background: active ? bg : "transparent",
                          color: active ? color : "rgba(255,255,255,0.28)",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          transition: "all 0.16s",
                          letterSpacing: "0.005em",
                        }}
                      >
                        {side === "sell" ? "Sell USDT" : "Buy USDT"}
                      </motion.button>
                    );
                  })}
                </div>

                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 500, textAlign: "center", margin: "-2px 0 2px", letterSpacing: "0.01em" }}>
                  {isSell ? `You send USDT · receive ${fiatCcy}` : `You send ${fiatCcy} · receive USDT`}
                </p>

                {/* Amount input */}
                <div style={{
                  background: "rgba(255,255,255,0.04)",
                  border: overBalance ? "1px solid rgba(255,90,90,0.4)" : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 14,
                  padding: "0 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "border-color 0.2s",
                }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={14}
                    placeholder="0.00"
                    value={openTradeForm.cryptoAmount}
                    onChange={(e) => {
                      const v = clampDecimal(e.target.value, DECIMAL_PRESETS.amount);
                      setOpenTradeForm((p) => ({ ...p, cryptoAmount: v }));
                    }}
                    style={{
                      flex: 1,
                      background: "none",
                      border: "none",
                      outline: "none",
                      padding: "13px 0",
                      fontSize: 22,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: overBalance ? "#ff7a7e" : "#f5f5f7",
                      caretColor: sideColor,
                      minWidth: 0,
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                    {baseFiat !== null && (
                      <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.3)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        ≈ {formatCrypto(baseFiat)} {fiatCcy}
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.05em",
                      color: "rgba(255,255,255,0.4)",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 7, padding: "3px 7px",
                    }}>
                      USDT
                    </span>
                  </div>
                </div>

                {overBalance && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#ff7a7e", fontSize: 11.5, fontWeight: 600, margin: "-4px 0 0 2px" }}>
                    <AlertTriangle style={{ width: 12, height: 12 }} />
                    Wallet has {formatCrypto(effectiveBalance!)} USDT
                  </div>
                )}

                {/* Payment Method */}
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentMethods.length === 0 && onAddPaymentMethod) { onAddPaymentMethod(); return; }
                      setShowPmDropdown(!showPmDropdown);
                    }}
                    style={{
                      width: "100%",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      padding: "11px 14px",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      cursor: "pointer", boxSizing: "border-box",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.13)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
                  >
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", flexShrink: 0 }}>Payment</span>

                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end", minWidth: 0, overflow: "hidden" }}>
                      {!paymentMethodsLoaded && paymentMethods.length === 0 ? (
                        <span style={{ height: 10, width: 72, borderRadius: 5, background: "rgba(255,255,255,0.08)", display: "inline-block" }} />
                      ) : selectedPm ? (
                        <>
                          <span style={{ fontSize: 13 }}>{pmIcon(selectedPm.type)}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {selectedPm.name}
                          </span>
                          {selectedPm.details && (
                            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
                              {selectedPm.details}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", display: "flex", alignItems: "center", gap: 4 }}>
                          {onAddPaymentMethod ? <><Plus style={{ width: 12, height: 12 }} /> Add method</> : "No methods configured"}
                        </span>
                      )}
                      <CaretDown style={{ width: 13, height: 13, color: "rgba(255,255,255,0.22)", flexShrink: 0, transform: showPmDropdown ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                    </div>
                  </button>

                  <AnimatePresence>
                    {showPmDropdown && paymentMethods.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
                        animate={{ opacity: 1, y: 0, scaleY: 1 }}
                        exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
                        transition={{ duration: 0.14 }}
                        style={{
                          position: "absolute", zIndex: 30,
                          top: "calc(100% + 5px)", left: 0, right: 0,
                          borderRadius: 14,
                          border: "1px solid rgba(255,255,255,0.1)",
                          background: "#18181b",
                          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                          overflow: "hidden", maxHeight: 220, overflowY: "auto",
                          transformOrigin: "top",
                        }}
                      >
                        {paymentMethods.map((pm) => {
                          const sel = openTradeForm.paymentMethodId === pm.id;
                          return (
                            <button
                              key={pm.id}
                              type="button"
                              onClick={() => {
                                setOpenTradeForm((p) => ({
                                  ...p,
                                  paymentMethod: (pm.type === "cash" ? "cash" : "bank") as "bank" | "cash",
                                  paymentMethodId: pm.id,
                                }));
                                setShowPmDropdown(false);
                              }}
                              style={{
                                width: "100%", display: "flex", alignItems: "center", gap: 9,
                                padding: "10px 14px",
                                background: sel ? "rgba(255,255,255,0.06)" : "transparent",
                                border: "none", cursor: "pointer", boxSizing: "border-box", textAlign: "left",
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                              onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                            >
                              <span style={{ fontSize: 14 }}>{pmIcon(pm.type)}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: sel ? "#f5f5f7" : "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {pm.name}
                                </div>
                                {pm.details && (
                                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {pm.details}
                                  </div>
                                )}
                              </div>
                              {sel && (
                                <svg viewBox="0 0 14 14" width={12} height={12} fill="none" stroke={sideColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m2.5 7 3 3 6-6"/>
                                </svg>
                              )}
                            </button>
                          );
                        })}
                        {onAddPaymentMethod && (
                          <button
                            type="button"
                            onClick={() => { onAddPaymentMethod(); setShowPmDropdown(false); }}
                            style={{
                              width: "100%", display: "flex", alignItems: "center", gap: 8,
                              padding: "10px 14px",
                              borderTop: "1px solid rgba(255,255,255,0.06)",
                              background: "transparent", border: "none", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "rgba(255,255,255,0.06)",
                              cursor: "pointer", boxSizing: "border-box", color: "rgba(255,255,255,0.4)",
                            }}
                          >
                            <Plus style={{ width: 13, height: 13 }} />
                            <span style={{ fontSize: 12, fontWeight: 600 }}>Add payment method</span>
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Expiry */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 14,
                }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)" }}>
                    Expires
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {([15, 90] as const).map((mins) => {
                      const active = openTradeForm.expiryMinutes === mins;
                      return (
                        <button
                          key={mins}
                          onClick={() => setOpenTradeForm((p) => ({ ...p, expiryMinutes: mins }))}
                          style={{
                            padding: "4px 11px", borderRadius: 99,
                            fontSize: 11.5, fontWeight: 700,
                            border: active ? "1px solid rgba(255,255,255,0.14)" : "1px solid transparent",
                            background: active ? "rgba(255,255,255,0.09)" : "transparent",
                            color: active ? "#f5f5f7" : "rgba(255,255,255,0.3)",
                            cursor: "pointer", transition: "all 0.14s",
                          }}
                        >
                          {mins} min
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Priority Boost */}
                {FEE_UI_V2 && (() => {
                  const boostOn = boost > 0;
                  return (
                    <div style={{
                      borderRadius: 14, overflow: "hidden",
                      background: boostOn ? "rgba(245,200,66,0.06)" : "rgba(255,255,255,0.04)",
                      border: boostOn ? "1px solid rgba(245,200,66,0.22)" : "1px solid rgba(255,255,255,0.07)",
                      transition: "all 0.2s",
                    }}>
                      <button
                        type="button"
                        onClick={() => setOpenTradeForm((p) => ({ ...p, boostPct: boostOn ? 0 : 5 }))}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          padding: "10px 14px", background: "none", border: "none", cursor: "pointer", boxSizing: "border-box",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Lightning style={{ width: 12, height: 12, color: boostOn ? "#f5c842" : "rgba(255,255,255,0.25)" }} />
                          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: boostOn ? "#f5c842" : "rgba(255,255,255,0.28)" }}>
                            Priority Boost
                          </span>
                          {boostOn && (
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#f5c842", fontVariantNumeric: "tabular-nums" }}>
                              +{boost}%
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontWeight: 600 }}>
                          {boostOn ? "Remove" : "Add"}
                        </span>
                      </button>
                      {boostOn && (
                        <div style={{ padding: "0 14px 12px" }}>
                          <input
                            type="range" min={1} max={BOOST_MAX_PCT} step={1} value={boost}
                            onChange={(e) => setOpenTradeForm((p) => ({ ...p, boostPct: parseInt(e.target.value, 10) }))}
                            aria-label="Priority Boost percentage"
                            style={{ width: "100%", accentColor: "#f5c842" }}
                          />
                          <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                            Higher boost = faster acceptance. Max {BOOST_MAX_PCT}%.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Preview — only when there's an amount */}
                {finalFiat !== null && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "11px 14px",
                    background: sideDim,
                    border: `1px solid ${sideBorder}`,
                    borderRadius: 14,
                  }}>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: sideColor, opacity: 0.7 }}>
                        {isSell ? "You receive" : "You pay"}
                      </div>
                      {liveRate && (
                        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                          @ {formatRate(liveRate)} {fiatCcy}/USDT
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 800, color: sideColor, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                      {formatCrypto(finalFiat)} {fiatCcy}
                    </span>
                  </div>
                )}

                {/* Error */}
                {createTradeError && (
                  <div style={{
                    padding: "10px 12px", borderRadius: 12,
                    background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.2)",
                    display: "flex", alignItems: "flex-start", gap: 7,
                  }}>
                    <AlertTriangle style={{ width: 13, height: 13, color: "#ff7a7e", flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 12, color: "#ff7a7e", lineHeight: 1.5 }}>{createTradeError}</span>
                  </div>
                )}
              </div>

              {/* ── Footer ── */}
              <div style={{ padding: "0 18px 20px", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
                {disabledReason && !overBalance && (
                  <p style={{ fontSize: 11, color: "rgba(255,190,60,0.65)", textAlign: "center", marginBottom: 9, fontWeight: 500 }}>
                    {disabledReason}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleClose}
                    style={{
                      flex: 1, padding: "13px 0", borderRadius: 13,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                      color: "rgba(255,255,255,0.35)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={submitDisabled}
                    onClick={onSubmit}
                    style={{
                      flex: 2, padding: "13px 0", borderRadius: 13,
                      background: submitDisabled ? "rgba(255,255,255,0.04)" : sideDim,
                      border: submitDisabled ? "1px solid rgba(255,255,255,0.06)" : `1px solid ${sideBorder}`,
                      color: submitDisabled ? "rgba(255,255,255,0.2)" : sideColor,
                      fontSize: 13.5, fontWeight: 800, cursor: submitDisabled ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                      letterSpacing: "-0.01em", transition: "all 0.15s",
                    }}
                  >
                    {isCreatingTrade ? (
                      <>
                        <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                        Opening…
                      </>
                    ) : (
                      `${isSell ? "Sell" : "Buy"} USDT`
                    )}
                  </motion.button>
                </div>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
