"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Scanner, type IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { ChevronLeft, Loader2, Check, AlertCircle } from "lucide-react";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";

interface ParsedUpi {
  pa: string;
  pn: string;
  am: string;
  tn: string;
}

function parseUpiUrl(raw: string): ParsedUpi | null {
  try {
    if (!raw.toLowerCase().startsWith("upi://")) return null;
    const qIdx = raw.indexOf("?");
    if (qIdx < 0) return null;
    const params = new URLSearchParams(raw.slice(qIdx + 1));
    const pa = params.get("pa") || "";
    if (!pa) return null;
    return {
      pa,
      pn: params.get("pn") || "",
      am: params.get("am") || "",
      tn: params.get("tn") || "",
    };
  } catch {
    return null;
  }
}

const UPI_BASE = process.env.NEXT_PUBLIC_UPI_PAY_BASE_URL || "";

export interface UpiPayConfirm {
  vpa: string;
  payeeName: string;
  fiatInr: number;
  cryptoUsdt: number;
  note: string;
}

interface Props {
  onClose: () => void;
  /** USDT→INR rate. If null, scanner cannot compute the USDT side and submit is disabled. */
  currentRate: number | null;
  /** Fires when user confirms. Parent should prefill trade state + jump to escrow lock. */
  onConfirm: (data: UpiPayConfirm) => void;
}

