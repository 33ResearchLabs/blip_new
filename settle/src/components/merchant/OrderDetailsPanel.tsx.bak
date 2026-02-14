'use client';

import { useState, useEffect } from 'react';
import {
  X, ExternalLink, Clock, User, Wallet, Building2, MapPin,
  Copy, Check, AlertTriangle, CheckCircle, XCircle, Shield,
  ArrowRight, ChevronDown, ChevronUp, MessageCircle, Store,
  Hash, Link as LinkIcon
} from 'lucide-react';

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  type: 'buy' | 'sell';
  crypto_amount: number;
  crypto_currency: string;
  fiat_amount: number;
  fiat_currency: string;
  rate: number;
  payment_method: 'bank' | 'cash';
  payment_details?: {
    bank_name?: string;
    account_name?: string;
    iban?: string;
    location_name?: string;
    location_address?: string;
  };
  escrow_tx_hash?: string;
  escrow_address?: string;
  escrow_pda?: string;
  escrow_trade_pda?: string;
  escrow_trade_id?: number;
  escrow_slot?: number;
  release_tx_hash?: string;
  release_slot?: number;
  refund_tx_hash?: string;
  buyer_wallet_address?: string;
  created_at: string;
  accepted_at?: string;
  escrowed_at?: string;
  payment_sent_at?: string;
  payment_confirmed_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  expires_at?: string;
  cancelled_by?: string;
  cancellation_reason?: string;
  extension_count?: number;
  max_extensions?: number;
  user: {
    id: string;
    username?: string;
    name?: string;
    wallet_address?: string;
    rating: number;
    total_trades: number;
    total_volume?: number;
  };
  merchant?: {
    id: string;
    display_name?: string;
    business_name?: string;
    wallet_address?: string;
    rating: number;
    total_trades: number;
    is_online?: boolean;
  };
  offer?: {
    id: string;
    type: string;
    payment_method: string;
    rate: number;
    bank_name?: string;
    bank_account_name?: string;
    bank_iban?: string;
    location_name?: string;
    location_address?: string;
  };
  dispute?: {
    id: string;
    reason: string;
    description?: string;
    status: string;
    resolution?: string;
    created_at: string;
  };
}

interface OrderDetailsPanelProps {
  orderId: string;
  onClose: () => void;
  onOpenChat?: (orderId: string, username: string, emoji: string) => void;
}

// Status configuration
const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: typeof CheckCircle; label: string }> = {
  pending: { color: 'text-yellow-400', bgColor: 'bg-yellow-400/10', icon: Clock, label: 'Pending' },
  accepted: { color: 'text-blue-400', bgColor: 'bg-blue-400/10', icon: Check, label: 'Accepted' },
  escrow_pending: { color: 'text-purple-400', bgColor: 'bg-purple-400/10', icon: Clock, label: 'Escrow Pending' },
  escrowed: { color: 'text-purple-400', bgColor: 'bg-purple-400/10', icon: Shield, label: 'Escrowed' },
  payment_pending: { color: 'text-cyan-400', bgColor: 'bg-cyan-400/10', icon: Clock, label: 'Payment Pending' },
  payment_sent: { color: 'text-cyan-400', bgColor: 'bg-cyan-400/10', icon: ArrowRight, label: 'Payment Sent' },
  payment_confirmed: { color: 'text-teal-400', bgColor: 'bg-teal-400/10', icon: Check, label: 'Payment Confirmed' },
  releasing: { color: 'text-emerald-400', bgColor: 'bg-emerald-400/10', icon: ArrowRight, label: 'Releasing' },
  completed: { color: 'text-emerald-400', bgColor: 'bg-emerald-400/10', icon: CheckCircle, label: 'Completed' },
  cancelled: { color: 'text-red-400', bgColor: 'bg-red-400/10', icon: XCircle, label: 'Cancelled' },
  disputed: { color: 'text-orange-400', bgColor: 'bg-orange-400/10', icon: AlertTriangle, label: 'Disputed' },
  expired: { color: 'text-zinc-400', bgColor: 'bg-zinc-400/10', icon: Clock, label: 'Expired' },
};

// Timeline steps
const TIMELINE_STEPS = [
  { status: 'pending', label: 'Order Created', field: 'created_at' },
  { status: 'accepted', label: 'Accepted', field: 'accepted_at' },
  { status: 'escrowed', label: 'Escrow Locked', field: 'escrowed_at' },
  { status: 'payment_sent', label: 'Payment Sent', field: 'payment_sent_at' },
  { status: 'payment_confirmed', label: 'Payment Confirmed', field: 'payment_confirmed_at' },
  { status: 'completed', label: 'Completed', field: 'completed_at' },
];

