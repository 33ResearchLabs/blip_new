"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  X,
  Check,
  Star,
  Copy,
  MapPin,
  Clock,
  Lock,
  Navigation,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Wallet,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
import type { Screen, Order } from "./types";
import { type RefObject, useState as useLocalState, useRef as useLocalRef, useCallback as useLocalCallback, useEffect as useLocalEffect } from "react";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import dynamic from 'next/dynamic';
import { showAlert } from '@/context/ModalContext';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

export interface OrderDetailScreenProps {
  setScreen: (s: Screen) => void;
  activeOrder: Order;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  handleOpenChat: () => void;
  markPaymentSent: () => void;
  confirmFiatReceived: () => void;
  rating: number;
  setRating: (r: number) => void;
  copied: boolean;
  handleCopy: (text: string) => void;
  // Extension
  extensionRequest: {
    orderId: string;
    requestedBy: string;
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  } | null;
  requestExtension: () => void;
  respondToExtension: (accept: boolean) => void;
  requestingExtension: boolean;
  // Chat modal
  showChat: boolean;
  setShowChat: (v: boolean) => void;
  chatMessage: string;
  setChatMessage: (m: string) => void;
  chatInputRef: RefObject<HTMLInputElement | null>;
  chatMessagesRef: RefObject<HTMLDivElement | null>;
  activeChat: {
    id: string;
    orderId?: string;
    isTyping?: boolean;
    messages: Array<{
      id: string;
      text: string;
      from: string;
      timestamp: Date;
      senderName?: string;
      messageType?: string;
      imageUrl?: string;
    }>;
  } | null;
  handleSendMessage: () => void;
  sendChatMessage?: (chatId: string, text: string, imageUrl?: string) => void;
  sendTypingIndicator?: (chatId: string, isTyping: boolean) => void;
  // Dispute
  showDisputeModal: boolean;
  setShowDisputeModal: (v: boolean) => void;
  disputeReason: string;
  setDisputeReason: (r: string) => void;
  disputeDescription: string;
  setDisputeDescription: (d: string) => void;
  submitDispute: () => void;
  isSubmittingDispute: boolean;
  disputeInfo: {
    status?: string;
    proposed_resolution?: string;
    resolution_notes?: string;
    user_confirmed?: boolean;
    merchant_confirmed?: boolean;
  } | null;
  respondToResolution: (action: 'accept' | 'reject') => void;
  isRespondingToResolution: boolean;
  // Cancel request
  requestCancelOrder: (reason?: string) => void;
  respondToCancelRequest: (accept: boolean) => void;
  isRequestingCancel: boolean;
  // Solana
  solanaWallet: {
    connected: boolean;
    programReady: boolean;
    walletAddress: string | null;
    depositToEscrow: (params: { amount: number; merchantWallet: string }) => Promise<{
      success: boolean;
      txHash: string;
      tradeId?: number;
      tradePda?: string;
      escrowPda?: string;
    }>;
  };
  setShowWalletModal: (v: boolean) => void;
  userId: string | null;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  maxW: string;
}

