'use client';

/**
 * Info tooltip with a small (i) icon.
 *
 * Supports two modes:
 *  1. Plain text: <InfoTooltip text="..." />
 *  2. Structured: <InfoTooltip title="..." description="..." items={[{label, value}]} />
 *
 * Shows tooltip on hover (desktop) and tap (mobile).
 */

import { useState, useRef, useEffect } from 'react';
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

const POSITION_MAP = {
  top: 'bottom-full left-0 mb-1.5',
  bottom: 'top-full left-0 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

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
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click (mobile tap-away)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const hasStructured = !!(title || description || (items && items.length > 0));

  return (
    <span
      ref={ref}
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

      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: side === 'top' ? 4 : side === 'bottom' ? -4 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className={`absolute z-[100] ${POSITION_MAP[side]} w-[240px]`}
          >
            {hasStructured ? (
              <span className="block rounded-xl bg-foreground text-background shadow-xl shadow-black/40 overflow-hidden">
                {/* Title row */}
                {title && (
                  <span className="block px-3 pt-2.5 pb-1 text-[12px] font-bold leading-tight">
                    {title}
                  </span>
                )}
                {/* Description */}
                {description && (
                  <span className="block px-3 pb-2 text-[10.5px] text-background/70 leading-snug">
                    {description}
                  </span>
                )}
                {/* Divider */}
                {(title || description) && items && items.length > 0 && (
                  <span className="block h-px bg-background/10 mx-3" />
                )}
                {/* Items list */}
                {items && items.length > 0 && (
                  <span className="block px-3 py-2 space-y-1.5">
                    {items.map((item, i) => (
                      <span key={i} className="flex items-start gap-2 text-[10.5px] leading-snug">
                        <span className="font-bold min-w-[52px] shrink-0">{item.label}</span>
                        <span className="text-background/70">{item.value}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            ) : (
              <span className="block rounded-lg bg-foreground text-background text-[11px] font-medium px-2.5 py-2 leading-snug shadow-xl shadow-black/40">
                {text}
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
