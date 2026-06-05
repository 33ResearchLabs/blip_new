"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import jsQR from "jsqr";
import { ChevronLeft, Loader2, Check, AlertCircle, ImagePlus, Wallet } from "lucide-react";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { UpiProcessingOverlay } from "@/components/user/UpiProcessingOverlay";
import { FEE_UI_V2 } from "@/lib/featureFlags";

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
    // Hard caps on attacker-controlled free-text from the QR. `pn` is also
    // capped server-side by Zod (upi_payee_name ≤ 100); `tn` is currently
    // not persisted, but if a future change starts showing it we want
    // no risk of a 10kB phishing note slipping through. Clamping at the
    // parse boundary makes downstream surfaces uniformly safe.
    return {
      pa,
      pn: (params.get("pn") || "").slice(0, 100),
      am: params.get("am") || "",
      tn: (params.get("tn") || "").slice(0, 140),
    };
  } catch {
    return null;
  }
}

// Server schema (schemas.ts `upi_vpa`) only accepts this VPA shape. Match it
// exactly so anything we hand off downstream also passes server validation.
const VPA_RE = /^[\w.\-]{2,256}@[\w.\-]{2,64}$/;

// Interpret manually-typed input as a payee — so a UPI ID or phone "behaves
// like a QR". Accepts:
//   • a full upi:// URL          → parsed normally
//   • a bare UPI ID (name@bank)  → used directly as the payee VPA
//   • an Indian mobile number    → passed through as the NPCI handle
//                                  `<phone>@upi` (a valid VPA the fulfilling
//                                  merchant's UPI app resolves on payout)
// The phone path is best-effort pass-through: we can't verify the number here,
// so an unregistered one only fails when the merchant tries to pay it.
// Returns null when the text is none of the above.
function parsePayeeInput(raw: string): ParsedUpi | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("upi://")) return parseUpiUrl(s);
  if (VPA_RE.test(s)) return { pa: s, pn: "", am: "", tn: "" };
  // Indian mobile: 10 digits starting 6-9. Strip a country/trunk prefix only
  // when the length implies one — so a real 10-digit number that happens to
  // begin "91" (e.g. 9123456789) isn't corrupted by an over-eager strip.
  let d = s.replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) return { pa: `${d}@upi`, pn: "", am: "", tn: "" };
  return null;
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
  /** INR amount the scanned QR asserted via `am=` (audit F-3). `null` when
   *  the QR did not specify an amount. Compare against `fiatInr` upstream
   *  to detect user amount overrides. */
  qrAmount: number | null;
}

interface Props {
  onClose: () => void;
  currentRate: number | null;
  /** User's spendable USDT balance. `null` = still loading. */
  usdtBalance: number | null;
  /** Whether the wallet is connected/unlocked. When false the screen shows a
   *  "wallet not connected" gate instead of the camera or the balance spinner.
   *  Without this, a locked/absent embedded wallet reports `usdtBalance = null`
   *  forever, leaving the user stuck on "Checking your balance…". */
  walletReady: boolean;
  /** Label + handler for the connect CTA shown when `walletReady` is false.
   *  The label differs by mode — "Unlock wallet" (locked), "Set up wallet"
   *  (none), "Connect wallet" (external). The handler should open the matching
   *  modal (and typically close this screen first). */
  walletCta: { label: string; onClick: () => void };
  onConfirm: (data: UpiPayConfirm) => void;
}

const UPI_BASE = process.env.NEXT_PUBLIC_UPI_PAY_BASE_URL || "";

