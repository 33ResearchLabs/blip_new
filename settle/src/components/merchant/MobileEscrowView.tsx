"use client";

import { motion } from "framer-motion";
import {
  Lock,
  MessageCircle,
  ArrowRight,
  AlertTriangle,
  Clock,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { UserBadge } from "@/components/merchant/UserBadge";
import { ActionPulse } from "@/components/NotificationToast";
import type { Order } from "@/types/merchant";
import { CopyableBankDetails } from "@/components/shared/CopyableBankDetails";

export interface MobileEscrowViewProps {
  ongoingOrders: Order[];
  markingDone: boolean;
  onOpenEscrowModal: (order: Order) => void;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (order: Order) => void;
  onOpenDisputeModal: (orderId: string) => void;
  onOpenCancelModal: (order: Order) => void;
  onOpenChat: (order: Order) => void;
  setMobileView: (view: 'orders' | 'escrow' | 'chat' | 'history' | 'marketplace') => void;
}

export function MobileEscrowView({
  ongoingOrders,
  markingDone,
  onOpenEscrowModal,
  onMarkFiatPaymentSent,
  onConfirmPayment,
  onOpenDisputeModal,
  onOpenCancelModal,
  onOpenChat,
  setMobileView,
}: MobileEscrowViewProps) {
  return (
    <div className="space-y-1">
      {/* Header Row */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-white/70" />
          <span className="text-xs font-mono text-foreground/40 uppercase tracking-wide">Escrow</span>
        </div>
        <span className="text-xs font-mono text-white/70">{ongoingOrders.length}</span>
      </div>

      {ongoingOrders.length > 0 ? (
        <div className="divide-y divide-white/[0.04]">
          {ongoingOrders.map((order) => {
            const mobileDbStatus = order.dbOrder?.minimal_status || order.dbOrder?.status;
            const mobileCanComplete = mobileDbStatus === "payment_confirmed";
            const mobileRole = order.myRole || 'observer';
            const mobileCanConfirmPayment = mobileDbStatus === "payment_sent" && mobileRole === 'seller';
            const mobileWaitingForUser = false;
            const mobileHasBeenAccepted = !!order.dbOrder?.accepted_at;
            const mobileCanMarkPaid = mobileRole === 'buyer' && (
              (mobileDbStatus === "escrowed" && mobileHasBeenAccepted && order.escrowTxHash)
            );
            const mobileNeedsLockEscrow = mobileDbStatus === "accepted" && !order.escrowTxHash && mobileRole === 'seller';

            return (
            <motion.div
              key={order.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-2 py-3 hover:bg-card transition-colors"
            >
              {/* Main Row */}
              <div className="flex items-center gap-3">
                <UserBadge name={order.user} emoji={order.emoji} size="md" showName={false} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{order.user}</span>
                    {order.orderType && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        order.orderType === 'buy'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-primary/20 text-primary'
                      }`}>
                        {order.orderType === 'buy' ? 'SEND' : 'RECEIVE'}
                      </span>
                    )}
                    {order.myRole && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        order.myRole === 'buyer'
                          ? 'bg-blue-500/20 text-blue-400'
                          : order.myRole === 'seller'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-gray-500/20 text-foreground/40'
                      }`}>
                        {order.myRole === 'buyer' ? 'YOU RECEIVE' : order.myRole === 'seller' ? 'YOU SEND' : ''}
                      </span>
                    )}
                    {order.spreadPreference && (
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        order.spreadPreference === 'fastest' ? 'bg-red-400' :
                        order.spreadPreference === 'cheap' ? 'bg-primary' : 'bg-primary'
                      }`} title={order.spreadPreference} />
                    )}
                    {mobileCanMarkPaid && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-mono"><ActionPulse size="sm" />SEND</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-mono text-foreground/40">
                      {order.amount.toLocaleString()} <span className="text-gray-600">USDC</span>
                    </span>
                    <ArrowRight className="w-3 h-3 text-gray-600" />
                    <span className="text-xs font-mono text-foreground/40">
                      {order.total.toLocaleString()} <span className="text-gray-600">AED</span>
                    </span>
                  </div>
                  {mobileCanMarkPaid && (() => {
                    // Priority 1: Locked payment method (new system)
                    if (order.lockedPaymentMethod) {
                      const lpm = order.lockedPaymentMethod;
                      return (
                        <div className="mt-1.5 text-[10px] text-white/50 font-mono space-y-0.5">
                          <div className="truncate text-primary">&rarr; {lpm.label} ({lpm.type.toUpperCase()})</div>
                          {lpm.type === 'bank' && lpm.details.iban && <div className="truncate">{lpm.details.iban}</div>}
                          {lpm.type === 'upi' && lpm.details.upi_id && <div className="truncate">{lpm.details.upi_id}</div>}
                        </div>
                      );
                    }
                    // Fallback: seller's bank details (from offer) for M2M, or user's bank for U2M
                    const bankDetails = order.sellerBankDetails || order.userBankDetails;
                    if (bankDetails) {
                      return (
                        <div className="mt-1.5 text-[10px] text-white/50 font-mono space-y-0.5">
                          <div className="truncate">&rarr; {bankDetails.bank_name}</div>
                          <div className="truncate">{bankDetails.account_name}</div>
                          <div className="truncate">{bankDetails.iban}</div>
                        </div>
                      );
                    }
                    if (order.userBankAccount) {
                      return (
                        <div className="mt-1 text-[10px] text-white/50 font-mono truncate">
                          &rarr; {order.userBankAccount}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="flex items-center gap-1.5 text-white/70">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-xs font-mono">
                    {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                  </span>
                </div>
              </div>

              {/* Last human message preview */}
              {order.lastHumanMessage && (
                <div className="flex items-center gap-1.5 mt-1.5 pl-11 cursor-pointer" onClick={() => { onOpenChat(order); setMobileView('chat'); }}>
                  <MessageCircle className="w-3 h-3 text-foreground/35 shrink-0" />
                  <span className="text-[10px] text-foreground/40 truncate flex-1">
                    {order.lastHumanMessageSender === 'merchant' ? 'You: ' : ''}{order.lastHumanMessage.length > 40 ? order.lastHumanMessage.slice(0, 40) + '...' : order.lastHumanMessage}
                  </span>
                  {(order.unreadCount || 0) > 0 && (
                    <span className="w-4 h-4 bg-primary rounded-full text-[9px] font-bold flex items-center justify-center text-background shrink-0">
                      {order.unreadCount! > 9 ? '9+' : order.unreadCount}
                    </span>
                  )}
                </div>
              )}

              {/* Action Row */}
              <div className="flex items-center gap-2 mt-2.5 pl-11">
                {mobileNeedsLockEscrow ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onOpenEscrowModal(order)}
                    className="flex-1 h-11 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-xs font-medium text-primary flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Lock Escrow
                  </motion.button>
                ) : mobileCanMarkPaid ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onMarkFiatPaymentSent(order)}
                    disabled={markingDone}
                    className="flex-1 h-11 bg-white/5 hover:bg-accent-subtle border border-white/6 rounded-lg text-xs font-medium text-white/70 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {markingDone ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Accepting...</>
                    ) : (
                      <>I&apos;ve Paid</>
                    )}
                  </motion.button>
                ) : mobileWaitingForUser ? (
                  <span className="flex-1 h-11 bg-white/5 border border-white/6 rounded-lg text-xs font-mono text-white/70 flex items-center justify-center">
                    Awaiting user
                  </span>
                ) : (mobileCanConfirmPayment || mobileCanComplete) ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onConfirmPayment(order)}
                    className="flex-1 h-11 bg-white/10 hover:bg-accent-subtle border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Confirm Payment
                  </motion.button>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onConfirmPayment(order)}
                    className="flex-1 h-11 bg-white/10 hover:bg-accent-subtle border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Confirm Payment
                  </motion.button>
                )}
                <button
                  onClick={() => { onOpenChat(order); setMobileView('chat'); }}
                  className="relative h-11 w-11 border border-white/10 hover:border-border-strong rounded-lg flex items-center justify-center transition-colors"
                >
                  <MessageCircle className="w-4 h-4 text-foreground/40" />
                  {(order.unreadCount || 0) > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full text-[9px] font-bold flex items-center justify-center text-background">
                      {order.unreadCount! > 9 ? '9+' : order.unreadCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onOpenDisputeModal(order.id)}
                  className="h-11 w-11 border border-white/10 hover:border-[var(--color-error)]/30 rounded-lg flex items-center justify-center transition-colors group"
                >
                  <AlertTriangle className="w-4 h-4 text-foreground/40 group-hover:text-[var(--color-error)]" />
                </button>
                {order.dbOrder?.status === "escrowed" && order.orderType === "buy" && order.escrowCreatorWallet && (
                  <button
                    onClick={() => onOpenCancelModal(order)}
                    className="h-11 w-11 border border-white/10 hover:border-border rounded-lg flex items-center justify-center transition-colors group"
                    title="Cancel & Withdraw"
                  >
                    <RotateCcw className="w-4 h-4 text-foreground/40 group-hover:text-foreground/70" />
                  </button>
                )}
              </div>
            </motion.div>
          )})}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
          <Lock className="w-8 h-8 mb-2 opacity-20" />
          <p className="text-xs text-foreground/35 font-mono">No active escrows</p>
        </div>
      )}
    </div>
  );
}
