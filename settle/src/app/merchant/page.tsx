"use client";

import { useMerchantDashboard } from "./_hooks/useMerchantDashboard";
import { DisputeModal } from "./_components/DisputeModal";
import { EscrowLockModal, EscrowReleaseModal, EscrowCancelModal } from "./_components/EscrowModals";
import { WalletRequiredModal, WalletPromptModal } from "./_components/WalletModals";
import { OrderDetailPopup } from "./_components/OrderDetailPopup";
import { CreateCorridorModal, OpenTradeModal } from "./_components/TradeModals";
import { DesktopLayout } from "./_components/DesktopLayout";
import { MobileOrdersView } from "./_components/MobileOrdersView";
import { MobileStatsBar } from "./_components/MobileStatsBar";
import { MobileBottomNav } from "./_components/MobileBottomNav";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Plus, History } from "lucide-react";
import dynamic from "next/dynamic";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import { NotificationToastContainer, ConnectionIndicator } from "@/components/NotificationToast";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { OrderDetailsPanel } from "@/components/merchant/OrderDetailsPanel";
import { AnalyticsDashboard } from "@/components/merchant/AnalyticsDashboard";
import { MerchantProfileModal } from "@/components/merchant/MerchantProfileModal";
import { TransactionHistoryModal } from "@/components/merchant/TransactionHistoryModal";
import { PaymentMethodModal } from "@/components/merchant/PaymentMethodModal";
import { RatingModal } from "@/components/RatingModal";
import { MerchantQuoteModal } from "@/components/mempool/MerchantQuoteModal";
import { OrderInspector } from "@/components/mempool/OrderInspector";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { LoginScreen } from "@/components/merchant/LoginScreen";

// Dynamically import wallet components (client-side only)
const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });
const useSolanaWalletHook = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSolanaWallet } = require("@/context/SolanaWalletContext");
    return useSolanaWallet();
  } catch {
    return {
      connected: false,
      connecting: false,
      publicKey: null,
      walletAddress: null,
      signMessage: undefined,
      connect: () => {},
      disconnect: () => {},
      openWalletModal: () => {},
      solBalance: null,
      usdtBalance: null,
      refreshBalances: async () => {},
      depositToEscrow: async () => ({ txHash: '', success: false }),
      releaseEscrow: async () => ({ txHash: '', success: false }),
      refundEscrow: async () => ({ txHash: '', success: false }),
      // V2.3: Payment confirmation & disputes
      confirmPayment: async () => ({ txHash: '', success: false }),
      openDispute: async () => ({ txHash: '', success: false }),
      network: 'devnet' as const,
    };
  }
};

// (initialBigOrders moved to useOrderFetching hook)

