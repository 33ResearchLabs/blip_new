"use client";

/**
 * MerchantCard
 * ────────────
 * The "who you're trading with" row shared across Active Order states — avatar,
 * name, rating, trade count / online status, and a chat button with unread
 * badge. One source so the merchant identity reads identically everywhere.
 * Pure presentation.
 */

import { MessageCircle, Star } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatCrypto, formatCount } from "@/lib/format";

const CARD = "bg-surface-card border border-border-subtle";

export interface MerchantCardProps {
  name: string;
  avatarUrl?: string | null;
  rating: number;
  trades: number;
  isOnline?: boolean;
  unreadCount?: number;
  onViewProfile: () => void;
  onOpenChat: () => void;
}

export function MerchantCard({
  name,
  avatarUrl,
  rating,
  trades,
  isOnline,
  unreadCount,
  onViewProfile,
  onOpenChat,
}: MerchantCardProps) {
  return (
    <div className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}>
      <button
        onClick={() => name && onViewProfile()}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
        aria-label="View merchant profile"
      >
        <div className="relative shrink-0">
          <UserAvatar src={avatarUrl} seed={name} size={48} alt={name} className="rounded-full" />
          {isOnline && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-text-secondary border-2 border-surface-card" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[15px] font-semibold text-text-primary truncate">{name}</p>
            {rating > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-text-secondary shrink-0">
                <Star className="w-3.5 h-3.5 text-text-secondary fill-text-tertiary" />
                {formatCrypto(rating, { decimals: 1 })}
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-tertiary">
            {trades > 0 ? `${formatCount(trades)} trades` : "New merchant"}
            {isOnline ? " · Online" : ""}
          </p>
        </div>
      </button>
      <button
        onClick={onOpenChat}
        className="relative w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-surface-active"
        aria-label="Chat with merchant"
      >
        <MessageCircle className="w-5 h-5 text-text-secondary" />
        {!!unreadCount && unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-text text-[10px] font-semibold leading-4 text-center tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
