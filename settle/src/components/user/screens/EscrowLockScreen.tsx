"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import {
  ChevronLeft,
  Shield,
  AlertTriangle,
  Loader2,
  Lock,
  Clock,
  ExternalLink,
  Building2,
  Smartphone,
  ChevronsRight,
  Wallet,
  Store,
} from "lucide-react";
import type { Screen } from "./types";
import { BankAccountSelector, type SelectedBankDetails } from "@/components/user/BankAccountSelector";
import type { PaymentMethodItem } from "@/components/user/PaymentMethodSelector";
import { networkLabel, explorerUrl } from "@/lib/solana/networkLabel";
import { BottomNav } from "./BottomNav";

const T = {
  hi: "rgba(255,255,255,0.96)",
  md: "rgba(255,255,255,0.55)",
  lo: "rgba(255,255,255,0.32)",
  xl: "rgba(255,255,255,0.18)",
};

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.8 };

export interface EscrowLockScreenProps {
  screen?: Screen;
  setScreen: (s: Screen) => void;
  amount: string;
  fiatAmount: string;
  currentRate: number;
  escrowTxStatus: 'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error';
  setEscrowTxStatus: (s: 'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error') => void;
  escrowTxHash: string | null;
  escrowError: string | null;
  setEscrowError: (e: string | null) => void;
  isLoading: boolean;
  confirmEscrow: () => void;
  selectedBankDetails: SelectedBankDetails | null;
  setSelectedBankDetails: (v: SelectedBankDetails | null) => void;
  selectedPaymentMethod?: PaymentMethodItem | null;
  userId: string | null;
  setShowWalletModal: (v: boolean) => void;
  onConnectWallet?: () => void;
  fiatCurrency?: string;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    usdtBalance: number | null;
    programReady: boolean;
    disconnect: () => void;
    reinitializeProgram: () => void;
  };
}

