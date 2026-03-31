"use client";

import React from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import type { Order } from "@/types/merchant";
import { MobileOrdersView } from "@/components/merchant/MobileOrdersView";
import { MobileEscrowView } from "@/components/merchant/MobileEscrowView";
import { MobileChatView } from "@/components/merchant/MobileChatView";
import { MobileHistoryView } from "@/components/merchant/MobileHistoryView";
import { MobileMarketplaceView } from "@/components/merchant/MobileMarketplaceView";
import { MobileBottomNav } from "@/components/merchant/MobileBottomNav";

export interface MerchantMobileContentProps {
  mobileView: "orders" | "escrow" | "chat" | "history" | "marketplace";
  setMobileView: (v: "orders" | "escrow" | "chat" | "history" | "marketplace") => void;

  // Order data
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];
  cancelledOrders: Order[];
  bigOrders: any[];

  // Order actions
  acceptOrder: (order: Order) => void;
  acceptingOrderId: string | null;
  handleOpenChat: (order: Order) => void;
  dismissBigOrder: (id: string) => void;

  // Escrow actions
  markingDone: any;
  openEscrowModal: (order: Order) => void;
  markFiatPaymentSent: (order: Order) => void;
  confirmPayment: (orderId: string) => Promise<void>;
  openDisputeModal: (orderId: string) => void;
  openCancelModal: (order: Order) => void;

  // Chat
  merchantId: string | null;
  directChat: any;
  activeContactOrderStatus: string | undefined;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;

  // History
  merchantInfo: any;
  historyTab: "completed" | "cancelled" | "stats";
  setHistoryTab: (v: "completed" | "cancelled" | "stats") => void;
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  setShowAnalytics: (v: boolean) => void;
  setShowWalletModal: (v: boolean) => void;
  handleLogout: () => void;

  // Marketplace
  marketSubTab: "browse" | "offers";
  setMarketSubTab: (v: "browse" | "offers") => void;
  setOpenTradeForm: (v: any) => void;
  setShowOpenTradeModal: (v: boolean) => void;
  setShowCreateModal: (v: boolean) => void;

  // Bottom nav counts
  totalUnread: number;
}

export const MerchantMobileContent = React.memo(function MerchantMobileContent(props: MerchantMobileContentProps) {
  const {
    mobileView, setMobileView,
    pendingOrders, ongoingOrders, completedOrders, cancelledOrders, bigOrders,
    acceptOrder, acceptingOrderId, handleOpenChat, dismissBigOrder,
    markingDone, openEscrowModal, markFiatPaymentSent, confirmPayment,
    openDisputeModal, openCancelModal,
    merchantId, directChat, activeContactOrderStatus, playSound,
    merchantInfo, historyTab, setHistoryTab,
    effectiveBalance, totalTradedVolume, todayEarnings, pendingEarnings,
    setShowAnalytics, setShowWalletModal, handleLogout,
    marketSubTab, setMarketSubTab, setOpenTradeForm, setShowOpenTradeModal, setShowCreateModal,
    totalUnread,
  } = props;

  return (
    <>
      {/* Mobile View Content */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-3 pb-20">
          {mobileView === "orders" && (
            <MobileOrdersView
              pendingOrders={pendingOrders}
              bigOrders={bigOrders}
              onAcceptOrder={acceptOrder}
              acceptingOrderId={acceptingOrderId}
              onOpenChat={handleOpenChat}
              onDismissBigOrder={dismissBigOrder}
              setMobileView={setMobileView}
            />
          )}
          {mobileView === "escrow" && (
            <MobileEscrowView
              ongoingOrders={ongoingOrders}
              markingDone={markingDone}
              onOpenEscrowModal={openEscrowModal}
              onMarkFiatPaymentSent={markFiatPaymentSent}
              onConfirmPayment={(order) => confirmPayment(order.id)}
              onOpenDisputeModal={(orderId) => openDisputeModal(orderId)}
              onOpenCancelModal={openCancelModal}
              onOpenChat={handleOpenChat}
              setMobileView={setMobileView}
            />
          )}
          {mobileView === "chat" && (
            <MobileChatView
              merchantId={merchantId}
              directChat={directChat}
              orderStatus={activeContactOrderStatus}
              playSound={playSound}
            />
          )}
          {mobileView === "history" && (
            <MobileHistoryView
              completedOrders={completedOrders}
              cancelledOrders={cancelledOrders}
              merchantId={merchantId}
              merchantInfo={merchantInfo}
              historyTab={historyTab}
              setHistoryTab={setHistoryTab}
              effectiveBalance={effectiveBalance}
              totalTradedVolume={totalTradedVolume}
              todayEarnings={todayEarnings}
              pendingEarnings={pendingEarnings}
              onShowAnalytics={() => setShowAnalytics(true)}
              onShowWalletModal={() => setShowWalletModal(true)}
              onLogout={handleLogout}
            />
          )}
          {mobileView === "marketplace" && merchantId && (
            <MobileMarketplaceView
              merchantId={merchantId}
              marketSubTab={marketSubTab}
              setMarketSubTab={setMarketSubTab}
              onTakeOffer={(offer) => {
                setOpenTradeForm({
                  tradeType: offer.type === "buy" ? "sell" : "buy",
                  cryptoAmount: "",
                  paymentMethod: offer.payment_method as "bank" | "cash",
                  spreadPreference: "fastest",
                  expiryMinutes: 15,
                });
                setShowOpenTradeModal(true);
              }}
              onCreateOffer={() => setShowCreateModal(true)}
            />
          )}
        </main>
      </div>

      {/* Mobile FAB */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowOpenTradeModal(true)}
        className="md:hidden fixed right-4 bottom-[88px] z-40 w-14 h-14 rounded-full bg-primary shadow-lg shadow-primary/25 flex items-center justify-center"
      >
        <Plus className="w-6 h-6 text-black" />
      </motion.button>

      <MobileBottomNav
        mobileView={mobileView}
        setMobileView={setMobileView}
        pendingCount={pendingOrders.length}
        ongoingCount={ongoingOrders.length}
        totalUnread={totalUnread}
      />
    </>
  );
});