export default function MerchantDashboard() {
  const solanaWallet = useSolanaWalletHook();
  const {
    router, orders, setOrders, merchantId, merchantInfo, setMerchantInfo, isLoggedIn, isLoading,
    searchQuery, setSearchQuery,
    isMockMode, embeddedWallet,
    isPusherConnected,
    activeOffers, leaderboardData, inAppBalance, bigOrders, mempoolOrders, resolvedDisputes,
    effectiveBalance, setActiveOffers, setBigOrders, setMempoolOrders, setResolvedDisputes,
    fetchOrders, debouncedFetchOrders, fetchMempoolOrders, fetchActiveOffers,
    refreshBalance, refetchSingleOrder, afterMutationReconcile, dismissBigOrder,
    loginForm, setLoginForm, registerForm, setRegisterForm,
    authTab, setAuthTab, loginError, setLoginError,
    isLoggingIn, isRegistering, isAuthenticating, setIsAuthenticating,
    handleLogin, handleRegister, handleLogout,
    handleMerchantUsername, handleProfileUpdated,
    showWalletModal, setShowWalletModal,
    showWalletPrompt, setShowWalletPrompt,
    walletUpdatePending, setWalletUpdatePending,
    showUsernameModal, setShowUsernameModal,
    isNewMerchant, setIsNewMerchant,
    showNotifications, setShowNotifications,
    activeChatId, setActiveChatId,
    showBigOrderWidget, setShowBigOrderWidget,
    isWideScreen,
    showMessageHistory, setShowMessageHistory,
    selectedOrderId, setSelectedOrderId,
    showProfileModal, setShowProfileModal,
    showTransactionHistory, setShowTransactionHistory,
    showPaymentMethods, setShowPaymentMethods,
    showAnalytics, setShowAnalytics,
    showCreateModal, setShowCreateModal,
    showOpenTradeModal, setShowOpenTradeModal,
    showMerchantQuoteModal, setShowMerchantQuoteModal,
    selectedMempoolOrder, setSelectedMempoolOrder,
    ratingModalData, setRatingModalData,
    selectedOrderPopup, setSelectedOrderPopup,
    notifications, setNotifications, addNotification, markNotificationRead,
    showEscrowModal, escrowOrder, isLockingEscrow, escrowTxHash, escrowError,
    openEscrowModal, openEscrowModalForSell, executeLockEscrow, closeEscrowModal,
    showReleaseModal, releaseOrder, isReleasingEscrow, releaseTxHash, releaseError,
    openReleaseModal, executeRelease, closeReleaseModal,
    showCancelModal, cancelOrder, isCancellingEscrow, cancelTxHash, cancelError,
    openCancelModal, executeCancelEscrow, closeCancelModal,
    isCancellingOrder, cancelOrderWithoutEscrow,
    openTradeForm, setOpenTradeForm,
    isMerchantOnline, setIsMerchantOnline,
    corridorForm, setCorridorForm,
    tradeAmountWarning,
    mobileView, setMobileView,
    marketSubTab, setMarketSubTab,
    leaderboardTab, setLeaderboardTab,
    activityCollapsed, setActivityCollapsed,
    leaderboardCollapsed, setLeaderboardCollapsed,
    historyTab, setHistoryTab,
    completedTimeFilter, setCompletedTimeFilter,
    orderConversations, isLoadingConversations, activeChatOrderDetails,
    fetchOrderDetailsForChat, fetchOrderConversations,
    chatWindows, openChat, closeChat, sendMessage, directChat,
    showDisputeModal, setShowDisputeModal, disputeOrderId, setDisputeOrderId,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute, disputeInfo, setDisputeInfo,
    isRespondingToResolution, extensionRequests, setExtensionRequests, requestingExtension,
    openDisputeModal, submitDispute, fetchDisputeInfo,
    requestExtension, respondToExtension, respondToResolution,
    markingDone, isAccepting, isSigning, isCompleting, isConfirmingPayment,
    isCreatingTrade, setIsCreatingTrade, createTradeError, setCreateTradeError,
    acceptOrder, acceptWithSaed, signToClaimOrder, signAndProceed,
    markFiatPaymentSent, markPaymentSent, completeOrder, confirmPayment,
    handleDirectOrderCreation,
    pendingOrders, ongoingOrders, completedOrders, cancelledOrders,
    todayEarnings, totalTradedVolume, pendingEarnings,
    activeChat, totalUnread,
    hasMyEscrow, handleCancelOrder, handleOpenChat,
    playSound, toast,
    messagesEndRef, chatInputRefs,
  } = useMerchantDashboard(solanaWallet);


  // Loading screen - show while checking session
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Login screen
  if (!isLoggedIn) {
    return (
      <LoginScreen
        authTab={authTab}
        setAuthTab={setAuthTab}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        registerForm={registerForm}
        setRegisterForm={setRegisterForm}
        loginError={loginError}
        setLoginError={setLoginError}
        isLoggingIn={isLoggingIn}
        isRegistering={isRegistering}
        isAuthenticating={isAuthenticating}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  return (
    <div data-testid="merchant-dashboard" className="h-screen bg-[#060606] text-white flex flex-col overflow-hidden">
      {/* Toast Notifications */}
      <NotificationToastContainer position="top-right" />

      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.01] rounded-full blur-[200px]" />
      </div>

      {/* Top Navbar */}
      <MerchantNavbar
        activePage="dashboard"
        merchantInfo={merchantInfo}
        embeddedWalletState={embeddedWallet?.state}
        onLogout={handleLogout}
        rightActions={
          <>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowTransactionHistory(true)}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
              title="Transaction History"
            >
              <History className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPaymentMethods(true)}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
              title="Payment Methods"
            >
              <Plus className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <ConnectionIndicator isConnected={isPusherConnected} />
          </>
        }
      />

      {/* Mobile Stats Bar */}
      <MobileStatsBar
        effectiveBalance={effectiveBalance}
        totalTradedVolume={totalTradedVolume}
        showNotifications={showNotifications}
        setShowNotifications={setShowNotifications}
        setShowWalletModal={setShowWalletModal}
        notifications={notifications}
      />

      {/* Desktop Layout */}
      <DesktopLayout
        isWideScreen={isWideScreen}
        todayEarnings={todayEarnings}
        completedOrders={completedOrders}
        cancelledOrders={cancelledOrders}
        effectiveBalance={effectiveBalance}
        isMerchantOnline={isMerchantOnline}
        merchantId={merchantId}
        setIsMerchantOnline={setIsMerchantOnline}
        merchantInfo={merchantInfo}
        openTradeForm={openTradeForm}
        setOpenTradeForm={setOpenTradeForm}
        isCreatingTrade={isCreatingTrade}
        handleDirectOrderCreation={handleDirectOrderCreation}
        refreshBalance={refreshBalance}
        pendingOrders={pendingOrders}
        mempoolOrders={mempoolOrders}
        setSelectedOrderPopup={setSelectedOrderPopup}
        setSelectedMempoolOrder={setSelectedMempoolOrder}
        handleCancelOrder={handleCancelOrder}
        handleOpenChat={handleOpenChat}
        fetchOrders={fetchOrders}
        leaderboardData={leaderboardData}
        leaderboardTab={leaderboardTab}
        setLeaderboardTab={setLeaderboardTab}
        ongoingOrders={ongoingOrders}
        openDisputeModal={openDisputeModal}
        setRatingModalData={setRatingModalData}
        setSelectedOrderId={setSelectedOrderId}
        setActivityCollapsed={setActivityCollapsed}
        leaderboardCollapsed={leaderboardCollapsed}
        setLeaderboardCollapsed={setLeaderboardCollapsed}
        activityCollapsed={activityCollapsed}
        notifications={notifications}
        markNotificationRead={markNotificationRead}
        directChat={directChat}
        playSound={playSound}
      />

      {/* Mobile View Content */}
      <MobileOrdersView
        mobileView={mobileView}
        setMobileView={setMobileView}
        bigOrders={bigOrders}
        dismissBigOrder={dismissBigOrder}
        pendingOrders={pendingOrders}
        ongoingOrders={ongoingOrders}
        completedOrders={completedOrders}
        cancelledOrders={cancelledOrders}
        merchantId={merchantId}
        merchantInfo={merchantInfo}
        historyTab={historyTab}
        setHistoryTab={setHistoryTab}
        marketSubTab={marketSubTab}
        setMarketSubTab={setMarketSubTab}
        markingDone={markingDone}
        effectiveBalance={effectiveBalance}
        totalTradedVolume={totalTradedVolume}
        todayEarnings={todayEarnings}
        pendingEarnings={pendingEarnings}
        directChat={directChat}
        acceptOrder={acceptOrder}
        handleOpenChat={handleOpenChat}
        openEscrowModal={openEscrowModal}
        markFiatPaymentSent={markFiatPaymentSent}
        openReleaseModal={openReleaseModal}
        openDisputeModal={openDisputeModal}
        openCancelModal={openCancelModal}
        setShowAnalytics={setShowAnalytics}
        setShowWalletModal={setShowWalletModal}
        setShowCreateModal={setShowCreateModal}
        setShowOpenTradeModal={setShowOpenTradeModal}
        setOpenTradeForm={setOpenTradeForm}
        handleLogout={handleLogout}
        playSound={playSound}
      />

      {/* Mobile FAB + Bottom Navigation */}
      <MobileBottomNav
        mobileView={mobileView}
        setMobileView={setMobileView}
        setShowOpenTradeModal={setShowOpenTradeModal}
        pendingOrders={pendingOrders}
        ongoingOrders={ongoingOrders}
        totalUnread={totalUnread}
      />

      {/* Create Corridor Modal */}
      <CreateCorridorModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        corridorForm={corridorForm}
        setCorridorForm={setCorridorForm}
        effectiveBalance={effectiveBalance}
        refreshBalance={refreshBalance}
        merchantId={merchantId}
        solanaWallet={solanaWallet}
        fetchActiveOffers={fetchActiveOffers}
      />

      {/* Open Trade Modal - Merchant initiates trade */}
      <OpenTradeModal
        isOpen={showOpenTradeModal}
        onClose={() => {
          setShowOpenTradeModal(false);
          setCreateTradeError(null);
        }}
        openTradeForm={openTradeForm}
        setOpenTradeForm={setOpenTradeForm}
        effectiveBalance={effectiveBalance}
        refreshBalance={refreshBalance}
        merchantId={merchantId}
        isMockMode={isMockMode}
        tradeAmountWarning={tradeAmountWarning}
        isCreatingTrade={isCreatingTrade}
        setIsCreatingTrade={setIsCreatingTrade}
        createTradeError={createTradeError}
        setCreateTradeError={setCreateTradeError}
        solanaWallet={solanaWallet}
        setOrders={setOrders}
        playSound={playSound}
        addNotification={addNotification}
      />

      {/* Dispute Modal */}
      <DisputeModal
        isOpen={showDisputeModal}
        onClose={() => setShowDisputeModal(false)}
        disputeReason={disputeReason}
        onReasonChange={setDisputeReason}
        disputeDescription={disputeDescription}
        onDescriptionChange={setDisputeDescription}
        isSubmitting={isSubmittingDispute}
        onSubmit={submitDispute}
      />

      {/* Escrow Lock Modal */}
      <EscrowLockModal
        showEscrowModal={showEscrowModal}
        escrowOrder={escrowOrder}
        isLockingEscrow={isLockingEscrow}
        escrowTxHash={escrowTxHash}
        escrowError={escrowError}
        effectiveBalance={effectiveBalance}
        isMockMode={isMockMode}
        IS_EMBEDDED_WALLET={IS_EMBEDDED_WALLET}
        closeEscrowModal={closeEscrowModal}
        executeLockEscrow={executeLockEscrow}
      />

      {/* Escrow Release Modal */}
      <EscrowReleaseModal
        showReleaseModal={showReleaseModal}
        releaseOrder={releaseOrder}
        isReleasingEscrow={isReleasingEscrow}
        releaseTxHash={releaseTxHash}
        releaseError={releaseError}
        isMockMode={isMockMode}
        closeReleaseModal={closeReleaseModal}
        executeRelease={executeRelease}
      />

      {/* Cancel/Withdraw Escrow Modal */}
      <EscrowCancelModal
        showCancelModal={showCancelModal}
        cancelOrder={cancelOrder}
        isCancellingEscrow={isCancellingEscrow}
        cancelTxHash={cancelTxHash}
        cancelError={cancelError}
        closeCancelModal={closeCancelModal}
        executeCancelEscrow={executeCancelEscrow}
      />

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Merchant" accentColor="#f97316" />

      {/* Wallet Required Modal — redirects to /merchant/wallet */}
      <WalletRequiredModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onGoToWallet={() => router.push('/merchant/wallet')}
      />

      {/* Username Modal for New Merchant Wallet Users */}
      {(solanaWallet.walletAddress || (typeof window !== 'undefined' && (window as any).phantom?.solana?.publicKey)) && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={solanaWallet.walletAddress || (window as any).phantom?.solana?.publicKey?.toString()}
          onSubmit={handleMerchantUsername}
          canClose={false}
          apiEndpoint="/api/auth/merchant"
        />
      )}

      {/* Profile Picture Modal */}
      <MerchantProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        merchantId={merchantId || ''}
        currentAvatar={merchantInfo?.avatar_url}
        currentDisplayName={merchantInfo?.display_name}
        currentBio={merchantInfo?.bio}
        onProfileUpdated={handleProfileUpdated}
      />

      {/* Transaction History Modal */}
      <TransactionHistoryModal
        isOpen={showTransactionHistory}
        onClose={() => setShowTransactionHistory(false)}
        merchantId={merchantId || ''}
      />

      {/* Payment Methods Modal */}
      <PaymentMethodModal
        isOpen={showPaymentMethods}
        onClose={() => setShowPaymentMethods(false)}
        merchantId={merchantId || ''}
      />

      {/* Rating Modal */}
      {ratingModalData && merchantId && (
        <RatingModal
          orderId={ratingModalData.orderId}
          counterpartyName={ratingModalData.counterpartyName}
          counterpartyType={ratingModalData.counterpartyType}
          raterType="merchant"
          raterId={merchantId}
          onClose={() => setRatingModalData(null)}
          onSubmit={async (rating, review) => {
            try {
              const res = await fetch('/api/ratings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  order_id: ratingModalData.orderId,
                  rater_type: 'merchant',
                  rater_id: merchantId,
                  rating,
                  review_text: review,
                }),
              });

              if (res.ok) {
                toast.show({
                  type: 'complete',
                  title: 'Rating Submitted',
                  message: `You rated ${ratingModalData.counterpartyName} ${rating} stars`,
                });
                // Refresh orders to update rating status
                fetchOrders();
              } else {
                const data = await res.json();
                throw new Error(data.error || 'Failed to submit rating');
              }
            } catch (error) {
              console.error('Failed to submit rating:', error);
              throw error;
            }
          }}
        />
      )}

      {/* Merchant Quote Modal */}
      {merchantId && (
        <MerchantQuoteModal
          merchantId={merchantId}
          corridorId="USDT_AED"
          isOpen={showMerchantQuoteModal}
          onClose={() => setShowMerchantQuoteModal(false)}
        />
      )}

      {/* Order Inspector Modal */}
      {selectedMempoolOrder && merchantId && (
        <OrderInspector
          order={selectedMempoolOrder}
          merchantId={merchantId}
          onClose={() => setSelectedMempoolOrder(null)}
          onBump={(orderId) => {
            setSelectedMempoolOrder(null);
          }}
          onAccept={(orderId) => {
            setSelectedMempoolOrder(null);
          }}
        />
      )}

      {/* Wallet Connection Prompt - shown after login if no wallet connected */}
      <WalletPromptModal
        isOpen={showWalletPrompt && !isMockMode && !IS_EMBEDDED_WALLET && !solanaWallet.connected}
        onClose={() => setShowWalletPrompt(false)}
        onConnectWallet={() => setShowWalletModal(true)}
      />

      {/* Order Detail Popup */}
      <OrderDetailPopup
        order={selectedOrderPopup}
        onClose={() => setSelectedOrderPopup(null)}
        onViewFullDetails={(orderId) => setSelectedOrderId(orderId)}
        merchantId={merchantId}
        isMockMode={isMockMode}
        cancelOrderWithoutEscrow={cancelOrderWithoutEscrow}
        acceptOrder={acceptOrder}
        openEscrowModal={openEscrowModal}
        markFiatPaymentSent={markFiatPaymentSent}
        confirmPayment={confirmPayment}
        executeRelease={executeRelease}
        openReleaseModal={openReleaseModal}
        handleOpenChat={handleOpenChat}
        openDisputeModal={openDisputeModal}
        isAccepting={isAccepting}
        isCancellingOrder={isCancellingOrder}
        isConfirmingPayment={isConfirmingPayment}
        isReleasingEscrow={isReleasingEscrow}
        isCompleting={isCompleting}
        markingDone={markingDone}
      />

      {/* Order Details Panel */}
      {selectedOrderId && merchantId && (
        <OrderDetailsPanel
          orderId={selectedOrderId}
          merchantId={merchantId}
          onClose={() => setSelectedOrderId(null)}
          onOpenChat={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) handleOpenChat(order);
            setSelectedOrderId(null);
          }}
          onConfirmPayment={confirmPayment}
          onMarkPaymentSent={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) markPaymentSent(order);
          }}
          onAcceptOrder={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) acceptOrder(order);
          }}
          onCancelOrder={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) {
              if (order.escrowTxHash) {
                openCancelModal(order);
              } else {
                cancelOrderWithoutEscrow(order.id);
              }
            }
          }}
          onLockEscrow={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) openEscrowModal(order);
          }}
          onReleaseEscrow={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) openReleaseModal(order);
          }}
          onOpenDispute={openDisputeModal}
        />
      )}

      {/* Message History Panel (Desktop) */}
      <AnimatePresence>
        {showMessageHistory && merchantId && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md z-50 shadow-2xl bg-[#060606] border-l border-white/[0.04]"
          >
            {directChat.activeContactId ? (
              <DirectChatView
                contactName={directChat.activeContactName}
                contactType={directChat.activeContactType}
                messages={directChat.messages}
                isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => {
                  directChat.sendMessage(text, imageUrl);
                  playSound('send');
                }}
                onBack={() => directChat.closeChat()}
              />
            ) : (
              <MerchantChatTabs
                merchantId={merchantId}
                conversations={directChat.conversations}
                totalUnread={directChat.totalUnread}
                isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => directChat.openChat(targetId, targetType, username)}
                onClose={() => setShowMessageHistory(false)}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analytics Dashboard Modal */}
      <AnimatePresence>
        {showAnalytics && merchantId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowAnalytics(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-zinc-900 z-10">
                <h2 className="text-lg font-semibold text-white">Analytics Dashboard</h2>
                <button
                  onClick={() => setShowAnalytics(false)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/60" />
                </button>
              </div>
              <div className="p-6">
                <AnalyticsDashboard merchantId={merchantId} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wallet lives on /merchant/wallet — no popups needed */}
    </div>
  );
}