export function UpiPayScreen({ onClose, currentRate, usdtBalance, walletReady, walletCta, onConfirm }: Props) {
  // Hard gate: no balance → can't pay. Block before camera even opens so
  // we never produce an on-chain order the escrow flow would reject anyway.
  const balanceReady = usdtBalance !== null;
  const hasBalance = balanceReady && usdtBalance > 0;
  // A locked / absent embedded wallet never reports a balance, so the
  // balance spinner alone would hang forever. Gate the whole scan flow on
  // the wallet being connected first, then on having spendable USDT.
  const canScan = walletReady && hasBalance;

  // PIN gating removed (wallet-password = 6-digit PIN unification): the
  // wallet-unlock prompt downstream (during escrow lock) is the single
  // point of payment authorisation. The QR screen no longer needs a
  // separate /api/user/pin check — that endpoint and the PinSheet stay
  // for any legacy callers but this screen is decoupled from them.
  const [processing, setProcessing] = useState<null | "processing" | "success">(null);
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

  // Manual entry (typed UPI ID / phone / pasted upi:// link). Lenient parser —
  // unlike the camera path it accepts a bare VPA or a phone number too. Changing
  // stage to "entering" tears down the camera via the lifecycle effect below.
  const acceptManual = useCallback((raw: string) => {
    const p = parsePayeeInput(raw);
    if (!p) {
      setErrorMsg("Enter a UPI ID (name@bank) or a 10-digit phone number.");
      return;
    }
    setErrorMsg("");
    setParsed(p);
    setAmount(p.am || "");
    setNote(p.tn || "");
    setStage("entering");
  }, []);

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
    // Wallet not connected or no balance → don't even start the camera. The
    // UI below shows the "connect wallet" / "fund your wallet" state instead.
    if (!canScan) return;
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
  }, [stage, acceptRaw, canScan]);

  // ── Image upload fallback ────────────────────────────────────────────
  // Hardening guards on the upload path (audit F-7). The decode pipeline
  // itself is already robust, but the canvas it allocates is sized from
  // image dimensions — a 20MP user-supplied JPEG would allocate ~80MB
  // client-side and stall low-end phones. We:
  //   1. Allowlist common QR-bearing image MIME types.
  //   2. Reject files > 5MB (a real UPI QR screenshot is < 500KB).
  //   3. Clamp the dimensions handed to decodeQr to ≤ 2000px on the long
  //      edge; the multi-resolution retry inside decodeQr already steps
  //      down further (1024 → 600 → 400), so accuracy is unaffected.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_UPLOAD_EDGE = 2000;
  const ALLOWED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

  const onUploadFile = async (file: File) => {
    setErrorMsg("");
    if (file.type && !ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setErrorMsg("Please upload a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMsg("That image is too big. Please upload one under 5MB.");
      return;
    }
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image_load_failed"));
      });
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = longest > MAX_UPLOAD_EDGE ? MAX_UPLOAD_EDGE / longest : 1;
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const raw = await decodeQr(img, w, h);
      if (!raw) {
        setErrorMsg("Couldn't read a QR from that image.");
        return;
      }
      acceptRaw(raw);
    } finally {
      URL.revokeObjectURL(img.src);
    }
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
    // No separate Payment PIN gate — the wallet unlock prompt (triggered
    // by the downstream escrow flow when the wallet is locked) is the
    // single point of payment authorisation. We just hand off.
    setProcessing("processing");
    doSubmit();
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
    // QR's asserted INR. parsed.am is a string from URLSearchParams; treat
    // anything non-numeric or non-positive as "QR did not specify an amount".
    const qrAmountNum = parsed.am ? Number(parsed.am) : NaN;
    const qrAmount = Number.isFinite(qrAmountNum) && qrAmountNum > 0
      ? qrAmountNum
      : null;
    onConfirm({
      vpa: parsed.pa,
      payeeName: parsed.pn,
      fiatInr: amt,
      cryptoUsdt,
      note,
      qrAmount,
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
      <div className="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={onClose}
          aria-label="Back"
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised border border-border-subtle"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </motion.button>
        <h1 className="text-[17px] font-semibold text-text-primary">
          {stage === "scanning" ? "Scan to Pay" : "Pay via UPI"}
        </h1>
      </div>

      <AnimatePresence mode="wait">
        {/* ── WALLET / BALANCE GATE ────────────────────────────────── */}
        {stage === "scanning" && !canScan && (
          <motion.div
            key="gate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center px-6 gap-4 text-center"
          >
            {!walletReady ? (
              /* Wallet locked / not set up / not connected. Without this the
                 screen hung on the balance spinner forever, because a locked
                 embedded wallet never reports a balance. */
              <>
                <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                  <Wallet className="w-7 h-7 text-white" />
                </div>
                <p className="text-[22px] font-bold tracking-[-0.02em]">Wallet not connected</p>
                <p className="text-[12px] text-text-tertiary max-w-[280px]">
                  Connect your wallet to scan &amp; pay. You&apos;ll also need USDT in it to cover the payment.
                </p>
                <button
                  onClick={walletCta.onClick}
                  className="mt-2 px-5 py-2.5 rounded-xl bg-accent text-accent-text text-sm font-bold"
                >
                  {walletCta.label}
                </button>
              </>
            ) : !balanceReady ? (
              <>
                <Loader2 className="w-7 h-7 animate-spin text-text-tertiary" />
                <p className="text-[12px] tracking-[0.2em] uppercase text-text-tertiary">
                  Checking your balance…
                </p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-white" />
                </div>
                <p className="text-[22px] font-bold tracking-[-0.02em]">No USDT to pay with</p>
                <p className="text-[12px] text-text-tertiary max-w-[280px]">
                  Your wallet has 0 USDT. Top up first, then come back here to scan &amp; pay.
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
        {stage === "scanning" && canScan && (
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
                accept="image/png,image/jpeg,image/webp"
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

            {/* Pay by UPI ID or phone — no QR needed. Also accepts a pasted
                upi:// link. Phone numbers are sent as <phone>@upi. */}
            <div className="mt-4 w-full max-w-[360px]">
              <p className="mb-2 text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary text-center">
                or pay by UPI ID / phone
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualUrl}
                  maxLength={256}
                  onChange={(e) => setManualUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && manualUrl.trim()) acceptManual(manualUrl.trim()); }}
                  placeholder="name@bank or 9876543210"
                  className="flex-1 rounded-xl px-3 py-2 text-[12px] outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
                />
                <button
                  onClick={() => manualUrl.trim() && acceptManual(manualUrl.trim())}
                  className="px-4 py-2 rounded-xl text-[12px] font-bold bg-accent text-accent-text"
                >
                  Pay
                </button>
              </div>
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
                  <>
                    <p className={`mt-2 text-[11px] ${over ? "text-error" : "text-text-tertiary"}`}>
                      ≈ {need.toFixed(4)} USDT @ ₹{currentRate.toFixed(2)}
                      {usdtBalance !== null && (
                        <> · Balance {usdtBalance.toFixed(4)} USDT</>
                      )}
                    </p>
                    {/* Instant-pay trust beat — explains why the wallet
                        briefly debits more than the final settlement.
                        Critical for the QR / scan-to-pay flow per the
                        fee-UI spec. Gated behind FEE_UI_V2 so we can
                        flip back to the bare estimate line if needed. */}
                    {FEE_UI_V2 && !over && (
                      <p className="mt-3 max-w-[280px] text-center text-[10px] leading-relaxed text-text-tertiary">
                        Temporary authorization hold of{" "}
                        <span className="font-semibold text-text-secondary tabular-nums">
                          {need.toFixed(2)} USDT
                        </span>
                        . Unused amount is released back to your wallet
                        instantly after the merchant accepts.
                      </p>
                    )}
                  </>
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
                    ? "Insufficient balance"
                    : `Pay ₹${formattedAmount || "0"}`}
                </motion.button>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The separate PIN sheet that used to sit between Pay tap and
          the escrow handoff was removed. The wallet password is now the
          6-digit PIN itself, so the downstream wallet-unlock prompt
          (during escrow lock) is the single point of payment auth. */}
      <UpiProcessingOverlay
        open={processing !== null}
        stage={processing === "success" ? "success" : "processing"}
      />
    </div>
  );
}
