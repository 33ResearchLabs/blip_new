"use client";

import { motion } from "framer-motion";
import { Clock, Check, TrendingUp, TrendingDown, X } from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

export interface OrdersListScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  setActiveOrderId: (id: string) => void;
  activityTab: "active" | "completed" | "cancelled";
  setActivityTab: (t: "active" | "completed" | "cancelled") => void;
  pendingOrders: Order[];
  completedOrders: Order[];
  cancelledOrders: Order[];
  maxW: string;
}

export const OrdersListScreen = ({
  screen,
  setScreen,
  setActiveOrderId,
  activityTab,
  setActivityTab,
  pendingOrders,
  completedOrders,
  cancelledOrders,
  maxW,
}: OrdersListScreenProps) => {
  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p className={`${SECTION_LABEL} mb-1`}>Overview</p>
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none mb-4">Activity</p>

        {/* Tabs */}
        <div className="flex gap-2">
          {([
            { tab: "active" as const, label: "Active", count: pendingOrders.length },
            { tab: "completed" as const, label: "Completed", count: completedOrders.length },
            { tab: "cancelled" as const, label: "Cancelled", count: cancelledOrders.length },
          ]).map(({ tab, label, count }) => {
            const on = activityTab === tab;
            return (
              <motion.button key={tab} whileTap={{ scale: 0.94 }}
                onClick={() => setActivityTab(tab)}
                className={`shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold tracking-[0.1em] uppercase ${
                  on
                    ? 'bg-accent text-accent-text'
                    : 'bg-surface-card text-text-tertiary border border-border-subtle'
                }`}>
                {tab === "active" && on && (
                  <motion.div className="w-1.5 h-1.5 rounded-full bg-accent-text"
                    animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
                )}
                {label}
                {count > 0 && (
                  <span className={`text-[9px] font-extrabold px-[5px] py-px rounded-full ${
                    on ? 'bg-black/15 text-accent-text' : 'bg-surface-card text-text-tertiary'
                  }`}>{count}</span>
                )}
              </motion.button>
            );
          })}
        </div>
      </header>

      {/* ── List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto scrollbar-hide">

        {/* Active Orders */}
        {activityTab === "active" && (
          pendingOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 ${CARD}`}>
                <Clock size={22} className="text-white/30" />
              </div>
              <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No active trades</p>
              <p className="text-[13px] font-medium text-text-tertiary">Start a new trade from the home screen</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {pendingOrders.map((order, i) => {
                const isBuy = order.type === "buy";
                const secs = order.expiresAt
                  ? Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000))
                  : null;
                const timeStr = secs !== null
                  ? `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}`
                  : null;
                return (
                  <motion.button key={order.id}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                    className={`w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left ${CARD}`}>
                    <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${
                      isBuy ? 'bg-success-dim border border-success-border' : 'bg-error-dim border border-error-border'
                    }`}>
                      {isBuy
                        ? <TrendingUp size={17} className="text-[#059669]" />
                        : <TrendingDown size={17} className="text-[#dc2626]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">
                          {isBuy ? "Receiving" : "Sending"} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        <p className={`text-[14px] font-extrabold tracking-[-0.01em] ${isBuy ? 'text-[#059669]' : 'text-[#dc2626]'}`}>
                          {isBuy ? "+" : "-"}{"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full bg-white/[0.08] text-white/50">
                          Step {order.step}/4
                        </span>
                        {timeStr && (
                          <span className={`text-[9px] font-bold font-mono ${
                            secs !== null && secs < 60 ? 'text-[#dc2626]' : 'text-white/35'
                          }`}>
                            {timeStr}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )
        )}

        {/* Completed Orders */}
        {activityTab === "completed" && (
          completedOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 ${CARD}`}>
                <Check size={22} className="text-white/30" />
              </div>
              <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No completed trades</p>
              <p className="text-[13px] font-medium text-text-tertiary">Completed transactions appear here</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {completedOrders.map((order, i) => {
                const isBuy = order.type === "buy";
                return (
                  <motion.button key={order.id}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                    className={`w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left ${CARD}`}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 bg-white/[0.08] border border-white/[0.08]">
                      <Check size={17} className="text-white/40" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">
                          {isBuy ? "Received" : "Sent"} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        <p className={`text-[14px] font-extrabold tracking-[-0.01em] ${isBuy ? 'text-[#059669]' : 'text-[#dc2626]'}`}>
                          {isBuy ? "+" : "-"}{"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full bg-white/[0.08] text-white/35">Done</span>
                        <span className="text-[10px] font-medium text-white/35">{order.createdAt.toLocaleDateString('en-GB')}</span>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )
        )}

        {/* Cancelled Orders */}
        {activityTab === "cancelled" && (
          cancelledOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 ${CARD}`}>
                <X size={22} className="text-white/30" />
              </div>
              <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No cancelled orders</p>
              <p className="text-[13px] font-medium text-text-tertiary">Cancelled or expired orders appear here</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cancelledOrders.map((order, i) => {
                const isBuy = order.type === "buy";
                return (
                  <motion.button key={order.id}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                    className={`w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left ${CARD}`}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 bg-error-dim border border-error-border">
                      <X size={17} className="text-[#dc2626]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">
                          {isBuy ? "Buy" : "Sell"} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        <p className="text-[14px] font-extrabold tracking-[-0.01em] text-white/40">
                          {"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full bg-error-dim text-error">
                          {order.status === 'expired' ? 'Expired' : 'Cancelled'}
                        </span>
                        <span className="text-[10px] font-medium text-white/35">{order.createdAt.toLocaleDateString('en-GB')}</span>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )
        )}
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
