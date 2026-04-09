"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageCircle, Shield, AlertTriangle, Bell } from "lucide-react";
import { BottomNav } from "./BottomNav";
import { FilterDropdown, type FilterOption } from "./ui";
import type { Screen, Order } from "./types";

type TimeFilter = 'today' | '7d' | '30d' | 'all';

const TIME_FILTER_OPTIONS: ReadonlyArray<FilterOption<TimeFilter>> = [
  { key: 'today', label: 'Today' },
  { key: '7d',    label: '7 Days' },
  { key: '30d',   label: '30 Days' },
  { key: 'all',   label: 'All' },
];

function getSenderPrefix(order: Order): string {
  const st = order.lastMessage?.senderType;
  if (st === 'compliance') return 'Compliance: ';
  if (st === 'system') return '';
  if (order.lastMessage?.fromMerchant) return '';
  return 'You: ';
}

export interface ChatListScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  orders: Order[];
  setActiveOrderId: (id: string) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  maxW: string;
  notificationCount?: number;
}

export const ChatListScreen = ({
  screen,
  setScreen,
  orders,
  setActiveOrderId,
  setOrders,
  maxW,
  notificationCount = 0,
}: ChatListScreenProps) => {
  const [activeTab, setActiveTab] = useState<'chats' | 'disputes'>('chats');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');
  const card = { background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' };

  const filterByTime = (list: Order[]) => {
    if (timeFilter === 'all') return list;
    const now = Date.now();
    const cutoff = timeFilter === 'today' ? now - 86400000 : timeFilter === '7d' ? now - 7 * 86400000 : now - 30 * 86400000;
    return list.filter(o => {
      const ts = o.lastMessage?.createdAt?.getTime() || o.createdAt?.getTime() || 0;
      return ts >= cutoff;
    });
  };

  const chatOrders = filterByTime(orders.filter(o => o.dbStatus !== 'disputed'));
  const disputeOrders = filterByTime(orders.filter(o => o.dbStatus === 'disputed'));
  const disputeUnread = disputeOrders.reduce((sum, o) => sum + (o.unreadCount || 0), 0);

  // Group orders by merchant — one inbox row per contact, showing the most
  // recent order/message and summing unread counts across all orders with them.
  type Grouped = {
    key: string;
    representative: Order; // most recent order — click opens this one
    orderCount: number;
    totalUnread: number;
  };
  const groupByMerchant = (list: Order[]): Grouped[] => {
    const map = new Map<string, Grouped>();
    for (const o of list) {
      const key = o.merchant?.id || o.merchant?.name || o.id;
      const ts = (o.lastMessage?.createdAt?.getTime() || o.createdAt?.getTime() || 0);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { key, representative: o, orderCount: 1, totalUnread: o.unreadCount || 0 });
      } else {
        existing.orderCount += 1;
        existing.totalUnread += o.unreadCount || 0;
        const existingTs = (existing.representative.lastMessage?.createdAt?.getTime() || existing.representative.createdAt?.getTime() || 0);
        if (ts > existingTs) existing.representative = o;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const ta = a.representative.lastMessage?.createdAt?.getTime() || a.representative.createdAt?.getTime() || 0;
      const tb = b.representative.lastMessage?.createdAt?.getTime() || b.representative.createdAt?.getTime() || 0;
      return tb - ta;
    });
  };

  const chatGroups = groupByMerchant(chatOrders);
  const disputeGroups = groupByMerchant(disputeOrders);
  const displayGroups = activeTab === 'chats' ? chatGroups : disputeGroups;

  const handleOpenChat = (order: Order, group?: Grouped) => {
    setActiveOrderId(order.id);
    setScreen("chat-view");
    // Clear unread for ALL orders in the same group (same merchant), not just
    // the representative — otherwise the grouped badge keeps showing the
    // counts from sibling orders.
    const groupKey = group?.key || order.merchant?.id || order.merchant?.name || order.id;
    setOrders(prev => prev.map(o => {
      const oKey = o.merchant?.id || o.merchant?.name || o.id;
      return oKey === groupKey ? { ...o, unreadCount: 0 } : o;
    }));
  };

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: '#060606' }}>

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>Inbox</p>
            <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', lineHeight: 1 }}>Messages</p>
          </div>
          <button
            onClick={() => setScreen("notifications")}
            className="relative p-2.5 rounded-[14px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <Bell size={18} color="rgba(255,255,255,0.4)" />
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center"
                style={{ background: '#ef4444', fontSize: 9, fontWeight: 800, color: '#fff', padding: '0 4px' }}>
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Tabs + Time Filter (single row) ── */}
      <div className="px-5 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setActiveTab('chats')}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all"
          style={activeTab === 'chats'
            ? { background: '#fff', color: '#000' }
            : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }
          }
        >
          <MessageCircle size={13} strokeWidth={2.2} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>Chats</span>
          {chatGroups.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center',
              background: activeTab === 'chats' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)',
              borderRadius: 10, padding: '1px 5px',
            }}>
              {chatGroups.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('disputes')}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all"
          style={activeTab === 'disputes'
            ? { background: '#ef4444', color: '#fff' }
            : { background: 'rgba(239,68,68,0.1)', color: 'rgba(239,68,68,0.6)' }
          }
        >
          <Shield size={13} strokeWidth={2.2} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>Disputes</span>
          {disputeGroups.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center',
              background: activeTab === 'disputes' ? 'rgba(255,255,255,0.2)' : 'rgba(239,68,68,0.15)',
              borderRadius: 10, padding: '1px 5px',
            }}>
              {disputeUnread > 0 ? disputeUnread : disputeGroups.length}
            </span>
          )}
        </button>

        {/* Time filter — collapsed into a dropdown on the right */}
        <FilterDropdown
          className="ml-auto"
          ariaLabel="Time range filter"
          value={timeFilter}
          onChange={setTimeFilter}
          options={TIME_FILTER_OPTIONS}
        />
      </div>

      {/* ── List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {displayGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
              style={{ background: activeTab === 'disputes' ? 'rgba(239,68,68,0.1)' : '#ffffff', border: activeTab === 'disputes' ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(0,0,0,0.06)' }}>
              {activeTab === 'disputes'
                ? <Shield size={22} color="rgba(239,68,68,0.4)" />
                : <MessageCircle size={22} color="rgba(0,0,0,0.2)" />
              }
            </div>
            <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', marginBottom: 6 }}>
              {activeTab === 'disputes' ? 'No disputes' : 'No messages'}
            </p>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.3)' }}>
              {activeTab === 'disputes' ? 'No active disputes on your orders' : 'Start a trade to chat with merchants'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {displayGroups.map((group, i) => {
              const order = group.representative;
              const hasUnread = group.totalUnread > 0;
              const initial = (order.merchant?.name || 'M').charAt(0).toUpperCase();
              const isDispute = order.dbStatus === 'disputed';

              return (
                <motion.button key={group.key}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleOpenChat(order, group)}
                  className="w-full rounded-[18px] p-3.5 flex items-center gap-3 text-left"
                  style={isDispute
                    ? { background: hasUnread ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)', border: `1.5px solid rgba(239,68,68,${hasUnread ? 0.3 : 0.1})` }
                    : hasUnread
                      ? { background: '#ffffff', border: '1.5px solid rgba(0,0,0,0.15)' }
                      : card
                  }>
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={isDispute
                        ? { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.2)' }
                        : { background: hasUnread ? '#000' : 'rgba(0,0,0,0.07)' }
                      }>
                      {isDispute
                        ? <AlertTriangle size={18} color="#ef4444" />
                        : <span style={{ fontSize: 17, fontWeight: 800, color: hasUnread ? '#fff' : 'rgba(0,0,0,0.5)' }}>{initial}</span>
                      }
                    </div>
                    {hasUnread && (
                      <div className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center"
                        style={{ background: isDispute ? '#ef4444' : '#000', border: isDispute ? '2px solid #1a0a0a' : '2px solid #ffffff' }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color: '#fff' }}>{group.totalUnread > 9 ? '9+' : group.totalUnread}</span>
                      </div>
                    )}
                  </div>
                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <p style={{ fontSize: 14, fontWeight: hasUnread ? 800 : 600, color: isDispute ? '#fff' : '#000', letterSpacing: '-0.01em' }}>
                          {order.merchant?.name || 'Merchant'}
                        </p>
                        {isDispute && (
                          <span style={{ fontSize: 8, fontWeight: 700, background: 'rgba(239,68,68,0.2)', color: '#ef4444', padding: '1px 5px', borderRadius: 4 }}>
                            DISPUTE
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 10, fontWeight: 500, color: isDispute ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>
                        {order.lastMessage
                          ? order.lastMessage.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : order.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    {/* Order count — shown when this contact has multiple trades */}
                    <p style={{ fontSize: 11, fontWeight: 500, color: isDispute ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)', marginBottom: 2 }}>
                      {group.orderCount > 1
                        ? `${group.orderCount} orders · latest ${order.type === 'buy' ? 'buying' : 'selling'} ${parseFloat(order.cryptoAmount).toFixed(2)} USDC`
                        : `${order.type === 'buy' ? 'Buying' : 'Selling'} ${parseFloat(order.cryptoAmount).toFixed(2)} USDC · ${order.createdAt.toLocaleDateString()}`}
                    </p>
                    <p style={{
                      fontSize: 12,
                      fontWeight: hasUnread ? 600 : 400,
                      color: isDispute
                        ? (hasUnread ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)')
                        : (hasUnread ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.35)'),
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {order.lastMessage
                        ? getSenderPrefix(order) + order.lastMessage.content
                        : `${order.type === 'buy' ? 'Buying' : 'Selling'} ${parseFloat(order.cryptoAmount).toFixed(2)} USDC`}
                    </p>
                  </div>
                  {/* Active indicator */}
                  {!hasUnread && !isDispute && order.status !== 'complete' && (
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(0,0,0,0.2)' }} />
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} notificationCount={notificationCount} />
    </div>
  );
};
