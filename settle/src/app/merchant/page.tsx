"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import PWAInstallBanner from "@/components/PWAInstallBanner";

// Dynamically import wallet components (client-side only)
const MerchantWalletModal = dynamic(() => import("@/components/MerchantWalletModal"), { ssr: false });
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
const mapDbStatusToUI = (dbStatus: string): "pending" | "active" | "escrow" | "completed" | "disputed" | "cancelled" => {
  switch (dbStatus) {
    case "pending":
      return "pending";
    case "accepted":
    case "escrow_pending":
      return "active"; // Accepted but escrow not yet locked
    case "escrowed":
    case "payment_pending":
    case "payment_sent":
    case "payment_confirmed":
    case "releasing":
      return "escrow";
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

  return {
    id: dbOrder.id,
    user: userName,
    emoji: getUserEmoji(userName),
    amount: cryptoAmount,
    fromCurrency: "USDC",
    toCurrency: "AED",
    rate: rate,
    total: fiatAmount,
    timestamp: new Date(dbOrder.created_at),
    status: mapDbStatusToUI(dbOrder.status),
    expiresIn,
    isNew: (dbOrder.user?.total_trades || 0) < 3,
    tradeVolume: (dbOrder.user?.total_trades || 0) * 500, // Estimated volume
    dbOrder,
    // Escrow fields for on-chain release
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    // For buy orders, use buyer_wallet_address captured at order creation (more reliable)
    // Fall back to user's wallet from users table if buyer_wallet_address not set
    userWallet: dbOrder.buyer_wallet_address || dbOrder.user?.wallet_address,
    orderType: dbOrder.type,
    // User's bank account (from payment_details)
    userBankAccount: dbOrder.payment_details?.user_bank_account,
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

// Leaderboard mock data
const leaderboardData: LeaderboardEntry[] = [
  { rank: 1, user: "whale_69", emoji: "🐋", volume: 450000, trades: 892, isTop1Percent: true },
  { rank: 2, user: "gm_alice", emoji: "💎", volume: 220000, trades: 445, isTop1Percent: true },
  { rank: 3, user: "sol_maxi", emoji: "◎", volume: 125000, trades: 312, isTop1Percent: true },
  { rank: 4, user: "degen_ape", emoji: "🦧", volume: 85000, trades: 234, isTop1Percent: false },
  { rank: 5, user: "ser_pump", emoji: "🔥", volume: 45000, trades: 156, isTop1Percent: false },
];

const notifications = [
  { id: 1, type: "order", message: "New order from whale_69", time: "just now", read: false },
  { id: 2, type: "complete", message: "Trade #ord_5 completed +$2.50", time: "2m ago", read: false },
  { id: 3, type: "escrow", message: "Funds locked for #ord_3", time: "5m ago", read: true },
  { id: 4, type: "order", message: "New order from anon_fox", time: "12m ago", read: true },
  { id: 5, type: "complete", message: "Trade #ord_4 completed +$6.25", time: "1h ago", read: true },
];

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

const initialBigOrders: BigOrderRequest[] = [
  { id: "big_1", user: "mega_whale", emoji: "🐳", amount: 50000, currency: "USDC", message: "Need quick settlement, can do premium rate", timestamp: new Date(Date.now() - 300000), premium: 0.5 },
  { id: "big_2", user: "corp_treasury", emoji: "🏦", amount: 25000, currency: "USDC", message: "Weekly recurring, looking for reliable merchant", timestamp: new Date(Date.now() - 600000), premium: 0.3 },
];

// Demo merchant wallet address (from seed data)
const DEMO_MERCHANT_WALLET = "0xMerchant1Address123456789"; // QuickSwap merchant

// Mock data for demo mode (when database is not available)
const DEMO_MODE = false; // Set to true when database is not connected
const MOCK_MERCHANT_ID = "mock-merchant-123";
const mockOrders: Order[] = [
  {
    id: "order_1",
    user: "alice_crypto",
    emoji: "🦊",
    amount: 500,
    fromCurrency: "USDC",
    toCurrency: "AED",
    rate: 3.67,
    total: 1835,
    timestamp: new Date(Date.now() - 120000),
    status: "pending",
    expiresIn: 780,
    isNew: true,
    tradeVolume: 1500,
  },
  {
    id: "order_2",
    user: "bob_trader",
    emoji: "🐋",
    amount: 1200,
    fromCurrency: "USDC",
    toCurrency: "AED",
    rate: 3.67,
    total: 4404,
    timestamp: new Date(Date.now() - 300000),
    status: "escrow",
    expiresIn: 540,
    isNew: false,
    tradeVolume: 25000,
  },
  {
    id: "order_3",
    user: "whale_99",
    emoji: "💎",
    amount: 2500,
    fromCurrency: "USDC",
    toCurrency: "AED",
    rate: 3.68,
    total: 9200,
    timestamp: new Date(Date.now() - 600000),
    status: "completed",
    expiresIn: 0,
    isNew: false,
    tradeVolume: 150000,
  },
];

// Merchant info type
interface MerchantInfo {
  id: string;
  email: string;
  display_name: string;
  business_name: string;
  balance: number;
  wallet_address?: string;
}

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const [orders, setOrders] = useState<Order[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Solana wallet state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [walletUpdatePending, setWalletUpdatePending] = useState(false);

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
  const solanaWallet = useSolanaWalletHook();
  const [loginForm, setLoginForm] = useState({ email: "desertgold@merchant.com", password: "merchant123" });
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [bigOrders, setBigOrders] = useState<BigOrderRequest[]>(initialBigOrders);
  const [showBigOrderWidget, setShowBigOrderWidget] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
    if (merchantId) {
      setActor('merchant', merchantId);
    }
  }, [merchantId, setActor]);

  // Real-time chat hook (replaces polling)
  const {
    chatWindows,
    openChat,
    closeChat,
    sendMessage,
  } = useRealtimeChat({
    maxWindows: 10,
    actorType: "merchant",
    actorId: merchantId || undefined,
    onNewMessage: () => {
      playSound('message');
    },
  });

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
        localStorage.setItem('merchant_info', JSON.stringify(data.data.merchant));
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

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('merchant_info');
    setMerchantId(null);
    setMerchantInfo(null);
    setIsLoggedIn(false);
    setOrders([]);
  };

  // Check for saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem('merchant_info');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMerchantId(parsed.id);
        setMerchantInfo(parsed);
        setIsLoggedIn(true);
      } catch {
        localStorage.removeItem('merchant_info');
      }
    }
    setIsLoading(false);
  }, []);

  // Prompt wallet connection after login if wallet not connected and no stored wallet
  useEffect(() => {
    if (isLoggedIn && merchantId && !solanaWallet.connected && !merchantInfo?.wallet_address) {
      // Show prompt to connect wallet after a short delay
      const timer = setTimeout(() => {
        setShowWalletPrompt(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoggedIn, merchantId, solanaWallet.connected, merchantInfo?.wallet_address]);

  // Update merchant wallet in database when wallet connects
  useEffect(() => {
    const updateMerchantWallet = async () => {
      if (!merchantId || !solanaWallet.connected || !solanaWallet.walletAddress) return;

      // Check if wallet is different from stored one
      if (merchantInfo?.wallet_address === solanaWallet.walletAddress) {
        console.log('[Merchant] Wallet already stored, skipping update');
        return;
      }

      setWalletUpdatePending(true);
      try {
        const res = await fetch('/api/auth/merchant', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: merchantId,
            wallet_address: solanaWallet.walletAddress,
          }),
        });

        const data = await res.json();
        if (data.success) {
          console.log('[Merchant] Wallet updated in database:', solanaWallet.walletAddress);
          // Update local storage and state with new wallet
          const updatedInfo = { ...merchantInfo, wallet_address: solanaWallet.walletAddress };
          setMerchantInfo(updatedInfo as MerchantInfo);
          localStorage.setItem('merchant_info', JSON.stringify(updatedInfo));
          setShowWalletPrompt(false);
          addNotification('system', `Wallet connected: ${solanaWallet.walletAddress.slice(0, 4)}...${solanaWallet.walletAddress.slice(-4)}`);
        } else {
          console.error('[Merchant] Failed to update wallet:', data.error);
        }
      } catch (err) {
        console.error('[Merchant] Error updating wallet:', err);
      } finally {
        setWalletUpdatePending(false);
      }
    };

    updateMerchantWallet();
  }, [merchantId, solanaWallet.connected, solanaWallet.walletAddress, merchantInfo]);

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    if (!merchantId) {
      console.log('[Merchant] fetchOrders: No merchantId, skipping');
      return;
    }

    // Skip API call in demo mode
    if (DEMO_MODE || merchantId === MOCK_MERCHANT_ID) {
      setIsLoading(false);
      return;
    }

    console.log('[Merchant] fetchOrders: Fetching for merchantId:', merchantId);

    try {
      const res = await fetch(`/api/merchant/orders?merchant_id=${merchantId}`);
      if (!res.ok) {
        console.error('[Merchant] Failed to fetch orders:', res.status, res.statusText);
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

  // Fetch orders when merchant ID is available
  // Real-time updates come via Pusher WebSocket (useRealtimeOrders hook)
  useEffect(() => {
    if (!merchantId) return;
    fetchOrders();
    fetchResolvedDisputes();
  }, [merchantId, fetchOrders, fetchResolvedDisputes]);

  // Polling fallback when Pusher is not available (every 5 seconds)
  const { isConnected: isPusherConnected } = usePusher();
  useEffect(() => {
    if (!merchantId || isPusherConnected) return;

    // Poll for new orders every 5 seconds when Pusher isn't connected
    const interval = setInterval(() => {
      fetchOrders();
    }, 5000);

    return () => clearInterval(interval);
  }, [merchantId, isPusherConnected, fetchOrders]);

  // Real-time orders subscription - triggers refetch on updates
  useRealtimeOrders({
    actorType: 'merchant',
    actorId: merchantId,
    onOrderCreated: () => {
      // Refetch orders when a new order comes in
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

    // Demo mode - just update local state
    if (DEMO_MODE || merchantId === MOCK_MERCHANT_ID) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "escrow" as const, expiresIn: 900 } : o));
      openChat(order.user, order.emoji, order.id);
      setActiveChatId(`chat_${order.user}`);
      playSound('click');
      return;
    }

    // For BUY orders: merchant needs to lock their USDC in escrow
    // For SELL orders: user already locked escrow, merchant just accepts
    const isBuyOrder = order.orderType === 'buy';

    if (isBuyOrder) {
      // Check if merchant has enough USDC balance
      if (!solanaWallet.connected) {
        addNotification('system', 'Please connect your wallet to accept buy orders');
        setShowWalletModal(true);
        return;
      }

      if (solanaWallet.usdtBalance === null || solanaWallet.usdtBalance < order.amount) {
        addNotification('system', `Insufficient USDC balance. You need ${order.amount} USDC to accept this order.`);
        playSound('error');
        return;
      }
    }

    try {
      // Step 1: Accept the order (moves to 'accepted' status - shown in Active section)
      const acceptRes = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "accepted",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });
      if (!acceptRes.ok) {
        console.error("Failed to accept order:", acceptRes.status);
        return;
      }
      const acceptData = await acceptRes.json();

      if (!acceptData.success) {
        console.error("Failed to accept order:", acceptData.error);
        return;
      }

      // Update local state to show in Active section
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "active" as const, expiresIn: 1800 } : o));
      openChat(order.user, order.emoji, order.id);
      setActiveChatId(`chat_${order.user}`);
      fetchOrders();
      playSound('click');
      addNotification('system', `Order accepted! ${isBuyOrder ? 'Now lock your USDC in escrow to proceed.' : 'Waiting for user to lock escrow.'}`, order.id);
    } catch (error) {
      console.error("Error accepting order:", error);
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
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          // Map the fresh data
          const freshOrder = mapDbOrderToUI(data.data);
          console.log('[Escrow] Fetched fresh order data, userWallet:', freshOrder.userWallet);

          // Reset state and open modal with fresh data
          setEscrowOrder(freshOrder);
          setEscrowTxHash(null);
          setEscrowError(null);
          setIsLockingEscrow(false);
          setShowEscrowModal(true);
          return;
        }
      }
    } catch (err) {
      console.error('[Escrow] Error fetching fresh order:', err);
    }

    // Fallback to cached order if fetch fails
    setEscrowOrder(order);
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

      // Record escrow on backend
      await fetch(`/api/orders/${escrowOrder.id}/escrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_hash: escrowResult.txHash,
          actor_type: "merchant",
          actor_id: merchantId,
          escrow_address: escrowResult.escrowPda,
          escrow_trade_id: escrowResult.tradeId,
          escrow_trade_pda: escrowResult.tradePda,
          escrow_pda: escrowResult.escrowPda,
          escrow_creator_wallet: solanaWallet.walletAddress,
        }),
      });

      // Update status to escrowed
      const escrowStatusRes = await fetch(`/api/orders/${escrowOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "escrowed",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });

      if (escrowStatusRes.ok) {
        const data = await escrowStatusRes.json();
        if (data.success) {
          setOrders(prev => prev.map(o => o.id === escrowOrder.id ? { ...o, status: "escrow" as const } : o));
          fetchOrders();
          playSound('trade_complete');
          addNotification('escrow', `${escrowOrder.amount} USDC locked in escrow - waiting for user payment`, escrowOrder.id);
        }
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

  // Merchant marks payment as sent to user's bank
  const markPaymentSent = async (order: Order) => {
    if (!merchantId) return;
    setMarkingDone(true);

    try {
      // Update order status to payment_sent
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "payment_sent",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // Close popup and refresh orders
          setSelectedOrderPopup(null);
          fetchOrders();
          playSound('click');
          addNotification('payment', `Payment sent to ${order.user} - waiting for confirmation`, order.id);
        }
      }
    } catch (error) {
      console.error("Error marking payment sent:", error);
      playSound('error');
    } finally {
      setMarkingDone(false);
    }
  };

  const completeOrder = async (orderId: string) => {
    if (!merchantId) return;

    // Demo mode - just update local state
    if (DEMO_MODE || merchantId === MOCK_MERCHANT_ID) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "completed" as const } : o));
      playSound('trade_complete');
      return;
    }

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

    // Demo mode - just update local state
    if (DEMO_MODE || merchantId === MOCK_MERCHANT_ID) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "completed" as const } : o));
      playSound('trade_complete');
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

  // Filter pending orders - only show those with time remaining
  const pendingOrders = orders.filter(o => o.status === "pending" && o.expiresIn > 0);
  const activeOrders = orders.filter(o => o.status === "active"); // Accepted but escrow not yet locked
  const escrowOrders = orders.filter(o => o.status === "escrow");
  const completedOrders = orders.filter(o => o.status === "completed");


  // Calculate trader earnings using "best" rate (most common preference)
  // Trader earns 0.5% of each completed trade
  const todayEarnings = completedOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0);
  const totalTradedVolume = completedOrders.reduce((sum, o) => sum + o.amount, 0);
  const pendingEarnings = escrowOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0);

  const activeChat = chatWindows.find(c => c.id === activeChatId);
  const totalUnread = chatWindows.reduce((sum, c) => sum + c.unread, 0);

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
            <p className="text-sm text-gray-500">Sign in to manage your orders</p>
          </div>

          <div className="bg-[#0d0d0d] rounded-2xl border border-white/[0.04] p-6 space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                {loginError}
              </div>
            )}

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
              disabled={isLoggingIn}
              className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </motion.button>

            <div className="border-t border-white/[0.04] pt-4 mt-4">
              <p className="text-xs text-gray-500 mb-3 text-center">Test Accounts:</p>
              <div className="space-y-2">
                <button
                  onClick={() => setLoginForm({ email: "desertgold@merchant.com", password: "merchant123" })}
                  className="w-full p-2 bg-white/[0.02] hover:bg-white/[0.05] rounded-lg text-left transition-colors"
                >
                  <p className="text-xs font-medium">QuickSwap</p>
                  <p className="text-[10px] text-gray-500">desertgold@merchant.com / merchant123</p>
                </button>
                <button
                  onClick={() => setLoginForm({ email: "desertgold@merchant.com", password: "merchant123" })}
                  className="w-full p-2 bg-white/[0.02] hover:bg-white/[0.05] rounded-lg text-left transition-colors"
                >
                  <p className="text-xs font-medium">DesertGold</p>
                  <p className="text-[10px] text-gray-500">desertgold@merchant.com / merchant123</p>
                </button>
              </div>
            </div>
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

          <div className="flex-1" />

          {/* Quick Stats */}
          <div className="hidden lg:flex items-center gap-2">
            {/* USDT Balance */}
            <button
              onClick={() => setShowWalletModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#26A17B]/10 rounded-md border border-[#26A17B]/30 hover:bg-[#26A17B]/20 transition-colors"
              title={solanaWallet.connected ? "USDT Balance" : "Connect Wallet"}
            >
              <span className="text-xs font-bold text-[#26A17B]">
                {solanaWallet.connected && solanaWallet.usdtBalance !== null
                  ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                  : "Connect Wallet"}
              </span>
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#151515] rounded-md border border-white/[0.04]" title="Total Volume Today">
              <Wallet className="w-3 h-3 text-gray-400" />
              <span className="text-xs font-bold">${totalTradedVolume.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20" title="Earnings Today (0.5% per trade)">
              <TrendingUp className="w-3 h-3 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400">+${Math.round(todayEarnings)}</span>
            </div>
            {pendingEarnings > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 rounded-md border border-amber-500/20" title="Pending Earnings in Escrow">
                <Lock className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-bold text-amber-400">+${Math.round(pendingEarnings)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#151515] rounded-md border border-white/[0.04]" title="Completed Trades">
              <Activity className="w-3 h-3 text-gray-400" />
              <span className="text-xs font-medium">{completedOrders.length} trades</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#151515] rounded-md border border-white/[0.04]" title="Collateral Locked">
              <Shield className="w-3 h-3 text-emerald-400" />
              <span className="text-xs">5k</span>
              <div className="w-8 h-1 bg-[#252525] rounded-full overflow-hidden">
                <div className="h-full w-[32%] bg-white/40" />
              </div>
            </div>
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

          {/* Logout Button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleLogout}
            className="p-1.5 bg-[#151515] rounded-md border border-white/[0.04] hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4 text-gray-400 hover:text-red-400" />
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
              🐋
            </div>
            <div className="hidden sm:block">
              <p className="text-[11px] font-medium">crypto_whale</p>
              <p className="text-[9px] text-gray-500">4.92★</p>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Stats Bar - Shows on mobile only */}
      <div className="md:hidden flex items-center gap-2 px-4 py-2 bg-[#0d0d0d] border-b border-white/[0.04] overflow-x-auto scrollbar-hide">
        {/* USDT Balance */}
        <button
          onClick={() => setShowWalletModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#26A17B]/10 rounded-lg border border-[#26A17B]/30 shrink-0"
        >
          <span className="text-xs font-bold text-[#26A17B]">
            {solanaWallet.connected && solanaWallet.usdtBalance !== null
              ? `${solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
              : "Connect"}
          </span>
        </button>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#151515] rounded-lg border border-white/[0.04] shrink-0">
          <Wallet className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-bold">${totalTradedVolume.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20 shrink-0">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-400">+${Math.round(todayEarnings)}</span>
        </div>
        {pendingEarnings > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 rounded-lg border border-amber-500/20 shrink-0">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-bold text-amber-400">+${Math.round(pendingEarnings)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#151515] rounded-lg border border-white/[0.04] shrink-0">
          <Activity className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-medium">{completedOrders.length} trades</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20 shrink-0"
        >
          <LogOut className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs font-medium text-red-400">Logout</span>
        </button>
      </div>

      {/* Main Layout: Content + Sidebar */}
      <div className="flex-1 flex overflow-hidden w-full pb-16 md:pb-0">
        {/* Main Content */}
        <main className="flex-1 p-3 md:p-4 overflow-auto relative z-10">
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
                                      In Escrow
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

            {/* Column 2: In Escrow + Leaderboard (stacked) */}
            <div className="flex flex-col h-[calc(100vh-80px)] gap-3">
              {/* In Escrow - top portion */}
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold">In Escrow</span>
                  <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                    {escrowOrders.length}
                  </span>
                </div>

                <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-white/[0.04] overflow-hidden min-h-0">
                  <div className="h-full overflow-y-auto p-2 space-y-2">
                    <AnimatePresence mode="popLayout">
                      {escrowOrders.length > 0 ? (
                        escrowOrders.map((order, i) => {
                          const timePercent = (order.expiresIn / 900) * 100;
                          const dbStatus = order.dbOrder?.status;
                          const canComplete = dbStatus === "payment_confirmed";
                          // For BUY orders: merchant can confirm & release when user has sent payment
                          // For SELL orders: merchant waits for user to release (merchant already paid)
                          const canConfirmPayment = dbStatus === "payment_sent" && order.orderType === "buy";
                          // For sell orders after merchant paid, show waiting for user
                          const waitingForUser = dbStatus === "payment_sent" && order.orderType === "sell";
                          // For sell orders, merchant needs to mark payment sent first
                          const canMarkPaid = dbStatus === "escrowed" && order.orderType === "sell";
                          return (
                            <motion.div
                              key={order.id}
                              layout
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              transition={{ delay: i * 0.03 }}
                              className="p-3 bg-[#1a1a1a] rounded-lg border border-amber-500/20 hover:border-amber-500/30 hover:bg-[#1d1d1d] transition-all"
                            >
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                  className="w-11 h-11 rounded-lg bg-[#252525] flex items-center justify-center text-xl shrink-0 hover:bg-[#2a2a2a] transition-colors"
                                >
                                  {order.emoji}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-sm font-medium text-gray-300 truncate">{order.user}</span>
                                    {waitingForUser ? (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">⏳ User releasing</span>
                                    ) : canConfirmPayment ? (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">💸 User paid</span>
                                    ) : canComplete ? (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">✓ Confirmed</span>
                                    ) : canMarkPaid ? (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">Send AED</span>
                                    ) : (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">🔒</span>
                                    )}
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
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-bold text-white">د.إ {Math.round(order.total).toLocaleString()}</span>
                                    <span className="text-xs text-white/60">{order.toCurrency}</span>
                                  </div>
                                  {/* Show user's bank for sell orders waiting for merchant payment */}
                                  {canMarkPaid && order.userBankAccount && (
                                    <div className="mt-1 text-[10px] text-orange-400 font-mono truncate" title={order.userBankAccount}>
                                      → {order.userBankAccount}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right shrink-0 w-12">
                                  <div className={`text-xs font-mono mb-1 ${timePercent < 20 ? "text-red-400" : "text-amber-400"}`}>
                                    {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                                  </div>
                                  <div className="h-1.5 bg-[#252525] rounded-full overflow-hidden">
                                    <div
                                      className={`h-full transition-all ${timePercent < 20 ? "bg-red-500" : "bg-amber-500"}`}
                                      style={{ width: `${timePercent}%` }}
                                    />
                                  </div>
                                </div>
                                {/* Extension UI */}
                                {extensionRequests.has(order.id) && extensionRequests.get(order.id)?.requestedBy === 'user' ? (
                                  // User requested extension - show accept/decline
                                  <div className="flex gap-1 shrink-0">
                                    <motion.button
                                      whileTap={{ scale: 0.95 }}
                                      onClick={() => respondToExtension(order.id, true)}
                                      disabled={requestingExtension === order.id}
                                      className="px-2 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded text-[10px] font-medium disabled:opacity-50"
                                      title={`Accept +${extensionRequests.get(order.id)?.extensionMinutes}min`}
                                    >
                                      +{extensionRequests.get(order.id)?.extensionMinutes}m
                                    </motion.button>
                                    <motion.button
                                      whileTap={{ scale: 0.95 }}
                                      onClick={() => respondToExtension(order.id, false)}
                                      disabled={requestingExtension === order.id}
                                      className="px-2 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-[10px] font-medium disabled:opacity-50"
                                      title="Decline extension"
                                    >
                                      ✕
                                    </motion.button>
                                  </div>
                                ) : timePercent < 30 && !extensionRequests.has(order.id) ? (
                                  // Time running low - show request extension button
                                  <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => requestExtension(order.id)}
                                    disabled={requestingExtension === order.id}
                                    className="p-2 hover:bg-orange-500/10 rounded-md transition-colors shrink-0 disabled:opacity-50"
                                    title="Request time extension"
                                  >
                                    <Clock className={`w-4 h-4 ${requestingExtension === order.id ? 'animate-spin text-orange-400' : 'text-gray-500 hover:text-orange-400'}`} />
                                  </motion.button>
                                ) : extensionRequests.has(order.id) && extensionRequests.get(order.id)?.requestedBy === 'merchant' ? (
                                  // We requested extension - show pending
                                  <span className="px-2 py-1.5 bg-orange-500/10 text-orange-400 rounded text-[10px] font-medium shrink-0">
                                    Pending...
                                  </span>
                                ) : null}
                                <button
                                  onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                  className="p-2 hover:bg-white/[0.04] rounded-md transition-colors shrink-0"
                                  title="Chat"
                                >
                                  <MessageCircle className="w-4 h-4 text-gray-500 hover:text-amber-400" />
                                </button>
                                <button
                                  onClick={() => openDisputeModal(order.id)}
                                  className="p-2 hover:bg-red-500/10 rounded-md transition-colors shrink-0"
                                  title="Report Issue"
                                >
                                  <AlertTriangle className="w-4 h-4 text-gray-500 hover:text-red-400" />
                                </button>
                                {canMarkPaid ? (
                                  <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => markPaymentSent(order)}
                                    disabled={markingDone}
                                    className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 rounded-md text-xs font-bold text-white transition-all shrink-0 disabled:opacity-50"
                                    title="Mark that you've sent fiat to user's bank"
                                  >
                                    {markingDone ? '...' : "I've Paid"}
                                  </motion.button>
                                ) : waitingForUser ? (
                                  <span className="px-3 py-1.5 bg-blue-500/20 rounded-md text-xs font-medium text-blue-400 shrink-0">
                                    Waiting for user
                                  </span>
                                ) : canConfirmPayment ? (
                                  <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => openReleaseModal(order)}
                                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 rounded-md text-xs font-bold text-white transition-all shrink-0"
                                    title="Confirm you received the payment and release USDC to buyer"
                                  >
                                    Confirm & Release
                                  </motion.button>
                                ) : canComplete ? (
                                  <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => completeOrder(order.id)}
                                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 rounded-md text-xs font-bold text-black transition-all shrink-0"
                                    title="Release crypto to buyer"
                                  >
                                    ✓ Release
                                  </motion.button>
                                ) : dbStatus === "escrowed" && order.orderType === "buy" ? (
                                  <span className="px-3 py-1.5 bg-amber-500/20 rounded-md text-xs font-medium text-amber-400 shrink-0">
                                    Awaiting payment
                                  </span>
                                ) : (
                                  <span className="px-3 py-1.5 bg-gray-700/50 rounded-md text-xs font-medium text-gray-500 shrink-0">
                                    Waiting...
                                  </span>
                                )}
                              </div>
                            </motion.div>
                          );
                        })
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                          <span className="text-xl mb-1 opacity-40">🔐</span>
                          <p className="text-[10px] text-gray-500">no active escrows</p>
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
                            className="p-3 bg-[#1a1a1a] rounded-lg border border-blue-500/20 hover:border-blue-500/30 hover:bg-[#1d1d1d] transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                className="w-10 h-10 rounded-lg bg-[#252525] flex items-center justify-center text-lg shrink-0 hover:bg-[#2a2a2a] transition-colors"
                              >
                                {order.emoji}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className="text-sm font-medium text-gray-300 truncate">{order.user}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                                    {order.orderType === 'buy' ? '⬆️ Buy' : '⬇️ Sell'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-bold text-white">د.إ {Math.round(order.total).toLocaleString()}</span>
                                  <span className="text-xs text-white/60">for {order.amount} {order.fromCurrency}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                  className="p-2 hover:bg-white/[0.04] rounded-md transition-colors"
                                  title="Chat"
                                >
                                  <MessageCircle className="w-4 h-4 text-gray-500 hover:text-blue-400" />
                                </button>
                                {order.orderType === 'buy' ? (
                                  <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => openEscrowModal(order)}
                                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 rounded-md text-xs font-bold text-white transition-all"
                                    title="Lock your USDC in escrow"
                                  >
                                    🔒 Lock Escrow
                                  </motion.button>
                                ) : (
                                  <span className="px-3 py-1.5 bg-gray-500/20 text-gray-400 rounded-md text-xs font-medium">
                                    Waiting for user...
                                  </span>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                          <span className="text-xl mb-1 opacity-40">⚡</span>
                          <p className="text-[10px] text-gray-500">no active orders</p>
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
                            className="p-3 bg-[#1a1a1a] rounded-lg border border-emerald-500/15 hover:border-emerald-500/25 hover:bg-[#1d1d1d] transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                className="w-11 h-11 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0 hover:bg-emerald-500/25 transition-colors"
                              >
                                <span className="text-xl">{order.emoji}</span>
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className="text-sm font-medium text-gray-300 truncate">{order.user}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">✓</span>
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
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-bold">${order.amount.toLocaleString()}</span>
                                  <span className="text-xs text-gray-500">{order.fromCurrency}</span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-bold text-emerald-400">+${Math.round(profit)}</div>
                                <div className="text-xs text-gray-600">earned</div>
                              </div>
                              <button
                                onClick={() => handleOpenChat(order.user, order.emoji, order.id)}
                                className="p-2 hover:bg-white/[0.04] rounded-md transition-colors"
                                title="Chat"
                              >
                                <MessageCircle className="w-4 h-4 text-gray-500 hover:text-gray-300" />
                              </button>
                            </div>
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                        <span className="text-xl mb-1 opacity-40">💰</span>
                        <p className="text-[10px] text-gray-500">completed trades appear here</p>
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
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-3">
                <motion.div
                  className="w-2.5 h-2.5 rounded-full border border-white/40"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <span className="text-sm font-semibold">New Orders</span>
                <span className="ml-auto text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
                  {pendingOrders.length}
                </span>
              </div>
              {pendingOrders.length > 0 ? (
                pendingOrders.map((order) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => setSelectedOrderPopup(order)}
                    className="p-3 bg-[#151515] rounded-xl border border-white/[0.06] cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                        className="w-12 h-12 rounded-xl bg-[#252525] flex items-center justify-center text-2xl"
                      >
                        {order.emoji}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm font-medium text-gray-300">{order.user}</span>
                          {order.isNew && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-medium">NEW</span>
                          )}
                          {order.escrowTxHash && order.orderType === 'sell' && (
                            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-medium">
                              <Shield className="w-2.5 h-2.5" />
                              <Check className="w-2 h-2 -ml-0.5" />
                              SECURED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold">${order.amount.toLocaleString()}</span>
                          <span className="text-xs text-gray-500">→</span>
                          <span className="text-base font-bold">د.إ {Math.round(order.total).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-emerald-400">+${Math.round(order.amount * 0.005)}</div>
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
                        className="flex items-center justify-center gap-1.5 mt-2 py-2 bg-emerald-500/10 rounded-lg text-[11px] text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        <Shield className="w-3 h-3" />
                        <span>View Escrow TX</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => acceptOrder(order)}
                      className="w-full mt-3 py-2.5 border border-white/30 hover:bg-white/5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                    >
                      <Zap className="w-4 h-4" />
                      Accept Order
                    </motion.button>
                  </motion.div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <span className="text-3xl mb-2 opacity-40">📭</span>
                  <p className="text-sm text-gray-500">waiting for orders...</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Active View (accepted, awaiting escrow) */}
          {mobileView === 'active' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold">Active</span>
                <span className="ml-auto text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-medium">
                  {activeOrders.length}
                </span>
              </div>
              {activeOrders.length > 0 ? (
                activeOrders.map((order) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 bg-[#151515] rounded-xl border border-blue-500/20"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <button
                        onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                        className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-2xl"
                      >
                        {order.emoji}
                      </button>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{order.user}</p>
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                            {order.orderType === 'buy' ? '⬆️ Buy' : '⬇️ Sell'}
                          </span>
                        </div>
                        <p className="text-lg font-bold">د.إ {Math.round(order.total).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-blue-400">Accepted</p>
                        <p className="text-xs text-gray-500">{order.amount} USDC</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {order.orderType === 'buy' ? (
                        <motion.button
                          whileTap={{ scale: 0.98 }}
                          onClick={() => openEscrowModal(order)}
                          className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-400 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                        >
                          <Lock className="w-4 h-4" />
                          Lock Escrow
                        </motion.button>
                      ) : (
                        <div className="flex-1 py-2.5 bg-gray-500/20 rounded-xl text-sm font-medium text-gray-400 flex items-center justify-center gap-2">
                          Waiting for user to lock escrow...
                        </div>
                      )}
                      <button
                        onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                        className="px-4 py-2.5 border border-white/20 rounded-xl"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <Zap className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm text-gray-500">No active orders</p>
                </div>
              )}
            </div>
          )}

          {/* Mobile: Escrow View */}
          {mobileView === 'escrow' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold">In Escrow</span>
                <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                  {escrowOrders.length}
                </span>
              </div>
              {escrowOrders.length > 0 ? (
                escrowOrders.map((order) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 bg-[#151515] rounded-xl border border-amber-500/20"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <button
                        onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                        className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-2xl"
                      >
                        {order.emoji}
                      </button>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{order.user}</p>
                        <p className="text-lg font-bold">${order.amount.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-amber-400">In Progress</p>
                        <p className="text-xs text-gray-500 font-mono">
                          {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => openReleaseModal(order)}
                        className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-sm font-bold text-black flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Confirm & Release
                      </motion.button>
                      <button
                        onClick={() => { handleOpenChat(order.user, order.emoji, order.id); setMobileView('chat'); }}
                        className="px-4 py-2.5 border border-white/20 rounded-xl"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <Lock className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm text-gray-500">No orders in escrow</p>
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
              <h2 className="text-sm font-semibold mb-4">Trading Stats</h2>

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
                <h3 className="text-sm font-semibold mb-3">Recent Completed</h3>
                <div className="space-y-2">
                  {completedOrders.slice(0, 5).map((order) => (
                    <div key={order.id} className="flex items-center gap-3 p-3 bg-[#151515] rounded-xl">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-lg">
                        {order.emoji}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{order.user}</p>
                        <p className="text-xs text-gray-500">${order.amount.toLocaleString()}</p>
                      </div>
                      <div className="text-emerald-400 text-xs font-medium">
                        <Check className="w-4 h-4" />
                      </div>
                    </div>
                  ))}
                  {completedOrders.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No completed trades yet</p>
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
              {escrowOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {escrowOrders.length}
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
                      {escrowOrder.userWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.userWallet) ? (
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
                        disabled={isLockingEscrow || (solanaWallet.usdtBalance || 0) < escrowOrder.amount || !escrowOrder.userWallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(escrowOrder.userWallet)}
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

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Merchant" accentColor="#c9a962" />

      {/* Wallet Connect Modal */}
      <MerchantWalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
      />

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
                {/* For pending orders with escrow - show Accept then I've Paid */}
                {selectedOrderPopup.status === 'pending' && selectedOrderPopup.escrowTxHash && selectedOrderPopup.orderType === 'sell' && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      await acceptOrder(selectedOrderPopup);
                      // Update popup to show escrow status
                      setSelectedOrderPopup(prev => prev ? { ...prev, status: 'escrow' } : null);
                    }}
                    className="w-full py-3 rounded-xl bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    Accept Order
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
                    Accept Order
                  </motion.button>
                )}

                {/* For escrow orders - show I've Paid button */}
                {selectedOrderPopup.status === 'escrow' && selectedOrderPopup.orderType === 'sell' && (
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
    </div>
  );
}
