'use client';

import Image from 'next/image';

interface UserBadgeProps {
  name: string;
  avatarUrl?: string;
  emoji?: string;
  merchantId?: string;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}

export function UserBadge({ name, avatarUrl, emoji, merchantId, size = 'md', showName = true }: UserBadgeProps) {
  const sizeMap = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-sm', lg: 'w-10 h-10 text-base' };
  const initial = emoji || name?.charAt(0)?.toUpperCase() || '?';

  return (
    <div className="flex items-center gap-2">
      <div className={`${sizeMap[size]} relative rounded-full bg-white/10 flex items-center justify-center font-medium text-white shrink-0 overflow-hidden`}>
        {avatarUrl ? (
          <Image src={avatarUrl} alt={name} fill className="object-cover" sizes="40px" />
        ) : (
          <span>{initial}</span>
        )}
      </div>
      {showName && <span className="text-sm text-white truncate">{name}</span>}
    </div>
  );
}
