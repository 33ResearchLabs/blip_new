'use client';

// Shared shell for the waitlist quest modals (Tweet, Telegram Join,
// X Follow). Replaces the old dark + ALL-CAPS + rounded-sm treatment
// with the cream + copper editorial system used across /waitlist/* and
// the transactional email templates.
//
// Layout:
//   - Soft cream backdrop with blur (#FAF8F5 / 92% opacity)
//   - White card, rounded-[24px], hairline border, layered shadow
//   - Header strip: copper accent icon bubble + eyebrow + title +
//     reward chip; close button top-right
//   - Body slot (whatever step UI the modal renders)
//
// Primitives exported below (QuestPrimaryCta, QuestSecondaryCta,
// QuestNoticePill, QuestSectionCard) keep the inner step UIs
// consistent without each modal hand-rolling its own Tailwind.

import { ReactNode } from 'react';
import { X } from 'lucide-react';

const ACCENT = '#cc785c';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Lucide icon (already rendered as JSX), shown in the copper bubble. */
  icon: ReactNode;
  eyebrow: string;
  title: string;
  rewardPoints: number;
  children: ReactNode;
}

export default function QuestModalShell({
  isOpen,
  onClose,
  icon,
  eyebrow,
  title,
  rewardPoints,
  children,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop — light cream tint + blur so it reads as the same
          surface family as the rest of /waitlist instead of the harsh
          black/90 the old modals used. */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(250,248,245,0.92)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-lg bg-white rounded-[24px] overflow-hidden border border-black/[0.06]"
        style={{ boxShadow: '0 24px 60px -24px rgba(0,0,0,0.25)' }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-black/[0.04] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header strip */}
        <div className="px-7 pt-7 pb-5">
          <div className="flex items-start gap-4">
            <div
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
              style={{ background: ACCENT }}
            >
              {icon}
            </div>
            <div className="min-w-0 pt-0.5">
              <p
                className="text-[10px] font-bold tracking-[0.3em] uppercase mb-1.5"
                style={{ color: ACCENT }}
              >
                {eyebrow}
              </p>
              <h3
                className="font-display text-[20px] leading-[1.1] tracking-[-0.02em] font-semibold text-[#1d1d1f]"
              >
                {title}
              </h3>
              <p className="mt-1.5 text-[11.5px] text-[#6e6e73]">
                Reward:{' '}
                <span className="font-semibold text-[#1d1d1f]">
                  {rewardPoints.toLocaleString('en-US')} pts
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 pb-7">{children}</div>
      </div>
    </div>
  );
}

// ── Primitives ─────────────────────────────────────────────────────

export function QuestPrimaryCta({
  onClick,
  href,
  disabled,
  children,
}: {
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const className =
    'w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-[14.5px] font-semibold tracking-[-0.005em] text-white transition-transform hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0 disabled:cursor-not-allowed';
  const style: React.CSSProperties = {
    background: '#0a0a0a',
    boxShadow: '0 8px 22px -10px rgba(10,10,10,0.45)',
  };
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className} style={style}>
      {children}
    </button>
  );
}

export function QuestSecondaryCta({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-[14px] font-semibold tracking-[-0.005em] text-[#1d1d1f] bg-white border border-black/[0.08] transition-colors hover:bg-black/[0.03] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function QuestNoticePill({
  tone = 'info',
  icon,
  title,
  body,
}: {
  tone?: 'info' | 'error' | 'success';
  icon?: ReactNode;
  title?: string;
  body: ReactNode;
}) {
  const palette = {
    info: {
      bg: 'linear-gradient(135deg, rgba(204,120,92,0.10) 0%, rgba(204,120,92,0.03) 100%)',
      border: 'rgba(204,120,92,0.22)',
      icon: ACCENT,
    },
    error: {
      bg: 'rgba(220,38,38,0.06)',
      border: 'rgba(220,38,38,0.20)',
      icon: '#dc2626',
    },
    success: {
      bg: 'rgba(16,185,129,0.08)',
      border: 'rgba(16,185,129,0.22)',
      icon: '#059669',
    },
  }[tone];

  return (
    <div
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{ background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      {icon && (
        <div className="shrink-0 mt-0.5" style={{ color: palette.icon }}>
          {icon}
        </div>
      )}
      <div className="min-w-0 text-left">
        {title && (
          <div className="text-[13px] font-bold tracking-[-0.005em] text-[#1d1d1f] mb-0.5">
            {title}
          </div>
        )}
        <div className="text-[12px] text-[#3a3a3c] leading-[1.55]">{body}</div>
      </div>
    </div>
  );
}

export function QuestSectionCard({
  eyebrow,
  action,
  children,
}: {
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-[#FAF8F5] border border-black/[0.05] p-5">
      {(eyebrow || action) && (
        <div className="flex items-center justify-between mb-3">
          {eyebrow && (
            <p className="text-[10px] font-bold tracking-[0.22em] uppercase text-[#8a8a8e]">
              {eyebrow}
            </p>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