// Format date
function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Truncate hash for display
function truncateHash(hash: string, startChars = 6, endChars = 4): string {
  if (hash.length <= startChars + endChars) return hash;
  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
}

// Blipscan URL (local explorer)
const BLIPSCAN_URL = process.env.NEXT_PUBLIC_BLIPSCAN_URL || 'http://localhost:3003';

function getBlipscanTradeUrl(escrowPda: string): string {
  return `${BLIPSCAN_URL}/trade/${escrowPda}`;
}

// Solscan fallback for tx hashes
function getSolscanUrl(hash: string): string {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const cluster = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `https://solscan.io/tx/${hash}${cluster}`;
}

export function OrderDetailsPanel({ orderId, onClose, onOpenChat }: OrderDetailsPanelProps) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showBankDetails, setShowBankDetails] = useState(true);

  useEffect(() => {
    const fetchOrder = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (data.success) {
          setOrder(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch order:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOrder();
  }, [orderId]);

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleOpenChat = () => {
    if (order && onOpenChat) {
      const username = order.user?.username || order.user?.name || 'User';
      onOpenChat(order.id, username, '🦊');
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-zinc-900 rounded-2xl p-8">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-zinc-900 rounded-2xl p-8 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
          <p className="text-white">Order not found</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const username = order.user?.username || order.user?.name || 'User';

  // Determine buyer and seller based on order type
  const isBuyOrder = order.type === 'buy';
  const buyerName = isBuyOrder
    ? (order.user?.username || order.user?.name || 'User')
    : (order.merchant?.display_name || order.merchant?.business_name || 'Merchant');
  const sellerName = isBuyOrder
    ? (order.merchant?.display_name || order.merchant?.business_name || 'Merchant')
    : (order.user?.username || order.user?.name || 'User');
  const buyerWallet = isBuyOrder ? order.user?.wallet_address : order.merchant?.wallet_address;
  const sellerWallet = isBuyOrder ? order.merchant?.wallet_address : order.user?.wallet_address;
  const buyerTrades = isBuyOrder ? order.user?.total_trades : order.merchant?.total_trades;
  const sellerTrades = isBuyOrder ? order.merchant?.total_trades : order.user?.total_trades;
  const buyerRating = isBuyOrder ? order.user?.rating : order.merchant?.rating;
  const sellerRating = isBuyOrder ? order.merchant?.rating : order.user?.rating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0a0a0a] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-white">{order.order_number}</h2>
              <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                ${statusConfig.color} ${statusConfig.bgColor}`}>
                <StatusIcon className="w-3 h-3" />
                {statusConfig.label}
              </span>
            </div>
            <p className="text-sm text-white/50 mt-0.5">
              Created {formatDate(order.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenChat && (
              <button
                onClick={handleOpenChat}
                className="p-2 rounded-lg bg-[#c9a962]/20 text-[#c9a962] hover:bg-[#c9a962]/30 transition-colors"
                title="Open Chat"
              >
                <MessageCircle className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5 text-white/60" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-6 space-y-4">
          {/* Trade Summary */}
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/50">Amount</p>
                <p className="text-2xl font-bold text-white">
                  {Number(order.crypto_amount).toLocaleString()} {order.crypto_currency}
                </p>
                <p className="text-lg text-white/70">
                  {Number(order.fiat_amount).toLocaleString()} {order.fiat_currency}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-white/50">Rate</p>
                <p className="text-lg font-medium text-white">
                  1 {order.crypto_currency} = {Number(order.rate).toFixed(2)} {order.fiat_currency}
                </p>
                <span className={`inline-block mt-1 px-3 py-1 rounded-full text-sm font-medium
                  ${order.type === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                  {order.type === 'buy' ? 'Buy Order' : 'Sell Order'}
                </span>
              </div>
            </div>
          </div>

          {/* Buyer Info */}
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
            <h3 className="text-sm font-medium text-white/50 mb-3 flex items-center gap-2">
              <User className="w-4 h-4" /> Buyer
            </h3>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/20
                                flex items-center justify-center text-lg">
                  🦊
                </div>
                <div>
                  <p className="font-medium text-white">{buyerName}</p>
                  <p className="text-sm text-white/50">
                    {buyerTrades || 0} trades • ⭐ {buyerRating?.toFixed(2) || 'N/A'}
                  </p>
                </div>
              </div>
              {buyerWallet && (
                <button
                  onClick={() => handleCopy(buyerWallet, 'buyer_wallet')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.04] rounded-lg text-sm text-white/60
                             hover:bg-white/[0.08] transition-colors border border-white/[0.06]"
                >
                  <Wallet className="w-4 h-4" />
                  {truncateHash(buyerWallet)}
                  {copiedField === 'buyer_wallet' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>

          {/* Seller Info */}
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
            <h3 className="text-sm font-medium text-white/50 mb-3 flex items-center gap-2">
              <Store className="w-4 h-4" /> Seller
            </h3>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-400/20
                                flex items-center justify-center text-lg">
                  🏪
                </div>
                <div>
                  <p className="font-medium text-white">{sellerName}</p>
                  <p className="text-sm text-white/50">
                    {sellerTrades || 0} trades • ⭐ {sellerRating?.toFixed(2) || 'N/A'}
                    {order.merchant?.is_online && isBuyOrder && (
                      <span className="ml-2 text-emerald-400">• Online</span>
                    )}
                  </p>
                </div>
              </div>
              {sellerWallet && (
                <button
                  onClick={() => handleCopy(sellerWallet, 'seller_wallet')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.04] rounded-lg text-sm text-white/60
                             hover:bg-white/[0.08] transition-colors border border-white/[0.06]"
                >
                  <Wallet className="w-4 h-4" />
                  {truncateHash(sellerWallet)}
                  {copiedField === 'seller_wallet' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>

          {/* Bank/Payment Details */}
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
            <button
              onClick={() => setShowBankDetails(!showBankDetails)}
              className="w-full flex items-center justify-between text-sm font-medium text-white/50 mb-3"
            >
              <span className="flex items-center gap-2">
                {order.payment_method === 'bank' ? <Building2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                Payment Details
              </span>
              {showBankDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showBankDetails && (
              order.payment_method === 'bank' ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-white/50">Bank</span>
                    <span className="text-white">{order.offer?.bank_name || order.payment_details?.bank_name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Account Name</span>
                    <span className="text-white">{order.offer?.bank_account_name || order.payment_details?.account_name || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">IBAN</span>
                    <button
                      onClick={() => {
                        const iban = order.offer?.bank_iban || order.payment_details?.iban;
                        if (iban) handleCopy(iban, 'iban');
                      }}
                      className="flex items-center gap-1 text-white hover:text-emerald-400 transition-colors"
                    >
                      {order.offer?.bank_iban || order.payment_details?.iban || '-'}
                      {(order.offer?.bank_iban || order.payment_details?.iban) && (
                        copiedField === 'iban' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-white/50">Location</span>
                    <span className="text-white">{order.offer?.location_name || order.payment_details?.location_name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Address</span>
                    <span className="text-white">{order.offer?.location_address || order.payment_details?.location_address || '-'}</span>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Escrow & Blockchain Details */}
          {(order.escrow_tx_hash || order.escrow_pda || order.escrow_trade_pda || order.release_tx_hash || order.escrow_address) && (
            <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
              <h3 className="text-sm font-medium text-white/50 mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Escrow & Blockchain
              </h3>
              <div className="space-y-3">
                {/* Trade ID */}
                {order.escrow_trade_id && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50 flex items-center gap-1">
                      <Hash className="w-3 h-3" /> Trade ID
                    </span>
                    <span className="text-white font-mono">{order.escrow_trade_id}</span>
                  </div>
                )}

                {/* Escrow PDA with Blipscan link */}
                {(order.escrow_pda || order.escrow_trade_pda) && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">Escrow PDA</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(order.escrow_pda || order.escrow_trade_pda!, 'escrow_pda')}
                        className="flex items-center gap-1 text-white/80 hover:text-white transition-colors"
                      >
                        {truncateHash(order.escrow_pda || order.escrow_trade_pda!, 8, 6)}
                        {copiedField === 'escrow_pda' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <a
                        href={getBlipscanTradeUrl(order.escrow_pda || order.escrow_trade_pda!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#c9a962] hover:text-[#d4b978] transition-colors"
                        title="View on Blipscan"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Escrow Address */}
                {order.escrow_address && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">Escrow Address</span>
                    <button
                      onClick={() => handleCopy(order.escrow_address!, 'escrow_addr')}
                      className="flex items-center gap-1 text-white/80 hover:text-white transition-colors"
                    >
                      {truncateHash(order.escrow_address, 8, 6)}
                      {copiedField === 'escrow_addr' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                )}

                {/* Deposit TX */}
                {order.escrow_tx_hash && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">Deposit TX</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(order.escrow_tx_hash!, 'deposit_tx')}
                        className="flex items-center gap-1 text-white/80 hover:text-white transition-colors"
                      >
                        {truncateHash(order.escrow_tx_hash)}
                        {copiedField === 'deposit_tx' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <a
                        href={getSolscanUrl(order.escrow_tx_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 transition-colors"
                        title="View on Solscan"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Block/Slot */}
                {order.escrow_slot && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50 flex items-center gap-1">
                      <LinkIcon className="w-3 h-3" /> Slot
                    </span>
                    <span className="text-white font-mono">{order.escrow_slot.toLocaleString()}</span>
                  </div>
                )}

                {/* Release TX */}
                {order.release_tx_hash && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50">Release TX</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(order.release_tx_hash!, 'release_tx')}
                        className="flex items-center gap-1 text-white/80 hover:text-white transition-colors"
                      >
                        {truncateHash(order.release_tx_hash)}
                        {copiedField === 'release_tx' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <a
                        href={getSolscanUrl(order.release_tx_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 transition-colors"
                        title="View on Solscan"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Release Slot */}
                {order.release_slot && (
                  <div className="flex justify-between items-center">
                    <span className="text-white/50 flex items-center gap-1">
                      <LinkIcon className="w-3 h-3" /> Release Slot
                    </span>
                    <span className="text-white font-mono">{order.release_slot.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className="w-full flex items-center justify-between text-sm font-medium text-white/50 mb-3"
            >
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4" /> Timeline
              </span>
              {showTimeline ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showTimeline && (
              <div className="space-y-3">
                {TIMELINE_STEPS.map((step, index) => {
                  const timestamp = order[step.field as keyof OrderDetails] as string | undefined;
                  const isCompleted = !!timestamp;
                  const isCurrent = order.status === step.status;

                  // Skip steps after cancellation/dispute
                  if (['cancelled', 'disputed', 'expired'].includes(order.status) &&
                      !isCompleted && index > 0) {
                    return null;
                  }

                  return (
                    <div key={step.status} className="flex items-start gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                        ${isCompleted
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : isCurrent
                            ? 'bg-yellow-500/20 text-yellow-400 animate-pulse'
                            : 'bg-white/5 text-white/20'
                        }`}>
                        {isCompleted ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-current" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${isCompleted ? 'text-white' : 'text-white/40'}`}>
                          {step.label}
                        </p>
                        {timestamp && (
                          <p className="text-xs text-white/40">{formatDate(timestamp)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Show cancellation/dispute if applicable */}
                {order.cancelled_at && (
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center flex-shrink-0">
                      <XCircle className="w-3 h-3" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-red-400">
                        {order.status === 'expired' ? 'Expired' : 'Cancelled'}
                      </p>
                      <p className="text-xs text-white/40">{formatDate(order.cancelled_at)}</p>
                      {order.cancellation_reason && (
                        <p className="text-xs text-white/50 mt-1">{order.cancellation_reason}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dispute Info */}
          {order.dispute && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
              <h3 className="text-sm font-medium text-orange-400 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Dispute
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Reason</span>
                  <span className="text-white">{order.dispute.reason}</span>
                </div>
                {order.dispute.description && (
                  <div>
                    <span className="text-white/50">Description</span>
                    <p className="text-white mt-1">{order.dispute.description}</p>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-white/50">Status</span>
                  <span className="text-orange-400">{order.dispute.status}</span>
                </div>
                {order.dispute.resolution && (
                  <div>
                    <span className="text-white/50">Resolution</span>
                    <p className="text-white mt-1">{order.dispute.resolution}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Extensions */}
          {(order.extension_count || 0) > 0 && (
            <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
              <h3 className="text-sm font-medium text-white/50 mb-2">Extensions</h3>
              <p className="text-white">
                {order.extension_count} of {order.max_extensions || 3} extensions used
              </p>
            </div>
          )}

          {/* Chat Button (Bottom) */}
          {onOpenChat && (
            <button
              onClick={handleOpenChat}
              className="w-full py-3 rounded-xl bg-[#c9a962]/20 text-[#c9a962] font-semibold flex items-center justify-center gap-2
                         hover:bg-[#c9a962]/30 transition-colors border border-[#c9a962]/30"
            >
              <MessageCircle className="w-5 h-5" />
              Open Chat with {username}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrderDetailsPanel;
