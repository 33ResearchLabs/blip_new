"use client";

import { LandingPage } from "@/components/user/LandingPage";
import { useState, useRef } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useSounds } from "@/hooks/useSounds";
import { NotificationToastContainer, useToast } from "@/components/NotificationToast";
import { useUserAuth } from "@/hooks/useUserAuth";
import { UserModals } from "@/components/user/UserModals";
import { useUserDataFetching } from "@/hooks/useUserDataFetching";
import { useUserTradeCreation } from "@/hooks/useUserTradeCreation";
import { useUserOrderActions } from "@/hooks/useUserOrderActions";
import { useUserEffects } from "@/hooks/useUserEffects";
import { useSolanaWalletSafe } from "@/hooks/useSolanaWalletSafe";

import type { Screen } from "@/components/user/screens/types";
import { FEE_CONFIG } from "@/components/user/screens/helpers";

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
const slide = { initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -20 } };
const darkBg = { background: '#080810' } as const;
function Panel({ k, anim = fade, className = "", style, children }: { k: string; anim?: typeof fade; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return <motion.div key={k} {...anim} className={`flex-1 w-full max-w-[440px] mx-auto flex flex-col ${className}`} style={style}>{children}</motion.div>;
}
import {
  HomeScreen,
  TradeCreationScreen,
  EscrowLockScreen,
  OrderDetailScreen,
  OrdersListScreen,
  ProfileScreen,
  ChatListScreen,
  ChatViewScreen,
  CreateOfferScreen,
  CashConfirmScreen,
  MatchingScreen,
  WalletScreen,
} from "@/components/user/screens";

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { playSound } = useSounds();
  const toast = useToast();
  const solanaWallet = useSolanaWalletSafe();

  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  } | undefined;

  const [screen, setScreen] = useState<Screen>("home");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<'active' | 'completed'>('active');
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState(0);
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({ bank: "", iban: "", name: "" });
  const [timedOutOrders, setTimedOutOrders] = useState<any[]>([]);
  const [pendingTradeData, setPendingTradeData] = useState<{ amount: string; fiatAmount: string; type: 'buy' | 'sell'; paymentMethod: 'bank' | 'cash' } | null>(null);
  const extensionRequestSetterRef = useRef<(req: any) => void>(() => {});

  // Data fetching
  const { orders, setOrders, bankAccounts, setBankAccounts, resolvedDisputes, setResolvedDisputes, fetchOrders, fetchBankAccounts, fetchResolvedDisputes, addBankAccount } = useUserDataFetching();

  // Auth
  const auth = useUserAuth({
    setScreen,
    setOrders,
    setBankAccounts,
    setResolvedDisputes,
    solanaWallet,
    escrowTxStatus: 'idle',
    setEscrowTxStatus: () => {},
    fetchOrders,
    fetchBankAccounts,
    fetchResolvedDisputes,
  });

  // Trade creation
  const tradeCreation = useUserTradeCreation({
    userId: auth.userId,
    setScreen,
    setOrders,
    setActiveOrderId,
    setPendingTradeData,
    solanaWallet,
    playSound,
    toast,
    setUserId: auth.setUserId,
    setShowWalletModal: auth.setShowWalletModal,
  });

  // Effects (realtime, timers, chat)
  const userEffects = useUserEffects({
    userId: auth.userId,
    screen,
    setScreen,
    activeOrderId,
    orders,
    setOrders,
    pendingTradeData,
    setPendingTradeData,
    escrowTxStatus: tradeCreation.escrowTxStatus,
    setEscrowTxStatus: tradeCreation.setEscrowTxStatus,
    setAmount: tradeCreation.setAmount,
    setSelectedOffer: tradeCreation.setSelectedOffer,
    solanaWallet,
    playSound,
    toast,
    setExtensionRequest: (req: any) => { extensionRequestSetterRef.current(req); },
  });

  const { activeOrder } = userEffects;

  // Order actions
  const orderActions = useUserOrderActions({
    userId: auth.userId,
    activeOrder,
    solanaWallet,
    playSound,
    toast,
    showBrowserNotification: userEffects.showBrowserNotification,
    setOrders,
    setIsLoading: auth.setIsLoading,
    fetchOrders,
  });
  extensionRequestSetterRef.current = orderActions.setExtensionRequest;

  const pendingOrders = orders.filter(o => o.status !== "complete");
  const completedOrders = orders.filter(o => o.status === "complete");

  const fiatAmount = tradeCreation.amount ? (parseFloat(tradeCreation.amount) * tradeCreation.currentRate).toFixed(2) : "0";
  const currentFees = FEE_CONFIG[tradeCreation.tradePreference];

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddBankAccount = async () => {
    const success = await addBankAccount(newBank, auth.userId);
    if (success) {
      setNewBank({ bank: "", iban: "", name: "" });
      setShowAddBank(false);
    }
  };

  const maxW = "max-w-[440px] mx-auto";

  if (auth.isInitializing) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center overflow-y-auto relative" style={{ background: '#0a0a0a' }}>
      <NotificationToastContainer position="top-right" />
      <AnimatePresence mode="wait">
        {screen === "welcome" && (
          <LandingPage
            loginForm={auth.loginForm}
            setLoginForm={auth.setLoginForm}
            authMode={auth.authMode}
            setAuthMode={auth.setAuthMode}
            handleUserLogin={auth.handleUserLogin}
            handleUserRegister={auth.handleUserRegister}
            isLoggingIn={auth.isLoggingIn}
            loginError={auth.loginError}
            setLoginError={auth.setLoginError}
          />
        )}

        {screen === "home" && (
          <Panel k="home" className="relative" style={darkBg}>
            <HomeScreen
              userName={auth.userName}
              userId={auth.userId}
              orders={orders}
              completedOrders={completedOrders}
              pendingOrders={pendingOrders}
              currentRate={tradeCreation.currentRate}
              screen={screen}
              setScreen={setScreen}
              setTradeType={tradeCreation.setTradeType}
              setActiveOrderId={setActiveOrderId}
              setPendingTradeData={setPendingTradeData}
              setShowWalletModal={auth.setShowWalletModal}
              setShowWalletSetup={auth.setShowWalletSetup}
              setShowWalletUnlock={auth.setShowWalletUnlock}
              solanaWallet={solanaWallet}
              embeddedWallet={embeddedWallet}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "trade" && (
          <Panel k="trade" anim={slide}>
            <TradeCreationScreen
              screen={screen}
              setScreen={setScreen}
              tradeType={tradeCreation.tradeType}
              setTradeType={tradeCreation.setTradeType}
              tradePreference={tradeCreation.tradePreference}
              setTradePreference={tradeCreation.setTradePreference}
              paymentMethod={tradeCreation.paymentMethod}
              setPaymentMethod={tradeCreation.setPaymentMethod}
              amount={tradeCreation.amount}
              setAmount={tradeCreation.setAmount}
              fiatAmount={fiatAmount}
              currentFees={currentFees}
              isLoading={tradeCreation.isLoading}
              userId={auth.userId}
              startTrade={tradeCreation.startTrade}
              solanaWallet={solanaWallet}
            />
          </Panel>
        )}

        {screen === "escrow" && (
          <Panel k="escrow" anim={slide}>
            <EscrowLockScreen
              setScreen={setScreen}
              amount={tradeCreation.amount}
              fiatAmount={fiatAmount}
              currentRate={tradeCreation.currentRate}
              escrowTxStatus={tradeCreation.escrowTxStatus}
              setEscrowTxStatus={tradeCreation.setEscrowTxStatus}
              escrowTxHash={tradeCreation.escrowTxHash}
              escrowError={tradeCreation.escrowError}
              setEscrowError={tradeCreation.setEscrowError}
              isLoading={tradeCreation.isLoading}
              confirmEscrow={tradeCreation.confirmEscrow}
              selectedBankDetails={tradeCreation.selectedBankDetails}
              setSelectedBankDetails={tradeCreation.setSelectedBankDetails}
              userId={auth.userId}
              setShowWalletModal={auth.setShowWalletModal}
              onConnectWallet={() => {
                if (embeddedWallet) {
                  if (embeddedWallet.state === 'none') auth.setShowWalletSetup(true);
                  else if (embeddedWallet.state === 'locked') auth.setShowWalletUnlock(true);
                } else {
                  auth.setShowWalletModal(true);
                }
              }}
              solanaWallet={solanaWallet}
            />
          </Panel>
        )}

        {screen === "order" && activeOrder && (
          <Panel k="order" anim={slide}>
            <OrderDetailScreen
              setScreen={setScreen}
              activeOrder={activeOrder}
              isLoading={auth.isLoading}
              setIsLoading={auth.setIsLoading}
              handleOpenChat={userEffects.handleOpenChat}
              markPaymentSent={orderActions.markPaymentSent}
              confirmFiatReceived={orderActions.confirmFiatReceived}
              rating={rating}
              setRating={setRating}
              copied={copied}
              handleCopy={handleCopy}
              extensionRequest={orderActions.extensionRequest}
              requestExtension={orderActions.requestExtension}
              respondToExtension={orderActions.respondToExtension}
              requestingExtension={orderActions.requestingExtension}
              showChat={userEffects.showChat}
              setShowChat={userEffects.setShowChat}
              chatMessage={userEffects.chatMessage}
              setChatMessage={userEffects.setChatMessage}
              chatInputRef={userEffects.chatInputRef}
              chatMessagesRef={userEffects.chatMessagesRef}
              activeChat={userEffects.activeChat as any}
              handleSendMessage={userEffects.handleSendMessage}
              sendChatMessage={userEffects.sendChatMessage}
              sendTypingIndicator={userEffects.sendTypingIndicator}
              showDisputeModal={orderActions.showDisputeModal}
              setShowDisputeModal={orderActions.setShowDisputeModal}
              disputeReason={orderActions.disputeReason}
              setDisputeReason={orderActions.setDisputeReason}
              disputeDescription={orderActions.disputeDescription}
              setDisputeDescription={orderActions.setDisputeDescription}
              submitDispute={orderActions.submitDispute}
              isSubmittingDispute={orderActions.isSubmittingDispute}
              disputeInfo={orderActions.disputeInfo}
              respondToResolution={orderActions.respondToResolution}
              isRespondingToResolution={orderActions.isRespondingToResolution}
              requestCancelOrder={orderActions.requestCancelOrder}
              respondToCancelRequest={orderActions.respondToCancelRequest}
              isRequestingCancel={orderActions.isRequestingCancel}
              solanaWallet={solanaWallet}
              setShowWalletModal={auth.setShowWalletModal}
              userId={auth.userId}
              setOrders={setOrders}
              playSound={playSound}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "order" && !activeOrder && activeOrderId && (
          <Panel k="order-loading" className="items-center justify-center">
            <div className="h-12" />
            <div className="px-5 py-4 flex items-center w-full">
              <button onClick={() => setScreen("home")} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Order Details</h1>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto mb-3" />
                <p className="text-[15px] text-neutral-400">Loading order...</p>
              </div>
            </div>
          </Panel>
        )}

        {screen === "orders" && (
          <Panel k="orders" className="relative" style={darkBg}>
            <OrdersListScreen
              screen={screen}
              setScreen={setScreen}
              setActiveOrderId={setActiveOrderId}
              activityTab={activityTab}
              setActivityTab={setActivityTab}
              pendingOrders={pendingOrders}
              completedOrders={completedOrders}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "profile" && (
          <Panel k="profile" className="overflow-hidden relative" style={darkBg}>
            <ProfileScreen
              screen={screen}
              setScreen={setScreen}
              userName={auth.userName}
              completedOrders={completedOrders}
              timedOutOrders={timedOutOrders}
              solanaWallet={solanaWallet}
              setShowWalletModal={auth.setShowWalletModal}
              copied={copied}
              setCopied={setCopied}
              bankAccounts={bankAccounts}
              showAddBank={showAddBank}
              setShowAddBank={setShowAddBank}
              newBank={newBank}
              setNewBank={setNewBank}
              addBankAccount={handleAddBankAccount}
              resolvedDisputes={resolvedDisputes}
              theme={theme}
              toggleTheme={toggleTheme}
              isAuthenticatingRef={auth.isAuthenticatingRef}
              lastAuthenticatedWalletRef={auth.lastAuthenticatedWalletRef}
              authAttemptedForWalletRef={auth.authAttemptedForWalletRef}
              setShowUsernameModal={auth.setShowUsernameModal}
              setUserId={auth.setUserId}
              setUserWallet={auth.setUserWallet}
              setUserName={auth.setUserName}
              setUserBalance={auth.setUserBalance}
              setOrders={setOrders}
              setBankAccounts={setBankAccounts}
              setResolvedDisputes={setResolvedDisputes}
              setLoginError={auth.setLoginError}
              setLoginForm={auth.setLoginForm}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "chats" && (
          <Panel k="chats">
            <ChatListScreen
              screen={screen}
              setScreen={setScreen}
              orders={orders}
              setActiveOrderId={setActiveOrderId}
              setOrders={setOrders}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "chat-view" && activeOrder && (
          <Panel k="chat-view" anim={slide} className="h-dvh">
            <ChatViewScreen
              setScreen={setScreen}
              activeOrder={activeOrder}
              activeChat={userEffects.activeChat}
              chatMessage={userEffects.chatMessage}
              setChatMessage={userEffects.setChatMessage}
              sendChatMessage={userEffects.sendChatMessage}
              chatMessagesRef={userEffects.chatMessagesRef}
            />
          </Panel>
        )}

        {screen === "create-offer" && (
          <Panel k="create-offer" anim={slide}>
            <CreateOfferScreen
              setScreen={setScreen}
              tradeType={tradeCreation.tradeType}
              setTradeType={tradeCreation.setTradeType}
            />
          </Panel>
        )}

        {screen === "cash-confirm" && tradeCreation.selectedOffer && (
          <Panel k="cash-confirm" anim={slide}>
            <CashConfirmScreen
              setScreen={setScreen}
              selectedOffer={tradeCreation.selectedOffer}
              setSelectedOffer={tradeCreation.setSelectedOffer}
              tradeType={tradeCreation.tradeType}
              amount={tradeCreation.amount}
              fiatAmount={fiatAmount}
              isLoading={tradeCreation.isLoading}
              confirmCashOrder={tradeCreation.confirmCashOrder}
            />
          </Panel>
        )}

        {screen === "wallet" && (
          <Panel k="wallet">
            <WalletScreen
              screen={screen}
              setScreen={setScreen}
              solanaWallet={solanaWallet}
              embeddedWallet={embeddedWallet}
              setShowWalletModal={auth.setShowWalletModal}
              setShowWalletSetup={auth.setShowWalletSetup}
              setShowWalletUnlock={auth.setShowWalletUnlock}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "matching" && pendingTradeData && (
          <Panel k="matching">
            <MatchingScreen
              setScreen={setScreen}
              pendingTradeData={pendingTradeData}
              matchingTimeLeft={userEffects.matchingTimeLeft}
              formatTimeLeft={userEffects.formatTimeLeft}
              currentRate={tradeCreation.currentRate}
              activeOrderId={activeOrderId}
              userId={auth.userId}
              setOrders={setOrders}
              setPendingTradeData={setPendingTradeData}
              toast={toast}
              maxW={maxW}
            />
          </Panel>
        )}
      </AnimatePresence>

      <UserModals
        showWalletModal={auth.showWalletModal}
        setShowWalletModal={auth.setShowWalletModal}
        handleSolanaWalletConnect={auth.handleSolanaWalletConnect}
        showWalletUnlock={auth.showWalletUnlock}
        setShowWalletUnlock={auth.setShowWalletUnlock}
        showWalletSetup={auth.showWalletSetup}
        setShowWalletSetup={auth.setShowWalletSetup}
        embeddedWallet={embeddedWallet}
        solanaWallet={solanaWallet}
        showUsernameModal={auth.showUsernameModal}
        handleWalletUsername={auth.handleWalletUsername}
        showAcceptancePopup={userEffects.showAcceptancePopup}
        setShowAcceptancePopup={userEffects.setShowAcceptancePopup}
        acceptedOrderInfo={userEffects.acceptedOrderInfo}
      />
    </div>
  );
}
