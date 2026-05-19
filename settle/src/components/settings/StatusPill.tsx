'use client';

export type StatusTone = 'on' | 'off' | 'muted' | 'warn' | 'error';

interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  /** Show a small leading dot indicator. Defaults to true for tone="on"
   *  (matches the existing SecurityRow's StatusBadge pattern). */
  dot?: boolean;
}

const TONE_CLS: Record<StatusTone, string> = {
  on:    'text-emerald-300/95 bg-emerald-400/[0.08] border-emerald-400/15',
  off:   'text-white/55 bg-white/[0.04] border-white/[0.06]',
  muted: 'text-white/45 bg-white/[0.03] border-white/[0.05]',
  warn:  'text-amber-300/95 bg-amber-400/[0.10] border-amber-400/20',
  error: 'text-red-300/95 bg-red-500/[0.10] border-red-500/20',
};

const DOT_CLS: Record<StatusTone, string> = {
  on:    'bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.7)]',
  off:   'bg-white/40',
  muted: 'bg-white/30',
  warn:  'bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.7)]',
  error: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]',
};

/**
 * Right-aligned status pill used inside SettingsRow trailing slots.
 * Mirrors the StatusBadge component embedded in AppLockSettingsCard so
 * profile sections read with one visual language.
 */
export function StatusPill({ label, tone = 'off', dot }: StatusPillProps) {
  const showDot = dot ?? tone === 'on';
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[10px] font-semibold tracking-[0.04em] border ${TONE_CLS[tone]}`}
    >
      {showDot && <span className={`w-1 h-1 rounded-full ${DOT_CLS[tone]}`} />}
      {label}
    </span>
  );
}
