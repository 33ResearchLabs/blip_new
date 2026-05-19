'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface SettingsRowProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** Right-aligned content before the chevron — pills, counts, theme name,
   *  short value previews. */
  trailing?: ReactNode;
  /** Hide the trailing chevron. Defaults to false (chevron shown). Useful
   *  for rows that toggle in-place without navigating. */
  hideChevron?: boolean;
  /** Render the chevron rotated 90° to indicate an expanded state. */
  expanded?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Anchor href — when set the row renders as <a> instead of <button>.
   *  Use for in-app navigation and external links. */
  href?: string;
  /** External link indicator — shows an outbound arrow instead of chevron. */
  external?: boolean;
}

/**
 * Single tap row used inside SettingsGroup. Visually consistent with
 * AppLockSettingsCard's SecurityRow so the whole profile screen reads
 * as one design language.
 */
export function SettingsRow({
  icon,
  title,
  subtitle,
  trailing,
  hideChevron = false,
  expanded = false,
  disabled = false,
  onClick,
  href,
  external = false,
}: SettingsRowProps) {
  const inner = (
    <>
      <span className="w-9 h-9 shrink-0 rounded-[11px] flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/75 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
        {icon}
      </span>

      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold tracking-[-0.01em] text-white/95 leading-tight">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block text-[11.5px] font-medium text-white/45 leading-snug truncate">
            {subtitle}
          </span>
        )}
      </span>

      <span className="flex items-center gap-2 shrink-0">
        {trailing}
        {!hideChevron && (
          <ChevronRight
            className={`w-[15px] h-[15px] text-white/30 transition-transform duration-200 ${
              expanded ? 'rotate-90 text-white/55' : 'group-hover:text-white/55'
            } ${external ? '-rotate-45' : ''}`}
          />
        )}
      </span>
    </>
  );

  const baseCls = `group w-full px-4 py-3.5 flex items-center gap-3 text-left transition-colors duration-150 ${
    disabled
      ? 'opacity-55 cursor-not-allowed'
      : 'active:bg-white/[0.04] hover:bg-white/[0.025]'
  }`;

  if (href) {
    return (
      <a
        href={href}
        className={baseCls}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer noopener' : undefined}
      >
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={baseCls}>
      {inner}
    </button>
  );
}
