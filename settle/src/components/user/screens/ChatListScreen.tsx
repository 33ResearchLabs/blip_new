"use client";

import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

const CARD = "bg-surface-card border border-border-subtle";

export interface ChatListScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  orders: Order[];
  setActiveOrderId: (id: string) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  maxW: string;
}

export const ChatListScreen = ({
  screen,
  setScreen,
  orders,
  setActiveOrderId,
  setOrders,
  maxW,
}: ChatListScreenProps) => {
  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase mb-1">Inbox</p>
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">Messages</p>
      </header>

      {/* ── List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto scrollbar-hide">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 ${CARD}`}>
              <MessageCircle size={22} className="text-white/30" />
            </div>
            <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No messages</p>
            <p className="text-[13px] font-medium text-text-tertiary">Start a trade to chat with merchants</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {orders.map((order, i) => {
              const hasUnread = (order.unreadCount || 0) > 0;
              const initial = order.merchant.name.charAt(0).toUpperCase();
              return (
                <motion.button key={order.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setActiveOrderId(order.id);
                    setScreen("chat-view");
                    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, unreadCount: 0 } : o));
                  }}
                  className={`w-full rounded-[18px] p-3.5 flex items-center gap-3 text-left ${
                    hasUnread ? 'bg-surface-card border-[1.5px] border-white/15' : CARD
                  }`}>
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${
                      hasUnread ? 'bg-white' : 'bg-white/10'
                    }`}>
                      <span className={`text-[17px] font-extrabold ${hasUnread ? 'text-black' : 'text-white/50'}`}>{initial}</span>
                    </div>
                    {hasUnread && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center bg-white border-2 border-surface-base">
                        <span className="text-[8px] font-extrabold text-white">{order.unreadCount}</span>
                      </div>
                    )}
                  </div>
                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className={`text-[14px] text-text-primary tracking-[-0.01em] ${hasUnread ? 'font-extrabold' : 'font-semibold'}`}>
                        {order.merchant.name}
                      </p>
                      <p className="text-[10px] font-medium text-text-tertiary">
                        {order.lastMessage
                          ? order.lastMessage.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : order.createdAt.toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <p className={`text-[12px] overflow-hidden text-ellipsis whitespace-nowrap ${
                      hasUnread ? 'font-semibold text-white/65' : 'font-normal text-text-tertiary'
                    }`}>
                      {order.lastMessage
                        ? (order.lastMessage.fromMerchant ? '' : 'You: ') + order.lastMessage.content
                        : order.status === 'complete'
                          ? 'Trade completed'
                          : `${order.type === 'buy' ? 'Buying' : 'Selling'} ${parseFloat(order.cryptoAmount).toFixed(2)} USDC`}
                    </p>
                  </div>
                  {/* Active indicator */}
                  {!hasUnread && order.status !== 'complete' && (
                    <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/20" />
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
