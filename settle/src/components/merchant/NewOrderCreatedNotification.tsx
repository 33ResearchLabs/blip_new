"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────
   New Order Created — notification modal

   A premium, theme-aware notification surface for the merchant screen.
   Built to fit the Blip design system:
     - Uses the CSS-variable-backed Tailwind tokens (bg-card-solid,
       text-foreground, border-section-divider, border-border …) so it
       tracks the active theme automatically — Light, Dark, Clean, Mono —
       without a single `dark:` utility (that variant is scoped to the
       /waitlist subtree in globals.css).
     - Monochrome inline SVG icons only (currentColor → theme-aware gray).
       No external UI / icon libraries, no colored icon backgrounds.
     - Pure Tailwind + CSS transitions for the enter / exit animation.

   Fully self-contained and reusable: feed it an `order` object and the
   close handler. All copy is overridable via props.
   ──────────────────────────────────────────────────────────────────────── */

export interface NewOrderDetails {
  /** Human-facing order reference, e.g. "BM-260627-B669". */
  orderId: string;
  /** Buyer handle / username. */
  buyer: string;
  /** Crypto amount, pre-formatted with unit, e.g. "2 USDT". */
  amount: string;
  /** Optional fiat approximation shown beside the amount, e.g. "≈ ₹168.32 INR". */
  amountFiat?: string;
  /** Pre-formatted order time, e.g. "Jun 27, 2026 10:24 AM". */
  orderTime: string;
  /** Payment rail label, e.g. "UPI". */
  paymentMethod: string;
}

export interface NewOrderCreatedNotificationProps {
  order: NewOrderDetails;
  /** Controls mount/visibility. Defaults to true for standalone use. */
  open?: boolean;
  /** Close (X) handler — also fired on overlay click and Escape. */
  onClose?: () => void;
  /** Small status pill text above the title. */
  statusLabel?: string;
  /** Timestamp under the title, e.g. "Today, 10:24 AM". */
  timestamp?: string;
  /** Optional: open the buyer profile when the Buyer row is tapped. */
  onViewBuyer?: () => void;
  /** Optional: handle the escrow info row tap. */
  onInfoClick?: () => void;
}

/* ── Inline monochrome icons (stroke = currentColor) ─────────────────────
   Kept tiny and consistent: 1.6 stroke, round caps, 24-box viewBox. */

type IconProps = { className?: string };

const IconClose = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const IconHash = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </svg>
);

const IconCopy = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

const IconCheck = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="m20 6-11 11-5-5" />
  </svg>
);

const IconUser = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconCoin = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M9.5 9.5h3.25a1.75 1.75 0 0 1 0 3.5H9.5h3.5a1.75 1.75 0 0 1 0 3.5H9.5" />
  </svg>
);

const IconClock = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IconCard = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 10h18" />
  </svg>
);

const IconChevron = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

const IconInfo = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

/* ── Detail row ───────────────────────────────────────────────────────────
   One line of the details card: monochrome icon chip + label on the left,
   value (and an optional trailing action) on the right. */

interface DetailRowProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  /** Renders the whole row as a button + chevron when provided. */
  onClick?: () => void;
  /** Removes the bottom divider for the last row. */
  last?: boolean;
}

function DetailRow({ icon, label, children, onClick, last }: DetailRowProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={[
        "group/row flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors sm:px-4",
        onClick ? "hover:bg-foreground/[0.035] focus:bg-foreground/[0.035] focus:outline-none" : "",
        last ? "" : "border-b border-section-divider",
      ].join(" ")}
    >
      {/* Monochrome icon chip — neutral surface, theme-aware gray glyph */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-foreground/[0.03] text-foreground/55 transition-colors group-hover/row:text-foreground/80">
        {icon}
      </span>

      <span className="shrink-0 text-[13px] font-medium text-foreground/55 sm:text-sm">
        {label}
      </span>

      <span className="ml-auto flex min-w-0 items-center justify-end gap-2 text-right">
        {children}
        {onClick && (
          <IconChevron className="h-4 w-4 shrink-0 text-foreground/30 transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground/55" />
        )}
      </span>
    </Tag>
  );
}

