"use client";

/**
 * PayWithSheet
 * ────────────
 * Payment-method picker for the BUY flow. The buyer multi-selects the rails
 * they can pay with; on Confirm we collapse the chosen methods to the backend's
 * three buckets (`bank` / `upi` / `cash`) and hand them back as
 * `buyer_payment_types`. Rich labels are display-only — no backend change.
 *
 * Reused across surfaces via two props:
 *   • mode  — "sheet" (slides up from the bottom; user app + merchant mobile)
 *             or "center" (centered dialog; merchant desktop).
 *   • theme — "user" (.user-scope tokens) or "merchant" (global foreground /
 *             card-solid tokens).
 *
 * Portaled so the fixed overlay resolves against the viewport, not a
 * transformed ancestor. User theme → #user-scope-root (where its scoped CSS
 * vars live); merchant theme → document.body (its vars are global on :root).
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Info, Check, Zap, X } from "lucide-react";

type Category = "bank" | "upi" | "cash";
type Mode = "sheet" | "center";
type Theme = "user" | "merchant";

interface Method {
  key: string;
  label: string;
  cat: Category;
  /** Decorative "fast" marker, mirrors the screenshot's lightning chips. */
  fast?: boolean;
}

// Rich method list (display-only). Each maps to one of the 3 backend buckets.
const METHODS: Method[] = [
  { key: "upi", label: "UPI", cat: "upi" },
  { key: "lightning_upi", label: "Lightning UPI", cat: "upi", fast: true },
  { key: "gpay", label: "Google Pay (GPay)", cat: "upi" },
  { key: "phonepe", label: "PhonePe", cat: "upi" },
  { key: "paytm", label: "Paytm", cat: "upi" },
  { key: "express_upi", label: "Express UPI", cat: "upi" },
  // { key: "upi_pan", label: "UPI-PAN", cat: "upi" },
  { key: "imps", label: "IMPS", cat: "bank" },
  // { key: "imps_pan", label: "IMPS - PAN", cat: "bank" },
  { key: "bank_transfer", label: "Bank Transfer", cat: "bank" },
  // { key: "bank_transfer_in", label: "Bank Transfer (India)", cat: "bank" },
  // { key: "cih_bank", label: "CIH Bank", cat: "bank" },
  { key: "intl_wire", label: "International Wire (SWIFT)", cat: "bank" },
  { key: "digital_erupee", label: "Digital eRupee", cat: "bank" },
  // { key: "skrill", label: "Skrill (Moneybookers)", cat: "bank" },
  { key: "cash", label: "Cash", cat: "cash" },
];

// const ALL_KEYS = METHODS.map((m) => m.key);

// Token classes per theme so the same markup renders in either app scope.
const TONE: Record<Theme, Record<string, string>> = {
  user: {
    bg: "bg-surface-base",
    border: "border-border-subtle",
    grip: "bg-border-medium",
    title: "text-text-primary",
    sub: "text-text-secondary",
    muted: "text-text-tertiary",
    chip: "bg-surface-active",
    tile: "bg-surface-card border-border-subtle text-text-secondary",
    tileOn: "bg-surface-active border-text-primary text-text-primary",
    accent: "bg-accent text-accent-text",
    hover: "hover:bg-surface-hover",
  },
  merchant: {
    bg: "bg-card-solid",
    border: "border-foreground/[0.08]",
    grip: "bg-foreground/20",
    title: "text-foreground",
    sub: "text-foreground/70",
    muted: "text-foreground/40",
    chip: "bg-foreground/[0.06]",
    tile: "bg-foreground/[0.03] border-foreground/[0.08] text-foreground/70",
    tileOn: "bg-foreground/[0.10] border-foreground/40 text-foreground",
    accent: "bg-[#f5f5f7] text-[#0b0b0c]",
    hover: "hover:bg-foreground/[0.06]",
  },
};

export interface PayWithSheetProps {
  open: boolean;
  onClose: () => void;
  /** Confirm hands back the distinct backend buckets of the chosen methods. */
  onConfirm: (categories: Category[]) => void;
  /** Width cap so the surface matches the centered column. */
  maxW?: string;
  /** Optional label for the confirm button, e.g. "Buy 10 USDT". */
  confirmLabel?: string;
  /** "sheet" = bottom sheet (default); "center" = centered dialog. */
  mode?: Mode;
  /** Theme token set + portal host. */
  theme?: Theme;
}

