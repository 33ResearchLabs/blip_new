'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, ShoppingBag, Search, X, ChevronRight, Clock, CheckCheck, Zap, Star, Users } from 'lucide-react';

type MainTab = 'direct' | 'orders';

interface DirectConversation {
  contact_id: string;
  user_id: string;
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

interface OrderConversation {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: 'buy' | 'sell';
  crypto_amount: number;
  fiat_amount: number;
  fiat_currency: string;
  order_created_at: string;
  has_manual_message: boolean;
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

interface MerchantChatTabsProps {
  merchantId: string;
  onOpenChat: (orderId: string, user: string, emoji: string) => void;
  onOpenDirectChat?: (userId: string, username: string) => void;
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

export function MerchantChatTabs({ merchantId, onOpenChat, onOpenDirectChat, onClose }: MerchantChatTabsProps) {
  const [activeTab, setActiveTab] = useState<MainTab>('orders');
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([]);
  const [orderConversations, setOrderConversations] = useState<OrderConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [directUnread, setDirectUnread] = useState(0);
  const [orderUnread, setOrderUnread] = useState(0);

  // Fetch direct conversations
  const fetchDirectConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/merchant/direct-messages?merchant_id=${merchantId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setDirectConversations(data.data.conversations || []);
        setDirectUnread(data.data.totalUnread || 0);
      }
    } catch (error) {
      console.error('Failed to fetch direct conversations:', error);
    }
  }, [merchantId]);

  // Fetch order conversations
  const fetchOrderConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        merchant_id: merchantId,
        limit: '50',
      });
      if (searchQuery) {
        params.set('search', searchQuery);
      }

      const res = await fetch(`/api/merchant/messages?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOrderConversations(data.data.conversations || []);
        setOrderUnread(data.data.totalUnread || 0);
      }
    } catch (error) {
      console.error('Failed to fetch order conversations:', error);
    }
  }, [merchantId, searchQuery]);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchDirectConversations(), fetchOrderConversations()]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchDirectConversations, fetchOrderConversations]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'orders') {
        fetchOrderConversations();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeTab, fetchOrderConversations]);

  const handleOpenOrderChat = (conv: OrderConversation) => {
    const emoji = getUserEmoji(conv.user.username);
    onOpenChat(conv.order_id, conv.user.username, emoji);
  };

  const handleOpenDirectChat = (conv: DirectConversation) => {
    if (onOpenDirectChat) {
      onOpenDirectChat(conv.user_id, conv.nickname || conv.username);
    }
  };

  // Filter conversations based on search
  const filteredDirectConversations = directConversations.filter(conv =>
    (conv.nickname || conv.username).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-[#c9a962]" />
          <span className="font-medium text-white">Chats</span>
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

      {/* Main Tabs */}
      <div className="flex border-b border-white/[0.04] bg-[#0d0d0d]">
        <button
          onClick={() => setActiveTab('direct')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all border-b-2 ${
            activeTab === 'direct'
              ? 'text-[#c9a962] border-[#c9a962]'
              : 'text-gray-500 border-transparent hover:text-gray-300'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Direct</span>
          {directUnread > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#c9a962] text-black">
              {directUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all border-b-2 ${
            activeTab === 'orders'
              ? 'text-[#c9a962] border-[#c9a962]'
              : 'text-gray-500 border-transparent hover:text-gray-300'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Orders</span>
          {orderUnread > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#c9a962] text-black">
              {orderUnread}
            </span>
          )}
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder={activeTab === 'direct' ? "Search contacts..." : "Search orders..."}
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
        ) : activeTab === 'direct' ? (
          // Direct Messages Tab
          filteredDirectConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/40">
              <Users className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">No contacts yet</p>
              <p className="text-xs mt-1 text-center px-8">
                Complete trades to add users as contacts
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {filteredDirectConversations.map((conv) => (
                <button
                  key={conv.contact_id}
                  onClick={() => handleOpenDirectChat(conv)}
                  className="w-full px-4 py-3 hover:bg-white/[0.04] transition-colors text-left group"
                >
                  <div className="flex items-start gap-3">
                    {/* User Avatar */}
                    <div className="relative flex-shrink-0">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#c9a962]/20 to-amber-400/20
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
                          {conv.is_favorite && (
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                          )}
                        </div>
                        {conv.last_message && (
                          <span className="text-[11px] text-white/40">
                            {formatRelativeTime(conv.last_message.created_at)}
                          </span>
                        )}
                      </div>

                      {/* Trades info */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-white/50">
                          {conv.trades_count} trade{conv.trades_count !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Last Message Preview */}
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
          )
        ) : (
          // Orders Tab
          orderConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/40">
              <ShoppingBag className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">No order chats</p>
              <p className="text-xs mt-1">New orders will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {orderConversations.map((conv) => (
                <button
                  key={conv.order_id}
                  onClick={() => handleOpenOrderChat(conv)}
                  className="w-full px-4 py-3 hover:bg-white/[0.04] transition-colors text-left group"
                >
                  <div className="flex items-start gap-3">
                    {/* User Avatar */}
                    <div className="relative flex-shrink-0">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/20
                                      flex items-center justify-center text-lg">
                        {getUserEmoji(conv.user.username)}
                      </div>
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-white
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
                            {conv.user.username}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded uppercase
                            ${STATUS_COLORS[conv.order_status] || 'bg-zinc-500/20 text-zinc-400'}`}>
                            {conv.order_status}
                          </span>
                        </div>
                        <span className="text-[11px] text-white/40 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {conv.last_message ? formatRelativeTime(conv.last_message.created_at) : ''}
                        </span>
                      </div>

                      {/* Order Info */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-white/50">
                          {conv.order_number}
                        </span>
                        <span className="text-[11px] text-white/30">•</span>
                        <span className={`text-[11px] ${conv.order_type === 'buy' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                          {conv.order_type === 'buy' ? 'Buy' : 'Sell'}
                        </span>
                        <span className="text-[11px] text-white/50">
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
                          {conv.last_message.message_type === 'system' && (
                            <Zap className="w-3 h-3 flex-shrink-0 text-amber-400" />
                          )}
                          <p className={`text-sm truncate ${
                            conv.unread_count > 0 ? 'text-white font-medium' : 'text-white/60'
                          }`}>
                            {conv.last_message.message_type === 'image'
                              ? '📷 Photo'
                              : truncate(conv.last_message.content, 40)
                            }
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
          )
        )}
      </div>
    </div>
  );
}

export default MerchantChatTabs;
