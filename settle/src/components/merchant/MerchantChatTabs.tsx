'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Search, X, ChevronRight, CheckCheck, Star, Users, Store, Shield, AlertTriangle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

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

interface DisputeConversation {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: 'buy' | 'sell';
  crypto_amount: number;
  fiat_amount: number;
  fiat_currency: string;
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
  conversations: DirectConversation[];
  totalUnread: number;
  isLoading: boolean;
  onOpenChat: (targetId: string, targetType: 'user' | 'merchant', username: string) => void;
  onOpenDisputeChat?: (orderId: string, userName: string) => void;
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

function getSenderLabel(senderType: string): string {
  if (senderType === 'compliance') return 'Compliance: ';
  if (senderType === 'system') return '';
  return '';
}

export function MerchantChatTabs({
  merchantId,
  conversations,
  totalUnread,
  isLoading,
  onOpenChat,
  onOpenDisputeChat,
  onClose,
}: MerchantChatTabsProps) {
  const [activeTab, setActiveTab] = useState<'direct' | 'disputes'>('direct');
  const [searchQuery, setSearchQuery] = useState('');

  // Dispute conversations state
  const [disputeConversations, setDisputeConversations] = useState<DisputeConversation[]>([]);
  const [disputeUnread, setDisputeUnread] = useState(0);
  const [isLoadingDisputes, setIsLoadingDisputes] = useState(false);

  const fetchDisputes = useCallback(async () => {
    if (!merchantId) return;
    setIsLoadingDisputes(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/messages?merchant_id=${merchantId}&tab=dispute&limit=50`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (data.success) {
        setDisputeConversations(data.data.conversations || []);
        setDisputeUnread(data.data.tabCounts?.disputeUnread || 0);
      }
    } catch {
      // Best-effort
    } finally {
      setIsLoadingDisputes(false);
    }
  }, [merchantId]);

  // Fetch disputes on mount and poll
  useEffect(() => {
    fetchDisputes();
    const interval = setInterval(fetchDisputes, 15000);
    return () => clearInterval(interval);
  }, [fetchDisputes]);

  const filteredDirect = conversations.filter(conv =>
    (conv.nickname || conv.username).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDisputes = disputeConversations.filter(conv =>
    conv.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.user.username.toLowerCase().includes(searchQuery.toLowerCase())
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
            {(totalUnread + disputeUnread) > 0 && (
              <span className="text-[10px] border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {totalUnread + disputeUnread}
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

      {/* Tabs */}
      <div className="flex border-b border-white/[0.04]">
        <button
          onClick={() => setActiveTab('direct')}
          className={`flex-1 px-3 py-1.5 text-[10px] font-mono font-medium transition-colors relative ${
            activeTab === 'direct'
              ? 'text-white/80'
              : 'text-white/30 hover:text-white/50'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <MessageCircle className="w-3 h-3" />
            <span>Direct</span>
            {totalUnread > 0 && (
              <span className="w-4 h-4 bg-orange-500 text-black text-[8px] font-bold rounded-full flex items-center justify-center">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </div>
          {activeTab === 'direct' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-orange-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('disputes')}
          className={`flex-1 px-3 py-1.5 text-[10px] font-mono font-medium transition-colors relative ${
            activeTab === 'disputes'
              ? 'text-white/80'
              : 'text-white/30 hover:text-white/50'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Shield className="w-3 h-3" />
            <span>Disputes</span>
            {disputeUnread > 0 && (
              <span className="w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {disputeUnread > 9 ? '9+' : disputeUnread}
              </span>
            )}
          </div>
          {activeTab === 'disputes' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-red-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
          <Search className="w-3 h-3 text-white/20" />
          <input
            type="text"
            placeholder={activeTab === 'direct' ? 'Search contacts...' : 'Search disputes...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/15 outline-none font-mono"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {activeTab === 'direct' ? (
          /* ── Direct Messages Tab ── */
          isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-4 h-4 border-2 border-orange-500/40 border-t-orange-400 rounded-full animate-spin" />
            </div>
          ) : filteredDirect.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15">
              <Users className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-[10px] font-mono">{searchQuery ? 'No matches' : 'No messages yet'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredDirect.map((conv) => (
                <button
                  key={conv.contact_id}
                  onClick={() => onOpenChat(conv.contact_target_id, conv.contact_type, conv.nickname || conv.username)}
                  className="w-full p-2 glass-card rounded-lg hover:border-white/[0.10] transition-colors text-left group"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-sm">
                        {getUserEmoji(conv.username)}
                      </div>
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-black text-[9px] font-bold rounded-full flex items-center justify-center">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </span>
                      )}
                    </div>
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
          )
        ) : (
          /* ── Disputes Tab ── */
          isLoadingDisputes ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-4 h-4 border-2 border-red-500/40 border-t-red-400 rounded-full animate-spin" />
            </div>
          ) : filteredDisputes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15">
              <Shield className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-[10px] font-mono">{searchQuery ? 'No matches' : 'No active disputes'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredDisputes.map((conv) => (
                <button
                  key={conv.order_id}
                  onClick={() => onOpenDisputeChat?.(conv.order_id, conv.user.username)}
                  className="w-full p-2 glass-card rounded-lg hover:border-red-500/20 transition-colors text-left group"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-sm">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      </div>
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-medium text-white/70 truncate">
                          Order #{conv.order_number}
                        </span>
                        <span className="text-[8px] px-1 py-0.5 bg-red-500/15 text-red-400 rounded font-mono">
                          DISPUTE
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-white/30 font-mono">
                        <span>{conv.user.username}</span>
                        <span className="text-white/10">·</span>
                        <span>${conv.crypto_amount.toLocaleString()}</span>
                        {conv.last_message && (
                          <>
                            <span className="text-white/10">·</span>
                            <span>{formatRelativeTime(conv.last_message.created_at)}</span>
                          </>
                        )}
                      </div>
                      {conv.last_message && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {conv.last_message.sender_type === 'compliance' && (
                            <Shield className="w-2.5 h-2.5 flex-shrink-0 text-red-400/60" />
                          )}
                          <p className={`text-[10px] truncate ${
                            conv.unread_count > 0 ? 'text-white/60 font-medium' : 'text-white/30'
                          }`}>
                            {getSenderLabel(conv.last_message.sender_type)}
                            {truncate(conv.last_message.content, 30)}
                          </p>
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-red-400/30 transition-colors self-center flex-shrink-0" />
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
