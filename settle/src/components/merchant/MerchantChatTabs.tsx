'use client';

import { useState } from 'react';
import { MessageCircle, Search, X, ChevronRight, CheckCheck, Star, Users, Store } from 'lucide-react';

interface DirectConversation {
  contact_id: string;
  contact_type: 'user' | 'merchant';
  contact_target_id: string;
  username: string;
  nickname: string | null;
  is_favorite: boolean;
  trades_count: number;
  last_message: {
    content: string;
    sender_type: string;
    created_at: string;
    is_read: boolean;
  } | null;
  unread_count: number;
  last_activity: string | null;
}

interface MerchantChatTabsProps {
  merchantId: string;
  conversations: DirectConversation[];
  totalUnread: number;
  isLoading: boolean;
  onOpenChat: (targetId: string, targetType: 'user' | 'merchant', username: string) => void;
  onClose?: () => void;
}

function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function MerchantChatTabs({
  conversations,
  totalUnread,
  isLoading,
  onOpenChat,
  onClose,
}: MerchantChatTabsProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = conversations.filter(conv =>
    (conv.nickname || conv.username).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              Messages
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {totalUnread > 0 && (
              <span className="text-[10px] border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {totalUnread}
              </span>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-white/[0.06] transition-colors text-white/20 hover:text-white/40"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
          <Search className="w-3 h-3 text-white/20" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/15 outline-none font-mono"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-4 h-4 border-2 border-orange-500/40 border-t-orange-400 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/15">
            <Users className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-[10px] font-mono">{searchQuery ? 'No matches' : 'No messages yet'}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((conv) => (
              <button
                key={conv.contact_id}
                onClick={() => onOpenChat(conv.contact_target_id, conv.contact_type, conv.nickname || conv.username)}
                className="w-full p-2 glass-card rounded-lg hover:border-white/[0.10] transition-colors text-left group"
              >
                <div className="flex items-center gap-2">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06]
                                    flex items-center justify-center text-sm">
                      {getUserEmoji(conv.username)}
                    </div>
                    {conv.unread_count > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-black
                                       text-[9px] font-bold rounded-full flex items-center justify-center">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-medium text-white/70 truncate">
                        {conv.nickname || conv.username}
                      </span>
                      {conv.contact_type === 'merchant' && (
                        <Store className="w-2.5 h-2.5 text-orange-400/60" />
                      )}
                      {conv.is_favorite && (
                        <Star className="w-2.5 h-2.5 text-white/40 fill-white/40" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-white/30 font-mono">
                      <span>{conv.trades_count} trade{conv.trades_count !== 1 ? 's' : ''}</span>
                      {conv.last_message && (
                        <>
                          <span className="text-white/10">·</span>
                          <span>{formatRelativeTime(conv.last_message.created_at)}</span>
                        </>
                      )}
                    </div>
                    {conv.last_message && (
                      <div className="flex items-center gap-1 mt-0.5">
                        {conv.last_message.sender_type === 'merchant' && (
                          <CheckCheck className={`w-2.5 h-2.5 flex-shrink-0 ${
                            conv.last_message.is_read ? 'text-orange-400/60' : 'text-white/15'
                          }`} />
                        )}
                        <p className={`text-[10px] truncate ${
                          conv.unread_count > 0 ? 'text-white/60 font-medium' : 'text-white/30'
                        }`}>
                          {truncate(conv.last_message.content, 35)}
                        </p>
                      </div>
                    )}
                  </div>

                  <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-white/25 transition-colors self-center flex-shrink-0" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MerchantChatTabs;
