import { useState, useEffect, useCallback, useRef } from "react";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useRealtimeOrder } from "@/hooks/useRealtimeOrder";
import { usePusher } from "@/context/PusherContext";
import { copyToClipboard } from "@/lib/clipboard";
import { useTheme } from "@/context/ThemeContext";
import { showAlert } from '@/stores/confirmationStore';
import { useSounds } from "@/hooks/useSounds";
import { useToast } from "@/components/NotificationToast";
import type {
  Screen, TradeType, TradePreference, PaymentMethod, OrderStep, OrderStatus,
  Merchant, Offer, DbOrder, Order, BankAccount, DisputeInfo, ExtensionRequest,
  AcceptedOrderInfo, EscrowTxStatus,
} from "@/types/user";
import { mapDbStatusToUI, mapDbOrderToUI, FEE_CONFIG } from "@/types/user";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

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

export function useUserDashboard() {
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
      if (previousStatus === 'pending' && (newStatus === 'accepted' || newStatus === 'escrowed')) {
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
      if (newStatus === 'escrowed') {
        console.log('[User] Escrow locked - refetching order data');
        refetchActiveOrder();
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

          fetch(`/api/orders/${activeOrderId}`, {
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
      const res = await fetch('/api/auth/wallet', {
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
      const res = await fetch('/api/auth/user', {
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
  const handleUserLogin = useCallback(async (usernameArg?: string, passwordArg?: string) => {
    const username = usernameArg || loginForm.username;
    const password = passwordArg || loginForm.password;
    if (!username || !password) {
      setLoginError('Username and password are required');
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
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
  const handleUserRegister = useCallback(async (usernameArg?: string, passwordArg?: string) => {
    const username = usernameArg || loginForm.username;
    const password = passwordArg || loginForm.password;
    if (!username || !password) {
      setLoginError('Username and password are required');
      return;
    }

    if (username.length < 3) {
      setLoginError('Username must be at least 3 characters');
      return;
    }

    if (password.length < 6) {
      setLoginError('Password must be at least 6 characters');
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
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
          const checkRes = await fetch(`/api/auth/user?action=check_session&user_id=${user.id}`);
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
      const res = await fetch(`/api/orders?user_id=${uid}`);
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
      const res = await fetch(`/api/users/${uid}/bank-accounts`);
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
      const res = await fetch(`/api/disputes/resolved?actor_type=user&actor_id=${uid}`);
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
      showAlert({ title: 'Validation Error', message: 'Please enter a valid amount', variant: 'warning' });
      return;
    }

    if (!userId) {
      showAlert({ title: 'Validation Error', message: 'Please connect your wallet first', variant: 'warning' });
      console.error('[Order] No userId - user not authenticated');
      return;
    }

    // Validate userId is a proper UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Order] Invalid userId format:', userId);
      showAlert({ title: 'Session Error', message: 'Session error. Please reconnect your wallet.', variant: 'warning' });
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
      const offerRes = await fetch(`/api/offers?${params}`);
      const offerData = await offerRes.json();

      if (!offerRes.ok || !offerData.success || !offerData.data) {
        const errorMsg = offerData.error || 'No offers available for this amount and payment method';
        console.error('Failed to fetch offers:', errorMsg);
        showAlert({ title: 'Error', message: errorMsg, variant: 'danger' });
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
          showAlert({ title: 'Error', message: 'This merchant has not linked their Solana wallet yet. Please try again later or choose a different amount to match with another merchant.', variant: 'danger' });
          setIsLoading(false);
          return;
        }
        setSelectedOffer(offer);
        setScreen("escrow");
        setIsLoading(false);
        return;
      }

      // Sign trade intent on-chain before creating order
      let escrowFields: Record<string, any> = {};
      if (solanaWallet.connected && solanaWallet.createTradeOnly) {
        try {
          const tradeId = Date.now();
          const result = await solanaWallet.createTradeOnly({
            tradeId,
            amount: parseFloat(amount),
            side: 'buy',
          });
          if (result.success && result.txHash) {
            escrowFields = {
              escrow_tx_hash: result.txHash,
              escrow_trade_id: result.tradeId,
              escrow_trade_pda: result.tradePda,
              escrow_pda: result.escrowPda,
            };
          }
        } catch (signErr: any) {
          if (signErr?.message?.includes('cancelled') || signErr?.message?.includes('rejected')) {
            setIsLoading(false);
            return;
          }
          console.error('[Trade] On-chain signing failed:', signErr);
          showAlert({ title: 'Signing Failed', message: signErr.message || 'Failed to sign trade on-chain', variant: 'danger' });
          setIsLoading(false);
          return;
        }
      }

      // Create order in DB - include buyer wallet address for crypto delivery
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: offer.id,
          crypto_amount: parseFloat(amount),
          type: 'buy',
          payment_method: paymentMethod,
          preference: tradePreference,
          buyer_wallet_address: solanaWallet.walletAddress, // Buyer's Solana wallet for receiving crypto
          ...escrowFields,
        }),
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok || !orderData.success) {
        const errorDetails = orderData.details ? `\n${orderData.details.join('\n')}` : '';
        const errorMsg = (orderData.error || 'Failed to create order') + errorDetails;
        console.error('Failed to create order:', errorMsg, orderData);

        // If user not found, clear session and redirect to welcome
        if (orderData.details?.includes('User not found')) {
          showAlert({ title: 'Session Error', message: 'Your session has expired. Please reconnect your wallet.', variant: 'warning' });
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setScreen('welcome');
          playSound('error');
          setIsLoading(false);
          return;
        }

        showAlert({ title: 'Error', message: errorMsg, variant: 'danger' });
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
        showAlert({ title: 'Error', message: 'Failed to process order data', variant: 'danger' });
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to start trade:', err);
      showAlert({ title: 'Error', message: 'Failed to create order', variant: 'danger' });
      playSound('error');
    }

    setIsLoading(false);
  };

  const confirmCashOrder = async () => {
    if (!selectedOffer || !amount) {
      showAlert({ title: 'Validation Error', message: 'Missing order details', variant: 'warning' });
      return;
    }

    if (!userId) {
      showAlert({ title: 'Validation Error', message: 'Please connect your wallet first', variant: 'warning' });
      return;
    }

    // Validate userId is a proper UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Order] Invalid userId format:', userId);
      showAlert({ title: 'Session Error', message: 'Session error. Please reconnect your wallet.', variant: 'warning' });
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    setIsLoading(true);

    try {
      // Sign trade intent on-chain for cash orders too
      let escrowFields: Record<string, any> = {};
      if (solanaWallet.connected && solanaWallet.createTradeOnly) {
        try {
          const tradeId = Date.now();
          const result = await solanaWallet.createTradeOnly({
            tradeId,
            amount: parseFloat(amount),
            side: tradeType,
          });
          if (result.success && result.txHash) {
            escrowFields = {
              escrow_tx_hash: result.txHash,
              escrow_trade_id: result.tradeId,
              escrow_trade_pda: result.tradePda,
              escrow_pda: result.escrowPda,
            };
          }
        } catch (signErr: any) {
          if (signErr?.message?.includes('cancelled') || signErr?.message?.includes('rejected')) {
            setIsLoading(false);
            return;
          }
          console.error('[CashOrder] On-chain signing failed:', signErr);
          showAlert({ title: 'Signing Failed', message: signErr.message || 'Failed to sign trade on-chain', variant: 'danger' });
          setIsLoading(false);
          return;
        }
      }

      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: selectedOffer.id,
          crypto_amount: parseFloat(amount),
          type: tradeType,
          payment_method: 'cash',
          preference: tradePreference,
          buyer_wallet_address: tradeType === 'buy' ? solanaWallet.walletAddress : undefined, // Buyer's wallet for buy orders
          ...escrowFields,
        }),
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok || !orderData.success) {
        const errorDetails = orderData.details ? `\n${orderData.details.join('\n')}` : '';
        const errorMsg = (orderData.error || 'Failed to create order') + errorDetails;
        console.error('Failed to create cash order:', errorMsg, orderData);

        // If user not found, clear session and redirect to welcome
        if (orderData.details?.includes('User not found')) {
          showAlert({ title: 'Session Error', message: 'Your session has expired. Please reconnect your wallet.', variant: 'warning' });
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setScreen('welcome');
          setIsLoading(false);
          return;
        }

        showAlert({ title: 'Error', message: errorMsg, variant: 'danger' });
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
        showAlert({ title: 'Error', message: 'Failed to process order data', variant: 'danger' });
      }
    } catch (err) {
      console.error('Failed to create cash order:', err);
      showAlert({ title: 'Error', message: 'Network error. Please try again.', variant: 'danger' });
    }

    setIsLoading(false);
  };

  const confirmEscrow = async () => {
    console.log('[Escrow] confirmEscrow called', { selectedOffer, amount, userId });
    if (!selectedOffer || !amount) {
      console.log('[Escrow] Missing required data:', { selectedOffer: !!selectedOffer, amount: !!amount });
      showAlert({ title: 'Validation Error', message: 'Missing order details', variant: 'warning' });
      return;
    }

    if (!userId) {
      console.log('[Escrow] No userId - user not authenticated');
      showAlert({ title: 'Validation Error', message: 'Please connect your wallet first', variant: 'warning' });
      return;
    }

    // Validate userId is a proper UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Escrow] Invalid userId format:', userId);
      showAlert({ title: 'Session Error', message: 'Session error. Please reconnect your wallet.', variant: 'warning' });
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

      const orderRes = await fetch('/api/orders', {
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
      const escrowRes = await fetch(`/api/orders/${orderData.data.id}/escrow`, {
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
      // V2.3: If wallet connected and order has escrow, confirm payment on-chain first
      // This transitions the trade from Locked → PaymentSent on-chain
      // CRITICAL: After this, auto-refund is FORBIDDEN - only dispute resolution can adjudicate
      if (solanaWallet.connected && activeOrder.escrowTradeId && activeOrder.escrowCreatorWallet) {
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
      const res = await fetch(`/api/orders/${activeOrder.id}`, {
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
        showAlert({ title: 'Error', message: errorMsg, variant: 'danger' });
        setIsLoading(false);
        return;
      }

      setOrders(prev => prev.map(o =>
        o.id === activeOrder.id ? { ...o, status: "waiting" as OrderStatus, step: 3 as OrderStep, dbStatus: 'payment_sent' } : o
      ));
    } catch (err) {
      console.error('Failed to mark payment sent:', err);
      showAlert({ title: 'Error', message: 'Network error. Please try again.', variant: 'danger' });
    } finally {
      setIsLoading(false);
    }
  };

  const confirmFiatReceived = async () => {
    if (!activeOrder || !userId) return;

    setIsLoading(true);

    try {
      // For sell orders, user needs to release escrow to merchant
      if (activeOrder.type === 'sell' && activeOrder.escrowTradeId && activeOrder.escrowCreatorWallet) {
        const merchantWallet = activeOrder.merchant.walletAddress;
        const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);

        if (!solanaWallet.connected) {
          showAlert({ title: 'Error', message: 'Please connect your wallet to release the escrow.', variant: 'danger' });
          setIsLoading(false);
          return;
        }

        if (!isValidSolanaAddress) {
          showAlert({ title: 'Error', message: 'Merchant wallet address is invalid. Please contact support.', variant: 'danger' });
          setIsLoading(false);
          return;
        }

        console.log('[Release] Releasing escrow to merchant:', {
          creatorPubkey: activeOrder.escrowCreatorWallet,
          tradeId: activeOrder.escrowTradeId,
          counterparty: merchantWallet,
          merchantName: activeOrder.merchant.name,
        });

        const releaseResult = await solanaWallet.releaseEscrow({
          creatorPubkey: activeOrder.escrowCreatorWallet,
          tradeId: activeOrder.escrowTradeId,
          counterparty: merchantWallet,
        });

        if (!releaseResult.success) {
          console.error('[Release] Escrow release failed:', releaseResult.error);
          showAlert({ title: 'Error', message: `Failed to release escrow: ${releaseResult.error || 'Unknown error'}`, variant: 'danger' });
          setIsLoading(false);
          return;
        }

        console.log('[Release] Escrow released:', releaseResult.txHash);

        // Record the release on the backend - this also marks order as completed
        const escrowRes = await fetch(`/api/orders/${activeOrder.id}/escrow`, {
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
      const res = await fetch(`/api/orders/${activeOrder.id}`, {
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
        showAlert({ title: 'Error', message: errorMsg, variant: 'danger' });
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
      showAlert({ title: 'Error', message: 'Failed to release escrow. Please try again.', variant: 'danger' });
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
      const res = await fetch(`/api/orders/${activeOrder.id}/dispute`, {
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
      const res = await fetch(`/api/orders/${orderId}/dispute`);
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
      const res = await fetch(`/api/orders/${activeOrder.id}/dispute/confirm`, {
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
      const res = await fetch(`/api/orders/${activeOrder.id}/extension`, {
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
      const res = await fetch(`/api/orders/${extensionRequest.orderId}/extension`, {
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

  const addBankAccount = async () => {
    if (!newBank.bank || !newBank.iban || !newBank.name || !userId) return;

    try {
      const res = await fetch(`/api/users/${userId}/bank-accounts`, {
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

  return {
    // Theme
    theme, toggleTheme,
    // Sounds & Toast
    playSound, toast,
    // Screen navigation
    screen, setScreen,
    // Trade state
    tradeType, setTradeType, tradePreference, setTradePreference,
    paymentMethod, setPaymentMethod, amount, setAmount,
    selectedOffer, setSelectedOffer, currentRate,
    // Orders
    orders, setOrders, activeOrderId, setActiveOrderId,
    activityTab, setActivityTab,
    pendingOrders, completedOrders,
    timedOutOrders, timerTick,
    // Active order + chat
    activeOrder, activeChat,
    chatWindows, openChat, sendChatMessage,
    realtimeOrder, refetchActiveOrder,
    // User state
    userId, setUserId, userName, setUserName,
    userBalance, setUserBalance, userWallet, setUserWallet,
    newUserName, setNewUserName,
    // Auth
    loginForm, setLoginForm, authMode, setAuthMode,
    loginError, setLoginError,
    isLoggingIn, isLoading, setIsLoading, isInitializing,
    // Wallet
    solanaWallet, embeddedWallet, IS_EMBEDDED_WALLET,
    showWalletModal, setShowWalletModal,
    showUsernameModal, setShowUsernameModal,
    showWalletSetup, setShowWalletSetup,
    showWalletUnlock, setShowWalletUnlock,
    walletUsername, setWalletUsername,
    usernameError, setUsernameError,
    isAuthenticating, isAuthenticatingRef, lastAuthenticatedWalletRef, authAttemptedForWalletRef,
    // Bank accounts
    bankAccounts, setBankAccounts,
    showAddBank, setShowAddBank,
    newBank, setNewBank,
    // Chat
    showChat, setShowChat,
    chatMessage, setChatMessage,
    chatInputRef, chatMessagesRef,
    // Escrow
    escrowTxStatus, setEscrowTxStatus,
    escrowTxHash, setEscrowTxHash,
    escrowError, setEscrowError,
    userBankAccount, setUserBankAccount,
    // Dispute
    showDisputeModal, setShowDisputeModal,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute, disputeInfo,
    isRespondingToResolution,
    // Extension
    extensionRequest, requestingExtension,
    // Matching
    pendingTradeData, setPendingTradeData, matchingTimeLeft, formatTimeLeft,
    // Acceptance popup
    showAcceptancePopup, setShowAcceptancePopup,
    acceptedOrderInfo,
    // Resolved disputes
    resolvedDisputes, setResolvedDisputes,
    // Rating & copy
    rating, setRating, copied, setCopied,
    // Fee calculations
    fiatAmount: parseFloat(amount) * currentRate || 0,
    currentFees: FEE_CONFIG[tradePreference],
    // Handlers
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
    // maxW constant
    maxW,
  };
}
