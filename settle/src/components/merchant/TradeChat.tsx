'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  Send,
  Bot,
  Store,
  Clock,
  Shield,
  Check,
  Lock,
  Unlock,
  AlertTriangle,
  DollarSign,
  CheckCircle2,
  XCircle,
  Timer,
  Loader2,
  MessageSquare,
  Users
} from 'lucide-react';
import { motion } from 'framer-motion';
import { BankInfoCard, EscrowCard, StatusEventCard, detectEventType } from '../chat/cards';

// Message type from the chat system
interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'system' | 'compliance';
  text: string;
  timestamp: Date;
  messageType?: string;
  imageUrl?: string | null;
  senderType?: 'user' | 'merchant' | 'system' | 'compliance';
  senderName?: string;
}

// Payment details structure
interface PaymentDetails {
  bank_name?: string;
  bank_account_name?: string;
  bank_iban?: string;
  // User bank (for sell orders)
  user_bank_account?: {
    bank_name?: string;
    account_name?: string;
    iban?: string;
  };
  // Cash location
  location_name?: string;
  location_address?: string;
}

// Order context for rich cards
interface OrderContext {
  payment_details?: PaymentDetails;
  escrow_tx_hash?: string;
  escrow_pda?: string;
  escrow_trade_pda?: string;
  release_tx_hash?: string;
  crypto_amount?: number;
  crypto_currency?: string;
  payment_method?: 'bank' | 'cash';
}

// Compliance officer info
interface ComplianceInfo {
  id: string;
  name: string;
  role?: string;
}

// Order info for the trade
interface TradeInfo {
  orderId: string;
  orderNumber: string;
  orderType: 'buy' | 'sell';
  status: string;
  cryptoAmount: number;
  fiatAmount: number;
  fiatCurrency: string;
  user: {
    id: string;
    username: string;
    rating?: number;
    totalTrades?: number;
  };
  merchant: {
    id: string;
    displayName: string;
  };
  compliance?: ComplianceInfo;
  createdAt: Date;
  acceptedAt?: Date;
  escrowedAt?: Date;
  paymentSentAt?: Date;
  paymentConfirmedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  // Extended fields for rich cards
  paymentMethod?: 'bank' | 'cash';
}

interface TradeChatProps {
  tradeInfo?: TradeInfo;
  messages: ChatMessage[];
  isLoading?: boolean;
  onSendMessage: (text: string, imageUrl?: string) => void;
  onBack: () => void;
  currentUserType: 'merchant' | 'user' | 'compliance';
  userName?: string;
  userEmoji?: string;
  orderContext?: OrderContext;
  showTimeline?: boolean; // Toggle to show prominent timeline view
}

// Status colors for badges
const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: <Timer className="w-3 h-3" /> },
  accepted: { bg: 'bg-white/10', text: 'text-white/70', icon: <Check className="w-3 h-3" /> },
  escrowed: { bg: 'bg-white/10', text: 'text-white/70', icon: <Lock className="w-3 h-3" /> },
  payment_sent: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: <DollarSign className="w-3 h-3" /> },
  payment_confirmed: { bg: 'bg-teal-500/20', text: 'text-teal-400', icon: <CheckCircle2 className="w-3 h-3" /> },
  completed: { bg: 'bg-white/10', text: 'text-white/70', icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', icon: <XCircle className="w-3 h-3" /> },
  disputed: { bg: 'bg-white/10', text: 'text-white/70', icon: <AlertTriangle className="w-3 h-3" /> },
  expired: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', icon: <Clock className="w-3 h-3" /> },
};

// Get emoji from username hash
function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

// Format timestamp
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Timeline step component for order progression
interface TimelineStepProps {
  status: 'pending' | 'current' | 'completed' | 'failed' | 'warning';
  label: string;
  time?: Date;
  isFirst?: boolean;
  isLast?: boolean;
}

