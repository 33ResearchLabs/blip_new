"use client";

import { motion } from "framer-motion";
import {
  Crown,
  DollarSign,
  X,
  Check,
  ArrowRight,
  Shield,
  ExternalLink,
  Lock,
  Unlock,
  MessageCircle,
  Clock,
  Activity,
  AlertTriangle,
  RotateCcw,
  TrendingUp,
  LogOut,
  Globe,
  Package,
} from "lucide-react";
import Link from "next/link";
import { UserBadge } from "@/components/merchant/UserBadge";
import { ActionPulse } from "@/components/NotificationToast";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { Marketplace } from "@/components/merchant/Marketplace";
import { MyOffers } from "@/components/merchant/MyOffers";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import type { Order } from "@/types/merchant";

export interface MobileOrdersViewProps {
  mobileView: "orders" | "escrow" | "chat" | "history" | "marketplace";
  setMobileView: (view: "orders" | "escrow" | "chat" | "history" | "marketplace") => void;
  bigOrders: any[];
  dismissBigOrder: (id: string) => void;
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];
  cancelledOrders: Order[];
  merchantId: string | null;
  merchantInfo: any;
  historyTab: "completed" | "cancelled" | "stats";
  setHistoryTab: (tab: "completed" | "cancelled" | "stats") => void;
  marketSubTab: "browse" | "offers";
  setMarketSubTab: (tab: "browse" | "offers") => void;
  markingDone: boolean;
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  directChat: any;
  acceptOrder: (order: Order) => Promise<void>;
  handleOpenChat: (order: Order) => void;
  openEscrowModal: (order: Order) => void;
  markFiatPaymentSent: (order: Order) => Promise<void>;
  openReleaseModal: (order: Order) => void;
  openDisputeModal: (orderId: string) => void;
  openCancelModal: (order: Order) => void;
  setShowAnalytics: (show: boolean) => void;
  setShowWalletModal: (show: boolean) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowOpenTradeModal: (show: boolean) => void;
  setOpenTradeForm: (form: any) => void;
  handleLogout: () => void;
  playSound: (...args: any[]) => void;
}

