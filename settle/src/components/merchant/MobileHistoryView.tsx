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
  Wallet,
  DollarSign,
  Clock,
  Star,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { UserBadge } from "@/components/merchant/UserBadge";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { formatCrypto } from "@/lib/format";
import type { Order } from "@/types/merchant";
import type { LucideIcon } from "lucide-react";

// Reusable stat tile for the Stats tab — small icon chip in the corner,
// label/sublabel row, big value with a small unit suffix. Keeps the four
// cards visually consistent so the grid reads as a single block.
function StatCard({
  icon: Icon,
  accent,
  accentBg,
  label,
  sublabel,
  value,
  suffix,
  valueClass,
}: {
  icon: LucideIcon;
  accent: string;
  accentBg: string;
  label: string;
  sublabel?: string;
  value: string;
  suffix?: string;
  valueClass?: string;
}) {
  return (
    <div className="p-3.5 bg-white/[0.03] rounded-xl border border-white/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-foreground/40">
          {label}
          {sublabel && (
            <span className="ml-1 text-foreground/25">({sublabel})</span>
          )}
        </span>
        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${accentBg}`}>
          <Icon className={`w-3 h-3 ${accent}`} strokeWidth={2.5} />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-lg font-extrabold tabular-nums tracking-tight ${valueClass ?? "text-white"}`}>
          {value}
        </span>
        {suffix && (
          <span className="text-[10px] text-foreground/40 font-medium uppercase tracking-wide">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

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
  // Tap handler for a history card — opens the merchant's order quick-view
  // popup so the user can read the full order details. Same callback the
  // desktop pending / in-progress panels use.
  onSelectOrder?: (order: Order) => void;
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
  onSelectOrder,
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
              : 'text-foreground/35'
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
              : 'text-foreground/35'
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
              : 'text-foreground/35'
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
                  onClick={() => onSelectOrder?.(order)}
                  role={onSelectOrder ? "button" : undefined}
                  tabIndex={onSelectOrder ? 0 : undefined}
                  className={`p-4 bg-white/[0.03] rounded-xl border border-white/[0.04] ${
                    onSelectOrder ? "cursor-pointer hover:bg-white/[0.05] transition-colors" : ""
                  }`}
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
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                            order.myRole === 'buyer'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {order.myRole === 'buyer' ? 'RECEIVER' : 'SENDER'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground/35">
                        {didReceive ? 'Received' : 'Sent'} &bull; {order.timestamp.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${didReceive ? 'text-primary' : 'text-white/50'}`}>
                        {didReceive ? '+' : '-'}{order.amount.toLocaleString()} USDT
                      </p>
                      <p className="text-xs text-foreground/35">+${(order.amount * 0.005).toFixed(2)}</p>
                    </div>
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  {order.escrowTxHash && (
                    <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-3">
                      <a
                        href={getSolscanTxUrl(order.escrowTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-[10px] text-foreground/35 hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View TX
                      </a>
                      {order.escrowPda && (
                        <a
                          href={getBlipscanTradeUrl(order.escrowPda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors"
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
                  onClick={() => onSelectOrder?.(order)}
                  role={onSelectOrder ? "button" : undefined}
                  tabIndex={onSelectOrder ? 0 : undefined}
                  className={`p-4 bg-white/[0.03] rounded-xl border border-red-500/10 ${
                    onSelectOrder ? "cursor-pointer hover:bg-white/[0.05] transition-colors" : ""
                  }`}
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
                      <p className="text-xs text-foreground/35">
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
                      <p className="text-[10px] text-foreground/35">
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
          {/* Section header */}
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-foreground/40 uppercase tracking-wider">
              Trading Stats
            </h3>
            <button
              onClick={onShowAnalytics}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/70 rounded-lg text-[11px] font-semibold transition-colors"
            >
              <TrendingUp className="w-3 h-3" />
              Full Analytics
            </button>
          </div>

          {/* Hero — wallet balance. Slight gradient + Wallet icon so it
              reads as the primary number on the page. */}
          <button
            onClick={onShowWalletModal}
            className="w-full text-left rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/[0.10] via-foreground/[0.03] to-transparent p-5 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-foreground/40">
                <Wallet className="w-3 h-3" />
                Wallet Balance
              </span>
              <ChevronRight className="w-4 h-4 text-foreground/30" />
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-3xl font-extrabold text-white tabular-nums tracking-tight">
                {effectiveBalance !== null ? formatCrypto(effectiveBalance) : "—"}
              </span>
              <span className="text-sm text-foreground/40 font-medium">USDT</span>
            </div>
          </button>

          {/* 2×2 stat grid — consistent card style with a small accent
              icon and color per metric. Values use the USDT suffix
              (these are USDT amounts, not USD). */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={TrendingUp}
              accent="text-foreground/70"
              accentBg="bg-foreground/[0.06]"
              label="Volume"
              value={formatCrypto(totalTradedVolume)}
              suffix="USDT"
            />
            <StatCard
              icon={DollarSign}
              accent="text-emerald-400"
              accentBg="bg-emerald-500/10"
              label="Earnings"
              sublabel="24h"
              value={`+${formatCrypto(todayEarnings)}`}
              suffix="USDT"
              valueClass="text-emerald-300"
            />
            <StatCard
              icon={Clock}
              accent="text-amber-300"
              accentBg="bg-amber-500/10"
              label="Pending"
              value={`+${formatCrypto(pendingEarnings)}`}
              suffix="USDT"
              valueClass="text-amber-200"
            />
            <StatCard
              icon={Check}
              accent="text-primary"
              accentBg="bg-primary/10"
              label="Completed"
              value={String(completedOrders.length)}
              suffix="trades"
            />
          </div>

          {/* Account Section */}
          <div className="pt-2">
            <h3 className="text-xs font-mono text-foreground/40 uppercase tracking-wider mb-3">
              Account
            </h3>
            <div className="space-y-2">
              <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <UserBadge
                    name={merchantInfo?.username || merchantInfo?.display_name || 'Merchant'}
                    avatarUrl={merchantInfo?.avatar_url}
                    merchantId={merchantId || undefined}
                    size="lg"
                    showName={false}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {merchantInfo?.username || merchantInfo?.display_name || 'Merchant'}
                    </p>
                    <p className="text-[11px] text-foreground/50 flex items-center gap-1 mt-0.5">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span className="font-mono tabular-nums">{merchantInfo?.rating?.toFixed(2) || '5.00'}</span>
                      <span className="text-foreground/30">·</span>
                      <span>{merchantInfo?.total_trades || 0} trades</span>
                    </p>
                  </div>
                </div>
              </div>
              <Link
                href="/merchant/settings"
                className="w-full flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.06] hover:bg-card hover:border-white/[0.10] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
                    <Shield className="w-4 h-4 text-foreground/60" />
                  </div>
                  <span className="text-sm font-medium text-white/80">Settings & Profile</span>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/30" />
              </Link>
              {merchantId && (
                <Link
                  href={`/merchant/profile/${merchantId}`}
                  className="w-full flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.06] hover:bg-card hover:border-white/[0.10] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
                      <ExternalLink className="w-4 h-4 text-foreground/60" />
                    </div>
                    <span className="text-sm font-medium text-white/80">View Public Profile</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground/30" />
                </Link>
              )}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onLogout}
                className="w-full mt-1 flex items-center justify-center gap-2 p-3 bg-red-500/[0.06] rounded-xl border border-red-500/20 hover:bg-[var(--color-error)]/15 transition-colors"
              >
                <LogOut className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold text-red-400">Disconnect & Logout</span>
              </motion.button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
