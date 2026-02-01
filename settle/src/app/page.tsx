"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useRealtimeOrder } from "@/hooks/useRealtimeOrder";
import { usePusher } from "@/context/PusherContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp,
  ChevronRight,
  ChevronLeft,
  MessageCircle,
  X,
  Check,
  Star,
  Copy,
  MapPin,
  Clock,
  User,
  Plus,
  Trash2,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Bell,
  Navigation,
  ExternalLink,
  Banknote,
  Building2,
  AlertTriangle,
  Loader2,
  Sun,
  Moon,
  Lock,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useSounds } from "@/hooks/useSounds";
import dynamic from "next/dynamic";

// Dynamically import wallet components (client-side only)
const WalletConnectModal = dynamic(() => import("@/components/WalletConnectModal"), { ssr: false });
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });
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
      network: 'devnet' as const,
      programReady: false,
      reinitializeProgram: () => {},
    };
  }
};

// Types
type Screen = "home" | "order" | "escrow" | "orders" | "profile" | "chats" | "create-offer" | "cash-confirm" | "matching" | "welcome";
type TradeType = "buy" | "sell";
type TradePreference = "fast" | "cheap" | "best";
type PaymentMethod = "bank" | "cash";
type OrderStep = 1 | 2 | 3 | 4;
type OrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";

// Merchant type from DB
interface Merchant {
  id: string;
  display_name: string;
  business_name: string;
  rating: number;
  total_trades: number;
  is_online: boolean;
  avg_response_time_mins: number;
  wallet_address?: string;
}

// Offer type from DB
interface Offer {
  id: string;
  merchant_id: string;
  type: "buy" | "sell";
  payment_method: PaymentMethod;
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_iban: string | null;
  location_name: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  meeting_instructions: string | null;
  merchant: Merchant;
}

// Order from DB
interface DbOrder {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  offer_id: string;
  type: "buy" | "sell";
  payment_method: PaymentMethod;
  crypto_amount: number;
  crypto_currency: string;
  fiat_amount: number;
  fiat_currency: string;
  rate: number;
  status: string;
  payment_details: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
  merchant: Merchant;
  offer: Offer;
  unread_count?: number;
  last_message?: {
    content: string;
    sender_type: "user" | "merchant" | "system";
    created_at: string;
  } | null;
  // Escrow on-chain references
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  // Merchant's wallet address captured when accepting sell orders
  acceptor_wallet_address?: string;
}

// UI Order type (maps DB order to UI)
interface Order {
  id: string;
  type: TradeType;
  cryptoAmount: string;
  cryptoCode: string;
  fiatAmount: string;
  fiatCode: string;
  merchant: {
    id: string;
    name: string;
    rating: number;
    trades: number;
    rate: number;
    paymentMethod: PaymentMethod;
    bank?: string;
    iban?: string;
    accountName?: string;
    location?: string;
    address?: string;
    lat?: number;
    lng?: number;
    meetingSpot?: string;
    walletAddress?: string;
  };
  status: OrderStatus;
  step: OrderStep;
  createdAt: Date;
  expiresAt: Date;
  dbStatus?: string; // Original DB status
  unreadCount?: number;
  lastMessage?: {
    content: string;
    fromMerchant: boolean;
    createdAt: Date;
  } | null;
  // Escrow on-chain references for release
  escrowTradeId?: number;
  escrowTradePda?: string;
  escrowCreatorWallet?: string;
  escrowTxHash?: string;
  // Merchant's wallet address captured when accepting (for sell order escrow release)
  acceptorWalletAddress?: string;
}

interface BankAccount {
  id: string;
  bank: string;
  iban: string;
  name: string;
  isDefault: boolean;
}

// Map DB status to UI status/step
function mapDbStatusToUI(dbStatus: string): { status: OrderStatus; step: OrderStep } {
  switch (dbStatus) {
    case 'pending':
      return { status: 'pending', step: 1 };
    case 'accepted':
    case 'escrow_pending':
    case 'escrowed':
    case 'payment_pending':
      return { status: 'payment', step: 2 };
    case 'payment_sent':
    case 'payment_confirmed':
    case 'releasing':
      return { status: 'waiting', step: 3 };
    case 'completed':
      return { status: 'complete', step: 4 };
    case 'cancelled':
    case 'disputed':
    case 'expired':
      return { status: 'complete', step: 4 };
    default:
      return { status: 'pending', step: 1 };
  }
}

// Map DB order to UI order
function mapDbOrderToUI(dbOrder: DbOrder): Order | null {
  // Guard against incomplete data from Pusher events
  if (!dbOrder || !dbOrder.merchant) {
    return null;
  }

  const { status, step } = mapDbStatusToUI(dbOrder.status);
  const offer = dbOrder.offer;
  const merchant = dbOrder.merchant;

  return {
    id: dbOrder.id,
    type: dbOrder.type as TradeType,
    cryptoAmount: dbOrder.crypto_amount.toString(),
    cryptoCode: dbOrder.crypto_currency,
    fiatAmount: dbOrder.fiat_amount.toString(),
    fiatCode: dbOrder.fiat_currency,
    merchant: {
      id: merchant.id,
      name: merchant.display_name,
      rating: parseFloat(merchant.rating?.toString() || '5.0'),
      trades: merchant.total_trades,
      rate: parseFloat(dbOrder.rate.toString()),
      paymentMethod: dbOrder.payment_method,
      bank: offer?.bank_name || undefined,
      iban: offer?.bank_iban || undefined,
      accountName: offer?.bank_account_name || undefined,
      location: offer?.location_name || undefined,
      address: offer?.location_address || undefined,
      lat: offer?.location_lat || undefined,
      lng: offer?.location_lng || undefined,
      meetingSpot: offer?.meeting_instructions || undefined,
      walletAddress: merchant.wallet_address || undefined,
    },
    status,
    step,
    createdAt: new Date(dbOrder.created_at),
    expiresAt: new Date(dbOrder.expires_at),
    dbStatus: dbOrder.status,
    unreadCount: dbOrder.unread_count || 0,
    lastMessage: dbOrder.last_message ? {
      content: dbOrder.last_message.content,
      fromMerchant: dbOrder.last_message.sender_type === 'merchant',
      createdAt: new Date(dbOrder.last_message.created_at),
    } : null,
    // Escrow on-chain references for release
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    // Merchant's wallet address captured when accepting (for sell order escrow release)
    acceptorWalletAddress: dbOrder.acceptor_wallet_address,
  };
}

