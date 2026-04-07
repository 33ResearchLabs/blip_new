"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import type { Order } from "@/types/merchant";
import { useState } from "react";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { DisputeChatView } from "@/components/merchant/DisputeChatView";
import PWAInstallBanner from "@/components/PWAInstallBanner";

const OrderDetailsPanel = dynamic(
  () => import("@/components/merchant/OrderDetailsPanel").then((m) => ({ default: m.OrderDetailsPanel })),
  { ssr: false },
);
const MerchantProfileModal = dynamic(
  () => import("@/components/merchant/MerchantProfileModal").then((m) => ({ default: m.MerchantProfileModal })),
  { ssr: false },
);
const TransactionHistoryModal = dynamic(
  () => import("@/components/merchant/TransactionHistoryModal").then((m) => ({ default: m.TransactionHistoryModal })),
  { ssr: false },
);
const PaymentMethodModal = dynamic(
  () => import("@/components/merchant/PaymentMethodModal").then((m) => ({ default: m.PaymentMethodModal })),
  { ssr: false },
);
const RatingModal = dynamic(
  () => import("@/components/RatingModal").then((m) => ({ default: m.RatingModal })),
  { ssr: false },
);
const MerchantQuoteModal = dynamic(
  () => import("@/components/mempool/MerchantQuoteModal").then((m) => ({ default: m.MerchantQuoteModal })),
  { ssr: false },
);
const OrderInspector = dynamic(
  () => import("@/components/mempool/OrderInspector").then((m) => ({ default: m.OrderInspector })),
  { ssr: false },
);
const CorridorCreateModal = dynamic(
  () => import("@/components/merchant/CorridorCreateModal").then((m) => ({ default: m.CorridorCreateModal })),
  { ssr: false },
);
const TradeFormModal = dynamic(
  () => import("@/components/merchant/TradeFormModal").then((m) => ({ default: m.TradeFormModal })),
  { ssr: false },
);
const OrderQuickView = dynamic(
  () => import("@/components/merchant/OrderQuickView").then((m) => ({ default: m.OrderQuickView })),
  { ssr: false },
);
const EscrowLockModal = dynamic(
  () => import("@/components/merchant/EscrowLockModal").then((m) => ({ default: m.EscrowLockModal })),
  { ssr: false },
);
const EscrowCancelModal = dynamic(
  () => import("@/components/merchant/EscrowCancelModal").then((m) => ({ default: m.EscrowCancelModal })),
  { ssr: false },
);
const DisputeModal = dynamic(
  () => import("@/components/merchant/DisputeModal").then((m) => ({ default: m.DisputeModal })),
  { ssr: false },
);
const WalletPromptModal = dynamic(
  () => import("@/components/merchant/WalletPromptModal").then((m) => ({ default: m.WalletPromptModal })),
  { ssr: false },
);
const AnalyticsModal = dynamic(
  () => import("@/components/merchant/AnalyticsModal").then((m) => ({ default: m.AnalyticsModal })),
  { ssr: false },
);
const MerchantWalletModal = dynamic(
  () => import("@/components/MerchantWalletModal"),
  { ssr: false },
);
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), {
  ssr: false,
});

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";

export interface MerchantModalsProps {
  // IDs
  merchantId: string | null;
  orders: Order[];

  // Dispute
  showDisputeModal: boolean;
  disputeReason: string;
  setDisputeReason: (v: string) => void;
  disputeDescription: string;
  setDisputeDescription: (v: string) => void;
  isSubmittingDispute: boolean;
  closeDisputeModal: () => void;
  submitDispute: () => void;

  // Escrow lock
  showEscrowModal: boolean;
  escrowOrder: Order | null;
  isLockingEscrow: boolean;
  escrowTxHash: string | null;
  escrowError: string | null;
  effectiveBalance: number | null;
  closeEscrowModal: () => void;
  executeLockEscrow: () => void;

  // Escrow cancel
  showCancelModal: boolean;
  cancelOrder: Order | null;
  isCancellingEscrow: boolean;
  cancelTxHash: string | null;
  cancelError: string | null;
  closeCancelModal: () => void;
  executeCancelEscrow: () => void;

  // Wallet prompt
  showWalletPrompt: boolean;
  setShowWalletPrompt: (v: boolean) => void;
  solanaWalletConnected: boolean;
  showWalletModal: boolean;
  setShowWalletModal: (v: boolean) => void;
  solanaWalletAddress: string | null;

  // Analytics
  showAnalytics: boolean;
  setShowAnalytics: (v: boolean) => void;

  // Username
  showUsernameModal: boolean;
  handleMerchantUsername: (username: string) => Promise<void>;

