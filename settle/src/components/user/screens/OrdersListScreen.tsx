"use client";

import { motion } from "framer-motion";
import { Clock, Check, Flame } from "lucide-react";
import { HomeAmbientGlow } from "./HomeDecorations";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

export interface OrdersListScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  setActiveOrderId: (id: string) => void;
  activityTab: 'active' | 'completed';
  setActivityTab: (t: 'active' | 'completed') => void;
  pendingOrders: Order[];
  completedOrders: Order[];
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
  maxW,
}: OrdersListScreenProps) => {
  return (
    <>
      <HomeAmbientGlow />
      <div className="h-12" />

      <div className="px-5 pt-2 pb-4 z-10">
        <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 3 }}>Overview</p>
        <p style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>Activity</p>
      </div>

      {/* Activity Tabs */}
      <div className="px-5 mb-5">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {([
            { tab: 'active' as const, label: 'Active', count: pendingOrders.length },
            { tab: 'completed' as const, label: 'Completed', count: completedOrders.length },
          ] as const).map(({ tab, label, count }) => (
            <motion.button key={tab} whileTap={{ scale: 0.94 }} onClick={() => setActivityTab(tab)}
              className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full"
              style={activityTab === tab
                ? { background: '#fff', color: '#000' }
                : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {tab === 'active' && activityTab === 'active' && (
                <motion.div className="w-1.5 h-1.5 rounded-full bg-[#f97316]" animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
              )}
              <span style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
              {count > 0 && (
                <span style={{ fontSize: 9, fontWeight: 900, padding: '1px 5px', borderRadius: 99, background: activityTab === tab ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)', color: activityTab === tab ? '#000' : 'rgba(255,255,255,0.4)' }}>{count}</span>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-5 pb-28 overflow-y-auto relative z-10">
        {/* Active Orders Tab */}
        {activityTab === 'active' && (
          <>
            {pendingOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <Clock className="w-7 h-7" style={{ color: 'rgba(255,255,255,0.2)' }} />
                </div>
                <p style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 6 }}>No active trades</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>Start a new trade from the home screen</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingOrders.map((order, i) => (
                  <motion.button
                    key={order.id}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                    className="w-full flex items-center gap-3 rounded-[22px]"
                    style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="w-12 h-12 rounded-[18px] flex items-center justify-center shrink-0"
                      style={{ background: order.type === 'buy' ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${order.type === 'buy' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.1)'}` }}>
                      <motion.div className="w-2 h-2 rounded-full" style={{ background: order.type === 'buy' ? '#f97316' : '#fff', boxShadow: `0 0 8px ${order.type === 'buy' ? '#f97316' : '#fff'}` }} animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.02em' }}>
                          {order.type === 'buy' ? 'Receiving' : 'Sending'} {order.cryptoAmount} USDT
                        </p>
                        <p style={{ fontSize: 15, fontWeight: 900, color: order.type === 'buy' ? '#f97316' : '#fff' }}>
                          {order.type === 'buy' ? '+' : '-'} {'\u062F.\u0625'}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 99, background: order.type === 'buy' ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.05)', color: order.type === 'buy' ? '#f97316' : '#fff' }}>Step {order.step}/4</span>
                        {order.dbStatus === 'pending' && order.expiresAt ? (
                          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3, color: (() => { const s = Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000)); return s <= 120 ? '#f87171' : '#fb923c'; })() }}>
                            {(() => { const s = Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000)); if (s <= 0) return 'Expired'; if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`; return `${s}s`; })()}
                            <span style={{ fontSize: 12, filter: (() => { const s = Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000)); return s <= 120 ? 'drop-shadow(0 0 6px #ef4444)' : 'drop-shadow(0 0 4px #f97316)'; })() }}>🔥</span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.2)' }}>{order.createdAt.toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Completed Orders Tab */}
        {activityTab === 'completed' && (
          <>
            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <Check className="w-7 h-7" style={{ color: 'rgba(255,255,255,0.2)' }} />
                </div>
                <p style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 6 }}>No completed trades</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>Completed transactions appear here</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {completedOrders.map((order, i) => (
                  <motion.button
                    key={order.id}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                    className="w-full flex items-center gap-3 rounded-[22px]"
                    style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="w-12 h-12 rounded-[18px] flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <Check className="w-5 h-5" style={{ color: '#f97316' }} />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.02em' }}>
                          {order.type === 'buy' ? 'Received' : 'Sent'} {order.cryptoAmount} USDT
                        </p>
                        <p style={{ fontSize: 15, fontWeight: 900, color: '#f97316' }}>
                          {order.type === 'buy' ? '+' : '-'} {'\u062F.\u0625'}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 99, background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>Done</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.2)' }}>{order.createdAt.toLocaleDateString()}</span>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </>
  );
};
