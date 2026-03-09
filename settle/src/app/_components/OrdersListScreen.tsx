"use client";

import { motion } from "framer-motion";
import { Check, Clock } from "lucide-react";
import AmbientGlow from "@/components/user/shared/AmbientGlow";
import type { Order } from "@/types/user";

interface OrdersListScreenProps {
  maxW: string;
  setScreen: (s: any) => void;
  setActiveOrderId: (id: string) => void;
  activityTab: 'active' | 'completed';
  setActivityTab: (t: 'active' | 'completed') => void;
  pendingOrders: Order[];
  completedOrders: Order[];
  timerTick: number;
}

export function OrdersListScreen({
  maxW, setScreen, setActiveOrderId, activityTab, setActivityTab,
  pendingOrders, completedOrders, timerTick,
}: OrdersListScreenProps) {
  // timerTick forces re-render for countdown timers
  void timerTick;
  return (
          <motion.div
            key="orders"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
            style={{ background: '#06060e' }}
          >
            <AmbientGlow />
            <div className="h-12" />

            <div className="px-5 py-4 z-10">
              <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 4 }}>Activity</p>
              <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>Orders</h1>
            </div>

            {/* Activity Tabs */}
            <div className="px-5 mb-4 z-10">
              <div className="flex rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <button
                  onClick={() => setActivityTab('active')}
                  className="flex-1 py-2.5 rounded-lg text-[12px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                  style={activityTab === 'active'
                    ? { background: 'rgba(255,255,255,0.06)', color: '#fff' }
                    : { color: 'rgba(255,255,255,0.25)' }
                  }
                >
                  <motion.div
                    className="w-2 h-2 rounded-full"
                    style={{ background: 'rgba(124,58,237,0.5)' }}
                    animate={activityTab === 'active' ? { scale: [1, 1.3, 1] } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  Active
                  {pendingOrders.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full"
                      style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>
                      {pendingOrders.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActivityTab('completed')}
                  className="flex-1 py-2.5 rounded-lg text-[12px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                  style={activityTab === 'completed'
                    ? { background: 'rgba(255,255,255,0.06)', color: '#fff' }
                    : { color: 'rgba(255,255,255,0.25)' }
                  }
                >
                  <Check className="w-3.5 h-3.5" />
                  Completed
                  {completedOrders.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-white/10 text-white text-[10px] rounded-full">
                      {completedOrders.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 px-5 pb-24 overflow-y-auto">
              {/* Active Orders Tab */}
              {activityTab === 'active' && (
                <>
                  {pendingOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-20">
                      <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                        <Clock className="w-8 h-8 text-neutral-600" />
                      </div>
                      <p className="text-[17px] font-medium text-white mb-1">No active trades</p>
                      <p className="text-[15px] text-neutral-500">Start a new trade from the home screen</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pendingOrders.map(order => (
                        <motion.button
                          key={order.id}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            setActiveOrderId(order.id);
                            setScreen("order");
                          }}
                          className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center gap-3"
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5">
                            <motion.div
                              className="w-2 h-2 rounded-full bg-white/10"
                              animate={{ scale: [1, 1.3, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                            />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-[15px] font-medium text-white">
                              {order.type === "buy" ? "Buying" : "Selling"} ${order.cryptoAmount} USDC
                            </p>
                            <p className="text-[13px] text-neutral-500">
                              د.إ {parseFloat(order.fiatAmount).toLocaleString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[13px] font-medium text-white/70">
                              Step {order.step}/4
                            </p>
                            {order.dbStatus === 'pending' && order.expiresAt ? (
                              <p className={`text-[11px] font-mono ${
                                Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000)) < 60
                                  ? "text-red-400"
                                  : "text-white/70"
                              }`}>
                                {(() => {
                                  const secs = Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000));
                                  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
                                })()}
                              </p>
                            ) : (
                              <p className="text-[11px] text-neutral-600">{order.createdAt.toLocaleDateString()}</p>
                            )}
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
                    <div className="flex-1 flex flex-col items-center justify-center py-20">
                      <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                        <Check className="w-8 h-8 text-neutral-600" />
                      </div>
                      <p className="text-[17px] font-medium text-white mb-1">No completed trades</p>
                      <p className="text-[15px] text-neutral-500">Your completed transactions will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {completedOrders.map(order => (
                        <motion.button
                          key={order.id}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            setActiveOrderId(order.id);
                            setScreen("order");
                          }}
                          className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center gap-3"
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5">
                            <Check className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-[15px] font-medium text-white">
                              {order.type === "buy" ? "Bought" : "Sold"} ${order.cryptoAmount} USDC
                            </p>
                            <p className="text-[13px] text-neutral-500">
                              د.إ {parseFloat(order.fiatAmount).toLocaleString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[13px] font-medium text-white">Completed</p>
                            <p className="text-[11px] text-neutral-600">{order.createdAt.toLocaleDateString()}</p>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

          </motion.div>
  );
}