// Fee structure based on trade preference
const FEE_CONFIG = {
  fast: { totalFee: 0.03, traderCut: 0.01 },    // 3% total, 1% to trader
  best: { totalFee: 0.025, traderCut: 0.005 },  // 2.5% total, 0.5% to trader
  cheap: { totalFee: 0.015, traderCut: 0.0025 }, // 1.5% total, 0.25% to trader
} as const;

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { playSound } = useSounds();
  const [screen, setScreen] = useState<Screen>("home");
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [tradePreference, setTradePreference] = useState<TradePreference>("fast");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [amount, setAmount] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
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

  // Real-time chat hook (replaces polling)
  const {
    chatWindows,
    openChat,
    sendMessage: sendChatMessage,
  } = useRealtimeChat({
    actorType: "user",
    actorId: userId || undefined,
    onNewMessage: () => {
      playSound('message');
    },
  });

  // Real-time order updates for active order
  const { order: realtimeOrder } = useRealtimeOrder(activeOrderId, {
    onStatusChange: (newStatus, previousStatus, orderData) => {
      // Auto-transition from matching screen when merchant accepts
      if (screen === "matching" && previousStatus === 'pending' && newStatus !== 'pending') {
        setPendingTradeData(null);
        setScreen("order");
        playSound('notification');

        // Show acceptance popup when merchant accepts the order
        if (newStatus === 'accepted' || newStatus === 'escrowed') {
          setAcceptedOrderInfo({
            merchantName: orderData?.merchant?.display_name || orderData?.merchant?.business_name || 'Merchant',
            cryptoAmount: orderData?.crypto_amount || 0,
            fiatAmount: orderData?.fiat_amount || 0,
            orderType: orderData?.type || 'buy',
          });
          setShowAcceptancePopup(true);
          // Auto-hide after 5 seconds
          setTimeout(() => setShowAcceptancePopup(false), 5000);
        }
      }

      // Auto-transition from escrow screen when merchant accepts (for sell orders)
      if (screen === "escrow" && escrowTxStatus === 'success' && (newStatus === 'escrowed' || newStatus === 'accepted')) {
        setScreen("order");
        setEscrowTxStatus('idle');
        setAmount("");
        setSelectedOffer(null);
        playSound('notification');
      }

      // Auto-transition when merchant sends payment (user needs to confirm)
      if (newStatus === 'payment_sent') {
        if (screen !== 'order') {
          setScreen("order");
        }
        playSound('notification');
      }

      // Play trade complete sound
      if (newStatus === 'completed') {
        playSound('trade_complete');
        // Refresh on-chain wallet balance to sync with platform balance
        if (solanaWallet.connected) {
          solanaWallet.refreshBalances();
        }
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
    },
    onExtensionRequested: (data) => {
      // Merchant requested an extension
      if (data.requestedBy === 'merchant') {
        setExtensionRequest({
          orderId: data.orderId,
          requestedBy: data.requestedBy,
          extensionMinutes: data.extensionMinutes,
          extensionCount: data.extensionCount,
          maxExtensions: data.maxExtensions,
        });
        playSound('notification');
      }
    },
    onExtensionResponse: (data) => {
      // Clear extension request state
      setExtensionRequest(null);
      if (data.accepted) {
        playSound('click');
      } else {
        playSound('error');
      }
    },
  });

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
              actor_id: 'system',
            }),
          }).catch(console.error);
        }
        setPendingTradeData(null);
        setScreen("home");
        playSound('error');
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

  // Active order: prefer real-time data if available, fallback to orders list
  const orderFromList = orders.find(o => o.id === activeOrderId);
  const mappedRealtimeOrder = realtimeOrder ? mapDbOrderToUI(realtimeOrder as unknown as DbOrder) : null;
  const activeOrder = mappedRealtimeOrder
    ? { ...orderFromList, ...mappedRealtimeOrder }
    : orderFromList;

  // Get active chat for current order
  const activeChat = activeOrder ? chatWindows.find(w => w.orderId === activeOrder.id) : null;
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
  const handleUserLogin = useCallback(async () => {
    if (!loginForm.username || !loginForm.password) {
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
      const res = await fetch('/api/auth/user', {
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

  // Open chat when showChat is toggled
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

  // Scroll to bottom when chat messages change
  useEffect(() => {
    if (showChat && chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [showChat, activeChat?.messages]);

  // Handle sending message
  const handleSendMessage = useCallback(() => {
    if (!activeChat || !chatMessage.trim()) return;
    sendChatMessage(activeChat.id, chatMessage);
    setChatMessage("");
    playSound('send');
  }, [activeChat, chatMessage, sendChatMessage, playSound]);

  // Note: Order updates now come via Pusher WebSocket (useRealtimeOrder hook above)
  // The onStatusChange callback handles screen transitions automatically

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
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
      const offerRes = await fetch(`/api/offers?${params}`);
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

    // Step 2: Check balance
    const amountNum = parseFloat(amount);
    console.log('[Escrow] Balance check:', { usdtBalance: solanaWallet.usdtBalance, amountNeeded: amountNum });
    if (solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance < amountNum) {
      setEscrowError(`Insufficient USDT balance. You have ${solanaWallet.usdtBalance.toFixed(2)} USDT but need ${amountNum} USDT.`);
      setEscrowTxStatus('error');
      return;
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
      if (activeOrder.type === 'sell' && activeOrder.escrowTradeId && activeOrder.escrowCreatorWallet) {
        // IMPORTANT: Use the same wallet that was used when locking escrow
        // The escrow was locked with merchant.walletAddress (from the offer)
        // acceptorWalletAddress is just for verification, but release MUST go to the locked counterparty
        const merchantWallet = activeOrder.merchant.walletAddress;
        const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);

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

        console.log('[Release] Releasing escrow to merchant:', {
          creatorPubkey: activeOrder.escrowCreatorWallet,
          tradeId: activeOrder.escrowTradeId,
          counterparty: merchantWallet,
          merchantName: activeOrder.merchant.name,
        });

        // Release escrow on-chain - this MUST succeed
        const releaseResult = await solanaWallet.releaseEscrow({
          creatorPubkey: activeOrder.escrowCreatorWallet,
          tradeId: activeOrder.escrowTradeId,
          counterparty: merchantWallet,
        });

        if (!releaseResult.success) {
          console.error('[Release] On-chain escrow release failed:', releaseResult.error);
          alert(`Failed to release escrow: ${releaseResult.error || 'Unknown error'}`);
          setIsLoading(false);
          return; // Don't mark as completed if escrow release failed
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
          // Escrow release API already marked order as completed, update UI and return
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
        } else {
          // Release succeeded on-chain but backend update failed - still show success
          // The release_tx_hash was recorded, order will be completed
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
        }
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
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

  // Show loading while initializing
  if (isInitializing) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-black flex flex-col items-center overflow-y-auto">
      <AnimatePresence mode="wait">
        {/* WELCOME / LOGIN */}
        {screen === "welcome" && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col items-center justify-center px-6`}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 15, stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center mb-8 glow-accent"
            >
              <Wallet className="w-10 h-10 text-white" />
            </motion.div>
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-[32px] font-bold text-white mb-3 text-center"
            >
              Welcome to Blip <span className="text-orange-500">Money</span>
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-neutral-400 text-center mb-8 text-[15px] leading-relaxed"
            >
              The easiest way to buy and sell crypto<br />with local currency
            </motion.p>

            {loginError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 mb-4"
              >
                {loginError}
              </motion.div>
            )}

            {/* Login/Register Toggle */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="w-full flex rounded-xl bg-neutral-900 p-1 mb-4"
            >
              <button
                onClick={() => { setAuthMode('login'); setLoginError(''); }}
                className={`flex-1 py-2 rounded-lg text-[14px] font-medium transition-colors ${
                  authMode === 'login' ? 'bg-orange-500 text-white' : 'text-neutral-400'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setAuthMode('register'); setLoginError(''); }}
                className={`flex-1 py-2 rounded-lg text-[14px] font-medium transition-colors ${
                  authMode === 'register' ? 'bg-orange-500 text-white' : 'text-neutral-400'
                }`}
              >
                Create Account
              </button>
            </motion.div>

            {/* Username/Password Form */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="w-full space-y-4"
            >
              <div className="w-full">
                <label className="text-[13px] text-neutral-500 mb-2 block">Username</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder={authMode === 'register' ? 'Choose a username' : 'Enter your username'}
                  className="w-full bg-neutral-900 rounded-2xl px-4 py-4 text-white text-[17px] placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-orange-500"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>

              <div className="w-full">
                <label className="text-[13px] text-neutral-500 mb-2 block">Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder={authMode === 'register' ? 'Create a password (min 6 chars)' : 'Enter your password'}
                  className="w-full bg-neutral-900 rounded-2xl px-4 py-4 text-white text-[17px] placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-orange-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      authMode === 'login' ? handleUserLogin() : handleUserRegister();
                    }
                  }}
                />
              </div>

              <button
                onClick={authMode === 'login' ? handleUserLogin : handleUserRegister}
                disabled={isLoggingIn}
                className="w-full py-4 rounded-2xl text-[17px] font-semibold flex items-center justify-center gap-2 bg-orange-500 text-white disabled:opacity-50 hover:bg-orange-600 transition-colors"
              >
                {isLoggingIn ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : authMode === 'login' ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </button>

              <p className="text-neutral-500 text-[12px] text-center">
                You can connect your wallet after signing in to enable on-chain trading
              </p>
            </motion.div>
          </motion.div>
        )}

        {/* HOME */}
        {screen === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
          >
            {/* Top Bar */}
            <div className="px-5 pt-14 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setScreen("profile")}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white text-sm font-semibold"
                >
                  {userName.charAt(0).toUpperCase()}
                </button>
                <div>
                  <p className="text-[15px] font-semibold text-white">{userName}</p>
                  <p className="text-[13px] text-neutral-500 font-medium font-mono">
                    {solanaWallet.connected && solanaWallet.walletAddress
                      ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                      : 'Connect wallet'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setScreen("chats")}
                  className="w-10 h-10 rounded-full bg-neutral-900 flex items-center justify-center relative"
                >
                  <MessageCircle className="w-[18px] h-[18px] text-neutral-400" />
                  {orders.reduce((sum, o) => sum + (o.unreadCount || 0), 0) > 0 && (
                    <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-orange-500 border-2 border-black flex items-center justify-center">
                      <span className="text-[8px] font-bold text-white">
                        {orders.reduce((sum, o) => sum + (o.unreadCount || 0), 0)}
                      </span>
                    </div>
                  )}
                </button>
                <button
                  onClick={() => setShowWalletModal(true)}
                  className={`h-10 rounded-full flex items-center justify-center gap-2 px-3 transition-all ${
                    solanaWallet.connected
                      ? 'bg-[#26A17B]/10 border border-[#26A17B]/30'
                      : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:opacity-90'
                  }`}
                >
                  {solanaWallet.connected ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-[#26A17B]" />
                      <span className="text-[12px] font-bold text-[#26A17B]">
                        {solanaWallet.usdtBalance !== null
                          ? solanaWallet.usdtBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })
                          : '...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4 text-white" />
                      <span className="text-[12px] font-semibold text-white">Connect</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="px-5 py-4">
              {/* Wallet Connection Prompt - show if user logged in but no wallet */}
              {userId && !solanaWallet.connected && !solanaWallet.walletAddress && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 rounded-2xl p-4 mb-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                      <Wallet className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] font-medium text-white mb-1">Connect Your Wallet</p>
                      <p className="text-[13px] text-neutral-400 mb-3">
                        Link your Solana wallet to enable on-chain escrow and secure trading
                      </p>
                      <button
                        onClick={() => setShowWalletModal(true)}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
                      >
                        Connect Wallet
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Active Order */}
              {pendingOrders.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => {
                    setActiveOrderId(pendingOrders[0].id);
                    if (pendingOrders[0].status === "pending") {
                      setPendingTradeData({
                        amount: pendingOrders[0].cryptoAmount,
                        fiatAmount: pendingOrders[0].fiatAmount,
                        type: pendingOrders[0].type,
                        paymentMethod: pendingOrders[0].merchant.paymentMethod
                      });
                      setScreen("matching");
                    } else {
                      setScreen("order");
                    }
                  }}
                  className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center gap-3 mb-4"
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-white"
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-[15px] font-medium text-white">
                      {pendingOrders[0].type === "buy" ? "Buying" : "Selling"} {pendingOrders[0].cryptoAmount} USDC
                    </p>
                    <p className="text-[13px] text-neutral-500">
                      {pendingOrders[0].status === "pending" ? "Finding merchant..." : `Step ${pendingOrders[0].step} of 4`}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-500" />
                </motion.button>
              )}
            </div>

            {/* Trade Section */}
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="flex-1 bg-neutral-950 rounded-t-[32px] px-5 pt-6 pb-6 overflow-y-auto smooth-scroll">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[17px] font-semibold text-white">Trade</h2>
                <div className="flex items-center gap-1 bg-neutral-900 rounded-full p-1">
                  {(["buy", "sell"] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setTradeType(type)}
                      className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${
                        tradeType === type
                          ? "bg-orange-500 text-white"
                          : "text-neutral-500"
                      }`}
                    >
                      {type === "buy" ? "Buy" : "Sell"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount Input */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="glass-card rounded-2xl p-4 mb-4 hover-lift"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] text-neutral-500">
                    {tradeType === "buy" ? "You pay" : "You sell"}
                  </span>
                  {solanaWallet.connected ? (
                    <span className="text-[13px] text-neutral-500">
                      Balance: <span className="text-[#26A17B]">{solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '...'}</span> USDT
                    </span>
                  ) : (
                    <button
                      onClick={() => setShowWalletModal(true)}
                      className="text-[13px] text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      Connect Wallet
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    className="flex-1 text-[32px] font-semibold text-white bg-transparent outline-none placeholder:text-neutral-700 focus-glow"
                  />
                  <div className="flex items-center gap-2 bg-neutral-800/80 rounded-xl px-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-[#26A17B] flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">₮</span>
                    </div>
                    <span className="text-[15px] font-medium text-white">USDT</span>
                  </div>
                </div>
              </motion.div>

              {/* Swap Icon */}
              <div className="flex justify-center -my-2 relative z-10">
                <div className="w-10 h-10 rounded-full bg-neutral-800 border-4 border-neutral-950 flex items-center justify-center">
                  <ArrowDownUp className="w-4 h-4 text-neutral-400" />
                </div>
              </div>

              {/* Output */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass-card rounded-2xl p-4 mb-3 hover-lift"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] text-neutral-500">
                    {tradeType === "buy" ? "You receive" : "You get"}
                  </span>
                  <span className="text-[13px] text-neutral-500">Rate: 1 USDC = {currentRate} AED</span>
                </div>
                <div className="flex items-center gap-3">
                  <p className="flex-1 text-[32px] font-semibold text-white">
                    <span className="text-neutral-400">د.إ</span> {amount ? parseFloat(fiatAmount).toLocaleString() : "0"}
                  </p>
                  <div className="flex items-center gap-2 bg-neutral-800/80 rounded-xl px-3 py-2">
                    <span className="text-[15px]">🇦🇪</span>
                    <span className="text-[15px] font-medium text-white">AED</span>
                  </div>
                </div>
              </motion.div>

              {/* Fee Breakdown - Subtle inline */}
              {amount && parseFloat(amount) > 0 && (
                <div className="flex items-center justify-center gap-3 text-[10px] text-neutral-600 mb-3">
                  <span>Fee: {(currentFees.totalFee * 100).toFixed(1)}%</span>
                  <span className="text-neutral-700">•</span>
                  <span className="text-neutral-500">Trader gets {(currentFees.traderCut * 100).toFixed(2)}%</span>
                </div>
              )}

              {/* Payment Method - Compact */}
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[13px] text-neutral-500">Pay via</p>
                <div className="flex items-center gap-1 bg-neutral-900 rounded-lg p-1">
                  <button
                    onClick={() => setPaymentMethod("bank")}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                      paymentMethod === "bank"
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500"
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    Bank
                  </button>
                  <button
                    onClick={() => setPaymentMethod("cash")}
                    className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                      paymentMethod === "cash"
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500"
                    }`}
                  >
                    <Banknote className="w-3.5 h-3.5" />
                    Cash
                  </button>
                </div>
              </div>

              {/* Speed Options */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-3">Matching priority</p>
                <div className="flex gap-2">
                  {([
                    { key: "fast", label: "Fastest" },
                    { key: "best", label: "Best rate" },
                    { key: "cheap", label: "Cheapest" },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setTradePreference(key)}
                      className={`flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                        tradePreference === key
                          ? "bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30"
                          : "bg-neutral-900 text-neutral-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={startTrade}
                disabled={!amount || parseFloat(amount) <= 0 || isLoading || !userId}
                className={`w-full py-4 rounded-2xl text-[17px] font-semibold transition-all flex items-center justify-center gap-2 press-effect ${
                  amount && parseFloat(amount) > 0 && !isLoading
                    ? "bg-orange-500 text-white glow-accent"
                    : "bg-neutral-900 text-neutral-600"
                }`}
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}
              </motion.button>

              {/* Create Offer */}
              <button
                onClick={() => setScreen("create-offer")}
                className="w-full mt-3 py-3 text-[15px] text-neutral-500 font-medium"
              >
                Have a large amount? <span className="text-orange-400">Create an offer</span>
              </button>
            </motion.div>

            {/* Bottom Nav */}
            <div className="fixed bottom-0 left-0 right-0 z-50">
              <div className={`${maxW} mx-auto`}>
                <div className="glass-card border-t border-white/5 px-6 pb-8 pt-3">
                  <div className="flex items-center justify-around">
                    {[
                      { key: "home", icon: Wallet, label: "Home" },
                      { key: "orders", icon: Clock, label: "Activity" },
                      { key: "profile", icon: User, label: "Profile" },
                    ].map(({ key, icon: Icon, label }) => (
                      <motion.button
                        key={key}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setScreen(key as Screen)}
                        className={`flex flex-col items-center gap-1 relative px-4 py-1 rounded-xl transition-all ${
                          screen === key ? "text-orange-400" : "text-neutral-600"
                        }`}
                      >
                        {screen === key && (
                          <motion.div
                            layoutId="nav-indicator"
                            className="absolute inset-0 bg-orange-500/10 rounded-xl"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                          />
                        )}
                        <Icon className="w-5 h-5 relative z-10" strokeWidth={screen === key ? 2.5 : 1.5} />
                        <span className="text-[10px] font-medium relative z-10">{label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ESCROW */}
        {screen === "escrow" && (
          <motion.div
            key="escrow"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center">
              <button onClick={() => { setScreen("home"); setEscrowTxStatus('idle'); setEscrowError(null); }} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Confirm Escrow</h1>
            </div>

            <div className="flex-1 px-5 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center mb-6">
                  <Shield className="w-10 h-10 text-violet-400" />
                </div>
                <h2 className="text-[22px] font-semibold text-white mb-2">Lock {amount} USDT</h2>
                <p className="text-[15px] text-neutral-500 mb-6 max-w-[280px]">
                  Your USDT will be held securely on Solana until you confirm receiving payment
                </p>

                {/* Wallet Status */}
                <div className="w-full bg-neutral-900 rounded-2xl p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] text-neutral-500">Wallet</span>
                    {solanaWallet.connected ? (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-[14px] text-emerald-400 font-mono">
                          {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowWalletModal(true)}
                        className="text-[14px] text-violet-400 font-medium"
                      >
                        Connect Wallet
                      </button>
                    )}
                  </div>
                  {solanaWallet.connected && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-800">
                      <span className="text-[15px] text-neutral-500">Balance</span>
                      <span className={`text-[15px] font-medium ${
                        solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance >= parseFloat(amount || '0')
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}>
                        {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
                      </span>
                    </div>
                  )}
                </div>

                {/* Order Details */}
                <div className="w-full bg-neutral-900 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] text-neutral-500">Amount to Lock</span>
                    <span className="text-[15px] font-medium text-white">{amount} USDT</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] text-neutral-500">You'll receive</span>
                    <span className="text-[15px] font-medium text-emerald-400">د.إ {parseFloat(fiatAmount).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] text-neutral-500">Rate</span>
                    <span className="text-[15px] text-neutral-400">1 USDT = {currentRate} AED</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] text-neutral-500">Network</span>
                    <span className="text-[14px] text-violet-400">Solana Devnet</span>
                  </div>
                </div>

                {/* Bank Account Note - where merchant will send fiat */}
                <div className="w-full bg-neutral-900 rounded-2xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Banknote className="w-4 h-4 text-neutral-500" />
                    <span className="text-[12px] text-neutral-500">Payment details for merchant</span>
                  </div>
                  <textarea
                    value={userBankAccount}
                    onChange={(e) => setUserBankAccount(e.target.value)}
                    placeholder="Enter your bank IBAN or payment details..."
                    rows={2}
                    className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-neutral-600 outline-none focus:ring-1 focus:ring-orange-500 resize-none"
                  />
                </div>

                {/* Program Not Ready Warning - shows when wallet connected but Anchor program failed to initialize */}
                {solanaWallet.connected && !solanaWallet.programReady && (
                  <div className="w-full mt-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="text-left flex-1">
                        <p className="text-[14px] text-amber-400 font-medium">Wallet Needs Reconnection</p>
                        <p className="text-[13px] text-neutral-400 mt-1">
                          The escrow program is not ready. Please reconnect your wallet.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          solanaWallet.disconnect();
                          setTimeout(() => setShowWalletModal(true), 100);
                        }}
                        className="flex-1 py-2 rounded-lg bg-amber-500/20 text-[14px] text-amber-400 font-medium"
                      >
                        Reconnect Wallet
                      </button>
                      <button
                        onClick={() => solanaWallet.reinitializeProgram()}
                        className="py-2 px-4 rounded-lg bg-neutral-800 text-[14px] text-neutral-300"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {escrowError && (
                  <div className="w-full mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="text-left">
                        <p className="text-[14px] text-red-400 font-medium">Transaction Failed</p>
                        <p className="text-[13px] text-neutral-400 mt-1">{escrowError}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setEscrowError(null); setEscrowTxStatus('idle'); }}
                      className="w-full mt-3 py-2 rounded-lg bg-neutral-800 text-[14px] text-neutral-300"
                    >
                      Try Again
                    </button>
                  </div>
                )}
              </div>

              {/* Show waiting state after success */}
              {escrowTxStatus === 'success' ? (
                <div className="pb-10 space-y-4">
                  {/* Success indicator */}
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Lock className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-emerald-400">Escrow Locked</p>
                        <p className="text-[13px] text-neutral-400">Your USDC is secured on-chain</p>
                      </div>
                    </div>
                    {escrowTxHash && (
                      <a
                        href={`https://explorer.solana.com/tx/${escrowTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[13px] text-emerald-400/70 hover:text-emerald-400"
                      >
                        View Transaction <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Waiting for merchant */}
                  <div className="bg-neutral-900 rounded-2xl p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[15px] font-medium text-white">Waiting for merchant</p>
                        <p className="text-[13px] text-neutral-500">Merchant will accept and send fiat to your bank</p>
                      </div>
                    </div>
                    <div className="mt-3 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-amber-400"
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        style={{ width: "30%" }}
                      />
                    </div>
                  </div>

                  {/* Go to order details */}
                  <button
                    onClick={() => setScreen("order")}
                    className="w-full py-3 rounded-xl bg-neutral-800 text-[15px] font-medium text-white"
                  >
                    View Order Details
                  </button>
                </div>
              ) : (
                <div className="pb-10">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={confirmEscrow}
                    disabled={isLoading || (solanaWallet.connected && !solanaWallet.programReady)}
                    className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-orange-500 text-white flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {escrowTxStatus === 'signing' && (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Sign in Wallet...
                      </>
                    )}
                    {escrowTxStatus === 'confirming' && (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Confirming...
                      </>
                    )}
                    {escrowTxStatus === 'recording' && (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Recording...
                      </>
                    )}
                    {(escrowTxStatus === 'idle' || escrowTxStatus === 'error' || escrowTxStatus === 'connecting') && (
                      solanaWallet.connected
                        ? (solanaWallet.programReady ? "Confirm & Lock" : "Wallet Not Ready")
                        : "Connect Wallet to Lock"
                    )}
                  </motion.button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ORDER */}
        {screen === "order" && activeOrder && (
          <motion.div
            key="order"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center">
              <button onClick={() => setScreen("home")} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Order Details</h1>
            </div>

            <div className="flex-1 px-5 overflow-auto pb-6">
              {/* Order Summary */}
              <div className="bg-neutral-900 rounded-2xl p-4 mb-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    activeOrder.type === "buy" ? "bg-emerald-500/10" : "bg-orange-500/10"
                  }`}>
                    {activeOrder.type === "buy"
                      ? <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
                      : <ArrowUpRight className="w-5 h-5 text-violet-400" />
                    }
                  </div>
                  <div>
                    <p className="text-[17px] font-semibold text-white">
                      {activeOrder.type === "buy" ? "Buying" : "Selling"} ${activeOrder.cryptoAmount} USDC
                    </p>
                    <p className="text-[13px] text-neutral-500">
                      د.إ {parseFloat(activeOrder.fiatAmount).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Progress */}
                <div className="flex items-center gap-1 mb-2">
                  {[1, 2, 3, 4].map(step => (
                    <div
                      key={step}
                      className={`flex-1 h-1 rounded-full ${
                        step <= activeOrder.step ? "bg-emerald-400" : "bg-neutral-800"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[13px] text-neutral-500">Step {activeOrder.step} of 4</p>
              </div>

              {/* Escrow Status Section - Show for sell orders with escrow */}
              {activeOrder.type === "sell" && activeOrder.escrowTxHash && (
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4 mb-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] font-semibold text-white">Escrow Locked</p>
                      <p className="text-[13px] text-neutral-400">
                        Your USDC is secured on-chain
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Check className="w-4 h-4 text-emerald-400" />
                    </div>
                  </div>

                  <div className="space-y-2 text-[13px]">
                    {activeOrder.escrowTradeId && (
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-500">Trade ID</span>
                        <span className="text-white font-mono">#{activeOrder.escrowTradeId}</span>
                      </div>
                    )}
                    {activeOrder.escrowTxHash && (
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-500">Transaction</span>
                        <a
                          href={`https://explorer.solana.com/tx/${activeOrder.escrowTxHash}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-violet-400 hover:text-violet-300"
                        >
                          <span className="font-mono">{activeOrder.escrowTxHash.slice(0, 8)}...{activeOrder.escrowTxHash.slice(-6)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Extension Request Banner */}
              {extensionRequest && extensionRequest.requestedBy === 'merchant' && extensionRequest.orderId === activeOrder.id && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 mb-4"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <Clock className="w-5 h-5 text-orange-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] font-semibold text-white">Extension Requested</p>
                      <p className="text-[13px] text-neutral-400">
                        Merchant wants +{extensionRequest.extensionMinutes} minutes
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => respondToExtension(true)}
                      disabled={requestingExtension}
                      className="flex-1 py-3 rounded-xl bg-emerald-500 text-white text-[15px] font-semibold disabled:opacity-50"
                    >
                      {requestingExtension ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Accept"}
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => respondToExtension(false)}
                      disabled={requestingExtension}
                      className="flex-1 py-3 rounded-xl bg-neutral-800 text-white text-[15px] font-semibold disabled:opacity-50"
                    >
                      Decline
                    </motion.button>
                  </div>
                  <p className="text-[11px] text-neutral-500 text-center mt-2">
                    Extensions used: {extensionRequest.extensionCount}/{extensionRequest.maxExtensions}
                  </p>
                </motion.div>
              )}

              {/* Request Extension Button - shown when user wants to extend */}
              {activeOrder.step >= 2 && activeOrder.step < 4 && !extensionRequest && (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={requestExtension}
                  disabled={requestingExtension}
                  className="w-full py-3 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 text-[13px] font-medium mb-4 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {requestingExtension ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Clock className="w-4 h-4" />
                      Request Time Extension
                    </>
                  )}
                </motion.button>
              )}

              {/* Steps */}
              <div className="space-y-3">
                {/* Step 1 */}
                <div className={`p-4 rounded-2xl ${activeOrder.step >= 1 ? "bg-neutral-900" : "bg-neutral-950"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold ${
                      activeOrder.step > 1 ? "bg-emerald-400 text-black" :
                      activeOrder.step === 1 ? "bg-amber-400 text-black" : "bg-neutral-800 text-neutral-500"
                    }`}>
                      {activeOrder.step > 1 ? <Check className="w-4 h-4" /> : "1"}
                    </div>
                    <div>
                      <p className={`text-[15px] font-medium ${activeOrder.step >= 1 ? "text-white" : "text-neutral-600"}`}>
                        Order created
                      </p>
                      {activeOrder.step >= 1 && (
                        <p className="text-[13px] text-neutral-500">Matched with {activeOrder.merchant.name}</p>
                      )}
                      {/* For sell orders in pending status, show waiting for merchant to accept */}
                      {activeOrder.step === 1 && activeOrder.type === "sell" && activeOrder.dbStatus === 'pending' && (
                        <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                            </div>
                            <div>
                              <p className="text-[14px] font-medium text-amber-400">Waiting for Merchant</p>
                              <p className="text-[12px] text-neutral-400">Merchant will sign with their wallet to accept</p>
                            </div>
                          </div>
                          <p className="text-[12px] text-neutral-500">
                            Once accepted, you'll lock your USDT to escrow. The merchant's verified wallet will receive funds when you confirm payment.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className={`p-4 rounded-2xl ${activeOrder.step >= 2 ? "bg-neutral-900" : "bg-neutral-950"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${
                      activeOrder.step > 2 ? "bg-emerald-400 text-black" :
                      activeOrder.step === 2 ? "bg-amber-400 text-black" : "bg-neutral-800 text-neutral-500"
                    }`}>
                      {activeOrder.step > 2 ? <Check className="w-4 h-4" /> : "2"}
                    </div>
                    <div className="flex-1">
                      <p className={`text-[15px] font-medium ${activeOrder.step >= 2 ? "text-white" : "text-neutral-600"}`}>
                        {activeOrder.type === "buy"
                          ? activeOrder.merchant.paymentMethod === "cash"
                            ? "Meet & pay cash"
                            : "Send payment"
                          : "Waiting for merchant"}
                      </p>

                      {/* Funds Locked indicator - show when escrow is locked */}
                      {activeOrder.step === 2 && activeOrder.dbStatus === 'escrowed' && (
                        <div className="mt-2 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <Lock className="w-3 h-3 text-emerald-400" />
                          </div>
                          <span className="text-[13px] font-medium text-emerald-400">
                            {activeOrder.type === "buy" ? "Funds locked in escrow" : "Your USDT locked in escrow"}
                          </span>
                        </div>
                      )}

                      {/* Show escrow funding in progress for buy orders when escrow not yet funded */}
                      {activeOrder.step === 2 && activeOrder.type === "buy" && activeOrder.dbStatus !== 'escrowed' && (
                        <div className="mt-3 space-y-3">
                          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                              </div>
                              <div>
                                <p className="text-[15px] font-medium text-amber-400">Escrow Funding in Progress</p>
                                <p className="text-[12px] text-neutral-400">Merchant is locking USDT in escrow</p>
                              </div>
                            </div>
                            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-amber-400"
                                animate={{ x: ["-100%", "100%"] }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                style={{ width: "40%" }}
                              />
                            </div>
                            <p className="mt-3 text-[12px] text-neutral-500">
                              Once the merchant funds the escrow, you'll be able to send your payment.
                            </p>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="w-full py-3 rounded-xl text-[15px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Merchant
                          </button>
                        </div>
                      )}

                      {/* Show payment UI only when escrow is funded */}
                      {activeOrder.step === 2 && activeOrder.type === "buy" && activeOrder.dbStatus === 'escrowed' && (
                        <div className="mt-3 space-y-3">
                          {activeOrder.merchant.paymentMethod === "cash" ? (
                            <>
                              {/* Map Preview */}
                              <div className="relative rounded-xl overflow-hidden">
                                <div
                                  className="h-40 bg-neutral-800 relative"
                                  style={{
                                    backgroundImage: `url('https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s+a855f7(${activeOrder.merchant.lng},${activeOrder.merchant.lat})/${activeOrder.merchant.lng},${activeOrder.merchant.lat},14,0/400x200@2x?access_token=pk.placeholder')`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center'
                                  }}
                                >
                                  {/* Fallback map UI */}
                                  <div className="absolute inset-0 bg-gradient-to-b from-neutral-800/50 to-neutral-900/80" />
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="flex flex-col items-center">
                                      <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center shadow-lg shadow-violet-500/30 mb-1">
                                        <MapPin className="w-5 h-5 text-white" />
                                      </div>
                                      <div className="w-1 h-3 bg-orange-500 rounded-b-full" />
                                    </div>
                                  </div>
                                  {/* Grid pattern for map feel */}
                                  <div className="absolute inset-0 opacity-10">
                                    <div className="w-full h-full" style={{
                                      backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                                      backgroundSize: '40px 40px'
                                    }} />
                                  </div>
                                </div>
                                <button
                                  onClick={() => window.open(`https://maps.google.com/?q=${activeOrder.merchant.lat},${activeOrder.merchant.lng}`, '_blank')}
                                  className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-white" />
                                  <span className="text-[12px] font-medium text-white">Open Maps</span>
                                </button>
                              </div>

                              {/* Meeting Details */}
                              <div className="bg-neutral-800 rounded-xl p-3 space-y-3">
                                <div>
                                  <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Meeting Location</p>
                                  <p className="text-[15px] font-medium text-white">{activeOrder.merchant.location}</p>
                                  <p className="text-[13px] text-neutral-400">{activeOrder.merchant.address}</p>
                                </div>
                                <div className="pt-2 border-t border-neutral-700">
                                  <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Meeting Spot</p>
                                  <div className="flex items-start gap-2">
                                    <Navigation className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-[13px] text-white">{activeOrder.merchant.meetingSpot}</p>
                                  </div>
                                </div>
                                <div className="pt-2 border-t border-neutral-700">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[13px] text-neutral-500">Cash Amount</span>
                                    <span className="text-[17px] font-semibold text-emerald-400">
                                      د.إ {parseFloat(activeOrder.fiatAmount).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className="flex-1 py-3 rounded-xl text-[15px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                                >
                                  <MessageCircle className="w-4 h-4" />
                                  Chat
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.98 }}
                                  onClick={markPaymentSent}
                                  className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-orange-500 text-white"
                                >
                                  I'm at the location
                                </motion.button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="bg-neutral-800 rounded-xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-neutral-500">Bank</span>
                                  <span className="text-[13px] text-white">{activeOrder.merchant.bank}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-neutral-500">IBAN</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] text-white font-mono">{activeOrder.merchant.iban}</span>
                                    <button onClick={() => handleCopy(activeOrder.merchant.iban || '')}>
                                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-neutral-500" />}
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-neutral-500">Name</span>
                                  <span className="text-[13px] text-white">{activeOrder.merchant.accountName}</span>
                                </div>
                                <div className="pt-2 border-t border-neutral-700">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[13px] text-neutral-500">Amount</span>
                                    <span className="text-[17px] font-semibold text-white">
                                      د.إ {parseFloat(activeOrder.fiatAmount).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className="flex-1 py-3 rounded-xl text-[15px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                                >
                                  <MessageCircle className="w-4 h-4" />
                                  Chat
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.98 }}
                                  onClick={markPaymentSent}
                                  disabled={isLoading}
                                  className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-orange-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isLoading ? 'Processing...' : "I've sent the payment"}
                                </motion.button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Sell order step 2 - merchant accepted with wallet signature, now user locks escrow */}
                      {/* Also check escrowTxHash as backup - if it exists, escrow is already locked */}
                      {activeOrder.step === 2 && activeOrder.type === "sell" && activeOrder.dbStatus === 'accepted' && !activeOrder.escrowTxHash && (
                        <div className="mt-3 space-y-3">
                          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                <Lock className="w-5 h-5 text-emerald-400" />
                              </div>
                              <div>
                                <p className="text-[15px] font-medium text-emerald-400">Merchant Accepted - Lock Escrow</p>
                                <p className="text-[12px] text-neutral-400">Merchant verified their wallet. Lock funds to proceed.</p>
                              </div>
                            </div>
                            <p className="text-[12px] text-neutral-500 mb-3">
                              The merchant has signed with their wallet ({activeOrder.acceptorWalletAddress?.slice(0, 4)}...{activeOrder.acceptorWalletAddress?.slice(-4)}). Lock your {activeOrder.cryptoAmount} USDT to the escrow. Funds will be released to this wallet when you confirm payment received.
                            </p>
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              onClick={async () => {
                                if (!solanaWallet.connected) {
                                  setShowWalletModal(true);
                                  return;
                                }
                                if (!solanaWallet.programReady) {
                                  alert('Wallet not ready. Please reconnect your wallet.');
                                  return;
                                }
                                setIsLoading(true);
                                try {
                                  // Use acceptorWalletAddress (captured when merchant signed to accept)
                                  // This is the wallet the merchant proved ownership of via signature
                                  const merchantWallet = activeOrder.acceptorWalletAddress || activeOrder.merchant.walletAddress;
                                  if (!merchantWallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet)) {
                                    alert('Merchant wallet not available. Please wait for merchant to accept the order with their wallet.');
                                    setIsLoading(false);
                                    return;
                                  }
                                  const escrowResult = await solanaWallet.depositToEscrow({
                                    amount: parseFloat(activeOrder.cryptoAmount),
                                    merchantWallet,
                                  });
                                  if (escrowResult.success) {
                                    // Record escrow deposit
                                    await fetch(`/api/orders/${activeOrder.id}/escrow`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        tx_hash: escrowResult.txHash,
                                        actor_type: 'user',
                                        actor_id: userId,
                                        escrow_address: solanaWallet.walletAddress,
                                        escrow_trade_id: escrowResult.tradeId,
                                        escrow_trade_pda: escrowResult.tradePda,
                                        escrow_pda: escrowResult.escrowPda,
                                        escrow_creator_wallet: solanaWallet.walletAddress,
                                      }),
                                    });
                                    // Update local state
                                    setOrders(prev => prev.map(o =>
                                      o.id === activeOrder.id ? { ...o, dbStatus: 'escrowed', escrowTxHash: escrowResult.txHash } : o
                                    ));
                                    playSound('trade_complete');
                                  }
                                } catch (err: any) {
                                  console.error('Escrow failed:', err);
                                  alert(err?.message || 'Failed to lock escrow. Please try again.');
                                  playSound('error');
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              disabled={isLoading || (solanaWallet.connected && !solanaWallet.programReady)}
                              className="w-full py-3 rounded-xl text-[15px] font-semibold bg-emerald-500 text-white flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                  Locking...
                                </>
                              ) : !solanaWallet.connected ? (
                                <>
                                  <Wallet className="w-5 h-5" />
                                  Connect Wallet to Lock
                                </>
                              ) : !solanaWallet.programReady ? (
                                'Wallet Not Ready'
                              ) : (
                                <>
                                  <Lock className="w-5 h-5" />
                                  Lock {activeOrder.cryptoAmount} USDT to Escrow
                                </>
                              )}
                            </motion.button>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="w-full py-3 rounded-xl text-[15px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Merchant
                          </button>
                        </div>
                      )}

                      {/* Sell order step 2 - escrow IS locked, waiting for payment */}
                      {/* Show if dbStatus is escrowed OR if escrowTxHash exists (backup check) */}
                      {activeOrder.step === 2 && activeOrder.type === "sell" && (activeOrder.dbStatus === 'escrowed' || activeOrder.escrowTxHash) && (
                        <div className="mt-2">
                          <p className="text-[13px] text-neutral-500">Your USDT is locked in escrow. Waiting for merchant to send AED payment...</p>

                          {/* Show expected payment amount */}
                          <div className="mt-3 bg-neutral-800 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[12px] text-neutral-500">Expected payment</span>
                              <span className="text-[15px] font-semibold text-emerald-400">
                                د.إ {parseFloat(activeOrder.fiatAmount).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-600">
                              Merchant will send this amount to your bank account
                            </p>
                          </div>

                          <div className="mt-3 h-1 bg-neutral-800 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-violet-400"
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                              style={{ width: "30%" }}
                            />
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Merchant
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className={`p-4 rounded-2xl ${activeOrder.step >= 3 ? "bg-neutral-900" : "bg-neutral-950"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${
                      activeOrder.step > 3 ? "bg-emerald-400 text-black" :
                      activeOrder.step === 3 ? "bg-amber-400 text-black" : "bg-neutral-800 text-neutral-500"
                    }`}>
                      {activeOrder.step > 3 ? <Check className="w-4 h-4" /> : "3"}
                    </div>
                    <div className="flex-1">
                      <p className={`text-[15px] font-medium ${activeOrder.step >= 3 ? "text-white" : "text-neutral-600"}`}>
                        {activeOrder.type === "buy" ? "Confirming payment" : "Confirm received"}
                      </p>

                      {activeOrder.step === 3 && activeOrder.type === "buy" && (
                        <div className="mt-2">
                          <p className="text-[13px] text-neutral-500">Seller is verifying your payment...</p>
                          <div className="mt-2 h-1 bg-neutral-800 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-amber-400"
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                              style={{ width: "30%" }}
                            />
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Seller
                          </button>
                        </div>
                      )}

                      {activeOrder.step === 3 && activeOrder.type === "sell" && (
                        <div className="mt-3">
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-3">
                            <p className="text-[13px] text-amber-400">
                              Merchant has sent د.إ {parseFloat(activeOrder.fiatAmount).toLocaleString()} to your bank.
                            </p>
                            <p className="text-[12px] text-neutral-500 mt-1">
                              Check your bank account before confirming.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleOpenChat}
                              className="flex-1 py-3 rounded-xl text-[15px] font-medium bg-neutral-800 text-white flex items-center justify-center gap-2"
                            >
                              <MessageCircle className="w-4 h-4" />
                              Chat
                            </button>
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              onClick={confirmFiatReceived}
                              disabled={isLoading}
                              className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-emerald-500 text-white flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Releasing...
                                </>
                              ) : (
                                <>
                                  <Check className="w-4 h-4" />
                                  Confirm & Release
                                </>
                              )}
                            </motion.button>
                          </div>
                          <p className="text-[11px] text-neutral-600 mt-2 text-center">
                            This will sign a wallet transaction to release escrow to merchant
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className={`p-4 rounded-2xl ${activeOrder.step >= 4 ? "bg-neutral-900" : "bg-neutral-950"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold ${
                      activeOrder.step >= 4 ? "bg-emerald-400 text-black" : "bg-neutral-800 text-neutral-500"
                    }`}>
                      {activeOrder.step >= 4 ? <Check className="w-4 h-4" /> : "4"}
                    </div>
                    <div>
                      <p className={`text-[15px] font-medium ${activeOrder.step >= 4 ? "text-white" : "text-neutral-600"}`}>
                        Complete
                      </p>
                      {activeOrder.step >= 4 && (
                        <p className="text-[13px] text-emerald-400">Trade completed successfully</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Rating */}
                {activeOrder.step >= 4 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-neutral-900 rounded-2xl p-4 text-center"
                  >
                    <p className="text-[15px] text-neutral-400 mb-3">Rate your experience</p>
                    <div className="flex justify-center gap-2">
                      {[1, 2, 3, 4, 5].map(star => (
                        <button key={star} onClick={() => setRating(star)}>
                          <Star className={`w-8 h-8 ${star <= rating ? "fill-amber-400 text-amber-400" : "text-neutral-700"}`} />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Merchant */}
              <div className="mt-4 bg-neutral-900 rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white font-semibold">
                      {activeOrder.merchant.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[15px] font-medium text-white">{activeOrder.merchant.name}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          activeOrder.merchant.paymentMethod === "cash"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-orange-500/10 text-orange-400"
                        }`}>
                          {activeOrder.merchant.paymentMethod === "cash" ? "Cash" : "Bank"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span className="text-[13px] text-neutral-400">{activeOrder.merchant.rating} · {activeOrder.merchant.trades} trades</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleOpenChat}
                    className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center"
                  >
                    <MessageCircle className="w-5 h-5 text-neutral-400" />
                  </button>
                </div>
              </div>

              {/* Dispute Button - Show for active orders (step 2-3) */}
              {activeOrder.step >= 2 && activeOrder.step < 4 && activeOrder.status !== "disputed" && (
                <button
                  onClick={() => setShowDisputeModal(true)}
                  className="w-full mt-3 py-3 rounded-2xl text-[14px] font-medium bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Report Issue
                </button>
              )}

              {/* Already Disputed */}
              {activeOrder.status === "disputed" && (
                <div className="mt-3 py-3 px-4 rounded-2xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-[14px] font-medium">Dispute in Progress</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 mt-1">Our team is reviewing this case.</p>
                </div>
              )}

              {activeOrder.step >= 4 && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setScreen("home")}
                  className="w-full mt-4 py-4 rounded-2xl text-[17px] font-semibold bg-neutral-900 text-white"
                >
                  Done
                </motion.button>
              )}
            </div>

            {/* Dispute Modal */}
            <AnimatePresence>
              {showDisputeModal && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/80 z-50"
                    onClick={() => setShowDisputeModal(false)}
                  />
                  <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 30 }}
                    className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} bg-neutral-900 rounded-t-3xl p-6`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <h3 className="text-[17px] font-semibold text-white">Report Issue</h3>
                      </div>
                      <button onClick={() => setShowDisputeModal(false)}>
                        <X className="w-5 h-5 text-neutral-500" />
                      </button>
                    </div>

                    <p className="text-[13px] text-neutral-500 mb-4">
                      If you&apos;re having a problem with this trade, let us know and our support team will help resolve it.
                    </p>

                    <div className="mb-4">
                      <label className="text-[12px] text-neutral-500 uppercase tracking-wide mb-2 block">Reason</label>
                      <select
                        value={disputeReason}
                        onChange={(e) => setDisputeReason(e.target.value)}
                        className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-[15px] text-white outline-none appearance-none"
                      >
                        <option value="">Select a reason...</option>
                        <option value="payment_not_received">Payment not received</option>
                        <option value="crypto_not_received">Crypto not received</option>
                        <option value="wrong_amount">Wrong amount sent</option>
                        <option value="fraud">Suspected fraud</option>
                        <option value="other">Other issue</option>
                      </select>
                    </div>

                    <div className="mb-6">
                      <label className="text-[12px] text-neutral-500 uppercase tracking-wide mb-2 block">Description</label>
                      <textarea
                        value={disputeDescription}
                        onChange={(e) => setDisputeDescription(e.target.value)}
                        placeholder="Describe the issue in detail..."
                        rows={3}
                        className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-[15px] text-white outline-none placeholder:text-neutral-600 resize-none"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowDisputeModal(false)}
                        className="flex-1 py-3 rounded-xl text-[15px] font-medium bg-neutral-800 text-white"
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={submitDispute}
                        disabled={!disputeReason || isSubmittingDispute}
                        className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-red-500 text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmittingDispute ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <AlertTriangle className="w-4 h-4" />
                        )}
                        {isSubmittingDispute ? "Submitting..." : "Submit Dispute"}
                      </motion.button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            {/* Chat */}
            <AnimatePresence>
              {showChat && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/80 z-40"
                    onClick={() => setShowChat(false)}
                  />
                  <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 30 }}
                    className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} bg-neutral-900 rounded-t-3xl h-[70vh] flex flex-col`}
                  >
                    <div className="flex items-center justify-between p-4 border-b border-neutral-800">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-400" />
                        <div>
                          <p className="text-[15px] font-medium text-white">{activeOrder.merchant.name}</p>
                          <p className="text-[11px] text-emerald-400">Online</p>
                        </div>
                      </div>
                      <button onClick={() => setShowChat(false)} className="p-2">
                        <X className="w-5 h-5 text-neutral-500" />
                      </button>
                    </div>
                    <div
                      ref={chatMessagesRef}
                      className="flex-1 overflow-y-auto p-4 space-y-3"
                    >
                      {activeChat && activeChat.messages.length > 0 ? (
                        activeChat.messages.map((msg) => {
                          // Parse dispute/resolution messages from JSON content
                          if (msg.messageType === 'dispute') {
                            try {
                              const data = JSON.parse(msg.text);
                              return (
                                <div key={msg.id} className="flex justify-center">
                                  <div className="w-full max-w-[90%] bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <AlertTriangle className="w-4 h-4 text-red-400" />
                                      <span className="text-[13px] font-semibold text-red-400">Dispute Opened</span>
                                    </div>
                                    <p className="text-[14px] text-white mb-1">
                                      <span className="text-neutral-400">Reason:</span> {data.reason?.replace(/_/g, ' ')}
                                    </p>
                                    {data.description && (
                                      <p className="text-[13px] text-neutral-400">{data.description}</p>
                                    )}
                                    <p className="text-[11px] text-neutral-500 mt-2">
                                      Our support team will review this case
                                    </p>
                                  </div>
                                </div>
                              );
                            } catch {
                              // Fall back to regular message if parsing fails
                            }
                          }

                          if (msg.messageType === 'resolution') {
                            try {
                              const data = JSON.parse(msg.text);
                              return (
                                <div key={msg.id} className="flex justify-center">
                                  <div className="w-full max-w-[90%] bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Shield className="w-4 h-4 text-orange-400" />
                                      <span className="text-[13px] font-semibold text-orange-400">
                                        {data.type === 'resolution_proposed' ? 'Resolution Proposed' : 'Resolution Finalized'}
                                      </span>
                                    </div>
                                    <p className="text-[14px] text-white mb-1">
                                      <span className="text-neutral-400">Decision:</span> {data.resolution?.replace(/_/g, ' ')}
                                    </p>
                                    {data.notes && (
                                      <p className="text-[13px] text-neutral-400 mb-2">{data.notes}</p>
                                    )}
                                    {data.type === 'resolution_proposed' && !disputeInfo?.user_confirmed && (
                                      <div className="flex gap-2 mt-3">
                                        <button
                                          onClick={() => respondToResolution('reject')}
                                          disabled={isRespondingToResolution}
                                          className="flex-1 py-2 rounded-xl text-[13px] font-medium bg-neutral-800 text-white disabled:opacity-50"
                                        >
                                          Reject
                                        </button>
                                        <button
                                          onClick={() => respondToResolution('accept')}
                                          disabled={isRespondingToResolution}
                                          className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-orange-500 text-white disabled:opacity-50"
                                        >
                                          Accept
                                        </button>
                                      </div>
                                    )}
                                    {disputeInfo?.user_confirmed && !disputeInfo?.merchant_confirmed && (
                                      <p className="text-[11px] text-emerald-400 mt-2">
                                        You accepted. Waiting for merchant confirmation...
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            } catch {
                              // Fall back to regular message if parsing fails
                            }
                          }

                          // Resolution finalized message
                          if (msg.messageType === 'resolution_finalized') {
                            try {
                              const data = JSON.parse(msg.text);
                              return (
                                <div key={msg.id} className="flex justify-center">
                                  <div className="w-full max-w-[90%] bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Check className="w-4 h-4 text-emerald-400" />
                                      <span className="text-[13px] font-semibold text-emerald-400">Resolution Finalized</span>
                                    </div>
                                    <p className="text-[14px] text-white">
                                      Decision: {data.resolution?.replace(/_/g, ' ')}
                                    </p>
                                    <p className="text-[11px] text-neutral-500 mt-2">
                                      Both parties confirmed. Case closed.
                                    </p>
                                  </div>
                                </div>
                              );
                            } catch {
                              // Fall back to regular message
                            }
                          }

                          // Resolution accepted/rejected system messages
                          if (msg.messageType === 'resolution_accepted' || msg.messageType === 'resolution_rejected') {
                            try {
                              const data = JSON.parse(msg.text);
                              const isAccepted = data.type === 'resolution_accepted';
                              return (
                                <div key={msg.id} className="flex justify-center">
                                  <div className={`px-4 py-2 rounded-2xl text-[13px] ${
                                    isAccepted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                  }`}>
                                    {data.party === 'user' ? 'You' : 'Merchant'} {isAccepted ? 'accepted' : 'rejected'} the resolution
                                  </div>
                                </div>
                              );
                            } catch {
                              // Fall back to regular message
                            }
                          }

                          // Regular messages
                          return (
                            <div
                              key={msg.id}
                              className={`flex ${msg.from === "me" ? "justify-end" : msg.from === "system" ? "justify-center" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[80%] px-4 py-2 rounded-2xl text-[15px] ${
                                  msg.from === "me"
                                    ? "bg-white text-black"
                                    : msg.from === "system"
                                    ? "bg-neutral-700/50 text-neutral-300 text-[13px]"
                                    : "bg-neutral-800 text-white"
                                }`}
                              >
                                {msg.text}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex-1 flex items-center justify-center h-full">
                          <p className="text-neutral-600 text-[15px]">No messages yet</p>
                        </div>
                      )}

                      {/* Show pending resolution if dispute exists and has a proposal */}
                      {disputeInfo?.status === 'pending_confirmation' && disputeInfo.proposed_resolution && !activeChat?.messages.some(m => m.messageType === 'resolution') && (
                        <div className="flex justify-center">
                          <div className="w-full max-w-[90%] bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Shield className="w-4 h-4 text-orange-400" />
                              <span className="text-[13px] font-semibold text-orange-400">Resolution Proposed</span>
                            </div>
                            <p className="text-[14px] text-white mb-1">
                              <span className="text-neutral-400">Decision:</span> {disputeInfo.proposed_resolution.replace(/_/g, ' ')}
                            </p>
                            {disputeInfo.resolution_notes && (
                              <p className="text-[13px] text-neutral-400 mb-2">{disputeInfo.resolution_notes}</p>
                            )}
                            {!disputeInfo.user_confirmed && (
                              <div className="flex gap-2 mt-3">
                                <button
                                  onClick={() => respondToResolution('reject')}
                                  disabled={isRespondingToResolution}
                                  className="flex-1 py-2 rounded-xl text-[13px] font-medium bg-neutral-800 text-white disabled:opacity-50"
                                >
                                  Reject
                                </button>
                                <button
                                  onClick={() => respondToResolution('accept')}
                                  disabled={isRespondingToResolution}
                                  className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-orange-500 text-white disabled:opacity-50"
                                >
                                  Accept
                                </button>
                              </div>
                            )}
                            {disputeInfo.user_confirmed && !disputeInfo.merchant_confirmed && (
                              <p className="text-[11px] text-emerald-400 mt-2">
                                You accepted. Waiting for merchant confirmation...
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-4 border-t border-neutral-800 pb-8">
                      <div className="flex gap-2">
                        <input
                          ref={chatInputRef}
                          value={chatMessage}
                          onChange={(e) => setChatMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          placeholder="Message..."
                          className="flex-1 bg-neutral-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-neutral-600 outline-none"
                        />
                        <button
                          onClick={handleSendMessage}
                          className="w-12 h-12 rounded-xl bg-white flex items-center justify-center"
                        >
                          <ChevronRight className="w-5 h-5 text-black" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ORDERS */}
        {screen === "orders" && (
          <motion.div
            key="orders"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            <div className="px-5 py-4">
              <h1 className="text-[28px] font-semibold text-white">Activity</h1>
            </div>

            <div className="flex-1 px-5 pb-24">
              {orders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20">
                  <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                    <Clock className="w-8 h-8 text-neutral-600" />
                  </div>
                  <p className="text-[17px] font-medium text-white mb-1">No activity yet</p>
                  <p className="text-[15px] text-neutral-500">Your trades will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.map(order => (
                    <motion.button
                      key={order.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setActiveOrderId(order.id);
                        setScreen("order");
                      }}
                      className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center gap-3"
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        order.status === "complete" ? "bg-emerald-500/10" : "bg-amber-500/10"
                      }`}>
                        {order.status === "complete" ? (
                          <Check className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <motion.div
                            className="w-2 h-2 rounded-full bg-amber-400"
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          />
                        )}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-[15px] font-medium text-white">
                          {order.type === "buy" ? "Bought" : "Sold"} ${order.cryptoAmount} USDC
                        </p>
                        <p className="text-[13px] text-neutral-500">
                          د.إ {parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-[13px] font-medium ${
                          order.status === "complete" ? "text-emerald-400" : "text-amber-400"
                        }`}>
                          {order.status === "complete" ? "Done" : `Step ${order.step}/4`}
                        </p>
                        {order.dbStatus === 'pending' && order.expiresAt ? (
                          <p className={`text-[11px] font-mono ${
                            Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000)) < 60
                              ? "text-red-400"
                              : "text-amber-400"
                          }`}>
                            {(() => {
                              const secs = Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000));
                              return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
                            })()}
                          </p>
                        ) : (
                          <p className="text-[11px] text-neutral-600">{order.createdAt.toLocaleDateString()}</p>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Nav */}
            <div className="fixed bottom-0 left-0 right-0 z-50">
              <div className={`${maxW} mx-auto`}>
                <div className="glass-card border-t border-white/5 px-6 pb-8 pt-3">
                  <div className="flex items-center justify-around">
                    {[
                      { key: "home", icon: Wallet, label: "Home" },
                      { key: "orders", icon: Clock, label: "Activity" },
                      { key: "profile", icon: User, label: "Profile" },
                    ].map(({ key, icon: Icon, label }) => (
                      <motion.button
                        key={key}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setScreen(key as Screen)}
                        className={`flex flex-col items-center gap-1 relative px-4 py-1 rounded-xl transition-all ${
                          screen === key ? "text-orange-400" : "text-neutral-600"
                        }`}
                      >
                        {screen === key && (
                          <motion.div
                            layoutId="nav-indicator-orders"
                            className="absolute inset-0 bg-orange-500/10 rounded-xl"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                          />
                        )}
                        <Icon className="w-5 h-5 relative z-10" strokeWidth={screen === key ? 2.5 : 1.5} />
                        <span className="text-[10px] font-medium relative z-10">{label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* PROFILE */}
        {screen === "profile" && (
          <motion.div
            key="profile"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black overflow-hidden`}
          >
            <div className="h-12 shrink-0" />

            <div className="px-5 py-4 shrink-0">
              <h1 className="text-[28px] font-semibold text-white">Profile</h1>
            </div>

            <div className="flex-1 px-5 pb-24 overflow-y-auto">
              {/* User */}
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white text-xl font-semibold">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-[17px] font-semibold text-white">{userName}</p>
                  <p className="text-[13px] text-neutral-500 font-mono">
                    {solanaWallet.connected && solanaWallet.walletAddress
                      ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                      : 'Wallet not connected'}
                  </p>
                </div>
              </div>

              {/* Wallet */}
              <div className="mb-6">
                <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Solana Wallet</p>
                <div className="bg-neutral-900 rounded-2xl p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      solanaWallet.connected
                        ? 'bg-gradient-to-br from-purple-500 to-blue-500'
                        : 'bg-neutral-700'
                    }`}>
                      <Wallet className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] text-neutral-500">
                        {solanaWallet.connected ? 'Solana Devnet' : 'Not Connected'}
                      </p>
                      <p className="text-[15px] font-mono text-white">
                        {solanaWallet.connected && solanaWallet.walletAddress
                          ? `${solanaWallet.walletAddress.slice(0, 8)}...${solanaWallet.walletAddress.slice(-6)}`
                          : 'Connect your wallet'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (solanaWallet.connected && solanaWallet.walletAddress) {
                          navigator.clipboard.writeText(solanaWallet.walletAddress);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                      className="p-2"
                    >
                      {copied ? (
                        <Check className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Copy className="w-5 h-5 text-neutral-500" />
                      )}
                    </button>
                  </div>

                  {/* Solana Balances */}
                  {solanaWallet.connected && (
                    <div className="border-t border-neutral-800 pt-4 mt-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-neutral-800 rounded-xl p-3">
                          <p className="text-[11px] text-neutral-500 mb-1">SOL Balance</p>
                          <p className="text-[17px] font-semibold text-white">
                            {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '...'} SOL
                          </p>
                        </div>
                        <div className="bg-neutral-800 rounded-xl p-3">
                          <p className="text-[11px] text-neutral-500 mb-1">USDT Balance</p>
                          <p className="text-[17px] font-semibold text-white">
                            {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => solanaWallet.refreshBalances()}
                          className="flex-1 py-2 text-[13px] text-neutral-400 hover:text-white transition-colors"
                        >
                          Refresh
                        </button>
                        <button
                          onClick={() => solanaWallet.disconnect()}
                          className="flex-1 py-2 text-[13px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Connect Solana Wallet Button */}
                  {!solanaWallet.connected && (
                    <button
                      onClick={() => setShowWalletModal(true)}
                      className="w-full mt-4 py-3 rounded-xl text-[14px] font-medium bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <Wallet className="w-4 h-4" />
                      Connect Solana Wallet
                    </button>
                  )}
                </div>
              </div>

              {/* Banks */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] text-neutral-500 uppercase tracking-wide">Bank Accounts</p>
                  <button
                    onClick={() => setShowAddBank(true)}
                    className="w-8 h-8 rounded-full bg-neutral-900 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4 text-neutral-400" />
                  </button>
                </div>

                {bankAccounts.map(acc => (
                  <div key={acc.id} className="bg-neutral-900 rounded-2xl p-4 mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                        <span className="text-lg">🏦</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-medium text-white">{acc.bank}</p>
                          {acc.isDefault && (
                            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[11px] rounded-full">Default</span>
                          )}
                        </div>
                        <p className="text-[13px] text-neutral-500 font-mono">{acc.iban}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Stats */}
              <div>
                <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Stats</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-neutral-900 rounded-2xl p-4">
                    <p className="text-[28px] font-semibold text-white">{completedOrders.length}</p>
                    <p className="text-[13px] text-neutral-500">Trades</p>
                  </div>
                  <div className="bg-neutral-900 rounded-2xl p-4">
                    <p className="text-[28px] font-semibold text-white">
                      {completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0).toFixed(0)}
                    </p>
                    <p className="text-[13px] text-neutral-500">Volume (USDC)</p>
                  </div>
                </div>
              </div>

              {/* Console & Analytics */}
              <div className="mt-6">
                <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Analytics</p>
                <a
                  href="/console"
                  className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center justify-between hover:bg-neutral-800 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                      <Clock className="w-5 h-5 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-[15px] font-medium text-white">Console</p>
                      <p className="text-[12px] text-neutral-500">View timeouts & analytics</p>
                    </div>
                  </div>
                  {timedOutOrders.length > 0 && (
                    <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-[11px] rounded-full font-medium">
                      {timedOutOrders.length} timeout{timedOutOrders.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </a>
              </div>

              {/* Resolved Disputes */}
              {resolvedDisputes.length > 0 && (
                <div className="mt-6">
                  <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Resolved Disputes</p>
                  <div className="space-y-2">
                    {resolvedDisputes.map(dispute => (
                      <div key={dispute.id} className="bg-neutral-900 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-white">#{dispute.orderNumber}</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded-full ${
                              dispute.resolvedInFavorOf === 'user'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : dispute.resolvedInFavorOf === 'merchant'
                                ? 'bg-orange-500/10 text-orange-400'
                                : 'bg-blue-500/10 text-blue-400'
                            }`}>
                              {dispute.resolvedInFavorOf === 'user' ? 'Won' :
                               dispute.resolvedInFavorOf === 'merchant' ? 'Lost' : 'Split'}
                            </span>
                          </div>
                          <p className="text-[12px] text-neutral-500">
                            {new Date(dispute.resolvedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-[12px] text-neutral-400">vs {dispute.otherPartyName}</p>
                          <p className="text-[14px] font-semibold text-white">
                            ${dispute.cryptoAmount.toLocaleString()}
                          </p>
                        </div>
                        <p className="text-[11px] text-neutral-500 mt-1 capitalize">
                          {dispute.reason.replace(/_/g, ' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Theme Toggle */}
              <div className="mt-6">
                <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Appearance</p>
                <button
                  onClick={toggleTheme}
                  className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    {theme === 'dark' ? (
                      <Moon className="w-5 h-5 text-orange-400" />
                    ) : (
                      <Sun className="w-5 h-5 text-amber-400" />
                    )}
                    <span className="text-[15px] text-white">
                      {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                    </span>
                  </div>
                  <div className={`w-12 h-7 rounded-full p-1 transition-colors ${
                    theme === 'light' ? 'bg-orange-500' : 'bg-neutral-700'
                  }`}>
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      theme === 'light' ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                </button>
              </div>

              {/* Logout */}
              <div className="mt-8">
                <button
                  onClick={() => {
                    console.log('[User] Signing out...');
                    // Clear all session data
                    localStorage.removeItem('blip_user');
                    localStorage.removeItem('blip_wallet');
                    // Reset all auth refs to prevent auto-login
                    isAuthenticatingRef.current = false;
                    lastAuthenticatedWalletRef.current = null;
                    authAttemptedForWalletRef.current = null;
                    // Close any modals
                    setShowUsernameModal(false);
                    setShowWalletModal(false);
                    // Clear state
                    setUserId(null);
                    setUserWallet(null);
                    setUserName('Guest');
                    setUserBalance(0);
                    setOrders([]);
                    setBankAccounts([]);
                    setResolvedDisputes([]);
                    setLoginError('');
                    setLoginForm({ username: '', password: '' });
                    // Disconnect wallet first, then change screen
                    if (solanaWallet.disconnect) {
                      solanaWallet.disconnect();
                    }
                    // Force page reload to fully reset state
                    window.location.href = '/';
                  }}
                  className="w-full py-4 rounded-2xl bg-red-500/10 text-red-400 text-[15px] font-medium"
                >
                  Sign Out
                </button>
              </div>
            </div>

            {/* Add Bank */}
            <AnimatePresence>
              {showAddBank && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/80 z-40"
                    onClick={() => setShowAddBank(false)}
                  />
                  <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 30 }}
                    className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} bg-neutral-900 rounded-t-3xl`}
                  >
                    <div className="flex items-center justify-between p-4 border-b border-neutral-800">
                      <h2 className="text-[17px] font-semibold text-white">Add Bank Account</h2>
                      <button onClick={() => setShowAddBank(false)}>
                        <X className="w-5 h-5 text-neutral-500" />
                      </button>
                    </div>
                    <div className="p-4 space-y-4">
                      <div>
                        <label className="text-[13px] text-neutral-500 mb-1 block">Bank Name</label>
                        <input
                          value={newBank.bank}
                          onChange={(e) => setNewBank(p => ({ ...p, bank: e.target.value }))}
                          placeholder="Emirates NBD"
                          className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-white placeholder:text-neutral-600 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[13px] text-neutral-500 mb-1 block">IBAN</label>
                        <input
                          value={newBank.iban}
                          onChange={(e) => setNewBank(p => ({ ...p, iban: e.target.value }))}
                          placeholder="AE12 0345 0000 0012 3456 789"
                          className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-white font-mono placeholder:text-neutral-600 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[13px] text-neutral-500 mb-1 block">Account Name</label>
                        <input
                          value={newBank.name}
                          onChange={(e) => setNewBank(p => ({ ...p, name: e.target.value }))}
                          placeholder="John Doe"
                          className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-white placeholder:text-neutral-600 outline-none"
                        />
                      </div>
                    </div>
                    <div className="p-4 pb-8">
                      <button
                        onClick={addBankAccount}
                        disabled={!newBank.bank || !newBank.iban || !newBank.name}
                        className={`w-full py-4 rounded-2xl text-[17px] font-semibold ${
                          newBank.bank && newBank.iban && newBank.name
                            ? "bg-orange-500 text-white"
                            : "bg-neutral-800 text-neutral-600"
                        }`}
                      >
                        Add Account
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            {/* Bottom Nav */}
            <div className="fixed bottom-0 left-0 right-0 z-50">
              <div className={`${maxW} mx-auto`}>
                <div className="glass-card border-t border-white/5 px-6 pb-8 pt-3">
                  <div className="flex items-center justify-around">
                    {[
                      { key: "home", icon: Wallet, label: "Home" },
                      { key: "orders", icon: Clock, label: "Activity" },
                      { key: "profile", icon: User, label: "Profile" },
                    ].map(({ key, icon: Icon, label }) => (
                      <motion.button
                        key={key}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setScreen(key as Screen)}
                        className={`flex flex-col items-center gap-1 relative px-4 py-1 rounded-xl transition-all ${
                          screen === key ? "text-orange-400" : "text-neutral-600"
                        }`}
                      >
                        {screen === key && (
                          <motion.div
                            layoutId="nav-indicator-profile"
                            className="absolute inset-0 bg-orange-500/10 rounded-xl"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                          />
                        )}
                        <Icon className="w-5 h-5 relative z-10" strokeWidth={screen === key ? 2.5 : 1.5} />
                        <span className="text-[10px] font-medium relative z-10">{label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* CHATS */}
        {screen === "chats" && (
          <motion.div
            key="chats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center">
              <button onClick={() => setScreen("home")} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Messages</h1>
            </div>

            <div className="flex-1 px-5 pb-8">
              {orders.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20">
                  <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                    <MessageCircle className="w-8 h-8 text-neutral-600" />
                  </div>
                  <p className="text-[17px] font-medium text-white mb-1">No messages</p>
                  <p className="text-[15px] text-neutral-500">Start a trade to chat with merchants</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 10).map(order => (
                    <motion.button
                      key={order.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setActiveOrderId(order.id);
                        setScreen("order");
                      }}
                      className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center gap-3"
                    >
                      <div className="relative">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white font-semibold">
                          {order.merchant.name.charAt(0)}
                        </div>
                        {(order.unreadCount || 0) > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white">{order.unreadCount}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className={`text-[15px] font-medium ${(order.unreadCount || 0) > 0 ? 'text-white' : 'text-neutral-300'}`}>
                            {order.merchant.name}
                          </p>
                          <p className="text-[11px] text-neutral-600">
                            {order.lastMessage
                              ? order.lastMessage.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : order.createdAt.toLocaleDateString()
                            }
                          </p>
                        </div>
                        <p className={`text-[13px] truncate ${(order.unreadCount || 0) > 0 ? 'text-neutral-300 font-medium' : 'text-neutral-500'}`}>
                          {order.lastMessage
                            ? (order.lastMessage.fromMerchant ? '' : 'You: ') + order.lastMessage.content
                            : order.status === "complete"
                              ? "Trade completed"
                              : `${order.type === "buy" ? "Buying" : "Selling"} ${order.cryptoAmount} USDC`
                          }
                        </p>
                      </div>
                      {order.status !== "complete" && !(order.unreadCount || 0) && (
                        <div className="w-2 h-2 rounded-full bg-neutral-700" />
                      )}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* CREATE OFFER */}
        {screen === "create-offer" && (
          <motion.div
            key="create-offer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center">
              <button onClick={() => setScreen("home")} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Create Offer</h1>
            </div>

            <div className="flex-1 px-5">
              <p className="text-[15px] text-neutral-500 mb-6">
                Post an offer for others to accept. Great for large amounts or custom rates.
              </p>

              {/* Offer Type */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-3">I want to</p>
                <div className="flex gap-2">
                  {(["buy", "sell"] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setTradeType(type)}
                      className={`flex-1 py-3 rounded-xl text-[15px] font-medium transition-all ${
                        tradeType === type
                          ? "bg-orange-500 text-white"
                          : "bg-neutral-900 text-neutral-400"
                      }`}
                    >
                      {type === "buy" ? "Buy USDC" : "Sell USDC"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-2">Amount</p>
                <div className="bg-neutral-900 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className="flex-1 text-[24px] font-semibold text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                    <span className="text-[15px] font-medium text-neutral-400">USDC</span>
                  </div>
                </div>
              </div>

              {/* Rate */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-2">Your rate (AED per USDC)</p>
                <div className="bg-neutral-900 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="3.67"
                      className="flex-1 text-[24px] font-semibold text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                    <span className="text-[15px] font-medium text-neutral-400">AED</span>
                  </div>
                </div>
                <p className="text-[13px] text-neutral-600 mt-2">Market rate: 3.67 AED</p>
              </div>

              {/* Min/Max */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-2">Order limits (optional)</p>
                <div className="flex gap-3">
                  <div className="flex-1 bg-neutral-900 rounded-xl p-3">
                    <p className="text-[11px] text-neutral-600 mb-1">Min</p>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="100"
                      className="w-full text-[17px] font-medium text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                  </div>
                  <div className="flex-1 bg-neutral-900 rounded-xl p-3">
                    <p className="text-[11px] text-neutral-600 mb-1">Max</p>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="10,000"
                      className="w-full text-[17px] font-medium text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 pb-10">
              <motion.button
                whileTap={{ scale: 0.98 }}
                className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-orange-500 text-white"
              >
                Post Offer
              </motion.button>
              <p className="text-[13px] text-neutral-600 text-center mt-3">
                Your offer will be visible to all traders
              </p>
            </div>
          </motion.div>
        )}

        {/* CASH CONFIRM */}
        {screen === "cash-confirm" && selectedOffer && (
          <motion.div
            key="cash-confirm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center">
              <button onClick={() => { setScreen("home"); setSelectedOffer(null); }} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Confirm Meeting</h1>
            </div>

            <div className="flex-1 px-5 overflow-auto">
              {/* Order Summary */}
              <div className="bg-neutral-900 rounded-2xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] text-neutral-500">You {tradeType === "buy" ? "pay" : "receive"}</span>
                  <span className="text-[22px] font-semibold text-white">د.إ {parseFloat(fiatAmount).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-neutral-500">You {tradeType === "buy" ? "receive" : "sell"}</span>
                  <span className="text-[17px] font-medium text-neutral-400">{amount} USDC</span>
                </div>
              </div>

              {/* Merchant Card */}
              <div className="bg-neutral-900 rounded-2xl p-4 mb-4">
                <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-3">Meeting with</p>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white text-lg font-semibold">
                    {selectedOffer.merchant.display_name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="text-[17px] font-medium text-white">{selectedOffer.merchant.display_name}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span className="text-[13px] text-neutral-400">{selectedOffer.merchant.rating}</span>
                      </div>
                      <span className="text-neutral-600">·</span>
                      <span className="text-[13px] text-neutral-400">{selectedOffer.merchant.total_trades} trades</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Location Preview */}
              <div className="bg-neutral-900 rounded-2xl overflow-hidden mb-4">
                <div className="relative h-36">
                  <div className="absolute inset-0 bg-gradient-to-b from-neutral-800/50 to-neutral-900/80" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 mb-1">
                        <MapPin className="w-6 h-6 text-white" />
                      </div>
                      <div className="w-1 h-4 bg-emerald-500 rounded-b-full" />
                    </div>
                  </div>
                  {/* Grid pattern */}
                  <div className="absolute inset-0 opacity-10">
                    <div className="w-full h-full" style={{
                      backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                      backgroundSize: '30px 30px'
                    }} />
                  </div>
                  {selectedOffer.location_lat && selectedOffer.location_lng && (
                    <button
                      onClick={() => window.open(`https://maps.google.com/?q=${selectedOffer.location_lat},${selectedOffer.location_lng}`, '_blank')}
                      className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-white" />
                      <span className="text-[12px] font-medium text-white">Open Maps</span>
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <p className="text-[15px] font-medium text-white">{selectedOffer.location_name}</p>
                    <p className="text-[13px] text-neutral-400">{selectedOffer.location_address}</p>
                  </div>
                  {selectedOffer.meeting_instructions && (
                    <div className="pt-3 border-t border-neutral-800">
                      <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Meeting spot</p>
                      <div className="flex items-start gap-2">
                        <Navigation className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[13px] text-white">{selectedOffer.meeting_instructions}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Safety Notice */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-medium text-amber-400 mb-1">Safety tips</p>
                    <ul className="text-[12px] text-neutral-400 space-y-1">
                      <li>• Meet in public places only</li>
                      <li>• Verify the amount before handing over cash</li>
                      <li>• Keep chat records of your conversation</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="px-5 pb-10 space-y-3">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={confirmCashOrder}
                disabled={isLoading}
                className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-orange-500 text-white flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm & Start Trade"}
              </motion.button>
              <button
                onClick={() => { setScreen("home"); setSelectedOffer(null); }}
                className="w-full py-3 text-[15px] font-medium text-neutral-500"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {/* MATCHING - Order Placed State */}
        {screen === "matching" && pendingTradeData && (
          <motion.div
            key="matching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black`}
          >
            <div className="h-12" />

            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between">
              <button
                onClick={() => setScreen("home")}
                className="p-2 -ml-2"
              >
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="text-[17px] font-semibold text-white">Order Placed</h1>
              <div className="w-10" />
            </div>

            <div className="flex-1 px-5 overflow-auto smooth-scroll">
              {/* Amount Display */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-8"
              >
                <p className="text-[13px] text-neutral-500 mb-2">You&apos;re buying</p>
                <div className="flex items-baseline justify-center gap-2">
                  <p className="text-[36px] font-semibold text-white tracking-tight">{pendingTradeData.amount}</p>
                  <p className="text-[17px] text-neutral-400">USDC</p>
                </div>
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="mt-4 inline-flex items-center gap-2 glass-card rounded-full px-4 py-2"
                >
                  <span className="text-[13px] text-neutral-500">for</span>
                  <span className="text-[15px] font-medium text-white">د.إ {parseFloat(pendingTradeData.fiatAmount).toLocaleString()}</span>
                </motion.div>
              </motion.div>

              {/* Status */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="glass-card rounded-2xl p-4 mb-4"
              >
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-neutral-800">
                  <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center relative">
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-orange-500/30"
                      animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    <motion.div
                      className="w-3 h-3 rounded-full bg-orange-500"
                      animate={{ scale: [1, 0.8, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <div>
                    <p className="text-[15px] font-medium text-white">Finding a merchant</p>
                    <p className="text-[13px] text-neutral-500">We&apos;ll notify you when ready</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-black" />
                    </div>
                    <p className="text-[14px] text-white">Order submitted</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full border-2 border-neutral-600 flex items-center justify-center flex-shrink-0">
                      <motion.div
                        className="w-1.5 h-1.5 rounded-full bg-neutral-400"
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      />
                    </div>
                    <p className="text-[14px] text-neutral-400">Matching with merchant</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full border-2 border-neutral-800 flex-shrink-0" />
                    <p className="text-[14px] text-neutral-600">Ready to pay</p>
                  </div>
                </div>
              </motion.div>

              {/* Countdown Timer */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="glass-card rounded-2xl p-5 mb-4 text-center"
              >
                <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-2">Time remaining</p>
                <div className="flex items-center justify-center gap-2">
                  <Clock className={`w-5 h-5 ${matchingTimeLeft < 60 ? 'text-red-400' : matchingTimeLeft < 180 ? 'text-amber-400' : 'text-orange-400'}`} />
                  <p className={`text-[28px] font-semibold tracking-tight ${matchingTimeLeft < 60 ? 'text-red-400' : matchingTimeLeft < 180 ? 'text-amber-400' : 'text-white'}`}>
                    {formatTimeLeft(matchingTimeLeft)}
                  </p>
                </div>
                {matchingTimeLeft < 180 && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[12px] text-amber-400 mt-2"
                  >
                    {matchingTimeLeft < 60 ? 'Order will expire soon!' : 'Hurry! Time is running out'}
                  </motion.p>
                )}
                {/* Progress bar */}
                <div className="w-full h-1 bg-neutral-800 rounded-full mt-3 overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${matchingTimeLeft < 60 ? 'bg-red-500' : matchingTimeLeft < 180 ? 'bg-amber-500' : 'bg-orange-500'}`}
                    initial={{ width: '100%' }}
                    animate={{ width: `${(matchingTimeLeft / (15 * 60)) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </motion.div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-neutral-900 rounded-xl p-4">
                  <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Payment</p>
                  <p className="text-[15px] font-medium text-white capitalize">{pendingTradeData.paymentMethod}</p>
                </div>
                <div className="bg-neutral-900 rounded-xl p-4">
                  <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Rate</p>
                  <p className="text-[15px] font-medium text-white">{currentRate} AED</p>
                </div>
              </div>

              {/* Note */}
              <p className="text-[13px] text-neutral-600 text-center px-4">
                If no merchant accepts within {Math.ceil(matchingTimeLeft / 60)} minutes, your order will be moved to timeout.
              </p>
            </div>

            {/* Bottom Actions */}
            <div className="px-5 pb-10 pt-4 space-y-3">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setScreen("home")}
                className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-orange-500 text-white"
              >
                Done
              </motion.button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (activeOrderId) {
                      setOrders(prev => prev.map(o =>
                        o.id === activeOrderId ? { ...o, status: "payment" as OrderStatus, step: 2 as OrderStep } : o
                      ));
                      setPendingTradeData(null);
                      setScreen("order");
                    }
                  }}
                  className="flex-1 py-3 rounded-xl text-[13px] font-medium bg-neutral-900 text-neutral-400"
                >
                  Demo: Accept
                </button>
                <button
                  onClick={async () => {
                    if (activeOrderId && userId) {
                      try {
                        // Call API to cancel the order
                        const res = await fetch(`/api/orders/${activeOrderId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            status: 'cancelled',
                            actor_type: 'user',
                            actor_id: userId,
                            reason: 'User cancelled order',
                          }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          // Remove from local state
                          setOrders(prev => prev.filter(o => o.id !== activeOrderId));
                        }
                      } catch (err) {
                        console.error('Failed to cancel order:', err);
                      }
                    }
                    setPendingTradeData(null);
                    setScreen("home");
                  }}
                  className="flex-1 py-3 rounded-xl text-[13px] font-medium bg-neutral-900 text-neutral-500"
                >
                  Cancel Order
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Solana Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onConnected={handleSolanaWalletConnect}
      />

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
            <div className="bg-[#1a1a1a] rounded-2xl p-4 border border-emerald-500/30 shadow-xl shadow-emerald-500/10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white mb-1">Order Accepted!</p>
                  <p className="text-xs text-gray-400 mb-2">
                    <span className="text-emerald-400 font-medium">{acceptedOrderInfo.merchantName}</span> accepted your {acceptedOrderInfo.orderType === 'sell' ? 'sell' : 'buy'} order
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-300 font-medium">{acceptedOrderInfo.cryptoAmount} USDC</span>
                    <span className="text-gray-500">•</span>
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
