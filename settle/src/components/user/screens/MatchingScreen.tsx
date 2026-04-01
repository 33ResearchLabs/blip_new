"use client";

import { motion } from "framer-motion";
import { ChevronLeft, Check, Clock } from "lucide-react";
import type { Screen, OrderStatus, OrderStep } from "./types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export interface MatchingScreenProps {
  setScreen: (s: Screen) => void;
  pendingTradeData: { amount: string; fiatAmount: string; type: "buy" | "sell"; paymentMethod: "bank" | "cash" };
  matchingTimeLeft: number;
  formatTimeLeft: (s: number) => string;
  currentRate: number;
  activeOrderId: string | null;
  userId: string | null;
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
  setPendingTradeData: (d: any) => void;
  toast: any;
  maxW: string;
}

export const MatchingScreen = ({
  setScreen,
  pendingTradeData,
  matchingTimeLeft,
  formatTimeLeft,
  currentRate,
  activeOrderId,
  userId,
  setOrders,
  setPendingTradeData,
  toast,
}: MatchingScreenProps) => {
  return (
    <div style={{ background: '#ffffff', minHeight: '100%' }}>
      <div className="h-12" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <button onClick={() => setScreen("home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1"
          style={{ background: '#111111' }}>
          <ChevronLeft className="w-5 h-5" style={{ color: '#fff' }} />
        </button>
        <h1 className="text-[17px] font-semibold text-black">Order Placed</h1>
        <div className="w-10" />
      </div>

      <div className="px-5 pb-10">
        {/* Amount Display */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center py-6"
        >
          <p className="text-[13px] mb-2" style={{ color: 'rgba(0,0,0,0.4)' }}>
            You&apos;re {pendingTradeData.type === 'buy' ? 'buying' : 'selling'}
          </p>
          <div className="flex items-baseline justify-center gap-2">
            <p className="text-[42px] font-bold text-black tracking-tight">{parseFloat(pendingTradeData.amount).toFixed(2)}</p>
            <p className="text-[17px]" style={{ color: 'rgba(0,0,0,0.3)' }}>USDT</p>
          </div>
          <p className="text-[15px] mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
            for {'\u062F.\u0625'} {parseFloat(pendingTradeData.fiatAmount).toLocaleString()}
          </p>
        </motion.div>

        {/* Status Card */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl p-4 mb-4"
          style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-center gap-3 mb-4 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ border: '2px solid rgba(255,255,255,0.1)' }}
                animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <motion.div
                className="w-3 h-3 rounded-full"
                style={{ background: '#10b981' }}
                animate={{ scale: [1, 0.8, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <div>
              <p className="text-[15px] font-medium text-white">Finding a merchant</p>
              <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>We&apos;ll notify you when ready</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: '#10b981' }}>
                <Check className="w-3 h-3 text-white" />
              </div>
              <p className="text-[14px] text-white">Order submitted</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid rgba(255,255,255,0.3)' }}>
                <motion.div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.5)' }}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
              <p className="text-[14px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Matching with merchant</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full shrink-0" style={{ border: '2px solid rgba(255,255,255,0.1)' }} />
              <p className="text-[14px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Ready to pay</p>
            </div>
          </div>
        </motion.div>

        {/* Countdown Timer */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl p-5 mb-4 text-center"
          style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Time remaining</p>
          <div className="flex items-center justify-center gap-2">
            <Clock className={`w-5 h-5 ${matchingTimeLeft < 60 ? 'text-red-400' : ''}`} style={matchingTimeLeft >= 60 ? { color: 'rgba(255,255,255,0.7)' } : {}} />
            <p className={`text-[28px] font-semibold tracking-tight ${matchingTimeLeft < 60 ? 'text-red-400' : 'text-white'}`}>
              {formatTimeLeft(matchingTimeLeft)}
            </p>
          </div>
          {matchingTimeLeft < 180 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[12px] mt-2"
              style={{ color: matchingTimeLeft < 60 ? '#ef4444' : 'rgba(255,255,255,0.5)' }}
            >
              {matchingTimeLeft < 60 ? 'Order will expire soon!' : 'Hurry! Time is running out'}
            </motion.p>
          )}
          <div className="w-full h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <motion.div
              className={`h-full rounded-full ${matchingTimeLeft < 60 ? 'bg-red-500' : ''}`}
              style={matchingTimeLeft >= 60 ? { background: 'rgba(255,255,255,0.2)' } : {}}
              initial={{ width: '100%' }}
              animate={{ width: `${(matchingTimeLeft / (15 * 60)) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>

        {/* Info */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl p-4" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Payment</p>
            <p className="text-[15px] font-medium text-white capitalize">{pendingTradeData.paymentMethod}</p>
          </div>
          <div className="rounded-xl p-4" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Rate</p>
            <p className="text-[15px] font-medium text-white">{currentRate} AED</p>
          </div>
        </div>

        <p className="text-[13px] text-center px-4 mb-6" style={{ color: 'rgba(0,0,0,0.35)' }}>
          If no merchant accepts within {Math.ceil(matchingTimeLeft / 60)} minutes, your order will be moved to timeout.
        </p>

        {/* Bottom Actions */}
        <div className="space-y-3">
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setScreen("home")}
            className="w-full py-4 rounded-2xl text-[17px] font-semibold"
            style={{ background: '#111111', color: '#fff' }}
          >
            Done
          </motion.button>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (activeOrderId) {
                  setOrders((prev: any[]) => prev.map((o: any) =>
                    o.id === activeOrderId ? { ...o, status: "payment" as OrderStatus, step: 2 as OrderStep } : o
                  ));
                  setPendingTradeData(null);
                  setScreen("order");
                }
              }}
              className="flex-1 py-3 rounded-xl text-[13px] font-medium"
              style={{ background: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.45)', border: '1px solid rgba(0,0,0,0.08)' }}
            >
              Demo: Accept
            </button>
            <button
              onClick={async () => {
                if (activeOrderId && userId) {
                  try {
                    const res = await fetchWithAuth(`/api/orders/${activeOrderId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        status: 'cancelled',
                        actor_type: 'user',
                        actor_id: userId,
                        reason: 'User cancelled order',
                      }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setOrders((prev: any[]) => prev.filter((o: any) => o.id !== activeOrderId));
                      toast.showOrderCancelled('You cancelled the order');
                    }
                  } catch (err) {
                    console.error('Failed to cancel order:', err);
                    toast.showWarning('Failed to cancel order');
                  }
                }
                setPendingTradeData(null);
                setScreen("home");
              }}
              className="flex-1 py-3 rounded-xl text-[13px] font-medium"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.15)' }}
            >
              Cancel Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
