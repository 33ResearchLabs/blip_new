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
  MessageCircle,
  Zap,
  DollarSign,
  ArrowRight,
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
  History,
  ShoppingBag,
  CheckCircle2,
  Search,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import { useWebSocketChat } from "@/hooks/useWebSocketChat";
import { useWebSocketChatContextOptional } from "@/context/WebSocketChatContext";
import { useDirectChat } from "@/hooks/useDirectChat";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import { NotificationToastContainer, useToast, ConnectionIndicator, ActionPulse } from "@/components/NotificationToast";
import { MessageHistory } from "@/components/merchant/MessageHistory";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { OrderDetailsPanel } from "@/components/merchant/OrderDetailsPanel";
import { AnalyticsDashboard } from "@/components/merchant/AnalyticsDashboard";
import { TradeChat } from "@/components/merchant/TradeChat";
import { FileUpload } from "@/components/chat/FileUpload";
import { Marketplace } from "@/components/merchant/Marketplace";
import { MyOffers } from "@/components/merchant/MyOffers";
import { MerchantProfileModal } from "@/components/merchant/MerchantProfileModal";
import { TransactionHistoryModal } from "@/components/merchant/TransactionHistoryModal";
import { PaymentMethodModal } from "@/components/merchant/PaymentMethodModal";
import { TopRatedSellers } from "@/components/merchant/TopRatedSellers";
import { RatingModal } from "@/components/RatingModal";
import { MerchantQuoteModal } from "@/components/mempool/MerchantQuoteModal";
import { OrderInspector } from "@/components/mempool/OrderInspector";
import { DashboardWidgets } from "@/components/merchant/DashboardWidgets";
import { Package, Droplets } from "lucide-react";
import { CorridorLPPanel } from "@/components/merchant/CorridorLPPanel";
import { getNextStep, type NextStepResult } from "@/lib/orders/getNextStep";
import { getAuthoritativeStatus, shouldAcceptUpdate, mapMinimalStatusToUIStatus, normalizeLegacyStatus, computeMyRole } from "@/lib/orders/statusResolver";
// New dashboard components
import { ConfigPanel } from "@/components/merchant/ConfigPanel";

import { PendingOrdersPanel } from "@/components/merchant/PendingOrdersPanel";
import { LeaderboardPanel } from "@/components/merchant/LeaderboardPanel";
import { InProgressPanel } from "@/components/merchant/InProgressPanel";
import { ActivityPanel } from "@/components/merchant/ActivityPanel";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useMerchantStore } from "@/stores/merchantStore";

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
      // V2.3: Payment confirmation & disputes
      confirmPayment: async () => ({ txHash: '', success: false }),
      openDispute: async () => ({ txHash: '', success: false }),
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
  minimal_status?: string; // Authoritative 8-state status from API
  order_version?: number;  // Version tracking for state updates
  created_at: string;
  expires_at: string;
  // Timeline timestamps
  accepted_at?: string;
  escrowed_at?: string;
  payment_sent_at?: string;
  completed_at?: string;
  cancelled_at?: string;
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
  // Flag: true if this merchant created the order (can't accept own order)
  is_my_order?: boolean;
  // Role: buyer/seller/observer (authoritative from SQL)
  my_role?: 'buyer' | 'seller' | 'observer';
  // Payment details (includes user_bank_account for sell orders)
  payment_details?: {
    user_bank_account?: string;
    bank_name?: string;
    bank_iban?: string;
  };
  user?: {
    id: string;
    name: string;
    username?: string;
    rating: number;
    total_trades: number;
    wallet_address?: string;
  };
  offer?: {
    payment_method: string;
    location_name?: string;
  };
  // Cancellation info
  cancellation_reason?: string;
  // Message tracking
  unread_count?: number;
  has_manual_message?: boolean;
  message_count?: number;
  last_human_message?: string;
  last_human_message_sender?: string;
  // Spread preference
  spread_preference?: string;
  // Protocol fee
  protocol_fee_percentage?: number | string;
  protocol_fee_amount?: number | string;
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
  minimalStatus?: string; // Authoritative 8-state status (open, accepted, escrowed, payment_sent, completed, cancelled, disputed, expired)
  orderVersion?: number;  // Version for preventing stale updates
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
  // Flag: true if I created this order (can't accept own order)
  isMyOrder?: boolean;
  // Role: buyer/seller/observer
  myRole?: 'buyer' | 'seller' | 'observer';
  // The merchant ID assigned to this order (creator for pending orders)
  orderMerchantId?: string;
  // Message tracking
  unreadCount?: number;
  hasMessages?: boolean;
  lastHumanMessage?: string;
  lastHumanMessageSender?: string;
  // Spread preference
  spreadPreference?: 'best' | 'fastest' | 'cheap';
  // Protocol fee
  protocolFeePercent?: number;
  protocolFeeAmount?: number;
}

// Leaderboard data
interface LeaderboardEntry {
  rank: number;
  id: string;
  displayName: string;
  username: string;
  totalTrades: number;
  totalVolume: number;
  rating: number;
  ratingCount: number;
  isOnline: boolean;
  avgResponseMins: number;
  completedCount: number;
}

// Status mapping now uses the single source of truth in statusResolver.ts:
// - mapMinimalStatusToUIStatus() for minimal 8-state → UI status
// - normalizeLegacyStatus() to convert legacy 12-state → minimal 8-state

