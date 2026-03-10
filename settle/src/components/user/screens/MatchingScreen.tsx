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
    <>
      <div className="h-12" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <button onClick={() => setScreen("home")} className="p-2 -ml-2">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="text-[17px] font-semibold text-white">Order Placed</h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 px-5 overflow-auto smooth-scroll">
        {/* Amount Display */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center py-8"
        >
          <p className="text-[13px] text-neutral-500 mb-2">You&apos;re buying</p>
          <div className="flex items-baseline justify-center gap-2">
            <p className="text-[36px] font-semibold text-white tracking-tight">{pendingTradeData.amount}</p>
            <p className="text-[17px] text-neutral-400">USDC</p>
          </div>
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-4 inline-flex items-center gap-2 glass-card rounded-full px-4 py-2"
          >
            <span className="text-[13px] text-neutral-500">for</span>
            <span className="text-[15px] font-medium text-white">{'\u062F.\u0625'} {parseFloat(pendingTradeData.fiatAmount).toLocaleString()}</span>
          </motion.div>
        </motion.div>

        {/* Status */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="glass-card rounded-2xl p-4 mb-4"
        >
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-neutral-800">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center relative">
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white/6"
                animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <motion.div
                className="w-3 h-3 rounded-full bg-white/10"
                animate={{ scale: [1, 0.8, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <div>
              <p className="text-[15px] font-medium text-white">Finding a merchant</p>
              <p className="text-[13px] text-neutral-500">We&apos;ll notify you when ready</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-black" />
              </div>
              <p className="text-[14px] text-white">Order submitted</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-neutral-600 flex items-center justify-center flex-shrink-0">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-neutral-400"
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
              <p className="text-[14px] text-neutral-400">Matching with merchant</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-neutral-800 flex-shrink-0" />
              <p className="text-[14px] text-neutral-600">Ready to pay</p>
            </div>
          </div>
        </motion.div>

        {/* Countdown Timer */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="glass-card rounded-2xl p-5 mb-4 text-center"
        >
          <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-2">Time remaining</p>
          <div className="flex items-center justify-center gap-2">
            <Clock className={`w-5 h-5 ${matchingTimeLeft < 60 ? 'text-red-400' : matchingTimeLeft < 180 ? 'text-white/70' : 'text-white/70'}`} />
            <p className={`text-[28px] font-semibold tracking-tight ${matchingTimeLeft < 60 ? 'text-red-400' : matchingTimeLeft < 180 ? 'text-white/70' : 'text-white'}`}>
              {formatTimeLeft(matchingTimeLeft)}
            </p>
          </div>
          {matchingTimeLeft < 180 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[12px] text-white/70 mt-2"
            >
              {matchingTimeLeft < 60 ? 'Order will expire soon!' : 'Hurry! Time is running out'}
            </motion.p>
          )}
          <div className="w-full h-1 bg-neutral-800 rounded-full mt-3 overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${matchingTimeLeft < 60 ? 'bg-red-500' : matchingTimeLeft < 180 ? 'bg-white/10' : 'bg-white/10'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${(matchingTimeLeft / (15 * 60)) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>

        {/* Info */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Payment</p>
            <p className="text-[15px] font-medium text-white capitalize">{pendingTradeData.paymentMethod}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Rate</p>
            <p className="text-[15px] font-medium text-white">{currentRate} AED</p>
          </div>
        </div>

        <p className="text-[13px] text-neutral-600 text-center px-4">
          If no merchant accepts within {Math.ceil(matchingTimeLeft / 60)} minutes, your order will be moved to timeout.
        </p>
      </div>

      {/* Bottom Actions */}
      <div className="px-5 pb-10 pt-4 space-y-3">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => setScreen("home")}
          className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-white/10 text-white"
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
            className="flex-1 py-3 rounded-xl text-[13px] font-medium bg-neutral-900 text-neutral-400"
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
            className="flex-1 py-3 rounded-xl text-[13px] font-medium bg-neutral-900 text-neutral-500"
          >
            Cancel Order
          </button>
        </div>
      </div>
    </>
  );
};
