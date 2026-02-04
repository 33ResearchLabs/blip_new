"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  Check,
  X,
  Shield,
  Bell,
  Wallet,
  Activity,
  Lock,
  Unlock,
  Send,
  MessageCircle,
  ChevronLeft,
  Users,
  Zap,
  DollarSign,
  ArrowRight,
  Trophy,
  Crown,
  Sparkles,
  Plus,
  ArrowLeftRight,
  Globe,
  Percent,
  AlertTriangle,
  Loader2,
  LogOut,
  Clock,
  ExternalLink,
  RotateCcw,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import { useWebSocketChat } from "@/hooks/useWebSocketChat";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import { MessageHistory } from "@/components/merchant/MessageHistory";
import { OrderDetailsPanel } from "@/components/merchant/OrderDetailsPanel";
import { AnalyticsDashboard } from "@/components/merchant/AnalyticsDashboard";

// Dynamically import wallet components (client-side only)
const MerchantWalletModal = dynamic(() => import("@/components/MerchantWalletModal"), { ssr: false });
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
      network: 'devnet' as const,
    };
  }
};

// Types for API data
interface DbOrder {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  offer_id: string;
  type: "buy" | "sell";
  payment_method: "bank" | "cash";
  crypto_amount: number | string; // API returns string from PostgreSQL
  fiat_amount: number | string;   // API returns string from PostgreSQL
  rate: number | string;          // API returns string from PostgreSQL
  status: string;
  created_at: string;
  expires_at: string;
  // Escrow reference fields
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  // Buyer's wallet address captured at order creation (for buy orders)
  buyer_wallet_address?: string;
  // Acceptor's wallet address (merchant who accepted the order)
  acceptor_wallet_address?: string;
  // M2M trading: buyer merchant ID and info
  buyer_merchant_id?: string;
  buyer_merchant?: {
    id: string;
    display_name: string;
    wallet_address?: string;
  };
  // Payment details (includes user_bank_account for sell orders)
  payment_details?: {
    user_bank_account?: string;
    bank_name?: string;
    bank_iban?: string;
  };
  user?: {
    id: string;
    name: string;
    rating: number;
    total_trades: number;
    wallet_address?: string;
  };
  offer?: {
    payment_method: string;
    location_name?: string;
  };
}

// UI Order type
interface Order {
  id: string;
  user: string;
  emoji: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  total: number;
  timestamp: Date;
  status: "pending" | "active" | "escrow" | "completed" | "disputed" | "cancelled";
  expiresIn: number;
  isNew?: boolean;
  tradeVolume?: number;
  dbOrder?: DbOrder; // Keep reference to original DB order
  // Escrow fields for on-chain release
  escrowTradeId?: number;
  escrowTradePda?: string;
  escrowCreatorWallet?: string;
  escrowTxHash?: string;
  userWallet?: string;
  orderType?: "buy" | "sell";
  // User's bank account for sell orders (where merchant sends fiat)
  userBankAccount?: string;
  // M2M trading
  isM2M?: boolean;
  buyerMerchantId?: string;
  buyerMerchantWallet?: string;
  // Acceptor wallet (for merchant-initiated orders accepted by another merchant)
  acceptorWallet?: string;
}

// Leaderboard data
interface LeaderboardEntry {
  rank: number;
  user: string;
  emoji: string;
  volume: number;
  trades: number;
  isTop1Percent: boolean;
}

