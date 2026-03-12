"use client";

import { LandingPage } from "@/components/user/LandingPage";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useRealtimeOrder } from "@/hooks/useRealtimeOrder";
import { usePusher } from "@/context/PusherContext";
import { copyToClipboard } from "@/lib/clipboard";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  X,
  Check,
  Loader2,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useSounds } from "@/hooks/useSounds";
import { NotificationToastContainer, useToast, ConnectionIndicator } from "@/components/NotificationToast";
import dynamic from "next/dynamic";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// Dynamically import wallet components (client-side only)
const WalletConnectModal = dynamic(() => import("@/components/WalletConnectModal"), { ssr: false });
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });
const UnlockWalletPrompt = dynamic(() => import("@/components/wallet/UnlockWalletPrompt").then(mod => ({ default: mod.UnlockWalletPrompt })), { ssr: false });
const EmbeddedWalletSetup = dynamic(() => import("@/components/wallet/EmbeddedWalletSetup").then(mod => ({ default: mod.EmbeddedWalletSetup })), { ssr: false });
const useSolanaWalletHook = () => {
  // This will be replaced with actual hook on client side
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
      connect: () => {},
      disconnect: () => {},
      openWalletModal: () => {},
      solBalance: null,
      usdtBalance: null,
      refreshBalances: async () => {},
      depositToEscrow: async (_params: { amount: number; merchantWallet: string; tradeId?: number }) => ({
        txHash: '',
        success: false,
        tradePda: undefined,
        escrowPda: undefined,
        tradeId: undefined,
      }),
      releaseEscrow: async () => ({ txHash: '', success: false }),
      // V2.3: Payment confirmation & disputes
      confirmPayment: async () => ({ txHash: '', success: false }),
      openDispute: async () => ({ txHash: '', success: false }),
      network: 'devnet' as const,
      programReady: false,
      reinitializeProgram: () => {},
    };
  }
};

