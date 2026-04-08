"use client";

import { motion } from "framer-motion";
import { ChevronLeft, Check, Clock } from "lucide-react";
import type { Screen, OrderStatus, OrderStep } from "./types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

const CARD = "bg-surface-card border border-border-subtle";

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
    <div className="bg-surface-base min-h-full">
      <div className="h-12" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <button onClick={() => setScreen("home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised">
          <ChevronLeft className="w-5 h-5 text-text-primary" />
        </button>
        <h1 className="text-[17px] font-semibold text-text-primary">Order Placed</h1>
        <div className="w-10" />
      </div>

      <div className="px-5 pb-10">
        {/* Amount Display */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center py-6"
        >
          <p className="text-[13px] mb-2 text-text-tertiary">
            You&apos;re {pendingTradeData.type === 'buy' ? 'buying' : 'selling'}
          </p>
          <div className="flex items-baseline justify-center gap-2">
            <p className="text-[42px] font-bold tracking-tight text-text-primary">{parseFloat(pendingTradeData.amount).toFixed(2)}</p>
            <p className="text-[17px] text-text-tertiary">USDT</p>
          </div>
          <p className="text-[15px] mt-1 text-text-secondary">
            for {'\u062F.\u0625'} {parseFloat(pendingTradeData.fiatAmount).toLocaleString()}
          </p>
        </motion.div>

        {/* Status Card */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className={`rounded-2xl p-4 mb-4 ${CARD}`}
        >
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border-subtle">
            <div className="w-12 h-12 rounded-full flex items-center justify-center relative bg-surface-card">
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-border-medium"
                animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <motion.div
                className="w-3 h-3 rounded-full bg-[#10b981]"
                animate={{ scale: [1, 0.8, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <div>
              <p className="text-[15px] font-medium text-text-primary">Finding a merchant</p>
              <p className="text-[13px] text-text-tertiary">We&apos;ll notify you when ready</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-[#10b981]">
                <Check className="w-3 h-3 text-white" />
              </div>
              <p className="text-[14px] text-text-primary">Order submitted</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 border-text-tertiary">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-text-secondary"
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
              <p className="text-[14px] text-text-secondary">Matching with merchant</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full shrink-0 border-2 border-border-medium" />
              <p className="text-[14px] text-text-tertiary">Ready to pay</p>
            </div>
          </div>
        </motion.div>

        {/* Countdown Timer */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className={`rounded-2xl p-5 mb-4 text-center ${CARD}`}
        >
          <p className="text-[11px] uppercase tracking-wide mb-2 text-text-tertiary">Time remaining</p>
          <div className="flex items-center justify-center gap-2">
            <Clock className={`w-5 h-5 ${matchingTimeLeft < 60 ? 'text-red-400' : 'text-text-secondary'}`} />
            <p className={`text-[28px] font-semibold tracking-tight ${matchingTimeLeft < 60 ? 'text-red-400' : 'text-text-primary'}`}>
              {formatTimeLeft(matchingTimeLeft)}
            </p>
          </div>
          {matchingTimeLeft < 180 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`text-[12px] mt-2 ${matchingTimeLeft < 60 ? 'text-[#ef4444]' : 'text-white/50'}`}
            >
              {matchingTimeLeft < 60 ? 'Order will expire soon!' : 'Hurry! Time is running out'}
            </motion.p>
          )}
          <div className="w-full h-1.5 rounded-full mt-3 overflow-hidden bg-surface-card">
            <motion.div
              className={`h-full rounded-full ${matchingTimeLeft < 60 ? 'bg-red-500' : 'bg-border-medium'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${(matchingTimeLeft / (15 * 60)) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>

        {/* Info */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className={`rounded-xl p-4 ${CARD}`}>
            <p className="text-[11px] uppercase tracking-wide mb-1 text-text-tertiary">Payment</p>
            <p className="text-[15px] font-medium capitalize text-text-primary">{pendingTradeData.paymentMethod}</p>
          </div>
          <div className={`rounded-xl p-4 ${CARD}`}>
            <p className="text-[11px] uppercase tracking-wide mb-1 text-text-tertiary">Rate</p>
            <p className="text-[15px] font-medium text-text-primary">{currentRate} AED</p>
          </div>
        </div>

        <p className="text-[13px] text-center px-4 mb-6 text-text-tertiary">
          If no merchant accepts within {Math.ceil(matchingTimeLeft / 60)} minutes, your order will be moved to timeout.
        </p>

        {/* Bottom Actions */}
        <div className="space-y-3">
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setScreen("home")}
            className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-accent text-accent-text"
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
              className="flex-1 py-3 rounded-xl text-[13px] font-medium bg-surface-card text-text-secondary border border-border-subtle"
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
              className="flex-1 py-3 rounded-xl text-[13px] font-medium bg-[rgba(239,68,68,0.08)] text-[#dc2626] border border-[rgba(239,68,68,0.15)]"
            >
              Cancel Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