// Helper to map DB status to UI status
// hasEscrow: true when escrow_tx_hash exists (escrow already locked)
// orderType: 'buy' or 'sell' - determines flow
const mapDbStatusToUI = (dbStatus: string, hasEscrow?: boolean, orderType?: string): "pending" | "active" | "escrow" | "completed" | "disputed" | "cancelled" => {
  switch (dbStatus) {
    case "pending":
      return "pending"; // New Orders
    case "escrowed":
      // For BUY orders: merchant locked escrow -> goes to Ongoing (waiting for user fiat payment)
      // For SELL orders: user locked escrow but merchant hasn't approved yet -> stays in New Orders
      if (orderType === 'buy') {
        return "escrow"; // Ongoing - merchant locked escrow, waiting for user payment
      }
      return "pending"; // New Orders - sell order waiting for merchant to click Go
    case "accepted":
      // Merchant approved (clicked "Go") - now in Active section, needs to sign tx or send payment
      return "active";
    case "escrow_pending":
      return "active"; // Transaction pending, escrow not yet confirmed
    case "payment_pending":
    case "payment_sent":
    case "payment_confirmed":
    case "releasing":
      return "escrow"; // Ongoing - tx signed, trade in progress
    case "completed":
      return "completed";
    case "disputed":
      return "disputed";
    case "expired":
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
};

// Helper to get emoji from user name
const getUserEmoji = (name: string): string => {
  const emojis = ["🦊", "🦧", "🐋", "🦄", "🔥", "💎", "🐺", "🦁", "🐯", "🐻"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

// Mini Sparkline Component - Shows activity over time
const MiniSparkline = ({ data, color = "emerald", height = 24 }: { data: number[]; color?: string; height?: number }) => {
  const max = Math.max(...data, 1);
  const colorClass = color === "emerald" ? "bg-emerald-400" : color === "purple" ? "bg-purple-400" : "bg-cyan-400";

  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((value, i) => {
        const h = (value / max) * 100;
        return (
          <motion.div
            key={i}
            className={`flex-1 rounded-t-sm ${colorClass} opacity-60`}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(h, 8)}%` }}
            transition={{ delay: i * 0.03, duration: 0.4, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
};

// Animated Number Counter
const AnimatedCounter = ({ value, prefix = "", suffix = "", decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 1000;
    const steps = 30;
    const increment = value / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(current);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return <span>{prefix}{displayValue.toFixed(decimals)}{suffix}</span>;
};

// Helper to convert DB order to UI order
const mapDbOrderToUI = (dbOrder: DbOrder): Order => {
  const expiresAt = new Date(dbOrder.expires_at);
  const now = new Date();
  const expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  const userName = dbOrder.user?.name || "Unknown User";

  // Parse numeric values (API returns them as strings from PostgreSQL)
  const cryptoAmount = typeof dbOrder.crypto_amount === 'string'
    ? parseFloat(dbOrder.crypto_amount)
    : dbOrder.crypto_amount;
  const fiatAmount = typeof dbOrder.fiat_amount === 'string'
    ? parseFloat(dbOrder.fiat_amount)
    : dbOrder.fiat_amount;
  const rate = typeof dbOrder.rate === 'string'
    ? parseFloat(dbOrder.rate)
    : dbOrder.rate;

  // Check if this is an M2M trade
  const isM2M = !!dbOrder.buyer_merchant_id;

  return {
    id: dbOrder.id,
    user: isM2M ? (dbOrder.buyer_merchant?.display_name || 'Merchant') : userName,
    emoji: getUserEmoji(isM2M ? (dbOrder.buyer_merchant?.display_name || 'M') : userName),
    amount: cryptoAmount,
    fromCurrency: "USDC",
    toCurrency: "AED",
    rate: rate,
    total: fiatAmount,
    timestamp: new Date(dbOrder.created_at),
    status: mapDbStatusToUI(dbOrder.status, !!dbOrder.escrow_tx_hash, dbOrder.type),
    expiresIn,
    isNew: (dbOrder.user?.total_trades || 0) < 3,
    tradeVolume: (dbOrder.user?.total_trades || 0) * 500, // Estimated volume
    dbOrder,
    // Escrow fields for on-chain release
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    // Determine the recipient wallet for escrow:
    // 1. M2M: use buyer merchant's wallet
    // 2. Merchant-initiated with acceptor: use acceptor's wallet (another merchant accepted)
    // 3. Regular: use buyer_wallet_address or user's wallet
    userWallet: isM2M
      ? dbOrder.buyer_merchant?.wallet_address
      : (dbOrder.acceptor_wallet_address || dbOrder.buyer_wallet_address || dbOrder.user?.wallet_address),
    orderType: dbOrder.type,
    // User's bank account (from payment_details)
    userBankAccount: dbOrder.payment_details?.user_bank_account,
    // M2M fields
    isM2M,
    buyerMerchantId: dbOrder.buyer_merchant_id,
    buyerMerchantWallet: dbOrder.buyer_merchant?.wallet_address,
    // Acceptor wallet (for merchant-initiated orders)
    acceptorWallet: dbOrder.acceptor_wallet_address,
  };
};

// Top volume threshold for Top 1% badge (100k+ volume)
const TOP_1_PERCENT_THRESHOLD = 100000;

// Fee structure - trader earnings based on trade preference
// fast: 3% total, 1% to trader | best: 2.5% total, 0.5% to trader | cheap: 1.5% total, 0.25% to trader
const TRADER_CUT_CONFIG = {
  fast: 0.01,    // 1% to trader
  best: 0.005,   // 0.5% to trader
  cheap: 0.0025, // 0.25% to trader
  average: 0.00583, // Average across all preferences for display
} as const;

// Leaderboard data
const leaderboardData: LeaderboardEntry[] = [];

const notifications: { id: number; type: string; message: string; time: string; read: boolean }[] = [];

// Big order requests - special orders above threshold
interface BigOrderRequest {
  id: string;
  user: string;
  emoji: string;
  amount: number;
  currency: string;
  message: string;
  timestamp: Date;
  premium: number; // extra % they're willing to pay
}

const initialBigOrders: BigOrderRequest[] = [];

// Merchant info type
interface MerchantInfo {
  id: string;
  email: string;
  display_name: string;
  business_name: string;
  balance: number;
  wallet_address?: string;
  username?: string;
  rating?: number;
  total_trades?: number;
}

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const [orders, setOrders] = useState<Order[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);
  const [activeOffers, setActiveOffers] = useState<{ id: string; type: string; available_amount: number; is_active: boolean }[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Solana wallet state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [walletUpdatePending, setWalletUpdatePending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNewMerchant, setIsNewMerchant] = useState(false);

  // Escrow locking state
  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [escrowOrder, setEscrowOrder] = useState<Order | null>(null);
  const [isLockingEscrow, setIsLockingEscrow] = useState(false);
  const [escrowTxHash, setEscrowTxHash] = useState<string | null>(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);

  // Escrow release state
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [releaseOrder, setReleaseOrder] = useState<Order | null>(null);
  const [isReleasingEscrow, setIsReleasingEscrow] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [isCancellingEscrow, setIsCancellingEscrow] = useState(false);
  const [cancelTxHash, setCancelTxHash] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const solanaWallet = useSolanaWalletHook();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ email: "", password: "", confirmPassword: "", businessName: "" });
  const [authTab, setAuthTab] = useState<'signin' | 'create'>('signin');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [bigOrders, setBigOrders] = useState<BigOrderRequest[]>(initialBigOrders);
  const [showBigOrderWidget, setShowBigOrderWidget] = useState(true);
  // New dashboard panels
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOpenTradeModal, setShowOpenTradeModal] = useState(false);
  const [openTradeForm, setOpenTradeForm] = useState({
    tradeType: "sell" as "buy" | "sell", // From merchant perspective: sell = merchant sells USDC to user
    cryptoAmount: "",
    paymentMethod: "bank" as "bank" | "cash",
  });
  const [isCreatingTrade, setIsCreatingTrade] = useState(false);
  const [createTradeError, setCreateTradeError] = useState<string | null>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeOrderId, setDisputeOrderId] = useState<string | null>(null);
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
  const [extensionRequests, setExtensionRequests] = useState<Map<string, {
    requestedBy: 'user' | 'merchant';
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  }>>(new Map());
  const [requestingExtension, setRequestingExtension] = useState<string | null>(null);
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
  const [corridorForm, setCorridorForm] = useState({
    fromCurrency: "USDT",
    toCurrency: "AED",
    availableAmount: "", // How much USDT merchant wants to make available
    minAmount: "",
    maxAmount: "",
    rate: "3.67",
    premium: "0.25",
  });
  // Order view filter: 'new' (pending only) | 'all' (all orders including completed)
  const [orderViewFilter, setOrderViewFilter] = useState<'new' | 'all'>('new');
  // Mobile view state: 'orders' | 'escrow' | 'chat' | 'stats'
  const [mobileView, setMobileView] = useState<'orders' | 'active' | 'escrow' | 'chat' | 'stats'>('orders');
  // Order detail popup state
  const [selectedOrderPopup, setSelectedOrderPopup] = useState<Order | null>(null);
  const [markingDone, setMarkingDone] = useState(false);
  const chatInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Notifications state
  const [notifications, setNotifications] = useState<{
    id: string;
    type: 'order' | 'escrow' | 'payment' | 'dispute' | 'complete' | 'system';
    message: string;
    time: string;
    read: boolean;
    orderId?: string;
  }[]>([]);

  // Mark notification as read
  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  // Add notification helper
  const addNotification = (type: 'order' | 'escrow' | 'payment' | 'dispute' | 'complete' | 'system', message: string, orderId?: string) => {
    const newNotif = {
      id: `notif-${Date.now()}`,
      type,
      message,
      time: 'Just now',
      read: false,
      orderId,
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50)); // Keep max 50 notifications
  };

  // Real-time Pusher context
  const { setActor } = usePusher();

  // Set actor when merchant ID is available
  useEffect(() => {
    console.log('[Merchant Page] setActor effect - merchantId:', merchantId);
    if (merchantId) {
      console.log('[Merchant Page] Calling setActor with merchantId:', merchantId);
      setActor('merchant', merchantId);
    }
  }, [merchantId, setActor]);

  // Real-time chat hook via WebSocket (replaces Pusher for chat)
  const {
    chatWindows,
    openChat,
    closeChat,
    sendMessage,
  } = useWebSocketChat({
    maxWindows: 10,
    actorType: "merchant",
    actorId: merchantId || undefined,
    onNewMessage: () => {
      playSound('message');
    },
  });

  // Handle setting username for new merchant wallet users
  const handleMerchantUsername = async (username: string) => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress) {
      throw new Error("Wallet not connected");
    }

    if (!username.trim()) {
      throw new Error("Username is required");
    }

    try {
      // If we have merchantId, it means merchant exists and just needs username (no signature needed)
      if (merchantId && merchantInfo) {
        const res = await fetch('/api/auth/merchant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_username',
            merchant_id: merchantId,
            username: username.trim(),
          }),
        });

        const data = await res.json();

        if (data.success) {
          const updatedMerchant = { ...merchantInfo, username: username.trim() };
          setMerchantInfo(updatedMerchant);
          setIsLoggedIn(true);
          setShowUsernameModal(false);
          localStorage.setItem('blip_merchant', JSON.stringify(updatedMerchant));
          console.log('[Merchant] Username updated:', updatedMerchant);
        } else {
          throw new Error(data.error || 'Failed to update username');
        }
        return;
      }

      // Otherwise, need signature for new merchant creation
      if (!solanaWallet.signMessage) {
        throw new Error("Wallet signature method not available");
      }

      // Generate message to sign
      const timestamp = Date.now();
      const nonce = Math.random().toString(36).substring(7);
      const message = `Sign this message to authenticate with Blip Money\n\nWallet: ${solanaWallet.walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;

      // Request signature
      const encodedMessage = new TextEncoder().encode(message);
      const signatureUint8 = await solanaWallet.signMessage(encodedMessage);

      // Convert to base58
      const bs58 = await import('bs58');
      const signature = bs58.default.encode(signatureUint8);

      // Create merchant account via API
      const res = await fetch('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_merchant',
          wallet_address: solanaWallet.walletAddress,
          signature,
          message,
          username: username.trim(),
        }),
      });

      const data = await res.json();

      if (data.success && data.data.merchant) {
        // Merchant created successfully
        const merchant = data.data.merchant;
        setMerchantId(merchant.id);
        setMerchantInfo(merchant);
        setIsLoggedIn(true);
        setShowUsernameModal(false);
        localStorage.setItem('blip_merchant', JSON.stringify(merchant));
        console.log('[Merchant] Merchant account created:', merchant);
      } else {
        throw new Error(data.error || 'Failed to create merchant');
      }
    } catch (error) {
      console.error('Set merchant username error:', error);
      throw error;
    }
  };

  // Handle merchant login
  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email,
          password: loginForm.password,
          action: 'login',
        }),
      });

      const data = await res.json();

      if (data.success && data.data.merchant) {
        console.log('[Merchant] Login successful, merchant:', data.data.merchant);
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        localStorage.setItem('blip_merchant', JSON.stringify(data.data.merchant));
        // Prompt to connect wallet if merchant doesn't have one linked
        // Wallet is required for receiving escrow releases on sell orders
        if (!data.data.merchant.wallet_address) {
          console.log('[Merchant] No wallet linked, showing connect prompt');
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        console.log('[Merchant] Login failed:', data);
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Connection failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle merchant registration
  const handleRegister = async () => {
    if (registerForm.password !== registerForm.confirmPassword) {
      setLoginError('Passwords do not match');
      return;
    }

    if (registerForm.password.length < 6) {
      setLoginError('Password must be at least 6 characters');
      return;
    }

    setIsRegistering(true);
    setLoginError("");

    try {
      const res = await fetch('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          email: registerForm.email,
          password: registerForm.password,
          business_name: registerForm.businessName || undefined,
        }),
      });

      const data = await res.json();

      if (data.success && data.data.merchant) {
        console.log('[Merchant] Registration successful:', data.data.merchant);
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        localStorage.setItem('blip_merchant', JSON.stringify(data.data.merchant));
        // Prompt to connect wallet after registration
        // Wallet is required for receiving escrow releases on sell orders
        console.log('[Merchant] Showing wallet connect prompt after registration');
        setTimeout(() => setShowWalletPrompt(true), 500);
      } else {
        console.log('[Merchant] Registration failed:', data);
        setLoginError(data.error || 'Registration failed');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setLoginError('Connection failed');
    } finally {
      setIsRegistering(false);
    }
  };

  // Handle logout and disconnect wallet
  const handleLogout = () => {
    console.log('[Merchant] Signing out...');
    localStorage.removeItem('blip_merchant');
    localStorage.removeItem('merchant_info');
    // Disconnect wallet first
    if (solanaWallet.disconnect) {
      solanaWallet.disconnect();
    }
    // Force page reload to fully reset state
    window.location.href = '/merchant';
  };

  // Initialize - restore session if available
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedMerchant = localStorage.getItem('blip_merchant');

        if (savedMerchant) {
          const merchant = JSON.parse(savedMerchant);
          console.log('[Merchant] Restoring session:', merchant.display_name || merchant.username);

          // Validate merchant still exists in database
          const checkRes = await fetch(`/api/auth/merchant?action=check_session&merchant_id=${merchant.id}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.success && checkData.data?.valid) {
              // Session is valid, restore state with fresh data from API
              const freshMerchant = checkData.data.merchant || merchant;
              setMerchantId(freshMerchant.id);
              setMerchantInfo(freshMerchant);
              setIsLoggedIn(true);
              setIsLoading(false);
              // Update localStorage with fresh data
              localStorage.setItem('blip_merchant', JSON.stringify(freshMerchant));
              // Prompt to connect wallet if not linked
              if (!freshMerchant.wallet_address && !solanaWallet.connected) {
                console.log('[Merchant] Session restored but no wallet linked, showing prompt');
                setTimeout(() => setShowWalletPrompt(true), 1000);
              }
              return;
            }
          }
          // Session invalid, clear it
          console.log('[Merchant] Session invalid, clearing...');
          localStorage.removeItem('blip_merchant');
          localStorage.removeItem('merchant_info');
        }
      } catch (err) {
        console.error('[Merchant] Failed to restore session:', err);
        localStorage.removeItem('blip_merchant');
        localStorage.removeItem('merchant_info');
      }

      // No valid session, show login screen
      setIsLoading(false);
    };

    restoreSession();
  }, []); // Only run once on mount

  // Update merchant wallet address when connected
  // This ensures email/password merchants can link their wallet for escrow releases
  useEffect(() => {
    const updateMerchantWallet = async () => {
      // Only update if we have both merchantId and wallet address
      if (!merchantId || !solanaWallet.walletAddress) return;

      // Check if merchant already has this wallet linked (from merchantInfo)
      if (merchantInfo?.wallet_address === solanaWallet.walletAddress) {
        console.log('[Merchant] Wallet already linked to account');
        return;
      }

      try {
        console.log('[Merchant] Linking wallet to account:', solanaWallet.walletAddress);
        const res = await fetch('/api/auth/merchant', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: merchantId,
            wallet_address: solanaWallet.walletAddress,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            console.log('[Merchant] Wallet linked successfully');
            // Update local state to reflect the linked wallet
            setMerchantInfo(prev => prev ? { ...prev, wallet_address: solanaWallet.walletAddress! } : prev);
            // Update localStorage too
            const stored = localStorage.getItem('blip_merchant');
            if (stored) {
              const merchantData = JSON.parse(stored);
              merchantData.wallet_address = solanaWallet.walletAddress;
              localStorage.setItem('blip_merchant', JSON.stringify(merchantData));
            }
          }
        } else {
          console.error('[Merchant] Failed to link wallet:', await res.text());
        }
      } catch (err) {
        console.error('[Merchant] Error linking wallet:', err);
      }
    };

    updateMerchantWallet();
  }, [merchantId, solanaWallet.walletAddress, merchantInfo?.wallet_address]);

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    if (!merchantId) {
      console.log('[Merchant] fetchOrders: No merchantId, skipping');
      return;
    }

    // Validate merchantId is a valid UUID before making API call
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(merchantId)) {
      console.error('[Merchant] fetchOrders: Invalid merchantId format:', merchantId);
      return;
    }

    console.log('[Merchant] fetchOrders: Fetching for merchantId:', merchantId);

    try {
      // Fetch ALL pending orders (broadcast model) + merchant's own orders
      const res = await fetch(`/api/merchant/orders?merchant_id=${merchantId}&include_all_pending=true`);
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        console.error('[Merchant] Failed to fetch orders:', res.status, res.statusText, errorBody);
        return;
      }
      const data = await res.json();
      console.log('[Merchant] API response:', data);
      if (data.success && data.data) {
        console.log('[Merchant] Raw orders from API:', data.data);
        const mappedOrders = data.data.map(mapDbOrderToUI);
        // Filter out pending orders that have already expired
        const validOrders = mappedOrders.filter((order: Order) => {
          if (order.status === "pending" && order.expiresIn <= 0) {
            console.log('[Merchant] Filtering out expired pending order:', order.id);
            return false;
          }
          return true;
        });
        console.log('[Merchant] Mapped orders:', validOrders);
        setOrders(validOrders);
      } else {
        console.log('[Merchant] No data in response or not success');
      }
    } catch (error) {
      console.error("[Merchant] Error fetching orders:", error);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  // Fetch resolved disputes
  const fetchResolvedDisputes = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/disputes/resolved?actor_type=merchant&actor_id=${merchantId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setResolvedDisputes(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch resolved disputes:', err);
    }
  }, [merchantId]);

  // Fetch big orders from API
  const fetchBigOrders = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/merchant/big-orders?merchant_id=${merchantId}&limit=10`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data?.orders) {
        // Map API response to BigOrderRequest format
        const mappedOrders: BigOrderRequest[] = data.data.orders.map((order: {
          id: string;
          user: { username: string };
          fiat_amount: number;
          fiat_currency: string;
          custom_notes?: string;
          premium_percent?: number;
          created_at: string;
        }) => ({
          id: order.id,
          user: order.user?.username || 'Unknown',
          emoji: '🐳',
          amount: order.fiat_amount,
          currency: order.fiat_currency || 'AED',
          message: order.custom_notes || 'Large order available',
          timestamp: new Date(order.created_at),
          premium: order.premium_percent || 0,
        }));
        if (mappedOrders.length > 0) {
          setBigOrders(mappedOrders);
        }
      }
    } catch (err) {
      console.error('Failed to fetch big orders:', err);
    }
  }, [merchantId]);

  // Fetch merchant's active offers
  const fetchActiveOffers = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/merchant/offers?merchant_id=${merchantId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        console.log('[Merchant] Active offers:', data.data);
        setActiveOffers(data.data.filter((o: { is_active: boolean }) => o.is_active));
      }
    } catch (err) {
      console.error('Failed to fetch active offers:', err);
    }
  }, [merchantId]);

  // Fetch orders when merchant ID is available
  // Real-time updates come via Pusher WebSocket (useRealtimeOrders hook)
  useEffect(() => {
    if (!merchantId) return;
    fetchOrders();
    fetchResolvedDisputes();
    fetchBigOrders();
    fetchActiveOffers();
  }, [merchantId, fetchOrders, fetchResolvedDisputes, fetchBigOrders, fetchActiveOffers]);

  // WebSocket-first approach with minimal polling fallback
  const { isConnected: isPusherConnected } = usePusher();
  useEffect(() => {
    if (!merchantId) return;

    // Only poll as fallback if WebSocket is disconnected (30s interval)
    // Primary updates come via WebSocket (Pusher)
    if (!isPusherConnected) {
      console.log('[Merchant] WebSocket not connected, using polling fallback');
      const interval = setInterval(() => {
        fetchOrders();
      }, 30000); // 30 seconds fallback

      return () => clearInterval(interval);
    }
  }, [merchantId, isPusherConnected, fetchOrders]);

  // Auto-expire orders every 30 seconds
  useEffect(() => {
    if (!merchantId) return;

    const expireOrders = async () => {
      try {
        await fetch('/api/orders/expire', { method: 'POST' });
      } catch (error) {
        console.error('[Merchant] Failed to expire orders:', error);
      }
    };

    // Run immediately and then every 30 seconds
    expireOrders();
    const interval = setInterval(expireOrders, 30000);

    return () => clearInterval(interval);
  }, [merchantId]);

  // Real-time orders subscription - triggers refetch on updates
  useRealtimeOrders({
    actorType: 'merchant',
    actorId: merchantId,
    onOrderCreated: (order) => {
      // Refetch orders when a new order comes in
      console.log('[Merchant] Real-time: New order created!', order);
      fetchOrders();
      playSound('notification');
      addNotification('order', 'New order received');
    },
    onOrderStatusUpdated: (orderId, newStatus) => {
      // Refetch orders when status changes
      fetchOrders();
      if (newStatus === 'payment_sent') {
        addNotification('payment', 'Payment sent for order', orderId);
        playSound('notification');
      } else if (newStatus === 'completed') {
        addNotification('complete', 'Trade completed!', orderId);
        playSound('trade_complete');
        // Refresh on-chain wallet balance to sync with platform balance
        if (solanaWallet.connected) {
          solanaWallet.refreshBalances();
        }
      } else if (newStatus === 'disputed') {
        addNotification('dispute', 'Dispute opened on order', orderId);
        playSound('error');
      }
    },
    onExtensionRequested: (data) => {
      // User requested an extension
      if (data.requestedBy === 'user') {
        setExtensionRequests(prev => {
          const newMap = new Map(prev);
          newMap.set(data.orderId, {
            requestedBy: data.requestedBy,
            extensionMinutes: data.extensionMinutes,
            extensionCount: data.extensionCount,
            maxExtensions: data.maxExtensions,
          });
          return newMap;
        });
        addNotification('system', `User requested ${data.extensionMinutes}min extension`, data.orderId);
        playSound('notification');
      }
    },
    onExtensionResponse: (data) => {
      // Remove from local tracking
      setExtensionRequests(prev => {
        const newMap = new Map(prev);
        newMap.delete(data.orderId);
        return newMap;
      });
      if (data.accepted) {
        addNotification('system', 'Extension accepted', data.orderId);
        fetchOrders(); // Refresh to get new expires_at
      } else {
        addNotification('system', `Extension declined - order ${data.newStatus || 'updated'}`, data.orderId);
        fetchOrders();
      }
    },
  });

  // Update timers and filter out expired pending orders
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => {
        const updatedOrders = prev.map(order => ({
          ...order,
          expiresIn: order.status === "completed" || order.status === "cancelled"
            ? 0
            : Math.max(0, order.expiresIn - 1),
        }));

        // Filter out pending orders that have expired (expiresIn reached 0)
        // Keep all non-pending orders and pending orders with time left
        return updatedOrders.filter(order => {
          if (order.status === "pending" && order.expiresIn <= 0) {
            // Mark as expired in the backend (order.id is already the DB order ID)
            fetch(`/api/orders/${order.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'expired',
                actor_type: 'system',
                actor_id: 'system',
              }),
            }).catch(console.error);
            return false; // Remove from list
          }
          return true;
        });
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (activeChatId && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChatId, chatWindows]);

  const acceptOrder = async (order: Order) => {
    if (!merchantId) return;

    const isBuyOrder = order.orderType === 'buy';
    const isSellOrder = order.orderType === 'sell';

    // Debug logging
    console.log('[Go] Accepting order:', {
      id: order.id,
      orderType: order.orderType,
      dbOrderStatus: order.dbOrder?.status,
    });

    // "Go" button does NOT require wallet connection or signature
    // That happens in the Active section when signing tx for next step

    try {
      // Build the request body - just accept the order, no signature needed
      const requestBody: Record<string, unknown> = {
        status: "accepted",
        actor_type: "merchant",
        actor_id: merchantId,
      };

      // Include wallet address if connected (for tracking, not required)
      if (solanaWallet.walletAddress) {
        requestBody.acceptor_wallet_address = solanaWallet.walletAddress;
      }

      // Step 1: Accept the order (moves to 'accepted' status - shown in Active section)
      const acceptRes = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!acceptRes.ok) {
        const errorData = await acceptRes.json().catch(() => ({}));
        console.error("Failed to accept order:", acceptRes.status, errorData);
        addNotification('system', `Failed to accept order: ${errorData.error || `HTTP ${acceptRes.status}`}`, order.id);
        playSound('error');
        return;
      }
      const acceptData = await acceptRes.json();

      if (!acceptData.success) {
        console.error("Failed to accept order:", acceptData.error);
        addNotification('system', `Failed to accept order: ${acceptData.error}`, order.id);
        playSound('error');
        return;
      }

      // Update local state to show in Active section (needs signing for next step)
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "active" as const, expiresIn: 1800 } : o));
      handleOpenChat(order.user, order.emoji, order.id);
      fetchOrders();
      playSound('click');
      // Next step: sign tx in Active section
      const nextStepMsg = isBuyOrder
        ? 'Now sign to lock your USDC in escrow.'
        : 'Now sign to confirm and proceed.';
      addNotification('system', `Order accepted! ${nextStepMsg}`, order.id);
    } catch (error) {
      console.error("Error accepting order:", error);
      playSound('error');
    }
  };

  // Sign and proceed for sell orders (Active -> Ongoing)
  // Merchant signs to confirm they will send fiat payment
  const signAndProceed = async (order: Order) => {
    if (!merchantId) return;

    // Require wallet connection for signing
    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to sign.');
      setShowWalletModal(true);
      return;
    }

    if (!solanaWallet.walletAddress || !solanaWallet.signMessage) {
      addNotification('system', 'Wallet not ready. Please reconnect.');
      playSound('error');
      return;
    }

    try {
      // Sign message to prove wallet ownership
      const message = `Confirm order ${order.id} - I will send fiat payment. Wallet: ${solanaWallet.walletAddress}`;
      const messageBytes = new TextEncoder().encode(message);

      addNotification('system', 'Please sign in your wallet to proceed...', order.id);
      const signatureBytes = await solanaWallet.signMessage(messageBytes);
      const signature = Buffer.from(signatureBytes).toString('base64');
      console.log('[Sign] Wallet signature obtained');

      // Update order to payment_sent (moves to Ongoing)
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "payment_sent",
          actor_type: "merchant",
          actor_id: merchantId,
          acceptor_wallet_address: solanaWallet.walletAddress,
          acceptor_wallet_signature: signature,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        addNotification('system', `Failed to update order: ${errorData.error || 'Unknown error'}`, order.id);
        playSound('error');
        return;
      }

      // Update local state to show in Ongoing section
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "escrow" as const } : o));
      fetchOrders();
      playSound('click');
      addNotification('system', 'Signed! Order moved to Ongoing. Click "I\'ve Paid" when you send the fiat.', order.id);
    } catch (error: any) {
      if (error?.message?.includes('User rejected')) {
        addNotification('system', 'Signature rejected. Please sign to proceed.');
      } else {
        console.error("Error signing:", error);
        addNotification('system', 'Failed to sign. Please try again.');
      }
      playSound('error');
    }
  };

  // Open escrow modal for buy orders
  const openEscrowModal = async (order: Order) => {
    if (!merchantId) return;

    // Only for buy orders where merchant needs to lock their USDC
    if (order.orderType !== 'buy') {
      addNotification('system', 'Escrow is locked by the user for sell orders.');
      return;
    }

    // Check wallet connection
    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to lock escrow.');
      setShowWalletModal(true);
      return;
    }

    // Fetch latest order data to get user's current wallet address
    let orderToUse = order;
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          orderToUse = mapDbOrderToUI(data.data);
          console.log('[Escrow] Fetched fresh order data, userWallet:', orderToUse.userWallet);
        }
      }
    } catch (err) {
      console.error('[Escrow] Error fetching fresh order:', err);
    }

    // Reset state and open modal
    setEscrowOrder(orderToUse);
    setEscrowTxHash(null);
    setEscrowError(null);
    setIsLockingEscrow(false);
    setShowEscrowModal(true);
  };

  // Execute the actual escrow lock transaction
  const executeLockEscrow = async () => {
    if (!merchantId || !escrowOrder) return;

    // Check balance
    if (solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance < escrowOrder.amount) {
      setEscrowError(`Insufficient USDC balance. You need ${escrowOrder.amount} USDC.`);
      return;
    }

    // Check if user has a valid Solana wallet (base58 format) - REQUIRED for on-chain escrow
    const userWallet = escrowOrder.userWallet;
    const isValidSolanaAddress = userWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(userWallet);

    if (!isValidSolanaAddress) {
      setEscrowError('User has not connected their Solana wallet yet. Ask them to connect their wallet in the app first.');
      return;
    }

    setIsLockingEscrow(true);
    setEscrowError(null);

    try {
      console.log('[Merchant] Executing on-chain escrow lock...', {
        amount: escrowOrder.amount,
        userWallet: userWallet,
      });

      const escrowResult = await solanaWallet.depositToEscrow({
        amount: escrowOrder.amount,
        merchantWallet: userWallet, // User's wallet to receive the USDC
      });
      console.log('[Merchant] depositToEscrow result:', escrowResult);

      if (!escrowResult.success || !escrowResult.txHash) {
        throw new Error(escrowResult.error || 'Transaction failed');
      }

      // Transaction successful - show tx hash
      setEscrowTxHash(escrowResult.txHash);
      console.log('[Merchant] Escrow locked on-chain:', escrowResult.txHash);

      // Update local state IMMEDIATELY after on-chain success
      // This ensures the Lock button disappears even if the backend recording fails
      setOrders(prev => prev.map(o => o.id === escrowOrder.id ? {
        ...o,
        status: "escrow" as const,
        escrowTxHash: escrowResult.txHash,
        escrowTradeId: escrowResult.tradeId,
        escrowTradePda: escrowResult.tradePda,
        escrowCreatorWallet: solanaWallet.walletAddress,
      } : o));

      // Record escrow on backend with retry (devnet verification can be slow)
      const escrowPayload = {
        tx_hash: escrowResult.txHash,
        actor_type: "merchant",
        actor_id: merchantId,
        escrow_address: escrowResult.escrowPda,
        escrow_trade_id: escrowResult.tradeId,
        escrow_trade_pda: escrowResult.tradePda,
        escrow_pda: escrowResult.escrowPda,
        escrow_creator_wallet: solanaWallet.walletAddress,
      };

      let recorded = false;
      for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
        if (attempt > 0) {
          console.log(`[Merchant] Retrying escrow recording (attempt ${attempt + 1})...`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
        try {
          const res = await fetch(`/api/orders/${escrowOrder.id}/escrow`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(escrowPayload),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success) recorded = true;
          }
        } catch (err) {
          console.error(`[Merchant] Escrow record attempt ${attempt + 1} failed:`, err);
        }
      }

      if (recorded) {
        playSound('trade_complete');
        addNotification('escrow', `${escrowOrder.amount} USDC locked in escrow - waiting for user payment`, escrowOrder.id);
      } else {
        console.error('[Merchant] Failed to record escrow on backend after retries');
        addNotification('system', 'Escrow locked on-chain but server sync failed. It will sync automatically.', escrowOrder.id);
      }

      setIsLockingEscrow(false);
    } catch (error) {
      console.error("Error locking escrow:", error);
      setEscrowError(error instanceof Error ? error.message : 'Failed to lock escrow. Please try again.');
      setIsLockingEscrow(false);
      playSound('error');
    }
  };

  // Close escrow modal
  const closeEscrowModal = () => {
    setShowEscrowModal(false);
    setEscrowOrder(null);
    setEscrowTxHash(null);
    setEscrowError(null);
    setIsLockingEscrow(false);
    // Refresh orders to ensure we have latest status
    fetchOrders();
  };

  // Open release modal for confirming payment and releasing escrow
  const openReleaseModal = async (order: Order) => {
    if (!merchantId) return;

    // Check wallet connection
    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to release escrow.');
      setShowWalletModal(true);
      return;
    }

    // Fetch latest order data to ensure we have escrow details
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const freshOrder = mapDbOrderToUI(data.data);
          console.log('[Release] Fetched fresh order data:', {
            escrowTradeId: freshOrder.escrowTradeId,
            escrowCreatorWallet: freshOrder.escrowCreatorWallet,
            userWallet: freshOrder.userWallet,
          });

          setReleaseOrder(freshOrder);
          setReleaseTxHash(null);
          setReleaseError(null);
          setIsReleasingEscrow(false);
          setShowReleaseModal(true);
          return;
        }
      }
    } catch (err) {
      console.error('[Release] Error fetching fresh order:', err);
    }

    // Fallback to cached order
    setReleaseOrder(order);
    setReleaseTxHash(null);
    setReleaseError(null);
    setIsReleasingEscrow(false);
    setShowReleaseModal(true);
  };

  // Execute the escrow release transaction
  const executeRelease = async () => {
    if (!merchantId || !releaseOrder) return;

    setIsReleasingEscrow(true);
    setReleaseError(null);

    try {
      // Validate escrow details
      const { escrowTradeId, escrowCreatorWallet, userWallet } = releaseOrder;
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

      if (!escrowTradeId || !escrowCreatorWallet || !userWallet) {
        setReleaseError('Missing escrow details. The escrow may not have been locked on-chain.');
        setIsReleasingEscrow(false);
        return;
      }

      if (!base58Regex.test(userWallet)) {
        setReleaseError('Invalid user wallet address format.');
        setIsReleasingEscrow(false);
        return;
      }

      console.log('[Release] Releasing escrow:', {
        tradeId: escrowTradeId,
        creatorWallet: escrowCreatorWallet,
        counterparty: userWallet,
      });

      // Call the on-chain release function (this will trigger wallet popup)
      const releaseResult = await solanaWallet.releaseEscrow({
        creatorPubkey: escrowCreatorWallet,
        tradeId: escrowTradeId,
        counterparty: userWallet,
      });

      if (releaseResult.success) {
        console.log('[Release] Escrow released successfully:', releaseResult.txHash);
        setReleaseTxHash(releaseResult.txHash);

        // Record the release on backend
        await fetch(`/api/orders/${releaseOrder.id}/escrow`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tx_hash: releaseResult.txHash,
            actor_type: 'merchant',
            actor_id: merchantId,
          }),
        });

        // Update local state
        setOrders(prev => prev.map(o => o.id === releaseOrder.id ? { ...o, status: "completed" as const } : o));
        fetchOrders();
        // Refresh on-chain wallet balance to sync with platform balance
        if (solanaWallet.connected) {
          solanaWallet.refreshBalances();
        }
        playSound('trade_complete');
        addNotification('escrow', `Escrow released! ${releaseOrder.amount} USDC sent to buyer.`, releaseOrder.id);
      } else {
        setReleaseError(releaseResult.error || 'Failed to release escrow');
        playSound('error');
      }
    } catch (error) {
      console.error('[Release] Error releasing escrow:', error);
      setReleaseError(error instanceof Error ? error.message : 'Failed to release escrow. Please try again.');
      playSound('error');
    } finally {
      setIsReleasingEscrow(false);
    }
  };

  // Close release modal
  const closeReleaseModal = () => {
    setShowReleaseModal(false);
    setReleaseOrder(null);
    setReleaseTxHash(null);
    setReleaseError(null);
    setIsReleasingEscrow(false);
  };

  // Open cancel/withdraw escrow modal
  const openCancelModal = async (order: Order) => {
    if (!merchantId) return;

    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to cancel escrow.');
      setShowWalletModal(true);
      return;
    }

    // Fetch latest order data
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const freshOrder = mapDbOrderToUI(data.data);
          setCancelOrder(freshOrder);
          setCancelTxHash(null);
          setCancelError(null);
          setIsCancellingEscrow(false);
          setShowCancelModal(true);
          return;
        }
      }
    } catch (err) {
      console.error('[Cancel] Error fetching fresh order:', err);
    }

    // Fallback to cached order
    setCancelOrder(order);
    setCancelTxHash(null);
    setCancelError(null);
    setIsCancellingEscrow(false);
    setShowCancelModal(true);
  };

  // Execute the escrow cancel/refund transaction
  const executeCancelEscrow = async () => {
    if (!merchantId || !cancelOrder) return;

    setIsCancellingEscrow(true);
    setCancelError(null);

    try {
      const { escrowTradeId, escrowCreatorWallet } = cancelOrder;

      if (!escrowTradeId || !escrowCreatorWallet) {
        setCancelError('Missing escrow details. The escrow may not have been locked on-chain.');
        setIsCancellingEscrow(false);
        return;
      }

      console.log('[Cancel] Refunding escrow:', {
        tradeId: escrowTradeId,
        creatorWallet: escrowCreatorWallet,
      });

      // Call the on-chain refund function
      const refundResult = await solanaWallet.refundEscrow({
        creatorPubkey: escrowCreatorWallet,
        tradeId: escrowTradeId,
      });

      if (refundResult.success) {
        console.log('[Cancel] Escrow refunded successfully:', refundResult.txHash);
        setCancelTxHash(refundResult.txHash);

        // Update order status to cancelled on backend
        await fetch(`/api/orders/${cancelOrder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'cancelled',
            actor_type: 'merchant',
            actor_id: merchantId,
          }),
        });

        // Update local state
        setOrders(prev => prev.map(o => o.id === cancelOrder.id ? { ...o, status: "cancelled" as const } : o));
        fetchOrders();
        playSound('click');
        addNotification('system', `Escrow cancelled. ${cancelOrder.amount} USDC returned to your wallet.`, cancelOrder.id);
      } else {
        setCancelError(refundResult.error || 'Failed to refund escrow');
        playSound('error');
      }
    } catch (error) {
      console.error('[Cancel] Error cancelling escrow:', error);
      setCancelError(error instanceof Error ? error.message : 'Failed to cancel escrow. Please try again.');
      playSound('error');
    } finally {
      setIsCancellingEscrow(false);
    }
  };

  // Close cancel modal
  const closeCancelModal = () => {
    setShowCancelModal(false);
    setCancelOrder(null);
    setCancelTxHash(null);
    setCancelError(null);
    setIsCancellingEscrow(false);
  };

  // Merchant marks payment as sent -> moves to Completed
  const markPaymentSent = async (order: Order) => {
    if (!merchantId) return;
    setMarkingDone(true);

    try {
      // Update order status to completed
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // Close popup and refresh orders
          setSelectedOrderPopup(null);
          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "completed" as const } : o));
          fetchOrders();
          playSound('trade_complete');
          addNotification('complete', `Trade completed with ${order.user}!`, order.id);
        }
      }
    } catch (error) {
      console.error("Error completing order:", error);
      playSound('error');
    } finally {
      setMarkingDone(false);
    }
  };

  const completeOrder = async (orderId: string) => {
    if (!merchantId) return;

    try {
      // Update order status to completed via API
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });
      if (!res.ok) {
        console.error("Failed to complete order:", res.status);
        return;
      }
      const data = await res.json();
      if (data.success) {
        // Update local state
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "completed" as const } : o));
        // Refresh orders from server
        fetchOrders();
        // Refresh on-chain wallet balance to sync with platform balance
        if (solanaWallet.connected) {
          solanaWallet.refreshBalances();
        }
        playSound('trade_complete');
      }
    } catch (error) {
      console.error("Error completing order:", error);
      playSound('error');
    }
  };

  const confirmPayment = async (orderId: string) => {
    if (!merchantId) return;

    // Find the order to get escrow details
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      console.error("Order not found:", orderId);
      return;
    }

    try {
      // For BUY orders where merchant locked escrow, release the escrow first
      // BUY order = user buying crypto, merchant selling = merchant locked the escrow
      if (order.orderType === 'buy' && order.escrowTradeId && order.escrowCreatorWallet && order.userWallet) {
        // Check if merchant's wallet matches the escrow creator
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
        const isValidUserWallet = order.userWallet && base58Regex.test(order.userWallet);

        if (solanaWallet.connected && isValidUserWallet) {
          console.log('[Merchant] Releasing escrow for BUY order:', {
            tradeId: order.escrowTradeId,
            creatorWallet: order.escrowCreatorWallet,
            counterparty: order.userWallet
          });

          // Release escrow on-chain - this MUST succeed for buy orders
          const releaseResult = await solanaWallet.releaseEscrow({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
            counterparty: order.userWallet,
          });

          if (!releaseResult.success) {
            console.error('[Merchant] Failed to release escrow:', releaseResult.error);
            addNotification('system', `Failed to release escrow: ${releaseResult.error || 'Unknown error'}`, orderId);
            playSound('error');
            return; // Don't mark as completed if escrow release failed
          }

          console.log('[Merchant] Escrow released successfully:', releaseResult.txHash);

          // Record the release on backend (PATCH to escrow endpoint)
          await fetch(`/api/orders/${orderId}/escrow`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tx_hash: releaseResult.txHash,
              actor_type: 'merchant',
              actor_id: merchantId,
            }),
          });
        } else {
          // Can't release without wallet connection or valid user wallet
          if (!solanaWallet.connected) {
            addNotification('system', 'Please connect your wallet to release escrow.', orderId);
            setShowWalletModal(true);
          } else {
            addNotification('system', 'Invalid buyer wallet address. Cannot release escrow.', orderId);
          }
          playSound('error');
          return; // Don't mark as completed
        }
      }

      // For BUY orders: escrow was released above, mark as completed
      // For SELL orders: just confirm payment, user will release escrow
      const newStatus = order.orderType === 'buy' ? 'completed' : 'payment_confirmed';

      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });
      if (!res.ok) {
        console.error("Failed to confirm payment:", res.status);
        return;
      }
      const data = await res.json();
      if (data.success) {
        // Refresh orders from server
        fetchOrders();
        if (order.orderType === 'buy') {
          playSound('trade_complete');
          addNotification('complete', `Order completed - ${order.amount} USDC released to buyer`, orderId);
        }
      } else {
        console.error("Failed to confirm payment:", data.error);
      }
    } catch (error) {
      console.error("Error confirming payment:", error);
    }
  };

  const openDisputeModal = (orderId: string) => {
    setDisputeOrderId(orderId);
    setShowDisputeModal(true);
  };

  const submitDispute = async () => {
    if (!disputeOrderId || !merchantId || !disputeReason) return;

    setIsSubmittingDispute(true);
    try {
      const res = await fetch(`/api/orders/${disputeOrderId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: disputeReason,
          description: disputeDescription,
          initiated_by: 'merchant',
          merchant_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOrders(prev => prev.map(o =>
            o.id === disputeOrderId ? { ...o, status: "disputed" as const } : o
          ));
          setShowDisputeModal(false);
          setDisputeOrderId(null);
          setDisputeReason("");
          setDisputeDescription("");
          playSound('click');
        }
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      playSound('error');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  // Fetch dispute info for an order
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

  // Request extension for an order
  const requestExtension = async (orderId: string) => {
    if (!merchantId) return;

    setRequestingExtension(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/extension`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'merchant',
          actor_id: merchantId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        addNotification('system', 'Extension request sent to user', orderId);
        playSound('click');
        // Add to local extension requests tracking
        setExtensionRequests(prev => {
          const newMap = new Map(prev);
          newMap.set(orderId, {
            requestedBy: 'merchant',
            extensionMinutes: data.data?.extension_minutes || 30,
            extensionCount: data.data?.extension_count || 0,
            maxExtensions: data.data?.max_extensions || 3,
          });
          return newMap;
        });
      } else {
        addNotification('system', data.error || 'Failed to request extension', orderId);
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to request extension:', err);
      addNotification('system', 'Failed to request extension', orderId);
      playSound('error');
    } finally {
      setRequestingExtension(null);
    }
  };

  // Respond to extension request (accept/decline)
  const respondToExtension = async (orderId: string, accept: boolean) => {
    if (!merchantId) return;

    setRequestingExtension(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/extension`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'merchant',
          actor_id: merchantId,
          accept,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Remove from local extension requests
        setExtensionRequests(prev => {
          const newMap = new Map(prev);
          newMap.delete(orderId);
          return newMap;
        });

        if (accept) {
          addNotification('system', 'Extension accepted - time extended', orderId);
          playSound('click');
          fetchOrders(); // Refresh to get new expires_at
        } else {
          addNotification('system', `Extension declined - order ${data.data?.status || 'updated'}`, orderId);
          playSound('error');
          fetchOrders(); // Refresh orders
        }
      } else {
        addNotification('system', data.error || 'Failed to respond to extension', orderId);
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to respond to extension:', err);
      playSound('error');
    } finally {
      setRequestingExtension(null);
    }
  };

  // Respond to resolution proposal (accept/reject)
  const respondToResolution = async (action: 'accept' | 'reject', orderId: string) => {
    if (!merchantId || !disputeInfo) return;

    setIsRespondingToResolution(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/dispute/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party: 'merchant',
          action,
          partyId: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // Refresh dispute info
          fetchDisputeInfo(orderId);
          // Refresh orders if resolution was finalized
          if (data.data?.finalized) {
            fetchOrders();
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

  // Fetch dispute info when viewing a chat for a disputed order
  useEffect(() => {
    const activeChat = chatWindows.find(c => c.id === activeChatId);
    if (activeChat?.orderId) {
      const order = orders.find(o => o.id === activeChat.orderId);
      if (order?.status === 'disputed') {
        fetchDisputeInfo(activeChat.orderId);
      } else {
        setDisputeInfo(null);
      }
    }
  }, [activeChatId, chatWindows, orders, fetchDisputeInfo]);

  const handleOpenChat = (user: string, emoji: string, orderId?: string) => {
    openChat(user, emoji, orderId);
    // Find or set the active chat
    const existingChat = chatWindows.find(w => w.user === user);
    if (existingChat) {
      setActiveChatId(existingChat.id);
    } else {
      // Will be set after the chat is created
      setTimeout(() => {
        const newChat = chatWindows.find(w => w.user === user);
        if (newChat) setActiveChatId(newChat.id);
      }, 50);
    }
  };

  const dismissBigOrder = (id: string) => {
    setBigOrders(prev => prev.filter(o => o.id !== id));
  };

  // Filter orders by status - Flow: New Orders → Active → Ongoing → Completed
  // "pending" = New Orders (including escrowed sell orders waiting for merchant to click "Go")
  const pendingOrders = orders.filter(o => o.status === "pending" && o.expiresIn > 0);
  // "active" = Active (merchant clicked "Go", now needs to sign tx or send payment)
  const activeOrders = orders.filter(o => o.status === "active");
  // "escrow" = Ongoing (tx signed, trade in progress)
  const ongoingOrders = orders.filter(o => o.status === "escrow");
  const completedOrders = orders.filter(o => o.status === "completed");

  // Debug logging for UI state
  console.log('[Merchant UI] State:', {
    merchantId,
    isLoggedIn,
    isLoading,
    walletConnected: solanaWallet.connected,
    ordersCount: orders.length,
    pendingOrdersCount: pendingOrders.length,
    bigOrdersCount: bigOrders.length,
  });


  // Calculate trader earnings using "best" rate (most common preference)
  // Trader earns 0.5% of each completed trade
  const todayEarnings = completedOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0);
  const totalTradedVolume = completedOrders.reduce((sum, o) => sum + o.amount, 0);
  const pendingEarnings = ongoingOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0);

  const activeChat = chatWindows.find(c => c.id === activeChatId);
  const totalUnread = chatWindows.reduce((sum, c) => sum + c.unread, 0);

  // Loading screen - show while checking session
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
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
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
              <Wallet className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl font-bold mb-2">Merchant Portal</h1>
            <p className="text-sm text-gray-500">Manage your orders and trades</p>
          </div>

          {/* Tabs */}
          <div className="flex mb-4 bg-[#151515] rounded-xl p-1">
            <button
              onClick={() => { setAuthTab('signin'); setLoginError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                authTab === 'signin'
                  ? 'bg-white text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setAuthTab('create'); setLoginError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                authTab === 'create'
                  ? 'bg-white text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="bg-[#0d0d0d] rounded-2xl border border-white/[0.04] p-6 space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                {loginError}
              </div>
            )}

            {isAuthenticating && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-sm text-blue-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Authenticating with wallet...
              </div>
            )}

            {/* Sign In Tab */}
            {authTab === 'signin' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Email</label>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="merchant@email.com"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleLogin}
                  disabled={isLoggingIn || !loginForm.email || !loginForm.password}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {isLoggingIn ? "Signing in..." : "Sign In"}
                </motion.button>

                <p className="text-[11px] text-gray-500 text-center">
                  You can connect your wallet after signing in to enable on-chain transactions
                </p>
              </div>
            )}

            {/* Create Account Tab */}
            {authTab === 'create' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Email</label>
                  <input
                    type="email"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="your@email.com"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Business Name (Optional)</label>
                  <input
                    type="text"
                    value={registerForm.businessName}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, businessName: e.target.value }))}
                    placeholder="Your Business"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                  <input
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Min. 6 characters"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Confirm Password</label>
                  <input
                    type="password"
                    value={registerForm.confirmPassword}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                  />
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleRegister}
                  disabled={isRegistering || !registerForm.email || !registerForm.password || !registerForm.confirmPassword}
                  className="w-full py-3.5 rounded-xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isRegistering ? "Creating Account..." : "Create Account"}
                </motion.button>

                <p className="text-[11px] text-gray-500 text-center">
                  After creating your account, you can connect your wallet to enable on-chain transactions
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.04] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[300px] bg-emerald-500/[0.02] rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.015] rounded-full blur-[200px]" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="px-4 h-12 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg border border-white/20 flex items-center justify-center text-white font-bold text-xs">
              B
            </div>
            <span className="text-sm font-semibold hidden sm:block">Merchant</span>
          </div>

          {/* Nav Links */}
          <nav className="flex items-center gap-1 ml-3">
            <Link
              href="/merchant"
              className="px-2.5 py-1 text-[11px] font-medium bg-white/[0.08] rounded-md text-white"
            >
              Console
            </Link>
            <Link
              href="/merchant/analytics"
              className="px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-md transition-all"
            >
              Analytics
            </Link>
          </nav>

          {/* Create Corridor - Prominent CTA */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (!solanaWallet.connected) {
                setShowWalletModal(true);
              } else {
                setShowCreateModal(true);
              }
            }}
            className={`ml-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
              solanaWallet.connected
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-[#26A17B] text-white hover:bg-[#26A17B]/90'
            }`}
          >
            {solanaWallet.connected ? (
              <>
                <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                <span className="hidden sm:inline">Open Corridor</span>
              </>
            ) : (
              <>
                <Wallet className="w-3.5 h-3.5" strokeWidth={2.5} />
                <span className="hidden sm:inline">Connect to Trade</span>
              </>
            )}
          </motion.button>

          {/* Open Trade - Merchant initiates trade */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (!solanaWallet.connected) {
                setShowWalletModal(true);
              } else {
                setShowOpenTradeModal(true);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span className="hidden sm:inline">Open Trade</span>
          </motion.button>

          <div className="flex-1" />

          {/* Quick Stats */}
          <div className="hidden lg:flex items-center gap-1.5">
            {/* Total Earned - Inline with animation */}
            <motion.div
              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20"
              title="Total Earned Today"
              whileHover={{ scale: 1.02, borderColor: "rgba(16, 185, 129, 0.4)" }}
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400">
                $<AnimatedCounter value={Math.round(todayEarnings + pendingEarnings)} />
              </span>
            </motion.div>

            {/* USDT Balance */}
            <motion.button
              onClick={() => setShowWalletModal(true)}
              className="flex items-center gap-1 px-2 py-1 bg-[#26A17B]/10 rounded-md border border-[#26A17B]/20 hover:bg-[#26A17B]/20 transition-colors"
              title={solanaWallet.connected ? "USDT Balance" : "Connect Wallet"}
              whileHover={{ scale: 1.02 }}
            >
              <span className="text-[11px] font-mono text-[#26A17B]">
                {solanaWallet.connected && solanaWallet.usdtBalance !== null
                  ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDT`
                  : "Connect"}
              </span>
            </motion.button>

            {/* Volume with mini sparkline */}
            <motion.div
              className="flex items-center gap-2 px-2.5 py-1 bg-white/[0.03] rounded-md border border-white/[0.06]"
              title="Total Volume Today"
              whileHover={{ scale: 1.02, borderColor: "rgba(255, 255, 255, 0.12)" }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] text-gray-500 leading-none">VOL</span>
                <span className="text-[11px] font-mono text-gray-300 leading-none">${totalTradedVolume.toLocaleString()}</span>
              </div>
              <div className="w-12 h-4">
                <MiniSparkline
                  data={[...orders.slice(-8).map(o => o.amount), totalTradedVolume / 10]}
                  color="cyan"
                  height={16}
                />
              </div>
            </motion.div>

            {/* Activity with live pulse */}
            <motion.div
              className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 rounded-md border border-purple-500/20"
              title="Active Orders"
              whileHover={{ scale: 1.02 }}
            >
              <div className="relative">
                <BarChart3 className="w-3 h-3 text-purple-400" />
                {pendingOrders.length > 0 && (
                  <motion.div
                    className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-purple-400 rounded-full"
                    animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
              </div>
              <span className="text-[11px] font-mono text-purple-400">{pendingOrders.length + activeOrders.length + ongoingOrders.length}</span>
            </motion.div>
          </div>

          {/* Online Status */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-emerald-500"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-[10px] text-emerald-400 font-medium">Online</span>
          </div>

          {/* Wallet & Logout Button */}
          {solanaWallet.walletAddress && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-[#151515] rounded-md border border-white/[0.04]">
              <Wallet className="w-3 h-3 text-gray-500" />
              <span className="text-[10px] text-gray-400 font-mono">
                {solanaWallet.walletAddress.slice(0, 4)}...{solanaWallet.walletAddress.slice(-4)}
              </span>
            </div>
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 rounded-md border border-red-500/20 hover:bg-red-500/20 transition-colors group"
            title="Disconnect wallet & logout"
          >
            <LogOut className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-400 font-medium">Logout</span>
          </motion.button>

          {/* Message History */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowMessageHistory(!showMessageHistory)}
            className="p-1.5 bg-[#151515] rounded-md border border-white/[0.04] relative group"
            title="Message History"
          >
            <MessageCircle className="w-4 h-4 text-gray-400 group-hover:text-emerald-400" />
          </motion.button>

          {/* Analytics */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowAnalytics(!showAnalytics)}
            className="p-1.5 bg-[#151515] rounded-md border border-white/[0.04] relative group"
            title="Analytics"
          >
            <TrendingUp className="w-4 h-4 text-gray-400 group-hover:text-cyan-400" />
          </motion.button>

          {/* Notifications */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-1.5 bg-[#151515] rounded-md border border-white/[0.04] relative"
            >
              <Bell className="w-4 h-4 text-gray-400" />
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 border border-white/40 rounded-full text-[8px] font-bold flex items-center justify-center text-white bg-[#0a0a0a]">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </motion.button>

            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-72 bg-[#151515] rounded-xl border border-white/[0.08] shadow-2xl overflow-hidden"
                >
                  <div className="p-3 border-b border-white/[0.04] flex items-center justify-between">
                    <p className="text-xs font-semibold">Notifications</p>
                    <button className="text-[10px] text-white">Mark all read</button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.map(notif => (
                      <div
                        key={notif.id}
                        className={`px-3 py-2.5 border-b border-white/[0.02] hover:bg-white/[0.02] cursor-pointer ${
                          !notif.read ? "bg-white/[0.05]" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-2 h-2 rounded-full mt-1 ${
                            notif.type === "order" ? "border border-white/40" :
                            notif.type === "complete" ? "bg-emerald-500" : "bg-amber-500"
                          }`} />
                          <div className="flex-1">
                            <p className="text-xs text-gray-300">{notif.message}</p>
                            <p className="text-[10px] text-gray-600 mt-0.5">{notif.time}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Wallet Connect Button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowWalletModal(true)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
              solanaWallet.connected
                ? 'bg-[#26A17B]/10 border-[#26A17B]/30 hover:bg-[#26A17B]/20'
                : 'bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20'
            }`}
          >
            {solanaWallet.connected ? (
              <>
                <div className="w-2 h-2 rounded-full bg-[#26A17B] animate-pulse" />
                <span className="text-xs font-medium text-[#26A17B] hidden sm:inline">
                  {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                </span>
                <span className="text-xs font-bold text-[#26A17B]">
                  {solanaWallet.usdtBalance !== null
                    ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '...'}
                  <span className="text-[10px] ml-0.5">USDT</span>
                </span>
              </>
            ) : (
              <>
                <Wallet className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-medium text-purple-400">Connect Wallet</span>
              </>
            )}
          </motion.button>

          {/* Profile */}
          <div className="flex items-center gap-2 pl-2 border-l border-white/[0.08]">
            <div className="w-7 h-7 rounded-full border border-white/20 flex items-center justify-center text-sm">
              {(merchantInfo?.username || merchantInfo?.display_name)?.charAt(0)?.toUpperCase() || '🐋'}
            </div>
            <div className="hidden sm:block">
              <p className="text-[11px] font-medium">{merchantInfo?.username || merchantInfo?.display_name || merchantInfo?.business_name || 'Merchant'}</p>
              <p className="text-[9px] text-gray-500">{merchantInfo?.rating?.toFixed(2) || '5.00'}★</p>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Stats Bar - Shows on mobile only */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-[#0d0d0d] border-b border-white/[0.06]">
        {/* Total Earned - Inline */}
        <div className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20 shrink-0">
          <DollarSign className="w-3 h-3 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-400">${Math.round(todayEarnings + pendingEarnings)}</span>
        </div>

        {/* USDT Balance */}
        <button
          onClick={() => setShowWalletModal(true)}
          className="flex items-center gap-1 px-2 py-1 bg-[#26A17B]/10 rounded-md border border-[#26A17B]/20 shrink-0"
        >
          <span className="text-[11px] font-mono text-[#26A17B]">
            {solanaWallet.connected && solanaWallet.usdtBalance !== null
              ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
              : "—"}
          </span>
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.03] rounded-md shrink-0">
          <span className="text-[10px] font-mono text-gray-400">${totalTradedVolume.toLocaleString()}</span>
        </div>

        <div className="flex-1" />

        {/* Notifications */}
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative p-1.5 bg-white/[0.04] rounded-md shrink-0"
        >
          <Bell className="w-3.5 h-3.5 text-gray-400" />
          {notifications.filter(n => !n.read).length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] font-bold flex items-center justify-center text-white">
              {notifications.filter(n => !n.read).length}
            </span>
          )}
        </button>
      </div>

      {/* Main Layout: Content + Sidebar */}
      <div className="flex-1 flex overflow-hidden w-full pb-16 md:pb-0">
        {/* Main Content */}
        <main className="flex-1 p-3 md:p-4 overflow-auto relative z-10">
          {/* No Active Offers Warning */}
          {activeOffers.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-400">No Active Corridors</p>
                  <p className="text-xs text-amber-400/70 mt-1">
                    You need to open a corridor to receive orders from users. Click &quot;Open Corridor&quot; to create one.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-3 py-1.5 bg-amber-500/20 text-amber-400 text-xs font-medium rounded-lg hover:bg-amber-500/30 transition-colors"
                >
                  Open Corridor
                </button>
              </div>
            </motion.div>
          )}

          {/* Desktop: Grid layout, Mobile: Single view based on mobileView state */}
          <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {/* Column 1: New Orders + Big Orders (stacked) */}
            <div className="flex flex-col h-[calc(100vh-80px)] gap-3">
              {/* Orders - takes remaining space or 50% when big orders visible */}
              <div className={`flex flex-col ${showBigOrderWidget && bigOrders.length > 0 ? 'h-1/2' : 'flex-1'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {/* Tab switcher */}
                  <div className="flex items-center bg-[#151515] rounded-lg p-0.5 border border-white/[0.04]">
                    <button
                      onClick={() => setOrderViewFilter('new')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        orderViewFilter === 'new'
                          ? 'bg-white text-black'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      New
                    </button>
                    <button
                      onClick={() => setOrderViewFilter('all')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        orderViewFilter === 'all'
                          ? 'bg-white text-black'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      All
                    </button>
                  </div>
                  {orderViewFilter === 'new' && (
                    <motion.div
                      className="w-2.5 h-2.5 rounded-full border border-white/40"
                      animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                  <span className="ml-auto text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
                    {orderViewFilter === 'new' ? pendingOrders.length : orders.length}
                  </span>
                </div>

                <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-white/[0.04] overflow-hidden min-h-0">
                  <div className="h-full overflow-y-auto p-2 space-y-2">
                    <AnimatePresence mode="popLayout">
                      {(orderViewFilter === 'new' ? pendingOrders : orders).length > 0 ? (
                        (orderViewFilter === 'new' ? pendingOrders : orders).map((order, i) => {
                          const profit = order.amount * TRADER_CUT_CONFIG.best; // 0.5% trader cut
                          return (
                            <motion.div
                              key={order.id}
                              layout
                              initial={{ opacity: 0, y: -8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: -30 }}
                              transition={{ delay: i * 0.02 }}
                              onClick={() => setSelectedOrderPopup(order)}
                              className="p-3 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-[#c9a962]/30 hover:bg-[#1d1d1d] transition-all cursor-pointer"
                            >
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleOpenChat(order.user, order.emoji, order.id); }}
                                  className="w-11 h-11 rounded-lg bg-[#252525] flex items-center justify-center text-xl shrink-0 hover:bg-[#2a2a2a] transition-colors"
                                >
                                  {order.emoji}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-sm font-medium text-gray-300 truncate">{order.user}</span>
                                    {order.isNew && (
                                      <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-medium">
                                        <Sparkles className="w-2.5 h-2.5" />
                                        NEW
                                      </span>
                                    )}
                                    {(order.tradeVolume || 0) >= TOP_1_PERCENT_THRESHOLD && (
                                      <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">
                                        <Crown className="w-2.5 h-2.5" />
                                        TOP 1%
                                      </span>
                                    )}
                                    {order.escrowTxHash && order.orderType === 'sell' && (
                                      <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-medium">
                                        <Shield className="w-2.5 h-2.5" />
                                        <Check className="w-2 h-2 -ml-0.5" />
                                        SECURED
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-bold">${order.amount.toLocaleString()}</span>
                                    <span className="text-xs text-gray-500">→</span>
                                    <span className="text-sm font-bold text-white">د.إ {Math.round(order.total).toLocaleString()}</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  {order.status === 'pending' ? (
                                    <>
                                      <div className="text-xs font-semibold text-emerald-400">+${Math.round(profit)}</div>
                                      <div className={`text-[11px] font-mono ${order.expiresIn < 30 ? "text-red-400" : "text-gray-500"}`}>
                                        {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                                      </div>
                                    </>
                                  ) : order.status === 'escrow' ? (
                                    <span className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full font-medium">
                                      Ongoing
                                    </span>
                                  ) : order.status === 'completed' ? (
                                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-medium flex items-center gap-1">
                                      <Check className="w-3 h-3" />
                                      Done
                                    </span>
                                  ) : order.status === 'cancelled' ? (
                                    <span className="text-[10px] px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full font-medium">
                                      Cancelled
                                    </span>
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 bg-gray-500/20 text-gray-400 rounded-full font-medium">
                                      {order.status}
                                    </span>
                                  )}
                                </div>
                                {order.escrowTxHash && order.orderType === 'sell' && (
                                  <a
                                    href={`https://explorer.solana.com/tx/${order.escrowTxHash}?cluster=devnet`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-md transition-colors shrink-0"
                                    title="View Escrow TX"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                                  </a>
                                )}
                                {order.status === 'pending' && (
                                  <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={(e) => { e.stopPropagation(); acceptOrder(order); }}
                                    className="px-3 py-1.5 border border-white/30 hover:border-white/50 hover:bg-white/5 rounded-md text-xs font-bold text-white transition-all shrink-0"
                                  >
                                    ⚡ GO
                                  </motion.button>
                                )}
                              </div>
                            </motion.div>
                          );
                        })
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                          <span className="text-xl mb-1 opacity-40">📭</span>
                          <p className="text-[10px] text-gray-500">
                            {orderViewFilter === 'new' ? 'waiting for orders...' : 'no orders yet'}
                          </p>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Big Orders - bottom half of column 1 */}
              <AnimatePresence>
                {showBigOrderWidget && bigOrders.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex flex-col h-1/2 min-h-0"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-white/60" />
                      <span className="text-sm font-semibold">Big Orders</span>
                      <span className="ml-auto text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
                        {bigOrders.length}
                      </span>
                      <button
                        onClick={() => setShowBigOrderWidget(false)}
                        className="p-1 hover:bg-white/[0.04] rounded transition-colors"
                      >
                        <X className="w-3 h-3 text-gray-500" />
                      </button>
                    </div>

                    <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-white/[0.04] overflow-hidden min-h-0">
                      <div className="h-full overflow-y-auto p-2 space-y-2">
                        {bigOrders.map((order, i) => (
                          <motion.div
                            key={order.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="p-3 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-[#c9a962]/30 hover:bg-[#1d1d1d] transition-all"
                          >
                            <div className="flex items-start gap-3">
                              <button
                                onClick={() => handleOpenChat(order.user, order.emoji)}
                                className="w-11 h-11 rounded-lg bg-[#252525] flex items-center justify-center text-xl shrink-0 hover:bg-[#2a2a2a] transition-colors"
                              >
                                {order.emoji}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className="text-sm font-medium text-gray-300 truncate">{order.user}</span>
                                  <span className="px-1.5 py-0.5 bg-emerald-500/20 rounded text-[10px] font-medium text-emerald-400">
                                    +{order.premium}%
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-bold">${order.amount.toLocaleString()}</span>
                                  <span className="text-xs text-gray-500">→</span>
                                  <span className="text-sm font-bold text-white">د.إ {Math.round(order.amount * 3.67).toLocaleString()}</span>
                                </div>
                              </div>
                              <div className="flex flex-col gap-1.5 shrink-0">
                                <motion.button
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => handleOpenChat(order.user, order.emoji)}
                                  className="px-3 py-1.5 border border-white/30 hover:border-white/50 hover:bg-white/5 rounded-md text-xs font-bold text-white transition-all"
                                >
                                  Chat
                                </motion.button>
                                <button
                                  onClick={() => dismissBigOrder(order.id)}
                                  className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] rounded-md text-[11px] font-medium text-gray-500 transition-all"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Column 2: Ongoing + Leaderboard (stacked) */}
            <div className="flex flex-col h-[calc(100vh-80px)] gap-3">
              {/* Ongoing - top portion */}
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold">Ongoing</span>
                  <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                    {ongoingOrders.length}
                  </span>
                </div>

                <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-white/[0.04] overflow-hidden min-h-0">
                  <div className="h-full overflow-y-auto p-2 space-y-2">
                    <AnimatePresence mode="popLayout">
                      {ongoingOrders.length > 0 ? (
                        ongoingOrders.map((order, i) => {
                          const timePercent = (order.expiresIn / 900) * 100;
                          const dbStatus = order.dbOrder?.status;
                          const canComplete = dbStatus === "payment_confirmed";
                          // For BUY orders: merchant can confirm & release when user has sent payment
                          // For SELL orders: merchant waits for user to release (merchant already paid)
                          const canConfirmPayment = dbStatus === "payment_sent" && order.orderType === "buy";
                          // For sell orders after merchant paid, show waiting for user
                          const waitingForUser = dbStatus === "payment_sent" && order.orderType === "sell";
                          // For sell orders in Ongoing section, merchant needs to click "I've Paid"
                          // After signing in Active, status is 'payment_sent' which maps to Ongoing
                          const canMarkPaid = dbStatus === "payment_sent" && order.orderType === "sell";
                          return (
                            <motion.div
                              key={order.id}
                              layout
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              transition={{ delay: i * 0.03 }}
                              className="p-2.5 bg-[#141414] rounded-lg border border-amber-500/10 hover:border-amber-500/20 transition-all"
                            >
                              {/* Row 1: User + Timer + Status */}
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                  <span className="text-[10px] font-bold text-amber-400">
                                    {order.user.slice(0, 2).toUpperCase()}
                                  </span>
                                </div>
                                <span className="text-sm font-medium text-white truncate flex-1">{order.user}</span>
                                <div className={`text-[11px] font-mono ${timePercent < 20 ? "text-red-400" : "text-amber-400/70"}`}>
                                  {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                                </div>
                                {waitingForUser ? (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded font-mono">RELEASING</span>
                                ) : canConfirmPayment ? (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-mono">PAID</span>
                                ) : canComplete ? (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-mono">READY</span>
                                ) : canMarkPaid ? (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/10 text-orange-400 rounded font-mono">SEND</span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded font-mono">LOCKED</span>
                                )}
                              </div>

                              {/* Row 2: Amount + Actions */}
                              <div className="flex items-center gap-2 pl-9">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-gray-400">{order.amount.toLocaleString()}</span>
                                    <ArrowRight className="w-3 h-3 text-gray-600" />
                                    <span className="text-sm font-bold text-white">{Math.round(order.total).toLocaleString()}</span>
                                    <span className="text-[10px] text-gray-500">AED</span>
                                  </div>
                                  {/* Show user's bank for sell orders waiting for merchant payment */}
                                  {canMarkPaid && order.userBankAccount && (
                                    <div className="mt-1 text-[10px] text-orange-400/80 font-mono truncate" title={order.userBankAccount}>
                                      → {order.userBankAccount}
                                    </div>
                                  )}
                                </div>

                                {/* Icon buttons */}
                                <div className="flex items-center gap-1">
                                  {/* Extension UI */}
                                  {extensionRequests.has(order.id) && extensionRequests.get(order.id)?.requestedBy === 'user' ? (
                                    <div className="flex gap-0.5">
                                      <button
                                        onClick={() => respondToExtension(order.id, true)}
                                        disabled={requestingExtension === order.id}
                                        className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded text-[10px] disabled:opacity-50"
                                        title={`Accept +${extensionRequests.get(order.id)?.extensionMinutes}min`}
                                      >
                                        <Check className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => respondToExtension(order.id, false)}
                                        disabled={requestingExtension === order.id}
                                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded disabled:opacity-50"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : timePercent < 30 && !extensionRequests.has(order.id) ? (
                                    <button
                                      onClick={() => requestExtension(order.id)}
                                      disabled={requestingExtension === order.id}
                                      className="p-1.5 hover:bg-orange-500/10 rounded transition-colors disabled:opacity-50"
                                      title="Request extension"
                                    >
                                      <Clock className={`w-3.5 h-3.5 ${requestingExtension === order.id ? 'animate-spin text-orange-400' : 'text-gray-500 hover:text-orange-400'}`} />
                                    </button>
                                  ) : null}
                                  <button
                                    onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                    className="p-1.5 hover:bg-white/[0.04] rounded transition-colors"
                                    title="Chat"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5 text-gray-500 hover:text-amber-400" />
                                  </button>
                                  <button
                                    onClick={() => openDisputeModal(order.id)}
                                    className="p-1.5 hover:bg-red-500/10 rounded transition-colors"
                                    title="Dispute"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5 text-gray-500 hover:text-red-400" />
                                  </button>
                                  {dbStatus === "escrowed" && order.orderType === "buy" && order.escrowCreatorWallet && (
                                    <button
                                      onClick={() => openCancelModal(order)}
                                      className="p-1.5 hover:bg-orange-500/10 rounded transition-colors"
                                      title="Cancel & Withdraw"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-gray-500 hover:text-orange-400" />
                                    </button>
                                  )}
                                </div>

                                {/* Action button */}
                                {canMarkPaid ? (
                                  <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => markPaymentSent(order)}
                                    disabled={markingDone}
                                    className="px-2.5 py-1.5 bg-orange-500 hover:bg-orange-400 rounded text-[11px] font-bold text-white disabled:opacity-50"
                                  >
                                    {markingDone ? '...' : "I've Paid"}
                                  </motion.button>
                                ) : waitingForUser ? (
                                  <span className="px-2.5 py-1.5 bg-blue-500/10 rounded text-[11px] font-mono text-blue-400">
                                    Waiting
                                  </span>
                                ) : canConfirmPayment ? (
                                  <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => openReleaseModal(order)}
                                    className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 rounded text-[11px] font-bold text-black"
                                  >
                                    Release
                                  </motion.button>
                                ) : canComplete ? (
                                  <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => completeOrder(order.id)}
                                    className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 rounded text-[11px] font-bold text-black"
                                  >
                                    Release
                                  </motion.button>
                                ) : dbStatus === "escrowed" && order.orderType === "buy" ? (
                                  <span className="px-2.5 py-1.5 bg-amber-500/10 rounded text-[11px] font-mono text-amber-400">
                                    Awaiting
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1.5 bg-white/[0.04] rounded text-[11px] font-mono text-gray-500">
                                    Waiting
                                  </span>
                                )}
                              </div>
                            </motion.div>
                          );
                        })
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                          <Lock className="w-6 h-6 mb-1 opacity-20" />
                          <p className="text-[10px] font-mono text-gray-500">No active escrows</p>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Active Orders - bottom 50% (accepted but waiting for escrow lock) */}
              <div className="flex flex-col h-1/2 min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-semibold text-blue-400">Active</span>
                  <span className="ml-auto text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-medium">
                    {activeOrders.length}
                  </span>
                </div>

                <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-white/[0.04] overflow-hidden min-h-0">
                  <div className="h-full overflow-y-auto p-2 space-y-2">
                    <AnimatePresence mode="popLayout">
                      {activeOrders.length > 0 ? (
                        activeOrders.map((order, i) => (
                          <motion.div
                            key={order.id}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ delay: i * 0.03 }}
                            className="p-2.5 bg-[#141414] rounded-lg border border-blue-500/10 hover:border-blue-500/20 transition-all"
                          >
                            {/* Row 1: User + Type */}
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-bold text-blue-400">
                                  {order.user.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                              <span className="text-sm font-medium text-white truncate flex-1">{order.user}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                order.orderType === 'buy'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-blue-500/10 text-blue-400'
                              }`}>
                                {order.orderType?.toUpperCase()}
                              </span>
                            </div>

                            {/* Row 2: Amount + Actions */}
                            <div className="flex items-center gap-2 pl-9">
                              <div className="flex-1 flex items-center gap-2">
                                <span className="text-xs font-mono text-gray-400">{order.amount.toLocaleString()}</span>
                                <ArrowRight className="w-3 h-3 text-gray-600" />
                                <span className="text-sm font-bold text-white">{Math.round(order.total).toLocaleString()}</span>
                                <span className="text-[10px] text-gray-500">AED</span>
                              </div>
                              <button
                                onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                className="p-1.5 hover:bg-white/[0.04] rounded transition-colors"
                                title="Chat"
                              >
                                <MessageCircle className="w-3.5 h-3.5 text-gray-500 hover:text-blue-400" />
                              </button>
                              {order.orderType === 'buy' && !order.escrowTxHash ? (
                                <motion.button
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => openEscrowModal(order)}
                                  className="px-2.5 py-1.5 bg-blue-500 hover:bg-blue-400 rounded text-[11px] font-bold text-white"
                                >
                                  Sign
                                </motion.button>
                              ) : order.orderType === 'sell' ? (
                                <motion.button
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => signAndProceed(order)}
                                  className="px-2.5 py-1.5 bg-blue-500 hover:bg-blue-400 rounded text-[11px] font-bold text-white"
                                >
                                  Sign
                                </motion.button>
                              ) : order.escrowTxHash ? (
                                <span className="px-2.5 py-1.5 bg-emerald-500/10 text-emerald-400 rounded text-[11px] font-mono">
                                  Signed
                                </span>
                              ) : (
                                <span className="px-2.5 py-1.5 bg-white/[0.04] rounded text-[11px] font-mono text-gray-500">
                                  Waiting
                                </span>
                              )}
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                          <Zap className="w-6 h-6 mb-1 opacity-20" />
                          <p className="text-[10px] font-mono text-gray-500">No active orders</p>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 3: Completed */}
            <div className="flex flex-col h-[calc(100vh-80px)]">
              <div className="flex items-center gap-2 mb-3">
                <Check className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold">Completed</span>
                <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                  {completedOrders.length}
                </span>
              </div>

              <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-white/[0.04] overflow-hidden">
                <div className="h-full overflow-y-auto p-2 space-y-2">
                  <AnimatePresence mode="popLayout">
                    {completedOrders.length > 0 ? (
                      completedOrders.map((order, i) => {
                        const profit = order.amount * TRADER_CUT_CONFIG.best; // 0.5% trader cut
                        return (
                          <motion.div
                            key={order.id}
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="p-2.5 bg-[#141414] rounded-lg border border-emerald-500/10 hover:border-emerald-500/20 transition-all"
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-bold text-emerald-400">
                                  {order.user.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                              <span className="text-sm font-medium text-white truncate flex-1">{order.user}</span>
                              <span className="text-xs font-mono text-gray-400">{order.amount.toLocaleString()}</span>
                              <span className="text-xs font-bold text-emerald-400">+${Math.round(profit)}</span>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                        <Check className="w-6 h-6 mb-1 opacity-20" />
                        <p className="text-[10px] font-mono text-gray-500">No completed trades</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

          </div>
        </main>

        {/* Right Sidebar - Notifications + Chat (50/50 split) */}
        <aside className="hidden lg:flex w-80 border-l border-white/[0.04] bg-[#0d0d0d]/50 flex-col">
          {/* Top Half - Notifications */}
          <div className="h-1/2 flex flex-col border-b border-white/[0.08]">
            <div className="h-12 px-4 flex items-center gap-2 border-b border-white/[0.04] shrink-0">
              <Bell className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold">Notifications</span>
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="ml-auto w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length > 0 ? (
                <div className="p-2 space-y-1.5">
                  {notifications.map((notif) => (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                        notif.read
                          ? 'bg-[#151515] border-white/[0.04] opacity-60'
                          : 'bg-[#1a1a1a] border-white/[0.08] hover:border-white/[0.12]'
                      }`}
                      onClick={() => markNotificationRead(notif.id)}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                          notif.type === 'order' ? 'bg-emerald-500/20' :
                          notif.type === 'escrow' ? 'bg-amber-500/20' :
                          notif.type === 'payment' ? 'bg-blue-500/20' :
                          notif.type === 'dispute' ? 'bg-red-500/20' :
                          'bg-white/[0.08]'
                        }`}>
                          {notif.type === 'order' ? '📥' :
                           notif.type === 'escrow' ? '🔒' :
                           notif.type === 'payment' ? '💸' :
                           notif.type === 'dispute' ? '⚠️' :
                           notif.type === 'complete' ? '✅' : '🔔'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 leading-tight">{notif.message}</p>
                          <p className="text-[10px] text-gray-600 mt-0.5">{notif.time}</p>
                        </div>
                        {!notif.read && (
                          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                  <Bell className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-gray-500">No notifications</p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Half - Chat */}
          <div className="h-1/2 flex flex-col">
            {/* Chat Header */}
            <div className="h-12 px-4 flex items-center gap-2 border-b border-white/[0.04] shrink-0">
              <MessageCircle className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold">Messages</span>
              {totalUnread > 0 && (
                <span className="ml-auto w-5 h-5 border border-white/30 rounded-full text-[10px] font-bold flex items-center justify-center text-white/80">
                  {totalUnread}
                </span>
              )}
            </div>

            {/* Chat List / Active Chat */}
            <div className="flex-1 flex flex-col min-h-0">
            {activeChat ? (
              // Active Chat View
              <>
                {/* Chat User Header */}
                <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setActiveChatId(null)}
                    className="p-1.5 hover:bg-white/[0.04] rounded transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5 text-gray-500" />
                  </button>
                  <div className="w-10 h-10 rounded-full bg-[#1f1f1f] flex items-center justify-center text-xl">
                    {activeChat.emoji}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{activeChat.user}</p>
                    <p className="text-xs text-emerald-500">online</p>
                  </div>
                  <button
                    onClick={() => { closeChat(activeChat.id); setActiveChatId(null); }}
                    className="p-1.5 hover:bg-white/[0.04] rounded transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {activeChat.messages.map((msg) => {
                    // Parse dispute/resolution messages from JSON content
                    if (msg.messageType === 'dispute') {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div className="w-full max-w-[90%] bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4 text-red-400" />
                                <span className="text-xs font-semibold text-red-400">Dispute Opened</span>
                              </div>
                              <p className="text-xs text-white mb-1">
                                <span className="text-gray-400">Reason:</span> {data.reason?.replace(/_/g, ' ')}
                              </p>
                              {data.description && (
                                <p className="text-[11px] text-gray-400">{data.description}</p>
                              )}
                              <p className="text-[10px] text-gray-500 mt-2">
                                Compliance team will review this case
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
                            <div className="w-full max-w-[90%] bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Shield className="w-4 h-4 text-blue-400" />
                                <span className="text-xs font-semibold text-blue-400">
                                  {data.type === 'resolution_proposed' ? 'Resolution Proposed' : 'Resolution Finalized'}
                                </span>
                              </div>
                              <p className="text-xs text-white mb-1">
                                <span className="text-gray-400">Decision:</span> {data.resolution?.replace(/_/g, ' ')}
                              </p>
                              {data.notes && (
                                <p className="text-[11px] text-gray-400 mb-2">{data.notes}</p>
                              )}
                              {data.type === 'resolution_proposed' && activeChat.orderId && !disputeInfo?.merchant_confirmed && (
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => activeChat.orderId && respondToResolution('reject', activeChat.orderId)}
                                    disabled={isRespondingToResolution}
                                    className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-[#1f1f1f] text-white disabled:opacity-50"
                                  >
                                    Reject
                                  </button>
                                  <button
                                    onClick={() => activeChat.orderId && respondToResolution('accept', activeChat.orderId)}
                                    disabled={isRespondingToResolution}
                                    className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-500 text-white disabled:opacity-50"
                                  >
                                    Accept
                                  </button>
                                </div>
                              )}
                              {disputeInfo?.merchant_confirmed && !disputeInfo?.user_confirmed && (
                                <p className="text-[10px] text-emerald-400 mt-2">
                                  You accepted. Waiting for user confirmation...
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
                            <div className="w-full max-w-[90%] bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Check className="w-4 h-4 text-emerald-400" />
                                <span className="text-xs font-semibold text-emerald-400">Resolution Finalized</span>
                              </div>
                              <p className="text-xs text-white">
                                Decision: {data.resolution?.replace(/_/g, ' ')}
                              </p>
                              <p className="text-[10px] text-gray-500 mt-2">
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
                            <div className={`px-3 py-1.5 rounded-lg text-[11px] ${
                              isAccepted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                              {data.party === 'merchant' ? 'You' : 'User'} {isAccepted ? 'accepted' : 'rejected'} the resolution
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
                          className={`max-w-[80%] px-4 py-2 rounded-xl text-sm ${
                            msg.from === "me"
                              ? "border border-white/30 text-white/90"
                              : msg.from === "system"
                              ? "bg-[#252525] text-gray-400 text-xs"
                              : "bg-[#1f1f1f] text-gray-200"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}

                  {/* Show pending resolution if dispute exists and has a proposal */}
                  {activeChat.orderId && disputeInfo?.status === 'pending_confirmation' && disputeInfo.proposed_resolution && !activeChat.messages.some(m => m.messageType === 'resolution') && (
                    <div className="flex justify-center">
                      <div className="w-full max-w-[90%] bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Shield className="w-4 h-4 text-blue-400" />
                          <span className="text-xs font-semibold text-blue-400">Resolution Proposed</span>
                        </div>
                        <p className="text-xs text-white mb-1">
                          <span className="text-gray-400">Decision:</span> {disputeInfo.proposed_resolution.replace(/_/g, ' ')}
                        </p>
                        {disputeInfo.resolution_notes && (
                          <p className="text-[11px] text-gray-400 mb-2">{disputeInfo.resolution_notes}</p>
                        )}
                        {!disputeInfo.merchant_confirmed && (
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => activeChat.orderId && respondToResolution('reject', activeChat.orderId)}
                              disabled={isRespondingToResolution}
                              className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-[#1f1f1f] text-white disabled:opacity-50"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => activeChat.orderId && respondToResolution('accept', activeChat.orderId)}
                              disabled={isRespondingToResolution}
                              className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-500 text-white disabled:opacity-50"
                            >
                              Accept
                            </button>
                          </div>
                        )}
                        {disputeInfo.merchant_confirmed && !disputeInfo.user_confirmed && (
                          <p className="text-[10px] text-emerald-400 mt-2">
                            You accepted. Waiting for user confirmation...
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {activeChat.isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-[#1f1f1f] px-3 py-2 rounded-xl flex items-center gap-1">
                        <motion.span className="w-1.5 h-1.5 bg-gray-400 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0 }} />
                        <motion.span className="w-1.5 h-1.5 bg-gray-400 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} />
                        <motion.span className="w-1.5 h-1.5 bg-gray-400 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-3 border-t border-white/[0.04] shrink-0">
                  <div className="flex gap-2">
                    <input
                      ref={(el) => { chatInputRefs.current[activeChat.id] = el; }}
                      type="text"
                      placeholder="type a message..."
                      className="flex-1 bg-[#1f1f1f] rounded-lg px-4 py-2.5 outline-none text-sm placeholder:text-gray-600"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.currentTarget.value.trim()) {
                          sendMessage(activeChat.id, e.currentTarget.value);
                          e.currentTarget.value = "";
                          playSound('send');
                        }
                      }}
                    />
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => {
                        const input = chatInputRefs.current[activeChat.id];
                        if (input && input.value.trim()) {
                          sendMessage(activeChat.id, input.value);
                          input.value = "";
                          playSound('send');
                        }
                      }}
                      className="w-10 h-10 rounded-lg border border-white/30 hover:border-white/50 hover:bg-white/5 flex items-center justify-center transition-all"
                    >
                      <Send className="w-4 h-4 text-white/80" />
                    </motion.button>
                  </div>
                </div>
              </>
            ) : (
              // Chat List View
              <div className="flex-1 overflow-y-auto">
                {chatWindows.length > 0 ? (
                  chatWindows.map((chat) => (
                    <motion.button
                      key={chat.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setActiveChatId(chat.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] border-b border-white/[0.02] transition-colors text-left"
                    >
                      <div className="relative">
                        <div className="w-11 h-11 rounded-full bg-[#1f1f1f] flex items-center justify-center text-xl">
                          {chat.emoji}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#0d0d0d]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{chat.user}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {chat.messages[chat.messages.length - 1]?.text || "Start chatting..."}
                        </p>
                      </div>
                      {chat.unread > 0 && (
                        <span className="w-6 h-6 border border-white/30 rounded-full text-xs font-bold flex items-center justify-center text-white/80">
                          {chat.unread}
                        </span>
                      )}
                    </motion.button>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-12 text-gray-600">
                    <Users className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm text-gray-500">No active chats</p>
                    <p className="text-xs text-gray-600 mt-1">Click a user to start chatting</p>
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        </aside>
      </div>

      {/* Mobile View Content - Shows on mobile only */}
      <div className="md:hidden flex-1 overflow-hidden">
        <main className="h-[calc(100vh-180px)] overflow-auto p-3">
          {/* Mobile: Orders View */}
          {mobileView === 'orders' && (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <motion.div
                    className="w-2 h-2 rounded-full bg-white/60"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <span className="text-xs font-mono text-gray-400 uppercase tracking-wide">Pending</span>
                </div>
                <span className="text-xs font-mono text-gray-400">{pendingOrders.length}</span>
              </div>

              {pendingOrders.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {pendingOrders.map((order) => (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-2 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Main Row */}
                      <div className="flex items-center gap-3">
                        {/* User Avatar - initials */}
                        <div className="w-8 h-8 rounded-md bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                          <span className="text-xs font-bold text-gray-400">
                            {order.user.slice(0, 2).toUpperCase()}
                          </span>
                        </div>

                        {/* User & Amount */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">{order.user}</span>
                            {order.orderType && (
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                order.orderType === 'buy'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-blue-500/10 text-blue-400'
                              }`}>
                                {order.orderType.toUpperCase()}
                              </span>
                            )}
                            {order.isNew && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded">NEW</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-mono text-gray-400">
                              {order.amount.toLocaleString()} <span className="text-gray-600">USDC</span>
                            </span>
                            <ArrowRight className="w-3 h-3 text-gray-600" />
                            <span className="text-xs font-mono text-gray-400">
                              {order.total.toLocaleString()} <span className="text-gray-600">AED</span>
                            </span>
                          </div>
                        </div>

                        {/* Timer & Earnings */}
                        <div className="text-right">
                          <div className="text-[10px] font-mono text-emerald-400">+${Math.round(order.amount * 0.005)}</div>
                          <div className={`text-xs font-mono ${order.expiresIn < 30 ? "text-red-400" : "text-gray-500"}`}>
                            {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                          </div>
                        </div>
                      </div>

                      {/* Escrow TX Link for sell orders */}
                      {order.escrowTxHash && order.orderType === 'sell' && (
                        <a
                          href={`https://explorer.solana.com/tx/${order.escrowTxHash}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center gap-1.5 mt-2 ml-11 py-1.5 bg-emerald-500/10 rounded-lg text-[10px] font-mono text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        >
                          <Shield className="w-3 h-3" />
                          <span>Escrow Secured</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}

                      {/* Action Row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-11">
                        <motion.button
                          whileTap={{ scale: 0.98 }}
                          onClick={() => acceptOrder(order)}
                          className="flex-1 h-9 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Go
                        </motion.button>
                        <button
                          onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                          className="h-9 w-9 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                  <Activity className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-gray-500 font-mono">Waiting for orders...</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Active View (accepted, awaiting escrow) */}
          {mobileView === 'active' && (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-mono text-gray-400 uppercase tracking-wide">Active</span>
                </div>
                <span className="text-xs font-mono text-blue-400">{activeOrders.length}</span>
              </div>

              {activeOrders.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {activeOrders.map((order) => (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-2 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Main Row */}
                      <div className="flex items-center gap-3">
                        {/* User Avatar - initials */}
                        <div className="w-8 h-8 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                          <span className="text-xs font-bold text-blue-400">
                            {order.user.slice(0, 2).toUpperCase()}
                          </span>
                        </div>

                        {/* User & Amount */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">{order.user}</span>
                            {order.orderType && (
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                order.orderType === 'buy'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-blue-500/10 text-blue-400'
                              }`}>
                                {order.orderType.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-mono text-gray-400">
                              {order.amount.toLocaleString()} <span className="text-gray-600">USDC</span>
                            </span>
                            <ArrowRight className="w-3 h-3 text-gray-600" />
                            <span className="text-xs font-mono text-gray-400">
                              {order.total.toLocaleString()} <span className="text-gray-600">AED</span>
                            </span>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="flex items-center gap-1.5 text-blue-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                          <span className="text-[10px] font-mono uppercase">Waiting</span>
                        </div>
                      </div>

                      {/* Action Row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-11">
                        {order.orderType === 'buy' && !order.escrowTxHash ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openEscrowModal(order)}
                            className="flex-1 h-9 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg text-xs font-medium text-blue-400 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            Lock Escrow
                          </motion.button>
                        ) : order.escrowTxHash ? (
                          <div className="flex-1 h-9 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs font-mono text-emerald-400 flex items-center justify-center gap-1.5">
                            <Check className="w-3.5 h-3.5" />
                            Escrow Locked
                          </div>
                        ) : (
                          <div className="flex-1 h-9 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs font-mono text-gray-500 flex items-center justify-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Awaiting user escrow
                          </div>
                        )}
                        <button
                          onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                          className="h-9 w-9 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                  <Zap className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-gray-500 font-mono">No active orders</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Escrow View */}
          {mobileView === 'escrow' && (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-mono text-gray-400 uppercase tracking-wide">Escrow</span>
                </div>
                <span className="text-xs font-mono text-amber-400">{ongoingOrders.length}</span>
              </div>

              {ongoingOrders.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {ongoingOrders.map((order) => {
                    const mobileDbStatus = order.dbOrder?.status;
                    const mobileCanComplete = mobileDbStatus === "payment_confirmed";
                    const mobileCanConfirmPayment = mobileDbStatus === "payment_sent" && order.orderType === "buy";
                    const mobileWaitingForUser = false; // Simplified flow - no waiting state
                    const mobileCanMarkPaid = mobileDbStatus === "payment_sent" && order.orderType === "sell";

                    return (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-2 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Main Row */}
                      <div className="flex items-center gap-3">
                        {/* User Avatar - initials instead of emoji */}
                        <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                          <span className="text-xs font-bold text-amber-400">
                            {order.user.slice(0, 2).toUpperCase()}
                          </span>
                        </div>

                        {/* User & Amount */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">{order.user}</span>
                            {order.orderType && (
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                order.orderType === 'buy'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-blue-500/10 text-blue-400'
                              }`}>
                                {order.orderType.toUpperCase()}
                              </span>
                            )}
                            {/* Status badge */}
                            {mobileCanMarkPaid && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/10 text-orange-400 rounded font-mono">SEND</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-mono text-gray-400">
                              {order.amount.toLocaleString()} <span className="text-gray-600">USDC</span>
                            </span>
                            <ArrowRight className="w-3 h-3 text-gray-600" />
                            <span className="text-xs font-mono text-gray-400">
                              {order.total.toLocaleString()} <span className="text-gray-600">AED</span>
                            </span>
                          </div>
                          {/* Show user's bank account for sell orders waiting for payment */}
                          {mobileCanMarkPaid && order.userBankAccount && (
                            <div className="mt-1 text-[10px] text-orange-400/80 font-mono truncate">
                              → {order.userBankAccount}
                            </div>
                          )}
                        </div>

                        {/* Timer */}
                        <div className="flex items-center gap-1.5 text-amber-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="text-xs font-mono">
                            {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                      </div>

                      {/* Action Row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-11">
                        {mobileCanMarkPaid ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => markPaymentSent(order)}
                            disabled={markingDone}
                            className="flex-1 h-9 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg text-xs font-medium text-orange-400 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            I&apos;ve Paid
                          </motion.button>
                        ) : mobileWaitingForUser ? (
                          <span className="flex-1 h-9 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs font-mono text-amber-400 flex items-center justify-center">
                            Awaiting user
                          </span>
                        ) : mobileCanConfirmPayment ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-9 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs font-medium text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Confirm & Release
                          </motion.button>
                        ) : mobileCanComplete ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-9 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs font-medium text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Release
                          </motion.button>
                        ) : (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-9 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs font-medium text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Release
                          </motion.button>
                        )}
                        <button
                          onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                          className="h-9 w-9 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-gray-400" />
                        </button>
                        <button
                          onClick={() => {
                            setDisputeOrderId(order.id);
                            setShowDisputeModal(true);
                          }}
                          className="h-9 w-9 border border-white/10 hover:border-red-500/30 rounded-lg flex items-center justify-center transition-colors group"
                        >
                          <AlertTriangle className="w-4 h-4 text-gray-400 group-hover:text-red-400" />
                        </button>
                        {order.dbOrder?.status === "escrowed" && order.orderType === "buy" && order.escrowCreatorWallet && (
                          <button
                            onClick={() => openCancelModal(order)}
                            className="h-9 w-9 border border-white/10 hover:border-orange-500/30 rounded-lg flex items-center justify-center transition-colors group"
                            title="Cancel & Withdraw"
                          >
                            <RotateCcw className="w-4 h-4 text-gray-400 group-hover:text-orange-400" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )})}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                  <Lock className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-gray-500 font-mono">No active escrows</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Chat View */}
          {mobileView === 'chat' && (
            <div className="h-full flex flex-col -m-3">
              {activeChat ? (
                <>
                  {/* Chat Header */}
                  <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3 bg-[#0d0d0d]">
                    <button
                      onClick={() => setMobileView('orders')}
                      className="p-2 hover:bg-white/[0.04] rounded-lg"
                    >
                      <ChevronLeft className="w-5 h-5 text-gray-400" />
                    </button>
                    <div className="w-10 h-10 rounded-full bg-[#1f1f1f] flex items-center justify-center text-xl">
                      {activeChat.emoji}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{activeChat.user}</p>
                      <p className="text-xs text-emerald-500">online</p>
                    </div>
                    <button
                      onClick={() => { closeChat(activeChat.id); setActiveChatId(null); }}
                      className="p-2 hover:bg-white/[0.04] rounded-lg"
                    >
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0a0a0a]">
                    {activeChat.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                            msg.from === "me"
                              ? "bg-[#c9a962] text-black"
                              : msg.from === "system"
                                ? "bg-white/[0.04] text-gray-400"
                                : "bg-[#1f1f1f] text-gray-200"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <div className="p-3 bg-[#0d0d0d] border-t border-white/[0.04]">
                    <div className="flex gap-2">
                      <input
                        ref={(el) => { chatInputRefs.current[activeChat.id] = el; }}
                        type="text"
                        placeholder="Type a message..."
                        className="flex-1 bg-[#1f1f1f] rounded-xl px-4 py-3 outline-none text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value.trim()) {
                            sendMessage(activeChat.id, e.currentTarget.value);
                            e.currentTarget.value = "";
                            playSound('send');
                          }
                        }}
                      />
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          const input = chatInputRefs.current[activeChat.id];
                          if (input && input.value.trim()) {
                            sendMessage(activeChat.id, input.value);
                            input.value = "";
                            playSound('send');
                          }
                        }}
                        className="w-12 h-12 rounded-xl bg-[#c9a962] flex items-center justify-center"
                      >
                        <Send className="w-5 h-5 text-black" />
                      </motion.button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500">No active chat</p>
                  <p className="text-xs text-gray-600 mt-1">Click a user to start chatting</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Stats View */}
          {mobileView === 'stats' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">Trading Stats</h2>
                <button
                  onClick={() => setShowAnalytics(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-medium"
                >
                  <TrendingUp className="w-3 h-3" />
                  Full Analytics
                </button>
              </div>

              {/* Wallet Balance Card */}
              <button
                onClick={() => setShowWalletModal(true)}
                className="w-full p-4 bg-[#26A17B]/10 rounded-xl border border-[#26A17B]/30 text-left"
              >
                <p className="text-xs text-[#26A17B] mb-1">USDT Balance</p>
                <p className="text-xl font-bold text-[#26A17B]">
                  {solanaWallet.connected && solanaWallet.usdtBalance !== null
                    ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                    : "Connect Wallet"}
                </p>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-[#151515] rounded-xl border border-white/[0.04]">
                  <p className="text-xs text-gray-500 mb-1">Today&apos;s Volume</p>
                  <p className="text-xl font-bold">${totalTradedVolume.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                  <p className="text-xs text-emerald-400 mb-1">Earnings</p>
                  <p className="text-xl font-bold text-emerald-400">+${Math.round(todayEarnings)}</p>
                </div>
                <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                  <p className="text-xs text-amber-400 mb-1">Pending</p>
                  <p className="text-xl font-bold text-amber-400">+${Math.round(pendingEarnings)}</p>
                </div>
                <div className="p-4 bg-[#151515] rounded-xl border border-white/[0.04]">
                  <p className="text-xs text-gray-500 mb-1">Trades</p>
                  <p className="text-xl font-bold">{completedOrders.length}</p>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wide mb-3">Recent Completed</h3>
                <div className="space-y-1 divide-y divide-white/[0.04]">
                  {completedOrders.slice(0, 5).map((order) => (
                    <div key={order.id} className="flex items-center gap-3 py-2.5">
                      <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-emerald-400">
                          {order.user.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{order.user}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono text-gray-400">${order.amount.toLocaleString()}</span>
                      </div>
                      <Check className="w-4 h-4 text-emerald-400" />
                    </div>
                  ))}
                  {completedOrders.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-8 font-mono">No completed trades yet</p>
                  )}
                </div>
              </div>

              {/* Resolved Disputes */}
              {resolvedDisputes.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold mb-3">Resolved Disputes</h3>
                  <div className="space-y-2">
                    {resolvedDisputes.map(dispute => (
                      <div key={dispute.id} className="p-3 bg-[#151515] rounded-xl border border-white/[0.04]">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-white">#{dispute.orderNumber}</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded-full ${
                              dispute.resolvedInFavorOf === 'merchant'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : dispute.resolvedInFavorOf === 'user'
                                ? 'bg-red-500/10 text-red-400'
                                : 'bg-blue-500/10 text-blue-400'
                            }`}>
                              {dispute.resolvedInFavorOf === 'merchant' ? 'Won' :
                               dispute.resolvedInFavorOf === 'user' ? 'Lost' : 'Split'}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500">
                            {new Date(dispute.resolvedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400">vs {dispute.otherPartyName}</p>
                          <p className="text-sm font-semibold text-white">
                            ${dispute.cryptoAmount.toLocaleString()}
                          </p>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 capitalize">
                          {dispute.reason.replace(/_/g, ' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Account Section */}
              <div className="mt-8 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wide mb-3">Account</h3>
                <div className="space-y-2">
                  {/* Merchant Info */}
                  <div className="p-3 bg-[#151515] rounded-xl border border-white/[0.04]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center text-lg">
                        {(merchantInfo?.username || merchantInfo?.display_name)?.charAt(0)?.toUpperCase() || '🐋'}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{merchantInfo?.username || merchantInfo?.display_name || 'Merchant'}</p>
                        <p className="text-xs text-gray-500">{merchantInfo?.rating?.toFixed(2) || '5.00'}★ · {merchantInfo?.total_trades || 0} trades</p>
                      </div>
                    </div>
                  </div>

                  {/* Logout Button */}
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 rounded-xl border border-red-500/20 hover:bg-red-500/20 transition-colors"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-medium text-red-400">Disconnect & Logout</span>
                  </motion.button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#0a0a0a] border-t border-white/[0.04] px-2 py-2 pb-safe z-50">
        <div className="flex items-center justify-around">
          <button
            onClick={() => setMobileView('orders')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'orders' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Sparkles className={`w-5 h-5 ${mobileView === 'orders' ? 'text-[#c9a962]' : 'text-gray-500'}`} />
              {pendingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {pendingOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'orders' ? 'text-white' : 'text-gray-500'}`}>New</span>
          </button>

          <button
            onClick={() => setMobileView('active')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'active' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Zap className={`w-5 h-5 ${mobileView === 'active' ? 'text-blue-400' : 'text-gray-500'}`} />
              {activeOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {activeOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'active' ? 'text-white' : 'text-gray-500'}`}>Active</span>
          </button>

          <button
            onClick={() => setMobileView('escrow')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'escrow' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Lock className={`w-5 h-5 ${mobileView === 'escrow' ? 'text-amber-400' : 'text-gray-500'}`} />
              {ongoingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {ongoingOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'escrow' ? 'text-white' : 'text-gray-500'}`}>Escrow</span>
          </button>

          <button
            onClick={() => setMobileView('chat')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'chat' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <MessageCircle className={`w-5 h-5 ${mobileView === 'chat' ? 'text-[#c9a962]' : 'text-gray-500'}`} />
              {totalUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#c9a962] text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalUnread}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'chat' ? 'text-white' : 'text-gray-500'}`}>Chat</span>
          </button>

          <button
            onClick={() => setMobileView('stats')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'stats' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <Activity className={`w-5 h-5 ${mobileView === 'stats' ? 'text-emerald-400' : 'text-gray-500'}`} />
            <span className={`text-[10px] ${mobileView === 'stats' ? 'text-white' : 'text-gray-500'}`}>Stats</span>
          </button>
        </div>
      </nav>

      {/* Create Corridor Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => setShowCreateModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center">
                      <ArrowLeftRight className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Open Corridor</h2>
                      <p className="text-[11px] text-gray-500">Set your trading parameters</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Wallet Balance Banner */}
                  <div className="bg-[#26A17B]/10 border border-[#26A17B]/30 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-[#26A17B] flex items-center justify-center">
                          <span className="text-white text-xs font-bold">₮</span>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#26A17B] uppercase tracking-wide">Available Balance</p>
                          <p className="text-sm font-bold text-[#26A17B]">
                            {solanaWallet.usdtBalance !== null
                              ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                              : 'Loading...'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => solanaWallet.refreshBalances()}
                        className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                        title="Refresh balance"
                      >
                        <Activity className="w-4 h-4 text-[#26A17B]" />
                      </button>
                    </div>
                  </div>

                  {/* Currency Pair */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Currency Pair</label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-[#1f1f1f] rounded-xl p-3 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#26A17B] flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">₮</span>
                        </div>
                        <div>
                          <p className="text-xs font-medium">USDT</p>
                          <p className="text-[10px] text-gray-500">From</p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-600" />
                      <div className="flex-1 bg-[#1f1f1f] rounded-xl p-3 flex items-center gap-2">
                        <span className="text-lg">🇦🇪</span>
                        <div>
                          <p className="text-xs font-medium">AED</p>
                          <p className="text-[10px] text-gray-500">To</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Available Amount */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Amount to Offer (USDT)</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="1,000"
                        value={corridorForm.availableAmount}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          setCorridorForm(prev => ({ ...prev, availableAmount: value }));
                        }}
                        className={`w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 ${
                          parseFloat(corridorForm.availableAmount || '0') > (solanaWallet.usdtBalance || 0)
                            ? 'focus:ring-red-500/50 border border-red-500/30'
                            : 'focus:ring-white/20'
                        }`}
                      />
                      <button
                        onClick={() => {
                          if (solanaWallet.usdtBalance !== null) {
                            setCorridorForm(prev => ({ ...prev, availableAmount: solanaWallet.usdtBalance!.toString() }));
                          }
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#26A17B] font-medium hover:text-[#26A17B]/80"
                      >
                        MAX
                      </button>
                    </div>
                    {parseFloat(corridorForm.availableAmount || '0') > (solanaWallet.usdtBalance || 0) && (
                      <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Exceeds your wallet balance
                      </p>
                    )}
                    <p className="text-[10px] text-gray-500 mt-1 ml-1">Total USDT you want to make available for trading</p>
                  </div>

                  {/* Order Range */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Order Range (USDT)</label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="100"
                          value={corridorForm.minAmount}
                          onChange={(e) => setCorridorForm(prev => ({ ...prev, minAmount: e.target.value.replace(/[^0-9.]/g, '') }))}
                          className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                        />
                        <p className="text-[10px] text-gray-500 mt-1 ml-1">Min per order</p>
                      </div>
                      <span className="text-gray-600">—</span>
                      <div className="flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="10,000"
                          value={corridorForm.maxAmount}
                          onChange={(e) => setCorridorForm(prev => ({ ...prev, maxAmount: e.target.value.replace(/[^0-9.]/g, '') }))}
                          className={`w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 ${
                            parseFloat(corridorForm.maxAmount || '0') > parseFloat(corridorForm.availableAmount || '0') && corridorForm.availableAmount
                              ? 'focus:ring-amber-500/50 border border-amber-500/30'
                              : 'focus:ring-white/20'
                          }`}
                        />
                        <p className="text-[10px] text-gray-500 mt-1 ml-1">Max per order</p>
                      </div>
                    </div>
                    {parseFloat(corridorForm.maxAmount || '0') > parseFloat(corridorForm.availableAmount || '0') && corridorForm.availableAmount && (
                      <p className="text-[10px] text-amber-400 mt-1 ml-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Max order exceeds available amount
                      </p>
                    )}
                  </div>

                  {/* Rate & Premium */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Base Rate</label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="3.67"
                          value={corridorForm.rate}
                          onChange={(e) => setCorridorForm(prev => ({ ...prev, rate: e.target.value.replace(/[^0-9.]/g, '') }))}
                          className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">AED</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Your Fee</label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.25"
                          value={corridorForm.premium}
                          onChange={(e) => setCorridorForm(prev => ({ ...prev, premium: e.target.value.replace(/[^0-9.]/g, '') }))}
                          className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                        />
                        <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[11px] font-medium text-emerald-400">Corridor Preview</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Offering <span className="text-[#26A17B] font-medium">{corridorForm.availableAmount || "0"} USDT</span> total. Accept orders from <span className="text-white font-medium">{corridorForm.minAmount || "100"}</span> to <span className="text-white font-medium">{corridorForm.maxAmount || "10,000"}</span> USDT at <span className="text-white font-medium">{corridorForm.rate || "3.67"}</span> AED + <span className="text-emerald-400 font-medium">{corridorForm.premium || "0.25"}%</span> fee
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={
                      !corridorForm.availableAmount ||
                      parseFloat(corridorForm.availableAmount) <= 0 ||
                      parseFloat(corridorForm.availableAmount) > (solanaWallet.usdtBalance || 0)
                    }
                    onClick={async () => {
                      if (!merchantId) return;
                      // Validate against wallet balance
                      const availableAmount = parseFloat(corridorForm.availableAmount || "0");
                      if (availableAmount > (solanaWallet.usdtBalance || 0)) {
                        alert("Amount exceeds your wallet balance");
                        return;
                      }
                      if (availableAmount <= 0) {
                        alert("Please enter a valid amount");
                        return;
                      }
                      try {
                        const rate = parseFloat(corridorForm.rate || "3.67");
                        const premium = parseFloat(corridorForm.premium || "0.25") / 100;
                        const effectiveRate = rate * (1 + premium);

                        const res = await fetch("/api/merchant/offers", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            merchant_id: merchantId,
                            type: "sell", // Merchant sells AED, user buys AED
                            payment_method: "bank",
                            rate: effectiveRate,
                            min_amount: parseFloat(corridorForm.minAmount || "100"),
                            max_amount: parseFloat(corridorForm.maxAmount || "10000"),
                            available_amount: availableAmount,
                            bank_name: "Emirates NBD",
                            bank_account_name: "QuickSwap LLC",
                            bank_iban: "AE070331234567890123456",
                            wallet_address: solanaWallet.walletAddress, // Store merchant wallet
                          }),
                        });
                        if (!res.ok) {
                          console.error("Failed to create offer:", res.status);
                          return;
                        }
                        const data = await res.json();
                        if (data.success) {
                          console.log("Corridor created:", data.data);
                          setShowCreateModal(false);
                          // Refresh active offers list
                          fetchActiveOffers();
                          // Reset form
                          setCorridorForm({
                            fromCurrency: "USDT",
                            toCurrency: "AED",
                            availableAmount: "",
                            minAmount: "",
                            maxAmount: "",
                            rate: "3.67",
                            premium: "0.25",
                          });
                        }
                      } catch (error) {
                        console.error("Error creating corridor:", error);
                      }
                    }}
                    className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                      !corridorForm.availableAmount ||
                      parseFloat(corridorForm.availableAmount) <= 0 ||
                      parseFloat(corridorForm.availableAmount) > (solanaWallet.usdtBalance || 0)
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-white text-black hover:bg-white/90'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Open Corridor
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Open Trade Modal - Merchant initiates trade */}
      <AnimatePresence>
        {showOpenTradeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => {
                setShowOpenTradeModal(false);
                setCreateTradeError(null);
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <ArrowLeftRight className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Open Trade</h2>
                      <p className="text-[11px] text-gray-500">Initiate a trade with a customer</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowOpenTradeModal(false);
                      setCreateTradeError(null);
                    }}
                    className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Form */}
                <div className="p-5 space-y-4">
                  {/* Trade Type */}
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1.5 block">Trade Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "sell" }))}
                        className={`py-3 rounded-xl text-xs font-medium transition-all ${
                          openTradeForm.tradeType === "sell"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-[#1f1f1f] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span>Sell USDC</span>
                          <span className="text-[9px] text-gray-500">You send USDC, get AED</span>
                        </div>
                      </button>
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, tradeType: "buy" }))}
                        className={`py-3 rounded-xl text-xs font-medium transition-all ${
                          openTradeForm.tradeType === "buy"
                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : "bg-[#1f1f1f] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span>Buy USDC</span>
                          <span className="text-[9px] text-gray-500">You send AED, get USDC</span>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* USDC Amount */}
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1.5 block">USDC Amount</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={openTradeForm.cryptoAmount}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          setOpenTradeForm(prev => ({ ...prev, cryptoAmount: value }));
                        }}
                        className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 pr-16 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-emerald-500/30"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-500">USDC</span>
                    </div>
                    {openTradeForm.tradeType === "sell" && solanaWallet.usdtBalance !== null && parseFloat(openTradeForm.cryptoAmount || "0") > solanaWallet.usdtBalance && (
                      <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Exceeds your wallet balance ({solanaWallet.usdtBalance.toLocaleString()} USDC)
                      </p>
                    )}
                  </div>

                  {/* Payment Method */}
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1.5 block">Payment Method</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, paymentMethod: "bank" }))}
                        className={`py-2.5 rounded-xl text-xs font-medium transition-all ${
                          openTradeForm.paymentMethod === "bank"
                            ? "bg-white/10 text-white border border-white/20"
                            : "bg-[#1f1f1f] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        Bank Transfer
                      </button>
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, paymentMethod: "cash" }))}
                        className={`py-2.5 rounded-xl text-xs font-medium transition-all ${
                          openTradeForm.paymentMethod === "cash"
                            ? "bg-white/10 text-white border border-white/20"
                            : "bg-[#1f1f1f] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        Cash
                      </button>
                    </div>
                  </div>

                  {/* Trade Preview */}
                  {openTradeForm.cryptoAmount && parseFloat(openTradeForm.cryptoAmount) > 0 && (
                    <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/[0.04]">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[11px] font-medium text-emerald-400">Trade Preview</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">USDC Amount</span>
                          <span className="text-white">{parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Rate (est.)</span>
                          <span className="text-white">3.67 AED/USDC</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-white/[0.04]">
                          <span className="text-gray-400">AED Amount</span>
                          <span className="text-emerald-400 font-bold">
                            {(parseFloat(openTradeForm.cryptoAmount) * 3.67).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error Message */}
                  {createTradeError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                      <p className="text-xs text-red-400 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {createTradeError}
                      </p>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-white/[0.04] flex gap-3">
                  <button
                    onClick={() => {
                      setShowOpenTradeModal(false);
                      setCreateTradeError(null);
                    }}
                    className="flex-1 py-3 rounded-xl text-xs font-medium bg-[#1f1f1f] text-gray-400 hover:bg-white/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={
                      isCreatingTrade ||
                      !openTradeForm.cryptoAmount ||
                      parseFloat(openTradeForm.cryptoAmount) <= 0 ||
                      (openTradeForm.tradeType === "sell" && solanaWallet.usdtBalance !== null && parseFloat(openTradeForm.cryptoAmount) > solanaWallet.usdtBalance)
                    }
                    onClick={async () => {
                      if (!merchantId) return;
                      setIsCreatingTrade(true);
                      setCreateTradeError(null);

                      try {
                        const res = await fetch("/api/merchant/orders", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            merchant_id: merchantId,
                            type: openTradeForm.tradeType,
                            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
                            payment_method: openTradeForm.paymentMethod,
                          }),
                        });

                        const data = await res.json();

                        if (!res.ok || !data.success) {
                          console.error('[Merchant] Create trade failed:', data);
                          setCreateTradeError(data.error || "Failed to create trade");
                          return;
                        }

                        console.log('[Merchant] Trade created successfully:', data.data);

                        // Success - close modal and refresh orders
                        setShowOpenTradeModal(false);
                        setOpenTradeForm({
                          tradeType: "sell",
                          cryptoAmount: "",
                          paymentMethod: "bank",
                        });
                        addNotification('order', `Trade created for ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC`, data.data?.id);

                        // Add to orders list
                        if (data.data) {
                          const newOrder = mapDbOrderToUI(data.data);
                          setOrders(prev => [newOrder, ...prev]);
                        }
                      } catch (error) {
                        console.error("Error creating trade:", error);
                        setCreateTradeError("Network error. Please try again.");
                      } finally {
                        setIsCreatingTrade(false);
                      }
                    }}
                    className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                      isCreatingTrade ||
                      !openTradeForm.cryptoAmount ||
                      parseFloat(openTradeForm.cryptoAmount) <= 0 ||
                      (openTradeForm.tradeType === "sell" && solanaWallet.usdtBalance !== null && parseFloat(openTradeForm.cryptoAmount) > solanaWallet.usdtBalance)
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-emerald-500 text-black hover:bg-emerald-400'
                    }`}
                  >
                    {isCreatingTrade ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        Open Trade
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Dispute Modal */}
      <AnimatePresence>
        {showDisputeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => setShowDisputeModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Report Issue</h2>
                      <p className="text-[11px] text-gray-500">Raise a dispute for this trade</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDisputeModal(false)}
                    className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  <p className="text-[13px] text-gray-400">
                    If you&apos;re having a problem with this trade, our support team will help resolve it.
                  </p>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Reason</label>
                    <select
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm text-white outline-none appearance-none border border-white/[0.04]"
                    >
                      <option value="">Select a reason...</option>
                      <option value="payment_not_received">Payment not received</option>
                      <option value="crypto_not_received">Crypto not received</option>
                      <option value="wrong_amount">Wrong amount sent</option>
                      <option value="fraud">Suspected fraud</option>
                      <option value="other">Other issue</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Description</label>
                    <textarea
                      value={disputeDescription}
                      onChange={(e) => setDisputeDescription(e.target.value)}
                      placeholder="Describe the issue in detail..."
                      rows={3}
                      className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 border border-white/[0.04] resize-none"
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  <button
                    onClick={() => setShowDisputeModal(false)}
                    className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={submitDispute}
                    disabled={!disputeReason || isSubmittingDispute}
                    className="flex-[2] py-3 rounded-xl text-xs font-bold bg-red-500 text-white hover:bg-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmittingDispute ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    {isSubmittingDispute ? "Submitting..." : "Submit Dispute"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Escrow Lock Modal */}
      <AnimatePresence>
        {showEscrowModal && escrowOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => !isLockingEscrow && closeEscrowModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Lock Escrow</h2>
                      <p className="text-[11px] text-gray-500">Secure USDC for this trade</p>
                    </div>
                  </div>
                  {!isLockingEscrow && (
                    <button
                      onClick={closeEscrowModal}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Order Info */}
                  <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-2xl">
                        {escrowOrder.emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{escrowOrder.user}</p>
                        <p className="text-xs text-gray-500">Buy Order</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Amount</p>
                        <p className="text-lg font-bold text-white">{escrowOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Value</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(escrowOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Wallet Balance */}
                  <div className="flex items-center justify-between bg-[#1a1a1a] rounded-xl p-3 border border-white/[0.04]">
                    <span className="text-xs text-gray-500">Your USDC Balance</span>
                    <span className={`text-sm font-bold ${(solanaWallet.usdtBalance || 0) >= escrowOrder.amount ? 'text-emerald-400' : 'text-red-400'}`}>
                      {solanaWallet.usdtBalance?.toFixed(2) || '0.00'} USDC
                    </span>
                  </div>

                  {/* Transaction Status */}
                  {isLockingEscrow && !escrowTxHash && (
                    <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-blue-400">Processing Transaction</p>
                          <p className="text-xs text-blue-400/70">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {escrowTxHash && (
                    <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-emerald-400">Escrow Locked Successfully!</p>
                          <p className="text-xs text-emerald-400/70">USDC is now secured on-chain</p>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${escrowTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                    </div>
                  )}

                  {/* Error State */}
                  {escrowError && (
                    <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Transaction Failed</p>
                          <p className="text-xs text-red-400/70">{escrowError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning / Info */}
                  {!escrowTxHash && !isLockingEscrow && (
                    <>
                      {escrowOrder.isM2M ? (
                        // M2M trade - show merchant info
                        escrowOrder.buyerMerchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.buyerMerchantWallet) ? (
                          <div className="bg-purple-500/10 rounded-xl p-3 border border-purple-500/20">
                            <p className="text-xs text-purple-400">
                              🤝 <strong>M2M Trade:</strong> You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                              This will be released to the buying merchant after they pay the fiat amount.
                            </p>
                          </div>
                        ) : (
                          <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                            <p className="text-xs text-red-400">
                              ⚠️ Buying merchant hasn&apos;t connected their wallet. They need to connect their wallet first.
                            </p>
                          </div>
                        )
                      ) : escrowOrder.acceptorWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.acceptorWallet) ? (
                        // Merchant-initiated order accepted by another merchant
                        <div className="bg-purple-500/10 rounded-xl p-3 border border-purple-500/20">
                          <p className="text-xs text-purple-400">
                            🤝 <strong>Merchant Trade:</strong> You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                            This will be released to the accepting merchant after they pay the fiat amount.
                          </p>
                        </div>
                      ) : (
                        // Regular user trade
                        escrowOrder.userWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.userWallet) ? (
                          <div className="bg-amber-500/10 rounded-xl p-3 border border-amber-500/20">
                            <p className="text-xs text-amber-400">
                              ⚠️ You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow on-chain.
                              This will be released to the buyer after they pay you the fiat amount.
                            </p>
                          </div>
                        ) : (
                          <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                            <p className="text-xs text-red-400">
                              ⚠️ User hasn&apos;t connected their Solana wallet yet. On-chain escrow requires the user&apos;s wallet address.
                              Please ask them to connect their wallet in the app first.
                            </p>
                          </div>
                        )
                      )}
                    </>
                  )}

                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {escrowTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeEscrowModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={closeEscrowModal}
                        disabled={isLockingEscrow}
                        className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={executeLockEscrow}
                        disabled={
                          isLockingEscrow ||
                          (solanaWallet.usdtBalance || 0) < escrowOrder.amount ||
                          // Check for valid recipient wallet:
                          // 1. M2M: buyer merchant wallet
                          // 2. Merchant-initiated with acceptor: acceptor wallet
                          // 3. Regular: user wallet
                          !(
                            (escrowOrder.isM2M && escrowOrder.buyerMerchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.buyerMerchantWallet)) ||
                            (escrowOrder.acceptorWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.acceptorWallet)) ||
                            (escrowOrder.userWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.userWallet))
                          )
                        }
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-blue-500 text-white hover:bg-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isLockingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Locking...
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4" />
                            Lock {escrowOrder.amount} USDC
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Escrow Release Modal */}
      <AnimatePresence>
        {showReleaseModal && releaseOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => !isReleasingEscrow && closeReleaseModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <Unlock className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Release Escrow</h2>
                      <p className="text-[11px] text-gray-500">Confirm payment & release USDC</p>
                    </div>
                  </div>
                  {!isReleasingEscrow && (
                    <button
                      onClick={closeReleaseModal}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Order Info */}
                  <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-2xl">
                        {releaseOrder.emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{releaseOrder.user}</p>
                        <p className="text-xs text-gray-500">Buy Order - Payment Received</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Release Amount</p>
                        <p className="text-lg font-bold text-emerald-400">{releaseOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Received</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(releaseOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Escrow Details */}
                  {releaseOrder.escrowTradeId && (
                    <div className="flex items-center justify-between bg-[#1a1a1a] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-gray-500">Escrow Trade ID</span>
                      <span className="text-xs font-mono text-gray-400">#{releaseOrder.escrowTradeId}</span>
                    </div>
                  )}

                  {/* Transaction Status */}
                  {isReleasingEscrow && !releaseTxHash && (
                    <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-emerald-400">Processing Release</p>
                          <p className="text-xs text-emerald-400/70">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {releaseTxHash && (
                    <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-emerald-400">Escrow Released!</p>
                          <p className="text-xs text-emerald-400/70">{releaseOrder.amount} USDC sent to buyer</p>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${releaseTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                    </div>
                  )}

                  {/* Error State */}
                  {releaseError && (
                    <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Release Failed</p>
                          <p className="text-xs text-red-400/70">{releaseError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning / Info */}
                  {!releaseTxHash && !isReleasingEscrow && (
                    <>
                      {releaseOrder.escrowTradeId && releaseOrder.escrowCreatorWallet && releaseOrder.userWallet ? (
                        <div className="bg-amber-500/10 rounded-xl p-3 border border-amber-500/20">
                          <p className="text-xs text-amber-400">
                            ⚠️ <strong>Confirm you have received the payment!</strong> Once you release,
                            <strong> {releaseOrder.amount} USDC</strong> will be sent to the buyer&apos;s wallet
                            and cannot be reversed.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                          <p className="text-xs text-red-400">
                            ⚠️ Missing on-chain escrow details. This order may not have been locked on-chain.
                            {!releaseOrder.escrowTradeId && ' (No Trade ID)'}
                            {!releaseOrder.escrowCreatorWallet && ' (No Creator Wallet)'}
                            {!releaseOrder.userWallet && ' (No User Wallet)'}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {releaseTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeReleaseModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={closeReleaseModal}
                        disabled={isReleasingEscrow}
                        className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={executeRelease}
                        disabled={isReleasingEscrow || !releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet}
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isReleasingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Releasing...
                          </>
                        ) : (
                          <>
                            <Unlock className="w-4 h-4" />
                            Confirm & Release
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cancel/Withdraw Escrow Modal */}
      <AnimatePresence>
        {showCancelModal && cancelOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => !isCancellingEscrow && closeCancelModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                      <RotateCcw className="w-5 h-5 text-orange-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Cancel & Withdraw</h2>
                      <p className="text-[11px] text-gray-500">Refund escrow to your wallet</p>
                    </div>
                  </div>
                  {!isCancellingEscrow && (
                    <button
                      onClick={closeCancelModal}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Order Info */}
                  <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-2xl">
                        {cancelOrder.emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{cancelOrder.user}</p>
                        <p className="text-xs text-gray-500">Buy Order - Escrow Locked</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Withdraw Amount</p>
                        <p className="text-lg font-bold text-orange-400">{cancelOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Order Total</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(cancelOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Escrow Details */}
                  {cancelOrder.escrowTradeId && (
                    <div className="flex items-center justify-between bg-[#1a1a1a] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-gray-500">Escrow Trade ID</span>
                      <span className="text-xs font-mono text-gray-400">#{cancelOrder.escrowTradeId}</span>
                    </div>
                  )}

                  {/* Transaction Status */}
                  {isCancellingEscrow && !cancelTxHash && (
                    <div className="bg-orange-500/10 rounded-xl p-4 border border-orange-500/20">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-orange-400">Processing Refund</p>
                          <p className="text-xs text-orange-400/70">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {cancelTxHash && (
                    <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-emerald-400">Escrow Refunded!</p>
                          <p className="text-xs text-emerald-400/70">{cancelOrder.amount} USDC returned to your wallet</p>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${cancelTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on Solscan
                      </a>
                    </div>
                  )}

                  {/* Error State */}
                  {cancelError && (
                    <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Refund Failed</p>
                          <p className="text-xs text-red-400/70">{cancelError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning */}
                  {!cancelTxHash && !isCancellingEscrow && (
                    <>
                      {cancelOrder.escrowTradeId && cancelOrder.escrowCreatorWallet ? (
                        <div className="bg-orange-500/10 rounded-xl p-3 border border-orange-500/20">
                          <p className="text-xs text-orange-400">
                            This will cancel the order and return <strong>{cancelOrder.amount} USDC</strong> to your wallet. The buyer will be notified.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                          <p className="text-xs text-red-400">
                            Missing on-chain escrow details. Cannot refund.
                            {!cancelOrder.escrowTradeId && ' (No Trade ID)'}
                            {!cancelOrder.escrowCreatorWallet && ' (No Creator Wallet)'}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {cancelTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeCancelModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={closeCancelModal}
                        disabled={isCancellingEscrow}
                        className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                      >
                        Back
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={executeCancelEscrow}
                        disabled={isCancellingEscrow || !cancelOrder.escrowTradeId || !cancelOrder.escrowCreatorWallet}
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-orange-500 text-white hover:bg-orange-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isCancellingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Refunding...
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Cancel & Withdraw
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Merchant" accentColor="#c9a962" />

      {/* Wallet Connect Modal */}
      <MerchantWalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onConnected={(address) => {
          console.log('[Merchant] Wallet connected via modal:', address);
          setShowWalletModal(false);
          // Wallet will be linked to merchant account via updateMerchantWallet useEffect
        }}
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

      {/* Wallet Connection Prompt - shown after login if no wallet connected */}
      <AnimatePresence>
        {showWalletPrompt && !solanaWallet.connected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-50"
              onClick={() => setShowWalletPrompt(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-[#151515] rounded-2xl p-6 border border-white/10"
            >
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#26A17B]/10 flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-[#26A17B]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
                <p className="text-gray-400 text-sm mb-6">
                  Connect your Solana wallet to receive payments from escrow releases. This wallet will be saved to your account.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowWalletPrompt(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-gray-400 font-medium text-sm hover:bg-white/5 transition-colors"
                  >
                    Later
                  </button>
                  <button
                    onClick={() => {
                      setShowWalletPrompt(false);
                      setShowWalletModal(true);
                    }}
                    className="flex-1 px-4 py-3 rounded-xl bg-[#26A17B] text-white font-medium text-sm hover:bg-[#26A17B]/90 transition-colors flex items-center justify-center gap-2"
                  >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Order Detail Popup */}
      <AnimatePresence>
        {selectedOrderPopup && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50"
              onClick={() => setSelectedOrderPopup(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-[#151515] rounded-2xl p-5 border border-white/10"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-[#252525] flex items-center justify-center text-2xl">
                    {selectedOrderPopup.emoji}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">{selectedOrderPopup.user}</p>
                    <p className="text-sm text-gray-400">
                      {selectedOrderPopup.orderType === 'sell' ? 'Selling' : 'Buying'} USDC
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedOrderPopup(null)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {/* Escrow Status */}
              {selectedOrderPopup.escrowTxHash && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    <Check className="w-4 h-4 text-emerald-400 -ml-2" />
                    <span className="text-sm font-medium text-emerald-400">Escrow Secured</span>
                  </div>
                  <a
                    href={`https://explorer.solana.com/tx/${selectedOrderPopup.escrowTxHash}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 mt-1 text-xs text-emerald-400/70 hover:text-emerald-400"
                  >
                    View TX <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* Order Details */}
              <div className="bg-[#1a1a1a] rounded-xl p-3 space-y-2 mb-4">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Amount</span>
                  <span className="text-sm font-semibold text-white">${selectedOrderPopup.amount.toLocaleString()} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Total Fiat</span>
                  <span className="text-sm font-semibold text-emerald-400">د.إ {Math.round(selectedOrderPopup.total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Rate</span>
                  <span className="text-sm text-gray-400">1 USDC = {selectedOrderPopup.rate} AED</span>
                </div>
              </div>

              {/* User's Bank Account (for sell orders) */}
              {selectedOrderPopup.orderType === 'sell' && selectedOrderPopup.userBankAccount && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
                  <p className="text-xs text-amber-400 mb-1">Send AED to this account:</p>
                  <p className="text-sm font-mono text-white">{selectedOrderPopup.userBankAccount}</p>
                  <p className="text-xs text-gray-500 mt-1">Amount: د.إ {Math.round(selectedOrderPopup.total).toLocaleString()}</p>
                </div>
              )}

              {/* No bank account provided */}
              {selectedOrderPopup.orderType === 'sell' && !selectedOrderPopup.userBankAccount && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                  <p className="text-xs text-red-400">No payment details provided by user. Chat to get bank details.</p>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                {/* For escrowed sell orders not yet approved - show Go button */}
                {/* DB status 'escrowed' means user locked escrow but merchant hasn't clicked Go yet */}
                {selectedOrderPopup.dbOrder?.status === 'escrowed' && selectedOrderPopup.orderType === 'sell' && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      await acceptOrder(selectedOrderPopup);
                      // Update popup to show active status (merchant approved, now in Active section)
                      setSelectedOrderPopup(prev => prev ? { ...prev, status: 'active' } : null);
                    }}
                    className="w-full py-3 rounded-xl bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    Go
                  </motion.button>
                )}

                {/* For pending orders without escrow (regular flow) */}
                {selectedOrderPopup.status === 'pending' && !selectedOrderPopup.escrowTxHash && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      acceptOrder(selectedOrderPopup);
                      setSelectedOrderPopup(null);
                    }}
                    className="w-full py-3 rounded-xl bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    Go
                  </motion.button>
                )}

                {/* For sell orders after merchant accepted - show I've Paid button */}
                {/* DB status 'accepted' means merchant has accepted, now needs to mark payment sent */}
                {selectedOrderPopup.dbOrder?.status === 'accepted' && selectedOrderPopup.orderType === 'sell' && selectedOrderPopup.escrowTxHash && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => markPaymentSent(selectedOrderPopup)}
                    disabled={markingDone}
                    className="w-full py-3 rounded-xl bg-orange-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {markingDone ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        I've Paid
                      </>
                    )}
                  </motion.button>
                )}

                <button
                  onClick={() => {
                    setSelectedOrderId(selectedOrderPopup.id);
                    setSelectedOrderPopup(null);
                  }}
                  className="w-full py-3 rounded-xl bg-[#1a1a2e] text-white font-medium flex items-center justify-center gap-2 border border-white/10"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Full Details
                </button>

                <button
                  onClick={() => {
                    handleOpenChat(selectedOrderPopup.user, selectedOrderPopup.emoji, selectedOrderPopup.id);
                    setSelectedOrderPopup(null);
                  }}
                  className="w-full py-3 rounded-xl bg-[#252525] text-white font-medium flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  Chat
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Order Details Panel */}
      {selectedOrderId && merchantId && (
        <OrderDetailsPanel
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}

      {/* Message History Panel */}
      <AnimatePresence>
        {showMessageHistory && merchantId && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md z-50 shadow-2xl"
          >
            <MessageHistory
              merchantId={merchantId}
              onOpenChat={(orderId, user, emoji) => {
                openChat(user, emoji, orderId);
                setShowMessageHistory(false);
              }}
              onClose={() => setShowMessageHistory(false)}
            />
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
    </div>
  );
}
