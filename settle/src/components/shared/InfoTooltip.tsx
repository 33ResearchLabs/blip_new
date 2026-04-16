'use client';

/**
 * Info tooltip with a small (i) icon.
 *
 * Supports two modes:
 *  1. Plain text: <InfoTooltip text="..." />
 *  2. Structured: <InfoTooltip title="..." description="..." items={[{label, value}]} />
 *
 * The popup renders via a React portal to document.body with JS-computed
 * fixed coordinates. This is critical inside order cards — the card wrapper
 * uses `overflow-hidden` for rounded corners + hover shimmer, which would
 * otherwise clip an absolutely-positioned tooltip.
 *
 * Shows tooltip on hover (desktop) and tap (mobile).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface InfoTooltipItem {
  label: string;
  value: string;
}

interface InfoTooltipProps {
  /** Plain text — use for short, single-paragraph tooltips */
  text?: string;
  /** Structured: title at top */
  title?: string;
  /** Short description below title */
  description?: string;
  /** Key/value rows under the description (e.g. "Fast → quick match, less profit") */
  items?: InfoTooltipItem[];
  /** Position relative to the icon. Default: "top" */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Icon size. Default: "xs" (12px) */
  size?: 'xs' | 'sm' | 'md';
  /** Custom className for the wrapper */
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
};

const TOOLTIP_WIDTH = 240;
const GAP = 6;

export function InfoTooltip({
  text,
  title,
  description,
  items,
  side = 'top',
  size = 'xs',
  className = '',
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Compute fixed-viewport coordinates so the portal popup sits next to
  // the trigger icon regardless of scroll/overflow ancestors.
  const reposition = useCallback(() => {
    const trigger = wrapperRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    // Measure popup once it renders so we can keep it on-screen; before
    // first paint fall back to TOOLTIP_WIDTH for width and a reasonable
    // initial height (the second pass after render will correct it).
    const popupH = popupRef.current?.offsetHeight ?? 80;
    const popupW = popupRef.current?.offsetWidth ?? TOOLTIP_WIDTH;

    let top = 0;
    let left = 0;
    switch (side) {
      case 'bottom':
        top = r.bottom + GAP;
        left = r.left;
        break;
      case 'left':
        top = r.top + r.height / 2 - popupH / 2;
        left = r.left - popupW - GAP;
        break;
      case 'right':
        top = r.top + r.height / 2 - popupH / 2;
        left = r.right + GAP;
        break;
      case 'top':
      default:
        top = r.top - popupH - GAP;
        left = r.left;
        break;
    }

    // Clamp within viewport with an 8px safety margin.
    const margin = 8;
    left = Math.max(margin, Math.min(left, window.innerWidth - popupW - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - popupH - margin));

    setCoords({ top, left });
  }, [side]);

  // Position on open + on resize/scroll while open so it stays glued to the icon.
  useEffect(() => {
    if (!open) return;
    reposition();
    // Second pass once the popup is in the DOM so we know its real height.
    const raf = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  // Close on outside click (mobile tap-away). Check both the trigger and
  // the portaled popup since they live in different DOM subtrees.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const hasStructured = !!(title || description || (items && items.length > 0));

  const popup =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            <motion.div
              ref={popupRef}
              initial={{ opacity: 0, y: side === 'top' ? 4 : side === 'bottom' ? -4 : 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'fixed',
                top: coords.top,
                left: coords.left,
                width: TOOLTIP_WIDTH,
                zIndex: 10000,
                pointerEvents: 'auto',
              }}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
            >
              {hasStructured ? (
                <div className="rounded-xl bg-foreground text-background shadow-xl shadow-black/40 overflow-hidden">
                  {title && (
                    <div className="px-3 pt-2.5 pb-1 text-[12px] font-bold leading-tight">
                      {title}
                    </div>
                  )}
                  {description && (
                    <div className="px-3 pb-2 text-[10.5px] text-background/70 leading-snug">
                      {description}
                    </div>
                  )}
                  {(title || description) && items && items.length > 0 && (
                    <div className="h-px bg-background/10 mx-3" />
                  )}
                  {items && items.length > 0 && (
                    <div className="px-3 py-2 space-y-1.5">
                      {items.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10.5px] leading-snug">
                          <span className="font-bold min-w-[52px] shrink-0">{item.label}</span>
                          <span className="text-background/70">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg bg-foreground text-background text-[11px] font-medium px-2.5 py-2 leading-snug shadow-xl shadow-black/40">
                  {text}
                </div>
              )}
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-foreground/30 hover:text-foreground/60 transition-colors p-0.5 -m-0.5 rounded-full"
        aria-label="More info"
      >
        <Info className={SIZE_MAP[size]} />
      </button>
      {popup}
    </span>
  );
}
