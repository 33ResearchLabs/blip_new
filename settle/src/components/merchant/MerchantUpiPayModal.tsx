"use client";

/**
 * MerchantUpiPayModal
 * ───────────────────
 * Renders the user's scanned UPI QR for the accepting merchant. The merchant
 * scans this with their own UPI app (GPay / PhonePe / etc), pays the amount
 * to the user's chosen destination, then taps "Done — I've paid" which fires
 * the existing payment_sent action on the order.
 *
 * Closing the modal without paying just hides it — a persistent "Pay via UPI"
 * button on the order card reopens it. Nothing on-chain changes until the
 * merchant taps "Done".
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as QRCode from "qrcode";
import { X, Loader2, Check, AlertCircle, Copy, ExternalLink } from "lucide-react";

interface OrderLite {
  id: string;
  order_number?: string | number;
  upi_vpa?: string | null;
  upi_payee_name?: string | null;
  upi_fiat_inr?: number | string | null;
  fiat_amount?: number | string | null;
  crypto_amount?: number | string | null;
}

interface Props {
  order: OrderLite;
  open: boolean;
  onClose: () => void;
  /** Called when merchant taps "Done — I've paid". Resolves once payment_sent succeeded. */
  onMarkPaid: () => Promise<void>;
}

function buildUpiUrl(vpa: string, payeeName: string, inr: number, orderNumber?: string | number): string {
  const p = new URLSearchParams();
  p.set("pa", vpa);
  if (payeeName) p.set("pn", payeeName);
  p.set("am", inr.toFixed(2));
  p.set("cu", "INR");
  if (orderNumber !== undefined) p.set("tn", `Blip order ${orderNumber}`);
  return `upi://pay?${p.toString()}`;
}

export function MerchantUpiPayModal({ order, open, onClose, onMarkPaid }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const vpa = order.upi_vpa || "";
  const payeeName = order.upi_payee_name || "";
  const inr = Number(order.upi_fiat_inr ?? order.fiat_amount ?? 0);
  const upiUrl = vpa && inr > 0 ? buildUpiUrl(vpa, payeeName, inr, order.order_number) : "";

  useEffect(() => {
    if (!open || !upiUrl) return;
    let cancelled = false;
    QRCode.toDataURL(upiUrl, {
      width: 600,
      // NPCI UPI-QR spec recommends quiet zone ≥ 4 modules + ECC level H
      // (~30%). "M" was ~15%, which fails too often on cracked / glare-
      // affected phone screens. Output is still a standard UPI QR.
      margin: 4,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setError("Failed to render QR."); });
    return () => { cancelled = true; };
  }, [open, upiUrl]);

  const markPaid = async () => {
    setError("");
    setSubmitting(true);
    try {
      await onMarkPaid();
      // Parent closes on success.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark as paid");
      setSubmitting(false);
    }
  };

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(upiUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  if (!vpa) {
    return null;
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[120] bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[121] bg-surface-base text-text-[#f5f5f7] rounded-t-3xl border-t border-border-medium shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="mx-auto max-w-[520px] px-5 py-5 pb-[max(env(safe-area-inset-bottom,16px),16px)]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-text-tertiary">
                  Pay via UPI
                </p>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-hover">
                  <X className="w-4 h-4 text-text-tertiary" />
                </button>
              </div>

              <p className="text-[18px] font-semibold leading-tight">
                Send ₹{inr.toFixed(2)} to {payeeName || vpa}
              </p>
              {payeeName && (
                <p className="text-[12px] text-text-tertiary mt-0.5 truncate">{vpa}</p>
              )}

              {/* QR */}
              <div className="mt-4 flex justify-center">
                <div className="w-full max-w-[280px] aspect-square rounded-2xl bg-white p-3 flex items-center justify-center border border-border-medium">
                  {qrDataUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={qrDataUrl} alt="UPI payment QR" className="w-full h-full" />
                  ) : (
                    <Loader2 className="w-6 h-6 animate-spin text-black/40" />
                  )}
                </div>
              </div>

              {/* Quick actions: copy URL + open in UPI app (works on Android) */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={copyUpi}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold bg-surface-card hover:bg-surface-hover border border-border-medium text-text-[#f5f5f7]"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Copy UPI link"}
                </button>
                <a
                  href={upiUrl}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold bg-surface-card hover:bg-surface-hover border border-border-medium text-text-[#f5f5f7]"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open UPI app
                </a>
              </div>

              <p className="mt-3 text-[11px] text-text-tertiary text-center">
                Scan with your UPI app → pay → return here and tap below.
              </p>

              {error && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] bg-error-dim border border-error-border text-error w-full">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {error}
                </div>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={markPaid}
                disabled={submitting}
                className={`mt-4 w-full py-3.5 rounded-xl text-sm font-bold tracking-[-0.01em] transition-colors ${
                  submitting ? "bg-surface-card text-text-tertiary" : "bg-accent text-accent-text"
                }`}
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Marking…
                  </span>
                ) : (
                  "Done — I've paid"
                )}
              </motion.button>

              <button
                onClick={onClose}
                className="mt-2 w-full py-2.5 rounded-xl text-[12px] font-medium text-text-tertiary hover:text-text-[#f5f5f7]"
              >
                Close — I'll do this later
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
