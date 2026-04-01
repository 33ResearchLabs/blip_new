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
import {
  type RefObject,
  useState as useLocalState,
  useRef as useLocalRef,
  useCallback as useLocalCallback,
  useEffect as useLocalEffect,
} from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import dynamic from "next/dynamic";
import { showAlert } from "@/context/ModalContext";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

export interface OrderDetailScreenProps {
  setScreen: (s: Screen) => void;
  previousScreen?: Screen;
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
  requestExtension: (durationMinutes?: number) => void;
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
      receiptData?: Record<string, unknown> | null;
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
  respondToResolution: (action: "accept" | "reject") => void;
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
    depositToEscrow: (params: {
      amount: number;
      merchantWallet: string;
    }) => Promise<{
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
  playSound: (
    sound:
      | "message"
      | "send"
      | "trade_start"
      | "trade_complete"
      | "notification"
      | "error"
      | "click"
      | "new_order"
      | "order_complete",
  ) => void;
  maxW: string;
}

export const OrderDetailScreen = ({
  setScreen,
  previousScreen,
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

  const copyField = useLocalCallback(
    (field: string, text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedField(field);
        handleCopy(text);
        setTimeout(() => setCopiedField(null), 1500);
      });
    },
    [handleCopy],
  );
  const [pendingImage, setPendingImage] = useLocalState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useLocalRef<HTMLInputElement>(null);
  const typingTimeoutRef = useLocalRef<NodeJS.Timeout | null>(null);

