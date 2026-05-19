'use client';

import type { ReactNode } from 'react';

interface SettingsGroupProps {
  /** All-caps section label rendered above the card. Use a short noun
   *  ("Activity", "Preferences", "Support"). */
  label: string;
  /** Small icon shown next to the label. Optional. */
  icon?: ReactNode;
  /** Right-aligned chip in the section header (e.g. a status, a "Protected"
   *  pill). Optional. */
  trailing?: ReactNode;
  /** SettingsRow children. Render them in order; the group inserts the
   *  hairline divider between siblings automatically. */
  children: ReactNode;
}

/**
 * Section wrapper used across the Profile screen. Renders a single
 * rounded card containing all child rows, separated by 1px hairlines.
 * Matches the premium fintech grouping pattern (iOS Settings / Revolut /
 * Mercury) — one outer edge per group instead of N stacked cards.
 *
 * Visual tokens kept inline because the existing surface tokens
 * (bg-surface-card, border-border-subtle) are too heavy for the
 * grouped-rows look; this uses subtler white/[0.02] alpha layering so
 * the divider lines read but the card edges don't fight the content.
 */
export function SettingsGroup({ label, icon, trailing, children }: SettingsGroupProps) {
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-white/40">{icon}</span>}
          <span className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase">
            {label}
          </span>
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      <div
        className="rounded-[20px] overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,rgba(255,255,255,0.015)_100%)] border border-white/[0.07] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] divide-y divide-white/[0.05]"
      >
        {children}
      </div>
    </section>
  );
}
