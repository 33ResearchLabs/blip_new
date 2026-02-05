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
  Loader2
} from 'lucide-react';
import { motion } from 'framer-motion';
import { BankInfoCard, EscrowCard, StatusEventCard, detectEventType } from '../chat/cards';

// Message type from the chat system
interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'system';
  text: string;
  timestamp: Date;
  messageType?: string;
  imageUrl?: string | null;
  senderType?: string;
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
  createdAt: Date;
  // Extended fields for rich cards
  paymentMethod?: 'bank' | 'cash';
}

interface TradeChatProps {
  tradeInfo?: TradeInfo;
  messages: ChatMessage[];
  isLoading?: boolean;
  onSendMessage: (text: string, imageUrl?: string) => void;
  onBack: () => void;
  currentUserType: 'merchant' | 'user';
  userName?: string;
  userEmoji?: string;
  orderContext?: OrderContext;
}

// Status colors for badges
const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: <Timer className="w-3 h-3" /> },
  accepted: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: <Check className="w-3 h-3" /> },
  escrowed: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: <Lock className="w-3 h-3" /> },
  payment_sent: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: <DollarSign className="w-3 h-3" /> },
  payment_confirmed: { bg: 'bg-teal-500/20', text: 'text-teal-400', icon: <CheckCircle2 className="w-3 h-3" /> },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', icon: <XCircle className="w-3 h-3" /> },
  disputed: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: <AlertTriangle className="w-3 h-3" /> },
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
}: TradeChatProps) {
  const [messageText, setMessageText] = useState('');
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

  // Group messages by date
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate = '';
  messages.forEach((msg) => {
    const dateStr = formatDate(msg.timestamp);
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      groupedMessages.push({ date: dateStr, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  });

  // Get display name for sender
  const getSenderInfo = (msg: ChatMessage): { name: string; avatar: React.ReactNode; color: string } => {
    if (msg.from === 'system') {
      return {
        name: 'Trade Bot',
        avatar: (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-amber-400" />
          </div>
        ),
        color: 'text-amber-400',
      };
    }

    if (msg.from === 'me') {
      return {
        name: currentUserType === 'merchant' ? (tradeInfo?.merchant.displayName || 'You') : 'You',
        avatar: (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#c9a962]/20 to-amber-400/20 flex items-center justify-center">
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
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/20 flex items-center justify-center">
            <span className="text-sm">{userEmoji || getUserEmoji(otherName)}</span>
          </div>
        ),
        color: 'text-emerald-400',
      };
    } else {
      // Other party is the merchant
      const otherName = msg.senderName || tradeInfo?.merchant.displayName || 'Merchant';
      return {
        name: otherName,
        avatar: (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-400/20 flex items-center justify-center">
            <Store className="w-4 h-4 text-purple-400" />
          </div>
        ),
        color: 'text-purple-400',
      };
    }
  };

  const statusInfo = STATUS_COLORS[tradeInfo?.status || 'pending'] || STATUS_COLORS.pending;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
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
          <div className="flex items-center gap-4 text-xs">
            {/* User */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/20 flex items-center justify-center">
                <span className="text-[10px]">{userEmoji || getUserEmoji(tradeInfo?.user.username || userName || 'User')}</span>
              </div>
              <span className="text-gray-400">
                {tradeInfo?.user.username || userName || 'User'}
                {tradeInfo?.user.rating && (
                  <span className="text-emerald-400 ml-1">★ {tradeInfo.user.rating.toFixed(1)}</span>
                )}
              </span>
            </div>

            <span className="text-gray-600">•</span>

            {/* Merchant */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#c9a962]/20 to-amber-400/20 flex items-center justify-center">
                <Store className="w-3 h-3 text-[#c9a962]" />
              </div>
              <span className="text-gray-400">
                {tradeInfo?.merchant.displayName || 'Merchant'}
              </span>
            </div>

            <span className="text-gray-600">•</span>

            {/* Bot */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                <Bot className="w-3 h-3 text-amber-400" />
              </div>
              <span className="text-amber-400/70">Trade Bot</span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-[#c9a962] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Shield className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Start the conversation</p>
          </div>
        ) : (
          groupedMessages.map((group, groupIndex) => (
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
                  const isSystem = msg.from === 'system';
                  const parsedSystem = isSystem ? parseSystemMessage(msg.text) : null;

                  return (
                    <motion.div
                      key={msg.id}
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
                      <div className={`flex flex-col max-w-[75%] ${msg.from === 'me' ? 'items-end' : 'items-start'}`}>
                        {/* Sender name */}
                        <span className={`text-[10px] mb-1 ${senderInfo.color}`}>
                          {senderInfo.name}
                        </span>

                        {/* Message bubble */}
                        {isSystem ? (
                          // System/Bot message - render as rich card
                          (() => {
                            // Try to parse as structured JSON message
                            let structuredData: { type: string; text: string; data?: Record<string, unknown> } | null = null;
                            try {
                              if (msg.text.startsWith('{')) {
                                structuredData = JSON.parse(msg.text);
                              }
                            } catch {
                              // Not JSON, use text-based detection
                            }

                            const eventType = structuredData?.type || detectEventType(msg.text);
                            const displayText = structuredData?.text || msg.text;

                            // Render BankInfoCard for bank-related messages
                            if (eventType === 'bank_info' || msg.text.toLowerCase().includes('payment details')) {
                              const bankData = structuredData?.data || orderContext?.payment_details;
                              if (bankData && orderContext?.payment_method === 'bank') {
                                return (
                                  <BankInfoCard
                                    data={{
                                      bank_name: bankData.bank_name as string,
                                      account_name: bankData.bank_account_name as string,
                                      iban: bankData.bank_iban as string,
                                    }}
                                    title="Payment Details"
                                    subtitle={tradeInfo?.orderType === 'buy'
                                      ? "Send fiat to this account"
                                      : "Merchant will send fiat here"}
                                  />
                                );
                              }
                            }

                            // Render EscrowCard for escrow-related messages
                            if (eventType === 'escrowed' || (msg.text.toLowerCase().includes('escrow') && msg.text.toLowerCase().includes('lock'))) {
                              const escrowData = structuredData?.data || {
                                amount: orderContext?.crypto_amount || tradeInfo?.cryptoAmount,
                                currency: orderContext?.crypto_currency || 'USDC',
                                txHash: orderContext?.escrow_tx_hash,
                                escrowPda: orderContext?.escrow_pda || orderContext?.escrow_trade_pda,
                              };
                              return (
                                <EscrowCard
                                  data={escrowData as { amount?: number; currency?: string; txHash?: string; escrowPda?: string }}
                                  status="locked"
                                />
                              );
                            }

                            // Render EscrowCard for release messages
                            if (eventType === 'completed' && (msg.text.toLowerCase().includes('released') || orderContext?.release_tx_hash)) {
                              const escrowData = {
                                amount: orderContext?.crypto_amount || tradeInfo?.cryptoAmount,
                                currency: orderContext?.crypto_currency || 'USDC',
                                txHash: orderContext?.release_tx_hash || orderContext?.escrow_tx_hash,
                                escrowPda: orderContext?.escrow_pda || orderContext?.escrow_trade_pda,
                              };
                              return (
                                <EscrowCard
                                  data={escrowData}
                                  status="released"
                                />
                              );
                            }

                            // Default: use StatusEventCard for other system messages
                            return (
                              <StatusEventCard
                                type={eventType as 'order_created' | 'accepted' | 'escrowed' | 'payment_sent' | 'payment_confirmed' | 'completed' | 'cancelled' | 'expired' | 'disputed' | 'info'}
                                text={displayText}
                                timestamp={msg.timestamp}
                              />
                            );
                          })()
                        ) : (
                          // Regular message
                          <div
                            className={`px-4 py-2.5 rounded-2xl text-sm ${
                              msg.from === 'me'
                                ? 'bg-[#c9a962] text-black'
                                : 'bg-[#1f1f1f] text-gray-200'
                            }`}
                          >
                            {msg.messageType === 'image' && msg.imageUrl && (
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full rounded-lg mb-2"
                              />
                            )}
                            <p>{msg.text}</p>
                            <span className={`text-[10px] mt-1 block ${
                              msg.from === 'me' ? 'text-black/50' : 'text-gray-500'
                            }`}>
                              {formatTime(msg.timestamp)}
                            </span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-3 bg-[#0d0d0d] border-t border-white/[0.04]">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-[#1f1f1f] rounded-xl px-4 py-3 outline-none text-sm
                       text-white placeholder:text-gray-500 focus:ring-1 focus:ring-[#c9a962]/50"
          />
          <motion.button
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
  );
}

export default TradeChat;
