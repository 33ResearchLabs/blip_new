"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { NotificationToastContainer } from "@/components/NotificationToast";

// ─── Design system ───────────────────────────────────────────────────────────
import AmbientGlow from "@/components/user/shared/AmbientGlow";
import BottomNavBar from "@/components/user/shared/BottomNavBar";
import WelcomeScreen from "@/components/user/WelcomeScreen";
import HomeScreen from "@/components/user/HomeScreen";
import SuccessScreen from "@/components/user/SuccessScreen";

// ─── Extracted screen & modal components ─────────────────────────────────────
import { SendTradeScreen } from "./_components/SendTradeScreen";
import { EscrowScreen } from "./_components/EscrowScreen";
import { OrderScreen } from "./_components/OrderScreen";
import { OrderLoadingScreen } from "./_components/OrderLoadingScreen";
import { OrdersListScreen } from "./_components/OrdersListScreen";
import { ProfileScreen } from "./_components/ProfileScreen";
import { ChatsListScreen } from "./_components/ChatsListScreen";
import { ChatViewScreen } from "./_components/ChatViewScreen";
import { CreateOfferScreen } from "./_components/CreateOfferScreen";
import { CashConfirmScreen } from "./_components/CashConfirmScreen";
import { MatchingScreen } from "./_components/MatchingScreen";
import { UserWalletModals } from "./_components/UserWalletModals";
import { AcceptancePopup } from "./_components/AcceptancePopup";

import { useUserDashboard } from "./_hooks/useUserDashboard";