export function MobileOrdersView({
  mobileView,
  setMobileView,
  bigOrders,
  dismissBigOrder,
  pendingOrders,
  ongoingOrders,
  completedOrders,
  cancelledOrders,
  merchantId,
  merchantInfo,
  historyTab,
  setHistoryTab,
  marketSubTab,
  setMarketSubTab,
  markingDone,
  effectiveBalance,
  totalTradedVolume,
  todayEarnings,
  pendingEarnings,
  directChat,
  acceptOrder,
  handleOpenChat,
  openEscrowModal,
  markFiatPaymentSent,
  openReleaseModal,
  openDisputeModal,
  openCancelModal,
  setShowAnalytics,
  setShowWalletModal,
  setShowCreateModal,
  setShowOpenTradeModal,
  setOpenTradeForm,
  handleLogout,
  playSound,
}: MobileOrdersViewProps) {
  return (
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-3 pb-20">
          {/* Mobile: Orders View */}
          {mobileView === 'orders' && (
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
                              {order.currency === 'AED' ? 'د.إ' : '$'}{order.amount.toLocaleString()}
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
                            onClick={() => dismissBigOrder(order.id)}
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
                        <UserBadge name={order.user} avatarUrl={order.userAvatarUrl} emoji={order.emoji} merchantId={order.counterpartyMerchantId} size="md" showName={false} />

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
                            onClick={() => acceptOrder(order)}
                            className="flex-1 h-11 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Go
                          </motion.button>
                        )}
                        <button
                          onClick={() => { handleOpenChat(order); setMobileView('chat'); }}
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
          )}

          {/* Mobile: Escrow View */}
          {mobileView === 'escrow' && (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-white/70" />
                  <span className="text-xs font-mono text-gray-400 uppercase tracking-wide">Escrow</span>
                </div>
                <span className="text-xs font-mono text-white/70">{ongoingOrders.length}</span>
              </div>

              {ongoingOrders.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {ongoingOrders.map((order) => {
                    const mobileDbStatus = order.dbOrder?.minimal_status || order.dbOrder?.status;
                    const mobileCanComplete = mobileDbStatus === "payment_confirmed";
                    // Use myRole for all role-based decisions
                    const mobileRole = order.myRole || 'observer';
                    // Confirm payment: seller confirms when buyer marked paid
                    const mobileCanConfirmPayment = mobileDbStatus === "payment_sent" && mobileRole === 'seller';
                    const mobileWaitingForUser = false; // Simplified flow - no waiting state
                    // "I've Paid": buyer marks payment when escrow is locked
                    const mobileCanMarkPaid = mobileRole === 'buyer' && (
                      (mobileDbStatus === "payment_sent") ||
                      ((mobileDbStatus === "accepted" || mobileDbStatus === "escrowed") && order.escrowTxHash)
                    );
                    // Lock Escrow: accepted, no escrow, I'm the seller
                    const mobileNeedsLockEscrow = mobileDbStatus === "accepted" && !order.escrowTxHash && mobileRole === 'seller';

                    return (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-2 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Main Row */}
                      <div className="flex items-center gap-3">
                        {/* User Avatar */}
                        <UserBadge name={order.user} avatarUrl={order.userAvatarUrl} emoji={order.emoji} merchantId={order.counterpartyMerchantId} size="md" showName={false} />

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
                            {/* Status badge */}
                            {mobileCanMarkPaid && (
                              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded font-mono"><ActionPulse size="sm" />SEND</span>
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
                          {/* Show user's bank account for sell orders waiting for payment */}
                          {mobileCanMarkPaid && order.userBankAccount && (
                            <div className="mt-1 text-[10px] text-white/50 font-mono truncate">
                              → {order.userBankAccount}
                            </div>
                          )}
                        </div>

                        {/* Timer */}
                        <div className="flex items-center gap-1.5 text-white/70">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="text-xs font-mono">
                            {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                      </div>

                      {/* Last human message preview */}
                      {order.lastHumanMessage && (
                        <div className="flex items-center gap-1.5 mt-1.5 pl-11 cursor-pointer" onClick={() => { handleOpenChat(order); setMobileView('chat'); }}>
                          <MessageCircle className="w-3 h-3 text-gray-500 shrink-0" />
                          <span className="text-[10px] text-gray-400 truncate flex-1">
                            {order.lastHumanMessageSender === 'merchant' ? 'You: ' : ''}{order.lastHumanMessage.length > 40 ? order.lastHumanMessage.slice(0, 40) + '...' : order.lastHumanMessage}
                          </span>
                          {(order.unreadCount || 0) > 0 && (
                            <span className="w-4 h-4 bg-orange-500 rounded-full text-[9px] font-bold flex items-center justify-center text-black shrink-0">
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
                            onClick={() => openEscrowModal(order)}
                            className="flex-1 h-11 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg text-xs font-medium text-orange-400 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            Lock Escrow
                          </motion.button>
                        ) : mobileCanMarkPaid ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => markFiatPaymentSent(order)}
                            disabled={markingDone}
                            className="flex-1 h-11 bg-white/5 hover:bg-white/10 border border-white/6 rounded-lg text-xs font-medium text-white/70 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            I&apos;ve Paid
                          </motion.button>
                        ) : mobileWaitingForUser ? (
                          <span className="flex-1 h-11 bg-white/5 border border-white/6 rounded-lg text-xs font-mono text-white/70 flex items-center justify-center">
                            Awaiting user
                          </span>
                        ) : mobileCanConfirmPayment ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-11 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Confirm & Release
                          </motion.button>
                        ) : mobileCanComplete ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-11 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Release
                          </motion.button>
                        ) : (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-11 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Release
                          </motion.button>
                        )}
                        <button
                          onClick={() => { handleOpenChat(order); setMobileView('chat'); }}
                          className="relative h-11 w-11 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-gray-400" />
                          {(order.unreadCount || 0) > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full text-[9px] font-bold flex items-center justify-center text-black">
                              {order.unreadCount! > 9 ? '9+' : order.unreadCount}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => openDisputeModal(order.id)}
                          className="h-11 w-11 border border-white/10 hover:border-red-500/30 rounded-lg flex items-center justify-center transition-colors group"
                        >
                          <AlertTriangle className="w-4 h-4 text-gray-400 group-hover:text-red-400" />
                        </button>
                        {order.dbOrder?.status === "escrowed" && order.orderType === "buy" && order.escrowCreatorWallet && (
                          <button
                            onClick={() => openCancelModal(order)}
                            className="h-11 w-11 border border-white/10 hover:border-white/6 rounded-lg flex items-center justify-center transition-colors group"
                            title="Cancel & Withdraw"
                          >
                            <RotateCcw className="w-4 h-4 text-gray-400 group-hover:text-white/70" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )})}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                  <Lock className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-gray-500 font-mono">No active escrows</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Chat View */}
          {mobileView === 'chat' && (
            <div className="h-full flex flex-col pb-16">
              {directChat.activeContactId ? (
                <DirectChatView
                  contactName={directChat.activeContactName}
                  contactType={directChat.activeContactType}
                  messages={directChat.messages}
                  isLoading={directChat.isLoadingMessages}
                  onSendMessage={(text: string, imageUrl?: string) => {
                    directChat.sendMessage(text, imageUrl);
                    playSound('send');
                  }}
                  onBack={() => directChat.closeChat()}
                />
              ) : merchantId ? (
                <MerchantChatTabs
                  merchantId={merchantId}
                  conversations={directChat.conversations}
                  totalUnread={directChat.totalUnread}
                  isLoading={directChat.isLoadingConversations}
                  onOpenChat={(targetId: string, targetType: string, username: string) => directChat.openChat(targetId, targetType, username)}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500">Loading chats...</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: History + Stats View */}
          {mobileView === 'history' && (
            <div className="space-y-4">
              {/* History Tabs — includes Stats */}
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
                        // Did I receive crypto? M2M: I'm buyer_merchant. User trade: type='sell' = user sold to me
                        const didReceive = isM2MHistory ? order.buyerMerchantId === merchantId : order.dbOrder?.type === 'sell';
                        return (
                        <motion.div
                          key={order.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]"
                        >
                          <div className="flex items-center gap-3">
                            <UserBadge name={order.user} avatarUrl={order.userAvatarUrl} emoji={order.emoji} merchantId={order.counterpartyMerchantId} size="lg" showName={false} />
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
                                    {order.myRole === 'buyer' ? 'BUYER' : 'SELLER'}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                {didReceive ? 'Bought' : 'Sold'} • {order.timestamp.toLocaleDateString()}
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
                            <UserBadge name={order.user} avatarUrl={order.userAvatarUrl} emoji={order.emoji} merchantId={order.counterpartyMerchantId} size="lg" showName={false} />
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
                                {order.orderType === 'buy' ? 'Sell' : 'Buy'} • {order.timestamp.toLocaleDateString()}
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
                      onClick={() => setShowAnalytics(true)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white/5 text-white rounded-lg text-xs font-medium"
                    >
                      <TrendingUp className="w-3 h-3" />
                      Full Analytics
                    </button>
                  </div>

                  <button
                    onClick={() => setShowWalletModal(true)}
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
                            <p className="text-xs text-gray-500">{merchantInfo?.rating?.toFixed(2) || '5.00'} · {merchantInfo?.total_trades || 0} trades</p>
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
                        onClick={handleLogout}
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
          )}

          {/* Mobile: Marketplace + My Offers (segmented control) */}
          {mobileView === 'marketplace' && merchantId && (
            <div className="space-y-3">
              <div className="flex bg-white/[0.03] rounded-xl p-1">
                <button
                  onClick={() => setMarketSubTab('browse')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    marketSubTab === 'browse' ? 'bg-white/10 text-white' : 'text-gray-500'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Browse
                </button>
                <button
                  onClick={() => setMarketSubTab('offers')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                    marketSubTab === 'offers' ? 'bg-white/10 text-white' : 'text-gray-500'
                  }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  My Offers
                </button>
              </div>
              {marketSubTab === 'browse' ? (
                <Marketplace
                  merchantId={merchantId}
                  onTakeOffer={(offer: any) => {
                    setOpenTradeForm({
                      tradeType: offer.type === 'buy' ? 'sell' : 'buy',
                      cryptoAmount: '',
                      paymentMethod: offer.payment_method as 'bank' | 'cash',
                      spreadPreference: 'fastest',
                      expiryMinutes: 15,
                    });
                    setShowOpenTradeModal(true);
                  }}
                />
              ) : (
                <MyOffers
                  merchantId={merchantId}
                  onCreateOffer={() => setShowCreateModal(true)}
                />
              )}
            </div>
          )}
        </main>
      </div>
  );
}
