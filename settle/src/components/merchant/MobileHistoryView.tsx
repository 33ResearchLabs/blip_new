"use client";

import { motion } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Activity,
  TrendingUp,
  ArrowRight,
  ExternalLink,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { UserBadge } from "@/components/merchant/UserBadge";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import type { Order } from "@/types/merchant";

export interface MobileHistoryViewProps {
  completedOrders: Order[];
  cancelledOrders: Order[];
  merchantId: string | null;
  merchantInfo: any;
  historyTab: 'completed' | 'cancelled' | 'stats';
  setHistoryTab: (tab: 'completed' | 'cancelled' | 'stats') => void;
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  onShowAnalytics: () => void;
  onShowWalletModal: () => void;
  onLogout: () => void;
}

export function MobileHistoryView({
  completedOrders,
  cancelledOrders,
  merchantId,
  merchantInfo,
  historyTab,
  setHistoryTab,
  effectiveBalance,
  totalTradedVolume,
  todayEarnings,
  pendingEarnings,
  onShowAnalytics,
  onShowWalletModal,
  onLogout,
}: MobileHistoryViewProps) {
  return (
    <div className="space-y-4">
      {/* History Tabs */}
      <div className="flex bg-white/[0.03] rounded-xl p-1">
        <button
          onClick={() => setHistoryTab('completed')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            historyTab === 'completed'
              ? 'bg-white/10 text-white'
              : 'text-gray-500'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          Done
          {completedOrders.length > 0 && (
            <span className="px-1.5 py-0.5 bg-white/10 text-white text-[10px] rounded-full">
              {completedOrders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setHistoryTab('cancelled')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            historyTab === 'cancelled'
              ? 'bg-red-500/20 text-red-400'
              : 'text-gray-500'
          }`}
        >
          <X className="w-3.5 h-3.5" />
          Cancelled
        </button>
        <button
          onClick={() => setHistoryTab('stats')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            historyTab === 'stats'
              ? 'bg-white/10 text-white'
              : 'text-gray-500'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Stats
        </button>
      </div>

      {/* Completed Orders Tab */}
      {historyTab === 'completed' && (
        <>
          {completedOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-neutral-600" />
              </div>
              <p className="text-sm font-medium text-white mb-1">No completed trades yet</p>
              <p className="text-xs text-neutral-500">Your completed transactions will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completedOrders.map((order) => {
                const isM2MHistory = order.isM2M || !!order.buyerMerchantId;
                const didReceive = isM2MHistory ? order.buyerMerchantId === merchantId : order.dbOrder?.type === 'sell';
                return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]"
                >
                  <div className="flex items-center gap-3">
                    <UserBadge name={order.user} emoji={order.emoji} size="lg" showName={false} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{order.user}</p>
                        {isM2MHistory && (
                          <span className="px-1.5 py-0.5 bg-white/5 text-white/70 text-[10px] rounded">M2M</span>
                        )}
                        {order.myRole && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded font-medium bg-black text-white border border-white/10">
                            {order.myRole === 'buyer' ? 'RECEIVER' : 'SENDER'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {didReceive ? 'Received' : 'Sent'} &bull; {order.timestamp.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${didReceive ? 'text-orange-400' : 'text-white/50'}`}>
                        {didReceive ? '+' : '-'}{order.amount.toLocaleString()} USDC
                      </p>
                      <p className="text-xs text-gray-500">+${(order.amount * 0.005).toFixed(2)}</p>
                    </div>
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  {order.escrowTxHash && (
                    <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(order.escrowTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View TX
                      </a>
                      {order.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(order.escrowPda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-orange-400/70 hover:text-orange-400 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          BlipScan
                        </a>
                      )}
                    </div>
                  )}
                </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Cancelled Orders Tab */}
      {historyTab === 'cancelled' && (
        <>
          {cancelledOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                <X className="w-8 h-8 text-neutral-600" />
              </div>
              <p className="text-sm font-medium text-white mb-1">No cancelled trades</p>
              <p className="text-xs text-neutral-500">Cancelled or disputed orders will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cancelledOrders.map((order) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-white/[0.03] rounded-xl border border-red-500/10"
                >
                  <div className="flex items-center gap-3">
                    <UserBadge name={order.user} emoji={order.emoji} size="lg" showName={false} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{order.user}</p>
                        {order.status === 'disputed' && (
                          <span className="px-1.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded">DISPUTED</span>
                        )}
                        {order.isM2M && (
                          <span className="px-1.5 py-0.5 bg-white/5 text-white/70 text-[10px] rounded">M2M</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {order.orderType === 'buy' ? 'Send' : 'Receive'} &bull; {order.timestamp.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">${order.amount.toLocaleString()}</p>
                      <p className="text-xs text-red-400">
                        {order.status === 'disputed' ? 'In dispute' : 'Cancelled'}
                      </p>
                    </div>
                    <X className="w-5 h-5 text-red-400" />
                  </div>
                  {order.dbOrder?.cancellation_reason && (
                    <div className="mt-3 pt-3 border-t border-white/[0.04]">
                      <p className="text-[10px] text-gray-500">
                        Reason: {order.dbOrder.cancellation_reason}
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Stats Tab */}
      {historyTab === 'stats' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wide">Trading Stats</h3>
            <button
              onClick={onShowAnalytics}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/5 text-white rounded-lg text-xs font-medium"
            >
              <TrendingUp className="w-3 h-3" />
              Full Analytics
            </button>
          </div>

          <button
            onClick={onShowWalletModal}
            className="w-full p-4 bg-white/[0.04] rounded-xl border border-white/[0.08] text-left"
          >
            <p className="text-xs text-white/70 mb-1">USDT Balance</p>
            <p className="text-xl font-bold text-white/70">
              {effectiveBalance !== null
                ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                : "Loading..."}
            </p>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-xs text-gray-500 mb-1">Today&apos;s Volume</p>
              <p className="text-xl font-bold">${totalTradedVolume.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/6">
              <p className="text-xs text-white mb-1">Earnings</p>
              <p className="text-xl font-bold text-white">+${Math.round(todayEarnings)}</p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/6">
              <p className="text-xs text-white/70 mb-1">Pending</p>
              <p className="text-xl font-bold text-white/70">+${Math.round(pendingEarnings)}</p>
            </div>
            <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-xs text-gray-500 mb-1">Trades</p>
              <p className="text-xl font-bold">{completedOrders.length}</p>
            </div>
          </div>

          {/* Account Section */}
          <div className="mt-4 pt-4 border-t border-white/[0.04]">
            <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wide mb-3">Account</h3>
            <div className="space-y-2">
              <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                <div className="flex items-center gap-3">
                  <UserBadge
                    name={merchantInfo?.username || merchantInfo?.display_name || 'Merchant'}
                    avatarUrl={merchantInfo?.avatar_url}
                    merchantId={merchantId || undefined}
                    size="lg"
                    showName={false}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{merchantInfo?.username || merchantInfo?.display_name || 'Merchant'}</p>
                    <p className="text-xs text-gray-500">{merchantInfo?.rating?.toFixed(2) || '5.00'} &middot; {merchantInfo?.total_trades || 0} trades</p>
                  </div>
                </div>
              </div>
              <Link
                href="/merchant/settings"
                className="w-full flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.04] hover:bg-white/[0.06] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-white/40" />
                  <span className="text-sm font-medium text-white/70">Settings & Profile</span>
                </div>
                <ArrowRight className="w-4 h-4 text-white/20" />
              </Link>
              {merchantId && (
                <Link
                  href={`/merchant/profile/${merchantId}`}
                  className="w-full flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.04] hover:bg-white/[0.06] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <ExternalLink className="w-4 h-4 text-white/40" />
                    <span className="text-sm font-medium text-white/70">View Public Profile</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-white/20" />
                </Link>
              )}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 rounded-xl border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <LogOut className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">Disconnect & Logout</span>
              </motion.button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
