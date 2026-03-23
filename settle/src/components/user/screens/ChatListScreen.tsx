"use client";

import { motion } from "framer-motion";
import { ChevronLeft, MessageCircle } from "lucide-react";
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
  return (
    <>
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button onClick={() => setScreen("home")} className="p-2 -ml-2">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Messages</h1>
      </div>

      <div className="flex-1 px-5 pb-28 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-neutral-600" />
            </div>
            <p className="text-[17px] font-medium text-white mb-1">No messages</p>
            <p className="text-[15px] text-neutral-500">Start a trade to chat with merchants</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map(order => (
              <motion.button
                key={order.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setActiveOrderId(order.id);
                  setScreen("chat-view");
                  setOrders(prev => prev.map(o => o.id === order.id ? { ...o, unreadCount: 0 } : o));
                }}
                className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center gap-3"
              >
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white font-semibold">
                    {order.merchant.name.charAt(0)}
                  </div>
                  {order.merchant.isOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-neutral-900" />
                  )}
                  {(order.unreadCount || 0) > 0 && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-white">{order.unreadCount}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className={`text-[15px] font-medium ${(order.unreadCount || 0) > 0 ? 'text-white' : 'text-neutral-300'}`}>
                      {order.merchant.name}
                    </p>
                    <p className="text-[11px] text-neutral-600">
                      {order.lastMessage
                        ? order.lastMessage.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : order.createdAt.toLocaleDateString()
                      }
                    </p>
                  </div>
                  <p className={`text-[13px] truncate ${(order.unreadCount || 0) > 0 ? 'text-neutral-300 font-medium' : 'text-neutral-500'}`}>
                    {order.lastMessage
                      ? (order.lastMessage.fromMerchant ? '' : 'You: ') + order.lastMessage.content
                      : order.status === "complete"
                        ? "Trade completed"
                        : `${order.type === "buy" ? "Buying" : "Selling"} ${order.cryptoAmount} USDC`
                    }
                  </p>
                </div>
                {order.status !== "complete" && !(order.unreadCount || 0) && (
                  <div className="w-2 h-2 rounded-full bg-neutral-700" />
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </>
  );
};
