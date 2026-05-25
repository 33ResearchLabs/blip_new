'use client';

// Colored risk-label badge. Renders the label as a chip with a colour mapped
// from the label, plus an optional score tooltip and confidence dot. Used in
// admin/waitlist list rows and inside the detail modal header.

import type { RiskLabel, Confidence } from '@/lib/threat/types';
import { formatCount } from '@/lib/format';

const LABEL_CLASSES: Record<RiskLabel, string> = {
  TRUSTED:   'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  CLEAN:     'bg-green-500/10 text-green-300 border-green-500/30',
  NEUTRAL:   'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
  SUSPECT:   'bg-amber-500/10 text-amber-300 border-amber-500/30',
  HIGH_RISK: 'bg-red-500/10 text-red-300 border-red-500/30',
  CRITICAL:  'bg-red-600/20 text-red-200 border-red-500/40 animate-pulse',
};

const CONFIDENCE_DOT: Record<Confidence, string> = {
  high:   'bg-emerald-400',
  medium: 'bg-amber-400',
  low:    'bg-zinc-500',
};

export function RiskBadge({
  label,
  score,
  confidence,
  size = 'sm',
}: {
  label: RiskLabel | null | undefined;
  score?: number | null;
  confidence?: Confidence | null;
  size?: 'xs' | 'sm' | 'md';
}) {
  if (!label) {
    return <span className="text-xs text-zinc-600">—</span>;
  }
  const cls = LABEL_CLASSES[label];
  const sizeCls = size === 'xs'
    ? 'text-[10px] px-1.5 py-0.5'
    : size === 'md'
      ? 'text-xs px-2.5 py-1'
      : 'text-[11px] px-2 py-0.5';
  const title = score !== null && score !== undefined
    ? `Risk score: ${formatCount(score)}/100${confidence ? ` (${confidence} confidence)` : ''}`
    : undefined;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider border rounded ${cls} ${sizeCls}`}
    >
      {confidence ? (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOT[confidence]}`}
          aria-label={`${confidence} confidence`}
        />
      ) : null}
      {label.replace('_', ' ')}
    </span>
  );
}