function TimelineStep({ status, label, time, isFirst, isLast }: TimelineStepProps) {
  const getStatusStyles = () => {
    switch (status) {
      case 'completed':
        return {
          dot: 'bg-white/10',
          line: 'bg-white/10/50',
          text: 'text-white/70',
        };
      case 'current':
        return {
          dot: 'bg-[#c9a962] animate-pulse',
          line: 'bg-gray-700',
          text: 'text-[#c9a962]',
        };
      case 'failed':
        return {
          dot: 'bg-red-500',
          line: 'bg-red-500/50',
          text: 'text-red-400',
        };
      case 'warning':
        return {
          dot: 'bg-orange-500',
          line: 'bg-orange-500/50',
          text: 'text-white/70',
        };
      default:
        return {
          dot: 'bg-gray-600',
          line: 'bg-gray-700',
          text: 'text-gray-500',
        };
    }
  };

  const styles = getStatusStyles();

  return (
    <div className="flex items-center">
      {/* Connector line (before) */}
      {!isFirst && <div className={`w-6 h-0.5 ${styles.line}`} />}

      {/* Step indicator */}
      <div className="flex flex-col items-center min-w-[60px]">
        <div className={`w-3 h-3 rounded-full ${styles.dot} ring-2 ring-black/50`}>
          {status === 'completed' && (
            <Check className="w-3 h-3 text-black p-0.5" />
          )}
        </div>
        <span className={`text-[10px] mt-1 whitespace-nowrap ${styles.text}`}>
          {label}
        </span>
        {time && (
          <span className="text-[9px] text-gray-600">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Connector line (after) */}
      {!isLast && <div className={`w-6 h-0.5 ${styles.line}`} />}
    </div>
  );
}

// Parse system message to extract event type
function parseSystemMessage(text: string): { icon: React.ReactNode; type: string } {
  if (text.includes('accepted')) return { icon: <Check className="w-3.5 h-3.5" />, type: 'accepted' };
  if (text.includes('locked in escrow') || text.includes('🔒')) return { icon: <Lock className="w-3.5 h-3.5" />, type: 'escrowed' };
  if (text.includes('Payment') && text.includes('sent')) return { icon: <DollarSign className="w-3.5 h-3.5" />, type: 'payment_sent' };
  if (text.includes('Payment confirmed')) return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, type: 'payment_confirmed' };
  if (text.includes('completed') || text.includes('released')) return { icon: <Unlock className="w-3.5 h-3.5" />, type: 'completed' };
  if (text.includes('cancelled')) return { icon: <XCircle className="w-3.5 h-3.5" />, type: 'cancelled' };
  if (text.includes('expired')) return { icon: <Clock className="w-3.5 h-3.5" />, type: 'expired' };
  if (text.includes('dispute')) return { icon: <AlertTriangle className="w-3.5 h-3.5" />, type: 'disputed' };
  return { icon: <Bot className="w-3.5 h-3.5" />, type: 'info' };
}