export default function Home() {
  const {
    theme, toggleTheme, playSound, toast,
    screen, setScreen,
    tradeType, setTradeType, tradePreference, setTradePreference,
    paymentMethod, setPaymentMethod, amount, setAmount,
    selectedOffer, setSelectedOffer, currentRate,
    orders, setOrders, activeOrderId, setActiveOrderId,
    activityTab, setActivityTab,
    pendingOrders, completedOrders,
    timedOutOrders, timerTick,
    activeOrder, activeChat,
    chatWindows, openChat, sendChatMessage,
    realtimeOrder, refetchActiveOrder,
    userId, setUserId, userName, setUserName,
    userBalance, setUserBalance, userWallet, setUserWallet,
    newUserName, setNewUserName,
    loginForm, setLoginForm, authMode, setAuthMode,
    loginError, setLoginError,
    isLoggingIn, isLoading, setIsLoading, isInitializing,
    solanaWallet, embeddedWallet, IS_EMBEDDED_WALLET,
    showWalletModal, setShowWalletModal,
    showUsernameModal, setShowUsernameModal,
    showWalletSetup, setShowWalletSetup,
    showWalletUnlock, setShowWalletUnlock,
    walletUsername, setWalletUsername,
    usernameError, setUsernameError,
    isAuthenticating, isAuthenticatingRef, lastAuthenticatedWalletRef, authAttemptedForWalletRef,
    bankAccounts, setBankAccounts,
    showAddBank, setShowAddBank,
    newBank, setNewBank,
    showChat, setShowChat,
    chatMessage, setChatMessage,
    chatInputRef, chatMessagesRef,
    escrowTxStatus, setEscrowTxStatus,
    escrowTxHash, setEscrowTxHash,
    escrowError, setEscrowError,
    userBankAccount, setUserBankAccount,
    showDisputeModal, setShowDisputeModal,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute, disputeInfo,
    isRespondingToResolution,
    extensionRequest, requestingExtension,
    pendingTradeData, setPendingTradeData, matchingTimeLeft, formatTimeLeft,
    showAcceptancePopup, setShowAcceptancePopup,
    acceptedOrderInfo,
    resolvedDisputes, setResolvedDisputes,
    rating, setRating, copied, setCopied,
    fiatAmount, currentFees,
    handleUserLogin, handleUserRegister,
    handleWalletUsername, handleSolanaWalletConnect,
    createAccount, connectWallet,
    startTrade, confirmCashOrder, confirmEscrow,
    markPaymentSent, confirmFiatReceived,
    submitDispute, respondToResolution, fetchDisputeInfo,
    requestExtension, respondToExtension,
    addBankAccount,
    handleOpenChat, handleSendMessage, handleCopy,
    fetchOrders, fetchBankAccounts, fetchResolvedDisputes,
    showBrowserNotification,
    maxW,
  } = useUserDashboard();

  // Show loading while initializing
  if (isInitializing) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center overflow-y-auto" style={{ background: '#06060e' }}>
      {/* Toast Notifications */}
      <NotificationToastContainer position="top-right" />
      <AnimatePresence mode="wait">
        {/* WELCOME / LOGIN */}
        {screen === "welcome" && (
          <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW}`}>
            <WelcomeScreen
              onLogin={handleUserLogin}
              onRegister={handleUserRegister}
              isLoggingIn={isLoggingIn}
              loginError={loginError}
              setLoginError={setLoginError}
            />
          </motion.div>
        )}

        {/* HOME */}
        {screen === "home" && (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col relative`}>
            <AmbientGlow />
            <HomeScreen
              userName={userName}
              walletConnected={solanaWallet.connected}
              walletAddress={solanaWallet.walletAddress}
              usdtBalance={solanaWallet.usdtBalance}
              orders={orders}
              onNavigateProfile={() => setScreen("profile")}
              onNavigateSend={() => setScreen("send")}
              onNavigateOrder={(orderId, isPending) => {
                setActiveOrderId(orderId);
                if (isPending) {
                  const order = orders.find(o => o.id === orderId);
                  if (order) {
                    setPendingTradeData({
                      amount: order.cryptoAmount,
                      fiatAmount: order.fiatAmount,
                      type: order.type,
                      paymentMethod: order.merchant.paymentMethod,
                    });
                  }
                  setScreen("matching");
                } else {
                  setScreen("order");
                }
              }}
              onConnectWallet={() => {
                if (IS_EMBEDDED_WALLET) {
                  if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                  else if (embeddedWallet?.state === 'none') setShowWalletSetup(true);
                  else solanaWallet.refreshBalances?.();
                } else {
                  setShowWalletModal(true);
                }
              }}
              isEmbeddedWallet={IS_EMBEDDED_WALLET}
              embeddedWalletState={embeddedWallet?.state}
              onSetupWallet={() => setShowWalletSetup(true)}
              onUnlockWallet={() => setShowWalletUnlock(true)}
            />
          </motion.div>
        )}

        {/* SEND / TRADE */}
        {screen === "send" && (
          <SendTradeScreen
            maxW={maxW} setScreen={setScreen}
            tradeType={tradeType} setTradeType={setTradeType}
            amount={amount} setAmount={setAmount}
            fiatAmount={fiatAmount} currentRate={currentRate} currentFees={currentFees}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
            tradePreference={tradePreference} setTradePreference={setTradePreference}
            solanaWallet={solanaWallet} setShowWalletModal={setShowWalletModal}
            startTrade={startTrade} isLoading={isLoading} userId={userId}
          />
        )}

        {/* ESCROW */}
        {screen === "escrow" && (
          <EscrowScreen
            maxW={maxW} amount={amount} fiatAmount={fiatAmount}
            currentRate={currentRate}
            userBankAccount={userBankAccount} setUserBankAccount={setUserBankAccount}
            escrowError={escrowError} setEscrowError={setEscrowError}
            escrowTxStatus={escrowTxStatus} setEscrowTxStatus={setEscrowTxStatus}
            escrowTxHash={escrowTxHash}
            isLoading={isLoading} setScreen={setScreen}
            setShowWalletModal={setShowWalletModal}
            confirmEscrow={confirmEscrow} solanaWallet={solanaWallet}
          />
        )}

        {/* ORDER */}
        {screen === "order" && activeOrder && (
          <OrderScreen
            activeOrder={activeOrder} userId={userId!} orders={orders}
            solanaWallet={solanaWallet} setShowWalletModal={setShowWalletModal}
            showChat={showChat} setShowChat={setShowChat}
            showDisputeModal={showDisputeModal} setShowDisputeModal={setShowDisputeModal}
            disputeReason={disputeReason} setDisputeReason={setDisputeReason}
            disputeDescription={disputeDescription} setDisputeDescription={setDisputeDescription}
            isSubmittingDispute={isSubmittingDispute} submitDispute={submitDispute}
            disputeInfo={disputeInfo} respondToResolution={respondToResolution}
            isRespondingToResolution={isRespondingToResolution}
            activeChat={activeChat} chatMessage={chatMessage} setChatMessage={setChatMessage}
            chatInputRef={chatInputRef} chatMessagesRef={chatMessagesRef}
            handleSendMessage={handleSendMessage} handleOpenChat={handleOpenChat}
            markPaymentSent={markPaymentSent} confirmFiatReceived={confirmFiatReceived}
            isLoading={isLoading} setIsLoading={setIsLoading}
            setOrders={setOrders} playSound={playSound}
            escrowTxStatus={escrowTxStatus} setEscrowTxStatus={setEscrowTxStatus}
            escrowTxHash={escrowTxHash} escrowError={escrowError}
            setScreen={setScreen} setActiveOrderId={setActiveOrderId} maxW={maxW}
            rating={rating} setRating={setRating}
            copied={copied} setCopied={setCopied} handleCopy={handleCopy}
            extensionRequest={extensionRequest} requestExtension={requestExtension}
            requestingExtension={requestingExtension} respondToExtension={respondToExtension}
            fetchDisputeInfo={fetchDisputeInfo}
            realtimeOrder={realtimeOrder} refetchActiveOrder={refetchActiveOrder}
          />
        )}

        {/* ORDER - Loading */}
        {screen === "order" && !activeOrder && activeOrderId && (
          <OrderLoadingScreen maxW={maxW} setScreen={setScreen} setActiveOrderId={setActiveOrderId} />
        )}

        {/* ORDERS */}
        {screen === "orders" && (
          <OrdersListScreen
            maxW={maxW} setScreen={setScreen} setActiveOrderId={setActiveOrderId}
            activityTab={activityTab} setActivityTab={setActivityTab}
            pendingOrders={pendingOrders} completedOrders={completedOrders}
            timerTick={timerTick}
          />
        )}

        {/* PROFILE */}
        {screen === "profile" && (
          <ProfileScreen
            userName={userName} solanaWallet={solanaWallet}
            copied={copied} setCopied={setCopied}
            bankAccounts={bankAccounts} setBankAccounts={setBankAccounts}
            showAddBank={showAddBank} setShowAddBank={setShowAddBank}
            newBank={newBank} setNewBank={setNewBank}
            addBankAccount={addBankAccount}
            completedOrders={completedOrders} timedOutOrders={timedOutOrders}
            resolvedDisputes={resolvedDisputes} setResolvedDisputes={setResolvedDisputes}
            theme={theme} toggleTheme={toggleTheme} maxW={maxW}
            setShowWalletModal={setShowWalletModal} setShowUsernameModal={setShowUsernameModal}
            setUserId={setUserId} setUserWallet={setUserWallet}
            setUserName={setUserName} setUserBalance={setUserBalance}
            setOrders={setOrders} setLoginError={setLoginError} setLoginForm={setLoginForm}
            isAuthenticatingRef={isAuthenticatingRef}
            lastAuthenticatedWalletRef={lastAuthenticatedWalletRef}
            authAttemptedForWalletRef={authAttemptedForWalletRef}
          />
        )}

        {/* CHATS */}
        {screen === "chats" && (
          <ChatsListScreen
            maxW={maxW} setScreen={setScreen} setActiveOrderId={setActiveOrderId}
            orders={orders} setOrders={setOrders}
          />
        )}

        {/* CHAT VIEW */}
        {screen === "chat-view" && activeOrder && (
          <ChatViewScreen
            maxW={maxW} setScreen={setScreen}
            activeOrder={activeOrder} activeChat={activeChat}
            chatMessage={chatMessage} setChatMessage={setChatMessage}
            sendChatMessage={sendChatMessage} chatMessagesRef={chatMessagesRef}
          />
        )}

        {/* CREATE OFFER */}
        {screen === "create-offer" && (
          <CreateOfferScreen
            maxW={maxW} setScreen={setScreen}
            tradeType={tradeType} setTradeType={setTradeType}
          />
        )}

        {/* CASH CONFIRM */}
        {screen === "cash-confirm" && selectedOffer && (
          <CashConfirmScreen
            maxW={maxW} setScreen={setScreen}
            selectedOffer={selectedOffer} setSelectedOffer={setSelectedOffer}
            tradeType={tradeType} amount={amount} fiatAmount={fiatAmount}
            confirmCashOrder={confirmCashOrder} isLoading={isLoading}
          />
        )}

        {/* MATCHING */}
        {screen === "matching" && pendingTradeData && (
          <MatchingScreen
            pendingTradeData={pendingTradeData} setPendingTradeData={setPendingTradeData}
            matchingTimeLeft={matchingTimeLeft} formatTimeLeft={formatTimeLeft}
            setScreen={setScreen} activeOrderId={activeOrderId}
            setActiveOrderId={setActiveOrderId}
            orders={orders} setOrders={setOrders}
            currentRate={currentRate} userId={userId} maxW={maxW} toast={toast}
          />
        )}

        {/* SUCCESS */}
        {screen === "success" && activeOrder && (
          <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW}`}>
            <SuccessScreen
              amount={activeOrder.cryptoAmount}
              type={activeOrder.type}
              onDone={() => {
                setActiveOrderId(null);
                setScreen("home");
                if (userId) fetchOrders(userId);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Bottom Nav */}
      {['home', 'orders', 'send', 'profile', 'chats'].includes(screen) && (
        <div className={`${maxW} mx-auto`}>
          <BottomNavBar
            active={screen === 'chats' ? 'orders' : screen}
            onChange={(s) => setScreen(s)}
            unreadCount={orders.reduce((sum, o) => sum + (o.unreadCount || 0), 0)}
          />
        </div>
      )}

      {/* Wallet Modals */}
      <UserWalletModals
        IS_EMBEDDED_WALLET={IS_EMBEDDED_WALLET}
        showWalletModal={showWalletModal} setShowWalletModal={setShowWalletModal}
        handleSolanaWalletConnect={handleSolanaWalletConnect}
        showWalletUnlock={showWalletUnlock} setShowWalletUnlock={setShowWalletUnlock}
        showWalletSetup={showWalletSetup} setShowWalletSetup={setShowWalletSetup}
        showUsernameModal={showUsernameModal} handleWalletUsername={handleWalletUsername}
        solanaWallet={solanaWallet} embeddedWallet={embeddedWallet}
      />

      {/* Acceptance Popup */}
      <AcceptancePopup
        showAcceptancePopup={showAcceptancePopup}
        acceptedOrderInfo={acceptedOrderInfo}
        setShowAcceptancePopup={setShowAcceptancePopup}
      />
    </div>
  );
}
