"use client";

import React, { useRef } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2, ArrowDown } from "lucide-react";
import type { Order } from "@/types/merchant";
import { MobileOrdersView } from "@/components/merchant/MobileOrdersView";
import { MobileEscrowView } from "@/components/merchant/MobileEscrowView";
import { MobileChatView } from "@/components/merchant/MobileChatView";
import type { OrderConversation } from "@/hooks/useMerchantConversations";
import { MobileHistoryView } from "@/components/merchant/MobileHistoryView";
import { MobileMarketplaceView } from "@/components/merchant/MobileMarketplaceView";
import { MobileHomeView } from "@/components/merchant/MobileHomeView";
import { MobileBottomNav } from "@/components/merchant/MobileBottomNav";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

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

  // Opens the shared PaymentMethodModal (state lives on merchant/page.tsx).
  onOpenPaymentMethods?: () => void;

  /**
   * Pull-to-refresh handler. Wired to the mobile `<main>` scroll container
   * so the gesture works on every tab (home / orders / escrow / chat /
   * history / marketplace). Parent should refetch all merchant data
   * (orders, balances, mempool, active offers). May return a promise —
   * the spinner spins until it resolves.
   */
  onRefresh?: () => void | Promise<void>;
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
    onOpenPaymentMethods,
    onRefresh,
  } = props;

  // ── Pull-to-refresh ─────────────────────────────────────────────────────
  // Wired to the `<main>` scroll container so it works on every tab. iOS-
  // style sliding pill — same physics as the user side.
  const scrollRef = useRef<HTMLElement | null>(null);
  const PTR_THRESHOLD = 68;
  const PTR_PILL_REST = 50;
  const {
    pull: ptrPull,
    status: ptrStatus,
    progress: ptrProgress,
    isRefreshing: ptrRefreshing,
  } = usePullToRefresh({
    onRefresh: async () => {
      if (onRefresh) await onRefresh();
    },
    threshold: PTR_THRESHOLD,
    enabled: !!onRefresh,
    scrollContainerRef: scrollRef,
  });
  const ptrActive = ptrPull > 0 || ptrRefreshing;
  const ptrIsDragging = ptrStatus === "pulling" || ptrStatus === "ready";
  const ptrTransition = ptrIsDragging
    ? "none"
    : "transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 360ms cubic-bezier(0.34, 1.56, 0.64, 1), top 360ms cubic-bezier(0.34, 1.56, 0.64, 1)";
  const ptrIndicatorScale = 0.55 + Math.min(ptrProgress, 1) * 0.55;
  const ptrIndicatorRotation = ptrRefreshing ? 0 : ptrProgress * 220;
  const ptrPillTranslate = (ptrRefreshing ? PTR_THRESHOLD : ptrPull) - PTR_PILL_REST;
  const ptrLabelTop = Math.max((ptrRefreshing ? PTR_THRESHOLD : ptrPull) - 6, -16);
  const ptrLabel =
    ptrStatus === "refreshing"
      ? "Refreshing…"
      : ptrStatus === "ready"
        ? "Release to refresh"
        : "Pull to refresh";

  return (
    <>
      {/* Mobile View Content */}
      <div className="lg:hidden flex-1 flex flex-col overflow-hidden relative">
        {/* ── Pull-to-refresh indicator ─────────────────────────────────────
            Pill is parked above the viewport and slides down with the pull
            so a hint of motion is visible from the first pixel. */}
        {onRefresh && (
          <>
            {/* Soft halo glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full blur-2xl z-[59]"
              style={{
                top: ptrPillTranslate - 60,
                width: 220,
                height: 220,
                background:
                  "radial-gradient(circle, rgba(120,180,255,0.45) 0%, rgba(120,180,255,0.20) 38%, rgba(120,180,255,0) 72%)",
                opacity: Math.min(ptrProgress, 1) * 0.95,
                transform: `translate3d(0,0,0) scale(${0.55 + Math.min(ptrProgress, 1) * 0.7})`,
                transition: ptrTransition,
                willChange: "transform, opacity, top",
              }}
            />

            {/* Spinner pill — uses theme bg so it reads on both dark/light */}
            <div
              aria-hidden={!ptrActive}
              className="pointer-events-none absolute left-1/2 z-[60] flex h-11 w-11 items-center justify-center rounded-full bg-card-solid"
              style={{
                top: 0,
                transform: `translate3d(-50%, ${ptrPillTranslate}px, 0) scale(${ptrIndicatorScale}) rotate(${ptrIndicatorRotation}deg)`,
                opacity: Math.min(0.25 + ptrProgress * 0.9, 1),
                transition: ptrTransition,
                boxShadow: `0 8px 24px -6px rgba(0,0,0,0.45), 0 0 ${28 * Math.min(ptrProgress, 1)}px rgba(120,180,255,${0.45 * Math.min(ptrProgress, 1)})`,
                border: "1px solid rgba(255,255,255,0.08)",
                willChange: "transform, opacity",
              }}
            >
              {ptrRefreshing ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin text-foreground" />
              ) : (
                <ArrowDown
                  className="h-[18px] w-[18px] text-foreground"
                  style={{
                    transform: `rotate(${ptrStatus === "ready" ? 180 : 0}deg)`,
                    transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              )}
            </div>

            {/* Floating status label */}
            {ptrActive && (
              <div
                className="pointer-events-none absolute left-0 right-0 z-[60] flex justify-center"
                style={{
                  top: ptrLabelTop,
                  opacity: Math.min(ptrProgress * 1.4, 1),
                  transition: ptrTransition,
                }}
              >
                <span
                  className="rounded-full px-3 py-[3px] text-[10.5px] font-semibold tracking-wide text-white shadow-sm backdrop-blur-md"
                  style={{ background: "rgba(15,23,42,0.78)" }}
                >
                  {ptrLabel}
                </span>
              </div>
            )}
          </>
        )}

        <main
          ref={scrollRef}
          className="flex-1 overflow-auto p-3 pb-24"
          style={{
            overscrollBehaviorY: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
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
              activeCorridor={activeCorridor}
              onCorridorChange={onCorridorChange}
              onOpenPaymentMethods={onOpenPaymentMethods}
              onStartTrade={(side) => {
                setOpenTradeForm({ ...openTradeForm, tradeType: side });
                setShowOpenTradeModal(true);
              }}
            />
          )}
          {mobileView === "orders" && (
            <MobileOrdersView
              pendingOrders={pendingOrders}
              ongoingOrders={ongoingOrders}
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
          className="lg:hidden fixed right-4 bottom-[88px] z-40 w-14 h-14 rounded-full bg-primary shadow-lg shadow-primary/25 flex items-center justify-center"
        >
          <Plus className="w-6 h-6 text-background" />
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