  // Profile
  showProfileModal: boolean;
  setShowProfileModal: (v: boolean) => void;
  merchantInfo: any;
  handleProfileUpdated: (avatarUrl: string, displayName?: string, bio?: string) => void;

  // Transaction history
  showTransactionHistory: boolean;
  setShowTransactionHistory: (v: boolean) => void;

  // Payment methods
  showPaymentMethods: boolean;
  setShowPaymentMethods: (v: boolean) => void;

  // Rating
  ratingModalData: { orderId: string; counterpartyName: string; counterpartyType: "user" | "merchant" } | null;
  setRatingModalData: (v: { orderId: string; counterpartyName: string; counterpartyType: "user" | "merchant" } | null) => void;
  onRatingSubmit: (rating: number, review: string) => Promise<void>;

  // Merchant quote
  showMerchantQuoteModal: boolean;
  setShowMerchantQuoteModal: (v: boolean) => void;

  // Mempool order inspector
  selectedMempoolOrder: any | null;
  setSelectedMempoolOrder: (v: any | null) => void;

  // Corridor create
  showCreateModal: boolean;
  setShowCreateModal: (v: boolean) => void;
  corridorForm: any;
  setCorridorForm: (v: any) => void;
  solanaWalletAddressForCorridor: string | null;
  refreshBalance: () => void;
  fetchActiveOffers: () => void;

  // Trade form
  showOpenTradeModal: boolean;
  setShowOpenTradeModal: (v: boolean) => void;
  openTradeForm: any;
  setOpenTradeForm: (v: any) => void;
  isCreatingTrade: boolean;
  createTradeError: string | null;
  setCreateTradeError: (v: string | null) => void;
  handleCreateTrade: () => void;

  // Order quick view
  selectedOrderPopup: Order | null;
  setSelectedOrderPopup: (v: Order | null) => void;
  markingDone: any;
  acceptingOrderId: string | null;
  confirmingOrderId: string | null;
  cancellingOrderId: string | null;
  isRequestingCancel: boolean;
  acceptOrder: (order: Order) => void;
  openEscrowModal: (order: Order) => void;
  markFiatPaymentSent: (order: Order) => void;
  confirmPayment: (orderId: string) => Promise<void>;
  cancelOrderWithoutEscrow: (orderId: string) => void;
  respondToCancelRequest: (orderId: string, accept: boolean) => void;
  handleOpenChat: (order: Order) => void;

  // Order details panel
  selectedOrderId: string | null;
  setSelectedOrderId: (v: string | null) => void;
  openChat: (name: string, emoji: string, orderId: string) => void;
  setActiveChatId: (v: string | null) => void;
  directChat: any;
  openDisputeModal: (orderId: string) => void;
  requestCancelOrder: (orderId: string) => void;
  openCancelModal: (order: Order) => void;
  fetchOrders: () => Promise<void>;
  toast: any;

  // Message history panel
  showMessageHistory: boolean;
  setShowMessageHistory: (v: boolean) => void;
  activeContactOrderStatus: string | undefined;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
}