export const OrderDetailScreen = ({
  setScreen,
  activeOrder,
  isLoading,
  setIsLoading,
  handleOpenChat,
  markPaymentSent,
  confirmFiatReceived,
  rating,
  setRating,
  copied,
  handleCopy,
  extensionRequest,
  requestExtension,
  respondToExtension,
  requestingExtension,
  showChat,
  setShowChat,
  chatMessage,
  setChatMessage,
  chatInputRef,
  chatMessagesRef,
  activeChat,
  handleSendMessage,
  sendChatMessage,
  sendTypingIndicator,
  showDisputeModal,
  setShowDisputeModal,
  disputeReason,
  setDisputeReason,
  disputeDescription,
  setDisputeDescription,
  submitDispute,
  isSubmittingDispute,
  disputeInfo,
  respondToResolution,
  isRespondingToResolution,
  requestCancelOrder,
  respondToCancelRequest,
  isRequestingCancel,
  solanaWallet,
  setShowWalletModal,
  userId,
  setOrders,
  playSound,
  maxW,
}: OrderDetailScreenProps) => {
  const [showEmojiPicker, setShowEmojiPicker] = useLocalState(false);
  const [isUploading, setIsUploading] = useLocalState(false);
  const [copiedField, setCopiedField] = useLocalState<string | null>(null);

  const copyField = useLocalCallback((field: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      handleCopy(text);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }, [handleCopy]);
  const [pendingImage, setPendingImage] = useLocalState<{ file: File; previewUrl: string } | null>(null);
  const fileInputRef = useLocalRef<HTMLInputElement>(null);
  const typingTimeoutRef = useLocalRef<NodeJS.Timeout | null>(null);

  // Handle file select — only store locally + show preview (no upload yet)
  const handleFileSelect = useLocalCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return; // 10MB max
    if (!file.type.startsWith('image/')) return;

    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ file, previewUrl });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Clear pending image
  const clearPendingImage = useLocalCallback(() => {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
  }, [pendingImage]);

  // Upload image to Cloudinary and send message
  const uploadAndSend = useLocalCallback(async () => {
    if (!pendingImage || !activeChat || !sendChatMessage) return;

    setIsUploading(true);
    try {
      // Include userId header explicitly for auth
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userId) authHeaders['x-user-id'] = userId;
      const sigRes = await fetch('/api/upload/signature', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ orderId: activeChat.orderId || 'chat' }),
      });
      if (!sigRes.ok) { setIsUploading(false); return; }
      const sigData = await sigRes.json();
      if (!sigData.success) { setIsUploading(false); return; }
      const sig = sigData.data;

      const formData = new FormData();
      formData.append('file', pendingImage.file);
      formData.append('signature', sig.signature);
      formData.append('timestamp', sig.timestamp.toString());
      formData.append('api_key', sig.apiKey);
      formData.append('folder', sig.folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: 'POST', body: formData }
      );
      if (uploadRes.ok) {
        const result = await uploadRes.json();
        const text = chatMessage.trim() || 'Photo';
        sendChatMessage(activeChat.id, text, result.secure_url);
        setChatMessage('');
        playSound('send');
      } else {
        console.error('[OrderDetailScreen] Cloudinary upload failed:', uploadRes.status, await uploadRes.text().catch(() => ''));
      }
    } catch (err) {
      console.error('[OrderDetailScreen] Image upload error:', err);
    } finally {
      setIsUploading(false);
      clearPendingImage();
    }
  }, [pendingImage, activeChat, sendChatMessage, chatMessage, setChatMessage, playSound, clearPendingImage, userId]);

  // Cleanup preview URL on unmount
  useLocalEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  // Handle typing indicator
  const handleTypingChange = useLocalCallback((value: string) => {
    setChatMessage(value);
    if (!activeChat || !sendTypingIndicator) return;

    // Send typing start
    sendTypingIndicator(activeChat.id, true);

    // Clear previous timeout and set new one to send typing stop
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingIndicator(activeChat.id, false);
    }, 2000);
  }, [activeChat, sendTypingIndicator, setChatMessage]);

  // Cleanup typing timeout
  useLocalEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  return (
    <>
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
              activeOrder.type === "buy" ? "bg-white/5" : "bg-white/5"
            }`}>
              {activeOrder.type === "buy"
                ? <ArrowDownLeft className="w-5 h-5 text-white" />
                : <ArrowUpRight className="w-5 h-5 text-white/70" />
              }
            </div>
            <div>
              <p className="text-[17px] font-semibold text-white">
                {activeOrder.type === "buy" ? "Buying" : "Selling"} ${activeOrder.cryptoAmount} USDC
              </p>
              <p className="text-[13px] text-neutral-500">
                {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4].map(step => (
              <div
                key={step}
                className={`flex-1 h-1 rounded-full ${
                  step <= activeOrder.step ? "bg-white/40" : "bg-neutral-800"
                }`}
              />
            ))}
          </div>
          <p className="text-[13px] text-neutral-500">Step {activeOrder.step} of 4</p>
        </div>

        {/* Escrow Status Section - Show for sell orders with escrow */}
        {activeOrder.type === "sell" && activeOrder.escrowTxHash && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <Lock className="w-5 h-5 text-white/70" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-white">Escrow Locked</p>
                <p className="text-[13px] text-neutral-400">
                  Your USDC is secured on-chain
                </p>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
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
                    className="flex items-center gap-1 text-white/70 hover:text-white/90"
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
            className="bg-white/5 border border-white/6 rounded-2xl p-4 mb-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-white/70" />
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
                className="flex-1 py-3 rounded-xl bg-white/10 text-white text-[15px] font-semibold disabled:opacity-50"
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

        {/* Cancel Request Banner — merchant requested cancel, user decides */}
        {activeOrder.cancelRequest && activeOrder.cancelRequest.requestedBy === 'merchant' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 mb-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <X className="w-5 h-5 text-orange-400" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-white">Cancel Requested</p>
                <p className="text-[13px] text-neutral-400">
                  Merchant wants to cancel: {activeOrder.cancelRequest.reason}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => respondToCancelRequest(true)}
                disabled={isRequestingCancel}
                className="flex-1 py-3 rounded-xl bg-orange-500/20 text-orange-300 text-[15px] font-semibold disabled:opacity-50"
              >
                {isRequestingCancel ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Agree to Cancel"}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => respondToCancelRequest(false)}
                disabled={isRequestingCancel}
                className="flex-1 py-3 rounded-xl bg-neutral-800 text-white text-[15px] font-semibold disabled:opacity-50"
              >
                Continue Order
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Cancel Request Pending — user requested, waiting for merchant */}
        {activeOrder.cancelRequest && activeOrder.cancelRequest.requestedBy === 'user' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 mb-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-white">Cancel Request Sent</p>
                <p className="text-[13px] text-neutral-400">Waiting for merchant to approve</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Inactivity Warning Banner */}
        {activeOrder.inactivityWarned && activeOrder.status !== "disputed" && activeOrder.status !== "complete" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 mb-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-yellow-300">Inactivity Warning</p>
                <p className="text-[13px] text-neutral-400">
                  No activity for 15+ minutes. Complete this order soon or it will be auto-cancelled/disputed.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Dispute Auto-Resolve Countdown */}
        {activeOrder.status === "disputed" && activeOrder.disputeAutoResolveAt && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-red-300">Dispute Timer</p>
                <p className="text-[13px] text-neutral-400">
                  {new Date(activeOrder.disputeAutoResolveAt) > new Date()
                    ? `Auto-refund to escrow funder in ${Math.max(0, Math.round((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) / 3600000))}h ${Math.max(0, Math.round(((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) % 3600000) / 60000))}m`
                    : 'Auto-refund processing...'
                  }
                </p>
              </div>
            </div>
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
                activeOrder.step > 1 ? "bg-white/10 text-black" :
                activeOrder.step === 1 ? "bg-white/10 text-black" : "bg-neutral-800 text-neutral-500"
              }`}>
                {activeOrder.step > 1 ? <Check className="w-4 h-4" /> : "1"}
              </div>
              <div>
                <p className={`text-[15px] font-medium ${activeOrder.step >= 1 ? "text-white" : "text-neutral-600"}`}>
                  Order created
                </p>
                {activeOrder.step >= 1 && (
                  <p className="text-[13px] text-neutral-500">
                    {activeOrder.dbStatus === 'pending' ? 'Waiting for merchant...' : `Matched with ${activeOrder.merchant.name}`}
                  </p>
                )}
                {/* For sell orders waiting for merchant to accept */}
                {activeOrder.step === 1 && activeOrder.type === "sell" && (activeOrder.dbStatus === 'pending' || activeOrder.dbStatus === 'escrowed') && (
                  <div className="mt-3 bg-white/5 border border-white/6 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-white/70 animate-spin" />
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-white/70">Waiting for Merchant</p>
                        <p className="text-[12px] text-neutral-400">{activeOrder.dbStatus === 'escrowed' ? 'Your USDT is locked. Waiting for merchant to accept' : 'Merchant will sign with their wallet to accept'}</p>
                      </div>
                    </div>
                    {activeOrder.dbStatus === 'escrowed' ? (
                      <p className="text-[12px] text-neutral-500">
                        Your USDT is secured in escrow on-chain. The merchant will accept and send fiat to your bank account.
                      </p>
                    ) : (
                      <p className="text-[12px] text-neutral-500">
                        Once accepted, you&apos;ll lock your USDT to escrow. The merchant&apos;s verified wallet will receive funds when you confirm payment.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className={`p-4 rounded-2xl ${activeOrder.step >= 2 ? "bg-neutral-900" : "bg-neutral-950"}`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${
                activeOrder.step > 2 ? "bg-white/10 text-black" :
                activeOrder.step === 2 ? "bg-white/10 text-black" : "bg-neutral-800 text-neutral-500"
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
                  <div className="mt-2 flex items-center gap-2 bg-white/5 border border-white/6 rounded-lg px-3 py-2">
                    <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
                      <Lock className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-[13px] font-medium text-white">
                      {activeOrder.type === "buy" ? "Funds locked in escrow" : "Your USDT locked in escrow"}
                    </span>
                  </div>
                )}

                {/* Show escrow funding in progress for buy orders when escrow not yet funded */}
                {activeOrder.step === 2 && activeOrder.type === "buy" && activeOrder.dbStatus !== 'escrowed' && (
                  <div className="mt-3 space-y-3">
                    <div className="bg-white/5 border border-white/6 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                        </div>
                        <div>
                          <p className="text-[15px] font-medium text-white/70">Escrow Funding in Progress</p>
                          <p className="text-[12px] text-neutral-400">Merchant is locking USDT in escrow</p>
                        </div>
                      </div>
                      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-white/10"
                          animate={{ x: ["-100%", "100%"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                          style={{ width: "40%" }}
                        />
                      </div>
                      <p className="mt-3 text-[12px] text-neutral-500">
                        Once the merchant funds the escrow, you&apos;ll be able to send your payment.
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

                {/* Show payment UI when escrow is funded (escrowed or payment_pending) */}
                {activeOrder.step === 2 && activeOrder.type === "buy" && (activeOrder.dbStatus === 'escrowed' || activeOrder.dbStatus === 'payment_pending') && (
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
                            <div className="absolute inset-0 bg-white/5" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="flex flex-col items-center">
                                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shadow-lg shadow-white/10 mb-1">
                                  <MapPin className="w-5 h-5 text-white" />
                                </div>
                                <div className="w-1 h-3 bg-white/10 rounded-b-full" />
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
                              <Navigation className="w-4 h-4 text-white/70 flex-shrink-0 mt-0.5" />
                              <p className="text-[13px] text-white">{activeOrder.merchant.meetingSpot}</p>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-neutral-700">
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] text-neutral-500">Cash Amount</span>
                              <span className="text-[17px] font-semibold text-white">
                                {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
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
                            className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-white/10 text-white"
                          >
                            I&apos;m at the location
                          </motion.button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="bg-neutral-800 rounded-xl p-3 space-y-2">
                          {activeOrder.merchant.bank && (
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] text-neutral-500">Bank</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] text-white">{activeOrder.merchant.bank}</span>
                                <button onClick={() => copyField('bank', activeOrder.merchant.bank || '')} className="p-0.5 rounded hover:bg-white/10">
                                  {copiedField === 'bank' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-500" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {activeOrder.merchant.iban && (
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] text-neutral-500">IBAN</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] text-white font-mono">{activeOrder.merchant.iban}</span>
                                <button onClick={() => copyField('iban', activeOrder.merchant.iban || '')} className="p-0.5 rounded hover:bg-white/10">
                                  {copiedField === 'iban' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-500" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {activeOrder.merchant.accountName && (
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] text-neutral-500">Name</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] text-white">{activeOrder.merchant.accountName}</span>
                                <button onClick={() => copyField('name', activeOrder.merchant.accountName || '')} className="p-0.5 rounded hover:bg-white/10">
                                  {copiedField === 'name' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-500" />}
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="pt-2 border-t border-neutral-700">
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] text-neutral-500">Amount</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[17px] font-semibold text-white">
                                  {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
                                </span>
                                <button onClick={() => copyField('amount', parseFloat(activeOrder.fiatAmount).toString())} className="p-0.5 rounded hover:bg-white/10">
                                  {copiedField === 'amount' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-500" />}
                                </button>
                              </div>
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
                            className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-white/10 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isLoading ? 'Processing...' : "I've sent the payment"}
                          </motion.button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Sell order step 2 - merchant accepted with wallet signature, now user locks escrow */}
                {activeOrder.step === 2 && activeOrder.type === "sell" && activeOrder.dbStatus === 'accepted' && !activeOrder.escrowTxHash && (
                  <div className="mt-3 space-y-3">
                    <div className="bg-white/5 border border-white/6 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                          <Lock className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-[15px] font-medium text-white">Merchant Accepted - Lock Escrow</p>
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
                            showAlert('Wallet Error', 'Wallet not ready. Please reconnect your wallet.', 'error');
                            return;
                          }
                          setIsLoading(true);
                          try {
                            const merchantWallet = activeOrder.acceptorWalletAddress || activeOrder.merchant.walletAddress;
                            if (!merchantWallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet)) {
                              showAlert('Wallet Error', 'Merchant wallet not available. Please wait for merchant to accept the order with their wallet.', 'warning');
                              setIsLoading(false);
                              return;
                            }
                            const escrowResult = await solanaWallet.depositToEscrow({
                              amount: parseFloat(activeOrder.cryptoAmount),
                              merchantWallet,
                            });
                            if (escrowResult.success) {
                              await fetchWithAuth(`/api/orders/${activeOrder.id}/escrow`, {
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
                              setOrders(prev => prev.map(o =>
                                o.id === activeOrder.id ? { ...o, dbStatus: 'escrowed', escrowTxHash: escrowResult.txHash } : o
                              ));
                              playSound('trade_complete');
                            }
                          } catch (err: any) {
                            console.error('Escrow failed:', err);
                            showAlert('Escrow Failed', err?.message || 'Failed to lock escrow. Please try again.', 'error');
                            playSound('error');
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        disabled={isLoading || (solanaWallet.connected && !solanaWallet.programReady)}
                        className="w-full py-3 rounded-xl text-[15px] font-semibold bg-white/10 text-white flex items-center justify-center gap-2 disabled:opacity-50"
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
                {activeOrder.step === 2 && activeOrder.type === "sell" && (activeOrder.dbStatus === 'escrowed' || activeOrder.escrowTxHash) && (
                  <div className="mt-2">
                    <p className="text-[13px] text-neutral-500">Your USDT is locked in escrow. Waiting for merchant to send AED payment...</p>

                    <div className="mt-3 bg-neutral-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] text-neutral-500">Expected payment</span>
                        <span className="text-[15px] font-semibold text-white">
                          {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-600">
                        Merchant will send this amount to your bank account
                      </p>
                    </div>

                    <div className="mt-3 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-orange-400"
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
                activeOrder.step > 3 ? "bg-white/10 text-black" :
                activeOrder.step === 3 ? "bg-white/10 text-black" : "bg-neutral-800 text-neutral-500"
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
                        className="h-full bg-white/10"
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
                    <div className="bg-white/5 border border-white/6 rounded-xl p-3 mb-3">
                      <p className="text-[13px] text-white/70">
                        Merchant has sent {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()} to your bank.
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
                        className="flex-[2] py-3 rounded-xl text-[15px] font-semibold bg-white/10 text-white flex items-center justify-center gap-2 disabled:opacity-50"
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
                activeOrder.step >= 4 ? "bg-white/10 text-black" : "bg-neutral-800 text-neutral-500"
              }`}>
                {activeOrder.step >= 4 ? <Check className="w-4 h-4" /> : "4"}
              </div>
              <div>
                <p className={`text-[15px] font-medium ${activeOrder.step >= 4 ? "text-white" : "text-neutral-600"}`}>
                  Complete
                </p>
                {activeOrder.step >= 4 && (
                  <p className="text-[13px] text-white">Trade completed successfully</p>
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
                    <Star className={`w-8 h-8 ${star <= rating ? "fill-amber-400 text-white/70" : "text-neutral-700"}`} />
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
              <div className="w-10 h-10 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white font-semibold">
                {activeOrder.merchant.name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-medium text-white">{activeOrder.merchant.name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    activeOrder.merchant.paymentMethod === "cash"
                      ? "bg-white/5 text-white"
                      : "bg-white/10 text-white/70"
                  }`}>
                    {activeOrder.merchant.paymentMethod === "cash" ? "Cash" : "Bank"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-400 text-white/70" />
                  <span className="text-[13px] text-neutral-400">{activeOrder.merchant.rating} {'\u00b7'} {activeOrder.merchant.trades} trades</span>
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

        {/* Cancel & Dispute Buttons - Show for active orders (step 2-3) */}
        {activeOrder.step >= 2 && activeOrder.step < 4 && activeOrder.status !== "disputed" && !activeOrder.cancelRequest && (
          <button
            onClick={() => requestCancelOrder()}
            disabled={isRequestingCancel}
            className="w-full mt-3 py-3 rounded-2xl text-[14px] font-medium bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isRequestingCancel ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Request Cancellation
          </button>
        )}
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
                  <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10" />
                  <div>
                    <p className="text-[15px] font-medium text-white">{activeOrder.merchant.name}</p>
                    <div className="flex items-center gap-1.5">
                      <ConnectionIndicator isConnected={true} />
                      <p className="text-[11px] text-orange-400/80">Online</p>
                    </div>
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
                            <div className="w-full max-w-[90%] bg-white/5 border border-white/6 rounded-2xl p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Shield className="w-4 h-4 text-white/70" />
                                <span className="text-[13px] font-semibold text-white/70">
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
                                    className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-white/10 text-white disabled:opacity-50"
                                  >
                                    Accept
                                  </button>
                                </div>
                              )}
                              {disputeInfo?.user_confirmed && !disputeInfo?.merchant_confirmed && (
                                <p className="text-[11px] text-white mt-2">
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
                            <div className="w-full max-w-[90%] bg-white/5 border border-white/6 rounded-2xl p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Check className="w-4 h-4 text-white" />
                                <span className="text-[13px] font-semibold text-white">Resolution Finalized</span>
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
                              isAccepted ? 'bg-white/5 text-white' : 'bg-red-500/10 text-red-400'
                            }`}>
                              {data.party === 'user' ? 'You' : 'Merchant'} {isAccepted ? 'accepted' : 'rejected'} the resolution
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message
                      }
                    }

                    // Detect receipt card messages
                    try {
                      if (msg.text.startsWith('{')) {
                        const parsed = JSON.parse(msg.text);
                        if (parsed.type === 'order_receipt' && parsed.data) {
                          return (
                            <div key={msg.id} className="max-w-[90%] mx-auto">
                              <ReceiptCard data={parsed.data} currentStatus={activeOrder?.status} />
                              <p className="text-[10px] text-neutral-500 mt-1 text-center">
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          );
                        }
                      }
                    } catch { /* not JSON */ }

                    // Regular messages
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${msg.from === "me" ? "justify-end" : msg.from === "system" ? "justify-center" : "justify-start"}`}
                      >
                        <div className={`max-w-[80%] flex flex-col ${msg.from === "me" ? "items-end" : "items-start"}`}>
                          {msg.from !== "me" && msg.from !== "system" && msg.senderName && (
                            <span className="text-[11px] text-neutral-500 mb-0.5 px-1">{msg.senderName}</span>
                          )}
                          <div
                            className={`px-4 py-2 rounded-2xl text-[15px] ${
                              msg.from === "me"
                                ? "bg-white text-black"
                                : msg.from === "system"
                                ? "bg-neutral-700/50 text-neutral-300 text-[13px]"
                                : "bg-neutral-800 text-white"
                            }`}
                          >
                            {msg.messageType === 'image' && msg.imageUrl && (
                              <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={msg.imageUrl}
                                  alt="Shared image"
                                  className="max-w-full max-h-48 rounded-xl mb-1 object-contain"
                                  loading="lazy"
                                />
                              </a>
                            )}
                            {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          </div>
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
                    <div className="w-full max-w-[90%] bg-white/5 border border-white/6 rounded-2xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-white/70" />
                        <span className="text-[13px] font-semibold text-white/70">Resolution Proposed</span>
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
                            className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-white/10 text-white disabled:opacity-50"
                          >
                            Accept
                          </button>
                        </div>
                      )}
                      {disputeInfo.user_confirmed && !disputeInfo.merchant_confirmed && (
                        <p className="text-[11px] text-white mt-2">
                          You accepted. Waiting for merchant confirmation...
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* Typing indicator */}
              {activeChat?.isTyping && (
                <div className="px-4 py-1">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-[11px] text-neutral-500">{activeOrder.merchant.name} is typing...</span>
                  </div>
                </div>
              )}

              {/* Emoji picker */}
              {showEmojiPicker && (
                <div className="absolute bottom-24 left-4 right-4 z-50">
                  <EmojiPicker
                    onEmojiClick={(emojiData: { emoji: string }) => {
                      setChatMessage(chatMessage + emojiData.emoji);
                      setShowEmojiPicker(false);
                      chatInputRef.current?.focus();
                    }}
                    width="100%"
                    height={350}
                    theme={"dark" as any}
                    searchDisabled
                    skinTonesDisabled
                    previewConfig={{ showPreview: false }}
                  />
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Image preview bar */}
              {pendingImage && (
                <div className="px-4 py-2 border-t border-neutral-800 flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={pendingImage.previewUrl}
                      alt="Preview"
                      className="w-16 h-16 rounded-xl object-cover border border-neutral-700"
                    />
                    <button
                      onClick={clearPendingImage}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-700 flex items-center justify-center"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                  <span className="text-[13px] text-neutral-400 flex-1">Image ready to send</span>
                </div>
              )}

              <div className="p-4 border-t border-neutral-800 pb-8">
                <div className="flex items-center gap-2">
                  {/* Emoji button */}
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center shrink-0"
                  >
                    <span className="text-lg">😊</span>
                  </button>
                  {/* Image attach button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center shrink-0 disabled:opacity-50"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-neutral-400" />
                    )}
                  </button>
                  <input
                    ref={chatInputRef}
                    value={chatMessage}
                    onChange={(e) => handleTypingChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (pendingImage) {
                          uploadAndSend();
                        } else {
                          handleSendMessage();
                        }
                        setShowEmojiPicker(false);
                      }
                    }}
                    placeholder={pendingImage ? "Add a caption..." : "Message..."}
                    className="flex-1 bg-neutral-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-neutral-600 outline-none"
                  />
                  <button
                    onClick={() => {
                      if (pendingImage) {
                        uploadAndSend();
                      } else {
                        handleSendMessage();
                      }
                      setShowEmojiPicker(false);
                    }}
                    disabled={isUploading}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                      pendingImage ? 'bg-orange-500' : 'bg-white'
                    } disabled:opacity-50`}
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 text-black animate-spin" />
                    ) : (
                      <ChevronRight className={`w-5 h-5 ${pendingImage ? 'text-white' : 'text-black'}`} />
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
