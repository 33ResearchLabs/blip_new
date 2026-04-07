"use client";

import { motion } from "framer-motion";
import { Clock, Check, TrendingUp, TrendingDown, X } from "lucide-react";
import { colors, sectionLabel as sectionLabelStyle, mono } from "@/lib/design/theme";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

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
  const card = { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` };
  const sectionLabel = { ...sectionLabelStyle };

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: colors.bg.primary }}>

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p style={{ ...sectionLabel, marginBottom: 4 }}>Overview</p>
        <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: colors.text.primary, lineHeight: 1, marginBottom: 16 }}>Activity</p>

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
                className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full"
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  background: on ? colors.accent.primary : colors.surface.card,
                  color: on ? colors.accent.text : colors.text.tertiary,
                  border: on ? 'none' : `1px solid ${colors.border.subtle}`,
                }}>
                {tab === "active" && on && (
                  <motion.div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent.text }}
                    animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
                )}
                {label}
                {count > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
                    background: on ? 'rgba(0,0,0,0.15)' : colors.surface.card,
                    color: on ? colors.accent.text : colors.text.tertiary,
                  }}>{count}</span>
                )}
              </motion.button>
            );
          })}
        </div>
      </header>

      {/* ── List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

        {/* Active Orders */}
        {activityTab === "active" && (
          pendingOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
                style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
                <Clock size={22} color="rgba(255,255,255,0.3)" />
              </div>
              <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: colors.text.primary, marginBottom: 6 }}>No active trades</p>
              <p style={{ fontSize: 13, fontWeight: 500, color: colors.text.tertiary }}>Start a new trade from the home screen</p>
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
                    className="w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left"
                    style={card}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: isBuy ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${isBuy ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                      {isBuy
                        ? <TrendingUp size={17} color="#059669" />
                        : <TrendingDown size={17} color="#dc2626" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p style={{ fontSize: 14, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.01em' }}>
                          {isBuy ? "Receiving" : "Sending"} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em', color: isBuy ? '#059669' : '#dc2626' }}>
                          {isBuy ? "+" : "-"}{"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                          Step {order.step}/4
                        </span>
                        {timeStr && (
                          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'monospace', color: secs !== null && secs < 60 ? '#dc2626' : 'rgba(255,255,255,0.35)' }}>
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
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
                style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
                <Check size={22} color="rgba(255,255,255,0.3)" />
              </div>
              <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: colors.text.primary, marginBottom: 6 }}>No completed trades</p>
              <p style={{ fontSize: 13, fontWeight: 500, color: colors.text.tertiary }}>Completed transactions appear here</p>
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
                    className="w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left"
                    style={card}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Check size={17} color="rgba(255,255,255,0.4)" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p style={{ fontSize: 14, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.01em' }}>
                          {isBuy ? "Received" : "Sent"} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em', color: isBuy ? '#059669' : '#dc2626' }}>
                          {isBuy ? "+" : "-"}{"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>Done</span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.35)' }}>{order.createdAt.toLocaleDateString('en-GB')}</span>
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
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
                style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
                <X size={22} color="rgba(255,255,255,0.3)" />
              </div>
              <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: colors.text.primary, marginBottom: 6 }}>No cancelled orders</p>
              <p style={{ fontSize: 13, fontWeight: 500, color: colors.text.tertiary }}>Cancelled or expired orders appear here</p>
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
                    className="w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left"
                    style={card}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <X size={17} color="#dc2626" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p style={{ fontSize: 14, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.01em' }}>
                          {isBuy ? "Buy" : "Sell"} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em', color: 'rgba(255,255,255,0.4)' }}>
                          {"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                          {order.status === 'expired' ? 'Expired' : 'Cancelled'}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.35)' }}>{order.createdAt.toLocaleDateString('en-GB')}</span>
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