export const MerchantModals = React.memo(function MerchantModals(props: MerchantModalsProps) {
  const [activeDisputeOrderId, setActiveDisputeOrderId] = useState<string | null>(null);
  const [activeDisputeUserName, setActiveDisputeUserName] = useState<string>('');
  const {
    merchantId, orders,
    showDisputeModal, disputeReason, setDisputeReason, disputeDescription, setDisputeDescription,
    isSubmittingDispute, closeDisputeModal, submitDispute,
    showEscrowModal, escrowOrder, isLockingEscrow, escrowTxHash, escrowError, effectiveBalance,
    closeEscrowModal, executeLockEscrow,
    showCancelModal, cancelOrder, isCancellingEscrow, cancelTxHash, cancelError,
    closeCancelModal, executeCancelEscrow,
    showWalletPrompt, setShowWalletPrompt, solanaWalletConnected, showWalletModal, setShowWalletModal,
    solanaWalletAddress,
    showAnalytics, setShowAnalytics,
    showUsernameModal, handleMerchantUsername,
    showProfileModal, setShowProfileModal, merchantInfo, handleProfileUpdated,
    showTransactionHistory, setShowTransactionHistory,
    showPaymentMethods, setShowPaymentMethods,
    ratingModalData, setRatingModalData, onRatingSubmit,
    showMerchantQuoteModal, setShowMerchantQuoteModal,
    selectedMempoolOrder, setSelectedMempoolOrder,
    showCreateModal, setShowCreateModal, corridorForm, setCorridorForm,
    solanaWalletAddressForCorridor, refreshBalance, fetchActiveOffers,
    showOpenTradeModal, setShowOpenTradeModal, openTradeForm, setOpenTradeForm,
    isCreatingTrade, createTradeError, setCreateTradeError, handleCreateTrade,
    selectedOrderPopup, setSelectedOrderPopup, markingDone, acceptingOrderId,
    confirmingOrderId, cancellingOrderId, isRequestingCancel,
    acceptOrder, openEscrowModal, markFiatPaymentSent, confirmPayment,
    cancelOrderWithoutEscrow, respondToCancelRequest, handleOpenChat,
    selectedOrderId, setSelectedOrderId, openChat, setActiveChatId, directChat,
    openDisputeModal, requestCancelOrder, openCancelModal, fetchOrders, toast,
    showMessageHistory, setShowMessageHistory, activeContactOrderStatus, playSound,
  } = props;

  return (
    <>
      <DisputeModal
        showDisputeModal={showDisputeModal}
        disputeReason={disputeReason}
        setDisputeReason={setDisputeReason}
        disputeDescription={disputeDescription}
        setDisputeDescription={setDisputeDescription}
        isSubmittingDispute={isSubmittingDispute}
        onClose={closeDisputeModal}
        onSubmit={submitDispute}
      />

      <EscrowLockModal
        showEscrowModal={showEscrowModal}
        escrowOrder={escrowOrder}
        isLockingEscrow={isLockingEscrow}
        escrowTxHash={escrowTxHash}
        escrowError={escrowError}
        effectiveBalance={effectiveBalance}
        onClose={closeEscrowModal}
        onExecute={executeLockEscrow}
      />

      <EscrowCancelModal
        showCancelModal={showCancelModal}
        cancelOrder={cancelOrder}
        isCancellingEscrow={isCancellingEscrow}
        cancelTxHash={cancelTxHash}
        cancelError={cancelError}
        onClose={closeCancelModal}
        onExecute={executeCancelEscrow}
      />

      <WalletPromptModal
        show={showWalletPrompt && !IS_EMBEDDED_WALLET && !solanaWalletConnected}
        onDismiss={() => setShowWalletPrompt(false)}
        onConnect={() => { setShowWalletPrompt(false); setShowWalletModal(true); }}
      />

      <AnalyticsModal
        show={showAnalytics}
        merchantId={merchantId}
        onClose={() => setShowAnalytics(false)}
      />

      <PWAInstallBanner appName="Merchant" accentColor="#f97316" />

      {!IS_EMBEDDED_WALLET && (
        <MerchantWalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          onConnected={() => setShowWalletModal(false)}
        />
      )}

      {(solanaWalletAddress || (typeof window !== "undefined" && (window as any).phantom?.solana?.publicKey)) && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={solanaWalletAddress || (window as any).phantom?.solana?.publicKey?.toString()}
          onSubmit={handleMerchantUsername}
          canClose={false}
          apiEndpoint="/api/auth/merchant"
        />
      )}

      <MerchantProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        merchantId={merchantId || ""}
        currentAvatar={merchantInfo?.avatar_url}
        currentDisplayName={merchantInfo?.display_name}
        currentBio={merchantInfo?.bio}
        onProfileUpdated={handleProfileUpdated}
      />

      <TransactionHistoryModal
        isOpen={showTransactionHistory}
        onClose={() => setShowTransactionHistory(false)}
        merchantId={merchantId || ""}
        orders={orders}
        effectiveBalance={effectiveBalance}
      />
      <PaymentMethodModal
        isOpen={showPaymentMethods}
        onClose={() => setShowPaymentMethods(false)}
        merchantId={merchantId || ""}
      />

      {ratingModalData && merchantId && (
        <RatingModal
          orderId={ratingModalData.orderId}
          counterpartyName={ratingModalData.counterpartyName}
          counterpartyType={ratingModalData.counterpartyType}
          raterType="merchant"
          raterId={merchantId}
          onClose={() => setRatingModalData(null)}
          onSubmit={onRatingSubmit}
        />
      )}

      {merchantId && (
        <MerchantQuoteModal
          merchantId={merchantId}
          corridorId="USDT_AED"
          isOpen={showMerchantQuoteModal}
          onClose={() => setShowMerchantQuoteModal(false)}
        />
      )}

      {selectedMempoolOrder && merchantId && (
        <OrderInspector
          order={selectedMempoolOrder}
          merchantId={merchantId}
          onClose={() => setSelectedMempoolOrder(null)}
          onBump={() => setSelectedMempoolOrder(null)}
          onAccept={() => setSelectedMempoolOrder(null)}
        />
      )}

      <CorridorCreateModal
        isOpen={showCreateModal}
        corridorForm={corridorForm}
        setCorridorForm={setCorridorForm}
        effectiveBalance={effectiveBalance}
        merchantId={merchantId}
        solanaWalletAddress={solanaWalletAddressForCorridor}
        onClose={() => setShowCreateModal(false)}
        onRefreshBalance={() => refreshBalance()}
        onFetchActiveOffers={fetchActiveOffers}
      />

      <TradeFormModal
        isOpen={showOpenTradeModal}
        openTradeForm={openTradeForm}
        setOpenTradeForm={setOpenTradeForm}
        effectiveBalance={effectiveBalance}
        isCreatingTrade={isCreatingTrade}
        createTradeError={createTradeError}
        setCreateTradeError={setCreateTradeError}
        onClose={() => setShowOpenTradeModal(false)}
        onSubmit={handleCreateTrade}
      />

      <OrderQuickView
        selectedOrder={selectedOrderPopup}
        merchantId={merchantId}
        markingDone={markingDone}
        acceptingOrderId={acceptingOrderId}
        confirmingOrderId={confirmingOrderId}
        cancellingOrderId={cancellingOrderId}
        isRequestingCancel={isRequestingCancel}
        onClose={() => setSelectedOrderPopup(null)}
        onAcceptOrder={acceptOrder}
        onOpenEscrowModal={openEscrowModal}
        onMarkFiatPaymentSent={markFiatPaymentSent}
        onConfirmPayment={confirmPayment}
        onCancelOrderWithoutEscrow={cancelOrderWithoutEscrow}
        onRespondToCancel={respondToCancelRequest}
        onOpenChat={handleOpenChat}
        onViewFullDetails={(orderId) => setSelectedOrderId(orderId)}
        onOpenDispute={openDisputeModal}
      />

      {selectedOrderId && merchantId && (
        <OrderDetailsPanel
          orderId={selectedOrderId}
          merchantId={merchantId}
          onClose={() => setSelectedOrderId(null)}
          onOpenChat={(orderId, targetId, targetType, targetName) => {
            const order = orders.find((o) => o.id === orderId);
            if (order && (order.status === "disputed" || order.dbOrder?.status === "disputed")) {
              openChat(order.user || targetName || "Dispute Chat", "📋", orderId);
              setActiveChatId(orderId);
              setSelectedOrderId(null);
              return;
            }
            if (targetId && targetType && targetName) {
              directChat.addContact(targetId, targetType);
              directChat.openChat(targetId, targetType, targetName);
            } else {
              if (order) handleOpenChat(order);
            }
            setSelectedOrderId(null);
          }}
          onConfirmPayment={confirmPayment}
          onMarkPaymentSent={(orderId) => {
            const order = orders.find((o) => o.id === orderId);
            if (order) markFiatPaymentSent(order);
          }}
          onAcceptOrder={(orderId) => {
            const order = orders.find((o) => o.id === orderId);
            if (order) acceptOrder(order);
          }}
          onCancelOrder={(orderId) => {
            const order = orders.find((o) => o.id === orderId);
            if (order) {
              if (order.escrowTxHash) openCancelModal(order);
              else cancelOrderWithoutEscrow(order.id);
            }
          }}
          onLockEscrow={(orderId) => {
            const order = orders.find((o) => o.id === orderId);
            if (order) openEscrowModal(order);
          }}
          onReleaseEscrow={(orderId) => confirmPayment(orderId)}
          onOpenDispute={openDisputeModal}
          onRequestCancel={requestCancelOrder}
          onRespondToCancel={respondToCancelRequest}
          isRequestingCancel={isRequestingCancel}
        />
      )}

      {/* Message History Panel (Desktop) */}
      <AnimatePresence>
        {showMessageHistory && merchantId && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md z-50 shadow-2xl bg-background border-l border-white/[0.04]"
          >
            {activeDisputeOrderId ? (
              <DisputeChatView
                orderId={activeDisputeOrderId}
                merchantId={merchantId}
                userName={activeDisputeUserName}
                onBack={() => { setActiveDisputeOrderId(null); setActiveDisputeUserName(''); }}
                onSendSound={() => playSound("send")}
              />
            ) : directChat.activeContactId ? (
              <DirectChatView
                contactName={directChat.activeContactName}
                contactType={directChat.activeContactType}
                messages={directChat.messages}
                isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => { directChat.sendMessage(text, imageUrl); playSound("send"); }}
                onBack={() => directChat.closeChat()}
                orderStatus={activeContactOrderStatus}
              />
            ) : (
              <MerchantChatTabs
                merchantId={merchantId}
                conversations={directChat.conversations}
                totalUnread={directChat.totalUnread}
                isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => directChat.openChat(targetId, targetType, username)}
                onOpenDisputeChat={(orderId, userName) => {
                  setActiveDisputeOrderId(orderId);
                  setActiveDisputeUserName(userName);
                }}
                onClose={() => setShowMessageHistory(false)}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