  // Handle file select — only store locally + show preview (no upload yet)
  const handleFileSelect = useLocalCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) return; // 10MB max
      if (!file.type.startsWith("image/")) return;

      const previewUrl = URL.createObjectURL(file);
      setPendingImage({ file, previewUrl });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

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
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (userId) authHeaders["x-user-id"] = userId;
      const sigRes = await fetch("/api/upload/signature", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ orderId: activeChat.orderId || "chat" }),
      });
      if (!sigRes.ok) {
        setIsUploading(false);
        return;
      }
      const sigData = await sigRes.json();
      if (!sigData.success) {
        setIsUploading(false);
        return;
      }
      const sig = sigData.data;

      const formData = new FormData();
      formData.append("file", pendingImage.file);
      formData.append("signature", sig.signature);
      formData.append("timestamp", sig.timestamp.toString());
      formData.append("api_key", sig.apiKey);
      formData.append("folder", sig.folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: "POST", body: formData },
      );
      if (uploadRes.ok) {
        const result = await uploadRes.json();
        const text = chatMessage.trim() || "Photo";
        sendChatMessage(activeChat.id, text, result.secure_url);
        setChatMessage("");
        playSound("send");
      } else {
        console.error(
          "[OrderDetailScreen] Cloudinary upload failed:",
          uploadRes.status,
          await uploadRes.text().catch(() => ""),
        );
      }
    } catch (err) {
      console.error("[OrderDetailScreen] Image upload error:", err);
    } finally {
      setIsUploading(false);
      clearPendingImage();
    }
  }, [
    pendingImage,
    activeChat,
    sendChatMessage,
    chatMessage,
    setChatMessage,
    playSound,
    clearPendingImage,
    userId,
  ]);

  // Cleanup preview URL on unmount
  useLocalEffect(() => {
    return () => {
      if (pendingImage?.previewUrl)
        URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  // Handle typing indicator
  const handleTypingChange = useLocalCallback(
    (value: string) => {
      setChatMessage(value);
      if (!activeChat || !sendTypingIndicator) return;

      // Send typing start
      sendTypingIndicator(activeChat.id, true);

      // Clear previous timeout and set new one to send typing stop
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingIndicator(activeChat.id, false);
      }, 2000);
    },
    [activeChat, sendTypingIndicator, setChatMessage],
  );

  // Cleanup typing timeout
  useLocalEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  return (
    <div style={{ background: "#ffffff", minHeight: "100%" }}>
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button
          onClick={() => setScreen(previousScreen || "home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1"
          style={{
            background: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <ChevronLeft
            className="w-5 h-5"
            style={{ color: "rgba(255,255,255,0.6)" }}
          />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-black pr-8">
          Order Details
        </h1>
      </div>

      <div className="flex-1 px-5 overflow-auto pb-6">
        {/* Order Summary */}
        <div
          className="rounded-2xl p-4 mb-4"
          style={{
            background: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background:
                  activeOrder.type === "buy"
                    ? "rgba(16,185,129,0.15)"
                    : "rgba(239,68,68,0.15)",
              }}
            >
              {activeOrder.type === "buy" ? (
                <ArrowDownLeft
                  className="w-5 h-5"
                  style={{ color: "#10b981" }}
                />
              ) : (
                <ArrowUpRight
                  className="w-5 h-5"
                  style={{ color: "#ef4444" }}
                />
              )}
            </div>
            <div>
              <p
                className="text-[17px] font-semibold"
                style={{ color: "#fff" }}
              >
                {activeOrder.type === "buy" ? "Buying" : "Selling"}{" "}
                {parseFloat(activeOrder.cryptoAmount).toFixed(2)} USDC
              </p>
              <p
                className="text-[13px]"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                {"\u062F.\u0625"}{" "}
                {parseFloat(activeOrder.fiatAmount).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-1.5 mb-2">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className="flex-1 h-1.5 rounded-full"
                style={{
                  background:
                    activeOrder.status === "cancelled" ||
                    activeOrder.status === "expired"
                      ? "rgba(239,68,68,0.4)"
                      : step <= activeOrder.step
                        ? "#fff"
                        : "rgba(255,255,255,0.15)",
                }}
              />
            ))}
          </div>
          <p
            className="text-[13px]"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            {activeOrder.status === "cancelled"
              ? "Order Cancelled"
              : activeOrder.status === "expired"
                ? "Order Expired"
                : `Step ${activeOrder.step} of 4`}
          </p>
        </div>

        {/* Escrow Status Section - Show for sell orders with escrow */}
        {activeOrder.type === "sell" && activeOrder.escrowTxHash && (
          <div
            className="rounded-2xl p-4 mb-4"
            style={{
              background: "#111111",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                <Lock
                  className="w-5 h-5"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                />
              </div>
              <div className="flex-1">
                <p
                  className="text-[15px] font-semibold"
                  style={{ color: "#fff" }}
                >
                  Escrow Locked
                </p>
                <p
                  className="text-[13px]"
                  style={{ color: "rgba(255,255,255,0.45)" }}
                >
                  Your USDC is secured on-chain
                </p>
              </div>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                <Check className="w-4 h-4" style={{ color: "#fff" }} />
              </div>
            </div>

            <div className="space-y-2 text-[13px]">
              {activeOrder.escrowTradeId && (
                <div className="flex items-center justify-between">
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>
                    Trade ID
                  </span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: "#fff" }}
                  >
                    #{activeOrder.escrowTradeId}
                  </span>
                </div>
              )}
              {activeOrder.escrowTxHash && (
                <div className="flex items-center justify-between">
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>
                    Transaction
                  </span>
                  <a
                    href={`https://explorer.solana.com/tx/${activeOrder.escrowTxHash}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1"
                    style={{ color: "rgba(255,255,255,0.6)" }}
                  >
                    <span className="font-mono">
                      {activeOrder.escrowTxHash.slice(0, 8)}...
                      {activeOrder.escrowTxHash.slice(-6)}
                    </span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Extension Request Banner */}
        {extensionRequest &&
          extensionRequest.requestedBy === "merchant" &&
          extensionRequest.orderId === activeOrder.id && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-4 mb-4"
              style={{
                background: "#111111",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  <Clock
                    className="w-5 h-5"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                  />
                </div>
                <div className="flex-1">
                  <p
                    className="text-[15px] font-semibold"
                    style={{ color: "#fff" }}
                  >
                    Extension Requested
                  </p>
                  <p
                    className="text-[13px]"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    Merchant wants +
                    {extensionRequest.extensionMinutes >= 60
                      ? `${Math.round(extensionRequest.extensionMinutes / 60)} hour${Math.round(extensionRequest.extensionMinutes / 60) > 1 ? "s" : ""}`
                      : `${extensionRequest.extensionMinutes} minutes`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToExtension(true)}
                  disabled={requestingExtension}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50"
                  style={{ background: "#fff", color: "#000" }}
                >
                  {requestingExtension ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    "Accept"
                  )}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToExtension(false)}
                  disabled={requestingExtension}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  Decline
                </motion.button>
              </div>
              <p
                className="text-[11px] text-center mt-2"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                Extensions used: {extensionRequest.extensionCount}/
                {extensionRequest.maxExtensions}
              </p>
            </motion.div>
          )}

        {/* Cancel Request Banner — merchant requested cancel, user decides */}
        {activeOrder.cancelRequest &&
          activeOrder.cancelRequest.requestedBy === "merchant" &&
          activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 mb-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <X className="w-5 h-5 text-orange-500" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-orange-700">
                    Cancel Requested
                  </p>
                  <p className="text-[13px] text-orange-600/70">
                    Merchant wants to cancel: {activeOrder.cancelRequest.reason}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToCancelRequest(true)}
                  disabled={isRequestingCancel}
                  className="flex-1 py-3 rounded-xl bg-orange-500/20 text-orange-700 text-[15px] font-semibold disabled:opacity-50"
                >
                  {isRequestingCancel ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    "Agree to Cancel"
                  )}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToCancelRequest(false)}
                  disabled={isRequestingCancel}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  Continue Order
                </motion.button>
              </div>
            </motion.div>
          )}

        {/* Cancel Request Pending — user requested, waiting for merchant */}
        {activeOrder.cancelRequest &&
          activeOrder.cancelRequest.requestedBy === "user" &&
          activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 mb-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-orange-700">
                    Cancel Request Sent
                  </p>
                  <p className="text-[13px] text-orange-600/70">
                    Waiting for merchant to approve
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        {/* Inactivity Warning Banner */}
        {activeOrder.inactivityWarned &&
          activeOrder.status !== "disputed" &&
          activeOrder.status !== "complete" &&
          activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 mb-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-yellow-700">
                    Inactivity Warning
                  </p>
                  <p className="text-[13px] text-yellow-600/70">
                    No activity for 15+ minutes. Complete this order soon or it
                    will be auto-cancelled/disputed.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        {/* Dispute Auto-Resolve Countdown */}
        {activeOrder.status === "disputed" &&
          activeOrder.disputeAutoResolveAt && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-red-600">
                    Dispute Timer
                  </p>
                  <p className="text-[13px] text-red-500/70">
                    {new Date(activeOrder.disputeAutoResolveAt) > new Date()
                      ? `Auto-refund to escrow funder in ${Math.max(0, Math.round((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) / 3600000))}h ${Math.max(0, Math.round(((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) % 3600000) / 60000))}m`
                      : "Auto-refund processing..."}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        {/* Request Extension — duration picker for payment_sent, simple button otherwise */}
        {activeOrder.step >= 2 &&
          activeOrder.step < 4 &&
          !extensionRequest &&
          (activeOrder.step === 3 ? (
            /* Payment sent: fiat sender picks duration */
            <div className="mb-4">
              <p
                className="text-[12px] font-medium mb-2 flex items-center gap-1.5"
                style={{ color: "rgba(0,0,0,0.45)" }}
              >
                <Clock className="w-3.5 h-3.5" />
                Request Time Extension
              </p>
              <div className="flex gap-2">
                {[
                  { minutes: 15, label: "15 min" },
                  { minutes: 60, label: "1 hour" },
                  { minutes: 720, label: "12 hours" },
                ].map((opt) => (
                  <motion.button
                    key={opt.minutes}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => requestExtension(opt.minutes)}
                    disabled={requestingExtension}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-medium flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
                    style={{
                      background: "rgba(0,0,0,0.05)",
                      border: "1px solid rgba(0,0,0,0.1)",
                      color: "rgba(0,0,0,0.5)",
                    }}
                  >
                    {requestingExtension ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      opt.label
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            /* Pre-payment: simple extension request */
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => requestExtension()}
              disabled={requestingExtension}
              className="w-full py-3 rounded-xl text-[13px] font-medium mb-4 flex items-center justify-center gap-2 disabled:opacity-50"
              style={{
                background: "rgba(0,0,0,0.05)",
                border: "1px solid rgba(0,0,0,0.1)",
                color: "rgba(0,0,0,0.5)",
              }}
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
          ))}

        {/* Cancelled/Expired Banner */}
        {(activeOrder.status === "cancelled" ||
          activeOrder.status === "expired") && (
          <div className="mb-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <X className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-red-400">
                  {activeOrder.status === "cancelled"
                    ? "Order Cancelled"
                    : "Order Expired"}
                </p>
                <p className="text-[13px] text-white/40">
                  {activeOrder.status === "cancelled"
                    ? "This trade was cancelled and did not complete."
                    : "This order expired before it could be completed."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Steps — hidden when cancelled/expired */}
        {activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <div className="space-y-3">
              {/* Step 1 */}
              <div
                className="p-4 rounded-2xl"
                style={
                  activeOrder.step >= 1
                    ? {
                        background: "#111111",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }
                    : {
                        background: "rgba(0,0,0,0.04)",
                        border: "1px solid rgba(0,0,0,0.08)",
                      }
                }
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
                    style={
                      activeOrder.step >= 1
                        ? { background: "#fff", color: "#000" }
                        : {
                            background: "rgba(0,0,0,0.06)",
                            color: "rgba(0,0,0,0.3)",
                          }
                    }
                  >
                    {activeOrder.step > 1 ? <Check className="w-4 h-4" /> : "1"}
                  </div>
                  <div>
                    <p
                      className="text-[15px] font-medium"
                      style={{
                        color:
                          activeOrder.step >= 1 ? "#fff" : "rgba(0,0,0,0.3)",
                      }}
                    >
                      Order created
                    </p>
                    {activeOrder.step >= 1 && (
                      <p
                        className="text-[13px]"
                        style={{ color: "rgba(255,255,255,0.45)" }}
                      >
                        {activeOrder.dbStatus === "pending"
                          ? "Waiting for merchant..."
                          : `Matched with ${activeOrder.merchant.name}`}
                      </p>
                    )}
                    {/* For sell orders waiting for merchant to mine/claim */}
                    {activeOrder.step === 1 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "escrowed" && (
                        <div
                          className="mt-3 rounded-xl p-4"
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.12)",
                          }}
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center"
                              style={{ background: "rgba(255,255,255,0.1)" }}
                            >
                              <Loader2
                                className="w-4 h-4 animate-spin"
                                style={{ color: "rgba(255,255,255,0.5)" }}
                              />
                            </div>
                            <div>
                              <p
                                className="text-[14px] font-medium"
                                style={{ color: "rgba(255,255,255,0.7)" }}
                              >
                                Waiting for Merchant
                              </p>
                              <p
                                className="text-[12px]"
                                style={{ color: "rgba(255,255,255,0.45)" }}
                              >
                                Your USDT is locked. Waiting for merchant to
                                claim
                              </p>
                            </div>
                          </div>
                          <p
                            className="text-[12px]"
                            style={{ color: "rgba(255,255,255,0.4)" }}
                          >
                            Your USDT is secured in escrow on-chain. A merchant
                            will claim this order and send fiat to your bank
                            account.
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div
                className="p-4 rounded-2xl"
                style={
                  activeOrder.step >= 2
                    ? {
                        background: "#111111",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }
                    : {
                        background: "rgba(0,0,0,0.04)",
                        border: "1px solid rgba(0,0,0,0.08)",
                      }
                }
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
                    style={
                      activeOrder.step >= 2
                        ? { background: "#fff", color: "#000" }
                        : {
                            background: "rgba(0,0,0,0.06)",
                            color: "rgba(0,0,0,0.3)",
                          }
                    }
                  >
                    {activeOrder.step > 2 ? <Check className="w-4 h-4" /> : "2"}
                  </div>
                  <div className="flex-1">
                    <p
                      className="text-[15px] font-medium"
                      style={{
                        color:
                          activeOrder.step >= 2 ? "#fff" : "rgba(0,0,0,0.3)",
                      }}
                    >
                      {activeOrder.type === "buy"
                        ? activeOrder.merchant.paymentMethod === "cash"
                          ? "Meet & pay cash"
                          : "Send payment"
                        : "Waiting for merchant"}
                    </p>

                    {/* Funds Locked indicator - show when escrow is locked */}
                    {activeOrder.step === 2 &&
                      activeOrder.dbStatus === "escrowed" && (
                        <div
                          className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2"
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.12)",
                          }}
                        >
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(255,255,255,0.1)" }}
                          >
                            <Lock
                              className="w-3 h-3"
                              style={{ color: "#fff" }}
                            />
                          </div>
                          <span
                            className="text-[13px] font-medium"
                            style={{ color: "#fff" }}
                          >
                            {activeOrder.type === "buy"
                              ? "Funds locked in escrow"
                              : "Your USDT locked in escrow"}
                          </span>
                        </div>
                      )}

                    {/* Show escrow funding in progress for buy orders when escrow not yet funded */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus !== "escrowed" && (
                        <div className="mt-3 space-y-3">
                          <div
                            className="rounded-xl p-4"
                            style={{
                              background: "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}
                          >
                            <div className="flex items-center gap-3 mb-3">
                              <div
                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                style={{ background: "rgba(255,255,255,0.1)" }}
                              >
                                <Loader2
                                  className="w-5 h-5 animate-spin"
                                  style={{ color: "rgba(255,255,255,0.5)" }}
                                />
                              </div>
                              <div>
                                <p
                                  className="text-[15px] font-medium"
                                  style={{ color: "rgba(255,255,255,0.7)" }}
                                >
                                  Escrow Funding in Progress
                                </p>
                                <p
                                  className="text-[12px]"
                                  style={{ color: "rgba(255,255,255,0.45)" }}
                                >
                                  Merchant is locking USDT in escrow
                                </p>
                              </div>
                            </div>
                            <div
                              className="h-1.5 rounded-full overflow-hidden"
                              style={{ background: "rgba(255,255,255,0.1)" }}
                            >
                              <motion.div
                                className="h-full"
                                style={{
                                  background: "rgba(255,255,255,0.3)",
                                  width: "40%",
                                }}
                                animate={{ x: ["-100%", "100%"] }}
                                transition={{
                                  duration: 1.5,
                                  repeat: Infinity,
                                  ease: "linear",
                                }}
                              />
                            </div>
                            <p
                              className="mt-3 text-[12px]"
                              style={{ color: "rgba(255,255,255,0.4)" }}
                            >
                              Once the merchant funds the escrow, you&apos;ll be
                              able to send your payment.
                            </p>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="w-full py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2"
                            style={{
                              background: "rgba(255,255,255,0.12)",
                              color: "#fff",
                              border: "1px solid rgba(255,255,255,0.15)",
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Merchant
                          </button>
                        </div>
                      )}

                    {/* Show payment UI when escrow is funded (escrowed or payment_pending) */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "buy" &&
                      (activeOrder.dbStatus === "escrowed" ||
                        activeOrder.dbStatus === "payment_pending") && (
                        <div className="mt-3 space-y-3">
                          {activeOrder.merchant.paymentMethod === "cash" ? (
                            <>
                              {/* Map Preview */}
                              <div className="relative rounded-xl overflow-hidden">
                                <div
                                  className="h-40 relative"
                                  style={{
                                    background: "#1e1e1e",
                                    backgroundImage: `url('https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-s+000000(${activeOrder.merchant.lng},${activeOrder.merchant.lat})/${activeOrder.merchant.lng},${activeOrder.merchant.lat},14,0/400x200@2x?access_token=pk.placeholder')`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }}
                                >
                                  {/* Fallback map UI */}
                                  <div
                                    className="absolute inset-0"
                                    style={{
                                      background: "rgba(255,255,255,0.03)",
                                    }}
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="flex flex-col items-center">
                                      <div
                                        className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg mb-1"
                                        style={{ background: "#000" }}
                                      >
                                        <MapPin className="w-5 h-5 text-white" />
                                      </div>
                                      <div
                                        className="w-1 h-3 rounded-b-full"
                                        style={{
                                          background: "rgba(255,255,255,0.3)",
                                        }}
                                      />
                                    </div>
                                  </div>
                                  {/* Grid pattern for map feel */}
                                  <div className="absolute inset-0 opacity-10">
                                    <div
                                      className="w-full h-full"
                                      style={{
                                        backgroundImage:
                                          "linear-gradient(rgba(0,0,0,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.15) 1px, transparent 1px)",
                                        backgroundSize: "40px 40px",
                                      }}
                                    />
                                  </div>
                                </div>
                                <button
                                  onClick={() =>
                                    window.open(
                                      `https://maps.google.com/?q=${activeOrder.merchant.lat},${activeOrder.merchant.lng}`,
                                      "_blank",
                                    )
                                  }
                                  className="absolute top-3 right-3 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                                  style={{ background: "rgba(0,0,0,0.8)" }}
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-white" />
                                  <span className="text-[12px] font-medium text-white">
                                    Open Maps
                                  </span>
                                </button>
                              </div>

                              {/* Meeting Details */}
                              <div
                                className="rounded-xl p-3 space-y-3"
                                style={{ background: "#1e1e1e" }}
                              >
                                <div>
                                  <p
                                    className="text-[11px] uppercase tracking-wide mb-1"
                                    style={{ color: "rgba(255,255,255,0.4)" }}
                                  >
                                    Meeting Location
                                  </p>
                                  <p
                                    className="text-[15px] font-medium"
                                    style={{ color: "#fff" }}
                                  >
                                    {activeOrder.merchant.location}
                                  </p>
                                  <p
                                    className="text-[13px]"
                                    style={{ color: "rgba(255,255,255,0.5)" }}
                                  >
                                    {activeOrder.merchant.address}
                                  </p>
                                </div>
                                <div
                                  className="pt-2"
                                  style={{
                                    borderTop:
                                      "1px solid rgba(255,255,255,0.1)",
                                  }}
                                >
                                  <p
                                    className="text-[11px] uppercase tracking-wide mb-1"
                                    style={{ color: "rgba(255,255,255,0.4)" }}
                                  >
                                    Meeting Spot
                                  </p>
                                  <div className="flex items-start gap-2">
                                    <Navigation
                                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                                      style={{ color: "rgba(255,255,255,0.5)" }}
                                    />
                                    <p
                                      className="text-[13px]"
                                      style={{ color: "#fff" }}
                                    >
                                      {activeOrder.merchant.meetingSpot}
                                    </p>
                                  </div>
                                </div>
                                <div
                                  className="pt-2"
                                  style={{
                                    borderTop:
                                      "1px solid rgba(255,255,255,0.1)",
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <span
                                      className="text-[13px]"
                                      style={{
                                        color: "rgba(255,255,255,0.45)",
                                      }}
                                    >
                                      Cash Amount
                                    </span>
                                    <span
                                      className="text-[17px] font-semibold"
                                      style={{ color: "#fff" }}
                                    >
                                      {"\u062F.\u0625"}{" "}
                                      {parseFloat(
                                        activeOrder.fiatAmount,
                                      ).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className="flex-1 py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2"
                                  style={{
                                    background: "rgba(255,255,255,0.12)",
                                    color: "#fff",
                                    border: "1px solid rgba(255,255,255,0.15)",
                                  }}
                                >
                                  <MessageCircle className="w-4 h-4" />
                                  Chat
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.98 }}
                                  onClick={markPaymentSent}
                                  className="flex-[2] py-3 rounded-xl text-[15px] font-semibold"
                                  style={{ background: "#fff", color: "#000" }}
                                >
                                  I&apos;m at the location
                                </motion.button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div
                                className="rounded-xl p-3 space-y-2"
                                style={{ background: "#1e1e1e" }}
                              >
                                {/* Locked payment method header */}
                                {activeOrder.lockedPaymentMethod && (
                                  <div
                                    className="flex items-center gap-1.5 pb-2"
                                    style={{
                                      borderBottom:
                                        "1px solid rgba(255,255,255,0.1)",
                                    }}
                                  >
                                    <Lock className="w-3 h-3 text-orange-400" />
                                    <span className="text-[10px] text-orange-400 font-bold uppercase tracking-wide">
                                      Send payment to this method only
                                    </span>
                                  </div>
                                )}
                                {/* Show merchant's payment method if available, then locked payment method, then fall back to offer details */}
                                {activeOrder.merchantPaymentMethod ? (
                                  <>
                                    <div className="flex items-center justify-between">
                                      <span
                                        className="text-[13px]"
                                        style={{
                                          color: "rgba(255,255,255,0.45)",
                                        }}
                                      >
                                        Method
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className="text-[13px] font-medium"
                                          style={{ color: "#fff" }}
                                        >
                                          {
                                            activeOrder.merchantPaymentMethod
                                              .name
                                          }
                                        </span>
                                        <button
                                          onClick={() =>
                                            copyField(
                                              "method",
                                              activeOrder.merchantPaymentMethod!
                                                .name,
                                            )
                                          }
                                          className="p-0.5 rounded hover:bg-white/10"
                                        >
                                          {copiedField === "method" ? (
                                            <Check className="w-3.5 h-3.5 text-green-500" />
                                          ) : (
                                            <Copy
                                              className="w-3.5 h-3.5"
                                              style={{
                                                color: "rgba(255,255,255,0.3)",
                                              }}
                                            />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                    {activeOrder.merchantPaymentMethod
                                      .details && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          Details
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px] font-mono"
                                            style={{ color: "#fff" }}
                                          >
                                            {
                                              activeOrder.merchantPaymentMethod
                                                .details
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "details",
                                                activeOrder
                                                  .merchantPaymentMethod!
                                                  .details,
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "details" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : activeOrder.lockedPaymentMethod ? (
                                  <>
                                    {activeOrder.lockedPaymentMethod.details
                                      .bank_name && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          Bank
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px]"
                                            style={{ color: "#fff" }}
                                          >
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.bank_name
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "bank",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.bank_name || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "bank" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .iban && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          IBAN
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px] font-mono"
                                            style={{ color: "#fff" }}
                                          >
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.iban
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "iban",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.iban || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "iban" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .account_name && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          Name
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px]"
                                            style={{ color: "#fff" }}
                                          >
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.account_name
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "name",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.account_name || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "name" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .upi_id && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          UPI
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px] font-mono"
                                            style={{ color: "#fff" }}
                                          >
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.upi_id
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "upi",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.upi_id || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "upi" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {activeOrder.merchant.bank && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          Bank
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px]"
                                            style={{ color: "#fff" }}
                                          >
                                            {activeOrder.merchant.bank}
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "bank",
                                                activeOrder.merchant.bank || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "bank" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.merchant.iban && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          IBAN
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px] font-mono"
                                            style={{ color: "#fff" }}
                                          >
                                            {activeOrder.merchant.iban}
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "iban",
                                                activeOrder.merchant.iban || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "iban" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.merchant.accountName && (
                                      <div className="flex items-center justify-between">
                                        <span
                                          className="text-[13px]"
                                          style={{
                                            color: "rgba(255,255,255,0.45)",
                                          }}
                                        >
                                          Name
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span
                                            className="text-[13px]"
                                            style={{ color: "#fff" }}
                                          >
                                            {activeOrder.merchant.accountName}
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "name",
                                                activeOrder.merchant
                                                  .accountName || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-white/10"
                                          >
                                            {copiedField === "name" ? (
                                              <Check className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                              <Copy
                                                className="w-3.5 h-3.5"
                                                style={{
                                                  color:
                                                    "rgba(255,255,255,0.3)",
                                                }}
                                              />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                                <div
                                  className="pt-2"
                                  style={{
                                    borderTop:
                                      "1px solid rgba(255,255,255,0.1)",
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <span
                                      className="text-[13px]"
                                      style={{
                                        color: "rgba(255,255,255,0.45)",
                                      }}
                                    >
                                      Amount
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="text-[17px] font-semibold"
                                        style={{ color: "#fff" }}
                                      >
                                        {"\u062F.\u0625"}{" "}
                                        {parseFloat(
                                          activeOrder.fiatAmount,
                                        ).toLocaleString()}
                                      </span>
                                      <button
                                        onClick={() =>
                                          copyField(
                                            "amount",
                                            parseFloat(
                                              activeOrder.fiatAmount,
                                            ).toString(),
                                          )
                                        }
                                        className="p-0.5 rounded hover:bg-white/10"
                                      >
                                        {copiedField === "amount" ? (
                                          <Check className="w-3.5 h-3.5 text-green-500" />
                                        ) : (
                                          <Copy
                                            className="w-3.5 h-3.5"
                                            style={{
                                              color: "rgba(255,255,255,0.3)",
                                            }}
                                          />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className="flex-1 py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2"
                                  style={{
                                    background: "rgba(255,255,255,0.12)",
                                    color: "#fff",
                                    border: "1px solid rgba(255,255,255,0.15)",
                                  }}
                                >
                                  <MessageCircle className="w-4 h-4" />
                                  Chat
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.98 }}
                                  onClick={markPaymentSent}
                                  disabled={isLoading}
                                  className="flex-[2] py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{ background: "#fff", color: "#000" }}
                                >
                                  {isLoading
                                    ? "Processing..."
                                    : "I've sent the payment"}
                                </motion.button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                    {/* Sell order step 2 - merchant accepted with wallet signature, now user locks escrow */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "accepted" &&
                      !activeOrder.escrowTxHash && (
                        <div className="mt-3 space-y-3">
                          <div
                            className="rounded-xl p-4"
                            style={{
                              background: "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}
                          >
                            <div className="flex items-center gap-3 mb-3">
                              <div
                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                style={{ background: "rgba(255,255,255,0.1)" }}
                              >
                                <Lock
                                  className="w-5 h-5"
                                  style={{ color: "#fff" }}
                                />
                              </div>
                              <div>
                                <p
                                  className="text-[15px] font-medium"
                                  style={{ color: "#fff" }}
                                >
                                  Merchant Accepted - Lock Escrow
                                </p>
                                <p
                                  className="text-[12px]"
                                  style={{ color: "rgba(255,255,255,0.45)" }}
                                >
                                  Merchant verified their wallet. Lock funds to
                                  proceed.
                                </p>
                              </div>
                            </div>
                            <p
                              className="text-[12px] mb-3"
                              style={{ color: "rgba(255,255,255,0.4)" }}
                            >
                              The merchant has signed with their wallet (
                              {activeOrder.acceptorWalletAddress?.slice(0, 4)}
                              ...{activeOrder.acceptorWalletAddress?.slice(-4)}
                              ). Lock your{" "}
                              {parseFloat(activeOrder.cryptoAmount).toFixed(2)}{" "}
                              USDT to the escrow. Funds will be released to this
                              wallet when you confirm payment received.
                            </p>
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              onClick={async () => {
                                if (!solanaWallet.connected) {
                                  setShowWalletModal(true);
                                  return;
                                }
                                if (!solanaWallet.programReady) {
                                  showAlert(
                                    "Wallet Error",
                                    "Wallet not ready. Please reconnect your wallet.",
                                    "error",
                                  );
                                  return;
                                }
                                setIsLoading(true);
                                try {
                                  const merchantWallet =
                                    activeOrder.acceptorWalletAddress ||
                                    activeOrder.merchant.walletAddress;
                                  if (
                                    !merchantWallet ||
                                    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(
                                      merchantWallet,
                                    )
                                  ) {
                                    showAlert(
                                      "Wallet Error",
                                      "Merchant wallet not available. Please wait for merchant to accept the order with their wallet.",
                                      "warning",
                                    );
                                    setIsLoading(false);
                                    return;
                                  }
                                  const escrowResult =
                                    await solanaWallet.depositToEscrow({
                                      amount: parseFloat(
                                        activeOrder.cryptoAmount,
                                      ),
                                      merchantWallet,
                                    });
                                  if (escrowResult.success) {
                                    await fetchWithAuth(
                                      `/api/orders/${activeOrder.id}/escrow`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          tx_hash: escrowResult.txHash,
                                          actor_type: "user",
                                          actor_id: userId,
                                          escrow_address:
                                            solanaWallet.walletAddress,
                                          escrow_trade_id: escrowResult.tradeId,
                                          escrow_trade_pda:
                                            escrowResult.tradePda,
                                          escrow_pda: escrowResult.escrowPda,
                                          escrow_creator_wallet:
                                            solanaWallet.walletAddress,
                                        }),
                                      },
                                    );
                                    setOrders((prev) =>
                                      prev.map((o) =>
                                        o.id === activeOrder.id
                                          ? {
                                              ...o,
                                              dbStatus: "escrowed",
                                              escrowTxHash: escrowResult.txHash,
                                            }
                                          : o,
                                      ),
                                    );
                                    playSound("trade_complete");
                                  }
                                } catch (err: any) {
                                  console.error("Escrow failed:", err);
                                  showAlert(
                                    "Escrow Failed",
                                    err?.message ||
                                      "Failed to lock escrow. Please try again.",
                                    "error",
                                  );
                                  playSound("error");
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              disabled={
                                isLoading ||
                                (solanaWallet.connected &&
                                  !solanaWallet.programReady)
                              }
                              className="w-full py-3 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                              style={{ background: "#fff", color: "#000" }}
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
                                "Wallet Not Ready"
                              ) : (
                                <>
                                  <Lock className="w-5 h-5" />
                                  Lock{" "}
                                  {parseFloat(activeOrder.cryptoAmount).toFixed(
                                    2,
                                  )}{" "}
                                  USDT to Escrow
                                </>
                              )}
                            </motion.button>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="w-full py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2"
                            style={{
                              background: "rgba(255,255,255,0.12)",
                              color: "#fff",
                              border: "1px solid rgba(255,255,255,0.15)",
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Merchant
                          </button>
                        </div>
                      )}

                    {/* Sell order step 2 - escrow IS locked, waiting for payment */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "sell" &&
                      (activeOrder.dbStatus === "escrowed" ||
                        activeOrder.escrowTxHash) && (
                        <div className="mt-2">
                          <p
                            className="text-[13px]"
                            style={{ color: "rgba(255,255,255,0.45)" }}
                          >
                            Your USDT is locked in escrow. Waiting for merchant
                            to send AED payment...
                          </p>

                          <div
                            className="mt-3 rounded-xl p-3"
                            style={{ background: "#1e1e1e" }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span
                                className="text-[12px]"
                                style={{ color: "rgba(255,255,255,0.45)" }}
                              >
                                Expected payment
                              </span>
                              <span
                                className="text-[15px] font-semibold"
                                style={{ color: "#fff" }}
                              >
                                {"\u062F.\u0625"}{" "}
                                {parseFloat(
                                  activeOrder.fiatAmount,
                                ).toLocaleString()}
                              </span>
                            </div>
                            {activeOrder.lockedPaymentMethod ? (
                              <div
                                className="pt-2 space-y-1.5"
                                style={{
                                  borderTop: "1px solid rgba(255,255,255,0.1)",
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Lock className="w-3 h-3 text-orange-400" />
                                  <span className="text-[11px] text-orange-400 font-semibold uppercase tracking-wide">
                                    Locked Payment Method
                                  </span>
                                </div>
                                <p
                                  className="text-[13px] font-medium"
                                  style={{ color: "#fff" }}
                                >
                                  {activeOrder.lockedPaymentMethod.label}
                                </p>
                                {activeOrder.lockedPaymentMethod.type ===
                                  "bank" && (
                                  <div className="space-y-1 text-[12px]">
                                    {activeOrder.lockedPaymentMethod.details
                                      .bank_name && (
                                      <p
                                        style={{
                                          color: "rgba(255,255,255,0.5)",
                                        }}
                                      >
                                        {
                                          activeOrder.lockedPaymentMethod
                                            .details.bank_name
                                        }
                                      </p>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .iban && (
                                      <p
                                        className="font-mono"
                                        style={{
                                          color: "rgba(255,255,255,0.5)",
                                        }}
                                      >
                                        {
                                          activeOrder.lockedPaymentMethod
                                            .details.iban
                                        }
                                      </p>
                                    )}
                                  </div>
                                )}
                                {activeOrder.lockedPaymentMethod.type ===
                                  "upi" &&
                                  activeOrder.lockedPaymentMethod.details
                                    .upi_id && (
                                    <p
                                      className="text-[12px] font-mono"
                                      style={{ color: "rgba(255,255,255,0.5)" }}
                                    >
                                      {
                                        activeOrder.lockedPaymentMethod.details
                                          .upi_id
                                      }
                                    </p>
                                  )}
                                <p
                                  className="text-[10px]"
                                  style={{ color: "rgba(255,255,255,0.35)" }}
                                >
                                  Merchant will send payment to this method
                                </p>
                              </div>
                            ) : (
                              <p
                                className="text-[11px]"
                                style={{ color: "rgba(255,255,255,0.35)" }}
                              >
                                Merchant will send this amount to your bank
                                account
                              </p>
                            )}
                          </div>

                          <div
                            className="mt-3 h-1 rounded-full overflow-hidden"
                            style={{ background: "rgba(255,255,255,0.1)" }}
                          >
                            <motion.div
                              className="h-full bg-orange-400"
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                              style={{ width: "30%" }}
                            />
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2"
                            style={{
                              background: "rgba(255,255,255,0.12)",
                              color: "#fff",
                              border: "1px solid rgba(255,255,255,0.15)",
                            }}
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
              <div
                className="p-4 rounded-2xl"
                style={
                  activeOrder.step >= 3
                    ? {
                        background: "#111111",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }
                    : {
                        background: "rgba(0,0,0,0.04)",
                        border: "1px solid rgba(0,0,0,0.08)",
                      }
                }
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
                    style={
                      activeOrder.step >= 3
                        ? { background: "#fff", color: "#000" }
                        : {
                            background: "rgba(0,0,0,0.06)",
                            color: "rgba(0,0,0,0.3)",
                          }
                    }
                  >
                    {activeOrder.step > 3 ? <Check className="w-4 h-4" /> : "3"}
                  </div>
                  <div className="flex-1">
                    <p
                      className="text-[15px] font-medium"
                      style={{
                        color:
                          activeOrder.step >= 3 ? "#fff" : "rgba(0,0,0,0.3)",
                      }}
                    >
                      {activeOrder.dbStatus === "disputed"
                        ? "Dispute"
                        : activeOrder.type === "buy"
                          ? "Confirming payment"
                          : "Confirm received"}
                    </p>

                    {activeOrder.step === 3 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus === "disputed" && (
                        <div className="mt-2">
                          <p
                            className="text-[13px]"
                            style={{ color: "rgba(255,255,255,0.45)" }}
                          >
                            This order is under dispute. Our team is reviewing
                            the case.
                          </p>
                          <button
                            onClick={handleOpenChat}
                            className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2"
                            style={{
                              background: "rgba(255,255,255,0.12)",
                              color: "#fff",
                              border: "1px solid rgba(255,255,255,0.15)",
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Seller
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus !== "disputed" && (
                        <div className="mt-2">
                          <p
                            className="text-[13px]"
                            style={{ color: "rgba(255,255,255,0.45)" }}
                          >
                            Seller is verifying your payment...
                          </p>
                          <div
                            className="mt-2 h-1 rounded-full overflow-hidden"
                            style={{ background: "rgba(255,255,255,0.1)" }}
                          >
                            <motion.div
                              className="h-full"
                              style={{
                                background: "rgba(255,255,255,0.3)",
                                width: "30%",
                              }}
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                            />
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2"
                            style={{
                              background: "rgba(255,255,255,0.12)",
                              color: "#fff",
                              border: "1px solid rgba(255,255,255,0.15)",
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Seller
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "disputed" && (
                        <div className="mt-2">
                          <p
                            className="text-[13px]"
                            style={{ color: "rgba(255,255,255,0.45)" }}
                          >
                            This order is under dispute. Our team is reviewing
                            the case.
                          </p>
                          <button
                            onClick={handleOpenChat}
                            className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2"
                            style={{
                              background: "rgba(255,255,255,0.12)",
                              color: "#fff",
                              border: "1px solid rgba(255,255,255,0.15)",
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                            Message Merchant
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus !== "disputed" && (
                        <div className="mt-3">
                          <div
                            className="rounded-xl p-3 mb-3"
                            style={{
                              background: "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}
                          >
                            <p
                              className="text-[13px]"
                              style={{ color: "rgba(255,255,255,0.7)" }}
                            >
                              Merchant has sent {"\u062F.\u0625"}{" "}
                              {parseFloat(
                                activeOrder.fiatAmount,
                              ).toLocaleString()}{" "}
                              to your bank.
                            </p>
                            <p
                              className="text-[12px] mt-1"
                              style={{ color: "rgba(255,255,255,0.45)" }}
                            >
                              Check your bank account before confirming.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleOpenChat}
                              className="flex-1 py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2"
                              style={{
                                background: "rgba(255,255,255,0.12)",
                                color: "#fff",
                                border: "1px solid rgba(255,255,255,0.15)",
                              }}
                            >
                              <MessageCircle className="w-4 h-4" />
                              Chat
                            </button>
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              onClick={confirmFiatReceived}
                              disabled={isLoading}
                              className="flex-[2] py-3 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                              style={{ background: "#fff", color: "#000" }}
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
                          <p
                            className="text-[11px] mt-2 text-center"
                            style={{ color: "rgba(255,255,255,0.35)" }}
                          >
                            This will sign a wallet transaction to release
                            escrow to merchant
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div
                className="p-4 rounded-2xl"
                style={activeOrder.step >= 4
                  ? { background: "#111111", border: "1px solid rgba(255,255,255,0.08)" }
                  : { background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.08)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold"
                    style={activeOrder.step >= 4
                      ? { background: "#fff", color: "#000" }
                      : { background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.3)" }}
                  >
                    {activeOrder.step >= 4 ? <Check className="w-4 h-4" /> : "4"}
                  </div>
                  <div>
                    <p
                      className="text-[15px] font-medium"
                      style={{ color: activeOrder.step >= 4 ? "#fff" : "rgba(0,0,0,0.3)" }}
                    >
                      Complete
                    </p>
                    {activeOrder.status === "complete" &&
                      activeOrder.step >= 4 && (
                        <p
                          className="text-[13px]"
                          style={{ color: "rgba(255,255,255,0.6)" }}
                        >
                          Trade completed successfully
                        </p>
                      )}
                  </div>
                </div>
              </div>

              {/* Rating - only for completed orders */}
              {activeOrder.status === "complete" && activeOrder.step >= 4 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl p-4 text-center"
                  style={{
                    background: "#111111",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <p
                    className="text-[15px] mb-3"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    Rate your experience
                  </p>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} onClick={() => setRating(star)}>
                        <Star
                          className={`w-8 h-8 ${star <= rating ? "fill-amber-400 text-amber-400" : ""}`}
                          style={{
                            color:
                              star <= rating
                                ? undefined
                                : "rgba(255,255,255,0.15)",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          )}

        {/* Merchant */}
        <div
          className="mt-4 rounded-2xl p-4"
          style={{
            background: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-semibold"
                style={{ background: "#fff", color: "#000" }}
              >
                {activeOrder.merchant.name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p
                    className="text-[15px] font-medium"
                    style={{ color: "#fff" }}
                  >
                    {activeOrder.merchant.name}
                  </p>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    {activeOrder.merchant.paymentMethod === "cash"
                      ? "Cash"
                      : "Bank"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    {activeOrder.merchant.rating} {"\u00b7"}{" "}
                    {activeOrder.merchant.trades} trades
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={handleOpenChat}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <MessageCircle
                className="w-5 h-5"
                style={{ color: "rgba(255,255,255,0.45)" }}
              />
            </button>
          </div>
        </div>

        {/* Cancel & Dispute Buttons - Show for active orders (step 2-3) */}
        {activeOrder.step >= 2 &&
          activeOrder.step < 4 &&
          activeOrder.status !== "disputed" &&
          !activeOrder.cancelRequest && (
            <button
              onClick={() => requestCancelOrder()}
              disabled={isRequestingCancel}
              className="w-full mt-3 py-3 rounded-2xl text-[14px] font-medium bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isRequestingCancel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
              Request Cancellation
            </button>
          )}
        {activeOrder.step >= 2 &&
          activeOrder.step < 4 &&
          activeOrder.status !== "disputed" && (
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
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-[14px] font-medium">
                Dispute in Progress
              </span>
            </div>
            <p className="text-[12px] text-red-500/70 mt-1">
              Our team is reviewing this case.
            </p>
          </div>
        )}

        {(activeOrder.step >= 4 ||
          activeOrder.status === "cancelled" ||
          activeOrder.status === "expired") && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setScreen(previousScreen || "home")}
            className="w-full mt-4 py-4 rounded-2xl text-[17px] font-semibold"
            style={{
              background: "#111111",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff",
            }}
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
              className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} rounded-t-3xl p-6`}
              style={{ background: "#111111" }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h3
                    className="text-[17px] font-semibold"
                    style={{ color: "#fff" }}
                  >
                    Report Issue
                  </h3>
                </div>
                <button onClick={() => setShowDisputeModal(false)}>
                  <X
                    className="w-5 h-5"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  />
                </button>
              </div>

              <p
                className="text-[13px] mb-4"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                If you&apos;re having a problem with this trade, let us know and
                our support team will help resolve it.
              </p>

              <div className="mb-4">
                <label
                  className="text-[12px] uppercase tracking-wide mb-2 block"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  Reason
                </label>
                <select
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-[15px] outline-none appearance-none"
                  style={{
                    background: "#1e1e1e",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <option value="">Select a reason...</option>
                  <option value="payment_not_received">
                    Payment not received
                  </option>
                  <option value="crypto_not_received">
                    Crypto not received
                  </option>
                  <option value="wrong_amount">Wrong amount sent</option>
                  <option value="fraud">Suspected fraud</option>
                  <option value="other">Other issue</option>
                </select>
              </div>

              <div className="mb-6">
                <label
                  className="text-[12px] uppercase tracking-wide mb-2 block"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  Description
                </label>
                <textarea
                  value={disputeDescription}
                  onChange={(e) => setDisputeDescription(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  rows={3}
                  className="w-full rounded-xl px-4 py-3 text-[15px] outline-none resize-none"
                  style={{
                    background: "#1e1e1e",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDisputeModal(false)}
                  className="flex-1 py-3 rounded-xl text-[15px] font-medium"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.6)",
                  }}
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
              className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} rounded-t-3xl h-[70vh] flex flex-col`}
              style={{ background: "#111111" }}
            >
              <div
                className="flex items-center justify-between p-4"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full"
                    style={{ background: "#fff" }}
                  />
                  <div>
                    <p
                      className="text-[15px] font-medium"
                      style={{ color: "#fff" }}
                    >
                      {activeOrder.merchant.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <ConnectionIndicator isConnected={true} />
                      <p className="text-[11px] text-orange-500">Online</p>
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowChat(false)} className="p-2">
                  <X
                    className="w-5 h-5"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  />
                </button>
              </div>
              <div
                ref={chatMessagesRef}
                className="flex-1 overflow-y-auto p-4 space-y-3"
              >
                {activeChat && activeChat.messages.length > 0 ? (
                  activeChat.messages.map((msg) => {
                    // Parse dispute/resolution messages from JSON content
                    if (msg.messageType === "dispute") {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div className="w-full max-w-[90%] bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4 text-red-400" />
                                <span className="text-[13px] font-semibold text-red-400">
                                  Dispute Opened
                                </span>
                              </div>
                              <p
                                className="text-[14px] mb-1"
                                style={{ color: "#fff" }}
                              >
                                <span
                                  style={{ color: "rgba(255,255,255,0.4)" }}
                                >
                                  Reason:
                                </span>{" "}
                                {data.reason?.replace(/_/g, " ")}
                              </p>
                              {data.description && (
                                <p
                                  className="text-[13px]"
                                  style={{ color: "rgba(255,255,255,0.5)" }}
                                >
                                  {data.description}
                                </p>
                              )}
                              <p
                                className="text-[11px] mt-2"
                                style={{ color: "rgba(255,255,255,0.4)" }}
                              >
                                Our support team will review this case
                              </p>
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message if parsing fails
                      }
                    }

                    if (msg.messageType === "resolution") {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className="w-full max-w-[90%] rounded-2xl p-4"
                              style={{
                                background: "rgba(255,255,255,0.08)",
                                border: "1px solid rgba(255,255,255,0.12)",
                              }}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Shield
                                  className="w-4 h-4"
                                  style={{ color: "rgba(255,255,255,0.5)" }}
                                />
                                <span
                                  className="text-[13px] font-semibold"
                                  style={{ color: "rgba(255,255,255,0.6)" }}
                                >
                                  {data.type === "resolution_proposed"
                                    ? "Resolution Proposed"
                                    : "Resolution Finalized"}
                                </span>
                              </div>
                              <p
                                className="text-[14px] mb-1"
                                style={{ color: "#fff" }}
                              >
                                <span
                                  style={{ color: "rgba(255,255,255,0.4)" }}
                                >
                                  Decision:
                                </span>{" "}
                                {data.resolution?.replace(/_/g, " ")}
                              </p>
                              {data.notes && (
                                <p
                                  className="text-[13px] mb-2"
                                  style={{ color: "rgba(255,255,255,0.5)" }}
                                >
                                  {data.notes}
                                </p>
                              )}
                              {data.type === "resolution_proposed" &&
                                !disputeInfo?.user_confirmed && (
                                  <div className="flex gap-2 mt-3">
                                    <button
                                      onClick={() =>
                                        respondToResolution("reject")
                                      }
                                      disabled={isRespondingToResolution}
                                      className="flex-1 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50"
                                      style={{
                                        background: "rgba(255,255,255,0.08)",
                                        color: "rgba(255,255,255,0.6)",
                                      }}
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() =>
                                        respondToResolution("accept")
                                      }
                                      disabled={isRespondingToResolution}
                                      className="flex-1 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-50"
                                      style={{
                                        background: "#fff",
                                        color: "#000",
                                      }}
                                    >
                                      Accept
                                    </button>
                                  </div>
                                )}
                              {disputeInfo?.user_confirmed &&
                                !disputeInfo?.merchant_confirmed && (
                                  <p
                                    className="text-[11px] mt-2"
                                    style={{ color: "rgba(255,255,255,0.5)" }}
                                  >
                                    You accepted. Waiting for merchant
                                    confirmation...
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
                    if (msg.messageType === "resolution_finalized") {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className="w-full max-w-[90%] rounded-2xl p-4"
                              style={{
                                background: "rgba(255,255,255,0.08)",
                                border: "1px solid rgba(255,255,255,0.12)",
                              }}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Check
                                  className="w-4 h-4"
                                  style={{ color: "#fff" }}
                                />
                                <span
                                  className="text-[13px] font-semibold"
                                  style={{ color: "#fff" }}
                                >
                                  Resolution Finalized
                                </span>
                              </div>
                              <p
                                className="text-[14px]"
                                style={{ color: "#fff" }}
                              >
                                Decision: {data.resolution?.replace(/_/g, " ")}
                              </p>
                              <p
                                className="text-[11px] mt-2"
                                style={{ color: "rgba(255,255,255,0.4)" }}
                              >
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
                    if (
                      msg.messageType === "resolution_accepted" ||
                      msg.messageType === "resolution_rejected"
                    ) {
                      try {
                        const data = JSON.parse(msg.text);
                        const isAccepted = data.type === "resolution_accepted";
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className={`px-4 py-2 rounded-2xl text-[13px] ${
                                isAccepted ? "" : "bg-red-500/10 text-red-500"
                              }`}
                              style={
                                isAccepted
                                  ? {
                                      background: "rgba(255,255,255,0.08)",
                                      color: "rgba(255,255,255,0.6)",
                                    }
                                  : {}
                              }
                            >
                              {data.party === "user" ? "You" : "Merchant"}{" "}
                              {isAccepted ? "accepted" : "rejected"} the
                              resolution
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message
                      }
                    }

                    // Receipt card messages — structured (new) or JSON fallback (old)
                    {
                      let receiptPayload: Record<string, unknown> | null = null;
                      if (msg.messageType === "receipt" && msg.receiptData) {
                        receiptPayload = msg.receiptData;
                      } else {
                        try {
                          if (msg.text.startsWith("{")) {
                            const parsed = JSON.parse(msg.text);
                            if (
                              parsed.type === "order_receipt" &&
                              parsed.data
                            ) {
                              receiptPayload = parsed.data;
                            }
                          }
                        } catch {
                          /* not JSON */
                        }
                      }
                      if (receiptPayload) {
                        return (
                          <div key={msg.id} className="max-w-[90%] mx-auto">
                            <ReceiptCard
                              data={receiptPayload as any}
                              currentStatus={
                                activeOrder?.dbStatus || activeOrder?.status
                              }
                              variant="light"
                            />
                            <p
                              className="text-[10px] mt-1 text-center"
                              style={{ color: "rgba(255,255,255,0.4)" }}
                            >
                              {msg.timestamp.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        );
                      }
                    }

                    // Regular messages
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${msg.from === "me" ? "justify-end" : msg.from === "system" ? "justify-center" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] flex flex-col ${msg.from === "me" ? "items-end" : "items-start"}`}
                        >
                          {msg.from !== "me" &&
                            msg.from !== "system" &&
                            msg.senderName && (
                              <span
                                className="text-[11px] mb-0.5 px-1"
                                style={{ color: "rgba(255,255,255,0.4)" }}
                              >
                                {msg.senderName}
                              </span>
                            )}
                          <div
                            className={`px-4 py-2 rounded-2xl text-[15px]`}
                            style={
                              msg.from === "me"
                                ? { background: "#fff", color: "#000" }
                                : msg.from === "system"
                                  ? {
                                      background: "rgba(255,255,255,0.08)",
                                      color: "rgba(255,255,255,0.5)",
                                      fontSize: 13,
                                    }
                                  : { background: "#222222", color: "#fff" }
                            }
                          >
                            {msg.messageType === "image" && msg.imageUrl && (
                              <a
                                href={msg.imageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <img
                                  src={msg.imageUrl}
                                  alt="Shared image"
                                  className="max-w-full max-h-48 rounded-xl mb-1 object-contain"
                                  loading="lazy"
                                />
                              </a>
                            )}
                            {msg.text !== "Photo" && <span>{msg.text}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex-1 flex items-center justify-center h-full">
                    <p
                      className="text-[15px]"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      No messages yet
                    </p>
                  </div>
                )}

                {/* Show pending resolution if dispute exists and has a proposal */}
                {disputeInfo?.status === "pending_confirmation" &&
                  disputeInfo.proposed_resolution &&
                  !activeChat?.messages.some(
                    (m) => m.messageType === "resolution",
                  ) && (
                    <div className="flex justify-center">
                      <div className="w-full max-w-[90%] bg-white/5 border border-white/6 rounded-2xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Shield
                            className="w-4 h-4"
                            style={{ color: "rgba(255,255,255,0.5)" }}
                          />
                          <span
                            className="text-[13px] font-semibold"
                            style={{ color: "rgba(255,255,255,0.6)" }}
                          >
                            Resolution Proposed
                          </span>
                        </div>
                        <p
                          className="text-[14px] mb-1"
                          style={{ color: "#fff" }}
                        >
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>
                            Decision:
                          </span>{" "}
                          {disputeInfo.proposed_resolution.replace(/_/g, " ")}
                        </p>
                        {disputeInfo.resolution_notes && (
                          <p
                            className="text-[13px] mb-2"
                            style={{ color: "rgba(255,255,255,0.5)" }}
                          >
                            {disputeInfo.resolution_notes}
                          </p>
                        )}
                        {!disputeInfo.user_confirmed && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => respondToResolution("reject")}
                              disabled={isRespondingToResolution}
                              className="flex-1 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50"
                              style={{
                                background: "rgba(255,255,255,0.08)",
                                color: "rgba(255,255,255,0.6)",
                              }}
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => respondToResolution("accept")}
                              disabled={isRespondingToResolution}
                              className="flex-1 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-50"
                              style={{ background: "#fff", color: "#000" }}
                            >
                              Accept
                            </button>
                          </div>
                        )}
                        {disputeInfo.user_confirmed &&
                          !disputeInfo.merchant_confirmed && (
                            <p
                              className="text-[11px] mt-2"
                              style={{ color: "rgba(255,255,255,0.5)" }}
                            >
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
                      <div
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: "rgba(255,255,255,0.3)",
                          animationDelay: "0ms",
                        }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: "rgba(255,255,255,0.3)",
                          animationDelay: "150ms",
                        }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: "rgba(255,255,255,0.3)",
                          animationDelay: "300ms",
                        }}
                      />
                    </div>
                    <span
                      className="text-[11px]"
                      style={{ color: "rgba(255,255,255,0.4)" }}
                    >
                      {activeOrder.merchant.name} is typing...
                    </span>
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
                <div
                  className="px-4 py-2 flex items-center gap-3"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <div className="relative">
                    <img
                      src={pendingImage.previewUrl}
                      alt="Preview"
                      className="w-16 h-16 rounded-xl object-cover"
                      style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    <button
                      onClick={clearPendingImage}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.3)" }}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                  <span
                    className="text-[13px] flex-1"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                  >
                    Image ready to send
                  </span>
                </div>
              )}

              <div
                className="p-4 pb-8"
                style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
              >
                <div className="flex items-center gap-2">
                  {/* Emoji button */}
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "#1e1e1e" }}
                  >
                    <span className="text-lg">😊</span>
                  </button>
                  {/* Image attach button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50"
                    style={{ background: "#1e1e1e" }}
                  >
                    {isUploading ? (
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      />
                    ) : (
                      <ArrowUpRight
                        className="w-4 h-4"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      />
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
                    placeholder={
                      pendingImage ? "Add a caption..." : "Message..."
                    }
                    className="flex-1 rounded-xl px-4 py-3 text-[15px] outline-none"
                    style={{ background: "#1e1e1e", color: "#fff" }}
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
                      pendingImage ? "bg-orange-500" : "bg-white"
                    } disabled:opacity-50`}
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 text-black animate-spin" />
                    ) : (
                      <ChevronRight
                        className={`w-5 h-5 ${pendingImage ? "text-white" : "text-black"}`}
                      />
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
