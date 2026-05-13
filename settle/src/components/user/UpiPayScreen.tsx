"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import jsQR from "jsqr";
import { ChevronLeft, Loader2, Check, AlertCircle, ImagePlus } from "lucide-react";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { PinSheet } from "@/components/user/PinSheet";

// ── UPI URL parsing ────────────────────────────────────────────────────────
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

// ── QR decoder: native BarcodeDetector → jsQR fallback with size tiering ──
// Mirrors the prototype's create.html logic. The multi-size jsQR retry catches
// QRs that fail at the source resolution because of moiré / aliasing.
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

async function decodeQr(
  source: HTMLVideoElement | HTMLImageElement,
  width: number,
  height: number,
): Promise<string | null> {
  // 1. Native BarcodeDetector (Chrome Android, Safari 17+, Edge).
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  if (typeof w.BarcodeDetector === "function") {
    try {
      const det = new w.BarcodeDetector({ formats: ["qr_code"] });
      const codes = await det.detect(source);
      if (codes && codes.length > 0 && codes[0].rawValue) return codes[0].rawValue;
    } catch {
      /* fall through to jsQR */
    }
  }
  // 2. jsQR with multi-resolution retry.
  for (const target of [width, 1024, 600, 400]) {
    const scale = target < width ? target / width : 1;
    const sw = Math.round(width * scale);
    const sh = Math.round(height * scale);
    if (sw < 50 || sh < 50) continue;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) continue;
    ctx.drawImage(source, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh);
    const r = jsQR(data.data, sw, sh, { inversionAttempts: "attemptBoth" });
    if (r && r.data) return r.data;
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────
export interface UpiPayConfirm {
  vpa: string;
  payeeName: string;
  fiatInr: number;
  cryptoUsdt: number;
  note: string;
}

interface Props {
  onClose: () => void;
  currentRate: number | null;
  /** User's spendable USDT balance. `null` = still loading. */
  usdtBalance: number | null;
  onConfirm: (data: UpiPayConfirm) => void;
}

const UPI_BASE = process.env.NEXT_PUBLIC_UPI_PAY_BASE_URL || "";

export function UpiPayScreen({ onClose, currentRate, usdtBalance, onConfirm }: Props) {
  // Hard gate: no balance → can't pay. Block before camera even opens so
  // we never produce an on-chain order the escrow flow would reject anyway.
  const balanceReady = usdtBalance !== null;
  const hasBalance = balanceReady && usdtBalance > 0;

  // PIN gating — required on every Pay action. Three states:
  //   - unknown: still loading whether the user has set a PIN
  //   - need_setup: open PinSheet in setup mode
  //   - need_verify: open PinSheet in verify mode
  // After successful verify, we call doSubmit() which proceeds to the
  // escrow handoff.
  const [pinGate, setPinGate] = useState<"closed" | "verify" | "setup">("closed");
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/user/pin")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setHasPin(!!d?.data?.has_pin); })
      .catch(() => { if (!cancelled) setHasPin(false); });
    return () => { cancelled = true; };
  }, []);
  const [stage, setStage] = useState<"scanning" | "entering">("scanning");
  const [parsed, setParsed] = useState<ParsedUpi | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [manualUrl, setManualUrl] = useState<string>("");
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const acceptRaw = useCallback((raw: string): boolean => {
    const p = parseUpiUrl(raw);
    if (!p) {
      setErrorMsg(`Not a UPI QR. Got: ${raw.slice(0, 60)}${raw.length > 60 ? "…" : ""}`);
      return false;
    }
    setErrorMsg("");
    setParsed(p);
    setAmount(p.am || "");
    setNote(p.tn || "");
    setStage("entering");
    return true;
  }, []);

  // ── Camera lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (stage !== "scanning") return;
    // No balance → don't even start the camera. The UI below shows the
    // "fund your wallet" state in this case.
    if (!hasBalance) return;
    let cancelled = false;

    const stop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg("Camera not available in this browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // playsInline required for iOS; muted required for autoplay
        await video.play().catch(() => { /* user-gesture issues handled below */ });
        setCameraOn(true);

        let busy = false;
        const tick = async () => {
          if (cancelled || !streamRef.current) return;
          const v = videoRef.current;
          if (
            !busy &&
            v &&
            v.readyState === v.HAVE_ENOUGH_DATA &&
            v.videoWidth > 0
          ) {
            busy = true;
            try {
              const raw = await decodeQr(v, v.videoWidth, v.videoHeight);
              if (raw) {
                if (acceptRaw(raw)) {
                  stop();
                  return;
                }
              }
            } catch {
              /* ignore decode errors per-frame */
            }
            busy = false;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/Permission|NotAllowed/i.test(msg)) {
          setErrorMsg("Camera permission denied. Allow in site settings or use the paste / upload fallback below.");
        } else if (/NotFound|Overconstrained/i.test(msg)) {
          setErrorMsg("No back camera found. Use the paste / upload fallback.");
        } else {
          setErrorMsg(`Camera error: ${msg}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [stage, acceptRaw, hasBalance]);

  // ── Image upload fallback ────────────────────────────────────────────
  const onUploadFile = async (file: File) => {
    setErrorMsg("");
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_load_failed"));
    });
    const raw = await decodeQr(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(img.src);
    if (!raw) {
      setErrorMsg("Couldn't read a QR from that image.");
      return;
    }
    acceptRaw(raw);
  };

  // ── Submit confirmed payment ──────────────────────────────────────────
  // Split submit() into the validation step (runs immediately on tap)
  // and doSubmit() which actually fires the escrow handoff after the PIN
  // sheet succeeds.
  const validateBeforeSubmit = (): { amt: number; cryptoUsdt: number } | null => {
    if (!parsed) return null;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrorMsg("Enter a valid amount");
      return null;
    }
    if (!currentRate || currentRate <= 0) {
      setErrorMsg("Live USDT/INR rate unavailable. Wait a moment and retry.");
      return null;
    }
    const cryptoUsdt = Math.ceil((amt / currentRate) * 10000) / 10000;
    if (usdtBalance !== null && cryptoUsdt > usdtBalance) {
      setErrorMsg(`Need ${cryptoUsdt.toFixed(4)} USDT. You have ${usdtBalance.toFixed(4)}.`);
      return null;
    }
    return { amt, cryptoUsdt };
  };

  const handlePayTap = () => {
    const v = validateBeforeSubmit();
    if (!v) return;
    if (hasPin === false) {
      setPinGate("setup");
    } else {
      setPinGate("verify");
    }
  };

  const doSubmit = () => {
    if (!parsed) return;
    const amt = Number(amount);
    // Re-validate just in case state changed while PIN sheet was open.
    const v = validateBeforeSubmit();
    if (!v) return;
    const cryptoUsdt = v.cryptoUsdt;
    if (UPI_BASE) {
      void fetch(`${UPI_BASE}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pa: parsed.pa, pn: parsed.pn, am: amt, tn: note }),
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
          {stage === "scanning" ? "Scan to Pay" : "Pay via UPI"}
        </p>
        <div className="w-[64px]" />
      </div>

      <AnimatePresence mode="wait">
        {/* ── BALANCE GATE ─────────────────────────────────────────── */}
        {stage === "scanning" && !hasBalance && (
          <motion.div
            key="no-balance"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center px-6 gap-4 text-center"
          >
            {!balanceReady ? (
              <>
                <Loader2 className="w-7 h-7 animate-spin text-text-tertiary" />
                <p className="text-[12px] tracking-[0.2em] uppercase text-text-tertiary">
                  Checking your balance…
                </p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-warning/15 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-warning" />
                </div>
                <p className="text-[22px] font-bold tracking-[-0.02em]">No USDT to pay with</p>
                <p className="text-[12px] text-text-tertiary max-w-[280px]">
                  Your wallet has 0 USDT. Top up first, then come back here to scan & pay.
                </p>
                <button
                  onClick={onClose}
                  className="mt-2 px-5 py-2.5 rounded-xl bg-accent text-accent-text text-sm font-bold"
                >
                  Got it
                </button>
              </>
            )}
          </motion.div>
        )}

        {/* ── SCANNING ──────────────────────────────────────────────── */}
        {stage === "scanning" && hasBalance && (
          <motion.div
            key="scan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center px-5 pb-6 overflow-y-auto"
          >
            <div className="mt-1 relative w-full max-w-[360px] aspect-square rounded-3xl overflow-hidden bg-black border border-border-medium shadow-2xl">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  background: "#000",
                }}
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex items-center justify-center text-white/60 text-[12px]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-2/3 h-2/3 border-2 border-white/70 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            </div>

            <p className="mt-4 text-[12px] text-text-tertiary text-center max-w-[300px]">
              Align the merchant&apos;s UPI QR inside the frame
            </p>

            {errorMsg && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] bg-error-dim border border-error-border text-error max-w-[360px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="break-words">{errorMsg}</span>
              </div>
            )}

            {/* Upload image fallback */}
            <div className="mt-4 w-full max-w-[360px]">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadFile(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-surface-card hover:bg-surface-hover border border-border-medium text-text-primary"
              >
                <ImagePlus className="w-4 h-4" />
                Upload QR image
              </button>
            </div>

            {/* Manual paste fallback */}
            <div className="mt-3 w-full max-w-[360px] flex gap-2">
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="paste upi://pay?pa=...&am=..."
                className="flex-1 rounded-xl px-3 py-2 text-[12px] outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary font-mono"
              />
              <button
                onClick={() => manualUrl && acceptRaw(manualUrl.trim())}
                className="px-3 py-2 rounded-xl text-[12px] font-bold bg-surface-card hover:bg-surface-hover border border-border-medium text-text-primary"
              >
                Use
              </button>
            </div>
          </motion.div>
        )}

        {/* ── ENTERING ──────────────────────────────────────────────── */}
        {stage === "entering" && parsed && (
          <motion.div
            key="enter"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex-1 flex flex-col px-5 pb-6 min-h-0"
          >
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
              {amount && currentRate && currentRate > 0 && (() => {
                const need = Number(amount) / currentRate;
                const over = usdtBalance !== null && need > usdtBalance;
                return (
                  <p className={`mt-2 text-[11px] ${over ? "text-error" : "text-text-tertiary"}`}>
                    Locks ≈ {need.toFixed(4)} USDT @ ₹{currentRate.toFixed(2)}
                    {usdtBalance !== null && (
                      <> · Balance {usdtBalance.toFixed(4)} USDT</>
                    )}
                  </p>
                );
              })()}
            </div>

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

            {(() => {
              const amt = Number(amount);
              const need =
                currentRate && currentRate > 0 ? amt / currentRate : Infinity;
              const overBalance =
                usdtBalance !== null && need > usdtBalance;
              const disabled = !amount || amt <= 0 || overBalance;
              return (
                <motion.button
                  whileTap={disabled ? undefined : { scale: 0.98 }}
                  onClick={handlePayTap}
                  disabled={disabled}
                  className={`w-full py-3.5 rounded-xl text-sm font-bold tracking-[-0.01em] transition-colors ${
                    disabled
                      ? "bg-surface-card text-text-tertiary cursor-not-allowed"
                      : "bg-accent text-accent-text"
                  }`}
                >
                  {overBalance
                    ? "Insufficient USDT"
                    : `Lock USDT & Pay ₹${formattedAmount || "0"}`}
                </motion.button>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PIN gate — opens between "Lock USDT & Pay" tap and the escrow handoff. */}
      <PinSheet
        open={pinGate !== "closed"}
        mode={pinGate === "setup" ? "setup" : "verify"}
        subtitle={
          parsed && amount
            ? `Pay ₹${Number(amount).toFixed(2)} to ${parsed.pn || parsed.pa}`
            : undefined
        }
        onClose={() => setPinGate("closed")}
        onSuccess={() => {
          setPinGate("closed");
          // Refresh hasPin so subsequent payments use verify mode.
          setHasPin(true);
          doSubmit();
        }}
      />
    </div>
  );
}