// Types, helpers, and components extracted to @/components/user/screens/
import type {
  Screen,
  TradeType,
  TradePreference,
  PaymentMethod,
  OrderStep,
  OrderStatus,
  Offer,
  DbOrder,
  Order,
  BankAccount,
} from "@/components/user/screens/types";
import { mapDbStatusToUI, mapDbOrderToUI, FEE_CONFIG } from "@/components/user/screens/helpers";
import { HomeAmbientGlow } from "@/components/user/screens/HomeDecorations";
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
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { playSound } = useSounds();
  const toast = useToast();
  const [screen, setScreen] = useState<Screen>("home");
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [tradePreference, setTradePreference] = useState<TradePreference>("fast");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [amount, setAmount] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activityTab, setActivityTab] = useState<'active' | 'completed'>('active');
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({ bank: "", iban: "", name: "" });
  const [showChat, setShowChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState(0);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [disputeInfo, setDisputeInfo] = useState<{
    id: string;
    status: string;
    reason: string;
    proposed_resolution?: string;
    resolution_notes?: string;
    user_confirmed?: boolean;
    merchant_confirmed?: boolean;
  } | null>(null);
  const [isRespondingToResolution, setIsRespondingToResolution] = useState(false);
  const [extensionRequest, setExtensionRequest] = useState<{
    orderId: string;
    requestedBy: 'user' | 'merchant';
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  } | null>(null);
  const [requestingExtension, setRequestingExtension] = useState(false);
  const [isRequestingCancel, setIsRequestingCancel] = useState(false);
  const [pendingTradeData, setPendingTradeData] = useState<{ amount: string; fiatAmount: string; type: TradeType; paymentMethod: PaymentMethod } | null>(null);
  const [matchingTimeLeft, setMatchingTimeLeft] = useState<number>(15 * 60); // 15 minutes in seconds
  const [timedOutOrders, setTimedOutOrders] = useState<Order[]>([]);
  const [timerTick, setTimerTick] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("Guest");
  const [userBalance, setUserBalance] = useState<number>(0);
  const [newUserName, setNewUserName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [currentRate, setCurrentRate] = useState(3.67);
  const [chatMessage, setChatMessage] = useState("");
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // Solana wallet state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [walletUsername, setWalletUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isAuthenticatingRef = useRef(false); // Ref for synchronous check (state updates are async)
  const lastAuthenticatedWalletRef = useRef<string | null>(null); // Track which wallet we already authenticated
  const authAttemptedForWalletRef = useRef<string | null>(null); // Track wallet we've already tried (success or failure)
  const solanaWallet = useSolanaWalletHook();

  // Embedded wallet UI state
  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  } | undefined;
  const [showWalletSetup, setShowWalletSetup] = useState(false);
  const [showWalletUnlock, setShowWalletUnlock] = useState(false);

  // Escrow transaction state
  const [escrowTxStatus, setEscrowTxStatus] = useState<'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error'>('idle');

  // Merchant acceptance popup state
  const [showAcceptancePopup, setShowAcceptancePopup] = useState(false);
  const [acceptedOrderInfo, setAcceptedOrderInfo] = useState<{
    merchantName: string;
    cryptoAmount: number;
    fiatAmount: number;
    orderType: 'buy' | 'sell';
  } | null>(null);
  const [escrowTxHash, setEscrowTxHash] = useState<string | null>(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  // User's bank account for receiving fiat (sell orders)
  const [userBankAccount, setUserBankAccount] = useState('');

  // Resolved disputes state
  const [resolvedDisputes, setResolvedDisputes] = useState<{
    id: string;
    orderId: string;
    orderNumber: string;
    cryptoAmount: number;
    fiatAmount: number;
    otherPartyName: string;
    reason: string;
    resolution: string;
    resolvedInFavorOf: string;
    resolvedAt: string;
  }[]>([]);

  // Real-time Pusher context
  const { setActor } = usePusher();

  // Set actor when user ID is available
  useEffect(() => {
    if (userId) {
      setActor('user', userId);
    }
  }, [userId, setActor]);

  // Wallet linking removed - no automatic wallet actions

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  // Helper to show browser notification
  const showBrowserNotification = useCallback((title: string, body: string, orderId?: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: orderId || 'chat-message',
      });
      notification.onclick = () => {
        window.focus();
        if (orderId) {
          setActiveOrderId(orderId);
          setScreen('chat-view');
        }
        notification.close();
      };
    }
  }, []);

  // Real-time chat hook (replaces polling)
  const {
    chatWindows,
    openChat,
    sendMessage: sendChatMessage,
  } = useRealtimeChat({
    actorType: "user",
    actorId: userId || undefined,
    onNewMessage: (chatId, message) => {
      playSound('message');

      // Update unread count for the order
      setOrders(prev => prev.map(o => {
        if (o.id === chatId && message.from === 'them') {
          return { ...o, unreadCount: (o.unreadCount || 0) + 1 };
        }
        return o;
      }));

      // Show toast + browser notification if not on the chat screen or if it's a different order
      if (message.from === 'them' && (screen !== 'order' || activeOrderId !== chatId)) {
        const order = orders.find(o => o.id === chatId);
        const merchantName = order?.merchant?.name || 'Merchant';
        toast.showNewMessage(merchantName, message.text?.substring(0, 80));
        showBrowserNotification(
          `New message from ${merchantName}`,
          message.text.substring(0, 100),
          chatId
        );
      }
    },
  });

  // Real-time order updates for active order
  const { order: realtimeOrder, refetch: refetchActiveOrder } = useRealtimeOrder(activeOrderId, {
    onStatusChange: (newStatus, previousStatus, orderData) => {
      // Show acceptance notification on ANY screen when merchant accepts the order
      // Also handle when previousStatus is undefined (fallback: if we're on matching screen, treat as pending→accepted)
      const wasPending = previousStatus === 'pending' || (!previousStatus && screen === 'matching');
      if (wasPending && (newStatus === 'accepted' || newStatus === 'escrowed')) {
        const merchantName = orderData?.merchant?.display_name || orderData?.merchant?.business_name || 'Merchant';
        playSound('notification');

        // Show acceptance popup overlay
        setAcceptedOrderInfo({
          merchantName,
          cryptoAmount: orderData?.crypto_amount || 0,
          fiatAmount: orderData?.fiat_amount || 0,
          orderType: orderData?.type || 'buy',
        });
        setShowAcceptancePopup(true);
        setTimeout(() => setShowAcceptancePopup(false), 5000);
        toast.showMerchantAccepted(merchantName);
        showBrowserNotification('Order Accepted!', `${merchantName} accepted your ${orderData?.type || 'buy'} order`, activeOrderId || undefined);

        // Auto-transition to order screen from matching or home
        if (screen === "matching") {
          setPendingTradeData(null);
        }
        if (screen !== "order") {
          setScreen("order");
        }
      }

      // Auto-transition from escrow screen when merchant accepts (for sell orders)
      if (screen === "escrow" && escrowTxStatus === 'success' && (newStatus === 'escrowed' || newStatus === 'accepted')) {
        setScreen("order");
        setEscrowTxStatus('idle');
        setAmount("");
        setSelectedOffer(null);
        playSound('notification');
        toast.showEscrowLocked();
      }

      // Auto-transition when merchant sends payment (user needs to confirm)
      if (newStatus === 'payment_sent') {
        if (screen !== 'order') {
          setScreen("order");
        }
        playSound('notification');
        toast.showPaymentSent();
        showBrowserNotification('Payment Sent', 'The merchant has sent the fiat payment. Please verify.', activeOrderId || undefined);
      }

      // Payment confirmed
      if (newStatus === 'payment_confirmed') {
        playSound('notification');
        toast.show({ type: 'payment', title: 'Payment Confirmed', message: 'Payment has been confirmed!' });
      }

      // Escrow released
      if (newStatus === 'releasing') {
        toast.showEscrowReleased();
      }

      // Play trade complete sound
      if (newStatus === 'completed') {
        playSound('trade_complete');
        toast.showTradeComplete();
        showBrowserNotification('Trade Complete!', 'Your trade has been completed successfully.', activeOrderId || undefined);
        if (solanaWallet.connected) {
          solanaWallet.refreshBalances();
        }
      }

      // Dispute opened
      if (newStatus === 'disputed') {
        playSound('error');
        toast.showDisputeOpened();
        showBrowserNotification('Dispute Opened', 'A dispute has been raised on your order.', activeOrderId || undefined);
      }

      // Cancelled
      if (newStatus === 'cancelled') {
        playSound('error');
        toast.showOrderCancelled();
      }

      // Expired
      if (newStatus === 'expired') {
        toast.showOrderExpired();
      }

      // Update the orders list with new status
      if (activeOrderId) {
        setOrders(prev => prev.map(o => {
          if (o.id === activeOrderId) {
            const { status, step } = mapDbStatusToUI(newStatus);
            return { ...o, status, step, dbStatus: newStatus };
          }
          return o;
        }));
      }

      // Force refetch when status changes to escrowed to ensure UI updates
      // Also auto-call acceptTrade on-chain so the user joins the escrow as counterparty
      if (newStatus === 'escrowed') {
        console.log('[User] Escrow locked - refetching order data');
        refetchActiveOrder();

        // Auto-accept trade on-chain (user joins escrow as counterparty)
        // This is REQUIRED before the merchant can release escrow
        if (solanaWallet.connected && orderData) {
          const escrowCreatorWallet = (orderData as any).escrow_creator_wallet;
          const escrowTradeId = (orderData as any).escrow_trade_id;
          if (escrowCreatorWallet && escrowTradeId) {
            console.log('[User] Auto-calling acceptTrade on-chain:', { escrowCreatorWallet, escrowTradeId });
            solanaWallet.acceptTrade({
              creatorPubkey: escrowCreatorWallet,
              tradeId: Number(escrowTradeId),
            }).then((result: any) => {
              if (result.success) {
                console.log('[User] acceptTrade success:', result.txHash);
              } else {
                console.warn('[User] acceptTrade failed:', result.error);
              }
            }).catch((err: any) => {
              // May fail if already accepted — that's fine
              console.warn('[User] acceptTrade error (may already be accepted):', err.message);
            });
          }
        }
      }
    },
    onExtensionRequested: (data) => {
      if (data.requestedBy === 'merchant') {
        setExtensionRequest({
          orderId: data.orderId,
          requestedBy: data.requestedBy,
          extensionMinutes: data.extensionMinutes,
          extensionCount: data.extensionCount,
          maxExtensions: data.maxExtensions,
        });
        playSound('notification');
        toast.showExtensionRequest('Merchant', data.extensionMinutes);
        showBrowserNotification('Extension Requested', `Merchant requested ${data.extensionMinutes} more minutes`);
      }
    },
    onExtensionResponse: (data) => {
      setExtensionRequest(null);
      if (data.accepted) {
        playSound('click');
        toast.show({ type: 'system', title: 'Extension Accepted', message: 'Time has been extended' });
      } else {
        playSound('error');
        toast.showWarning('Extension request was declined');
      }
    },
  });

  // Active order: prefer real-time data if available, fallback to orders list
  const orderFromList = orders.find(o => o.id === activeOrderId);
  const mappedRealtimeOrder = realtimeOrder ? mapDbOrderToUI(realtimeOrder as unknown as DbOrder) : null;
  const activeOrder = mappedRealtimeOrder
    ? { ...orderFromList, ...mappedRealtimeOrder }
    : orderFromList;

  // Recovery: if on order screen but activeOrder is missing, refetch
  useEffect(() => {
    if (screen === 'order' && !activeOrder && activeOrderId) {
      refetchActiveOrder();
    }
  }, [screen, activeOrder, activeOrderId, refetchActiveOrder]);

  // Auto-accept trade on-chain when viewing an escrowed order (safety net)
  // This ensures the user joins the escrow even if they missed the real-time event
  const acceptTradeCalledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeOrder || !solanaWallet.connected) return;
    const dbStatus = activeOrder.dbStatus || activeOrder.status;
    // Only for buy orders where merchant has locked escrow
    if (activeOrder.type !== 'buy') return;
    if (!['escrowed', 'payment_sent', 'payment_confirmed'].includes(dbStatus)) return;
    if (!activeOrder.escrowCreatorWallet || !activeOrder.escrowTradeId) return;
    if (acceptTradeCalledRef.current.has(activeOrder.id)) return;

    acceptTradeCalledRef.current.add(activeOrder.id);
    console.log('[User] Safety net: calling acceptTrade for escrowed order', activeOrder.id);
    solanaWallet.acceptTrade({
      creatorPubkey: activeOrder.escrowCreatorWallet,
      tradeId: Number(activeOrder.escrowTradeId),
    }).then((result: any) => {
      if (result.success) {
        console.log('[User] acceptTrade success (safety net):', result.txHash);
      }
    }).catch((err: any) => {
      // Expected if already accepted
      console.log('[User] acceptTrade skipped (likely already accepted):', err.message);
    });
  }, [activeOrder?.id, activeOrder?.dbStatus, activeOrder?.escrowCreatorWallet, solanaWallet.connected]);

  // Countdown timer for matching screen - use actual order expiration time
  useEffect(() => {
    if (screen !== "matching" || !pendingTradeData || !activeOrderId) {
      return;
    }

    const currentOrder = orders.find(o => o.id === activeOrderId);
    if (!currentOrder?.expiresAt) {
      return;
    }

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = currentOrder.expiresAt.getTime();
      return Math.max(0, Math.floor((expiresAt - now) / 1000));
    };

    setMatchingTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const timeLeft = calculateTimeLeft();
      setMatchingTimeLeft(timeLeft);

      if (timeLeft <= 0) {
        clearInterval(interval);
        const expiredOrder = orders.find(o => o.id === activeOrderId);
        if (expiredOrder) {
          setTimedOutOrders(prev => [...prev, { ...expiredOrder, status: 'complete' as OrderStatus, dbStatus: 'expired' }]);
          setOrders(prev => prev.filter(o => o.id !== activeOrderId));

          fetchWithAuth(`/api/orders/${activeOrderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'expired',
              actor_type: 'system',
              actor_id: '00000000-0000-0000-0000-000000000000', // Nil UUID for system
            }),
          }).catch(console.error);
        }
        setPendingTradeData(null);
        setScreen("home");
        playSound('error');
        toast.showOrderExpired();
        showBrowserNotification('Order Expired', 'No merchant accepted your order in time. Please try again.');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [screen, pendingTradeData, activeOrderId, orders, playSound]);

  // Timer tick for orders list countdown display
  useEffect(() => {
    const hasPendingOrders = orders.some(o => o.dbStatus === 'pending');
    if (!hasPendingOrders) return;

    const interval = setInterval(() => {
      setTimerTick(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [orders]);

  // Format time left as MM:SS
  const formatTimeLeft = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const fiatAmount = amount ? (parseFloat(amount) * currentRate).toFixed(2) : "0";

  // Fee calculations based on trade preference
  const currentFees = FEE_CONFIG[tradePreference];
  const cryptoFee = amount ? parseFloat(amount) * currentFees.totalFee : 0;
  const traderEarnings = amount ? parseFloat(amount) * currentFees.traderCut : 0;
  const platformFee = cryptoFee - traderEarnings;
  const fiatFee = cryptoFee * currentRate;
  const fiatTraderEarnings = traderEarnings * currentRate;

  // Get active chat for current order
  const activeChat = activeOrder ? chatWindows.find(w => w.orderId === activeOrder.id) : null;

  // Debug logging for chat issues
  useEffect(() => {
    if (screen === "chat-view") {
      console.log('[page.tsx] chat-view debug:', {
        activeOrderId,
        activeOrderExists: !!activeOrder,
        activeChatExists: !!activeChat,
        activeChatMessages: activeChat?.messages?.length ?? 0,
        chatWindows: chatWindows.map(w => ({ id: w.id, orderId: w.orderId, msgCount: w.messages.length })),
      });
    }
  }, [screen, activeOrderId, activeOrder, activeChat, chatWindows]);
  const pendingOrders = orders.filter(o => o.status !== "complete");
  const completedOrders = orders.filter(o => o.status === "complete");

  // Connect with wallet address
  const connectWallet = useCallback(async (walletAddress: string, name?: string) => {
    try {
      const res = await fetchWithAuth('/api/auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: walletAddress, type: 'user', name }),
      });
      if (!res.ok) {
        // API not available (demo mode)
        console.log('Auth API not available - running in demo mode');
        return false;
      }
      const data = await res.json();
      if (data.success && data.data.user) {
        setUserId(data.data.user.id);
        setUserWallet(walletAddress);
        setUserName(data.data.user.name || 'User');
        localStorage.setItem('blip_wallet', walletAddress);
        // Fetch orders
        fetchOrders(data.data.user.id);
        // Fetch bank accounts
        fetchBankAccounts(data.data.user.id);
        // Fetch resolved disputes
        fetchResolvedDisputes(data.data.user.id);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      return false;
    }
  }, []);

  // Handle Solana wallet connection - wallet will be linked via useEffect
  const handleSolanaWalletConnect = useCallback(async (walletAddress: string) => {
    console.log('[User] Wallet connected via modal:', walletAddress);
    setShowWalletModal(false);
    // Wallet will be linked to user account via linkWalletToAccount useEffect

    // If we were waiting to connect for escrow, reset status
    // User needs to click "Confirm & Lock" again with wallet now connected
    if (escrowTxStatus === 'connecting') {
      setEscrowTxStatus('idle');
      console.log('[Wallet] Connected during escrow flow, user can now click Confirm & Lock');
    }
  }, [escrowTxStatus]);

  // Create new account
  const createAccount = useCallback(async () => {
    if (!newUserName.trim()) return;

    setIsLoading(true);
    // Generate a random wallet address
    const randomWallet = '0x' + Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');

    const success = await connectWallet(randomWallet, newUserName.trim());
    setIsLoading(false);
    if (success) {
      setNewUserName('');
      setScreen('home');
    }
  }, [connectWallet, newUserName]);

  // Handle setting username for new wallet users
  // NOTE: On Brave with Phantom, connected may be false but walletAddress is available
  const handleWalletUsername = useCallback(async (username: string) => {
    const phantom = (window as any).phantom?.solana;
    const walletAddress = solanaWallet.walletAddress || phantom?.publicKey?.toString();
    const signFn = solanaWallet.signMessage || (phantom?.signMessage ? async (msg: Uint8Array) => {
      const result = await phantom.signMessage(msg, 'utf8');
      return result.signature;
    } : null);

    if (!walletAddress || !signFn) {
      throw new Error("Wallet not connected");
    }

    if (!username.trim()) {
      throw new Error("Username is required");
    }

    try {
      // Generate message to sign
      const timestamp = Date.now();
      const nonce = Math.random().toString(36).substring(7);
      const message = `Sign this message to authenticate with Blip Money\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;

      // Request signature
      const encodedMessage = new TextEncoder().encode(message);
      const signatureUint8 = await signFn(encodedMessage);

      // Convert to base58
      const bs58 = await import('bs58');
      const signature = bs58.default.encode(signatureUint8);

      // Set username via API
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_username',
          wallet_address: walletAddress,
          signature,
          message,
          username: username.trim(),
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        // Username set successfully
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(user.wallet_address);
        setUserName(user.username || user.name || 'User');
        setUserBalance(user.balance || 0);
        localStorage.setItem('blip_user', JSON.stringify(user));
        fetchOrders(user.id);
        fetchBankAccounts(user.id);
        fetchResolvedDisputes(user.id);
        setShowUsernameModal(false);
        setWalletUsername("");
        setScreen('home');
      } else {
        throw new Error(data.error || 'Failed to set username');
      }
    } catch (error) {
      console.error('Set username error:', error);
      throw error;
    }
  }, [solanaWallet]);

  // Handle user login
  const handleUserLogin = useCallback(async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError('Username and password are required');
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          action: 'login',
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(user.wallet_address);
        setUserName(user.username || user.name || 'User');
        setUserBalance(user.balance || 0);
        localStorage.setItem('blip_user', JSON.stringify(user));
        // Fetch orders
        fetchOrders(user.id);
        // Fetch bank accounts
        fetchBankAccounts(user.id);
        // Fetch resolved disputes
        fetchResolvedDisputes(user.id);
        setScreen('home');
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Connection failed');
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginForm]);

  // Handle user registration
  const handleUserRegister = useCallback(async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError('Username and password are required');
      return;
    }

    if (loginForm.username.length < 3) {
      setLoginError('Username must be at least 3 characters');
      return;
    }

    if (loginForm.password.length < 6) {
      setLoginError('Password must be at least 6 characters');
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          action: 'register',
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(user.wallet_address);
        setUserName(user.username || user.name || 'User');
        setUserBalance(user.balance || 0);
        localStorage.setItem('blip_user', JSON.stringify(user));
        // Fetch orders
        fetchOrders(user.id);
        // Fetch bank accounts
        fetchBankAccounts(user.id);
        // Fetch resolved disputes
        fetchResolvedDisputes(user.id);
        setScreen('home');
      } else {
        setLoginError(data.error || 'Registration failed');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setLoginError('Connection failed');
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginForm]);

  // Initialize - restore session if available
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedUser = localStorage.getItem('blip_user');
        const savedWallet = localStorage.getItem('blip_wallet');

        if (savedUser) {
          const user = JSON.parse(savedUser);
          console.log('[Session] Restoring user session:', user.username);

          // Validate user still exists in database
          const checkRes = await fetchWithAuth(`/api/auth/user?action=check_session&user_id=${user.id}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.success && checkData.data?.valid) {
              // Session is valid, restore state
              setUserId(user.id);
              setUserName(user.username || user.name || 'User');
              setUserBalance(user.balance || 0);
              if (savedWallet) {
                setUserWallet(savedWallet);
              }
              // Fetch user data
              fetchOrders(user.id);
              fetchBankAccounts(user.id);
              fetchResolvedDisputes(user.id);
              // Go to home screen
              setScreen('home');
              setIsInitializing(false);
              return;
            }
          }
          // Session invalid, clear it
          console.log('[Session] User session invalid, clearing...');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
        }
      } catch (err) {
        console.error('[Session] Failed to restore session:', err);
        localStorage.removeItem('blip_user');
        localStorage.removeItem('blip_wallet');
      }

      // No valid session, show welcome screen
      setScreen('welcome');
      setIsInitializing(false);
    };

    restoreSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch orders
  const fetchOrders = useCallback(async (uid: string) => {
    try {
      const res = await fetchWithAuth(`/api/orders?user_id=${uid}`);
      if (!res.ok) {
        // API not available (demo mode)
        console.log('Orders API not available - running in demo mode');
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        const mappedOrders = data.data.map((o: DbOrder) => mapDbOrderToUI(o)).filter((o: Order | null): o is Order => o !== null);
        setOrders(mappedOrders);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    }
  }, []);

  // Note: Real-time updates now come via Pusher WebSocket (useRealtimeOrder hook)
  // No polling needed - orders update automatically

  // Fetch bank accounts
  const fetchBankAccounts = useCallback(async (uid: string) => {
    try {
      const res = await fetchWithAuth(`/api/users/${uid}/bank-accounts`);
      if (!res.ok) {
        // API not available (demo mode)
        console.log('Bank accounts API not available - running in demo mode');
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        setBankAccounts(data.data.map((acc: { id: string; bank_name: string; iban: string; account_name: string; is_default: boolean }) => ({
          id: acc.id,
          bank: acc.bank_name,
          iban: acc.iban,
          name: acc.account_name,
          isDefault: acc.is_default,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch bank accounts:', err);
    }
  }, []);

  // Fetch resolved disputes
  const fetchResolvedDisputes = useCallback(async (uid: string) => {
    try {
      const res = await fetchWithAuth(`/api/disputes/resolved?actor_type=user&actor_id=${uid}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setResolvedDisputes(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch resolved disputes:', err);
    }
  }, []);

  // Open chat when showChat is toggled or when entering chat-view screen
  const handleOpenChat = useCallback(() => {
    if (activeOrder) {
      openChat(
        activeOrder.merchant.name,
        "🏪",
        activeOrder.id
      );
    }
    setShowChat(true);
  }, [activeOrder, openChat]);

  // Auto-open chat when entering chat-view screen
  useEffect(() => {
    if (screen === "chat-view" && activeOrder) {
      openChat(
        activeOrder.merchant.name,
        "🏪",
        activeOrder.id
      );
    }
  }, [screen, activeOrder, openChat]);

  // Scroll to bottom when chat messages change
  useEffect(() => {
    if ((showChat || screen === "chat-view") && chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [showChat, screen, activeChat?.messages]);

  // Handle sending message
  const handleSendMessage = useCallback(() => {
    if (!activeChat || !chatMessage.trim()) return;
    sendChatMessage(activeChat.id, chatMessage);
    setChatMessage("");
    playSound('send');
  }, [activeChat, chatMessage, sendChatMessage, playSound]);

  // Note: Order updates now come via Pusher WebSocket (useRealtimeOrder hook above)
  // The onStatusChange callback handles screen transitions automatically

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startTrade = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (!userId) {
      alert('Please connect your wallet first');
      console.error('[Order] No userId - user not authenticated');
      return;
    }

    // Validate userId is a proper UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Order] Invalid userId format:', userId);
      alert('Session error. Please reconnect your wallet.');
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    setIsLoading(true);

    try {
      // Find best offer from DB
      // When user buys, we need merchant sell offers. When user sells, we need merchant buy offers.
      const offerType = tradeType === 'buy' ? 'sell' : 'buy';
      const params = new URLSearchParams({
        amount: amount,
        type: offerType,
        payment_method: paymentMethod,
        preference: tradePreference,
      });
      const offerRes = await fetchWithAuth(`/api/offers?${params}`);
      const offerData = await offerRes.json();

      if (!offerRes.ok || !offerData.success || !offerData.data) {
        const errorMsg = offerData.error || 'No offers available for this amount and payment method';
        console.error('Failed to fetch offers:', errorMsg);
        alert(errorMsg);
        setIsLoading(false);
        return;
      }

      const offer = offerData.data;
      setCurrentRate(parseFloat(offer.rate));

      // For cash orders, show confirmation screen first
      if (paymentMethod === "cash") {
        setSelectedOffer(offer);
        setScreen("cash-confirm");
        setIsLoading(false);
        return;
      }

      // For sell orders, go to escrow screen first to lock funds
      if (tradeType === "sell") {
        // IMPORTANT: Validate merchant has a wallet address before showing escrow screen
        // This is required for sell orders because the user needs to lock escrow to the merchant's wallet
        const merchantWallet = offer?.merchant?.wallet_address;
        const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);
        if (!isValidSolanaAddress) {
          console.error('[Trade] Merchant has no wallet address:', offer?.merchant?.display_name);
          alert('This merchant has not linked their Solana wallet yet. Please try again later or choose a different amount to match with another merchant.');
          setIsLoading(false);
          return;
        }
        setSelectedOffer(offer);
        setScreen("escrow");
        setIsLoading(false);
        return;
      }

      // Create order in DB - include buyer wallet address for crypto delivery
      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: offer.id,
          crypto_amount: parseFloat(amount),
          type: 'buy',
          payment_method: paymentMethod,
          preference: tradePreference,
          buyer_wallet_address: solanaWallet.walletAddress ?? undefined, // Buyer's Solana wallet for receiving crypto
        }),
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok || !orderData.success) {
        const errorDetails = orderData.details ? `\n${orderData.details.join('\n')}` : '';
        const errorMsg = (orderData.error || 'Failed to create order') + errorDetails;
        console.error('Failed to create order:', errorMsg, orderData);

        // If user not found, clear session and redirect to welcome
        if (orderData.details?.includes('User not found')) {
          alert('Your session has expired. Please reconnect your wallet.');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setScreen('welcome');
          playSound('error');
          setIsLoading(false);
          return;
        }

        alert(errorMsg);
        playSound('error');
        setIsLoading(false);
        return;
      }

      const newOrder = mapDbOrderToUI(orderData.data);
      if (newOrder) {
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
        setPendingTradeData({ amount, fiatAmount: (parseFloat(amount) * parseFloat(offer.rate)).toFixed(2), type: tradeType, paymentMethod });
        setScreen("matching");
        setAmount("");
        playSound('trade_start');
      } else {
        alert('Failed to process order data');
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to start trade:', err);
      alert('Failed to create order');
      playSound('error');
    }

    setIsLoading(false);
  };

  const confirmCashOrder = async () => {
    if (!selectedOffer || !amount) {
      alert('Missing order details');
      return;
    }

    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }

    // Validate userId is a proper UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Order] Invalid userId format:', userId);
      alert('Session error. Please reconnect your wallet.');
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    setIsLoading(true);

    try {
      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: selectedOffer.id,
          crypto_amount: parseFloat(amount),
          type: tradeType,
          payment_method: 'cash',
          preference: tradePreference,
          buyer_wallet_address: tradeType === 'buy' ? (solanaWallet.walletAddress ?? undefined) : undefined, // Buyer's wallet for buy orders
        }),
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok || !orderData.success) {
        const errorDetails = orderData.details ? `\n${orderData.details.join('\n')}` : '';
        const errorMsg = (orderData.error || 'Failed to create order') + errorDetails;
        console.error('Failed to create cash order:', errorMsg, orderData);

        // If user not found, clear session and redirect to welcome
        if (orderData.details?.includes('User not found')) {
          alert('Your session has expired. Please reconnect your wallet.');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setScreen('welcome');
          setIsLoading(false);
          return;
        }

        alert(errorMsg);
        setIsLoading(false);
        return;
      }

      const newOrder = mapDbOrderToUI(orderData.data);
      if (newOrder) {
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
        setAmount("");
        setSelectedOffer(null);
        setScreen("order");
      } else {
        alert('Failed to process order data');
      }
    } catch (err) {
      console.error('Failed to create cash order:', err);
      alert('Network error. Please try again.');
    }

    setIsLoading(false);
  };

  const confirmEscrow = async () => {
    console.log('[Escrow] confirmEscrow called', { selectedOffer, amount, userId });
    if (!selectedOffer || !amount) {
      console.log('[Escrow] Missing required data:', { selectedOffer: !!selectedOffer, amount: !!amount });
      alert('Missing order details');
      return;
    }

    if (!userId) {
      console.log('[Escrow] No userId - user not authenticated');
      alert('Please connect your wallet first');
      return;
    }

    // Validate userId is a proper UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Escrow] Invalid userId format:', userId);
      alert('Session error. Please reconnect your wallet.');
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    // Reset state
    setEscrowError(null);
    setEscrowTxHash(null);

    // Step 1: Check wallet connection
    console.log('[Escrow] Wallet connected:', solanaWallet.connected);
    if (!solanaWallet.connected) {
      console.log('[Escrow] Opening wallet modal');
      setEscrowTxStatus('connecting');
      setShowWalletModal(true);
      return;
    }

    // Step 2: Check balance (only if loaded)
    const amountNum = parseFloat(amount);
    console.log('[Escrow] Balance check:', { usdtBalance: solanaWallet.usdtBalance, amountNeeded: amountNum });

    // Only block if balance is loaded AND insufficient
    // If balance is null (still loading), allow to proceed - backend will validate
    if (solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance < amountNum) {
      setEscrowError(`Insufficient USDT balance. You have ${solanaWallet.usdtBalance.toFixed(2)} USDT but need ${amountNum} USDT.`);
      setEscrowTxStatus('error');
      return;
    }

    // If balance is still null after connection, wait for it to load
    if (solanaWallet.usdtBalance === null) {
      console.log('[Escrow] Balance still loading, refreshing...');
      await solanaWallet.refreshBalances();
      // Give it a moment to update
      await new Promise(r => setTimeout(r, 500));
      if (solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance < amountNum) {
        setEscrowError(`Insufficient USDT balance. You have ${solanaWallet.usdtBalance.toFixed(2)} USDT but need ${amountNum} USDT.`);
        setEscrowTxStatus('error');
        return;
      }
    }

    setIsLoading(true);
    setEscrowTxStatus('signing');
    console.log('[Escrow] Starting escrow transaction');

    try {
      // For sell orders: user deposits to escrow, merchant receives when user releases
      // IMPORTANT: We MUST have the merchant wallet to lock escrow correctly for release
      const merchantWallet = selectedOffer?.merchant?.wallet_address;
      console.log('[Escrow] Merchant wallet:', merchantWallet || '(MISSING!)');
      console.log('[Escrow] Merchant name:', selectedOffer?.merchant?.display_name || '(unknown)');
      console.log('[Escrow] User wallet:', solanaWallet.walletAddress);
      console.log('[Escrow] Program ready:', solanaWallet.programReady);

      // Validate merchant wallet - REQUIRED for sell orders to release correctly
      const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);
      if (!isValidSolanaAddress) {
        setEscrowError('This merchant has not linked their Solana wallet. Please choose a different offer or wait for the merchant to set up their wallet.');
        setEscrowTxStatus('error');
        setIsLoading(false);
        return;
      }

      // Step 3: Sign and send escrow transaction using V2.2 program
      console.log('[Escrow] Wallet state before escrow:', {
        connected: solanaWallet.connected,
        walletAddress: solanaWallet.walletAddress,
        hasPublicKey: !!solanaWallet.publicKey,
      });
      console.log('[Escrow] Calling depositToEscrow with:', { amount: amountNum, merchantWallet });

      let escrowResult: { txHash: string; success: boolean; tradePda?: string; escrowPda?: string; tradeId?: number };

      try {
        // Lock escrow with merchant's wallet as counterparty - required for release to work
        escrowResult = await solanaWallet.depositToEscrow({
          amount: amountNum,
          merchantWallet,
        });
        console.log('[Escrow] depositToEscrow result:', escrowResult);

        if (!escrowResult.success) {
          throw new Error('Transaction failed');
        }
      } catch (escrowErr: any) {
        console.error('[Escrow] On-chain escrow failed:', escrowErr);
        console.error('[Escrow] Error message:', escrowErr?.message);
        console.error('[Escrow] Error stack:', escrowErr?.stack?.split('\n').slice(0, 3).join('\n'));

        // Check if this is a wallet not ready error - provide user-friendly message
        if (escrowErr?.message?.includes('program=false')) {
          console.error('[Escrow] CRITICAL: Anchor program is null - wallet may not be fully connected');
          setEscrowError('Wallet not fully connected. Please disconnect and reconnect your wallet, then try again.');
        } else if (escrowErr?.message?.includes('User rejected')) {
          setEscrowError('Transaction was rejected. Please approve the transaction in your wallet.');
        } else if (escrowErr?.message?.includes('Insufficient')) {
          setEscrowError(escrowErr.message);
        } else {
          setEscrowError(`Escrow failed: ${escrowErr?.message || 'Unknown error'}. Please try again.`);
        }
        setEscrowTxStatus('error');
        setIsLoading(false);
        return;
      }

      setEscrowTxHash(escrowResult.txHash);
      setEscrowTxStatus('confirming');

      // Step 4: Create order in database with escrow details
      setEscrowTxStatus('recording');

      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: selectedOffer.id,
          crypto_amount: amountNum,
          type: 'sell',
          payment_method: paymentMethod,
          preference: tradePreference,
          escrow_trade_pda: escrowResult.tradePda,
          escrow_pda: escrowResult.escrowPda,
          escrow_trade_id: escrowResult.tradeId,
          user_bank_account: userBankAccount, // User's bank for receiving fiat
        }),
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok || !orderData.success) {
        // Check if user not found
        if (orderData.details?.includes('User not found')) {
          setEscrowError(`Session expired. Your funds are safe - TX: ${escrowResult.txHash}. Please reconnect wallet and contact support.`);
          setEscrowTxStatus('error');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setIsLoading(false);
          return;
        }
        // Order creation failed but funds are locked - this is a critical error
        setEscrowError(`Order creation failed after funds were locked. TX: ${escrowResult.txHash}. Please contact support.`);
        setEscrowTxStatus('error');
        setIsLoading(false);
        return;
      }

      // Step 5: Record escrow deposit with tx hash and on-chain references
      const escrowRes = await fetchWithAuth(`/api/orders/${orderData.data.id}/escrow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_hash: escrowResult.txHash,
          actor_type: 'user',
          actor_id: userId,
          escrow_address: solanaWallet.walletAddress,
          // On-chain references for release
          escrow_trade_id: escrowResult.tradeId,
          escrow_trade_pda: escrowResult.tradePda,
          escrow_pda: escrowResult.escrowPda,
          escrow_creator_wallet: solanaWallet.walletAddress,
        }),
      });

      // Step 6: Success - stay on escrow screen showing "waiting for merchant"
      setEscrowTxStatus('success');
      toast.showEscrowLocked(amount);

      // Get the updated order data (with escrowed status) from the escrow response
      let finalOrderData = orderData.data;
      if (escrowRes.ok) {
        const escrowData = await escrowRes.json();
        if (escrowData.success && escrowData.data) {
          finalOrderData = escrowData.data;
        }
      } else {
        console.warn('Failed to record escrow, but order was created');
        // Manually set status to escrowed since the on-chain tx succeeded
        finalOrderData = { ...finalOrderData, status: 'escrowed', escrow_tx_hash: escrowResult.txHash };
      }

      const newOrder = mapDbOrderToUI(finalOrderData);
      if (newOrder) {
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
        // Don't navigate away - stay on escrow screen showing success + waiting state
      }
    } catch (err) {
      console.error('Escrow failed:', err);
      setEscrowError(err instanceof Error ? err.message : 'Transaction failed. Please try again.');
      setEscrowTxStatus('error');
    }

    setIsLoading(false);
  };

  const markPaymentSent = async () => {
    if (!activeOrder || !userId) {
      console.log('markPaymentSent: missing activeOrder or userId', { activeOrder: !!activeOrder, userId });
      return;
    }

    setIsLoading(true);
    try {
      // V2.3: If wallet connected and order has escrow, ensure acceptTrade + confirmPayment on-chain
      if (solanaWallet.connected && activeOrder.escrowTradeId && activeOrder.escrowCreatorWallet) {
        // Step 1: Ensure user has joined escrow as counterparty (acceptTrade)
        // This MUST happen before confirmPayment or releaseEscrow can work
        try {
          console.log('[User] Ensuring acceptTrade before confirmPayment:', {
            tradeId: activeOrder.escrowTradeId,
            creatorWallet: activeOrder.escrowCreatorWallet,
          });
          const acceptResult = await solanaWallet.acceptTrade({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
          });
          if (acceptResult.success) {
            console.log('[User] acceptTrade success:', acceptResult.txHash);
          }
        } catch (acceptErr: any) {
          // Expected to fail if already accepted — safe to continue
          console.log('[User] acceptTrade skipped (likely already done):', acceptErr.message);
        }

        // Step 2: Confirm payment on-chain
        // This transitions the trade from Locked → PaymentSent on-chain
        // CRITICAL: After this, auto-refund is FORBIDDEN - only dispute resolution can adjudicate
        console.log('[User] Confirming payment on-chain:', {
          tradeId: activeOrder.escrowTradeId,
          creatorWallet: activeOrder.escrowCreatorWallet,
        });

        try {
          const confirmResult = await solanaWallet.confirmPayment({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
          });

          if (confirmResult.success) {
            console.log('[User] On-chain payment confirmed:', confirmResult.txHash);
          } else {
            console.warn('[User] On-chain confirmation failed, continuing with API');
          }
        } catch (chainError) {
          // Log but continue - the API update will still happen
          console.warn('[User] On-chain confirmation failed:', chainError);
        }
      }

      // Update status in API (always, regardless of on-chain result)
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'payment_sent',
          actor_type: 'user',
          actor_id: userId,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMsg = data.error || 'Failed to update order. The order may have expired.';
        console.error('Failed to mark payment sent:', errorMsg);
        alert(errorMsg);
        setIsLoading(false);
        return;
      }

      setOrders(prev => prev.map(o =>
        o.id === activeOrder.id ? { ...o, status: "waiting" as OrderStatus, step: 3 as OrderStep, dbStatus: 'payment_sent' } : o
      ));
    } catch (err) {
      console.error('Failed to mark payment sent:', err);
      alert('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmFiatReceived = async () => {
    if (!activeOrder || !userId) return;

    setIsLoading(true);

    try {
      // For sell orders, user needs to release escrow to merchant
      const userIsMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';
      if (activeOrder.type === 'sell' && (userIsMockMode || (activeOrder.escrowTradeId && activeOrder.escrowCreatorWallet))) {
        const merchantWallet = activeOrder.merchant.walletAddress;
        const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);

        if (!userIsMockMode) {
          if (!solanaWallet.connected) {
            alert('Please connect your wallet to release the escrow.');
            setIsLoading(false);
            return;
          }

          if (!isValidSolanaAddress) {
            alert('Merchant wallet address is invalid. Please contact support.');
            setIsLoading(false);
            return;
          }
        }

        console.log('[Release] Releasing escrow to merchant:', {
          creatorPubkey: activeOrder.escrowCreatorWallet,
          tradeId: activeOrder.escrowTradeId,
          counterparty: merchantWallet,
          merchantName: activeOrder.merchant.name,
          mockMode: userIsMockMode,
        });

        // Release escrow (mock mode returns instant success)
        const releaseResult = await solanaWallet.releaseEscrow({
          creatorPubkey: activeOrder.escrowCreatorWallet || 'mock',
          tradeId: activeOrder.escrowTradeId || 0,
          counterparty: merchantWallet || 'mock',
        });

        if (!releaseResult.success) {
          console.error('[Release] Escrow release failed:', releaseResult.error);
          alert(`Failed to release escrow: ${releaseResult.error || 'Unknown error'}`);
          setIsLoading(false);
          return;
        }

        console.log('[Release] Escrow released:', releaseResult.txHash);

        // In mock mode, credit the merchant with the USDC
        if (userIsMockMode) {
          try {
            await fetchWithAuth('/api/mock/balance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: activeOrder.merchant.id,
                type: 'merchant',
                action: 'credit',
                amount: parseFloat(activeOrder.cryptoAmount),
              }),
            });
            console.log('[Release][Mock] Credited', activeOrder.cryptoAmount, 'USDC to merchant', activeOrder.merchant.id);
          } catch (balErr) {
            console.error('[Release][Mock] Failed to credit merchant balance:', balErr);
          }
        }

        // Record the release on the backend - this also marks order as completed
        const escrowRes = await fetchWithAuth(`/api/orders/${activeOrder.id}/escrow`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tx_hash: releaseResult.txHash,
            actor_type: 'user',
            actor_id: userId,
          }),
        });

        if (escrowRes.ok) {
          setOrders(prev => prev.map(o =>
            o.id === activeOrder.id ? { ...o, status: "complete" as OrderStatus, step: 4 as OrderStep, dbStatus: 'completed' } : o
          ));
          playSound('trade_complete');
          if (solanaWallet.connected) {
            solanaWallet.refreshBalances();
          }
          setIsLoading(false);
          return;
        } else {
          setOrders(prev => prev.map(o =>
            o.id === activeOrder.id ? { ...o, status: "complete" as OrderStatus, step: 4 as OrderStep, dbStatus: 'completed' } : o
          ));
          playSound('trade_complete');
          // Refresh on-chain wallet balance
          if (solanaWallet.connected) {
            solanaWallet.refreshBalances();
          }
          setIsLoading(false);
          return;
        }
      }

      // For buy orders (no escrow from user), just confirm payment received
      // This should only happen for orders where merchant releases to buyer
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          actor_type: 'user',
          actor_id: userId,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMsg = data.error || 'Failed to confirm payment';
        // If already completed, that's fine - just update UI
        if (errorMsg.includes('already') && errorMsg.includes('completed')) {
          setOrders(prev => prev.map(o =>
            o.id === activeOrder.id ? { ...o, status: "complete" as OrderStatus, step: 4 as OrderStep, dbStatus: 'completed' } : o
          ));
          setIsLoading(false);
          return;
        }
        console.error('Failed to confirm payment:', errorMsg);
        alert(errorMsg);
        setIsLoading(false);
        return;
      }

      setOrders(prev => prev.map(o =>
        o.id === activeOrder.id ? { ...o, status: "complete" as OrderStatus, step: 4 as OrderStep, dbStatus: 'completed' } : o
      ));
      playSound('trade_complete');
      // Refresh on-chain wallet balance
      if (solanaWallet.connected) {
        solanaWallet.refreshBalances();
      }
    } catch (err) {
      console.error('Failed to confirm payment:', err);
      alert('Failed to release escrow. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitDispute = async () => {
    if (!activeOrder || !userId || !disputeReason) return;

    setIsSubmittingDispute(true);
    try {
      // V2.3: If wallet connected and order has escrow, open dispute on-chain first
      if (solanaWallet.connected && activeOrder.escrowTradeId && activeOrder.escrowCreatorWallet) {
        console.log('[User] Opening on-chain dispute:', {
          tradeId: activeOrder.escrowTradeId,
          creatorWallet: activeOrder.escrowCreatorWallet,
        });

        try {
          const disputeResult = await solanaWallet.openDispute({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
          });

          if (disputeResult.success) {
            console.log('[User] On-chain dispute opened:', disputeResult.txHash);
          } else {
            console.warn('[User] On-chain dispute failed, continuing with API');
          }
        } catch (chainError) {
          // Log but continue - the API dispute will still be recorded
          console.warn('[User] On-chain dispute failed:', chainError);
        }
      }

      // Submit dispute to API (always, regardless of on-chain result)
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: disputeReason,
          description: disputeDescription,
          initiated_by: 'user',
          user_id: userId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOrders(prev => prev.map(o =>
            o.id === activeOrder.id ? { ...o, status: "disputed" as OrderStatus, dbStatus: 'disputed' } : o
          ));
          setShowDisputeModal(false);
          setDisputeReason("");
          setDisputeDescription("");
          toast.showDisputeOpened(activeOrder.id);
          showBrowserNotification('Dispute Submitted', 'Your dispute has been submitted. Our team will review it.');
        }
      } else {
        toast.showWarning('Failed to submit dispute. Please try again.');
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      toast.showWarning('Failed to submit dispute');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  // Fetch dispute info for current order
  const fetchDisputeInfo = useCallback(async (orderId: string) => {
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/dispute`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setDisputeInfo(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch dispute info:', err);
    }
  }, []);

  // Respond to resolution proposal (accept/reject)
  const respondToResolution = async (action: 'accept' | 'reject') => {
    if (!activeOrder || !userId || !disputeInfo) return;

    setIsRespondingToResolution(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}/dispute/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party: 'user',
          action,
          partyId: userId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // Refresh dispute info
          fetchDisputeInfo(activeOrder.id);
          // Refresh orders if resolution was finalized
          if (data.data?.finalized) {
            if (userId) {
              fetchOrders(userId);
            }
          }
          playSound('click');
        }
      }
    } catch (err) {
      console.error('Failed to respond to resolution:', err);
      playSound('error');
    } finally {
      setIsRespondingToResolution(false);
    }
  };

  // Fetch dispute info when viewing a disputed order
  useEffect(() => {
    if (activeOrder?.status === 'disputed' || activeOrder?.dbStatus === 'disputed') {
      fetchDisputeInfo(activeOrder.id);
    } else {
      setDisputeInfo(null);
    }
  }, [activeOrder?.id, activeOrder?.status, activeOrder?.dbStatus, fetchDisputeInfo]);

  // Request extension for current order
  const requestExtension = async () => {
    if (!activeOrder || !userId) return;

    setRequestingExtension(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}/extension`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'user',
          actor_id: userId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setExtensionRequest({
          orderId: activeOrder.id,
          requestedBy: 'user',
          extensionMinutes: data.data?.extension_minutes || 30,
          extensionCount: data.data?.extension_count || 0,
          maxExtensions: data.data?.max_extensions || 3,
        });
        playSound('click');
      } else {
        playSound('error');
        console.error('Extension request failed:', data.error);
      }
    } catch (err) {
      console.error('Failed to request extension:', err);
      playSound('error');
    } finally {
      setRequestingExtension(false);
    }
  };

  // Respond to extension request (accept/decline)
  const respondToExtension = async (accept: boolean) => {
    if (!extensionRequest || !userId) return;

    setRequestingExtension(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${extensionRequest.orderId}/extension`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'user',
          actor_id: userId,
          accept,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setExtensionRequest(null);
        if (accept) {
          playSound('click');
          // Refresh orders to get new expires_at
          if (userId) {
            fetchOrders(userId);
          }
        } else {
          playSound('error');
          // Order might be cancelled or disputed
          if (userId) {
            fetchOrders(userId);
          }
        }
      } else {
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to respond to extension:', err);
      playSound('error');
    } finally {
      setRequestingExtension(false);
    }
  };

  // ── Cancel Request handlers ──
  const requestCancelOrder = async (reason?: string) => {
    if (!activeOrder || !userId) return;
    setIsRequestingCancel(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}/cancel-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'user',
          actor_id: userId,
          reason: reason || 'User requested cancellation',
        }),
      });
      const data = await res.json();
      if (data.success) {
        playSound('click');
        fetchOrders(userId);
      } else {
        playSound('error');
        alert(data.error || 'Failed to request cancel');
      }
    } catch (err) {
      console.error('Failed to request cancel:', err);
      playSound('error');
    } finally {
      setIsRequestingCancel(false);
    }
  };

  const respondToCancelRequest = async (accept: boolean) => {
    if (!activeOrder || !userId) return;
    setIsRequestingCancel(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}/cancel-request`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'user',
          actor_id: userId,
          accept,
        }),
      });
      const data = await res.json();
      if (data.success) {
        playSound(accept ? 'click' : 'notification');
        fetchOrders(userId);
      } else {
        playSound('error');
        alert(data.error || 'Failed to respond to cancel');
      }
    } catch (err) {
      console.error('Failed to respond to cancel request:', err);
      playSound('error');
    } finally {
      setIsRequestingCancel(false);
    }
  };

  const addBankAccount = async () => {
    if (!newBank.bank || !newBank.iban || !newBank.name || !userId) return;

    try {
      const res = await fetchWithAuth(`/api/users/${userId}/bank-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_name: newBank.bank,
          account_name: newBank.name,
          iban: newBank.iban,
          is_default: bankAccounts.length === 0,
        }),
      });
      if (!res.ok) {
        console.log('Bank accounts API not available - running in demo mode');
        // Add locally in demo mode
        setBankAccounts(prev => [...prev, {
          id: `demo_${Date.now()}`,
          bank: newBank.bank,
          iban: newBank.iban,
          name: newBank.name,
          isDefault: bankAccounts.length === 0,
        }]);
        setNewBank({ bank: "", iban: "", name: "" });
        setShowAddBank(false);
        return;
      }
      const data = await res.json();

      if (data.success && data.data) {
        setBankAccounts(prev => [...prev, {
          id: data.data.id,
          bank: data.data.bank_name,
          iban: data.data.iban,
          name: data.data.account_name,
          isDefault: data.data.is_default,
        }]);
        setNewBank({ bank: "", iban: "", name: "" });
        setShowAddBank(false);
      }
    } catch (err) {
      console.error('Failed to add bank account:', err);
    }
  };

  const maxW = "max-w-[440px] mx-auto";

  // Show loading while initializing
  if (isInitializing) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }


  return (
    <div className="min-h-dvh flex flex-col items-center overflow-y-auto relative" style={{ background: '#0a0a0a' }}>
      {/* Toast Notifications */}
      <NotificationToastContainer position="top-right" />
      <AnimatePresence mode="wait">
        {/* WELCOME / LOGIN */}
        {screen === "welcome" && (
          <LandingPage
            loginForm={loginForm}
            setLoginForm={setLoginForm}
            authMode={authMode}
            setAuthMode={setAuthMode}
            handleUserLogin={handleUserLogin}
            handleUserRegister={handleUserRegister}
            isLoggingIn={isLoggingIn}
            loginError={loginError}
            setLoginError={setLoginError}
          />
        )}

        {/* HOME */}
        {screen === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col relative`}
            style={{ background: '#080810' }}
          >
            <HomeScreen
              userName={userName}
              userId={userId}
              orders={orders}
              completedOrders={completedOrders}
              pendingOrders={pendingOrders}
              currentRate={currentRate}
              screen={screen}
              setScreen={setScreen}
              setTradeType={setTradeType}
              setActiveOrderId={setActiveOrderId}
              setPendingTradeData={setPendingTradeData}
              setShowWalletModal={setShowWalletModal}
              setShowWalletSetup={setShowWalletSetup}
              setShowWalletUnlock={setShowWalletUnlock}
              solanaWallet={solanaWallet}
              embeddedWallet={embeddedWallet}
              maxW={maxW}
            />
          </motion.div>
        )}

        {/* TRADE */}
        {screen === "trade" && (
          <motion.div
            key="trade"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <TradeCreationScreen
              screen={screen}
              setScreen={setScreen}
              tradeType={tradeType}
              setTradeType={setTradeType}
              tradePreference={tradePreference}
              setTradePreference={setTradePreference}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              amount={amount}
              setAmount={setAmount}
              fiatAmount={fiatAmount}
              currentFees={currentFees}
              isLoading={isLoading}
              userId={userId}
              startTrade={startTrade}
              solanaWallet={solanaWallet}
            />
          </motion.div>
        )}

        {/* ESCROW */}
        {screen === "escrow" && (
          <motion.div
            key="escrow"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <EscrowLockScreen
              setScreen={setScreen}
              amount={amount}
              fiatAmount={fiatAmount}
              currentRate={currentRate}
              escrowTxStatus={escrowTxStatus}
              setEscrowTxStatus={setEscrowTxStatus}
              escrowTxHash={escrowTxHash}
              escrowError={escrowError}
              setEscrowError={setEscrowError}
              isLoading={isLoading}
              confirmEscrow={confirmEscrow}
              userBankAccount={userBankAccount}
              setUserBankAccount={setUserBankAccount}
              setShowWalletModal={setShowWalletModal}
              solanaWallet={solanaWallet}
            />
          </motion.div>
        )}

        {/* ORDER */}
        {screen === "order" && activeOrder && (
          <motion.div
            key="order"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <OrderDetailScreen
              setScreen={setScreen}
              activeOrder={activeOrder}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              handleOpenChat={handleOpenChat}
              markPaymentSent={markPaymentSent}
              confirmFiatReceived={confirmFiatReceived}
              rating={rating}
              setRating={setRating}
              copied={copied}
              handleCopy={handleCopy}
              extensionRequest={extensionRequest}
              requestExtension={requestExtension}
              respondToExtension={respondToExtension}
              requestingExtension={requestingExtension}
              showChat={showChat}
              setShowChat={setShowChat}
              chatMessage={chatMessage}
              setChatMessage={setChatMessage}
              chatInputRef={chatInputRef}
              chatMessagesRef={chatMessagesRef}
              activeChat={activeChat ?? null}
              handleSendMessage={handleSendMessage}
              showDisputeModal={showDisputeModal}
              setShowDisputeModal={setShowDisputeModal}
              disputeReason={disputeReason}
              setDisputeReason={setDisputeReason}
              disputeDescription={disputeDescription}
              setDisputeDescription={setDisputeDescription}
              submitDispute={submitDispute}
              isSubmittingDispute={isSubmittingDispute}
              disputeInfo={disputeInfo}
              respondToResolution={respondToResolution}
              isRespondingToResolution={isRespondingToResolution}
              requestCancelOrder={requestCancelOrder}
              respondToCancelRequest={respondToCancelRequest}
              isRequestingCancel={isRequestingCancel}
              solanaWallet={solanaWallet}
              setShowWalletModal={setShowWalletModal}
              userId={userId}
              setOrders={setOrders}
              playSound={playSound}
              maxW={maxW}
            />
          </motion.div>
        )}

        {/* ORDER - Loading fallback when order data is being fetched */}
        {screen === "order" && !activeOrder && activeOrderId && (
          <motion.div
            key="order-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`flex-1 w-full ${maxW} flex flex-col items-center justify-center`}
          >
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
          </motion.div>
        )}

        {/* ORDERS */}
        {screen === "orders" && (
          <motion.div
            key="orders"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col relative`}
            style={{ background: '#080810' }}
          >
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
          </motion.div>
        )}

        {/* PROFILE */}
        {screen === "profile" && (
          <motion.div
            key="profile"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col overflow-hidden relative`}
            style={{ background: '#080810' }}
          >
            <ProfileScreen
              screen={screen}
              setScreen={setScreen}
              userName={userName}
              completedOrders={completedOrders}
              timedOutOrders={timedOutOrders}
              solanaWallet={solanaWallet}
              setShowWalletModal={setShowWalletModal}
              copied={copied}
              setCopied={setCopied}
              bankAccounts={bankAccounts}
              showAddBank={showAddBank}
              setShowAddBank={setShowAddBank}
              newBank={newBank}
              setNewBank={setNewBank}
              addBankAccount={addBankAccount}
              resolvedDisputes={resolvedDisputes}
              theme={theme}
              toggleTheme={toggleTheme}
              isAuthenticatingRef={isAuthenticatingRef}
              lastAuthenticatedWalletRef={lastAuthenticatedWalletRef}
              authAttemptedForWalletRef={authAttemptedForWalletRef}
              setShowUsernameModal={setShowUsernameModal}
              setUserId={setUserId}
              setUserWallet={setUserWallet}
              setUserName={setUserName}
              setUserBalance={setUserBalance}
              setOrders={setOrders}
              setBankAccounts={setBankAccounts}
              setResolvedDisputes={setResolvedDisputes}
              setLoginError={setLoginError}
              setLoginForm={setLoginForm}
              maxW={maxW}
            />
          </motion.div>
        )}

        {/* CHATS */}
        {screen === "chats" && (
          <motion.div
            key="chats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <ChatListScreen
              screen={screen}
              setScreen={setScreen}
              orders={orders}
              setActiveOrderId={setActiveOrderId}
              setOrders={setOrders}
              maxW={maxW}
            />
          </motion.div>
        )}

        {/* CHAT VIEW */}
        {screen === "chat-view" && activeOrder && (
          <motion.div
            key="chat-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col h-dvh`}
          >
            <ChatViewScreen
              setScreen={setScreen}
              activeOrder={activeOrder}
              activeChat={activeChat ?? null}
              chatMessage={chatMessage}
              setChatMessage={setChatMessage}
              sendChatMessage={sendChatMessage}
              chatMessagesRef={chatMessagesRef}
            />
          </motion.div>
        )}

        {/* CREATE OFFER */}
        {screen === "create-offer" && (
          <motion.div
            key="create-offer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <CreateOfferScreen
              setScreen={setScreen}
              tradeType={tradeType}
              setTradeType={setTradeType}
            />
          </motion.div>
        )}

        {/* CASH CONFIRM */}
        {screen === "cash-confirm" && selectedOffer && (
          <motion.div
            key="cash-confirm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <CashConfirmScreen
              setScreen={setScreen}
              selectedOffer={selectedOffer}
              setSelectedOffer={setSelectedOffer}
              tradeType={tradeType}
              amount={amount}
              fiatAmount={fiatAmount}
              isLoading={isLoading}
              confirmCashOrder={confirmCashOrder}
            />
          </motion.div>
        )}

        {/* WALLET */}
        {screen === "wallet" && (
          <motion.div
            key="wallet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <WalletScreen
              screen={screen}
              setScreen={setScreen}
              solanaWallet={solanaWallet}
              embeddedWallet={embeddedWallet}
              setShowWalletModal={setShowWalletModal}
              setShowWalletSetup={setShowWalletSetup}
              setShowWalletUnlock={setShowWalletUnlock}
              maxW={maxW}
            />
          </motion.div>
        )}

        {/* MATCHING */}
        {screen === "matching" && pendingTradeData && (
          <motion.div
            key="matching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            <MatchingScreen
              setScreen={setScreen}
              pendingTradeData={pendingTradeData}
              matchingTimeLeft={matchingTimeLeft}
              formatTimeLeft={formatTimeLeft}
              currentRate={currentRate}
              activeOrderId={activeOrderId}
              userId={userId}
              setOrders={setOrders}
              setPendingTradeData={setPendingTradeData}
              toast={toast}
              maxW={maxW}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Solana Wallet Connect Modal (external wallets only) */}
      {!IS_EMBEDDED_WALLET && (
        <WalletConnectModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          onConnected={handleSolanaWalletConnect}
        />
      )}

      {/* Embedded Wallet: Unlock Prompt */}
      {IS_EMBEDDED_WALLET && showWalletUnlock && embeddedWallet && (
        <UnlockWalletPrompt
          onUnlock={async (password) => {
            const ok = await embeddedWallet.unlockWallet(password);
            if (ok) setShowWalletUnlock(false);
            return ok;
          }}
          onForgotPassword={() => {
            setShowWalletUnlock(false);
            setShowWalletSetup(true);
          }}
          onCreateNew={() => {
            // Clear existing wallet data so setup shows fresh
            localStorage.removeItem('blip_embedded_wallet');
            localStorage.removeItem('blip_wallet');
            localStorage.removeItem('blip_user');
            setShowWalletUnlock(false);
            setShowWalletSetup(true);
          }}
          onClose={() => setShowWalletUnlock(false)}
        />
      )}

      {/* Embedded Wallet: Setup (Create / Import) */}
      {IS_EMBEDDED_WALLET && showWalletSetup && embeddedWallet && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl overflow-hidden">
            <EmbeddedWalletSetup
              onWalletCreated={(kp) => {
                embeddedWallet.setKeypairAndUnlock(kp);
                setShowWalletSetup(false);
              }}
              onClose={() => setShowWalletSetup(false)}
            />
          </div>
        </div>
      )}

      {/* Username Modal for New Wallet Users */}
      {solanaWallet.walletAddress && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={solanaWallet.walletAddress}
          onSubmit={handleWalletUsername}
          canClose={false}
        />
      )}

      {/* Merchant Acceptance Popup */}
      <AnimatePresence>
        {showAcceptancePopup && acceptedOrderInfo && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm"
          >
            <div className="bg-[#141414] rounded-2xl p-4 border border-white/6 shadow-xl shadow-black/20">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Check className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white mb-1">Order Accepted!</p>
                  <p className="text-xs text-gray-400 mb-2">
                    <span className="text-white font-medium">{acceptedOrderInfo.merchantName}</span> accepted your {acceptedOrderInfo.orderType === 'sell' ? 'sell' : 'buy'} order
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-300 font-medium">{acceptedOrderInfo.cryptoAmount} USDC</span>
                    <span className="text-gray-500">{'\u2022'}</span>
                    <span className="text-gray-400">{acceptedOrderInfo.fiatAmount.toLocaleString()} AED</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowAcceptancePopup(false)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
