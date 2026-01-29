'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Search, X, ChevronRight, Clock, User, CheckCheck } from 'lucide-react';

interface Conversation {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: 'buy' | 'sell';
  crypto_amount: number;
  fiat_amount: number;
  fiat_currency: string;
  order_created_at: string;
  user: {
    id: string;
    username: string;
    rating: number;
    total_trades: number;
  };
  message_count: number;
  unread_count: number;
  last_message: {
    id: string;
    content: string;
    sender_type: string;
    message_type: string;
    created_at: string;
    is_read: boolean;
  } | null;
  last_activity: string;
}

interface MessageHistoryProps {
  merchantId: string;
  onOpenChat: (orderId: string, user: string, emoji: string) => void;
  onClose?: () => void;
}

// Status badge colors
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  accepted: 'bg-blue-500/20 text-blue-400',
  escrowed: 'bg-purple-500/20 text-purple-400',
  payment_sent: 'bg-cyan-500/20 text-cyan-400',
  payment_confirmed: 'bg-teal-500/20 text-teal-400',
  completed: 'bg-emerald-500/20 text-emerald-400',
  cancelled: 'bg-red-500/20 text-red-400',
  disputed: 'bg-orange-500/20 text-orange-400',
  expired: 'bg-zinc-500/20 text-zinc-400',
};

// User emojis based on username hash
function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

// Format relative time
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

// Truncate text
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function MessageHistory({ merchantId, onOpenChat, onClose }: MessageHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [totalUnread, setTotalUnread] = useState(0);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        merchant_id: merchantId,
        limit: '50',
      });

      if (searchQuery) {
        params.set('search', searchQuery);
      }

      if (statusFilter) {
        params.set('order_status', statusFilter);
      }

      const res = await fetch(`/api/merchant/messages?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');

      const data = await res.json();
      if (data.success) {
        setConversations(data.data.conversations);
        setTotalUnread(data.data.totalUnread);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId, searchQuery, statusFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchConversations();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchConversations]);

  const handleOpenChat = (conv: Conversation) => {
    const emoji = getUserEmoji(conv.user.username);
    onOpenChat(conv.order_id, conv.user.username, emoji);
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900/50 rounded-xl border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-emerald-400" />
          <span className="font-medium text-white">Message History</span>
          {totalUnread > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-emerald-500 text-white rounded-full">
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

      {/* Search & Filter */}
      <div className="px-4 py-3 border-b border-white/5 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg
                       text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['', 'pending', 'escrowed', 'completed', 'disputed'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors
                ${statusFilter === status
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
                }`}
            >
              {status || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-white/40">
            <MessageCircle className="w-12 h-12 mb-2 opacity-50" />
            <p>No conversations found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {conversations.map((conv) => (
              <button
                key={conv.order_id}
                onClick={() => handleOpenChat(conv)}
                className="w-full px-4 py-3 hover:bg-white/5 transition-colors text-left group"
              >
                <div className="flex items-start gap-3">
                  {/* User Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/20
                                    flex items-center justify-center text-lg">
                      {getUserEmoji(conv.user.username)}
                    </div>
                    {conv.unread_count > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-white
                                       text-xs font-medium rounded-full flex items-center justify-center">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">
                          {conv.user.username}
                        </span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded uppercase
                          ${STATUS_COLORS[conv.order_status] || 'bg-zinc-500/20 text-zinc-400'}`}>
                          {conv.order_status}
                        </span>
                      </div>
                      <span className="text-xs text-white/40 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {conv.last_message ? formatRelativeTime(conv.last_message.created_at) : ''}
                      </span>
                    </div>

                    {/* Order Info */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-white/50">
                        {conv.order_number}
                      </span>
                      <span className="text-xs text-white/30">•</span>
                      <span className={`text-xs ${conv.order_type === 'buy' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                        {conv.order_type === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                      <span className="text-xs text-white/50">
                        {conv.fiat_amount.toLocaleString()} {conv.fiat_currency}
                      </span>
                    </div>

                    {/* Last Message Preview */}
                    {conv.last_message && (
                      <div className="flex items-center gap-1 mt-1">
                        {conv.last_message.sender_type === 'merchant' && (
                          <CheckCheck className={`w-3 h-3 flex-shrink-0 ${
                            conv.last_message.is_read ? 'text-emerald-400' : 'text-white/30'
                          }`} />
                        )}
                        <p className={`text-sm truncate ${
                          conv.unread_count > 0 ? 'text-white font-medium' : 'text-white/60'
                        }`}>
                          {conv.last_message.message_type === 'image'
                            ? '📷 Photo'
                            : truncate(conv.last_message.content, 50)
                          }
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
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

export default MessageHistory;
