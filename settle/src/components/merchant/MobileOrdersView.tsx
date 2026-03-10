"use client";

import { motion } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Activity,
  MessageCircle,
  DollarSign,
  ArrowRight,
  Crown,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { UserBadge } from "@/components/merchant/UserBadge";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import type { Order } from "@/types/merchant";

export interface MobileOrdersViewProps {
  pendingOrders: Order[];
  bigOrders: { id: string; user: string; emoji: string; premium: number; message: string; currency: string; amount: number; timestamp: Date }[];
  onAcceptOrder: (order: Order) => void;
  onOpenChat: (order: Order) => void;
  onDismissBigOrder: (id: string) => void;
  setMobileView: (view: 'orders' | 'escrow' | 'chat' | 'history' | 'marketplace') => void;
}

export function MobileOrdersView({
  pendingOrders,
  bigOrders,
  onAcceptOrder,
  onOpenChat,
  onDismissBigOrder,
  setMobileView,
}: MobileOrdersViewProps) {
  return (
    <div className="space-y-1">
      {/* Big Orders Section */}
      {bigOrders.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 py-2 border-b border-white/6">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-white/70" />
              <span className="text-xs font-mono text-white/70 uppercase tracking-wide">Whale Orders</span>
            </div>
            <span className="px-2 py-0.5 bg-white/10 text-white/70 text-[10px] font-bold rounded-full">
              {bigOrders.length}
            </span>
          </div>
          <div className="divide-y divide-amber-500/10">
            {bigOrders.slice(0, 3).map((order) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-2 py-3 bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/6 flex items-center justify-center">
                    <span className="text-lg">{order.emoji}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{order.user}</span>
                      {order.premium > 0 && (
                        <span className="px-1.5 py-0.5 bg-white/10 text-white text-[10px] font-mono rounded">
                          +{order.premium}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{order.message}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white/70">
                      {order.currency === 'AED' ? '\u062F.\u0625' : '$'}{order.amount.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {order.timestamp.toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 ml-13">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      // TODO: Handle big order acceptance
                    }}
                    className="flex-1 h-8 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white/70 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    Contact
                  </motion.button>
                  <button
                    onClick={() => onDismissBigOrder(order.id)}
                    className="h-8 w-8 border border-white/10 hover:border-red-500/30 hover:bg-red-500/10 rounded-lg flex items-center justify-center transition-colors group"
                  >
                    <X className="w-4 h-4 text-gray-500 group-hover:text-red-400" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
          {bigOrders.length > 3 && (
            <button className="w-full py-2 text-xs text-white/40 hover:text-white/70 transition-colors">
              View all {bigOrders.length} whale orders
            </button>
          )}
        </div>
      )}

      {/* Header Row */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <motion.div
            className="w-2 h-2 rounded-full bg-white/60"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <span className="text-xs font-mono text-gray-400 uppercase tracking-wide">Pending</span>
        </div>
        <span className="text-xs font-mono text-gray-400">{pendingOrders.length}</span>
      </div>

      {pendingOrders.length > 0 ? (
        <div className="divide-y divide-white/[0.04]">
          {pendingOrders.map((order) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-2 py-3 hover:bg-white/[0.02] transition-colors"
            >
              {/* Main Row */}
              <div className="flex items-center gap-3">
                {/* User Avatar */}
                <UserBadge name={order.user} emoji={order.emoji} size="md" showName={false} />

                {/* User & Amount */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{order.user}</span>
                    {order.orderType && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        order.orderType === 'buy'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {order.orderType === 'buy' ? 'SELL' : 'BUY'}
                      </span>
                    )}
                    {order.myRole && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        order.myRole === 'buyer'
                          ? 'bg-blue-500/20 text-blue-400'
                          : order.myRole === 'seller'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {order.myRole === 'buyer' ? 'YOU BUY' : order.myRole === 'seller' ? 'YOU SELL' : ''}
                      </span>
                    )}
                    {order.spreadPreference && (
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        order.spreadPreference === 'fastest' ? 'bg-red-400' :
                        order.spreadPreference === 'cheap' ? 'bg-orange-400' : 'bg-orange-500'
                      }`} title={order.spreadPreference} />
                    )}
                    {order.isMyOrder && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">YOURS</span>
                    )}
                    {order.isNew && !order.isMyOrder && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white/5 text-white/70 rounded">NEW</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-mono text-gray-400">
                      {order.amount.toLocaleString()} <span className="text-gray-600">USDC</span>
                    </span>
                    <ArrowRight className="w-3 h-3 text-gray-600" />
                    <span className="text-xs font-mono text-gray-400">
                      {order.total.toLocaleString()} <span className="text-gray-600">AED</span>
                    </span>
                  </div>
                </div>

                {/* Timer & Earnings */}
                <div className="text-right">
                  {order.isMyOrder ? (
                    <span className="text-[10px] font-mono text-orange-400/70">Waiting...</span>
                  ) : (
                    <>
                      <div className="text-[10px] font-mono text-white">+${Math.round(order.amount * 0.005)}</div>
                      <div className={`text-xs font-mono ${order.expiresIn < 30 ? "text-red-400" : "text-gray-500"}`}>
                        {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Escrow TX Link for sell orders */}
              {order.escrowTxHash && order.orderType === 'sell' && (
                <div className="flex items-center gap-2 mt-2 ml-11">
                  <a
                    href={getSolscanTxUrl(order.escrowTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 py-1.5 px-2 bg-white/5 rounded-lg text-[10px] font-mono text-white hover:bg-white/10 transition-colors"
                  >
                    <Shield className="w-3 h-3" />
                    <span>View TX</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {order.escrowPda && (
                    <a
                      href={getBlipscanTradeUrl(order.escrowPda)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 py-1.5 px-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-[10px] font-mono text-orange-400 hover:bg-orange-500/15 transition-colors"
                    >
                      <span>BlipScan</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Action Row */}
              <div className="flex items-center gap-2 mt-2.5 pl-11">
                {!order.isMyOrder && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onAcceptOrder(order)}
                    className="flex-1 h-11 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Go
                  </motion.button>
                )}
                <button
                  onClick={() => { onOpenChat(order); setMobileView('chat'); }}
                  className={`h-11 w-11 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors ${order.isMyOrder ? 'flex-1' : ''}`}
                >
                  <MessageCircle className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
          <Activity className="w-8 h-8 mb-2 opacity-20" />
          <p className="text-xs text-gray-500 font-mono">Waiting for orders...</p>
        </div>
      )}
    </div>
  );
}