// Helper to get emoji from user name
const getUserEmoji = (name: string): string => {
  const emojis = ["🦊", "🦧", "🐋", "🦄", "🔥", "💎", "🐺", "🦁", "🐯", "🐻"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

// Helper to get the effective status for UI rendering
// CRITICAL: Always prefer minimalStatus over status field
const getEffectiveStatus = (order: Order): Order['status'] => {
  // If minimal_status is completed, ALWAYS return completed
  if (order.minimalStatus === 'completed') {
    return 'completed';
  }

  // Use the status field which has already been mapped from minimal_status
  // The status field is set by mapDbOrderToUI which uses minimal_status when available
  return order.status;
};

// Mini Sparkline Component - Shows activity over time
const MiniSparkline = ({ data, color = "emerald", height = 24 }: { data: number[]; color?: string; height?: number }) => {
  const max = Math.max(...data, 1);
  const colorClass = color === "emerald" ? "bg-white/10" : color === "purple" ? "bg-white/10" : "bg-white/10";

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
const mapDbOrderToUI = (dbOrder: DbOrder, merchantId?: string | null): Order => {
  const now = new Date();
  let expiresIn: number;

  if (dbOrder.expires_at) {
    const expiresAt = new Date(dbOrder.expires_at);
    expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  } else {
    // No expires_at yet (pending orders before acceptance) — calculate from created_at + 15 min global timeout
    const createdAt = new Date(dbOrder.created_at);
    const globalTimeoutSec = 15 * 60; // 15 minute global timeout for pending orders
    expiresIn = Math.max(0, Math.floor((createdAt.getTime() + globalTimeoutSec * 1000 - now.getTime()) / 1000));
  }
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

  // USE minimal_status if available (authoritative), otherwise normalize legacy status first
  const minimalStatus = dbOrder.minimal_status || normalizeLegacyStatus(dbOrder.status);
  const uiStatus = mapMinimalStatusToUIStatus(minimalStatus as any, dbOrder.is_my_order);

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
    status: uiStatus,
    minimalStatus: dbOrder.minimal_status, // Store authoritative status
    orderVersion: dbOrder.order_version,   // Store version for update checks
    expiresIn,
    isNew: (dbOrder.user?.total_trades || 0) < 3,
    tradeVolume: (dbOrder.user?.total_trades || 0) * 500, // Estimated volume
    dbOrder,
    // Escrow fields for on-chain release
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    // Determine the recipient wallet for escrow release:
    // 1. M2M: use buyer merchant's wallet OR acceptor_wallet_address (fallback)
    // 2. Buy order (merchant selling to user): buyer is the user, use buyer_wallet_address or user's wallet
    // 3. Sell order (user selling to merchant): buyer is the merchant, use acceptor_wallet_address or merchant's wallet
    userWallet: isM2M
      ? (dbOrder.buyer_merchant?.wallet_address || dbOrder.acceptor_wallet_address)
      : (dbOrder.type === 'buy'
          ? (dbOrder.buyer_wallet_address || dbOrder.user?.wallet_address)
          : (dbOrder.acceptor_wallet_address || dbOrder.buyer_wallet_address || dbOrder.user?.wallet_address)),
    orderType: dbOrder.type,
    // User's bank account (from payment_details) - construct from bank details
    userBankAccount: dbOrder.payment_details
      ? `${dbOrder.payment_details.user_bank_account || dbOrder.payment_details.bank_account_name || 'Unknown'} - ${dbOrder.payment_details.bank_name || 'Unknown Bank'} (${dbOrder.payment_details.bank_iban || 'No IBAN'})`
      : undefined,
    // M2M fields
    isM2M,
    buyerMerchantId: dbOrder.buyer_merchant_id,
    buyerMerchantWallet: dbOrder.buyer_merchant?.wallet_address,
    // Acceptor wallet (for merchant-initiated orders)
    acceptorWallet: dbOrder.acceptor_wallet_address,
    // Flag: true if I created this order (from API is_my_order field)
    isMyOrder: dbOrder.is_my_order,
    // Role: 'buyer' | 'seller' | 'observer'
    // Priority: SQL computed my_role > runtime computeMyRole fallback
    myRole: dbOrder.my_role || (merchantId ? computeMyRole(dbOrder, merchantId) : undefined),
    // The merchant ID assigned to this order (creator for pending orders)
    orderMerchantId: dbOrder.merchant_id,
    // Message tracking
    unreadCount: dbOrder.unread_count || 0,
    hasMessages: (dbOrder.message_count || 0) > 0 || dbOrder.has_manual_message || false,
    lastHumanMessage: dbOrder.last_human_message,
    lastHumanMessageSender: dbOrder.last_human_message_sender,
    // Spread preference
    spreadPreference: dbOrder.spread_preference as Order['spreadPreference'],
    // Protocol fee
    protocolFeePercent: dbOrder.protocol_fee_percentage ? parseFloat(String(dbOrder.protocol_fee_percentage)) : undefined,
    protocolFeeAmount: dbOrder.protocol_fee_amount ? parseFloat(String(dbOrder.protocol_fee_amount)) : undefined,
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

// Leaderboard data loaded from API

// Notifications are managed via useState inside the component

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
  avatar_url?: string | null;
}

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const toast = useToast();
  // ─── Core state from Zustand store (shared across component tree) ───
  const orders = useMerchantStore(s => s.orders);
  const setOrders = useMerchantStore(s => s.setOrders);
  const merchantId = useMerchantStore(s => s.merchantId);
  const setMerchantId = useMerchantStore(s => s.setMerchantId);
  const merchantInfo = useMerchantStore(s => s.merchantInfo);
  const setMerchantInfo = useMerchantStore(s => s.setMerchantInfo);
  const isLoggedIn = useMerchantStore(s => s.isLoggedIn);
  const setIsLoggedIn = useMerchantStore(s => s.setIsLoggedIn);
  // ─── Filter/sort state from store (shared with PendingOrdersPanel) ───
  const searchQuery = useMerchantStore(s => s.searchQuery);
  const setSearchQuery = useMerchantStore(s => s.setSearchQuery);
  // ─── Local UI state (component-scoped, doesn't cascade) ───
  const [activeOffers, setActiveOffers] = useState<{ id: string; type: string; available_amount: number; is_active: boolean }[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);

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
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';
  // In-app balance for mock mode (fetched from DB instead of on-chain)
  // Default to 10000 (MOCK_INITIAL_BALANCE) so balance shows immediately while DB fetch loads
  const [inAppBalance, setInAppBalance] = useState<number | null>(isMockMode ? 10000 : null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ email: "", password: "", confirmPassword: "", businessName: "" });
  const [authTab, setAuthTab] = useState<'signin' | 'create'>('signin');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const isLoading = useMerchantStore(s => s.isLoading);
  const setIsLoading = useMerchantStore(s => s.setIsLoading);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [bigOrders, setBigOrders] = useState<BigOrderRequest[]>(initialBigOrders);
  const [showBigOrderWidget, setShowBigOrderWidget] = useState(false);
  // Responsive: 5-column on wide screens (16"+), 4-column on smaller
  const [isWideScreen, setIsWideScreen] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1536px)');
    setIsWideScreen(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // New dashboard panels
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Profile and transactions modals
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOpenTradeModal, setShowOpenTradeModal] = useState(false);
  const [showMerchantQuoteModal, setShowMerchantQuoteModal] = useState(false);
  const [selectedMempoolOrder, setSelectedMempoolOrder] = useState<any | null>(null);
  const [mempoolOrders, setMempoolOrders] = useState<any[]>([]);
  const [ratingModalData, setRatingModalData] = useState<{
    orderId: string;
    counterpartyName: string;
    counterpartyType: 'user' | 'merchant';
  } | null>(null);
  const [openTradeForm, setOpenTradeForm] = useState({
    tradeType: "sell" as "buy" | "sell", // From merchant perspective: sell = merchant sells USDC to user
    cryptoAmount: "",
    paymentMethod: "bank" as "bank" | "cash",
    spreadPreference: "fastest" as "best" | "fastest" | "cheap",
  });
  const [isCreatingTrade, setIsCreatingTrade] = useState(false);
  const [createTradeError, setCreateTradeError] = useState<string | null>(null);
  const [isMerchantOnline, setIsMerchantOnline] = useState(true);
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
  // (Filter/sort state moved to Zustand store — PendingOrdersPanel subscribes directly)
  // Mobile view state: 'orders' | 'escrow' | 'chat' | 'stats' | 'history'
  const [mobileView, setMobileView] = useState<'orders' | 'escrow' | 'chat' | 'stats' | 'history' | 'marketplace' | 'offers'>('orders');
  const [leaderboardTab, setLeaderboardTab] = useState<'traders' | 'rated' | 'reputation'>('traders');
  // History tab filter: 'completed' | 'cancelled'
  const [historyTab, setHistoryTab] = useState<'completed' | 'cancelled'>('completed');
  const [completedTimeFilter, setCompletedTimeFilter] = useState<'today' | '7days' | 'all'>('all');
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
    timestamp: number;
    read: boolean;
    orderId?: string;
  }[]>([]);

  // Mark notification as read
  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  // Batched notification helper — coalesces rapid-fire events into one state update
  const notifQueueRef = useRef<typeof notifications>([]);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addNotification = useCallback((type: 'order' | 'escrow' | 'payment' | 'dispute' | 'complete' | 'system', message: string, orderId?: string) => {
    notifQueueRef.current.push({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      message,
      timestamp: Date.now(),
      read: false,
      orderId,
    });
    if (!notifTimerRef.current) {
      notifTimerRef.current = setTimeout(() => {
        const batch = notifQueueRef.current;
        notifQueueRef.current = [];
        notifTimerRef.current = null;
        if (batch.length > 0) {
          setNotifications(prev => [...batch.reverse(), ...prev].slice(0, 50));
        }
      }, 200);
    }
  }, []);

  // Order conversations state (for sidebar Messages section)
  const [orderConversations, setOrderConversations] = useState<{
    order_id: string;
    order_number: string;
    order_status: string;
    order_type: 'buy' | 'sell';
    crypto_amount: number;
    fiat_amount: number;
    fiat_currency: string;
    order_created_at: string;
    has_manual_message: boolean;
    user: {
      id: string;
      username: string;
      rating: number;
      total_trades: number;
    };
    message_count: number;
    unread_count: number;
    last_message: {
      id: string;
      content: string;
      sender_type: string;
      message_type: string;
      created_at: string;
      is_read: boolean;
    } | null;
    last_activity: string;
  }[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Active chat order details (for timeline when order not in main orders list)
  const [activeChatOrderDetails, setActiveChatOrderDetails] = useState<DbOrder | null>(null);

  // Fetch order details for timeline when opening chat
  const fetchOrderDetailsForChat = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setActiveChatOrderDetails(data.data);
      }
    } catch (error) {
      console.error('[Chat] Failed to fetch order details:', error);
    }
  }, []);

  // Fetch order conversations for sidebar
  const convAbortRef = useRef<AbortController | null>(null);
  const fetchOrderConversations = useCallback(async () => {
    if (!merchantId) return;
    convAbortRef.current?.abort();
    const controller = new AbortController();
    convAbortRef.current = controller;

    setIsLoadingConversations(true);
    try {
      const res = await fetch(`/api/merchant/messages?merchant_id=${merchantId}&limit=50`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOrderConversations(data.data.conversations || []);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch order conversations:', error);
    } finally {
      if (!controller.signal.aborted) setIsLoadingConversations(false);
    }
  }, [merchantId]);

  // Keep ref updated for use in callbacks
  useEffect(() => {
    fetchOrderConversationsRef.current = fetchOrderConversations;
  }, [fetchOrderConversations]);

  // Fetch conversations when logged in
  useEffect(() => {
    if (merchantId && isLoggedIn) {
      fetchOrderConversations();
    }
  }, [merchantId, isLoggedIn, fetchOrderConversations]);

  // Add welcome notification + load history when merchant logs in
  const hasShownWelcome = useRef(false);
  useEffect(() => {
    if (merchantId && isLoggedIn && !hasShownWelcome.current) {
      hasShownWelcome.current = true;
      addNotification('system', 'Welcome back! You are now online.');

      // Load notification history from DB
      fetch(`/api/merchant/notifications?merchantId=${merchantId}&limit=50`)
        .then(res => res.json())
        .then(data => {
          if (data.notifications?.length) {
            const eventTypeMap: Record<string, 'order' | 'escrow' | 'payment' | 'dispute' | 'complete' | 'system'> = {
              ORDER_CREATED: 'order',
              ORDER_ACCEPTED: 'order',
              ORDER_ESCROWED: 'escrow',
              ORDER_PAYMENT_SENT: 'payment',
              ORDER_PAYMENT_CONFIRMED: 'payment',
              ORDER_COMPLETED: 'complete',
              ORDER_CANCELLED: 'system',
              ORDER_EXPIRED: 'system',
              ORDER_DISPUTED: 'dispute',
            };
            const buildHistoryMsg = (n: any): string => {
              const amt = n.crypto_amount ? `${parseFloat(n.crypto_amount).toLocaleString()} USDC` : '';
              const fiat = n.fiat_amount ? `${parseFloat(n.fiat_amount).toLocaleString()} AED` : '';
              const user = n.user_name || '';
              const typeLabel = n.order_type === 'buy' ? 'Sell' : 'Buy';
              switch (n.event_type) {
                case 'ORDER_CREATED': return `New ${typeLabel} order · ${amt}${fiat ? ` → ${fiat}` : ''}`;
                case 'ORDER_ACCEPTED': return `Order accepted · ${amt}${user ? ` · ${user}` : ''}`;
                case 'ORDER_ESCROWED': return `Escrow locked · ${amt} secured`;
                case 'ORDER_PAYMENT_SENT': return `Payment marked sent · ${amt}${user ? ` · ${user}` : ''}`;
                case 'ORDER_PAYMENT_CONFIRMED': return `Payment confirmed · ${amt} · Ready to release`;
                case 'ORDER_COMPLETED': return `Trade completed! ${amt}${fiat ? ` → ${fiat}` : ''}`;
                case 'ORDER_CANCELLED': return `Order cancelled · ${amt}${user ? ` · ${user}` : ''}`;
                case 'ORDER_EXPIRED': return `Order expired · ${amt} timed out`;
                case 'ORDER_DISPUTED': return `Dispute opened · ${amt}${user ? ` · ${user}` : ''}`;
                default: return n.event_type;
              }
            };
            const history = data.notifications.map((n: any) => ({
              id: `db-${n.id}`,
              type: eventTypeMap[n.event_type] || 'system',
              message: buildHistoryMsg(n),
              timestamp: new Date(n.created_at).getTime(),
              read: true, // historical = already read
              orderId: n.order_id,
            }));
            setNotifications(prev => [...prev, ...history]);
          }
        })
        .catch(() => {}); // silent fail — not critical
    }
  }, [merchantId, isLoggedIn, addNotification]);

  // Real-time Pusher context
  const { setActor } = usePusher();

  // Set actor when merchant ID is available
  useEffect(() => {
    if (merchantId) {
      setActor('merchant', merchantId);
    }
  }, [merchantId, setActor]);

  // Ref to hold fetchOrderConversations for use in callbacks
  const fetchOrderConversationsRef = useRef<(() => Promise<void>) | undefined>(undefined);

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
    onNewMessage: (chatId?: string, message?: { from: string; text: string }) => {
      playSound('message');
      fetchOrderConversationsRef.current?.();
      if (message && message.from !== 'me') {
        toast.showNewMessage('User', message.text?.substring(0, 80));
      }
    },
  });

  // Direct chat hook (people-based messaging)
  const directChat = useDirectChat({ merchantId: merchantId || undefined });

  // WebSocket context for order events (effect is below, after fetchOrders is defined)
  const wsContext = useWebSocketChatContextOptional();

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
      } else {
        throw new Error(data.error || 'Failed to create merchant');
      }
    } catch (error) {
      console.error('Set merchant username error:', error);
      throw error;
    }
  };

  // Handle profile picture update
  const handleProfileUpdated = (avatarUrl: string, displayName?: string, bio?: string) => {
    if (merchantInfo) {
      const updatedInfo = {
        ...merchantInfo,
        avatar_url: avatarUrl || merchantInfo.avatar_url,
        ...(displayName !== undefined && { display_name: displayName }),
        ...(bio !== undefined && { bio }),
      };
      setMerchantInfo(updatedInfo);
      localStorage.setItem('blip_merchant', JSON.stringify(updatedInfo));
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
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        localStorage.setItem('blip_merchant', JSON.stringify(data.data.merchant));
        // Prompt to connect wallet if merchant doesn't have one linked (skip in mock mode)
        if (!isMockMode && !data.data.merchant.wallet_address) {
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        // Map API errors to user-friendly messages
        if (res.status === 401) {
          setLoginError('Incorrect email or password. Please try again.');
        } else if (res.status === 404) {
          setLoginError('No account found with this email. Please create an account first.');
        } else {
          setLoginError(data.error || 'Login failed');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Connection failed. Please check your internet and try again.');
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
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        localStorage.setItem('blip_merchant', JSON.stringify(data.data.merchant));
        // Prompt to connect wallet after registration (skip in mock mode)
        if (!isMockMode) {
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        // Map API errors to user-friendly messages
        if (res.status === 409) {
          setLoginError('An account with this email already exists. Please sign in instead.');
        } else {
          setLoginError(data.error || 'Registration failed');
        }
      }
    } catch (err) {
      console.error('Registration error:', err);
      setLoginError('Connection failed. Please check your internet and try again.');
    } finally {
      setIsRegistering(false);
    }
  };

  // Handle logout and disconnect wallet
  const handleLogout = () => {
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
              // Prompt to connect wallet if not linked (skip in mock mode)
              if (!isMockMode && !freshMerchant.wallet_address && !solanaWallet.connected) {
                setTimeout(() => setShowWalletPrompt(true), 1000);
              }
              return;
            }
          }
          // Session invalid, clear it
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

  // Add dashboard-layout class to body when logged in (for non-scrollable layout)
  useEffect(() => {
    if (isLoggedIn && merchantId) {
      document.body.classList.add('dashboard-layout');
    } else {
      document.body.classList.remove('dashboard-layout');
    }

    return () => {
      document.body.classList.remove('dashboard-layout');
    };
  }, [isLoggedIn, merchantId]);

  // AbortController: cancel stale fetchOrders when a newer one starts
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    if (!merchantId) {
      return;
    }

    // Validate merchantId is a valid UUID before making API call
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(merchantId)) {
      console.error('[Merchant] fetchOrders: Invalid merchantId format:', merchantId);
      return;
    }

    // Abort any in-flight fetch — stale responses must never overwrite newer data
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      // Fetch ALL pending orders (broadcast model) + merchant's own orders
      const res = await fetch(`/api/merchant/orders?merchant_id=${merchantId}&include_all_pending=true&_t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        console.error('[Merchant] Failed to fetch orders:', res.status, res.statusText, errorBody);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        const mappedOrders = data.data.map((o: DbOrder) => mapDbOrderToUI(o, merchantId));

        // Fix status for my escrowed orders
        // The SQL query should set is_my_order correctly, but this is a fallback
        const fixedOrders = mappedOrders.map((order: Order) => {
          // CRITICAL SAFEGUARD: If minimal_status is completed, ALWAYS show as completed
          if (order.minimalStatus === 'completed') {
            return { ...order, status: 'completed' as const };
          }

          // If database says it's my order and it's escrowed, show it in Ongoing
          if (order.isMyOrder && order.dbOrder?.status === 'escrowed' && getEffectiveStatus(order) === 'pending') {
            return { ...order, status: 'escrow' as const };
          }
          return order;
        });

        // Filter out pending orders that have already expired
        const validOrders = fixedOrders.filter((order: Order) => {
          const effectiveStatus = getEffectiveStatus(order);
          if (effectiveStatus === "pending" && order.expiresIn <= 0) {
            return false;
          }
          return true;
        });


        // VERSION-AWARE MERGE: Only update orders if incoming is newer
        setOrders(prev => {
          return validOrders.map(incomingOrder => {
            const existing = prev.find(o => o.id === incomingOrder.id);

            // If no existing order, use incoming
            if (!existing) return incomingOrder;

            // Version check: only update if incoming is newer
            if (existing.orderVersion && incomingOrder.orderVersion) {
              if (incomingOrder.orderVersion < existing.orderVersion) {
                return existing;
              }
            }

            // CRITICAL SAFEGUARD: If incoming is completed, ALWAYS use it
            if (incomingOrder.minimalStatus === 'completed') {
              return incomingOrder;
            }

            // Otherwise use incoming as it's newer or same version
            return incomingOrder;
          });
        });
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return; // Superseded by newer fetch
      console.error("[Merchant] Error fetching orders:", error);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [merchantId]);

  // ── Debounced fetch: coalesces multiple fetchOrders() calls into one ──
  const fetchPendingRef = useRef(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchOrders = useCallback(() => {
    if (fetchPendingRef.current) return; // Already scheduled
    fetchPendingRef.current = true;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchOrders().finally(() => {
        fetchPendingRef.current = false;
        fetchTimerRef.current = null;
      });
    }, 150); // 150ms coalescing window
  }, [fetchOrders]);

  const convFetchPendingRef = useRef(false);
  const convFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchConversations = useCallback(() => {
    if (convFetchPendingRef.current) return;
    convFetchPendingRef.current = true;
    if (convFetchTimerRef.current) clearTimeout(convFetchTimerRef.current);
    convFetchTimerRef.current = setTimeout(() => {
      fetchOrderConversations().finally(() => {
        convFetchPendingRef.current = false;
        convFetchTimerRef.current = null;
      });
    }, 150);
  }, [fetchOrderConversations]);

  // Keyboard shortcuts for dashboard
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField = ['INPUT', 'TEXTAREA'].includes(target.tagName);

      // "/" to focus search
      if (e.key === '/' && !isInputField) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]');
        searchInput?.focus();
      }

      // "R" to refresh orders (not Cmd+R or Ctrl+R)
      if ((e.key === 'r' || e.key === 'R') && !isInputField && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        fetchOrders();
      }
    };

    if (isLoggedIn) {
      window.addEventListener('keydown', handleKeyPress);
      return () => window.removeEventListener('keydown', handleKeyPress);
    }
  }, [isLoggedIn, fetchOrders]);

  // Update merchant wallet address when connected
  // This ensures email/password merchants can link their wallet for escrow releases
  useEffect(() => {
    const updateMerchantWallet = async () => {
      // Only update if we have both merchantId and wallet address
      if (!merchantId || !solanaWallet.walletAddress) return;

      // Check if merchant already has this wallet linked (from merchantInfo)
      if (merchantInfo?.wallet_address === solanaWallet.walletAddress) {
        return;
      }

      try {
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

  // Fetch in-app balance from DB (mock mode)
  const balanceAbortRef = useRef<AbortController | null>(null);
  const fetchInAppBalance = useCallback(async () => {
    if (!merchantId || !isMockMode) return;
    balanceAbortRef.current?.abort();
    const controller = new AbortController();
    balanceAbortRef.current = controller;
    try {
      const res = await fetch(`/api/mock/balance?userId=${merchantId}&type=merchant`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setInAppBalance(typeof data.balance === 'string' ? parseFloat(data.balance) : data.balance);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Failed to fetch in-app balance:', err);
    }
  }, [merchantId, isMockMode]);

  useEffect(() => {
    if (isMockMode && merchantId) {
      fetchInAppBalance();
      const interval = setInterval(fetchInAppBalance, 30000);
      return () => clearInterval(interval);
    }
  }, [isMockMode, merchantId, fetchInAppBalance]);

  // Effective balance: in-app for mock mode, on-chain for production
  const effectiveBalance = isMockMode ? inAppBalance : solanaWallet.usdtBalance;
  const refreshBalance = useCallback(() => {
    if (isMockMode) {
      fetchInAppBalance();
    } else {
      solanaWallet.refreshBalances();
    }
  }, [isMockMode, fetchInAppBalance, solanaWallet]);

  // Fetch mempool orders
  const mempoolAbortRef = useRef<AbortController | null>(null);
  const fetchMempoolOrders = useCallback(async () => {
    if (!merchantId) return;
    mempoolAbortRef.current?.abort();
    const controller = new AbortController();
    mempoolAbortRef.current = controller;
    try {
      const res = await fetch('/api/mempool?type=orders&corridor_id=USDT_AED&limit=50', { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.orders) {
          const stamped = data.data.orders.map((o: any) => ({ ...o, _receivedAt: Date.now() }));
          setMempoolOrders(stamped);
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch mempool orders:', error);
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
        setActiveOffers(data.data.filter((o: { is_active: boolean }) => o.is_active));
      }
    } catch (err) {
      console.error('Failed to fetch active offers:', err);
    }
  }, [merchantId]);

  // Fetch leaderboard data
  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/merchants/leaderboard');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setLeaderboardData(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    }
  }, []);

  // Fetch orders when merchant ID is available
  // Real-time updates come via Pusher WebSocket (useRealtimeOrders hook)
  useEffect(() => {
    if (!merchantId) return;
    fetchOrders();
    fetchMempoolOrders();
    fetchResolvedDisputes();
    fetchBigOrders();
    fetchActiveOffers();
    fetchLeaderboard();
  }, [merchantId, fetchOrders, fetchMempoolOrders, fetchResolvedDisputes, fetchBigOrders, fetchActiveOffers, fetchLeaderboard]);

  // 3-tier real-time fallback:
  // Tier 1: Pusher WebSocket (primary - handled by useRealtimeOrders)
  // Tier 2: Smart polling (safety net when connected, primary when disconnected)
  // Tier 3: Tab visibility + reconnect refresh
  const { isConnected: isPusherConnected } = usePusher();
  const prevPusherConnected = useRef(isPusherConnected);
  const lastSyncRef = useRef<number>(Date.now());

  // Tier 2: Smart polling - always poll, just adjust frequency
  // Uses debounced fetch to prevent thundering herd when multiple events arrive
  useEffect(() => {
    if (!merchantId) return;

    const pollInterval = isPusherConnected ? 30000 : 5000; // 30s safety net vs 5s primary

    const interval = setInterval(() => {
      debouncedFetchOrders();
      fetchMempoolOrders();
      lastSyncRef.current = Date.now();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [merchantId, isPusherConnected, debouncedFetchOrders, fetchMempoolOrders]);

  // Tier 3a: Force refresh when Pusher reconnects (false→true)
  useEffect(() => {
    if (isPusherConnected && !prevPusherConnected.current) {
      debouncedFetchOrders();
      fetchMempoolOrders();
      lastSyncRef.current = Date.now();
    }
    prevPusherConnected.current = isPusherConnected;
  }, [isPusherConnected, debouncedFetchOrders, fetchMempoolOrders]);

  // Tier 3b: Page Visibility API — refresh when tab becomes visible
  useEffect(() => {
    if (!merchantId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceSync = Date.now() - lastSyncRef.current;
        // Only refresh if it's been more than 3s since last sync (avoid duplicate fetches)
        if (timeSinceSync > 3000) {
          debouncedFetchOrders();
          lastSyncRef.current = Date.now();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [merchantId, debouncedFetchOrders]);

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
      debouncedFetchOrders();
      debouncedFetchConversations();
      // Only show notification/sound/toast for orders relevant to this merchant
      // (assigned to me or I'm the buyer). Other merchants' orders still appear
      // in the order list via fetchOrders but don't trigger disruptive alerts.
      const isRelevant = order?.merchant_id === merchantId || order?.buyer_merchant_id === merchantId;
      if (isRelevant) {
        playSound('new_order');
        const typeLabel = order?.type === 'buy' ? 'Sell' : 'Buy';
        const amt = order?.crypto_amount ? `${Number(order.crypto_amount).toLocaleString()} USDC` : '';
        const fiat = order?.fiat_amount ? `${Number(order.fiat_amount).toLocaleString()} AED` : '';
        addNotification('order',
          order ? `New ${typeLabel} order · ${amt}${fiat ? ` → ${fiat}` : ''}` : 'New order received',
          order?.id);
        toast.showOrderCreated(
          order ? `${typeLabel} ${order.crypto_amount} USDC for ${order.fiat_amount} AED` : undefined
        );
      }
    },
    onOrderStatusUpdated: (orderId, newStatus, orderData?: any) => {
      // CRITICAL: Don't do optimistic updates - they can overwrite fresher data
      // Just refetch orders from server to get authoritative minimal_status

      // Debounced refetch to get latest state with minimal_status
      debouncedFetchOrders();
      debouncedFetchConversations();
      // Helper: check if this order is relevant to us (our offer or we're buyer)
      // Used to suppress noisy notifications from global broadcast statuses
      const matchedOrder = orders.find(o => o.id === orderId);
      const isRelevantOrder = () => {
        return matchedOrder && (matchedOrder.orderMerchantId === merchantId || matchedOrder.buyerMerchantId === merchantId);
      };
      // Build descriptive suffix from order data
      const amt = matchedOrder ? `${matchedOrder.amount.toLocaleString()} USDC` : '';
      const usr = matchedOrder?.user || '';
      const desc = amt ? (usr ? `${amt} · ${usr}` : amt) : '';

      if (newStatus === 'payment_sent') {
        addNotification('payment', desc ? `Payment marked sent · ${desc}` : 'Payment sent for order', orderId);
        playSound('notification');
        toast.showPaymentSent(orderId);
      } else if (newStatus === 'escrowed') {
        addNotification('escrow', amt ? `Escrow locked · ${amt} secured` : 'Escrow locked on order', orderId);
        playSound('notification');
        toast.showEscrowLocked();
      } else if (newStatus === 'completed') {
        addNotification('complete', desc ? `Trade completed! ${desc}` : 'Trade completed!', orderId);
        playSound('order_complete');
        toast.showTradeComplete();
        refreshBalance();
      } else if (newStatus === 'disputed') {
        addNotification('dispute', desc ? `Dispute opened · ${desc}` : 'Dispute opened on order', orderId);
        playSound('error');
        toast.showDisputeOpened(orderId);
      } else if (newStatus === 'cancelled') {
        // 'cancelled' is broadcast to all merchants - only notify involved ones
        if (isRelevantOrder()) {
          addNotification('system', desc ? `Order cancelled · ${desc}` : 'Order cancelled', orderId);
          playSound('error');
          toast.showOrderCancelled();
        }
      } else if (newStatus === 'expired') {
        // 'expired' is broadcast to all merchants - only notify involved ones
        if (isRelevantOrder()) {
          addNotification('system', amt ? `Order expired · ${amt} timed out` : 'Order expired', orderId);
          toast.showOrderExpired();
        }
      } else if (newStatus === 'accepted') {
        // 'accepted' is broadcast to all merchants - only notify involved ones
        if (isRelevantOrder()) {
          addNotification('order', desc ? `Order accepted · ${desc}` : 'Order accepted', orderId);
          playSound('notification');
          toast.show({ type: 'order', title: 'Order Accepted', message: 'An order has been accepted' });
        }
      } else if (newStatus === 'payment_confirmed') {
        addNotification('payment', amt ? `Payment confirmed · ${amt} · Ready to release` : 'Payment confirmed!', orderId);
        playSound('notification');
        toast.show({ type: 'payment', title: 'Payment Confirmed', message: 'Payment has been confirmed. Ready to release.' });
      }
    },
    onExtensionRequested: (data) => {
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
        toast.showExtensionRequest('User', data.extensionMinutes);
      }
    },
    onExtensionResponse: (data) => {
      setExtensionRequests(prev => {
        const newMap = new Map(prev);
        newMap.delete(data.orderId);
        return newMap;
      });
      if (data.accepted) {
        addNotification('system', 'Extension accepted', data.orderId);
        debouncedFetchOrders();
        toast.show({ type: 'system', title: 'Extension Accepted', message: 'Time has been extended' });
      } else {
        addNotification('system', `Extension declined - order ${data.newStatus || 'updated'}`, data.orderId);
        debouncedFetchOrders();
        toast.showWarning('Extension request was declined');
      }
    },
  });

  // WS order events handled by useRealtimeOrders (unified Pusher+WS stream).

  // Expiry timer: only decrement counters, NO API calls inside setOrders.
  const expiryBatchRef = useRef<string[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => {
        let hasChanges = false;
        const updated = prev.map(order => {
          if (order.status === "completed" || order.status === "cancelled") return order;
          if (order.expiresIn <= 0) return order; // Already at 0, no clone needed
          hasChanges = true;
          return { ...order, expiresIn: Math.max(0, order.expiresIn - 1) };
        });
        return hasChanges ? updated : prev; // Skip re-render if nothing changed
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Handle expired orders: separate effect, batched API calls, runs max once per 5s
  const lastExpiryRunRef = useRef<number>(0);
  useEffect(() => {
    // Throttle: don't run more than once per 5 seconds
    const now = Date.now();
    if (now - lastExpiryRunRef.current < 5000) return;

    const expiredPending = orders.filter(o => o.status === "pending" && o.expiresIn <= 0);
    const expiredEscrow = orders.filter(o => o.status === "escrow" && o.expiresIn <= 0);

    if (expiredPending.length === 0 && expiredEscrow.length === 0) return;
    lastExpiryRunRef.current = now;

    // Batch expire all pending orders
    if (expiredPending.length > 0) {
      // Remove from UI immediately
      setOrders(prev => prev.filter(o => !(o.status === "pending" && o.expiresIn <= 0)));

      // Fire API calls in parallel, then single refetch
      Promise.allSettled(
        expiredPending.map(order =>
          fetch(`/api/orders/${order.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'expired',
              actor_type: 'system',
              actor_id: '00000000-0000-0000-0000-000000000000',
            }),
          }).catch(() => {}) // Swallow individual errors
        )
      ).then(() => fetchOrders());
    }

    // Handle expired escrow orders
    for (const order of expiredEscrow) {
      fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'expired',
          actor_type: 'system',
          actor_id: '00000000-0000-0000-0000-000000000000',
        }),
      }).catch(() => {});

      const iAmEscrowCreator = order.escrowCreatorWallet === solanaWallet.walletAddress;
      if (iAmEscrowCreator && order.escrowTradeId !== undefined) {
        addNotification('system', `Order ${order.id} has expired! Click "Cancel & Withdraw" to refund your USDC.`, order.id);
      }
    }
  }, [orders, solanaWallet.walletAddress, fetchOrders, addNotification]);

  // Background polling + visibility handled by Tier 2/3 smart polling above.

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

    // Check if order is already escrowed by someone else (M2M flow)
    const isEscrowedByOther = order.escrowTxHash && order.dbOrder?.status === 'escrowed';

    // Debug logging

    // For M2M where seller already escrowed: require wallet to receive funds (skip in mock mode)
    if (!isMockMode && isEscrowedByOther && !solanaWallet.walletAddress) {
      addNotification('system', 'Please connect your wallet first to receive the USDC.', order.id);
      setShowWalletModal(true);
      return;
    }

    try {
      // If escrow is already funded by seller, call acceptTrade on-chain first (skip in mock mode)
      if (!isMockMode && isEscrowedByOther && order.escrowCreatorWallet && order.escrowTradeId != null) {
        addNotification('system', 'Joining escrow on-chain... Please approve the transaction.', order.id);

        try {
          const acceptResult = await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });

          if (!acceptResult.success) {
            console.error('[Go] Failed to accept trade on-chain:', acceptResult.error);
            addNotification('system', `Failed to join escrow: ${acceptResult.error}`, order.id);
            playSound('error');
            return;
          }

          addNotification('system', 'Successfully joined escrow on-chain!', order.id);
        } catch (acceptError) {
          console.error('[Go] Error accepting trade on-chain:', acceptError);
          addNotification('system', `Failed to join escrow: ${acceptError instanceof Error ? acceptError.message : 'Unknown error'}`, order.id);
          playSound('error');
          return;
        }
      } else if (isMockMode && isEscrowedByOther) {
      }

      // Build the request body
      // Always go to 'accepted' first - buyer will then Sign to move to payment_pending
      const targetStatus = "accepted";
      const requestBody: Record<string, unknown> = {
        status: targetStatus,
        actor_type: "merchant",
        actor_id: merchantId,
      };

      // Include wallet address if connected (skip mock addresses that fail Solana validation)
      if (solanaWallet.walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaWallet.walletAddress)) {
        requestBody.acceptor_wallet_address = solanaWallet.walletAddress;
      }


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

      // Show appropriate message based on buyer/seller role
      // After accepting, I become the counterparty. Use myRole to determine message.
      // Note: after accepting a BUY order, I become the seller (merchant_id reassigned).
      // After accepting a SELL order, I become the buyer (buyer_merchant_id set).
      const acceptRole = isBuyOrder ? 'seller' : 'buyer'; // Acceptor's role after accepting
      const nextStepMsg = isEscrowedByOther
        ? 'Order claimed! Send the fiat payment and click "I\'ve Paid".'
        : acceptRole === 'seller'
          ? 'Now lock your USDC in escrow to proceed.'
          : 'Waiting for the seller to lock escrow.';

      // Use AfterMutationReconcile: optimistic update + refetch all + balance
      const uiStatus = isEscrowedByOther ? "escrow" : "active";
      playSound('click');
      addNotification('system', `Order accepted! ${nextStepMsg}`, order.id);
      handleOpenChat(order);
      await afterMutationReconcile(order.id, { status: uiStatus as "escrow" | "active", expiresIn: 1800 });
    } catch (error) {
      console.error("Error accepting order:", error);
      playSound('error');
    }
  };

  // Accept order using sAED corridor bridge
  // Step 1: Auto-match LP, lock buyer sAED
  // Step 2: Normal accept flow
  const acceptWithSaed = async (order: Order) => {
    if (!merchantId) return;

    try {
      addNotification('system', 'Matching LP and locking sAED...', order.id);

      // Get the seller's bank details from the order
      const bankDetails = order.dbOrder?.payment_details || {};

      // Step 1: Call corridor match via core-api
      const coreApiUrl = process.env.NEXT_PUBLIC_CORE_API_URL || 'http://localhost:4010';
      const matchRes = await fetch(`${coreApiUrl}/v1/corridor/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          buyer_merchant_id: merchantId,
          seller_merchant_id: order.dbOrder?.merchant_id || order.orderMerchantId,
          fiat_amount: order.total || order.dbOrder?.fiat_amount,
          bank_details: bankDetails,
        }),
      });

      const matchData = await matchRes.json();
      if (!matchData.success) {
        addNotification('system', `LP match failed: ${matchData.error}`, order.id);
        playSound('error');
        return;
      }

      const { fee_percentage, corridor_fee_fils, saed_locked, provider_name } = matchData.data;
      addNotification(
        'system',
        `LP matched: ${provider_name || 'Provider'} (${fee_percentage}% fee, ${(corridor_fee_fils / 100).toFixed(2)} AED). ${(saed_locked / 100).toFixed(2)} sAED locked.`,
        order.id
      );

      // Step 2: Normal accept
      await acceptOrder(order);

      playSound('click');
    } catch (error) {
      console.error('Error accepting with sAED:', error);
      addNotification('system', 'Failed to accept with sAED. Try again.', order.id);
      playSound('error');
    }
  };

  // Buyer signs to claim order (for M2M where seller already escrowed)
  // This just claims the order without marking payment sent yet
  const signToClaimOrder = async (order: Order) => {
    if (!merchantId) return;

    // Require wallet connection for signing (skip in mock mode)
    if (!isMockMode && !solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to sign.');
      setShowWalletModal(true);
      return;
    }

    if (!isMockMode && (!solanaWallet.walletAddress || !solanaWallet.signMessage)) {
      addNotification('system', 'Wallet not ready. Please reconnect.');
      playSound('error');
      return;
    }

    try {
      // Sign message to prove wallet ownership and claim the order
      const walletAddr = solanaWallet.walletAddress || 'mock-wallet';
      const message = `Claim order ${order.id} - I will send fiat payment. Wallet: ${walletAddr}`;
      const messageBytes = new TextEncoder().encode(message);

      addNotification('system', isMockMode ? 'Processing...' : 'Please sign in your wallet to claim this order...', order.id);
      let signature = 'mock-signature';
      if (!isMockMode) {
        const signatureBytes = await solanaWallet.signMessage(messageBytes);
        signature = Buffer.from(signatureBytes).toString('base64');
      }

      // Update order to payment_pending (claimed, now needs to pay)

      const claimBody: Record<string, string> = {
          status: "payment_pending",
          actor_type: "merchant",
          actor_id: merchantId,
      };
      if (!isMockMode && solanaWallet.walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaWallet.walletAddress)) {
        claimBody.acceptor_wallet_address = solanaWallet.walletAddress;
        claimBody.acceptor_wallet_signature = signature;
      }

      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimBody),
      });

      const responseData = await res.json().catch(() => ({}));

      if (!res.ok) {
        addNotification('system', `Failed to claim order: ${responseData.error || 'Unknown error'}`, order.id);
        playSound('error');
        return;
      }

      // AfterMutationReconcile: optimistic update + refetch all + balance
      playSound('click');
      addNotification('system', 'Order claimed! Now send the fiat payment and click "I\'ve Paid".', order.id);
      await afterMutationReconcile(order.id, { status: "escrow" as const });
    } catch (error: any) {
      if (error?.message?.includes('User rejected')) {
        addNotification('system', 'Signature rejected. Please sign to claim.');
      } else {
        console.error("Error signing:", error);
        addNotification('system', 'Failed to sign. Please try again.');
      }
      playSound('error');
    }
  };

  // Sign and proceed for sell orders (Active -> Ongoing)
  // Merchant signs to confirm they will send fiat payment
  const signAndProceed = async (order: Order) => {
    if (!merchantId) return;

    // Require wallet connection for signing (skip in mock mode)
    if (!isMockMode && !solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to sign.');
      setShowWalletModal(true);
      return;
    }

    if (!isMockMode && (!solanaWallet.walletAddress || !solanaWallet.signMessage)) {
      addNotification('system', 'Wallet not ready. Please reconnect.');
      playSound('error');
      return;
    }

    try {
      // Sign message to prove wallet ownership
      const walletAddr = solanaWallet.walletAddress || 'mock-wallet';
      const message = `Confirm order ${order.id} - I will send fiat payment. Wallet: ${walletAddr}`;
      const messageBytes = new TextEncoder().encode(message);

      addNotification('system', isMockMode ? 'Processing...' : 'Please sign in your wallet to proceed...', order.id);
      let signature = 'mock-signature';
      if (!isMockMode) {
        const signatureBytes = await solanaWallet.signMessage(messageBytes);
        signature = Buffer.from(signatureBytes).toString('base64');
      }

      // Update order to payment_sent (moves to Ongoing)
      const proceedBody: Record<string, string> = {
        status: "payment_sent",
        actor_type: "merchant",
        actor_id: merchantId,
      };
      if (!isMockMode && solanaWallet.walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaWallet.walletAddress)) {
        proceedBody.acceptor_wallet_address = solanaWallet.walletAddress;
        proceedBody.acceptor_wallet_signature = signature;
      }

      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proceedBody),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        addNotification('system', `Failed to update order: ${errorData.error || 'Unknown error'}`, order.id);
        playSound('error');
        return;
      }

      // AfterMutationReconcile: optimistic update + refetch all + balance
      playSound('click');
      addNotification('system', 'Signed! Order moved to Ongoing. Click "I\'ve Paid" when you send the fiat.', order.id);
      await afterMutationReconcile(order.id, { status: "escrow" as const });
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

    // Only the SELLER locks escrow. Period.
    const role = order.myRole || computeMyRole(order, merchantId);
    if (role !== 'seller') {
      addNotification('system', 'Only the seller locks escrow in this trade.');
      return;
    }

    // Check wallet connection (skip in mock mode - uses in-app coins)
    if (!isMockMode && !solanaWallet.connected) {
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
          orderToUse = mapDbOrderToUI(data.data, merchantId);
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

    // Check balance (only if loaded)
    // If balance is null (still loading), allow to proceed - backend will validate
    if (effectiveBalance !== null && effectiveBalance < escrowOrder.amount) {
      setEscrowError(`Insufficient USDC balance. You need ${escrowOrder.amount} USDC but have ${effectiveBalance.toFixed(2)} USDC.`);
      return;
    }

    // If balance is still null, refresh it first
    if (effectiveBalance === null) {
      await refreshBalance();
      // Give it a moment to update
      await new Promise(r => setTimeout(r, 500));
      const newBalance = isMockMode ? inAppBalance : solanaWallet.usdtBalance;
      if (newBalance !== null && newBalance < escrowOrder.amount) {
        setEscrowError(`Insufficient USDC balance. You need ${escrowOrder.amount} USDC but have ${newBalance.toFixed(2)} USDC.`);
        return;
      }
    }

    // Determine recipient wallet for escrow
    // The recipient is the OTHER party (not the one locking escrow)
    // For SELL orders before anyone accepts: no recipient yet, escrow goes to treasury placeholder
    const validWalletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    // In mock mode, accept any non-empty string as a valid wallet (DB-backed, not Solana addresses)
    const isValidWallet = (addr: string | undefined | null): boolean => {
      if (!addr) return false;
      return isMockMode ? addr.length > 0 : validWalletRegex.test(addr);
    };
    const myWallet = solanaWallet.walletAddress;

    // Check wallet validity
    const hasAcceptorWallet = isValidWallet(escrowOrder.acceptorWallet);
    const hasUserWallet = isValidWallet(escrowOrder.userWallet);

    // For pending orders, isMyOrder is always false (so all merchants see new orders)
    // Check if I'm the actual creator by comparing merchant IDs
    const iAmOrderCreator = escrowOrder.orderMerchantId === merchantId;
    const isPendingOrEscrowed = escrowOrder.dbOrder?.status === 'pending' || escrowOrder.dbOrder?.status === 'escrowed';

    // I created this order if: isMyOrder flag OR (pending/escrowed AND my merchant ID matches)
    const isMyOrder = escrowOrder.isMyOrder || (isPendingOrEscrowed && iAmOrderCreator);

    // Check if this is my SELL order before anyone accepted (no recipient yet)
    const isMyPendingSellOrder = isMyOrder && escrowOrder.dbOrder?.status === 'pending';

    // For M2M: if it's my order and acceptor hasn't connected wallet, allow escrow to treasury
    const isMyOrderNoAcceptorWallet = isMyOrder && !hasAcceptorWallet && !hasUserWallet;

    // M2M detection: isM2M flag, buyerMerchantWallet, acceptorWallet, OR my order with no user wallet (placeholder)
    const isMerchantInitiated = isMyOrder && !hasUserWallet;
    const isMerchantTrade = escrowOrder.isM2M || !!escrowOrder.buyerMerchantWallet || hasAcceptorWallet || isMerchantInitiated;
    // For open SELL orders, the creator is determined by isMyOrder flag (buyerMerchantWallet may not be set)
    const iAmCreator = isMyOrder || (myWallet && escrowOrder.buyerMerchantWallet === myWallet);

    let recipientWallet: string | undefined = undefined;
    // Allow escrow to treasury if: pending order OR my order where acceptor hasn't connected wallet
    const canEscrowToTreasury = isMyPendingSellOrder || isMyOrderNoAcceptorWallet;

    if (canEscrowToTreasury) {
      // My order, no acceptor wallet yet - escrow will use treasury placeholder
      // Recipient will be set when acceptor provides wallet
      recipientWallet = undefined;
    } else if (isMerchantTrade) {
      if (iAmCreator) {
        // I created the order, I'm locking, recipient is the acceptor
        recipientWallet = isValidWallet(escrowOrder.acceptorWallet)
          ? escrowOrder.acceptorWallet!
          : undefined;
      } else {
        // I accepted the order, I'm locking, recipient is the creator
        recipientWallet = isValidWallet(escrowOrder.buyerMerchantWallet)
          ? escrowOrder.buyerMerchantWallet!
          : undefined;
      }
    } else {
      // Regular trade - recipient is the user
      recipientWallet = isValidWallet(escrowOrder.userWallet)
        ? escrowOrder.userWallet!
        : undefined;
    }

    // Only require recipient if we can't escrow to treasury
    // In mock mode, skip recipient wallet check entirely (DB-backed coins, no on-chain escrow)
    if (!recipientWallet && !canEscrowToTreasury && !isMockMode) {
      setEscrowError(isMerchantTrade
        ? 'The other merchant has not connected their Solana wallet yet.'
        : 'User has not connected their Solana wallet yet. Ask them to connect their wallet in the app first.');
      return;
    }

    setIsLockingEscrow(true);
    setEscrowError(null);

    try {
      let escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string };

      if (isMockMode) {
        // MOCK MODE: Skip on-chain call, generate demo tx hash
        // The backend core-api will handle balance deduction in mock mode
        const mockTxHash = `mock-escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        escrowResult = {
          success: true,
          txHash: mockTxHash,
          tradeId: undefined,
          tradePda: undefined,
          escrowPda: undefined,
        };
      } else {

        // Use unified flow: fund escrow WITHOUT counterparty
        // Buyer (user or merchant B) will call acceptTrade() to join later
        escrowResult = await solanaWallet.depositToEscrowOpen({
          amount: escrowOrder.amount,
          side: 'sell', // Seller is funding the escrow
        });
      }

      if (!escrowResult.success || !escrowResult.txHash) {
        throw new Error(escrowResult.error || 'Transaction failed');
      }

      // Transaction successful - show tx hash
      setEscrowTxHash(escrowResult.txHash);

      // IMMEDIATELY close the escrow modal after on-chain success
      // This prevents the user from clicking "Lock Escrow" again while backend syncs
      setShowEscrowModal(false);

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

      // Check if this is a new sell order (escrow-first flow)
      const pendingSellOrder = (window as any).__pendingSellOrder;
      const isTempOrder = escrowOrder.id.startsWith('temp-');

      if (pendingSellOrder && isTempOrder) {
        // For temp orders, skip escrow recording and create order directly with escrow details
        playSound('trade_complete');

        try {
          // Now create the order in DB with escrow already locked
          const res = await fetch("/api/merchant/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              merchant_id: pendingSellOrder.merchantId,
              type: pendingSellOrder.tradeType,
              crypto_amount: pendingSellOrder.cryptoAmount,
              payment_method: pendingSellOrder.paymentMethod,
              spread_preference: pendingSellOrder.spreadPreference,
              priority_fee: pendingSellOrder.priorityFee || 0,
              matched_offer_id: pendingSellOrder.matchedOfferId,
              escrow_tx_hash: escrowResult.txHash,
              escrow_trade_id: escrowResult.tradeId,
              escrow_trade_pda: escrowResult.tradePda,
              escrow_pda: escrowResult.escrowPda,
              escrow_creator_wallet: solanaWallet.walletAddress,
            }),
          });

          const data = await res.json();

          if (res.ok && data.success && data.data) {

            // Add to orders list
            const newOrder = mapDbOrderToUI(data.data, merchantId);
            setOrders(prev => [newOrder, ...prev]);

            addNotification('escrow', `Sell order created! ${escrowOrder.amount} USDC locked in escrow`, data.data.id);

            // Clear the pending order
            delete (window as any).__pendingSellOrder;

            // Close the escrow modal
            setShowEscrowModal(false);
            setEscrowOrder(null);
            setEscrowTxHash(null);
            setEscrowError(null);
          } else {
            console.error('[Merchant] Failed to create order after escrow:', {
              status: res.status,
              statusText: res.statusText,
              response: data,
              error: data.error,
              validation: data.validation_errors,
            });
            const errorMsg = data.error || data.validation_errors?.[0] || 'Unknown error';
            addNotification('system', `Escrow locked but order creation failed: ${errorMsg}`, escrowOrder.id);
          }
        } catch (createError) {
          console.error('[Merchant] Error creating order after escrow:', createError);
          const errorMsg = createError instanceof Error ? createError.message : 'Network error';
          addNotification('system', `Escrow locked but order creation failed: ${errorMsg}`, escrowOrder.id);
        }

        refreshBalance();
      } else {
        // Regular escrow flow (order already exists) - record escrow on backend
        const escrowPayload: Record<string, unknown> = {
          tx_hash: escrowResult.txHash,
          actor_type: "merchant",
          actor_id: merchantId,
        };
        // Only include optional fields if they have values (null fails zod .optional())
        if (escrowResult.escrowPda) escrowPayload.escrow_address = escrowResult.escrowPda;
        if (escrowResult.tradeId != null) escrowPayload.escrow_trade_id = escrowResult.tradeId;
        if (escrowResult.tradePda) escrowPayload.escrow_trade_pda = escrowResult.tradePda;
        if (escrowResult.escrowPda) escrowPayload.escrow_pda = escrowResult.escrowPda;
        if (solanaWallet.walletAddress) escrowPayload.escrow_creator_wallet = solanaWallet.walletAddress;

        let recorded = false;
        for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
          if (attempt > 0) {
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
          addNotification('escrow', `${escrowOrder.amount} USDC locked in escrow - waiting for payment`, escrowOrder.id);

          // Close the escrow modal
          setShowEscrowModal(false);
          setEscrowOrder(null);
          setEscrowTxHash(null);
          setEscrowError(null);

          // AfterMutationReconcile: refetch all + balance
          await afterMutationReconcile(escrowOrder.id);
        } else {
          console.error('[Merchant] Failed to record escrow on backend after retries');
          addNotification('system', 'Escrow locked on-chain but server sync failed. It will sync automatically.', escrowOrder.id);
        }

        refreshBalance();
      }

      setIsLockingEscrow(false);
    } catch (error) {
      console.error("Error locking escrow:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Check for blockhash expiration (user took too long to approve)
      if (errorMsg.includes('block height exceeded') || errorMsg.includes('has expired')) {
        setEscrowError('Transaction expired. Please approve the wallet popup faster (within 60 seconds). Try again.');
      } else {
        setEscrowError(errorMsg || 'Failed to lock escrow. Please try again.');
      }
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

    // Check wallet connection (skip in mock mode)
    if (!isMockMode && !solanaWallet.connected) {
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
          const freshOrder = mapDbOrderToUI(data.data, merchantId);

          // Guard: if order was already completed or released, don't show release modal
          if (freshOrder.status === 'completed' || freshOrder.status === 'cancelled' || freshOrder.status === 'expired') {
            addNotification('system', `Order already ${freshOrder.status}. Refreshing...`, order.id);
            setOrders(prev => prev.map(o => o.id === order.id ? freshOrder : o));
            fetchOrders();
            return;
          }

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

    // Fallback to cached order — also guard against stale completed state
    if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'expired') {
      addNotification('system', `Order already ${order.status}.`, order.id);
      fetchOrders();
      return;
    }

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
      const { escrowTradeId, escrowCreatorWallet, userWallet } = releaseOrder;

      // In mock mode, skip on-chain validation
      if (!isMockMode) {
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
      }


      // Call the release function (mock mode: skip chain, generate demo tx)
      let releaseResult: { success: boolean; txHash: string; error?: string };
      if (isMockMode) {
        releaseResult = { success: true, txHash: `mock-release-${Date.now()}` };
      } else {
        releaseResult = await solanaWallet.releaseEscrow({
          creatorPubkey: escrowCreatorWallet || 'mock',
          tradeId: escrowTradeId || 0,
          counterparty: userWallet || 'mock',
        });
      }

      if (releaseResult.success) {
        setReleaseTxHash(releaseResult.txHash);

        // Record the release on backend (server handles mock balance credit)
        const releaseBackendRes = await fetch(`/api/orders/${releaseOrder.id}/escrow`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tx_hash: releaseResult.txHash,
            actor_type: 'merchant',
            actor_id: merchantId,
          }),
        });
        if (!releaseBackendRes.ok) {
          console.error('[Release] Backend sync failed:', releaseBackendRes.status);
          addNotification('system', 'Escrow released but backend sync failed. Refreshing...', releaseOrder.id);
        }

        // AfterMutationReconcile: optimistic completed + refetch all + balance
        playSound('trade_complete');
        addNotification('escrow', `Escrow released! ${releaseOrder.amount} USDC sent to buyer.`, releaseOrder.id);
        await afterMutationReconcile(releaseOrder.id, { status: "completed" as const });

        // Show rating modal after a short delay
        setTimeout(() => {
          const isM2M = !!releaseOrder.dbOrder?.buyer_merchant_id;
          const counterpartyName = isM2M
            ? (releaseOrder.dbOrder?.buyer_merchant?.display_name || 'Merchant')
            : releaseOrder.user;
          setRatingModalData({
            orderId: releaseOrder.id,
            counterpartyName,
            counterpartyType: isM2M ? 'merchant' : 'user',
          });
        }, 1500);
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

    if (!isMockMode && !solanaWallet.connected) {
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
          const freshOrder = mapDbOrderToUI(data.data, merchantId);
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

      if (!isMockMode && (!escrowTradeId || !escrowCreatorWallet)) {
        setCancelError('Missing escrow details. The escrow may not have been locked on-chain.');
        setIsCancellingEscrow(false);
        return;
      }


      // Call the on-chain refund function (mock mode: skip chain, generate demo tx)
      let refundResult: { success: boolean; txHash: string; error?: string };
      if (isMockMode) {
        refundResult = { success: true, txHash: `mock-refund-${Date.now()}` };
      } else {
        refundResult = await solanaWallet.refundEscrow({
          creatorPubkey: escrowCreatorWallet || 'mock',
          tradeId: escrowTradeId || 0,
        });
      }

      if (refundResult.success) {
        setCancelTxHash(refundResult.txHash);

        // Update order status to cancelled on backend (server handles mock balance refund)
        await fetch(`/api/orders/${cancelOrder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'cancelled',
            actor_type: 'merchant',
            actor_id: merchantId,
          }),
        });

        // AfterMutationReconcile: optimistic cancelled + refetch all + balance
        playSound('click');
        addNotification('system', `Escrow cancelled. ${cancelOrder.amount} USDC returned to your balance.`, cancelOrder.id);
        await afterMutationReconcile(cancelOrder.id, { status: "cancelled" as const });
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

  // Simple cancel for orders without escrow (pending/accepted)
  const cancelOrderWithoutEscrow = async (orderId: string) => {
    if (!merchantId) return;

    const confirmed = confirm('Cancel this order? This action cannot be undone.');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/orders/${orderId}?actor_type=merchant&actor_id=${merchantId}&reason=Cancelled by merchant`, {
        method: 'DELETE',
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // AfterMutationReconcile: optimistic cancelled + refetch all + balance
          playSound('click');
          addNotification('system', 'Order cancelled successfully.', orderId);
          await afterMutationReconcile(orderId, { status: "cancelled" as const });
        } else {
          addNotification('system', data.error || 'Failed to cancel order', orderId);
          playSound('error');
        }
      } else {
        const data = await res.json();
        addNotification('system', data.error || 'Failed to cancel order', orderId);
        playSound('error');
      }
    } catch (error) {
      console.error('[Cancel] Error cancelling order:', error);
      addNotification('system', 'Failed to cancel order. Please try again.', orderId);
      playSound('error');
    }
  };

  // Merchant marks that they've sent fiat payment (for M2M buy side)
  const markFiatPaymentSent = async (order: Order) => {
    if (!merchantId) return;
    setMarkingDone(true);

    try {
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
          // AfterMutationReconcile: optimistic escrow + refetch all + balance
          playSound('click');
          addNotification('system', `Payment marked as sent. Waiting for seller to release escrow.`, order.id);
          await afterMutationReconcile(order.id, { status: "escrow" as const });
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        addNotification('system', `Failed: ${errorData.error || 'Unknown error'}`, order.id);
        playSound('error');
      }
    } catch (error) {
      console.error("Error marking payment sent:", error);
      playSound('error');
    } finally {
      setMarkingDone(false);
    }
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
          // Close popup
          setSelectedOrderPopup(null);

          // AfterMutationReconcile: optimistic completed + refetch all + balance
          playSound('trade_complete');
          addNotification('complete', `Trade completed with ${order.user}!`, order.id);
          await afterMutationReconcile(order.id, { status: "completed" as const });
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
        // AfterMutationReconcile: optimistic completed + refetch all + balance
        playSound('trade_complete');
        await afterMutationReconcile(orderId, { status: "completed" as const });
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
      let releaseTxHash: string;

      // For BUY and SELL orders where merchant locked escrow, release the escrow
      // BUY order = user buying crypto, merchant selling = merchant locked the escrow
      // SELL order = merchant selling to another merchant = seller locked the escrow
      if (order.orderType === 'buy' || order.orderType === 'sell') {
        if (isMockMode) {
          // MOCK MODE: Generate demo tx_hash for escrow release
          releaseTxHash = `demo-release-${Date.now()}`;
        } else if (order.escrowTradeId && order.escrowCreatorWallet && order.userWallet) {
          // REAL MODE: Release escrow on-chain
          const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
          const isValidUserWallet = order.userWallet && base58Regex.test(order.userWallet);

          if (!solanaWallet.connected) {
            addNotification('system', 'Please connect your wallet to release escrow.', orderId);
            setShowWalletModal(true);
            playSound('error');
            return;
          }

          if (!isValidUserWallet) {
            addNotification('system', 'Invalid buyer wallet address. Cannot release escrow.', orderId);
            playSound('error');
            return;
          }


          const releaseResult = await solanaWallet.releaseEscrow({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
            counterparty: order.userWallet,
          });

          if (!releaseResult.success) {
            console.error('[Merchant] Failed to release escrow:', releaseResult.error);
            addNotification('system', `Failed to release escrow: ${releaseResult.error || 'Unknown error'}`, orderId);
            playSound('error');
            return;
          }

          releaseTxHash = releaseResult.txHash;
        } else {
          // Missing escrow details in real mode
          addNotification('system', 'Missing escrow details. Cannot release.', orderId);
          playSound('error');
          return;
        }

        // Call atomic escrow release endpoint (works in both mock and real mode)
        const response = await fetch(`/api/orders/${orderId}/escrow`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tx_hash: releaseTxHash,
            actor_type: 'merchant',
            actor_id: merchantId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('[Merchant] Escrow release API failed:', errorData);
          addNotification('system', `Failed to complete order: ${errorData.error || 'Unknown error'}`, orderId);
          playSound('error');
          return;
        }

      }

      // AfterMutationReconcile: refetch all + balance
      playSound('trade_complete');
      addNotification('complete', `Order completed - ${order.amount} USDC released to buyer`, orderId);
      await afterMutationReconcile(orderId, { status: "completed" as const });
    } catch (error) {
      console.error("Error confirming payment:", error);
      addNotification('system', 'Failed to complete order. Please try again.', orderId);
      playSound('error');
    }
  };

  const openDisputeModal = (orderId: string) => {
    setDisputeOrderId(orderId);
    setShowDisputeModal(true);
  };

  const submitDispute = async () => {
    if (!disputeOrderId || !merchantId || !disputeReason) return;

    // Find the order to get escrow details
    const order = orders.find(o => o.id === disputeOrderId);

    setIsSubmittingDispute(true);
    try {
      // V2.3: If wallet connected and order has escrow, open dispute on-chain first
      if (solanaWallet.connected && order?.escrowTradeId && order?.escrowCreatorWallet) {

        try {
          const disputeResult = await solanaWallet.openDispute({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });

          if (disputeResult.success) {
            addNotification('system', `Dispute opened on-chain: ${disputeResult.txHash?.slice(0, 8)}...`, disputeOrderId);
          }
        } catch (chainError) {
          // Log but continue - the API dispute will still be recorded
        }
      }

      // Submit dispute to API (always, regardless of on-chain result)
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
          setShowDisputeModal(false);
          const dOrderId = disputeOrderId;
          setDisputeOrderId(null);
          setDisputeReason("");
          setDisputeDescription("");
          playSound('click');
          toast.showDisputeOpened(dOrderId);
          addNotification('dispute', 'Dispute submitted. Our team will review it.', dOrderId);
          await afterMutationReconcile(dOrderId, { status: "disputed" as const });
        }
      } else {
        toast.showWarning('Failed to submit dispute. Please try again.');
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      playSound('error');
      toast.showWarning('Failed to submit dispute');
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
    const activeChat = chatWindows.find(c => c.id === activeChatId || c.orderId === activeChatId);
    if (activeChat?.orderId) {
      const order = orders.find(o => o.id === activeChat.orderId);
      if (order?.status === 'disputed') {
        fetchDisputeInfo(activeChat.orderId);
      } else {
        setDisputeInfo(null);
      }
    }
  }, [activeChatId, chatWindows, orders, fetchDisputeInfo]);

  const handleOpenChat = (order: Order) => {
    if (!merchantId) return;

    const dbOrder = order.dbOrder;
    let targetId: string;
    let targetType: 'user' | 'merchant';
    let targetName: string;

    if (dbOrder) {
      const isM2M = !!dbOrder.buyer_merchant_id;
      if (isM2M) {
        // M2M trade - determine which merchant to chat with
        if (dbOrder.buyer_merchant_id === merchantId) {
          targetId = dbOrder.merchant_id;
          targetType = 'merchant';
          targetName = 'Seller Merchant';
        } else {
          targetId = dbOrder.buyer_merchant_id!;
          targetType = 'merchant';
          targetName = dbOrder.buyer_merchant?.display_name || 'Buyer Merchant';
        }
      } else {
        targetId = dbOrder.user_id;
        targetType = 'user';
        targetName = dbOrder.user?.name || order.user;
      }
    } else {
      // Fallback: use order's direct properties when dbOrder is missing
      if (order.isM2M && order.buyerMerchantId) {
        if (order.buyerMerchantId === merchantId) {
          targetId = order.orderMerchantId || '';
          targetType = 'merchant';
          targetName = 'Seller Merchant';
        } else {
          targetId = order.buyerMerchantId;
          targetType = 'merchant';
          targetName = 'Buyer Merchant';
        }
      } else {
        // For non-M2M, try to find user info from order
        targetId = order.orderMerchantId === merchantId
          ? (order.id) // Use order ID as fallback - will open general thread
          : (order.orderMerchantId || '');
        targetType = 'user';
        targetName = order.user || 'User';
      }
    }

    if (!targetId) {
      console.error('[Chat] No target ID found for order:', order.id);
      return;
    }

    // Add contact and open chat (don't wait for addContact to resolve)
    directChat.addContact(targetId, targetType);
    directChat.openChat(targetId, targetType, targetName);
  };

  const dismissBigOrder = (id: string) => {
    setBigOrders(prev => prev.filter(o => o.id !== id));
  };

  // Helper to force refetch a single order (for critical updates like completion)
  const refetchSingleOrder = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}?actor_type=merchant&actor_id=${merchantId}&_t=${Date.now()}`, {
        cache: 'no-store'
      });

      if (!res.ok) {
        console.error('[Merchant] Failed to refetch order:', res.status);
        return;
      }

      const data = await res.json();
      if (data.success && data.data) {
        const freshOrder = mapDbOrderToUI(data.data, merchantId);

        // Replace order in local state (no version check - this is authoritative)
        setOrders(prev => prev.map(o => o.id === orderId ? freshOrder : o));
      }
    } catch (error) {
      console.error('[Merchant] Error refetching single order:', error);
    }
  }, [merchantId]);

  // AfterMutationReconcile: Single helper for all order action handlers.
  // Ensures consistent post-mutation behavior: refetch order + list + balance.
  // Enforces monotonic order_version via refetchSingleOrder's authoritative fetch.
  const afterMutationReconcile = useCallback(async (
    orderId: string,
    optimisticUpdate?: Partial<Order>,
  ) => {
    // 1. Apply optimistic update immediately (instant UI feedback)
    if (optimisticUpdate) {
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, ...optimisticUpdate } : o
      ));
    }

    // 2. Refetch the specific order for authoritative status (small delay for backend)
    setTimeout(() => refetchSingleOrder(orderId), 300);

    // 3. Refetch all order lists (open/active/history)
    await fetchOrders();

    // 4. Always refresh balance after any mutation
    refreshBalance();
  }, [refetchSingleOrder, fetchOrders, refreshBalance]);

  // Direct order creation handler for ConfigPanel
  // Accepts tradeType directly to avoid stale closure from React state batching
  const handleDirectOrderCreation = async (tradeType?: 'buy' | 'sell', priorityFee?: number) => {
    if (!merchantId || isCreatingTrade) return;

    // Use passed tradeType (from ConfigPanel button click) or fall back to form state
    const effectiveTradeType = tradeType || openTradeForm.tradeType;

    setIsCreatingTrade(true);
    setCreateTradeError(null);

    try {
      if (effectiveTradeType === "sell") {
        // SELL order flow: Lock escrow first, then create order

        // Check balance
        if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
          addNotification('system', `Insufficient balance. You have ${effectiveBalance.toFixed(2)} USDC.`);
          setIsCreatingTrade(false);
          return;
        }

        // Find matching merchant
        const offerParams = new URLSearchParams({
          amount: openTradeForm.cryptoAmount,
          type: 'buy',
          payment_method: openTradeForm.paymentMethod,
          exclude_merchant: merchantId,
        });
        const offerRes = await fetch(`/api/offers?${offerParams}`);
        const offerData = await offerRes.json();

        let matchedOffer: { id: string; merchant?: { wallet_address?: string; display_name?: string } } | null = null;
        if (offerRes.ok && offerData.success && offerData.data) {
          matchedOffer = offerData.data;
        }

        // Validate counterparty wallet (skip in mock mode)
        if (!isMockMode) {
          const counterpartyWallet = matchedOffer?.merchant?.wallet_address;
          const isValidWallet = counterpartyWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(counterpartyWallet);

          if (!isValidWallet) {
            addNotification('system', 'No matching merchant with wallet found. Try a different amount.');
            setIsCreatingTrade(false);
            return;
          }
        }

        // Store trade params for manual escrow locking
        (window as any).__pendingSellOrder = {
          merchantId,
          tradeType: effectiveTradeType,
          cryptoAmount: parseFloat(openTradeForm.cryptoAmount),
          paymentMethod: openTradeForm.paymentMethod,
          spreadPreference: openTradeForm.spreadPreference,
          priorityFee: priorityFee || 0,
          matchedOfferId: matchedOffer?.id,
          counterpartyWallet: matchedOffer?.merchant?.wallet_address,
        };

        // Create temporary order for escrow modal
        const tempOrder: Order = {
          id: 'temp-' + Date.now(),
          user: matchedOffer?.merchant?.display_name || 'Merchant',
          emoji: '🏪',
          amount: parseFloat(openTradeForm.cryptoAmount),
          fromCurrency: 'USDC',
          toCurrency: 'AED',
          rate: 3.67,
          total: parseFloat(openTradeForm.cryptoAmount) * 3.67,
          timestamp: new Date(),
          status: 'pending',
          expiresIn: 900,
          orderType: 'sell',
          userWallet: matchedOffer?.merchant?.wallet_address,
        };

        // Show escrow modal for manual locking
        setEscrowOrder(tempOrder);
        setEscrowTxHash(null);
        setEscrowError(null);
        setIsLockingEscrow(false);
        setShowEscrowModal(true);

        // Reset form
        setOpenTradeForm({
          tradeType: "sell",
          cryptoAmount: "",
          paymentMethod: "bank",
          spreadPreference: "fastest",
        });

      } else {
        // BUY order flow: Create directly
        const res = await fetch("/api/merchant/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: merchantId,
            type: effectiveTradeType,
            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
            payment_method: openTradeForm.paymentMethod,
            spread_preference: openTradeForm.spreadPreference,
            priority_fee: priorityFee || 0,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to create order");
        }

        // Success
        if (data.data) {
          const newOrder = mapDbOrderToUI(data.data, merchantId);
          setOrders(prev => [newOrder, ...prev]);
          playSound('trade_complete');
          addNotification('order', `Buy order created for ${parseFloat(openTradeForm.cryptoAmount)} USDC`, data.data?.id);
        }

        // Reset form
        setOpenTradeForm({
          tradeType: "sell",
          cryptoAmount: "",
          paymentMethod: "bank",
          spreadPreference: "fastest",
        });
      }

    } catch (error) {
      console.error("Error creating order:", error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create order';
      addNotification('system', errorMsg);
      playSound('error');
    } finally {
      setIsCreatingTrade(false);
    }
  };

  // Global 15-minute timeout check - orders older than 15 mins should not show in active views
  const isOrderExpired = (order: Order) => {
    // Use the database expires_at (via expiresIn) which is properly extended:
    // - Pending orders: 15 minutes from creation
    // - Accepted/escrowed orders: 120 minutes from acceptance/escrow
    return order.expiresIn <= 0;
  };

  // Filter orders by status - Flow: New Orders → Active → Ongoing → Completed
  // CRITICAL: Use getEffectiveStatus() which respects minimal_status
  // "pending" = New Orders (including escrowed sell orders waiting for merchant to click "Go")
  // Include own pending orders so merchant can see/manage orders created via bot or API
  const pendingOrders = useMemo(() => orders.filter(o => getEffectiveStatus(o) === "pending" && !isOrderExpired(o)), [orders]);
  // "escrow" = In Progress (tx signed, trade in progress)
  // Filter out orders older than 15 minutes - they should go to disputed
  const ongoingOrders = useMemo(() => orders.filter(o => getEffectiveStatus(o) === "escrow" && !isOrderExpired(o)), [orders]);
  const completedOrders = useMemo(() => orders.filter(o => getEffectiveStatus(o) === "completed"), [orders]);
  // Include expired orders in cancelled view (client-side check)
  const cancelledOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    return status === "cancelled" ||
      status === "disputed" ||
      // Also include active/escrow orders that are expired (15+ mins old)
      ((status === "active" || status === "escrow" || status === "pending") && isOrderExpired(o));
  }), [orders]);

  // Calculate trader earnings using "best" rate (most common preference)
  // Trader earns 0.5% of each completed trade
  const todayEarnings = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [completedOrders]);
  const totalTradedVolume = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount, 0), [completedOrders]);
  const pendingEarnings = useMemo(() => ongoingOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [ongoingOrders]);

  const activeChat = chatWindows.find(c => c.id === activeChatId || c.orderId === activeChatId);
  const totalUnread = directChat.totalUnread;

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
      <div className="min-h-screen bg-[#060606] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Ambient background */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-orange-500/[0.03] rounded-full blur-[150px]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-white/[0.01] rounded-full blur-[200px]" />
        </div>

        <div className="w-full max-w-sm relative z-10">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2.5 mb-4">
              <Zap className="w-7 h-7 text-white fill-white" />
              <span className="text-[22px] leading-none">
                <span className="font-bold text-white">Blip</span>{' '}
                <span className="italic text-white/90">money</span>
              </span>
            </div>
            <h1 className="text-xl font-bold mb-2">Merchant Portal</h1>
            <p className="text-sm text-gray-500">P2P trading, powered by crypto</p>
          </div>

          {/* Tabs */}
          <div className="flex mb-4 bg-white/[0.03] rounded-xl p-1">
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

          <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] p-6 space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                {loginError}
              </div>
            )}

            {isAuthenticating && (
              <div className="bg-white/5 border border-white/6 rounded-xl p-3 text-sm text-white/70 flex items-center gap-2">
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
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
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
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Business Name (Optional)</label>
                  <input
                    type="text"
                    value={registerForm.businessName}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, businessName: e.target.value }))}
                    placeholder="Your Business"
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                  <input
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Min. 6 characters"
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Confirm Password</label>
                  <input
                    type="password"
                    value={registerForm.confirmPassword}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                  />
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleRegister}
                  disabled={isRegistering || !registerForm.email || !registerForm.password || !registerForm.confirmPassword}
                  className="w-full py-3.5 rounded-xl text-sm font-bold bg-white/10 border border-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  {isRegistering ? "Creating Account..." : "Create Account"}
                </motion.button>

                <p className="text-[11px] text-gray-500 text-center">
                  After creating your account, you can connect your wallet to enable on-chain transactions
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-8 text-center space-y-2">
            <p className="text-[10px] text-white/15 font-mono">Blip Money v1.0</p>
            <div className="flex items-center justify-center gap-3 text-[10px] text-white/20">
              <Link href="/" className="hover:text-white/40 transition-colors">Home</Link>
              <span className="text-white/10">·</span>
              <Link href="/merchant" className="hover:text-white/40 transition-colors">Merchant</Link>
            </div>
          </div>
        </div>
      </div>
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
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="h-[50px] flex items-center px-4 gap-3">
          {/* Left: Logo */}
          <div className="flex items-center shrink-0">
            <Link href="/merchant" className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-white fill-white" />
              <span className="text-[17px] leading-none whitespace-nowrap hidden lg:block">
                <span className="font-bold text-white">Blip</span>{' '}
                <span className="italic text-white/90">money</span>
              </span>
            </Link>
          </div>

          {/* Center: Nav pills + Search */}
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-[3px]">
              <Link
                href="/merchant"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-white/[0.08] text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/merchant/analytics"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                Analytics
              </Link>
              <button
                onClick={() => setShowMerchantQuoteModal(true)}
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors flex items-center gap-1"
                title="Configure Priority Market Settings"
              >
                <Zap className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Priority</span>
              </button>
              <Link
                href="/merchant/settings"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
              >
                Settings
              </Link>
            </nav>

            <div className="relative hidden md:flex items-center">
              <Search className="absolute left-2.5 w-3.5 h-3.5 text-white/25 pointer-events-none" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-[540px] pl-7 pr-3 py-[5px] bg-white/[0.03] border border-white/[0.04] rounded-lg text-[12px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-white/10 focus:bg-white/[0.05] transition-all duration-200"
              />
            </div>
          </div>

          {/* Right: Balance + Actions + Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowWalletModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
              title="USDT Balance & AED Equivalent"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500/60 animate-pulse" />
              <span className="text-[13px] font-mono font-medium text-white/70">
                {effectiveBalance !== null
                  ? effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                  : '—'}
              </span>
              <span className="text-[11px] text-white/30 font-medium">USDT</span>
            </motion.button>

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

            <div className="w-px h-6 bg-white/[0.06] mx-0.5" />

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowProfileModal(true)}
              className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-[12px] overflow-hidden cursor-pointer hover:border-orange-500/40 transition-colors"
              title="Edit Profile Picture"
            >
              {merchantInfo?.avatar_url ? (
                <img
                  src={merchantInfo.avatar_url}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white/60">
                  {(merchantInfo?.username || merchantInfo?.display_name)?.charAt(0)?.toUpperCase() || '🐋'}
                </span>
              )}
            </motion.button>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-white/60">{merchantInfo?.username || merchantInfo?.display_name || merchantInfo?.business_name || 'Merchant'}</span>
              <ConnectionIndicator isConnected={isPusherConnected} />
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
              title="Logout"
            >
              <LogOut className="w-[18px] h-[18px] text-white/30 hover:text-red-400" />
            </motion.button>
          </div>
        </div>
      </header>

      {/* Mobile Stats Bar - Shows on mobile only */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
        {/* USDT Balance */}
        <button
          onClick={() => setShowWalletModal(true)}
          className="flex items-center gap-1 px-2 py-1 bg-white/[0.04] rounded-md border border-white/[0.08] shrink-0"
        >
          <span className="text-[11px] font-mono text-white/70">
            {effectiveBalance !== null
              ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
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
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[9px] font-bold flex items-center justify-center text-white">
              {notifications.filter(n => !n.read).length}
            </span>
          )}
        </button>
      </div>

      {/* Main Layout: Content + Sidebar */}
      {/* DESKTOP: Responsive 4-col (13-14") or 5-col (16"+) Layout */}
      <div className="hidden md:flex md:flex-col h-screen overflow-hidden">
        {/* Main Resizable Grid */}
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden" key={isWideScreen ? 'wide' : 'narrow'}>
        {/* LEFT: Balance Widget + Create Order Widget */}
        <Panel defaultSize={isWideScreen ? "20%" : "24%"} minSize={isWideScreen ? "14%" : "16%"} maxSize={isWideScreen ? "30%" : "35%"} id="left">
        <div className="flex flex-col h-full bg-[#060606] overflow-y-auto p-2 gap-2">
          {/* Widget 1: Balance */}
          <div className="glass-card rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.06]" style={{ height: '48%', minHeight: '260px' }}>
            <DashboardWidgets
              todayEarnings={todayEarnings}
              completedOrders={completedOrders.length}
              cancelledOrders={cancelledOrders.length}
              avgResponseMins={0}
              rank={12}
              balance={effectiveBalance || 0}
              lockedInEscrow={245.50}
              isOnline={isMerchantOnline}
              merchantId={merchantId}
              onToggleOnline={() => setIsMerchantOnline(prev => !prev)}
              onOpenCorridor={() => window.open('/merchant/mempool', '_blank')}
            />
          </div>

          {/* Widget 2: Create Order */}
          <div className="glass-card rounded-xl overflow-hidden flex-1 min-h-0 border border-white/[0.06]">
            <ConfigPanel
              merchantId={merchantId}
              merchantInfo={merchantInfo}
              effectiveBalance={effectiveBalance}
              openTradeForm={openTradeForm}
              setOpenTradeForm={setOpenTradeForm}
              isCreatingTrade={isCreatingTrade}
              onCreateOrder={handleDirectOrderCreation}
              refreshBalance={refreshBalance}
            />
          </div>
        </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* CENTER-LEFT: Pending Orders (+ Leaderboard on narrow screens) */}
        <Panel defaultSize={isWideScreen ? "24%" : "27%"} minSize="16%" maxSize={isWideScreen ? "35%" : "40%"} id="center-left">
        <div className="flex flex-col h-full bg-black">
          {isWideScreen ? (
            <PendingOrdersPanel
              orders={pendingOrders}
              mempoolOrders={mempoolOrders}
              merchantInfo={merchantInfo}
              onSelectOrder={setSelectedOrderPopup}
              onSelectMempoolOrder={setSelectedMempoolOrder}
              fetchOrders={fetchOrders}
            />
          ) : (
            <>
              <div style={{ height: '60%' }} className="flex flex-col border-b border-white/[0.04]">
                <PendingOrdersPanel
                  orders={pendingOrders}
                  mempoolOrders={mempoolOrders}
                  merchantInfo={merchantInfo}
                  onSelectOrder={setSelectedOrderPopup}
                  onSelectMempoolOrder={setSelectedMempoolOrder}
                  fetchOrders={fetchOrders}
                />
              </div>
              <div style={{ height: '40%' }} className="flex flex-col">
                <LeaderboardPanel
                  leaderboardData={leaderboardData}
                  leaderboardTab={leaderboardTab}
                  setLeaderboardTab={setLeaderboardTab}
                />
              </div>
            </>
          )}
        </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* CENTER-RIGHT: In Progress + LP (+ Activity on narrow screens) */}
        <Panel defaultSize={isWideScreen ? "20%" : "27%"} minSize={isWideScreen ? "14%" : "18%"} maxSize={isWideScreen ? "32%" : "40%"} id="center-right">
        <div className="flex flex-col h-full bg-black">
          <div style={{ height: isWideScreen ? '55%' : '40%' }} className="flex flex-col border-b border-white/[0.04]">
            <InProgressPanel
              orders={ongoingOrders}
              onSelectOrder={setSelectedOrderPopup}
            />
          </div>
          {/* LP Assignments — only visible for LPs with active fulfillments */}
          <div style={{ height: isWideScreen ? '45%' : '20%' }} className="flex flex-col border-b border-white/[0.04] overflow-y-auto p-2">
            <CorridorLPPanel merchantId={merchantId} />
          </div>
          {!isWideScreen && (
            <div style={{ height: '40%' }} className="flex flex-col">
              <ActivityPanel
                merchantId={merchantId}
                completedOrders={completedOrders}
                cancelledOrders={cancelledOrders}
                onRateOrder={(order) => {
                  const userName = order.user || 'User';
                  const counterpartyType = order.isM2M ? 'merchant' : 'user';
                  setRatingModalData({
                    orderId: order.id,
                    counterpartyName: userName,
                    counterpartyType,
                  });
                }}
                onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
              />
            </div>
          )}
        </div>
        </Panel>

        {/* 5th COLUMN: Leaderboard + Activity (wide screens only) */}
        {isWideScreen && (
          <>
            <PanelResizeHandle className="w-[3px]" />
            <Panel defaultSize="18%" minSize="12%" maxSize="30%" id="transactions">
            <div className="flex flex-col h-full bg-black">
              <div style={{ height: '40%' }} className="flex flex-col border-b border-white/[0.04]">
                <LeaderboardPanel
                  leaderboardData={leaderboardData}
                  leaderboardTab={leaderboardTab}
                  setLeaderboardTab={setLeaderboardTab}
                />
              </div>
              <div style={{ height: '60%' }} className="flex flex-col">
                <ActivityPanel
                  merchantId={merchantId}
                  completedOrders={completedOrders}
                  cancelledOrders={cancelledOrders}
                  onRateOrder={(order) => {
                    const userName = order.user || 'User';
                    const counterpartyType = order.isM2M ? 'merchant' : 'user';
                    setRatingModalData({
                      orderId: order.id,
                      counterpartyName: userName,
                      counterpartyType,
                    });
                  }}
                  onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                />
              </div>
            </div>
            </Panel>
          </>
        )}

        <PanelResizeHandle className="w-[3px]" />

        {/* RIGHT SIDEBAR: Notifications (max 50%) + Chat (rest) */}
        <Panel defaultSize={isWideScreen ? "18%" : "22%"} minSize={isWideScreen ? "12%" : "15%"} maxSize={isWideScreen ? "30%" : "35%"} id="right">
        <div className="flex flex-col h-full bg-[#060606] overflow-hidden">
          {/* Notifications Panel - Top, max 50% of sidebar */}
          <div style={{ maxHeight: '50%' }} className="flex flex-col border-b border-white/[0.04] overflow-hidden shrink-0">
            <div className="flex flex-col h-full min-h-0">
              {/* Header */}
              <div className="px-3 py-2 border-b border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-3.5 h-3.5 text-white/30" />
                    <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
                      Notifications
                    </h2>
                  </div>
                  {notifications.filter(n => !n.read).length > 0 && (
                    <span className="text-[10px] border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                      {notifications.filter(n => !n.read).length}
                    </span>
                  )}
                </div>
              </div>

              {/* Notifications List */}
              <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-white/15">
                    <Bell className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-[10px] font-mono">No notifications</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {notifications.map((notif) => {
                      // Live relative time
                      const secAgo = Math.floor((Date.now() - notif.timestamp) / 1000);
                      const relTime = secAgo < 60 ? 'Just now'
                        : secAgo < 3600 ? `${Math.floor(secAgo / 60)}m ago`
                        : secAgo < 86400 ? `${Math.floor(secAgo / 3600)}h ago`
                        : `${Math.floor(secAgo / 86400)}d ago`;

                      return (
                        <div
                          key={notif.id}
                          onClick={() => {
                            markNotificationRead(notif.id);
                            if (notif.orderId) setSelectedOrderId(notif.orderId);
                          }}
                          className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                            !notif.read
                              ? 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.12]'
                              : 'bg-transparent border-white/[0.04] hover:border-white/[0.08]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                              notif.type === 'escrow' ? 'bg-orange-500/10' :
                              notif.type === 'dispute' ? 'bg-red-500/10' :
                              notif.type === 'complete' ? 'bg-emerald-500/10' :
                              notif.type === 'payment' ? 'bg-blue-500/10' :
                              'bg-white/[0.04]'
                            }`}>
                              {notif.type === 'order' && <ShoppingBag className="w-3 h-3 text-white/40" />}
                              {notif.type === 'escrow' && <Shield className="w-3 h-3 text-orange-400/60" />}
                              {notif.type === 'payment' && <DollarSign className="w-3 h-3 text-blue-400/60" />}
                              {notif.type === 'dispute' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                              {notif.type === 'complete' && <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />}
                              {notif.type === 'system' && <Bell className="w-3 h-3 text-white/40" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[11px] leading-tight ${!notif.read ? 'text-white/80 font-medium' : 'text-white/50'}`}>
                                {notif.message}
                              </p>
                              <span className="text-[9px] text-white/25 font-mono">{relTime}</span>
                            </div>
                            {!notif.read && (
                              <div className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chat Messages Panel - Bottom (takes remaining space) */}
          <div className="flex-1 flex flex-col min-h-0">
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
                merchantId={merchantId || ''}
                conversations={directChat.conversations}
                totalUnread={directChat.totalUnread}
                isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => {
                  directChat.addContact(targetId, targetType).then(() => {
                    directChat.openChat(targetId, targetType, username);
                  });
                }}
              />
            )}
          </div>
        </div>
        </Panel>
        </PanelGroup>
      </div>

      {/* Mobile View Content - Shows on mobile only */}
      <div className="md:hidden flex-1 overflow-hidden">
        <main className="h-[calc(100vh-180px)] overflow-auto p-3">
          {/* Mobile: Orders View */}
          {mobileView === 'orders' && (
            <div className="space-y-1">
              {/* Big Orders Section */}
              {bigOrders.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between px-2 py-2 border-b border-white/6">
                    <div className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-white/70" />
                      <span className="text-xs font-mono text-white/70 uppercase tracking-wide">Whale Orders</span>
                    </div>
                    <span className="px-2 py-0.5 bg-white/10 text-white/70 text-[10px] font-bold rounded-full">
                      {bigOrders.length}
                    </span>
                  </div>
                  <div className="divide-y divide-amber-500/10">
                    {bigOrders.slice(0, 3).map((order) => (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="px-2 py-3 bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/6 flex items-center justify-center">
                            <span className="text-lg">{order.emoji}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white">{order.user}</span>
                              {order.premium > 0 && (
                                <span className="px-1.5 py-0.5 bg-white/10 text-white text-[10px] font-mono rounded">
                                  +{order.premium}%
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate">{order.message}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-white/70">
                              {order.currency === 'AED' ? 'د.إ' : '$'}{order.amount.toLocaleString()}
                            </p>
                            <p className="text-[10px] text-gray-500">
                              {order.timestamp.toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 ml-13">
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              // TODO: Handle big order acceptance
                            }}
                            className="flex-1 h-8 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white/70 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            Contact
                          </motion.button>
                          <button
                            onClick={() => dismissBigOrder(order.id)}
                            className="h-8 w-8 border border-white/10 hover:border-red-500/30 hover:bg-red-500/10 rounded-lg flex items-center justify-center transition-colors group"
                          >
                            <X className="w-4 h-4 text-gray-500 group-hover:text-red-400" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                  {bigOrders.length > 3 && (
                    <button className="w-full py-2 text-xs text-white/40 hover:text-white/70 transition-colors">
                      View all {bigOrders.length} whale orders
                    </button>
                  )}
                </div>
              )}

              {/* Header Row */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
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
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                                order.orderType === 'buy'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-orange-500/20 text-orange-400'
                              }`}>
                                {order.orderType === 'buy' ? 'SELL' : 'BUY'}
                              </span>
                            )}
                            {order.spreadPreference && (
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                order.spreadPreference === 'fastest' ? 'bg-red-400' :
                                order.spreadPreference === 'cheap' ? 'bg-orange-400' : 'bg-orange-500'
                              }`} title={order.spreadPreference} />
                            )}
                            {order.isMyOrder && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">YOURS</span>
                            )}
                            {order.isNew && !order.isMyOrder && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white/5 text-white/70 rounded">NEW</span>
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
                          {order.isMyOrder ? (
                            <span className="text-[10px] font-mono text-orange-400/70">Waiting...</span>
                          ) : (
                            <>
                              <div className="text-[10px] font-mono text-white">+${Math.round(order.amount * 0.005)}</div>
                              <div className={`text-xs font-mono ${order.expiresIn < 30 ? "text-red-400" : "text-gray-500"}`}>
                                {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Escrow TX Link for sell orders */}
                      {order.escrowTxHash && order.orderType === 'sell' && (
                        <a
                          href={`https://explorer.solana.com/tx/${order.escrowTxHash}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center gap-1.5 mt-2 ml-11 py-1.5 bg-white/5 rounded-lg text-[10px] font-mono text-white hover:bg-white/10 transition-colors"
                        >
                          <Shield className="w-3 h-3" />
                          <span>Escrow Secured</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}

                      {/* Action Row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-11">
                        {!order.isMyOrder && (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => acceptOrder(order)}
                            className="flex-1 h-9 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Go
                          </motion.button>
                        )}
                        <button
                          onClick={() => { handleOpenChat(order); setMobileView('chat'); }}
                          className={`h-9 w-9 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors ${order.isMyOrder ? 'flex-1' : ''}`}
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

          {/* Mobile: Escrow View */}
          {mobileView === 'escrow' && (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-white/70" />
                  <span className="text-xs font-mono text-gray-400 uppercase tracking-wide">Escrow</span>
                </div>
                <span className="text-xs font-mono text-white/70">{ongoingOrders.length}</span>
              </div>

              {ongoingOrders.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {ongoingOrders.map((order) => {
                    const mobileDbStatus = order.dbOrder?.minimal_status || order.dbOrder?.status;
                    const mobileCanComplete = mobileDbStatus === "payment_confirmed";
                    // Use myRole for all role-based decisions
                    const mobileRole = order.myRole || 'observer';
                    // Confirm payment: seller confirms when buyer marked paid
                    const mobileCanConfirmPayment = mobileDbStatus === "payment_sent" && mobileRole === 'seller';
                    const mobileWaitingForUser = false; // Simplified flow - no waiting state
                    // "I've Paid": buyer marks payment when escrow is locked
                    const mobileCanMarkPaid = mobileRole === 'buyer' && (
                      (mobileDbStatus === "payment_sent") ||
                      ((mobileDbStatus === "accepted" || mobileDbStatus === "escrowed") && order.escrowTxHash)
                    );
                    // Lock Escrow: accepted, no escrow, I'm the seller
                    const mobileNeedsLockEscrow = mobileDbStatus === "accepted" && !order.escrowTxHash && mobileRole === 'seller';

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
                        <div className="w-8 h-8 rounded-md bg-white/5 border border-white/6 flex items-center justify-center">
                          <span className="text-xs font-bold text-white/70">
                            {order.user.slice(0, 2).toUpperCase()}
                          </span>
                        </div>

                        {/* User & Amount */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">{order.user}</span>
                            {order.orderType && (
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                                order.orderType === 'buy'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-orange-500/20 text-orange-400'
                              }`}>
                                {order.orderType === 'buy' ? 'SELL' : 'BUY'}
                              </span>
                            )}
                            {order.spreadPreference && (
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                order.spreadPreference === 'fastest' ? 'bg-red-400' :
                                order.spreadPreference === 'cheap' ? 'bg-orange-400' : 'bg-orange-500'
                              }`} title={order.spreadPreference} />
                            )}
                            {/* Status badge */}
                            {mobileCanMarkPaid && (
                              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded font-mono"><ActionPulse size="sm" />SEND</span>
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
                            <div className="mt-1 text-[10px] text-white/50 font-mono truncate">
                              → {order.userBankAccount}
                            </div>
                          )}
                        </div>

                        {/* Timer */}
                        <div className="flex items-center gap-1.5 text-white/70">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="text-xs font-mono">
                            {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                      </div>

                      {/* Last human message preview */}
                      {order.lastHumanMessage && (
                        <div className="flex items-center gap-1.5 mt-1.5 pl-11 cursor-pointer" onClick={() => { handleOpenChat(order); setMobileView('chat'); }}>
                          <MessageCircle className="w-3 h-3 text-gray-500 shrink-0" />
                          <span className="text-[10px] text-gray-400 truncate flex-1">
                            {order.lastHumanMessageSender === 'merchant' ? 'You: ' : ''}{order.lastHumanMessage.length > 40 ? order.lastHumanMessage.slice(0, 40) + '...' : order.lastHumanMessage}
                          </span>
                          {(order.unreadCount || 0) > 0 && (
                            <span className="w-4 h-4 bg-orange-500 rounded-full text-[9px] font-bold flex items-center justify-center text-black shrink-0">
                              {order.unreadCount! > 9 ? '9+' : order.unreadCount}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Action Row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-11">
                        {mobileNeedsLockEscrow ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openEscrowModal(order)}
                            className="flex-1 h-9 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg text-xs font-medium text-orange-400 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            Lock Escrow
                          </motion.button>
                        ) : mobileCanMarkPaid ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => markFiatPaymentSent(order)}
                            disabled={markingDone}
                            className="flex-1 h-9 bg-white/5 hover:bg-white/10 border border-white/6 rounded-lg text-xs font-medium text-white/70 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            I&apos;ve Paid
                          </motion.button>
                        ) : mobileWaitingForUser ? (
                          <span className="flex-1 h-9 bg-white/5 border border-white/6 rounded-lg text-xs font-mono text-white/70 flex items-center justify-center">
                            Awaiting user
                          </span>
                        ) : mobileCanConfirmPayment ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-9 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Confirm & Release
                          </motion.button>
                        ) : mobileCanComplete ? (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-9 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Release
                          </motion.button>
                        ) : (
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReleaseModal(order)}
                            className="flex-1 h-9 bg-white/10 hover:bg-white/20 border border-white/6 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Release
                          </motion.button>
                        )}
                        <button
                          onClick={() => { handleOpenChat(order); setMobileView('chat'); }}
                          className="relative h-9 w-9 border border-white/10 hover:border-white/20 rounded-lg flex items-center justify-center transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-gray-400" />
                          {(order.unreadCount || 0) > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full text-[9px] font-bold flex items-center justify-center text-black">
                              {order.unreadCount! > 9 ? '9+' : order.unreadCount}
                            </span>
                          )}
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
                            className="h-9 w-9 border border-white/10 hover:border-white/6 rounded-lg flex items-center justify-center transition-colors group"
                            title="Cancel & Withdraw"
                          >
                            <RotateCcw className="w-4 h-4 text-gray-400 group-hover:text-white/70" />
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
            <div className="h-full flex flex-col pb-16">
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
              ) : merchantId ? (
                <MerchantChatTabs
                  merchantId={merchantId}
                  conversations={directChat.conversations}
                  totalUnread={directChat.totalUnread}
                  isLoading={directChat.isLoadingConversations}
                  onOpenChat={(targetId, targetType, username) => directChat.openChat(targetId, targetType, username)}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500">Loading chats...</p>
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
                  className="flex items-center gap-1 px-3 py-1.5 bg-white/5 text-white rounded-lg text-xs font-medium"
                >
                  <TrendingUp className="w-3 h-3" />
                  Full Analytics
                </button>
              </div>

              {/* Wallet Balance Card */}
              <button
                onClick={() => setShowWalletModal(true)}
                className="w-full p-4 bg-white/[0.04] rounded-xl border border-white/[0.08] text-left"
              >
                <p className="text-xs text-white/70 mb-1">USDT Balance</p>
                <p className="text-xl font-bold text-white/70">
                  {effectiveBalance !== null
                    ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                    : "Loading..."}
                </p>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                  <p className="text-xs text-gray-500 mb-1">Today&apos;s Volume</p>
                  <p className="text-xl font-bold">${totalTradedVolume.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/6">
                  <p className="text-xs text-white mb-1">Earnings</p>
                  <p className="text-xl font-bold text-white">+${Math.round(todayEarnings)}</p>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/6">
                  <p className="text-xs text-white/70 mb-1">Pending</p>
                  <p className="text-xl font-bold text-white/70">+${Math.round(pendingEarnings)}</p>
                </div>
                <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                  <p className="text-xs text-gray-500 mb-1">Trades</p>
                  <p className="text-xl font-bold">{completedOrders.length}</p>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wide mb-3">Recent Completed</h3>
                <div className="space-y-1 divide-y divide-white/[0.04]">
                  {completedOrders.slice(0, 5).map((order) => (
                    <div key={order.id} className="flex items-center gap-3 py-2.5">
                      <div className="w-7 h-7 rounded-md bg-white/5 border border-white/6 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-white">
                          {order.user.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{order.user}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono text-gray-400">${order.amount.toLocaleString()}</span>
                      </div>
                      <Check className="w-4 h-4 text-white" />
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
                      <div key={dispute.id} className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-white">#{dispute.orderNumber}</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded-full ${
                              dispute.resolvedInFavorOf === 'merchant'
                                ? 'bg-white/5 text-white'
                                : dispute.resolvedInFavorOf === 'user'
                                ? 'bg-red-500/10 text-red-400'
                                : 'bg-white/5 text-white/70'
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
              <div className="mt-8 pt-6 border-t border-white/[0.04]">
                <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wide mb-3">Account</h3>
                <div className="space-y-2">
                  {/* Merchant Info */}
                  <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
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

                  {/* Edit Profile */}
                  <Link
                    href="/merchant/settings"
                    className="w-full flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.04] hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-white/40" />
                      <span className="text-sm font-medium text-white/70">Settings & Profile</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-white/20" />
                  </Link>

                  {/* View Public Profile */}
                  {merchantId && (
                    <Link
                      href={`/merchant/profile/${merchantId}`}
                      className="w-full flex items-center justify-between p-3 bg-white/[0.03] rounded-xl border border-white/[0.04] hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-4 h-4 text-white/40" />
                        <span className="text-sm font-medium text-white/70">View Public Profile</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-white/20" />
                    </Link>
                  )}

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

          {/* Mobile: History View - Completed & Cancelled Transactions */}
          {mobileView === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">Transaction History</h2>
              </div>

              {/* History Tabs */}
              <div className="flex bg-white/[0.03] rounded-xl p-1 mb-4">
                <button
                  onClick={() => setHistoryTab('completed')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                    historyTab === 'completed'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  Completed
                  {completedOrders.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-white/10 text-white text-[10px] rounded-full">
                      {completedOrders.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setHistoryTab('cancelled')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                    historyTab === 'cancelled'
                      ? 'bg-red-500/20 text-red-400'
                      : 'text-gray-500'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                  Cancelled
                  {cancelledOrders.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full">
                      {cancelledOrders.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Completed Orders Tab */}
              {historyTab === 'completed' && (
                <>
                  {completedOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20">
                      <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                        <Check className="w-8 h-8 text-neutral-600" />
                      </div>
                      <p className="text-sm font-medium text-white mb-1">No completed trades yet</p>
                      <p className="text-xs text-neutral-500">Your completed transactions will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {completedOrders.map((order) => {
                        const isM2MHistory = order.isM2M || !!order.buyerMerchantId;
                        // Did I receive crypto? M2M: I'm buyer_merchant. User trade: type='sell' = user sold to me
                        const didReceive = isM2MHistory ? order.buyerMerchantId === merchantId : order.dbOrder?.type === 'sell';
                        return (
                        <motion.div
                          key={order.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
                              <span className="text-sm">{order.emoji}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-white truncate">{order.user}</p>
                                {isM2MHistory && (
                                  <span className="px-1.5 py-0.5 bg-white/5 text-white/70 text-[10px] rounded">M2M</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                {didReceive ? 'Bought' : 'Sold'} • {order.timestamp.toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-semibold ${didReceive ? 'text-orange-400' : 'text-white/50'}`}>
                                {didReceive ? '+' : '-'}{order.amount.toLocaleString()} USDC
                              </p>
                              <p className="text-xs text-gray-500">+${(order.amount * 0.005).toFixed(2)}</p>
                            </div>
                            <Check className="w-5 h-5 text-white" />
                          </div>
                          {order.escrowTxHash && (
                            <div className="mt-3 pt-3 border-t border-white/[0.04]">
                              <a
                                href={`https://explorer.solana.com/tx/${order.escrowTxHash}?cluster=devnet`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View on Solana Explorer
                              </a>
                            </div>
                          )}
                        </motion.div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Cancelled Orders Tab */}
              {historyTab === 'cancelled' && (
                <>
                  {cancelledOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20">
                      <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center mb-4">
                        <X className="w-8 h-8 text-neutral-600" />
                      </div>
                      <p className="text-sm font-medium text-white mb-1">No cancelled trades</p>
                      <p className="text-xs text-neutral-500">Cancelled or disputed orders will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {cancelledOrders.map((order) => (
                        <motion.div
                          key={order.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-4 bg-white/[0.03] rounded-xl border border-red-500/10"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                              <span className="text-sm">{order.emoji}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-white truncate">{order.user}</p>
                                {order.status === 'disputed' && (
                                  <span className="px-1.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded">DISPUTED</span>
                                )}
                                {order.isM2M && (
                                  <span className="px-1.5 py-0.5 bg-white/5 text-white/70 text-[10px] rounded">M2M</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                {order.orderType === 'buy' ? 'Sell' : 'Buy'} • {order.timestamp.toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-white">${order.amount.toLocaleString()}</p>
                              <p className="text-xs text-red-400">
                                {order.status === 'disputed' ? 'In dispute' : 'Cancelled'}
                              </p>
                            </div>
                            <X className="w-5 h-5 text-red-400" />
                          </div>
                          {order.dbOrder?.cancellation_reason && (
                            <div className="mt-3 pt-3 border-t border-white/[0.04]">
                              <p className="text-[10px] text-gray-500">
                                Reason: {order.dbOrder.cancellation_reason}
                              </p>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Mobile: Marketplace View - Global offers to take */}
          {mobileView === 'marketplace' && merchantId && (
            <Marketplace
              merchantId={merchantId}
              onTakeOffer={(offer) => {
                // Navigate to order creation flow with selected offer
                // TODO: Implement order creation from marketplace offer
                // For now, show the Open Trade modal with pre-filled data
                setOpenTradeForm({
                  tradeType: offer.type === 'buy' ? 'sell' : 'buy', // Inverse for user perspective
                  cryptoAmount: '',
                  paymentMethod: offer.payment_method,
                });
                setShowOpenTradeModal(true);
              }}
            />
          )}

          {/* Mobile: My Offers View - Manage merchant's corridor offers */}
          {mobileView === 'offers' && merchantId && (
            <MyOffers
              merchantId={merchantId}
              onCreateOffer={() => setShowCreateModal(true)}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#060606] border-t border-white/[0.04] px-2 py-2 pb-safe z-50">
        <div className="flex items-center justify-around">
          <button
            onClick={() => setMobileView('orders')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'orders' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Sparkles className={`w-5 h-5 ${mobileView === 'orders' ? 'text-orange-400' : 'text-gray-500'}`} />
              {pendingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {pendingOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'orders' ? 'text-white' : 'text-gray-500'}`}>Pending</span>
          </button>

          <button
            onClick={() => setMobileView('escrow')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'escrow' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Lock className={`w-5 h-5 ${mobileView === 'escrow' ? 'text-white/70' : 'text-gray-500'}`} />
              {ongoingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white/10 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {ongoingOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'escrow' ? 'text-white' : 'text-gray-500'}`}>In Progress</span>
          </button>

          <button
            onClick={() => setMobileView('chat')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'chat' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <MessageCircle className={`w-5 h-5 ${mobileView === 'chat' ? 'text-orange-400' : 'text-gray-500'}`} />
              {totalUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalUnread}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'chat' ? 'text-white' : 'text-gray-500'}`}>Messages</span>
          </button>

          <button
            onClick={() => setMobileView('history')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'history' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <History className={`w-5 h-5 ${mobileView === 'history' ? 'text-white/70' : 'text-gray-500'}`} />
              {(completedOrders.length + cancelledOrders.length) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white/10 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {(completedOrders.length + cancelledOrders.length) > 99 ? '99+' : completedOrders.length + cancelledOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'history' ? 'text-white' : 'text-gray-500'}`}>History</span>
          </button>

          <button
            onClick={() => setMobileView('marketplace')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'marketplace' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <Globe className={`w-5 h-5 ${mobileView === 'marketplace' ? 'text-white/70' : 'text-gray-500'}`} />
            <span className={`text-[10px] ${mobileView === 'marketplace' ? 'text-white' : 'text-gray-500'}`}>Market</span>
          </button>

          <button
            onClick={() => setMobileView('offers')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'offers' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <Package className={`w-5 h-5 ${mobileView === 'offers' ? 'text-orange-400' : 'text-gray-500'}`} />
            <span className={`text-[10px] ${mobileView === 'offers' ? 'text-white' : 'text-gray-500'}`}>Offers</span>
          </button>

          <button
            onClick={() => setMobileView('stats')}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              mobileView === 'stats' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <Activity className={`w-5 h-5 ${mobileView === 'stats' ? 'text-white' : 'text-gray-500'}`} />
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
              <div className="bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
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
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">₮</span>
                        </div>
                        <div>
                          <p className="text-[10px] text-white/70 uppercase tracking-wide">Available Balance</p>
                          <p className="text-sm font-bold text-white/70">
                            {effectiveBalance !== null
                              ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                              : 'Loading...'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => refreshBalance()}
                        className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                        title="Refresh balance"
                      >
                        <Activity className="w-4 h-4 text-white/70" />
                      </button>
                    </div>
                  </div>

                  {/* Currency Pair */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">Currency Pair</label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">₮</span>
                        </div>
                        <div>
                          <p className="text-xs font-medium">USDT</p>
                          <p className="text-[10px] text-gray-500">From</p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-600" />
                      <div className="flex-1 bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
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
                        className={`w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 ${
                          parseFloat(corridorForm.availableAmount || '0') > (effectiveBalance || 0)
                            ? 'focus:ring-red-500/50 border border-red-500/30'
                            : 'focus:ring-white/20'
                        }`}
                      />
                      <button
                        onClick={() => {
                          if (effectiveBalance !== null) {
                            setCorridorForm(prev => ({ ...prev, availableAmount: effectiveBalance!.toString() }));
                          }
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/70 font-medium hover:text-white/50"
                      >
                        MAX
                      </button>
                    </div>
                    {parseFloat(corridorForm.availableAmount || '0') > (effectiveBalance || 0) && (
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
                          className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
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
                          className={`w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 ${
                            parseFloat(corridorForm.maxAmount || '0') > parseFloat(corridorForm.availableAmount || '0') && corridorForm.availableAmount
                              ? 'focus:ring-white/20 border border-white/6'
                              : 'focus:ring-white/20'
                          }`}
                        />
                        <p className="text-[10px] text-gray-500 mt-1 ml-1">Max per order</p>
                      </div>
                    </div>
                    {parseFloat(corridorForm.maxAmount || '0') > parseFloat(corridorForm.availableAmount || '0') && corridorForm.availableAmount && (
                      <p className="text-[10px] text-white/70 mt-1 ml-1 flex items-center gap-1">
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
                          className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
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
                          className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                        />
                        <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-white/5 border border-white/6 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-3.5 h-3.5 text-white" />
                      <span className="text-[11px] font-medium text-white">Corridor Preview</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Offering <span className="text-white/70 font-medium">{corridorForm.availableAmount || "0"} USDT</span> total. Accept orders from <span className="text-white font-medium">{corridorForm.minAmount || "100"}</span> to <span className="text-white font-medium">{corridorForm.maxAmount || "10,000"}</span> USDT at <span className="text-white font-medium">{corridorForm.rate || "3.67"}</span> AED + <span className="text-white font-medium">{corridorForm.premium || "0.25"}%</span> fee
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
                      parseFloat(corridorForm.availableAmount) > (effectiveBalance || 0)
                    }
                    onClick={async () => {
                      if (!merchantId) return;
                      // Validate against wallet balance
                      const availableAmount = parseFloat(corridorForm.availableAmount || "0");
                      if (availableAmount > (effectiveBalance || 0)) {
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
                      parseFloat(corridorForm.availableAmount) > (effectiveBalance || 0)
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
              <div className="bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <ArrowLeftRight className="w-5 h-5 text-white" />
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
                            ? "bg-white/10 text-white border border-white/6"
                            : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
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
                            ? "bg-white/10 text-white/70 border border-white/6"
                            : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
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
                        className="w-full bg-white/[0.04] rounded-xl px-4 py-3 pr-16 text-sm font-medium outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-500">USDC</span>
                    </div>
                    {openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount || "0") > effectiveBalance && (
                      <p className="text-[10px] text-red-400 mt-1 ml-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Exceeds your wallet balance ({effectiveBalance.toLocaleString()} USDC)
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
                            : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        Bank Transfer
                      </button>
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, paymentMethod: "cash" }))}
                        className={`py-2.5 rounded-xl text-xs font-medium transition-all ${
                          openTradeForm.paymentMethod === "cash"
                            ? "bg-white/10 text-white border border-white/20"
                            : "bg-white/[0.04] text-gray-400 border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        Cash
                      </button>
                    </div>
                  </div>

                  {/* Spread Preference / Speed - Horizontal Minimal */}
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1.5 block">Match Speed & Fee</label>
                    <div className="grid grid-cols-3 gap-1.5 bg-white/[0.03] p-1.5 rounded-xl border border-white/[0.04]">
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'best' }))}
                        className={`px-3 py-3 rounded-lg text-center transition-all ${
                          openTradeForm.spreadPreference === 'best'
                            ? 'bg-white/10 text-white border border-white/10'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <p className="text-xs font-bold">Best</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">2.0%</p>
                      </button>
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'fastest' }))}
                        className={`px-3 py-3 rounded-lg text-center transition-all ${
                          openTradeForm.spreadPreference === 'fastest'
                            ? 'bg-white/10 text-white border border-white/10'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <p className="text-xs font-bold">Fast</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">2.5%</p>
                      </button>
                      <button
                        onClick={() => setOpenTradeForm(prev => ({ ...prev, spreadPreference: 'cheap' }))}
                        className={`px-3 py-3 rounded-lg text-center transition-all ${
                          openTradeForm.spreadPreference === 'cheap'
                            ? 'bg-white/10 text-white border border-white/10'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <p className="text-xs font-bold">Cheap</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">1.5%</p>
                      </button>
                    </div>
                    <div className="mt-2 text-center">
                      <p className="text-[10px] text-gray-500">
                        {openTradeForm.spreadPreference === 'best' && '⚡ Instant match • Any spread above 2% is your profit'}
                        {openTradeForm.spreadPreference === 'fastest' && '🚀 <5min match • Any spread above 2.5% is your profit'}
                        {openTradeForm.spreadPreference === 'cheap' && '💰 Best price • Any spread above 1.5% is your profit'}
                      </p>
                    </div>
                  </div>

                  {/* Trade Preview */}
                  {openTradeForm.cryptoAmount && parseFloat(openTradeForm.cryptoAmount) > 0 && (
                    <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-3.5 h-3.5 text-white" />
                        <span className="text-[11px] font-medium text-white">Trade Preview</span>
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
                          <span className="text-white font-bold">
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
                    className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] text-gray-400 hover:bg-white/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={
                      isCreatingTrade ||
                      !openTradeForm.cryptoAmount ||
                      parseFloat(openTradeForm.cryptoAmount) <= 0 ||
                      (openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount) > effectiveBalance)
                    }
                    onClick={async () => {
                      if (!merchantId) return;

                      // For SELL orders: Lock escrow FIRST, then create order
                      // For BUY orders: Create order immediately (acceptor will lock escrow)

                      if (openTradeForm.tradeType === "sell") {
                        // Step 1: Find matching merchant and validate
                        setIsCreatingTrade(true);
                        setCreateTradeError(null);

                        try {
                          // Check balance first
                          if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
                            setCreateTradeError(`Insufficient USDC balance. You need ${openTradeForm.cryptoAmount} USDC but have ${effectiveBalance.toFixed(2)} USDC.`);
                            setIsCreatingTrade(false);
                            return;
                          }

                          // Find a merchant BUY offer to match with
                          const offerParams = new URLSearchParams({
                            amount: openTradeForm.cryptoAmount,
                            type: 'buy', // We're selling, so we need buy offers
                            payment_method: openTradeForm.paymentMethod,
                            exclude_merchant: merchantId, // Don't match with ourselves
                          });
                          const offerRes = await fetch(`/api/offers?${offerParams}`);
                          const offerData = await offerRes.json();

                          let matchedOffer: { id: string; merchant?: { wallet_address?: string; display_name?: string } } | null = null;
                          if (offerRes.ok && offerData.success && offerData.data) {
                            matchedOffer = offerData.data;
                          }

                          // Validate counterparty wallet (skip in mock mode)
                          if (!isMockMode) {
                            const counterpartyWallet = matchedOffer?.merchant?.wallet_address;
                            const isValidWallet = counterpartyWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(counterpartyWallet);

                            if (!isValidWallet) {
                              setCreateTradeError('No matching merchant with a linked wallet found. Please try a different amount or wait for merchants to add liquidity.');
                              setIsCreatingTrade(false);
                              return;
                            }
                          }

                          // Step 2: Lock escrow directly (no modal)

                          let escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string };
                          if (isMockMode) {
                            // Mock mode: skip on-chain, generate demo tx hash
                            const mockTxHash = `mock-escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                            escrowResult = { success: true, txHash: mockTxHash };
                          } else {
                            escrowResult = await solanaWallet.depositToEscrowOpen({
                              amount: parseFloat(openTradeForm.cryptoAmount),
                              side: 'sell',
                            });
                          }

                          if (!escrowResult.success || !escrowResult.txHash) {
                            throw new Error(escrowResult.error || 'Escrow transaction failed');
                          }


                          // Step 3: Create order with escrow details
                          const res = await fetch("/api/merchant/orders", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              merchant_id: merchantId,
                              type: openTradeForm.tradeType,
                              crypto_amount: parseFloat(openTradeForm.cryptoAmount),
                              payment_method: openTradeForm.paymentMethod,
                              spread_preference: openTradeForm.spreadPreference,
                              matched_offer_id: matchedOffer?.id,
                              escrow_tx_hash: escrowResult.txHash,
                              escrow_trade_id: escrowResult.tradeId,
                              escrow_trade_pda: escrowResult.tradePda,
                              escrow_pda: escrowResult.escrowPda,
                              escrow_creator_wallet: solanaWallet.walletAddress,
                            }),
                          });

                          const data = await res.json();

                          if (!res.ok || !data.success) {
                            console.error('[Merchant] Create sell order failed:', data);
                            setCreateTradeError(data.error || "Failed to create order after escrow lock");
                            setIsCreatingTrade(false);
                            return;
                          }


                          // Add to orders list
                          if (data.data) {
                            const newOrder = mapDbOrderToUI(data.data, merchantId);
                            setOrders(prev => [newOrder, ...prev]);
                            playSound('trade_complete');
                            addNotification('escrow', `Sell order created! ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC locked in escrow`, data.data?.id);
                          }

                          // Refresh balance
                          refreshBalance();

                          // Success - close modal
                          setShowOpenTradeModal(false);
                          setOpenTradeForm({
                            tradeType: "sell",
                            cryptoAmount: "",
                            paymentMethod: "bank",
                            spreadPreference: "fastest",
                          });

                        } catch (error) {
                          console.error("Error creating sell order:", error);
                          const errorMsg = error instanceof Error ? error.message : 'Network error';
                          setCreateTradeError(errorMsg);
                        } finally {
                          setIsCreatingTrade(false);
                        }
                        return;
                      }

                      // For BUY orders: Create order immediately (no escrow needed from creator)
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
                            spread_preference: openTradeForm.spreadPreference,
                          }),
                        });

                        const data = await res.json();

                        if (!res.ok || !data.success) {
                          console.error('[Merchant] Create trade failed:', data);
                          setCreateTradeError(data.error || "Failed to create trade");
                          return;
                        }


                        // Add to orders list
                        if (data.data) {
                          const newOrder = mapDbOrderToUI(data.data, merchantId);
                          setOrders(prev => [newOrder, ...prev]);
                          addNotification('order', `Buy order created for ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC`, data.data?.id);
                        }

                        // Success - close modal
                        setShowOpenTradeModal(false);
                        setOpenTradeForm({
                          tradeType: "sell",
                          cryptoAmount: "",
                          paymentMethod: "bank",
                          spreadPreference: "fastest",
                        });
                      } catch (error) {
                        console.error("Error creating buy order:", error);
                        setCreateTradeError("Network error. Please try again.");
                      } finally {
                        setIsCreatingTrade(false);
                      }
                    }}
                    className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                      isCreatingTrade ||
                      !openTradeForm.cryptoAmount ||
                      parseFloat(openTradeForm.cryptoAmount) <= 0 ||
                      (openTradeForm.tradeType === "sell" && effectiveBalance !== null && parseFloat(openTradeForm.cryptoAmount) > effectiveBalance)
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-white/10 text-black hover:bg-white/10'
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
              <div className="bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
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
                      className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-white outline-none appearance-none border border-white/[0.04]"
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
                      className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 border border-white/[0.04] resize-none"
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
              <div className="bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-white/70" />
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
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
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
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <span className="text-xs text-gray-500">Your USDC Balance</span>
                    <span className={`text-sm font-bold ${(effectiveBalance || 0) >= escrowOrder.amount ? 'text-white' : 'text-red-400'}`}>
                      {effectiveBalance?.toFixed(2) || '0.00'} USDC
                    </span>
                  </div>

                  {/* Transaction Status */}
                  {isLockingEscrow && !escrowTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-white/70">Processing Transaction</p>
                          <p className="text-xs text-white/40">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {escrowTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Escrow Locked Successfully!</p>
                          <p className="text-xs text-white/70">USDC is now secured on-chain</p>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${escrowTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
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
                  {!escrowTxHash && !isLockingEscrow && (() => {
                    // Determine recipient wallet - check all possible sources
                    const validWalletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
                    const isValidWalletUI = (addr: string | undefined | null): boolean => {
                      if (!addr) return false;
                      return isMockMode ? addr.length > 0 : validWalletRegex.test(addr);
                    };
                    const hasBuyerMerchantWallet = isValidWalletUI(escrowOrder.buyerMerchantWallet);
                    const hasAcceptorWallet = isValidWalletUI(escrowOrder.acceptorWallet);
                    const hasUserWallet = isValidWalletUI(escrowOrder.userWallet);
                    const hasValidRecipient = hasBuyerMerchantWallet || hasAcceptorWallet || hasUserWallet;
                    // M2M trade: isM2M flag, buyerMerchantWallet, OR acceptorWallet (merchant accepted open order)
                    const isMerchantTrade = escrowOrder.isM2M || !!hasBuyerMerchantWallet || hasAcceptorWallet;

                    if (hasValidRecipient) {
                      return isMerchantTrade ? (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            🤝 <strong>Merchant Trade:</strong> You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                            This will be released to the other merchant after they pay the fiat amount.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            ⚠️ You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow on-chain.
                            This will be released to the buyer after they pay you the fiat amount.
                          </p>
                        </div>
                      );
                    } else {
                      // No recipient yet (SELL order before anyone accepts)
                      return (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            🔒 You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                            Once locked, your order will be visible to other merchants who can accept it.
                          </p>
                        </div>
                      );
                    }
                  })()}

                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {escrowTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeEscrowModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
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
                          (effectiveBalance || 0) < escrowOrder.amount
                        }
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
              <div className="bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Unlock className="w-5 h-5 text-white" />
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
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
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
                        <p className="text-lg font-bold text-white">{releaseOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Received</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(releaseOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Escrow Details */}
                  {releaseOrder.escrowTradeId && (
                    <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-gray-500">Escrow Trade ID</span>
                      <span className="text-xs font-mono text-gray-400">#{releaseOrder.escrowTradeId}</span>
                    </div>
                  )}

                  {/* Transaction Status */}
                  {isReleasingEscrow && !releaseTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-white">Processing Release</p>
                          <p className="text-xs text-white/70">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {releaseTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Escrow Released!</p>
                          <p className="text-xs text-white/70">{releaseOrder.amount} USDC sent to buyer</p>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${releaseTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
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
                      {(isMockMode || (releaseOrder.escrowTradeId && releaseOrder.escrowCreatorWallet && releaseOrder.userWallet)) ? (
                        <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.08]">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                              <Check className="w-4 h-4 text-white/70" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white/70 mb-1">Ready to Release</p>
                              <p className="text-xs text-white/70">
                                Confirm you received <strong className="text-white">{releaseOrder.amount} USDC worth of AED</strong>.
                                Once released, the crypto will be sent to the buyer and <strong className="text-white">cannot be reversed</strong>.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-red-400 mb-1">Cannot Release Escrow</p>
                              <p className="text-xs text-red-400/80">
                                Missing on-chain escrow details. This order may not have been locked on-chain yet.
                              </p>
                              <ul className="text-xs text-red-400/70 mt-2 space-y-1">
                                {!releaseOrder.escrowTradeId && <li>• Missing Trade ID</li>}
                                {!releaseOrder.escrowCreatorWallet && <li>• Missing Creator Wallet</li>}
                                {!releaseOrder.userWallet && <li>• Missing Buyer Wallet</li>}
                              </ul>
                            </div>
                          </div>
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
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
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
                        disabled={isReleasingEscrow || (!isMockMode && (!releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet))}
                        className={`flex-[2] py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                          isReleasingEscrow || (!isMockMode && (!releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet))
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                            : 'bg-orange-500 hover:bg-orange-400 text-black'
                        }`}
                      >
                        {isReleasingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Releasing...
                          </>
                        ) : (
                          <>
                            <Unlock className="w-4 h-4" />
                            Release Escrow
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
              <div className="bg-white/[0.03] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <RotateCcw className="w-5 h-5 text-white/70" />
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
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
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
                        <p className="text-lg font-bold text-white/70">{cancelOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Order Total</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(cancelOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Escrow Details */}
                  {cancelOrder.escrowTradeId && (
                    <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-gray-500">Escrow Trade ID</span>
                      <span className="text-xs font-mono text-gray-400">#{cancelOrder.escrowTradeId}</span>
                    </div>
                  )}

                  {/* Transaction Status */}
                  {isCancellingEscrow && !cancelTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-white/70">Processing Refund</p>
                          <p className="text-xs text-white/40">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {cancelTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Escrow Refunded!</p>
                          <p className="text-xs text-white/70">{cancelOrder.amount} USDC returned to your wallet</p>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${cancelTxHash}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
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
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
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
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
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
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
      <PWAInstallBanner appName="Merchant" accentColor="#f97316" />

      {/* Wallet Connect Modal */}
      <MerchantWalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onConnected={(address) => {
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
      <AnimatePresence>
        {showWalletPrompt && !isMockMode && !solanaWallet.connected && (
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
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-white/[0.03] rounded-2xl p-6 border border-white/10"
            >
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-white/70" />
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
                    className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white font-medium text-sm hover:bg-white/[0.15] transition-colors flex items-center justify-center gap-2"
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
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => setSelectedOrderPopup(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-white/[0.03] rounded-2xl shadow-2xl border border-white/[0.08] overflow-hidden"
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl border border-white/[0.04]">
                    {selectedOrderPopup.emoji}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">{selectedOrderPopup.user}</p>
                    <p className="text-[11px] text-white/40">
                      {selectedOrderPopup.orderType === 'buy' ? 'Selling' : 'Buying'} USDC
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedOrderPopup(null)}
                  className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-white/40" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Escrow Status */}
                {selectedOrderPopup.escrowTxHash && (
                  <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                        <Shield className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-sm font-medium text-white">Escrow Secured</span>
                    </div>
                    <a
                      href={`https://explorer.solana.com/tx/${selectedOrderPopup.escrowTxHash}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-white/60 hover:text-white/80 transition-colors"
                    >
                      View TX <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {/* Order Details */}
                <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40 uppercase tracking-wide">Amount</span>
                    <span className="text-sm font-semibold text-white">${selectedOrderPopup.amount.toLocaleString()} USDC</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40 uppercase tracking-wide">Total Fiat</span>
                    <span className="text-sm font-semibold text-white">د.إ {Math.round(selectedOrderPopup.total).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-white/[0.04]">
                    <span className="text-xs text-white/40 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Rate (Locked)
                    </span>
                    <span className="text-xs font-mono text-white/50">1 USDC = {selectedOrderPopup.rate} AED</span>
                  </div>
                  {selectedOrderPopup.dbOrder?.accepted_at && (
                    <p className="text-[10px] text-white/25 text-right -mb-1">
                      Locked at {new Date(selectedOrderPopup.dbOrder.accepted_at).toLocaleString()}
                    </p>
                  )}
                </div>

                {/* Bank Account - Show to BUYER only (for M2M sell orders) */}
                {(() => {
                  const popupBankRole = selectedOrderPopup.myRole || 'observer';
                  const iAmBuyerInPopup = popupBankRole === 'buyer';

                  if (iAmBuyerInPopup && selectedOrderPopup.userBankAccount) {
                    return (
                      <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
                        <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Send AED to this account:</p>
                        <p className="text-sm font-mono text-white mb-1">{selectedOrderPopup.userBankAccount}</p>
                        <p className="text-xs text-white/40">Amount: د.إ {Math.round(selectedOrderPopup.total).toLocaleString()}</p>
                      </div>
                    );
                  }

                  if (iAmBuyerInPopup && !selectedOrderPopup.userBankAccount) {
                    return (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                        <p className="text-xs text-red-400">No payment details provided. Chat to get bank details.</p>
                      </div>
                  );
                }

                return null;
              })()}

                {/* Status message for SELLER waiting for buyer */}
                {(() => {
                  const popupSellerRole = selectedOrderPopup.myRole || 'observer';
                  const popupStatus = selectedOrderPopup.dbOrder?.status;

                  if (popupSellerRole === 'seller' && (popupStatus === 'escrowed' || popupStatus === 'accepted')) {
                    return (
                      <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                          <span className="text-xs">⏳</span>
                        </div>
                        <p className="text-xs text-white/50">Waiting for buyer to mark payment as sent...</p>
                      </div>
                    );
                  }

                  return null;
                })()}
              </div>

              {/* Actions */}
              <div className="px-5 pb-5 space-y-2">
                {/* Cancel button for order creator (before escrow lock) */}
                {(() => {
                  const iAmOrderCreatorPopup = selectedOrderPopup.orderMerchantId === merchantId;
                  const canCancelPopup = iAmOrderCreatorPopup &&
                    !selectedOrderPopup.escrowTxHash &&
                    (selectedOrderPopup.dbOrder?.status === 'pending' || selectedOrderPopup.dbOrder?.status === 'accepted');

                  return canCancelPopup ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={async () => {
                        await cancelOrderWithoutEscrow(selectedOrderPopup.id);
                        setSelectedOrderPopup(null);
                      }}
                      className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/40 text-red-400 font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                      <X className="w-4 h-4" />
                      Cancel Order
                    </motion.button>
                  ) : null;
                })()}

                {/* For escrowed sell orders not yet approved - show Go button */}
                {/* DB status 'escrowed' means user locked escrow but merchant hasn't clicked Go yet */}
                {selectedOrderPopup.dbOrder?.status === 'escrowed' && selectedOrderPopup.orderType === 'sell' && !selectedOrderPopup.isMyOrder && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      await acceptOrder(selectedOrderPopup);
                      // Update popup to show active status (merchant approved, now in Active section)
                      setSelectedOrderPopup(prev => prev ? { ...prev, status: 'active' } : null);
                    }}
                    className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Zap className="w-4 h-4" />
                    Go
                  </motion.button>
                )}

                {/* For pending orders without escrow (regular flow) */}
                {selectedOrderPopup.status === 'pending' && !selectedOrderPopup.escrowTxHash && !selectedOrderPopup.isMyOrder && (
                  <div className="space-y-2">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        acceptOrder(selectedOrderPopup);
                        setSelectedOrderPopup(null);
                      }}
                      className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                      <Zap className="w-4 h-4" />
                      Go
                    </motion.button>
                    {/* Accept with sAED corridor bridge */}
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        acceptWithSaed(selectedOrderPopup);
                        setSelectedOrderPopup(null);
                      }}
                      className="w-full py-2.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/30 text-blue-400 text-sm font-medium flex items-center justify-center gap-2 transition-all"
                    >
                      <Droplets className="w-3.5 h-3.5" />
                      Pay with sAED
                    </motion.button>
                  </div>
                )}

                {/* For accepted orders without escrow — only the SELLER locks escrow */}
                {(() => {
                  const popupDbStatus = selectedOrderPopup.dbOrder?.status;
                  if (popupDbStatus !== 'accepted' || selectedOrderPopup.escrowTxHash) return null;
                  // Only seller locks escrow — use myRole
                  const popupEscrowRole = selectedOrderPopup.myRole || 'observer';
                  if (popupEscrowRole !== 'seller') return null;
                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        openEscrowModal(selectedOrderPopup);
                        setSelectedOrderPopup(null);
                      }}
                      className="w-full py-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/40 text-orange-400 font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                      <Lock className="w-4 h-4" />
                      Lock Escrow
                    </motion.button>
                  );
                })()}

                {/* For accepted/escrowed orders — buyer needs to mark payment sent */}
                {(() => {
                  const popupStatus = selectedOrderPopup.dbOrder?.status;
                  const popupPayRole = selectedOrderPopup.myRole || 'observer';
                  const canMarkPaidPopup = (popupStatus === 'accepted' || popupStatus === 'escrowed') && selectedOrderPopup.escrowTxHash && popupPayRole === 'buyer';

                  if (canMarkPaidPopup) {
                    return (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => markFiatPaymentSent(selectedOrderPopup)}
                        disabled={markingDone}
                        className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
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
                    );
                  }
                  return null;
                })()}

                {/* For payment_sent status — seller confirms receipt and releases escrow */}
                {(() => {
                  const minimalStatus = getAuthoritativeStatus(selectedOrderPopup);

                  // Use computeMyRole for authoritative seller determination
                  const { computeMyRole: computeRole } = require('@/lib/orders/statusResolver');
                  const popupRole = merchantId ? computeRole(selectedOrderPopup, merchantId) : 'observer';
                  const canConfirmPayment = minimalStatus === 'payment_sent' && popupRole === 'seller';

                  if (canConfirmPayment) {
                    return (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                          await confirmPayment(selectedOrderPopup.id);
                          setSelectedOrderPopup(null);
                        }}
                        className="w-full py-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 hover:border-orange-500/30 text-orange-400 font-semibold flex items-center justify-center gap-2 transition-all"
                      >
                        <Check className="w-4 h-4" />
                        Confirm Receipt & Release Escrow
                      </motion.button>
                    );
                  }
                  return null;
                })()}

                <button
                  onClick={() => {
                    setSelectedOrderId(selectedOrderPopup.id);
                    setSelectedOrderPopup(null);
                  }}
                  className="w-full py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white text-sm font-medium flex items-center justify-center gap-2 border border-white/[0.04] transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Full Details
                </button>

                <button
                  onClick={() => {
                    handleOpenChat(selectedOrderPopup);
                    setSelectedOrderPopup(null);
                  }}
                  className="w-full py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white text-sm font-medium flex items-center justify-center gap-2 border border-white/[0.04] transition-colors"
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
    </div>
  );
}