export function PayWithSheet({
  open,
  onClose,
  onConfirm,
  maxW = "max-w-[440px]",
  confirmLabel = "Confirm",
  mode = "sheet",
  theme = "user",
}: PayWithSheetProps) {
  // Start with nothing selected — the buyer must explicitly pick the rails
  // they can pay with (Confirm stays disabled until at least one is chosen).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const t = TONE[theme];

  // const allOn = selected.size === METHODS.length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return METHODS;
    return METHODS.filter((m) => m.label.toLowerCase().includes(q));
  }, [query]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // const toggleAll = () => setSelected(allOn ? new Set() : new Set(ALL_KEYS));

  const reset = () => {
    setSelected(new Set());
    setQuery("");
  };

  const confirm = () => {
    // Emit categories in the order the buyer tapped them (selected is a Set,
    // which preserves insertion order) — not the fixed METHODS list order. The
    // first rail the buyer picks becomes buyer_payment_types[0], which the
    // merchant shows as the "Preferred Method". Dedupe keeps first occurrence.
    const catByKey = new Map(METHODS.map((m) => [m.key, m.cat]));
    const cats = Array.from(
      new Set(
        Array.from(selected)
          .map((key) => catByKey.get(key))
          .filter((c): c is Category => c !== undefined),
      ),
    );
    onConfirm(cats);
  };

  if (typeof document === "undefined") return null;
  const host =
    theme === "user"
      ? document.getElementById("user-scope-root") ?? document.body
      : document.body;

  const isCenter = mode === "center";

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={isCenter ? { opacity: 0, scale: 0.97, y: 8 } : { y: "100%" }}
            animate={isCenter ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={isCenter ? { opacity: 0, scale: 0.97, y: 8 } : { y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320, mass: 0.8 }}
            className={
              isCenter
                ? `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[151] w-[calc(100%-2rem)] ${maxW} max-h-[85dvh] rounded-3xl flex flex-col border ${t.border} ${t.bg}`
                : `fixed bottom-0 left-1/2 -translate-x-1/2 z-[151] w-full ${maxW} max-h-[85dvh] rounded-t-3xl flex flex-col border-t ${t.border} ${t.bg}`
            }
          >
            {/* Grip (sheet only) + header */}
            <div className="pt-2.5 px-5 shrink-0">
              {!isCenter && (
                <div className={`mx-auto w-10 h-1 rounded-full mb-3 ${t.grip}`} />
              )}
              <div className={`flex items-center justify-between ${isCenter ? "pt-1" : ""}`}>
                <h2 className={`text-[18px] font-bold flex items-center gap-1.5 ${t.title}`}>
                  Pay With
                  <Info className={`w-4 h-4 ${t.muted}`} />
                </h2>
                <button
                  onClick={onClose}
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${t.muted} ${t.hover}`}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 ${t.chip}`}>
                <Zap className={`w-4 h-4 ${t.muted} shrink-0 mt-0.5`} />
                <p className={`text-[12px] leading-snug ${t.sub}`}>
                  Release the crypto automatically upon payment completion.
                </p>
              </div>
              {/* Search */}
              <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 ${t.chip}`}>
                <Search className={`w-4 h-4 shrink-0 ${t.muted}`} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  maxLength={40}
                  className={`flex-1 bg-transparent outline-none text-[14px] ${t.title} placeholder:${t.muted}`}
                />
              </div>
            </div>

            {/* Method grid */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-3">
              <div className="grid grid-cols-2 gap-2.5">
                {/* {!query.trim() && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className={`relative h-12 rounded-xl border text-[13px] font-semibold transition-colors ${
                      allOn ? t.tileOn : t.tile
                    }`}
                  >
                    All
                  </button>
                )} */}
                {visible.map((m) => {
                  const on = selected.has(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggle(m.key)}
                      className={`relative h-12 px-3 rounded-xl border text-[13px] font-medium text-center transition-colors ${
                        on ? t.tileOn : t.tile
                      }`}
                    >
                      <span className="block truncate">{m.label}</span>
                      {m.fast && (
                        <Zap className={`absolute top-1.5 right-1.5 w-3 h-3 ${t.muted} fill-current`} />
                      )}
                      {on && (
                        <span className="absolute top-1.5 left-1.5 w-3.5 h-3.5 rounded-full bg-text-primary flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-background" strokeWidth={3.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
                {visible.length === 0 && (
                  <p className={`col-span-2 text-center text-[13px] py-6 ${t.muted}`}>
                    No methods match “{query}”.
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className={`shrink-0 px-5 pt-2 flex gap-3 border-t ${t.border} ${
              isCenter ? "pb-4" : "pb-[max(env(safe-area-inset-bottom),1rem)]"
            }`}>
              <button
                onClick={reset}
                className={`flex-1 h-12 rounded-xl text-[15px] font-semibold ${t.chip} ${t.title}`}
              >
                Reset
              </button>
              <button
                onClick={confirm}
                disabled={selected.size === 0}
                className={`flex-[1.4] h-12 rounded-xl text-[15px] font-bold disabled:opacity-40 ${t.accent}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    host,
  );
}
