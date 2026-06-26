"use client";

/**
 * SummaryTile
 * ───────────
 * The compact "You pay / You get / Method" recap tile, shared across every
 * Active Order state's Payment Summary section so the recap is identical
 * everywhere. Pure presentation.
 */

const CARD = "bg-surface-card border border-border-subtle";

export interface SummaryTileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

export function SummaryTile({ icon, label, value, sub }: SummaryTileProps) {
  return (
    <div className={`rounded-xl p-2.5 text-center ${CARD}`}>
      <div className="flex items-center justify-center text-text-tertiary mb-1">{icon}</div>
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-text-tertiary leading-tight">{sub}</p>}
    </div>
  );
}
