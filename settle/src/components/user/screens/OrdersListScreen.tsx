"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Check, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

type StatusFilter = 'all' | 'active' | 'completed' | 'pending' | 'escrowed' | 'payment' | 'disputed';

const STATUS_TABS: { key: StatusFilter; label: string; color?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'escrowed', label: 'Escrowed' },
  { key: 'payment', label: 'Paid' },
  { key: 'disputed', label: 'Disputed', color: '#ef4444' },
  { key: 'completed', label: 'Done' },
];

export interface OrdersListScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  setActiveOrderId: (id: string) => void;
  activityTab: "active" | "completed";
  setActivityTab: (t: "active" | "completed") => void;
  pendingOrders: Order[];
  completedOrders: Order[];
  allOrders?: Order[];
  maxW: string;
  onFilterChange?: (opts: { status?: string; days?: number }) => void;
}

export const OrdersListScreen = ({
  screen,
  setScreen,
  setActiveOrderId,
  activityTab,
  setActivityTab,
  pendingOrders,
  completedOrders,
  allOrders,
  maxW,
  onFilterChange,
}: OrdersListScreenProps) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<'7d' | '1m' | '3m' | '6m' | 'all'>('7d');

  // Notify parent when filters change so it can refetch from API
  const applyFilter = (newStatus: StatusFilter, newTime: typeof timeFilter) => {
    const statusMap: Record<StatusFilter, string | undefined> = {
      all: undefined,
      active: 'pending,accepted,escrowed,payment_sent',
      completed: 'completed',
      pending: 'pending',
      escrowed: 'escrowed',
      payment: 'payment_sent',
      disputed: 'disputed',
    };
    const daysMap: Record<typeof timeFilter, number | undefined> = {
      '7d': 7, '1m': 30, '3m': 90, '6m': 180, 'all': undefined,
    };
    onFilterChange?.({ status: statusMap[newStatus], days: daysMap[newTime] });
  };
  const card = { background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' };
  const sectionLabel = { fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const };

  // Use allOrders if available, else combine pending + completed
  const all = allOrders || [...pendingOrders, ...completedOrders];

  const filteredOrders = (() => {
    // Status filter
    let result: Order[];
    switch (statusFilter) {
      case 'active': result = all.filter(o => o.status !== 'complete'); break;
      case 'completed': result = all.filter(o => o.status === 'complete'); break;
      case 'pending': result = all.filter(o => o.dbStatus === 'pending'); break;
      case 'escrowed': result = all.filter(o => o.dbStatus === 'escrowed'); break;
      case 'payment': result = all.filter(o => o.dbStatus === 'payment_sent' || o.status === 'payment'); break;
      case 'disputed': result = all.filter(o => o.dbStatus === 'disputed'); break;
      default: result = all;
    }
    // Time filter
    if (timeFilter !== 'all') {
      const now = Date.now();
      const days = timeFilter === '7d' ? 7 : timeFilter === '1m' ? 30 : timeFilter === '3m' ? 90 : 180;
      const cutoff = now - days * 86400000;
      result = result.filter(o => (o.createdAt?.getTime() || 0) >= cutoff);
    }
    return result;
  })();

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: '#060606' }}>

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-3 shrink-0">
        <p style={{ ...sectionLabel, marginBottom: 4 }}>Overview</p>
        <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', lineHeight: 1, marginBottom: 12 }}>Activity</p>

        {/* Status Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {STATUS_TABS.map(({ key, label, color }) => {
            const on = statusFilter === key;
            const count = key === 'all' ? all.length
              : key === 'active' ? all.filter(o => o.status !== 'complete').length
              : key === 'completed' ? all.filter(o => o.status === 'complete').length
              : key === 'pending' ? all.filter(o => o.dbStatus === 'pending').length
              : key === 'escrowed' ? all.filter(o => o.dbStatus === 'escrowed').length
              : key === 'payment' ? all.filter(o => o.dbStatus === 'payment_sent' || o.status === 'payment').length
              : key === 'disputed' ? all.filter(o => o.dbStatus === 'disputed').length
              : 0;
            return (
              <button key={key}
                onClick={() => { setStatusFilter(key); applyFilter(key, timeFilter); }}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full transition-all"
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                  background: on ? (color || '#fff') : 'rgba(255,255,255,0.04)',
                  color: on ? (color ? '#fff' : '#000') : (color || 'rgba(255,255,255,0.35)'),
                  border: `1px solid ${on ? (color ? color : '#fff') : 'rgba(255,255,255,0.06)'}`,
                }}>
                {label}
                {count > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '1px 4px', borderRadius: 99, minWidth: 16, textAlign: 'center',
                    background: on ? (color ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)') : 'rgba(255,255,255,0.06)',
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* ── Time Filter ── */}
      <div className="px-5 pb-2 flex gap-1.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([
          { key: '7d' as const, label: '7 Days' },
          { key: '1m' as const, label: '1 Month' },
          { key: '3m' as const, label: '3 Months' },
          { key: '6m' as const, label: '6 Months' },
          { key: 'all' as const, label: 'All Time' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTimeFilter(key); applyFilter(statusFilter, key); }}
            className="shrink-0 px-3 py-1 rounded-full transition-all"
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
              background: timeFilter === key ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
              color: timeFilter === key ? '#fff' : 'rgba(255,255,255,0.3)',
              border: `1px solid ${timeFilter === key ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
              style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
              <Clock size={22} color="rgba(0,0,0,0.2)" />
            </div>
            <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', marginBottom: 6 }}>No orders</p>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.3)' }}>No orders match this filter</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredOrders.map((order, i) => {
              const isBuy = order.type === "buy";
              const isComplete = order.status === 'complete';
              const isDisputed = order.dbStatus === 'disputed';
              const secs = !isComplete && order.expiresAt
                ? Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000))
                : null;
              const timeStr = secs !== null && secs > 0
                ? `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}`
                : null;
              return (
                <motion.button key={order.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                  className="w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left"
                  style={isDisputed
                    ? { background: 'rgba(239,68,68,0.05)', border: '1.5px solid rgba(239,68,68,0.15)' }
                    : card
                  }>
                  <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                    style={isDisputed
                      ? { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }
                      : isComplete
                        ? { background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.06)' }
                        : { background: isBuy ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${isBuy ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }
                    }>
                    {isDisputed
                      ? <AlertTriangle size={17} color="#ef4444" />
                      : isComplete
                        ? <Check size={17} color="rgba(0,0,0,0.4)" />
                        : isBuy
                          ? <TrendingUp size={17} color="#059669" />
                          : <TrendingDown size={17} color="#dc2626" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <p style={{ fontSize: 14, fontWeight: 700, color: isDisputed ? '#fff' : '#000', letterSpacing: '-0.01em' }}>
                          {isComplete ? (isBuy ? "Received" : "Sent") : (isBuy ? "Receiving" : "Sending")} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                        </p>
                        {isDisputed && (
                          <span style={{ fontSize: 8, fontWeight: 700, background: 'rgba(239,68,68,0.2)', color: '#ef4444', padding: '1px 5px', borderRadius: 4 }}>
                            DISPUTE
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em', color: isBuy ? '#059669' : '#dc2626' }}>
                        {isBuy ? "+" : "-"}{"\u062F.\u0625"}{parseFloat(order.fiatAmount).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, background: isDisputed ? 'rgba(239,68,68,0.15)' : 'rgba(0,0,0,0.06)', color: isDisputed ? '#ef4444' : 'rgba(0,0,0,0.5)' }}>
                        {isComplete ? 'Done' : isDisputed ? 'Disputed' : `Step ${order.step}/4`}
                      </span>
                      {timeStr && (
                        <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'monospace', color: secs !== null && secs < 60 ? '#dc2626' : 'rgba(0,0,0,0.35)' }}>
                          {timeStr}
                        </span>
                      )}
                      <span style={{ fontSize: 10, fontWeight: 500, color: isDisputed ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>
                        {order.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                  </div>
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
