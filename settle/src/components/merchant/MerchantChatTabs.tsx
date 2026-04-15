'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Search, X, ChevronRight, CheckCheck, Shield, AlertTriangle, ArrowUpRight, ArrowDownLeft, Check, Info } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import type { OrderConversation } from '@/hooks/useMerchantConversations';

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
  orderConversations: OrderConversation[];
  totalUnread: number;
  isLoading: boolean;
  onOpenOrderChat: (orderId: string, userName: string, orderNumber: string, orderType?: 'buy' | 'sell') => void;
  onOpenDisputeChat?: (orderId: string, userName: string) => void;
  onClearUnread?: (orderId: string) => void;
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

function getStatusColor(status: string): string {
  switch (status) {
    case 'accepted': return 'text-blue-400 bg-blue-500/15';
    case 'escrowed': return 'text-purple-400 bg-purple-500/15';
    case 'payment_sent': return 'text-yellow-400 bg-yellow-500/15';
    case 'completed': return 'text-green-400 bg-green-500/15';
    case 'cancelled': case 'expired': return 'text-white/30 bg-white/[0.04]';
    case 'disputed': return 'text-red-400 bg-red-500/15';
    default: return 'text-white/40 bg-white/[0.04]';
  }
}

export function MerchantChatTabs({
  merchantId,
  orderConversations,
  totalUnread,
  isLoading,
  onOpenOrderChat,
  onOpenDisputeChat,
  onClearUnread,
  onClose,
}: MerchantChatTabsProps) {
  const [activeTab, setActiveTab] = useState<'orders' | 'disputes'>('orders');
  const [searchQuery, setSearchQuery] = useState('');

  // Dispute conversations state (fetched independently)
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
    } catch { /* best-effort */ }
    finally { setIsLoadingDisputes(false); }
  }, [merchantId]);

  useEffect(() => {
    fetchDisputes();
    const interval = setInterval(fetchDisputes, 15000);
    return () => clearInterval(interval);
  }, [fetchDisputes]);

  // Filter: search by order number or username
  const filteredOrders = orderConversations.filter(conv =>
    conv.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.user.username.toLowerCase().includes(searchQuery.toLowerCase())
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
          <div className="flex items-center gap-1">
            {(totalUnread + disputeUnread) > 0 && (
              <span className="text-[10px] border border-primary/30 text-primary px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {totalUnread + disputeUnread}
              </span>
            )}

            {/* Mark all read — only shown when there's something to clear */}
            {totalUnread > 0 && (
              <div className="group relative flex items-center">
                <button
                  onClick={() => {
                    // Clear unread counters for every order-conversation with unread
                    orderConversations
                      .filter((c) => c.unread_count > 0)
                      .forEach((c) => onClearUnread?.(c.order_id));
                  }}
                  className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-primary/10 text-primary/70 hover:text-primary transition-colors"
                  title="Mark all conversations as read"
                  aria-label="Mark all conversations as read"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                  <span className="text-[9px] font-bold uppercase tracking-wider hidden sm:inline">
                    Read
                  </span>
                </button>
                {/* Hover tooltip explaining what it does */}
                <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[180px] z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                    Clears unread counters on all order chats. Merchants can still scroll back to read the messages — nothing is deleted.
                  </span>
                </span>
              </div>
            )}

            {/* Info hint — always visible so users know the panel behavior */}
            <div className="group relative flex items-center">
              <Info className="w-3 h-3 text-white/25 hover:text-white/50 cursor-help transition-colors" />
              <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[200px] z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                  <span className="block font-bold mb-0.5">About this inbox</span>
                  Shows every order with a chat. Unread counter = messages you haven&apos;t seen. Click any card to open the chat.
                </span>
              </span>
            </div>

            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-card transition-colors text-white/20 hover:text-foreground/40"
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
          onClick={() => setActiveTab('orders')}
          className={`flex-1 px-3 py-1.5 text-[10px] font-mono font-medium transition-colors relative ${
            activeTab === 'orders' ? 'text-white/80' : 'text-white/30 hover:text-foreground/50'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <MessageCircle className="w-3 h-3" />
            <span>Orders</span>
            {totalUnread > 0 && (
              <span className="w-4 h-4 bg-primary text-background text-[8px] font-bold rounded-full flex items-center justify-center">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </div>
          {activeTab === 'orders' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('disputes')}
          className={`flex-1 px-3 py-1.5 text-[10px] font-mono font-medium transition-colors relative ${
            activeTab === 'disputes' ? 'text-white/80' : 'text-white/30 hover:text-foreground/50'
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
            placeholder={activeTab === 'orders' ? 'Search orders...' : 'Search disputes...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/15 outline-none font-mono"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {activeTab === 'orders' ? (
          /* ── Orders Tab ── */
          isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15">
              <MessageCircle className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-[10px] font-mono">{searchQuery ? 'No matches' : 'No order chats yet'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredOrders.map((conv) => {
                const isBuy = conv.order_type === 'buy';
                const TypeIcon = isBuy ? ArrowDownLeft : ArrowUpRight;
                const hasUnread = conv.unread_count > 0;
                const fiatSymbol = conv.fiat_currency === 'INR' ? '₹' : conv.fiat_currency === 'AED' ? 'د.إ' : conv.fiat_currency;
                const timestamp = conv.last_message?.created_at || conv.last_activity;

                return (
                  <button
                    key={conv.order_id}
                    onClick={() => {
                      onClearUnread?.(conv.order_id);
                      onOpenOrderChat(conv.order_id, conv.user.username, conv.order_number, conv.order_type);
                    }}
                    className={`group relative w-full p-3 rounded-xl text-left overflow-hidden transition-all border ${
                      hasUnread
                        ? 'bg-gradient-to-br from-primary/[0.05] to-transparent border-primary/20 hover:border-primary/40'
                        : 'bg-gradient-to-br from-foreground/[0.03] to-transparent border-foreground/[0.06] hover:border-foreground/[0.12] hover:shadow-md hover:shadow-black/20'
                    }`}
                  >
                    {/* Unread accent bar */}
                    {hasUnread && (
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-primary/80 to-primary/30 rounded-r" />
                    )}

                    <div className="flex items-start gap-3">
                      {/* Avatar with type ring */}
                      <div className="relative shrink-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base shadow-sm ring-2 ${
                          isBuy
                            ? 'ring-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.15] to-foreground/[0.03]'
                            : 'ring-orange-500/20 bg-gradient-to-br from-orange-500/[0.15] to-foreground/[0.03]'
                        }`}>
                          {getUserEmoji(conv.user.username)}
                        </div>
                        {/* Direction mini-badge */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center ${
                          isBuy ? 'bg-emerald-500' : 'bg-orange-500'
                        }`}>
                          <TypeIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        </div>
                        {hasUnread && (
                          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-primary text-background text-[10px] font-extrabold rounded-full flex items-center justify-center ring-2 ring-background">
                            {conv.unread_count > 9 ? '9+' : conv.unread_count}
                          </span>
                        )}
                      </div>

                      {/* Content column */}
                      <div className="flex-1 min-w-0">
                        {/* Top row: username + timestamp */}
                        <div className="flex items-baseline justify-between gap-2 mb-0.5">
                          <span className={`text-[13px] font-bold truncate ${hasUnread ? 'text-white' : 'text-white/90'}`}>
                            {conv.user.username}
                          </span>
                          <span className={`text-[10px] font-mono tabular-nums shrink-0 ${hasUnread ? 'text-primary/80' : 'text-white/30'}`}>
                            {formatRelativeTime(timestamp)}
                          </span>
                        </div>

                        {/* Amount row — crypto → fiat */}
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-[9px] font-extrabold font-mono tracking-[0.1em] px-1.5 py-px rounded ${
                            isBuy
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-orange-500/15 text-orange-400'
                          }`}>
                            {isBuy ? 'BUY' : 'SELL'}
                          </span>
                          <span className="text-[12px] font-bold text-white tabular-nums">
                            {Number(conv.crypto_amount).toFixed(2)}
                            <span className="text-[9px] font-semibold text-white/40 ml-0.5">USDC</span>
                          </span>
                          <ChevronRight className="w-3 h-3 text-white/20 shrink-0" strokeWidth={2.5} />
                          <span className="text-[12px] font-bold text-white/80 tabular-nums truncate">
                            {fiatSymbol}{Number(conv.fiat_amount).toLocaleString()}
                          </span>
                        </div>

                        {/* Bottom row: last message OR status + order number */}
                        {conv.last_message ? (
                          <div className="flex items-center gap-1.5">
                            {conv.last_message.sender_type === 'merchant' && (
                              <CheckCheck className={`w-3 h-3 shrink-0 ${
                                conv.last_message.is_read ? 'text-primary/80' : 'text-white/25'
                              }`} strokeWidth={2.5} />
                            )}
                            <p className={`text-[11px] truncate flex-1 ${
                              hasUnread ? 'text-white/80 font-medium' : 'text-white/40'
                            }`}>
                              {truncate(conv.last_message.content, 38)}
                            </p>
                            <span className={`text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-px rounded shrink-0 ${getStatusColor(conv.order_status)}`}>
                              {conv.order_status}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-white/25 truncate">
                              #{conv.order_number}
                            </span>
                            <span className={`text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-px rounded shrink-0 ${getStatusColor(conv.order_status)}`}>
                              {conv.order_status}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          /* ── Disputes Tab ── (unchanged) */
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
                  onClick={() => {
                    setDisputeConversations(prev => {
                      let removed = 0;
                      const next = prev.map(c => {
                        if (c.order_id === conv.order_id) {
                          removed += c.unread_count || 0;
                          return { ...c, unread_count: 0 };
                        }
                        return c;
                      });
                      if (removed > 0) setDisputeUnread(t => Math.max(0, t - removed));
                      return next;
                    });
                    setTimeout(() => fetchDisputes(), 1500);
                    onOpenDisputeChat?.(conv.order_id, conv.user.username);
                  }}
                  className="w-full p-2 glass-card rounded-lg hover:border-[var(--color-error)]/20 transition-colors text-left group"
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
                        <span>${Number(conv.crypto_amount).toFixed(2)}</span>
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
                    <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-[var(--color-error)]/30 transition-colors self-center flex-shrink-0" />
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
