"use client";

import React from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import type { Order } from "@/types/merchant";
import { MobileOrdersView } from "@/components/merchant/MobileOrdersView";
import { MobileEscrowView } from "@/components/merchant/MobileEscrowView";
import { MobileChatView } from "@/components/merchant/MobileChatView";
import type { OrderConversation } from "@/hooks/useMerchantConversations";
import { MobileHistoryView } from "@/components/merchant/MobileHistoryView";
import { MobileMarketplaceView } from "@/components/merchant/MobileMarketplaceView";
import { MobileHomeView } from "@/components/merchant/MobileHomeView";
import { MobileBottomNav } from "@/components/merchant/MobileBottomNav";

export interface MerchantMobileContentProps {
  mobileView: "home" | "orders" | "escrow" | "chat" | "history" | "marketplace";
  setMobileView: (v: "home" | "orders" | "escrow" | "chat" | "history" | "marketplace") => void;

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
  // Cancel a still-pending order — routes through the page-level wrapper
  // (escrow-cancel modal vs no-escrow cancel call) so the Trade tab can
  // expose a Cancel button on the user's own offers.
  handleCancelOrder?: (order: Order) => void;
  cancellingOrderId?: string | null;
  // Open the order quick-view popup. Used by mobile History card taps so
  // the same details panel the desktop uses also surfaces on phone.
  setSelectedOrderPopup?: (order: Order | null) => void;

  // Escrow actions
  markingDone: any;
  openEscrowModal: (order: Order) => void;
  markFiatPaymentSent: (order: Order) => void;
  confirmPayment: (orderId: string) => Promise<void>;
  openDisputeModal: (orderId: string) => void;
  openCancelModal: (order: Order) => void;

  // Chat (order-based)
  merchantId: string | null;
  orderConversations: OrderConversation[];
  chatTotalUnread: number;
  isLoadingConversations: boolean;
  activeOrderChat: { orderId: string; userName: string; orderNumber: string; orderType?: 'buy' | 'sell' } | null;
  onOpenOrderChat: (orderId: string, userName: string, orderNumber: string, orderType?: 'buy' | 'sell') => void;
  onCloseOrderChat: () => void;
  onClearUnread: (orderId: string) => void;
  onClearAllUnread?: () => void;
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

  // Home view — trade form
  openTradeForm: any;
  isCreatingTrade: boolean;
  onCreateTrade: () => void;
  onShowWalletModal: () => void;
  // Opens the full wallet overlay (wallet management screen)
  onOpenWallet?: () => void;

  // Embedded wallet lock state — used by mobile home to gate the balance display
  embeddedWalletState?: "initializing" | "none" | "locked" | "unlocked";

  // Active corridor (e.g. "USDT_AED" / "USDT_INR") for the home trading pair selector
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;

  // Bottom nav counts
  totalUnread: number;
}

export const MerchantMobileContent = React.memo(function MerchantMobileContent(props: MerchantMobileContentProps) {
  const {
    mobileView, setMobileView,
    pendingOrders, ongoingOrders, completedOrders, cancelledOrders, bigOrders,
    acceptOrder, acceptingOrderId, handleOpenChat, dismissBigOrder,
    handleCancelOrder, cancellingOrderId,
    setSelectedOrderPopup,
    markingDone, openEscrowModal, markFiatPaymentSent, confirmPayment,
    openDisputeModal, openCancelModal,
    merchantId, orderConversations, chatTotalUnread, isLoadingConversations,
    activeOrderChat, onOpenOrderChat, onCloseOrderChat, onClearUnread, onClearAllUnread, playSound,
    merchantInfo, historyTab, setHistoryTab,
    effectiveBalance, totalTradedVolume, todayEarnings, pendingEarnings,
    setShowAnalytics, setShowWalletModal, handleLogout,
    marketSubTab, setMarketSubTab, setOpenTradeForm, setShowOpenTradeModal, setShowCreateModal,
    openTradeForm, isCreatingTrade, onCreateTrade, onShowWalletModal,
    onOpenWallet,
    embeddedWalletState,
    activeCorridor, onCorridorChange,
    totalUnread,
  } = props;

  return (
    <>
      {/* Mobile View Content */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-3 pb-20">
          {mobileView === "home" && (
            <MobileHomeView
              effectiveBalance={effectiveBalance}
              totalTradedVolume={totalTradedVolume}
              todayEarnings={todayEarnings}
              pendingEarnings={pendingEarnings}
              merchantInfo={merchantInfo}
              pendingOrders={pendingOrders}
              ongoingOrders={ongoingOrders}
              completedOrders={completedOrders}
              setMobileView={setMobileView}
              onShowWalletModal={onShowWalletModal}
              onOpenWallet={onOpenWallet}
              embeddedWalletState={embeddedWalletState}
              onStartTrade={(side) => {
                setOpenTradeForm({ ...openTradeForm, tradeType: side });
                setShowOpenTradeModal(true);
              }}
            />
          )}
          {mobileView === "orders" && (
            <MobileOrdersView
              pendingOrders={pendingOrders}
              onAcceptOrder={acceptOrder}
              acceptingOrderId={acceptingOrderId}
              onOpenChat={handleOpenChat}
              setMobileView={setMobileView}
              onCancelOrder={handleCancelOrder}
              cancellingOrderId={cancellingOrderId}
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
              orderConversations={orderConversations}
              totalUnread={chatTotalUnread}
              isLoadingConversations={isLoadingConversations}
              activeOrderChat={activeOrderChat}
              onOpenOrderChat={onOpenOrderChat}
              onCloseOrderChat={onCloseOrderChat}
              onClearUnread={onClearUnread}
              onClearAllUnread={onClearAllUnread}
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
              onSelectOrder={setSelectedOrderPopup}
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

      {/* Mobile FAB — only on Home, where opening a new trade is the
          natural primary action. Other tabs (Trade list, Chat, Escrow,
          History) have their own primary tasks and shouldn't be covered
          by a floating button. */}
      {mobileView === "home" && (
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowOpenTradeModal(true)}
          className="md:hidden fixed right-4 bottom-[88px] z-40 w-14 h-14 rounded-full bg-primary shadow-lg shadow-primary/25 flex items-center justify-center"
        >
          <Plus className="w-6 h-6 text-white" />
        </motion.button>
      )}

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
