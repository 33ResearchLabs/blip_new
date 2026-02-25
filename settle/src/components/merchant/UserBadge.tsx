'use client';

import Link from 'next/link';

/**
 * Reusable avatar + name badge with optional profile link.
 * Used across all panels wherever a merchant/user identity appears.
 *
 * - If `merchantId` is provided, the badge links to /merchant/profile/[id]
 * - If `avatarUrl` is provided, shows the image; otherwise shows initials
 * - Supports small (24px), medium (28px), and large (40px) sizes
 */

interface UserBadgeProps {
  name: string;
  avatarUrl?: string | null;
  emoji?: string;
  merchantId?: string;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  nameClassName?: string;
  className?: string;
}

const SIZE_MAP = {
  sm: { box: 'w-6 h-6', text: 'text-[10px]', img: 24 },
  md: { box: 'w-7 h-7', text: 'text-xs', img: 28 },
  lg: { box: 'w-10 h-10', text: 'text-sm', img: 40 },
} as const;

export function UserBadge({
  name,
  avatarUrl,
  emoji,
  merchantId,
  size = 'md',
  showName = true,
  nameClassName = 'text-xs font-medium text-white/80',
  className = '',
}: UserBadgeProps) {
  const s = SIZE_MAP[size];
  const initials = name.slice(0, 2).toUpperCase();

  const avatar = (
    <div className={`${s.box} rounded-full overflow-hidden shrink-0 border border-white/[0.08] flex items-center justify-center bg-white/[0.04]`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : emoji ? (
        <span className={s.text}>{emoji}</span>
      ) : (
        <span className={`${s.text} font-bold text-white/50`}>{initials}</span>
      )}
    </div>
  );

  const nameEl = showName ? (
    <span className={`${nameClassName} truncate`}>{name}</span>
  ) : null;

  if (merchantId) {
    return (
      <Link
        href={`/merchant/profile/${merchantId}`}
        className={`flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {avatar}
        {nameEl}
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      {avatar}
      {nameEl}
    </div>
  );
}