export const EscrowLockScreen = ({
  screen = "escrow",
  setScreen,
  amount,
  fiatAmount,
  currentRate,
  escrowTxStatus,
  setEscrowTxStatus,
  escrowTxHash,
  escrowError,
  setEscrowError,
  isLoading,
  confirmEscrow,
  selectedBankDetails,
  setSelectedBankDetails,
  selectedPaymentMethod,
  userId,
  setShowWalletModal,
  onConnectWallet,
  fiatCurrency = 'AED',
  solanaWallet,
}: EscrowLockScreenProps) => {
  const fiatSymbol = fiatCurrency === 'INR' ? '₹' : fiatCurrency === 'USD' ? '$' : 'د.إ';
  const handleConnectWallet = onConnectWallet || (() => setShowWalletModal(true));
  const balanceOk = solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance >= parseFloat(amount || '0');
  const isProcessing = ['signing', 'confirming', 'recording'].includes(escrowTxStatus);

  // QR-scan handoff: when this screen is reached from UpiPayScreen
  // (scan a merchant's UPI QR → enter amount → land here for escrow lock),
  // page.tsx writes the scanned UPI destination into sessionStorage under
  // `blip_pending_upi_payment`. We surface those details as the order's
  // payment-method card so the user can see WHERE the INR will land
  // instead of an empty "Add Payment Method" CTA.
  const [scannedUpi, setScannedUpi] = useState<{
    vpa: string;
    payeeName: string;
    fiatInr: number;
  } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("blip_pending_upi_payment");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        vpa?: string;
        payeeName?: string;
        fiatInr?: number;
        at?: number;
      };
      // Match the freshness window the order-create hook uses (15 min).
      if (!parsed?.vpa || Date.now() - (parsed.at || 0) > 15 * 60 * 1000) return;
      setScannedUpi({
        vpa: parsed.vpa,
        payeeName: parsed.payeeName || "",
        fiatInr: Number(parsed.fiatInr || 0),
      });
    } catch { /* sessionStorage blocked / bad JSON — non-fatal */ }
  }, []);

  return (
    <div
      className="relative flex flex-col min-h-[100dvh] overflow-y-auto"
      style={{ background: "#07090F" }}
    >
      {/* Ambient white glow at top — confirmation context */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 28%, transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      />

      {/* ── Header ── */}
      <header className="relative z-10 max-w-[440px] mx-auto w-full px-5 pt-5">
        <div className="flex items-center justify-between">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              setScreen("home");
              setEscrowTxStatus('idle');
              setEscrowError(null);
            }}
            className="flex items-center justify-center"
            style={{
              width: 38, height: 38, borderRadius: 13,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <ChevronLeft size={18} strokeWidth={2.2} style={{ color: T.hi }} />
          </motion.button>
          <h1 style={{
            fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: T.hi,
          }}>
            Confirm Escrow
          </h1>
          <div style={{ width: 38 }} />
        </div>
      </header>

      {/* ── Content ── */}
      <div className="relative z-10 max-w-[440px] mx-auto w-full px-5 pt-7 pb-32 flex flex-col" style={{ gap: 14 }}>
        {/* Hero — lock medallion + title + subtitle */}
        <div className="flex items-center" style={{ gap: 14 }}>
          <div
            className="flex items-center justify-center shrink-0 relative overflow-hidden"
            style={{
              width: 50, height: 50, borderRadius: 16,
              background: "linear-gradient(135deg, #1A1F2C 0%, #0B0F17 100%)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow:
                "0 8px 22px -10px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.10)",
            }}
          >
            <Lock size={22} strokeWidth={2.2} style={{ color: "#FFFFFF" }} />
          </div>
          <div className="min-w-0">
            <h2 style={{
              fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em",
              color: T.hi, lineHeight: 1.15,
            }}>
              Lock {parseFloat(amount).toFixed(2)} USDT
            </h2>
            <p style={{
              fontSize: 12, fontWeight: 600, color: T.md, marginTop: 4,
            }}>
              Held securely on Solana until you confirm payment
            </p>
          </div>
        </div>

        {/* ── Trade Route — You → Escrow → Merchant ── */}
        <TradeRoute />

        {/* ── Live network status ticker ── */}
        <NetworkTicker />

        {/* Wallet card */}
        <div
          className="w-full"
          style={{
            padding: "13px 14px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
        >
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 13, fontWeight: 600, color: T.md }}>Wallet</span>
            {solanaWallet.connected ? (
              <div className="flex items-center" style={{ gap: 6 }}>
                <span
                  style={{
                    width: 6, height: 6, borderRadius: 999,
                    background: "#FFFFFF",
                    boxShadow: "0 0 6px rgba(255,255,255,0.55)",
                  }}
                />
                <span style={{
                  fontSize: 12, fontWeight: 700, color: T.hi,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}>
                  {solanaWallet.walletAddress?.slice(0, 4)}…{solanaWallet.walletAddress?.slice(-4)}
                </span>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                style={{ fontSize: 12, fontWeight: 700, color: T.hi }}
              >
                Connect Wallet
              </button>
            )}
          </div>
          {solanaWallet.connected && (
            <div
              className="flex items-center justify-between"
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: T.md }}>Balance</span>
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: balanceOk ? T.hi : "#F87171",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}>
                {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
              </span>
            </div>
          )}
        </div>

        {/* Order details card */}
        <div
          className="w-full"
          style={{
            padding: "13px 14px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
        >
          {[
            { label: "Amount to Lock", value: `${parseFloat(amount).toFixed(2)} USDT`, primary: true },
            { label: "You'll receive", value: `${fiatSymbol} ${parseFloat(fiatAmount).toLocaleString()}`, primary: true },
            { label: "Rate", value: `1 USDT = ${currentRate} ${fiatCurrency}` },
            { label: "Network", value: networkLabel() },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              className="flex items-center justify-between"
              style={{
                padding: "9px 0",
                borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: T.md }}>{row.label}</span>
              <span style={{
                fontSize: 13, fontWeight: row.primary ? 700 : 600,
                color: row.primary ? T.hi : T.md,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Payment method */}
        <div className="w-full">
          <div className="flex items-center" style={{ gap: 6, marginBottom: 8 }}>
            <Building2 size={11} strokeWidth={2.4} style={{ color: T.lo }} />
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: "0.22em",
              color: T.lo, textTransform: "uppercase",
            }}>
              Your Payment Method
            </span>
          </div>
          {scannedUpi ? (
            // Scanned UPI handoff from UpiPayScreen — the merchant who
            // accepts this order pays INR directly to this VPA. We show
            // it as a read-only card here (and again on the order-detail
            // page) so the user can sanity-check the scanned destination
            // before locking funds.
            <div
              className="w-full flex items-center"
              style={{
                gap: 11,
                padding: "11px 12px",
                borderRadius: 16,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Smartphone size={14} strokeWidth={2.2} style={{ color: T.md }} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{
                  fontSize: 13, fontWeight: 800, letterSpacing: "-0.005em",
                  color: T.hi,
                }} className="truncate">
                  {scannedUpi.payeeName || scannedUpi.vpa}
                </p>
                <p style={{
                  fontSize: 10, fontWeight: 600, color: T.lo, marginTop: 1,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }} className="truncate">
                  UPI · {scannedUpi.vpa}
                </p>
                {scannedUpi.fiatInr > 0 && (
                  <p style={{
                    fontSize: 10, fontWeight: 700, color: T.md, marginTop: 2,
                  }}>
                    ₹{scannedUpi.fiatInr.toFixed(2)} expected
                  </p>
                )}
              </div>
              <Lock size={13} strokeWidth={2.4} style={{ color: T.lo, flexShrink: 0 }} />
            </div>
          ) : selectedPaymentMethod ? (
            <div
              className="w-full flex items-center"
              style={{
                gap: 11,
                padding: "11px 12px",
                borderRadius: 16,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {selectedPaymentMethod.type === 'upi' ? (
                  <Smartphone size={14} strokeWidth={2.2} style={{ color: T.md }} />
                ) : (
                  <Building2 size={14} strokeWidth={2.2} style={{ color: T.md }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p style={{
                  fontSize: 13, fontWeight: 800, letterSpacing: "-0.005em",
                  color: T.hi,
                }}>
                  {selectedPaymentMethod.label}
                </p>
                <p style={{
                  fontSize: 10, fontWeight: 600, color: T.lo, marginTop: 1,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}>
                  {selectedPaymentMethod.type === 'bank'
                    ? `${selectedPaymentMethod.details.account_name || ''} · ${selectedPaymentMethod.details.iban ? selectedPaymentMethod.details.iban.slice(0, 4) + '…' + selectedPaymentMethod.details.iban.slice(-4) : ''}`
                    : selectedPaymentMethod.type === 'upi'
                    ? selectedPaymentMethod.details.upi_id || ''
                    : Object.values(selectedPaymentMethod.details).filter(Boolean).join(' · ')}
                </p>
              </div>
              <Lock size={13} strokeWidth={2.4} style={{ color: T.lo, flexShrink: 0 }} />
            </div>
          ) : (
            <BankAccountSelector
              userId={userId}
              selected={selectedBankDetails}
              onSelect={setSelectedBankDetails}
            />
          )}
        </div>

        {/* Program-not-ready warning */}
        <AnimatePresence>
          {solanaWallet.connected && !solanaWallet.programReady && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
              style={{ overflow: "hidden" }}
            >
              <div
                className="w-full"
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: "rgba(245,158,11,0.10)",
                  border: "1px solid rgba(245,158,11,0.28)",
                }}
              >
                <div className="flex items-start" style={{ gap: 10 }}>
                  <AlertTriangle size={16} strokeWidth={2.2} style={{ color: "#F59E0B", flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 13, fontWeight: 800, color: "#FBBF24" }}>Wallet Needs Reconnection</p>
                    <p style={{ fontSize: 11, fontWeight: 600, color: T.md, marginTop: 2 }}>
                      The escrow program is not ready. Please reconnect your wallet.
                    </p>
                  </div>
                </div>
                <div className="flex" style={{ gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => {
                      solanaWallet.disconnect();
                      setTimeout(handleConnectWallet, 100);
                    }}
                    className="flex-1"
                    style={{
                      padding: "9px 0", borderRadius: 11,
                      background: "#FFFFFF",
                      color: "#0B0F14",
                      fontSize: 12, fontWeight: 800, letterSpacing: "-0.005em",
                    }}
                  >
                    Reconnect Wallet
                  </button>
                  <button
                    onClick={() => solanaWallet.reinitializeProgram()}
                    style={{
                      padding: "9px 14px", borderRadius: 11,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: T.md,
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error message */}
        <AnimatePresence>
          {escrowError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
              style={{ overflow: "hidden" }}
            >
              <div
                className="w-full"
                style={{
                  padding: 14,
                  borderRadius: 16,
                  background: "rgba(239,68,68,0.10)",
                  border: "1px solid rgba(239,68,68,0.28)",
                }}
              >
                <div className="flex items-start" style={{ gap: 10 }}>
                  <AlertTriangle size={16} strokeWidth={2.2} style={{ color: "#F87171", flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1">
                    <p style={{ fontSize: 13, fontWeight: 800, color: "#FCA5A5" }}>Transaction Failed</p>
                    <p style={{ fontSize: 11, fontWeight: 600, color: T.md, marginTop: 2 }}>{escrowError}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setEscrowError(null); setEscrowTxStatus('idle'); }}
                  className="w-full"
                  style={{
                    marginTop: 12, padding: "9px 0", borderRadius: 11,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: T.md,
                    fontSize: 12, fontWeight: 700,
                  }}
                >
                  Try Again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success state OR Confirm CTA */}
        {escrowTxStatus === 'success' ? (
          <div className="flex flex-col" style={{ gap: 12 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 18,
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.30)",
                boxShadow: "0 16px 32px -16px rgba(16,185,129,0.40)",
              }}
            >
              <div className="flex items-center" style={{ gap: 11, marginBottom: 10 }}>
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 36, height: 36, borderRadius: 12,
                    background: "rgba(16,185,129,0.18)",
                    border: "1px solid rgba(16,185,129,0.32)",
                  }}
                >
                  <Lock size={16} strokeWidth={2.4} style={{ color: "#34D399" }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 800, color: "#6EE7B7" }}>Escrow Locked</p>
                  <p style={{ fontSize: 11, fontWeight: 600, color: T.md, marginTop: 1 }}>Your USDT is secured on-chain</p>
                </div>
              </div>
              {escrowTxHash && (
                <a
                  href={explorerUrl('tx', escrowTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center"
                  style={{
                    gap: 5,
                    fontSize: 12, fontWeight: 700,
                    color: "#34D399",
                  }}
                >
                  View Transaction <ExternalLink size={11} strokeWidth={2.4} />
                </a>
              )}
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 18,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center" style={{ gap: 11 }}>
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 36, height: 36, borderRadius: 12,
                    background: "rgba(255,255,255,0.06)",
                  }}
                >
                  <Clock size={16} strokeWidth={2.4} style={{ color: T.md }} />
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: 13, fontWeight: 800, color: T.hi }}>Waiting for merchant</p>
                  <p style={{ fontSize: 11, fontWeight: 600, color: T.lo, marginTop: 1 }}>
                    Merchant will accept and send fiat to your bank
                  </p>
                </div>
              </div>
              <div
                style={{
                  marginTop: 10, height: 3, borderRadius: 999,
                  background: "rgba(255,255,255,0.05)", overflow: "hidden",
                }}
              >
                <motion.div
                  style={{ height: "100%", width: "30%", background: "rgba(255,255,255,0.25)" }}
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setScreen("order")}
              className="w-full flex items-center justify-center"
              style={{
                minHeight: 54,
                borderRadius: 16,
                background: "#FFFFFF",
                color: "#0B0F14",
                fontSize: 15, fontWeight: 800, letterSpacing: "-0.005em",
                border: "1px solid rgba(255,255,255,0.6)",
                boxShadow:
                  "0 14px 28px -10px rgba(255,255,255,0.20), inset 0 1px 0 rgba(255,255,255,0.85)",
              }}
            >
              View Order Details
            </motion.button>
          </div>
        ) : isProcessing ? (
          // While signing / confirming / recording — show a static processing pill
          <div
            className="w-full flex items-center justify-center"
            style={{
              minHeight: 56,
              borderRadius: 18,
              gap: 8,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: T.md,
              fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em",
            }}
          >
            <Loader2 size={16} className="animate-spin" />
            {escrowTxStatus === 'signing' && "Sign in wallet…"}
            {escrowTxStatus === 'confirming' && "Confirming on Solana…"}
            {escrowTxStatus === 'recording' && "Recording escrow…"}
          </div>
        ) : !solanaWallet.connected ? (
          // Connect-wallet button (no swipe yet — wallet must be connected)
          <motion.button
            whileTap={{ scale: 0.985 }}
            onClick={handleConnectWallet}
            className="w-full flex items-center justify-center"
            style={{
              minHeight: 56,
              borderRadius: 18,
              gap: 8,
              background: "#FFFFFF",
              border: "1px solid rgba(255,255,255,0.6)",
              color: "#0B0F14",
              fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em",
              boxShadow: "0 14px 28px -10px rgba(255,255,255,0.20), inset 0 1px 0 rgba(255,255,255,0.85)",
            }}
          >
            <Wallet size={15} strokeWidth={2.6} />
            Connect Wallet to Lock
          </motion.button>
        ) : !solanaWallet.programReady ? (
          <div
            className="w-full flex items-center justify-center"
            style={{
              minHeight: 56,
              borderRadius: 18,
              gap: 8,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: T.lo,
              fontSize: 15, fontWeight: 800,
            }}
          >
            Wallet Not Ready
          </div>
        ) : (
          // Swipe-to-Lock — the Uber/Apple Pay slide-to-confirm pattern
          <SwipeToLock
            label={`Slide to Lock ${parseFloat(amount).toFixed(2)} USDT`}
            onConfirm={confirmEscrow}
          />
        )}
      </div>

      <BottomNav
        screen={screen}
        setScreen={setScreen}
        maxW="max-w-[440px] mx-auto"
      />
    </div>
  );
};

// ─── Trade Route — animated route lane (You → Escrow → Merchant) ──────────
function TradeRoute() {
  const nodes = [
    { Icon: Wallet, label: "You", state: "done" as const },
    { Icon: Lock,   label: "Escrow", state: "active" as const },
    { Icon: Store,  label: "Merchant", state: "pending" as const },
  ];

  const colorOf = (s: "done" | "active" | "pending") =>
    s === "active" ? "#0B0F14" : s === "done" ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.20)";

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 18,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <div className="flex items-center" style={{ gap: 0 }}>
        {nodes.map((n, i) => {
          const c = colorOf(n.state);
          return (
            <div key={n.label} className="flex items-center" style={{ flex: i === nodes.length - 1 ? "0 0 auto" : 1 }}>
              <div className="flex flex-col items-center" style={{ gap: 6 }}>
                <motion.div
                  className="flex items-center justify-center relative"
                  animate={n.state === "active" ? {
                    boxShadow: [
                      "0 0 0 0 rgba(255,255,255,0.30), 0 6px 14px -6px rgba(0,0,0,0.55)",
                      "0 0 0 8px rgba(255,255,255,0.0), 0 6px 14px -6px rgba(0,0,0,0.55)",
                    ],
                  } : undefined}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  style={{
                    width: 34, height: 34, borderRadius: 11,
                    background: n.state === "active"
                      ? "#FFFFFF"
                      : n.state === "done"
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(255,255,255,0.03)",
                    border: n.state === "active"
                      ? "1px solid rgba(255,255,255,0.55)"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <n.Icon size={14} strokeWidth={2.4} style={{ color: c }} />
                </motion.div>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: "0.10em",
                  textTransform: "uppercase",
                  color: n.state === "pending" ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.78)",
                }}>
                  {n.label}
                </span>
              </div>
              {i < nodes.length - 1 && (
                <div className="flex-1 relative" style={{ height: 2, marginInline: 8 }}>
                  {/* Track */}
                  <div
                    style={{
                      position: "absolute", inset: 0,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.08)",
                    }}
                  />
                  {/* Animated dashes — only between done→active (left segment) */}
                  {i === 0 && (
                    <motion.div
                      className="absolute"
                      style={{
                        top: 0, bottom: 0, left: 0, right: 0,
                        borderRadius: 999,
                        backgroundImage:
                          "repeating-linear-gradient(90deg, rgba(255,255,255,0.85) 0 6px, transparent 6px 12px)",
                        backgroundSize: "12px 100%",
                      }}
                      animate={{ backgroundPositionX: ["0px", "12px"] }}
                      transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Network ticker — live Solana block height + status ────────────────────
function NetworkTicker() {
  // Pseudo-live block height — increments smoothly to feel live without
  // burning RPC calls on every render. Real block height can replace this
  // by wiring a `connection.getSlot()` poll.
  const [block, setBlock] = useState(() => 271_000_000 + Math.floor(Math.random() * 50_000));
  useEffect(() => {
    const id = setInterval(() => setBlock((b) => b + 1), 480);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: "8px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          style={{
            width: 6, height: 6, borderRadius: 999,
            background: "#FFFFFF",
            boxShadow: "0 0 6px rgba(255,255,255,0.55)",
          }}
        />
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
          color: T.md, textTransform: "uppercase",
        }}>
          Solana Mainnet · ~0.5s
        </span>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "-0.005em",
        color: T.lo,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>
        #{block.toLocaleString("en-US")}
      </span>
    </div>
  );
}

// ─── Swipe to Lock — drag the thumb to confirm ─────────────────────────────
function SwipeToLock({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [trackW, setTrackW] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const THUMB = 48;
  const PAD = 4;

  useEffect(() => {
    const update = () => {
      if (trackRef.current) {
        const w = trackRef.current.getBoundingClientRect().width;
        setTrackW(w - THUMB - PAD * 2);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Progress 0..1 for fill + label fade
  const progress = useTransform(x, (v) => (trackW > 0 ? Math.min(1, Math.max(0, v / trackW)) : 0));
  const labelOpacity = useTransform(progress, [0, 0.5], [1, 0]);
  const fillWidth = useTransform(x, (v) => `${THUMB + PAD + v}px`);

  const handleEnd = () => {
    if (confirmed) return;
    if (x.get() >= trackW * 0.85) {
      setConfirmed(true);
      animate(x, trackW, { type: "spring", stiffness: 380, damping: 36 });
      setTimeout(() => onConfirm(), 180);
    } else {
      animate(x, 0, { type: "spring", stiffness: 380, damping: 36 });
    }
  };

  return (
    <div
      ref={trackRef}
      className="relative w-full overflow-hidden"
      style={{
        height: 56,
        borderRadius: 999,
        padding: PAD,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      {/* Subtle white-glass fill that grows behind the thumb */}
      <motion.div
        aria-hidden
        className="absolute"
        style={{
          top: PAD, bottom: PAD, left: 0,
          width: fillWidth,
          borderRadius: 999,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.18) 100%)",
        }}
      />

      {/* Center label — fades out as user drags */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ opacity: labelOpacity }}
      >
        <span
          className="flex items-center"
          style={{
            gap: 6,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "-0.005em",
            color: T.hi,
          }}
        >
          {label}
          <motion.span
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            style={{ display: "inline-flex" }}
          >
            <ChevronsRight size={14} strokeWidth={2.6} style={{ color: T.md }} />
          </motion.span>
        </span>
      </motion.div>

      {/* Draggable thumb — always white */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: trackW }}
        dragElastic={0}
        dragMomentum={false}
        onDragEnd={handleEnd}
        whileTap={{ cursor: "grabbing" }}
        style={{
          x,
          width: THUMB,
          height: THUMB,
          borderRadius: 999,
          background: "#FFFFFF",
          border: "1px solid rgba(255,255,255,0.55)",
          boxShadow:
            "0 6px 14px -6px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.85)",
          touchAction: "pan-y",
          cursor: "grab",
        }}
        className="absolute flex items-center justify-center"
      >
        {confirmed ? (
          <Loader2 size={18} className="animate-spin" style={{ color: "#0B0F14" }} />
        ) : (
          <Lock size={16} strokeWidth={2.6} style={{ color: "#0B0F14" }} />
        )}
      </motion.div>
    </div>
  );
}