export function NewOrderCreatedNotification({
  order,
  open = true,
  onClose,
  statusLabel = "Just now",
  timestamp = "Today, 10:24 AM",
  onViewBuyer,
  onInfoClick,
}: NewOrderCreatedNotificationProps) {
  // Drives the enter/exit transition. `mounted` flips on the frame after
  // `open` so the CSS transition has a from-state to animate out of.
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setMounted(false);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Escape closes; lock background scroll while the modal is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const copyOrderId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(order.orderId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  }, [order.orderId]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New order created notification"
      onClick={onClose}
      className={[
        "fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4",
        "bg-black/60 backdrop-blur-sm transition-opacity duration-300",
        mounted ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          "relative w-full max-w-md overflow-hidden rounded-3xl",
          "border border-border-strong bg-card-solid",
          "shadow-2xl shadow-black/40",
          "transition-all duration-300 ease-out",
          mounted
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-4 scale-[0.98] opacity-0",
        ].join(" ")}
      >
        {/* Hairline top sheen for a premium edge in both themes */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent" />

        <div className="max-h-[88vh] overflow-y-auto px-5 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6">
          {/* ── Header: close button only ─────────────────────────────── */}
          <div className="flex items-start justify-end">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notification"
              className="-mr-1.5 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
            >
              <IconClose className="h-5 w-5" />
            </button>
          </div>

          {/* ── Status + title + timestamp ────────────────────────────── */}
          <div className="-mt-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground/70" />
              </span>
              <span className="text-[12px] font-medium tracking-wide text-foreground/55">
                {statusLabel}
              </span>
            </div>

            <h2 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">
              New Order Created
            </h2>
            <p className="mt-1.5 text-[13px] text-foreground/40">{timestamp}</p>
          </div>

          {/* ── Divider + section label ───────────────────────────────── */}
          <div className="mt-5 border-t border-section-divider pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/40">
              Details
            </p>
            <p className="mt-2 text-[13.5px] text-foreground/65">
              You have received a new order.
            </p>
          </div>

          {/* ── Details card ──────────────────────────────────────────── */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-foreground/[0.015]">
            <DetailRow icon={<IconHash className="h-[18px] w-[18px]" />} label="Order ID">
              <span className="truncate font-mono text-[13px] font-medium tabular-nums text-foreground sm:text-sm">
                {order.orderId}
              </span>
              <button
                type="button"
                onClick={copyOrderId}
                aria-label={copied ? "Order ID copied" : "Copy order ID"}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground/40 transition-colors hover:bg-foreground/[0.07] hover:text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
              >
                {copied ? (
                  <IconCheck className="h-4 w-4 text-foreground/80" />
                ) : (
                  <IconCopy className="h-4 w-4" />
                )}
              </button>
            </DetailRow>

            <DetailRow
              icon={<IconUser className="h-[18px] w-[18px]" />}
              label="Buyer"
              onClick={onViewBuyer}
            >
              <span className="truncate text-[13px] font-medium text-foreground sm:text-sm">
                {order.buyer}
              </span>
            </DetailRow>

            <DetailRow icon={<IconCoin className="h-[18px] w-[18px]" />} label="Amount">
              <span className="text-[13px] font-semibold text-foreground sm:text-sm">
                {order.amount}
              </span>
              {order.amountFiat && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/40">
                  {order.amountFiat}
                </span>
              )}
            </DetailRow>

            <DetailRow icon={<IconClock className="h-[18px] w-[18px]" />} label="Order Time">
              <span className="truncate text-[13px] font-medium text-foreground/85 sm:text-sm">
                {order.orderTime}
              </span>
            </DetailRow>

            <DetailRow
              icon={<IconCard className="h-[18px] w-[18px]" />}
              label="Payment Method"
              last
            >
              <span className="text-[13px] font-medium text-foreground sm:text-sm">
                {order.paymentMethod}
              </span>
            </DetailRow>
          </div>

          {/* ── Info card (escrow note) ───────────────────────────────── */}
          <button
            type="button"
            onClick={onInfoClick}
            className="group/info mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-foreground/[0.015] px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-foreground/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 sm:px-4"
          >
            <IconInfo className="h-[18px] w-[18px] shrink-0 text-foreground/45 transition-colors group-hover/info:text-foreground/70" />
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground/60 sm:text-[13px]">
              The order will be locked in escrow after you accept.
            </span>
            <IconChevron className="h-4 w-4 shrink-0 text-foreground/30 transition-transform group-hover/info:translate-x-0.5 group-hover/info:text-foreground/55" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewOrderCreatedNotification;
