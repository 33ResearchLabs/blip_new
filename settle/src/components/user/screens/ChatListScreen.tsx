"use client";

import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

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
  const card = { background: '#111111', border: '1px solid rgba(255,255,255,0.08)' };

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: '#ffffff' }}>

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Inbox</p>
        <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: '#000', lineHeight: 1 }}>Messages</p>
      </header>

      {/* ── List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
              style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
              <MessageCircle size={22} color="rgba(255,255,255,0.3)" />
            </div>
            <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#000', marginBottom: 6 }}>No messages</p>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.4)' }}>Start a trade to chat with merchants</p>
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
                  className="w-full rounded-[18px] p-3.5 flex items-center gap-3 text-left"
                  style={hasUnread ? { background: '#111111', border: '1.5px solid rgba(255,255,255,0.2)' } : card}>
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: hasUnread ? '#fff' : 'rgba(255,255,255,0.1)' }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: hasUnread ? '#000' : 'rgba(255,255,255,0.5)' }}>{initial}</span>
                    </div>
                    {hasUnread && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: '#fff', border: '2px solid #111111' }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color: '#000' }}>{order.unreadCount}</span>
                      </div>
                    )}
                  </div>
                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p style={{ fontSize: 14, fontWeight: hasUnread ? 800 : 600, color: '#fff', letterSpacing: '-0.01em' }}>
                        {order.merchant.name}
                      </p>
                      <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.35)' }}>
                        {order.lastMessage
                          ? order.lastMessage.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : order.createdAt.toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <p style={{ fontSize: 12, fontWeight: hasUnread ? 600 : 400, color: hasUnread ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.lastMessage
                        ? (order.lastMessage.fromMerchant ? '' : 'You: ') + order.lastMessage.content
                        : order.status === 'complete'
                          ? 'Trade completed'
                          : `${order.type === 'buy' ? 'Buying' : 'Selling'} ${parseFloat(order.cryptoAmount).toFixed(2)} USDC`}
                    </p>
                  </div>
                  {/* Active indicator */}
                  {!hasUnread && order.status !== 'complete' && (
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
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