export function TradeChat({
  tradeInfo,
  messages,
  isLoading = false,
  onSendMessage,
  onBack,
  currentUserType,
  userName,
  userEmoji,
  orderContext,
  showTimeline = true,
}: TradeChatProps) {
  const [messageText, setMessageText] = useState('');
  const [activeChatTab, setActiveChatTab] = useState<'order' | 'direct'>('order');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (messageText.trim()) {
      onSendMessage(messageText.trim());
      setMessageText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Get display name for sender
  const getSenderInfo = (msg: ChatMessage): { name: string; avatar: React.ReactNode; color: string } => {
    if (msg.from === 'system') {
      return {
        name: 'Trade Bot',
        avatar: (
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
            <Bot className="w-4 h-4 text-amber-400" />
          </div>
        ),
        color: 'text-amber-400',
      };
    }

    // Compliance officer message
    if (msg.from === 'compliance' || msg.senderType === 'compliance') {
      const complianceName = msg.senderName || tradeInfo?.compliance?.name || 'Compliance Officer';
      return {
        name: complianceName,
        avatar: (
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
            <Shield className="w-4 h-4 text-red-400" />
          </div>
        ),
        color: 'text-red-400',
      };
    }

    if (msg.from === 'me') {
      // Current user is compliance
      if (currentUserType === 'compliance') {
        return {
          name: tradeInfo?.compliance?.name || 'You (Compliance)',
          avatar: (
            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
              <Shield className="w-4 h-4 text-red-400" />
            </div>
          ),
          color: 'text-red-400',
        };
      }
      return {
        name: currentUserType === 'merchant' ? (tradeInfo?.merchant.displayName || 'You') : 'You',
        avatar: (
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
            {currentUserType === 'merchant' ? (
              <Store className="w-4 h-4 text-[#c9a962]" />
            ) : (
              <span className="text-sm">{userEmoji || getUserEmoji(userName || 'User')}</span>
            )}
          </div>
        ),
        color: 'text-[#c9a962]',
      };
    }

    // 'them' - the other party
    if (currentUserType === 'merchant') {
      // Other party is the user
      const otherName = msg.senderName || tradeInfo?.user.username || userName || 'User';
      return {
        name: otherName,
        avatar: (
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
            <span className="text-sm">{userEmoji || getUserEmoji(otherName)}</span>
          </div>
        ),
        color: 'text-white/70',
      };
    } else if (currentUserType === 'compliance') {
      // When compliance views, determine sender type from senderType field
      if (msg.senderType === 'merchant') {
        const otherName = msg.senderName || tradeInfo?.merchant.displayName || 'Merchant';
        return {
          name: otherName,
          avatar: (
            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
              <Store className="w-4 h-4 text-[#c9a962]" />
            </div>
          ),
          color: 'text-[#c9a962]',
        };
      } else {
        const otherName = msg.senderName || tradeInfo?.user.username || userName || 'User';
        return {
          name: otherName,
          avatar: (
            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
              <span className="text-sm">{userEmoji || getUserEmoji(otherName)}</span>
            </div>
          ),
          color: 'text-white/70',
        };
      }
    } else {
      // Other party is the merchant
      const otherName = msg.senderName || tradeInfo?.merchant.displayName || 'Merchant';
      return {
        name: otherName,
        avatar: (
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
            <Store className="w-4 h-4 text-white/70" />
          </div>
        ),
        color: 'text-white/70',
      };
    }
  };

  const statusInfo = STATUS_COLORS[tradeInfo?.status || 'pending'] || STATUS_COLORS.pending;

  // Separate system messages (timeline events) from regular chat messages
  const systemMessages = messages.filter(msg => msg.from === 'system');
  const chatMessages = messages.filter(msg => msg.from !== 'system');

  // Group chat messages by date
  const groupedChatMessages: { date: string; messages: ChatMessage[] }[] = [];
  let currentChatDate = '';
  chatMessages.forEach((msg) => {
    const dateStr = formatDate(msg.timestamp);
    if (dateStr !== currentChatDate) {
      currentChatDate = dateStr;
      groupedChatMessages.push({ date: dateStr, messages: [msg] });
    } else {
      groupedChatMessages[groupedChatMessages.length - 1].messages.push(msg);
    }
  });

  return (
    <div data-testid="chat-panel" className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header with trade info */}
      <div className="border-b border-white/[0.04] bg-[#0d0d0d]">
        {/* Navigation bar */}
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-400" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white truncate">
                Trade #{tradeInfo?.orderNumber || '...'}
              </h2>
              {tradeInfo && (
                <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full flex items-center gap-1 ${statusInfo.bg} ${statusInfo.text}`}>
                  {statusInfo.icon}
                  {tradeInfo.status.replace('_', ' ')}
                </span>
              )}
            </div>
            {tradeInfo && (
              <p className="text-xs text-gray-500 truncate">
                {tradeInfo.orderType === 'buy' ? 'Buying' : 'Selling'} {tradeInfo.cryptoAmount} USDC • {tradeInfo.fiatAmount.toLocaleString()} {tradeInfo.fiatCurrency}
              </p>
            )}
          </div>
        </div>

        {/* Participants bar */}
        <div className="px-4 py-2 border-t border-white/[0.02] bg-white/[0.02]">
          <div className="flex items-center gap-4 text-xs flex-wrap">
            {/* User */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
                <span className="text-[10px]">{userEmoji || getUserEmoji(tradeInfo?.user.username || userName || 'User')}</span>
              </div>
              <span className="text-gray-400">
                {tradeInfo?.user.username || userName || 'User'}
                {tradeInfo?.user.rating && (
                  <span className="text-white/70 ml-1">★ {tradeInfo.user.rating.toFixed(1)}</span>
                )}
              </span>
            </div>

            <span className="text-gray-600">•</span>

            {/* Merchant */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
                <Store className="w-3 h-3 text-[#c9a962]" />
              </div>
              <span className="text-gray-400">
                {tradeInfo?.merchant.displayName || 'Merchant'}
              </span>
            </div>

            <span className="text-gray-600">•</span>

            {/* Bot */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
                <Bot className="w-3 h-3 text-amber-400" />
              </div>
              <span className="text-amber-400/70">Trade Bot</span>
            </div>

            {/* Compliance Officer (shown when assigned or order is disputed) */}
            {(tradeInfo?.compliance || tradeInfo?.status === 'disputed') && (
              <>
                <span className="text-gray-600">•</span>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-white/5 border border-white/6 flex items-center justify-center">
                    <Shield className="w-3 h-3 text-red-400" />
                  </div>
                  <span className="text-red-400/70">
                    {tradeInfo?.compliance?.name || 'Compliance'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main content area - 50/50 split */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Panel - Timeline & Notifications (50%) */}
        {showTimeline && (
          <div className="w-1/2 flex flex-col border-r border-white/[0.04] min-h-0 overflow-hidden">
            {/* Timeline header */}
            <div className="px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]/50">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-medium text-gray-400">Order Timeline</span>
              </div>
            </div>

            {/* Horizontal status progression */}
            {tradeInfo && (
              <div className="px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]/30">
                <div className="flex items-center gap-1 overflow-x-auto pb-2">
                  <TimelineStep status="completed" label="Created" time={tradeInfo.createdAt} isFirst />
                  <TimelineStep
                    status={tradeInfo.acceptedAt ? 'completed' : (tradeInfo.status === 'pending' ? 'current' : 'pending')}
                    label="Accepted"
                    time={tradeInfo.acceptedAt}
                  />
                  <TimelineStep
                    status={tradeInfo.escrowedAt ? 'completed' : (['pending', 'accepted', 'escrow_pending'].includes(tradeInfo.status) ? (tradeInfo.status === 'escrow_pending' ? 'current' : 'pending') : 'pending')}
                    label="Escrowed"
                    time={tradeInfo.escrowedAt}
                  />
                  <TimelineStep
                    status={tradeInfo.paymentSentAt ? 'completed' : (['payment_pending', 'escrowed'].includes(tradeInfo.status) ? 'current' : 'pending')}
                    label="Payment"
                    time={tradeInfo.paymentSentAt}
                  />
                  <TimelineStep
                    status={tradeInfo.paymentConfirmedAt ? 'completed' : (tradeInfo.status === 'payment_sent' ? 'current' : 'pending')}
                    label="Confirmed"
                    time={tradeInfo.paymentConfirmedAt}
                  />
                  {tradeInfo.status === 'cancelled' || tradeInfo.cancelledAt ? (
                    <TimelineStep status="failed" label="Cancelled" time={tradeInfo.cancelledAt} isLast />
                  ) : tradeInfo.status === 'disputed' ? (
                    <TimelineStep status="warning" label="Disputed" isLast />
                  ) : (
                    <TimelineStep
                      status={tradeInfo.completedAt ? 'completed' : (['payment_confirmed', 'releasing'].includes(tradeInfo.status) ? 'current' : 'pending')}
                      label="Done"
                      time={tradeInfo.completedAt}
                      isLast
                    />
                  )}
                </div>
              </div>
            )}

            {/* System messages / Event log - Show last 10 only */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {systemMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <Bot className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-xs">No events yet</p>
                </div>
              ) : (
                <>
                  {/* Show indicator if there are more than 10 events */}
                  {systemMessages.length > 10 && (
                    <div className="text-center py-2 border-b border-white/[0.04] mb-2">
                      <span className="text-[10px] text-gray-500">
                        Showing last 10 of {systemMessages.length} events
                      </span>
                    </div>
                  )}
                  {systemMessages.slice(-10).map((msg, index) => {
                  let structuredData: { type: string; text: string; data?: Record<string, unknown> } | null = null;
                  try {
                    if (msg.text.startsWith('{')) {
                      structuredData = JSON.parse(msg.text);
                    }
                  } catch {
                    // Not JSON
                  }
                  const eventType = structuredData?.type || detectEventType(msg.text);
                  const displayText = structuredData?.text || msg.text;

                  // Render rich cards for specific events
                  if (eventType === 'bank_info' || msg.text.toLowerCase().includes('payment details')) {
                    const bankData = structuredData?.data || orderContext?.payment_details;
                    if (bankData && orderContext?.payment_method === 'bank') {
                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <BankInfoCard
                            data={{
                              bank_name: bankData.bank_name as string,
                              account_name: bankData.bank_account_name as string,
                              iban: bankData.bank_iban as string,
                            }}
                            title="Payment Details"
                            subtitle={tradeInfo?.orderType === 'buy' ? "Send fiat to this account" : "Merchant will send fiat here"}
                          />
                        </motion.div>
                      );
                    }
                  }

                  if (eventType === 'escrowed' || (msg.text.toLowerCase().includes('escrow') && msg.text.toLowerCase().includes('lock'))) {
                    const escrowData = structuredData?.data || {
                      amount: orderContext?.crypto_amount || tradeInfo?.cryptoAmount,
                      currency: orderContext?.crypto_currency || 'USDC',
                      txHash: orderContext?.escrow_tx_hash,
                      escrowPda: orderContext?.escrow_pda || orderContext?.escrow_trade_pda,
                    };
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <EscrowCard
                          data={escrowData as { amount?: number; currency?: string; txHash?: string; escrowPda?: string }}
                          status="locked"
                        />
                      </motion.div>
                    );
                  }

                  if (eventType === 'completed' && (msg.text.toLowerCase().includes('released') || orderContext?.release_tx_hash)) {
                    const escrowData = {
                      amount: orderContext?.crypto_amount || tradeInfo?.cryptoAmount,
                      currency: orderContext?.crypto_currency || 'USDC',
                      txHash: orderContext?.release_tx_hash || orderContext?.escrow_tx_hash,
                      escrowPda: orderContext?.escrow_pda || orderContext?.escrow_trade_pda,
                    };
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <EscrowCard data={escrowData} status="released" />
                      </motion.div>
                    );
                  }

                  // Default status event card
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <StatusEventCard
                        type={eventType as 'order_created' | 'accepted' | 'escrowed' | 'payment_sent' | 'payment_confirmed' | 'completed' | 'cancelled' | 'expired' | 'disputed' | 'info'}
                        text={displayText}
                        timestamp={msg.timestamp}
                      />
                    </motion.div>
                  );
                })}
                </>
              )}
            </div>
          </div>
        )}

        {/* Right Panel - Chat Messages (50% or 100% if no timeline) */}
        <div className={`${showTimeline ? 'w-1/2' : 'w-full'} flex flex-col min-h-0 overflow-hidden`}>
          {/* Chat tabs header */}
          <div className="border-b border-white/[0.04] bg-[#0d0d0d]/50">
            <div className="flex">
              {/* Order Chat Tab */}
              <button
                onClick={() => setActiveChatTab('order')}
                className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 text-xs font-medium transition-colors relative ${
                  activeChatTab === 'order'
                    ? 'text-[#c9a962]'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Order Chat</span>
                {chatMessages.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    activeChatTab === 'order' ? 'bg-[#c9a962]/20 text-[#c9a962]' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {chatMessages.length}
                  </span>
                )}
                {activeChatTab === 'order' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#c9a962]" />
                )}
              </button>

              {/* Direct Chat Tab */}
              <button
                onClick={() => setActiveChatTab('direct')}
                className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 text-xs font-medium transition-colors relative ${
                  activeChatTab === 'direct'
                    ? 'text-[#c9a962]'
                    : 'text-gray-500 hover:text-gray-400'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Direct Chat</span>
                {activeChatTab === 'direct' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#c9a962]" />
                )}
              </button>
            </div>
          </div>

          {/* Chat messages area */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
            {/* Order Chat Content */}
            {activeChatTab === 'order' && (
              <>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-[#c9a962] animate-spin" />
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-sm">No order messages yet</p>
                    <p className="text-xs mt-1">Messages about this trade will appear here</p>
                  </div>
                ) : (
                  groupedChatMessages.map((group, groupIndex) => (
                <div key={groupIndex}>
                  {/* Date separator */}
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-white/[0.04]" />
                    <span className="text-[10px] text-gray-600 uppercase tracking-wider">{group.date}</span>
                    <div className="flex-1 h-px bg-white/[0.04]" />
                  </div>

                  {/* Messages for this date */}
                  <div className="space-y-3">
                    {group.messages.map((msg, msgIndex) => {
                      const senderInfo = getSenderInfo(msg);

                      return (
                        <motion.div
                          key={msg.id}
                          data-testid={`chat-msg-${msg.id}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: msgIndex * 0.02 }}
                          className={`flex gap-2 ${msg.from === 'me' ? 'flex-row-reverse' : ''}`}
                        >
                          {/* Avatar */}
                          <div className="flex-shrink-0 mt-1">
                            {senderInfo.avatar}
                          </div>

                          {/* Message content */}
                          <div className={`flex flex-col max-w-[85%] ${msg.from === 'me' ? 'items-end' : 'items-start'}`}>
                            {/* Sender name */}
                            <span className={`text-[10px] mb-1 ${senderInfo.color}`}>
                              {senderInfo.name}
                            </span>

                            {/* Message bubble */}
                            <div
                              className={`px-4 py-2.5 rounded-2xl text-sm ${
                                msg.from === 'compliance' || msg.senderType === 'compliance'
                                  ? 'bg-red-500/20 text-gray-200 border border-red-500/30'
                                  : msg.from === 'me'
                                    ? 'bg-[#c9a962] text-black'
                                    : 'bg-[#1f1f1f] text-gray-200'
                              }`}
                            >
                              {/* Compliance badge for official messages */}
                              {(msg.from === 'compliance' || msg.senderType === 'compliance') && (
                                <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-red-500/20">
                                  <Shield className="w-3 h-3 text-red-400" />
                                  <span className="text-[10px] text-red-400 font-medium">Official Compliance Message</span>
                                </div>
                              )}
                              {msg.messageType === 'image' && msg.imageUrl && (
                                <img
                                  src={msg.imageUrl}
                                  alt="Shared image"
                                  className="max-w-full rounded-lg mb-2"
                                />
                              )}
                              <p>{msg.text}</p>
                              <span className={`text-[10px] mt-1 block ${
                                msg.from === 'compliance' || msg.senderType === 'compliance'
                                  ? 'text-red-400/50'
                                  : msg.from === 'me'
                                    ? 'text-black/50'
                                    : 'text-gray-500'
                              }`}>
                                {formatTime(msg.timestamp)}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))
                )}
              </>
            )}

            {/* Direct Chat Content */}
            {activeChatTab === 'direct' && (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Users className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">Direct Chat</p>
                <p className="text-xs mt-1 text-center px-4">
                  Private messages between you and the counterparty
                </p>
                <p className="text-[10px] mt-3 text-gray-600 bg-white/[0.02] px-3 py-2 rounded-lg">
                  Coming soon
                </p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="p-3 bg-[#0d0d0d] border-t border-white/[0.04]">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                data-testid="chat-input"
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-[#1f1f1f] rounded-xl px-4 py-3 outline-none text-sm
                           text-white placeholder:text-gray-500 focus:ring-1 focus:ring-[#c9a962]/50"
              />
              <motion.button
                data-testid="chat-send"
                whileTap={{ scale: 0.95 }}
                onClick={handleSend}
                disabled={!messageText.trim()}
                className="w-12 h-12 rounded-xl bg-[#c9a962] flex items-center justify-center
                           disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                <Send className="w-5 h-5 text-black" />
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TradeChat;