export function UpiPayScreen({ onClose, currentRate, onConfirm }: Props) {
  const [stage, setStage] = useState<"scanning" | "entering" | "submitting" | "done" | "error">(
    "scanning",
  );
  const [parsed, setParsed] = useState<ParsedUpi | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const onScan = useCallback((codes: IDetectedBarcode[]) => {
    const first = codes[0]?.rawValue;
    if (!first) return;
    const p = parseUpiUrl(first);
    if (!p) {
      setErrorMsg("Not a UPI QR. Try again.");
      return;
    }
    setParsed(p);
    setAmount(p.am || "");
    setNote(p.tn || "");
    setStage("entering");
  }, []);

  const submit = async () => {
    if (!parsed) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrorMsg("Enter a valid amount");
      return;
    }
    if (!currentRate || currentRate <= 0) {
      setErrorMsg("Live USDT/INR rate unavailable. Wait a moment and retry.");
      return;
    }
    // ₹X ÷ rate(INR per USDT) = USDT amount needed to lock in escrow.
    // 4dp rounding keeps the on-chain amount within USDT's 6-decimal mint.
    const cryptoUsdt = Math.ceil((amt / currentRate) * 10000) / 10000;

    setStage("submitting");
    setErrorMsg("");
    // Fire-and-forget: record the request in the prototype inbox too, so the
    // merchant side has visibility. Failure here does NOT block the on-chain
    // sell order — the real settlement is the Blip escrow flow.
    if (UPI_BASE) {
      void fetch(`${UPI_BASE}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pa: parsed.pa,
          pn: parsed.pn,
          am: amt,
          tn: note,
        }),
      }).catch(() => { /* non-fatal */ });
    }
    onConfirm({
      vpa: parsed.pa,
      payeeName: parsed.pn,
      fiatInr: amt,
      cryptoUsdt,
      note,
    });
  };

  const formattedAmount = amount
    ? Number(amount.replace(/,/g, "")).toLocaleString("en-US")
    : "";
  const len = (formattedAmount || "0").length;
  const fontSize =
    len <= 4 ? 76 : len <= 6 ? 64 : len <= 8 ? 52 : len <= 10 ? 42 : 34;

  return (
    <div className="fixed inset-0 z-[100] bg-surface-base text-text-primary flex flex-col h-dvh">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-surface-card hover:bg-surface-hover border border-border-medium transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-text-tertiary">
          {stage === "scanning" ? "Scan to Pay" : stage === "done" ? "Sent" : "Pay via UPI"}
        </p>
        <div className="w-[64px]" />
      </div>

      <AnimatePresence mode="wait">
        {/* ── SCANNING ─────────────────────────────────────────────── */}
        {stage === "scanning" && (
          <motion.div
            key="scan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center px-5 pb-6"
          >
            <div className="relative w-full max-w-[360px] aspect-square rounded-3xl overflow-hidden bg-black border border-border-medium shadow-2xl">
              <Scanner
                onScan={onScan}
                onError={(err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  setErrorMsg(msg);
                }}
                constraints={{ facingMode: "environment" }}
                styles={{
                  container: { width: "100%", height: "100%" },
                  video: { width: "100%", height: "100%", objectFit: "cover" },
                }}
                components={{ finder: false }}
              />
              {/* viewfinder */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-2/3 h-2/3 border-2 border-white/70 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            </div>
            <p className="mt-6 text-[12px] text-text-tertiary text-center max-w-[300px]">
              Align the merchant&apos;s UPI QR inside the frame
            </p>
            {errorMsg && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] bg-error-dim border border-error-border text-error">
                <AlertCircle className="w-3.5 h-3.5" />
                {errorMsg}
              </div>
            )}
          </motion.div>
        )}

        {/* ── ENTERING AMOUNT ─────────────────────────────────────── */}
        {stage === "entering" && parsed && (
          <motion.div
            key="enter"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex-1 flex flex-col px-5 pb-6 min-h-0"
          >
            {/* Merchant card */}
            <div className="mt-2 rounded-2xl p-4 bg-surface-card border border-border-subtle">
              <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-text-tertiary mb-1">
                Paying
              </p>
              <p className="text-[18px] font-semibold leading-tight text-text-primary truncate">
                {parsed.pn || parsed.pa}
              </p>
              {parsed.pn && (
                <p className="text-[12px] text-text-tertiary mt-0.5 truncate">{parsed.pa}</p>
              )}
            </div>

            {/* Giant amount input — matches TradeCreationScreen aesthetic */}
            <div className="flex-1 flex flex-col items-center justify-center">
              <p
                className="text-text-tertiary mb-3"
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.26em",
                  textTransform: "uppercase",
                }}
              >
                Enter amount
              </p>
              <div className="flex items-baseline justify-center w-full" style={{ gap: 10 }}>
                <span
                  style={{
                    fontSize: Math.round(fontSize * 0.5),
                    fontWeight: 800,
                    color: "var(--text-tertiary, #888)",
                  }}
                >
                  ₹
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  maxLength={14}
                  autoFocus
                  value={formattedAmount}
                  onChange={(e) =>
                    setAmount(clampDecimal(e.target.value.replace(/,/g, ""), DECIMAL_PRESETS.amount))
                  }
                  placeholder="0"
                  className="bg-transparent border-0 outline-none text-center text-text-primary"
                  style={{
                    fontSize,
                    fontWeight: 800,
                    letterSpacing: "-0.05em",
                    lineHeight: 1,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    width: `${Math.max(60, Math.ceil((formattedAmount.length || 1) * fontSize * 0.6))}px`,
                    maxWidth: "100%",
                    padding: 0,
                  }}
                />
              </div>
              <p className="mt-3 text-[10px] tracking-[0.25em] uppercase text-text-tertiary">INR</p>
              {amount && currentRate && currentRate > 0 && (
                <p className="mt-2 text-[11px] text-text-tertiary">
                  Locks ≈ {(Number(amount) / currentRate).toFixed(4)} USDT @ ₹{currentRate.toFixed(2)}
                </p>
              )}
            </div>

            {/* Note */}
            <div className="mb-3">
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="What's it for?"
                className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
              />
            </div>

            {errorMsg && (
              <div className="mb-3 rounded-xl p-3 text-sm bg-error-dim border border-error-border text-error">
                {errorMsg}
              </div>
            )}

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={submit}
              disabled={!amount || Number(amount) <= 0}
              className={`w-full py-3.5 rounded-xl text-sm font-bold tracking-[-0.01em] transition-colors ${
                !amount || Number(amount) <= 0
                  ? "bg-surface-card text-text-tertiary cursor-not-allowed"
                  : "bg-accent text-accent-text"
              }`}
            >
              Lock USDT & Pay ₹{formattedAmount || "0"}
            </motion.button>
          </motion.div>
        )}

        {/* ── SUBMITTING ──────────────────────────────────────────── */}
        {stage === "submitting" && (
          <motion.div
            key="sub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center gap-3"
          >
            <Loader2 className="w-8 h-8 animate-spin text-text-tertiary" />
            <p className="text-[12px] text-text-tertiary tracking-[0.2em] uppercase">Sending…</p>
          </motion.div>
        )}

        {/* ── DONE ────────────────────────────────────────────────── */}
        {stage === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex-1 flex flex-col items-center justify-center gap-4 px-6"
          >
            <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-accent" />
            </div>
            <p className="text-[22px] font-bold tracking-[-0.02em]">Request created</p>
            <p className="text-[12px] text-text-tertiary text-center max-w-[280px]">
              The payment request is in the merchant inbox. Status will update once it&apos;s confirmed.
            </p>
            <button
              onClick={onClose}
              className="mt-3 px-5 py-2.5 rounded-xl bg-accent text-accent-text text-sm font-bold"
            >
              Done
            </button>
          </motion.div>
        )}

        {/* ── ERROR ───────────────────────────────────────────────── */}
        {stage === "error" && (
          <motion.div
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center gap-3 px-6"
          >
            <AlertCircle className="w-8 h-8 text-error" />
            <p className="text-sm text-error text-center">{errorMsg}</p>
            <button
              onClick={() => setStage("entering")}
              className="mt-2 px-5 py-2.5 rounded-xl bg-surface-card border border-border-medium text-sm font-bold"
            >
              Try again
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
