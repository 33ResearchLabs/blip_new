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

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
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
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-[#c9a962]" />
          <span className="font-medium text-white">Messages</span>
          {totalUnread > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#c9a962] text-black">
              {totalUnread}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg
                       text-white placeholder:text-white/40 focus:outline-none focus:border-[#c9a962]/50"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto pb-20">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-[#c9a962] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-white/40">
            <Users className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">{searchQuery ? 'No matches' : 'No messages yet'}</p>
            {!searchQuery && (
              <p className="text-xs text-white/30 mt-1">Trade with someone to start chatting</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((conv) => (
              <button
                key={conv.contact_id}
                onClick={() => onOpenChat(conv.contact_target_id, conv.contact_type, conv.nickname || conv.username)}
                className="w-full px-4 py-3 hover:bg-white/[0.04] transition-colors text-left group"
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-11 h-11 rounded-full bg-white/5 border border-white/6
                                    flex items-center justify-center text-lg">
                      {getUserEmoji(conv.username)}
                    </div>
                    {conv.unread_count > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#c9a962] text-black
                                       text-xs font-bold rounded-full flex items-center justify-center">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">
                          {conv.nickname || conv.username}
                        </span>
                        {conv.contact_type === 'merchant' && (
                          <Store className="w-3 h-3 text-[#c9a962]" />
                        )}
                        {conv.is_favorite && (
                          <Star className="w-3 h-3 text-white/70 fill-white/70" />
                        )}
                      </div>
                      {conv.last_message && (
                        <span className="text-[11px] text-white/40">
                          {formatRelativeTime(conv.last_message.created_at)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-white/50">
                        {conv.trades_count} trade{conv.trades_count !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {conv.last_message && (
                      <div className="flex items-center gap-1 mt-1">
                        {conv.last_message.sender_type === 'merchant' && (
                          <CheckCheck className={`w-3 h-3 flex-shrink-0 ${
                            conv.last_message.is_read ? 'text-[#c9a962]' : 'text-white/30'
                          }`} />
                        )}
                        <p className={`text-sm truncate ${
                          conv.unread_count > 0 ? 'text-white font-medium' : 'text-white/60'
                        }`}>
                          {truncate(conv.last_message.content, 40)}
                        </p>
                      </div>
                    )}
                  </div>

                  <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors
                                          self-center flex-shrink-0" />
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
