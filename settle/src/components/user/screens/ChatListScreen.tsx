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

  const displayOrders = activeTab === 'chats' ? chatOrders : disputeOrders;

  const handleOpenChat = (order: Order) => {
    setActiveOrderId(order.id);
    setScreen("chat-view");
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, unreadCount: 0 } : o));
  };

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase mb-1">Inbox</p>
            <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">Messages</p>
          </div>
          <button
            onClick={() => setScreen("notifications")}
            className="relative p-2.5 rounded-[14px] bg-surface-card border border-border-subtle"
          >
            <Bell size={18} className="text-text-tertiary" />
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 rounded-full flex items-center justify-center bg-error text-text-primary text-[9px] font-extrabold px-1">
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
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all ${
            activeTab === 'chats'
              ? 'bg-accent text-accent-text'
              : 'bg-surface-hover text-text-tertiary'
          }`}
        >
          <MessageCircle size={13} strokeWidth={2.2} />
          <span className="text-[12px] font-bold">Chats</span>
          {chatOrders.length > 0 && (
            <span className={`text-[10px] font-extrabold min-w-4.5 text-center rounded-[10px] px-1.25 py-px ${
              activeTab === 'chats' ? 'bg-surface-hover text-text-primary' : 'bg-surface-active text-text-secondary'
            }`}>
              {chatOrders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('disputes')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all ${
            activeTab === 'disputes'
              ? 'bg-error text-text-primary'
              : 'bg-error-dim text-error'
          }`}
        >
          <Shield size={13} strokeWidth={2.2} />
          <span className="text-[12px] font-bold">Disputes</span>
          {disputeOrders.length > 0 && (
            <span className={`text-[10px] font-extrabold min-w-4.5 text-center rounded-[10px] px-1.25 py-px ${
              activeTab === 'disputes' ? 'bg-surface-active text-text-primary' : 'bg-error-dim text-error'
            }`}>
              {disputeUnread > 0 ? disputeUnread : disputeOrders.length}
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
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto scrollbar-hide">
        {displayOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 border ${
              activeTab === 'disputes'
                ? 'bg-error-dim border-error-border'
                : 'bg-surface-card border-border-subtle'
            }`}>
              {activeTab === 'disputes'
                ? <Shield size={22} className="text-error" />
                : <MessageCircle size={22} className="text-text-quaternary" />
              }
            </div>
            <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">
              {activeTab === 'disputes' ? 'No disputes' : 'No messages'}
            </p>
            <p className="text-[13px] font-medium text-text-tertiary">
              {activeTab === 'disputes' ? 'No active disputes on your orders' : 'Start a trade to chat with merchants'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {displayOrders.map((order, i) => {
              const hasUnread = (order.unreadCount || 0) > 0;
              const initial = (order.merchant?.name || 'M').charAt(0).toUpperCase();
              const isDispute = order.dbStatus === 'disputed';

              return (
                <motion.button key={order.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleOpenChat(order)}
                  className={`w-full rounded-[18px] p-3.5 flex items-center gap-3 text-left border-[1.5px] ${
                    isDispute
                      ? hasUnread
                        ? 'bg-error-dim border-error-border'
                        : 'bg-error-dim border-error-border'
                      : hasUnread
                        ? 'bg-surface-active border-border-strong'
                        : 'bg-surface-card border-border-subtle'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${
                      isDispute
                        ? 'bg-error-dim border border-error-border'
                        : hasUnread
                          ? 'bg-accent'
                          : 'bg-surface-active'
                    }`}>
                      {isDispute
                        ? <AlertTriangle size={18} className="text-error" />
                        : <span className={`text-[17px] font-extrabold ${hasUnread ? 'text-accent-text' : 'text-text-tertiary'}`}>{initial}</span>
                      }
                    </div>
                    {hasUnread && (
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border-2 border-surface-base ${
                        isDispute ? 'bg-error' : 'bg-accent'
                      }`}>
                        <span className={`text-[8px] font-extrabold ${isDispute ? 'text-text-primary' : 'text-accent-text'}`}>{order.unreadCount}</span>
                      </div>
                    )}
                  </div>
                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-[14px] tracking-[-0.01em] text-text-primary ${hasUnread ? 'font-extrabold' : 'font-semibold'}`}>
                          {order.merchant?.name || 'Merchant'}
                        </p>
                        {isDispute && (
                          <span className="text-[8px] font-bold bg-error-dim text-error px-1.25 py-px rounded">
                            DISPUTE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-medium text-text-tertiary">
                        {order.lastMessage
                          ? order.lastMessage.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : order.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    {/* Order details — distinguishes multiple orders with same merchant */}
                    <p className="text-[11px] font-medium text-text-tertiary mb-0.5">
                      {order.type === 'buy' ? 'Buying' : 'Selling'} {parseFloat(order.cryptoAmount).toFixed(2)} USDC · {order.createdAt.toLocaleDateString()}
                    </p>
                    <p className={`text-[12px] overflow-hidden text-ellipsis whitespace-nowrap ${
                      hasUnread ? 'font-semibold text-text-secondary' : 'font-normal text-text-tertiary'
                    }`}>
                      {order.lastMessage
                        ? getSenderPrefix(order) + order.lastMessage.content
                        : `${order.type === 'buy' ? 'Buying' : 'Selling'} ${parseFloat(order.cryptoAmount).toFixed(2)} USDC`}
                    </p>
                  </div>
                  {/* Active indicator */}
                  {!hasUnread && !isDispute && order.status !== 'complete' && (
                    <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-quaternary" />
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
