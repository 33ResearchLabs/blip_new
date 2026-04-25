"use client";

/**
 * ChatRoom Component
 *
 * Full-featured chat room with:
 * - Multi-party messaging (buyer, seller, compliance)
 * - File & image uploads with preview
 * - Typing indicators
 * - Online/offline presence
 * - Message status (sent/delivered/seen)
 * - Compliance controls (highlight, freeze)
 * - Role-based message colors
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import {
  Send,
  Paperclip,
  X,
  Loader2,
  Check,
  CheckCheck,
  Shield,
  Store,
  Bot,
  Download,
  ExternalLink,
  FileText,
  File as FileIcon,
  Image as ImageIcon,
  Star,
  Lock,
  Unlock,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
import { ImageMessageBubble, type ImageUploadStatus } from "@/components/chat/ImageMessageBubble";
import { compressImage } from "@/lib/utils/compressImage";
import type { ChatMessage, PresenceMember } from "@/hooks/useRealtimeChat";
import { usePusherOptional } from "@/context/PusherContext";
import { CHAT_EVENTS } from "@/lib/pusher/events";
import { getOrderChannel } from "@/lib/pusher/channels";

// ============================================
// Types
// ============================================

interface ChatRoomProps {
  orderId: string;
  messages: ChatMessage[];
  currentUserType: "user" | "merchant" | "compliance";
  currentUserId?: string;
  onSendMessage: (
    text: string,
    imageUrl?: string,
    fileData?: {
      fileUrl: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    },
  ) => void;
  onTyping?: (isTyping: boolean) => void;
  onMarkRead?: () => void;
  onHighlightMessage?: (messageId: string, highlighted: boolean) => void;
  onFreezeChat?: (frozen: boolean) => void;
  isTyping?: boolean;
  typingActorType?: string;
  typingActorName?: string;
  presence?: PresenceMember[];
  isFrozen?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  // Optional names for participants
  userName?: string;
  merchantName?: string;
  complianceName?: string;
  // When opened from a specific order context, used to highlight that order's section.
  focusOrderId?: string;
  // Infinite-scroll pagination: load older messages when the user scrolls to the top.
  onLoadOlder?: () => Promise<boolean | void>;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  // Backend-controlled chat availability. When chatEnabled=false, the input
  // is replaced with a status banner showing chatReason.
  chatEnabled?: boolean;
  chatReason?: string | null;
}

// ============================================
// Utility functions
// ============================================

const ROLE_COLORS = {
  user: {
    bg: "bg-blue-500/20",
    border: "border-blue-500/30",
    text: "text-blue-400",
    name: "text-blue-400",
  },
  merchant: {
    bg: "bg-primary/20",
    border: "border-primary/30",
    text: "text-primary",
    name: "text-primary",
  },
  compliance: {
    bg: "bg-red-500/20",
    border: "border-red-500/30",
    text: "text-red-400",
    name: "text-red-400",
  },
  system: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-400",
    name: "text-amber-400",
  },
};

function getUserEmoji(name: string): string {
  const emojis = [
    "🦊",
    "🐻",
    "🐼",
    "🐨",
    "🦁",
    "🐯",
    "🐸",
    "🐙",
    "🦋",
    "🐳",
    "🦄",
    "🐲",
  ];
  const hash = name.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getRoleName(senderType?: string): string {
  switch (senderType) {
    case "user":
      return "Buyer";
    case "merchant":
      return "Seller";
    case "compliance":
      return "Compliance";
    default:
      return "System";
  }
}

// ============================================
// Sub-components
// ============================================

function SenderAvatar({
  senderType,
  senderName,
}: {
  senderType?: string;
  senderName?: string;
}) {
  switch (senderType) {
    case "merchant":
      return (
        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Store className="w-3.5 h-3.5 text-primary" />
        </div>
      );
    case "compliance":
      return (
        <div className="w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
          <Shield className="w-3.5 h-3.5 text-red-400" />
        </div>
      );
    case "system":
      return (
        <div className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Bot className="w-3.5 h-3.5 text-amber-400" />
        </div>
      );
    default:
      return (
        <div className="w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
          <span className="text-xs">{getUserEmoji(senderName || "User")}</span>
        </div>
      );
  }
}

function MessageStatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "sending":
      return <Loader2 className="w-3 h-3 text-gray-500 animate-spin" />;
    case "sent":
      return <Check className="w-3 h-3 text-gray-500" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3 text-gray-500" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-blue-400" />;
    default:
      return null;
  }
}

function OnlineBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0a] ${
        isOnline ? "bg-emerald-500" : "bg-gray-600"
      }`}
    />
  );
}

function ImagePreview({
  imageUrl,
  caption,
}: {
  imageUrl: string;
  caption?: string;
}) {
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `image-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {}
  };

  return (
    <>
      <div
        className="max-w-[220px] rounded-lg overflow-hidden cursor-pointer"
        onClick={() => setLightbox(true)}
      >
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white/5 animate-pulse" />
          )}
          <img
            src={imageUrl}
            alt="Chat image"
            className="w-full h-auto max-h-[200px] object-cover"
            onLoad={() => setLoading(false)}
          />
        </div>
        {caption && (
          <p className="px-2 py-1 text-xs text-white/80">{caption}</p>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <div className="absolute top-4 left-4 flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20"
              title="Download"
            >
              <Download className="w-5 h-5 text-white" />
            </button>
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20"
              title="Open"
            >
              <ExternalLink className="w-5 h-5 text-white" />
            </a>
          </div>
          <img
            src={imageUrl}
            alt="Full size"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function FileAttachment({
  fileName,
  fileSize,
  fileUrl,
  mimeType,
}: {
  fileName?: string | null;
  fileSize?: number | null;
  fileUrl?: string | null;
  mimeType?: string | null;
}) {
  const getIcon = () => {
    if (mimeType?.startsWith("image/"))
      return <ImageIcon className="w-4 h-4 text-blue-400" />;
    if (mimeType === "application/pdf")
      return <FileText className="w-4 h-4 text-red-400" />;
    return <FileIcon className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] rounded-lg border border-white/[0.06] max-w-[250px]">
      {getIcon()}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white/80 truncate">{fileName || "File"}</p>
        {fileSize && (
          <p className="text-[10px] text-gray-500">
            {formatFileSize(fileSize)}
          </p>
        )}
      </div>
      {fileUrl && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded hover:bg-white/10 transition-colors"
          title="Download"
        >
          <Download className="w-3.5 h-3.5 text-gray-400" />
        </a>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function ChatRoom({
  orderId,
  messages,
  currentUserType,
  currentUserId,
  onSendMessage,
  onTyping,
  onMarkRead,
  onHighlightMessage,
  onFreezeChat,
  isTyping = false,
  typingActorType,
  typingActorName,
  presence = [],
  isFrozen = false,
  isLoading = false,
  disabled = false,
  compact = false,
  userName,
  merchantName,
  complianceName,
  focusOrderId,
  onLoadOlder,
  hasOlderMessages = true,
  isLoadingOlder = false,
  chatEnabled = true,
  chatReason = null,
}: ChatRoomProps) {
  const [messageText, setMessageText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Live receipt-status override. Subscribes to chat:receipt-updated from
  // core-api/src/receipts.ts so the embedded ReceiptCard re-renders without
  // a refresh when the order's status changes. Falls through to the JSONB
  // payload's data.status if no live event has been received yet.
  const pusher = usePusherOptional();
  const [liveReceiptStatus, setLiveReceiptStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!pusher || !orderId) return;
    const channelName = getOrderChannel(orderId);
    const channel = pusher.subscribe(channelName);
    if (!channel) return;
    const handler = (rawData: unknown) => {
      const data = rawData as { status?: string };
      if (data?.status) setLiveReceiptStatus(data.status);
    };
    channel.bind(CHAT_EVENTS.RECEIPT_UPDATED, handler);
    return () => {
      try {
        channel.unbind(CHAT_EVENTS.RECEIPT_UPDATED, handler);
      } catch { /* channel may already be torn down */ }
      pusher.unsubscribe(channelName);
    };
  }, [pusher, orderId]);
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    previewUrl?: string;
    category: "image" | "document";
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── Optimistic image uploads — WhatsApp-style ──────────────────────
  interface PendingUpload {
    tempId: string;
    localUrl: string;
    caption: string;
    file: File;
    status: ImageUploadStatus;
    progress: number;
    abortController: AbortController | null;
    createdAt: number;
  }
  const [pendingUploads, setPendingUploads] = useState<Map<string, PendingUpload>>(new Map());
  const pendingUploadsRef = useRef(pendingUploads);
  pendingUploadsRef.current = pendingUploads;

  // Abort all uploads on unmount
  useEffect(() => {
    return () => {
      for (const entry of pendingUploadsRef.current.values()) {
        if (entry.abortController) entry.abortController.abort();
      }
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  // Scroll behavior (WhatsApp-style)
  //  - Initial open: jump to bottom INSTANTLY before paint
  //  - New outgoing message: always scroll to bottom
  //  - New incoming message: only scroll if user is near bottom
  //  - User scrolled up: never force scroll
  //  - Typing indicator / image load: never trigger scroll
  // ─────────────────────────────────────────────────────────
  const NEAR_BOTTOM_PX = 80;
  const isAtBottomRef = useRef(true);
  const hasInitialScrolledRef = useRef(false);
  const prevMessagesLengthRef = useRef(0);
  const prevLastMessageIdRef = useRef<string | undefined>(undefined);
  const lastMessage = messages[messages.length - 1];

  const jumpToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Track whether the user is sitting at the bottom of the list.
  // Also triggers loading older messages when scrolled near the top.
  const loadOlderTriggeredRef = useRef(false);
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distance <= NEAR_BOTTOM_PX;

    // Trigger loading older messages when scrolled near the top (within 100px)
    if (
      el.scrollTop < 100 &&
      onLoadOlder &&
      hasOlderMessages &&
      !isLoadingOlder &&
      !loadOlderTriggeredRef.current
    ) {
      loadOlderTriggeredRef.current = true;
      const prevScrollHeight = el.scrollHeight;
      onLoadOlder().finally(() => {
        // Preserve scroll position: after older messages are prepended,
        // the scroll container grows upward. Adjust scrollTop by the
        // height difference so the user stays at the same visual position.
        requestAnimationFrame(() => {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop += newScrollHeight - prevScrollHeight;
          loadOlderTriggeredRef.current = false;
        });
      });
    }
  }, [onLoadOlder, hasOlderMessages, isLoadingOlder]);

  // Initial render: instant jump to bottom before paint (no animation, no flash).
  useLayoutEffect(() => {
    if (hasInitialScrolledRef.current) return;
    if (messages.length === 0) return;
    jumpToBottom();
    hasInitialScrolledRef.current = true;
    prevMessagesLengthRef.current = messages.length;
    prevLastMessageIdRef.current = lastMessage?.id;
  }, [messages.length, lastMessage?.id, jumpToBottom]);

  // Subsequent message arrivals.
  useLayoutEffect(() => {
    if (!hasInitialScrolledRef.current) return;
    const prevLen = prevMessagesLengthRef.current;
    const prevLastId = prevLastMessageIdRef.current;
    const curLen = messages.length;
    const curLastId = lastMessage?.id;

    // No actual change → don't touch scroll (prevents typing/render jitters).
    if (curLen === prevLen && curLastId === prevLastId) return;

    if (curLen > prevLen && curLastId !== prevLastId) {
      // Message appended at the end.
      const isOwn = lastMessage?.from === "me";
      if (isOwn || isAtBottomRef.current) {
        jumpToBottom();
      }
      // else: user is reading older messages → leave scroll alone.
    } else if (curLen > prevLen && curLastId === prevLastId) {
      // Older messages prepended (pagination): preserve visual position.
      // The browser keeps scrollTop, so the existing content stays anchored.
      // No-op.
    }

    prevMessagesLengthRef.current = curLen;
    prevLastMessageIdRef.current = curLastId;
  }, [messages.length, lastMessage?.id, lastMessage?.from, jumpToBottom]);

  // If the consumer remounts ChatRoom for a different chat, reset.
  useEffect(() => {
    hasInitialScrolledRef.current = false;
    prevMessagesLengthRef.current = 0;
    prevLastMessageIdRef.current = undefined;
    isAtBottomRef.current = true;
  }, [orderId]);

  // Mark as read when new messages arrive (stable ref to avoid re-render loops)
  const onMarkReadRef = useRef(onMarkRead);
  onMarkReadRef.current = onMarkRead;
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (
      messages.length > 0 &&
      messages.length !== prevMessageCountRef.current
    ) {
      prevMessageCountRef.current = messages.length;
      onMarkReadRef.current?.();
    }
  }, [messages.length]);

  // Typing indicator debounce
  const handleTypingChange = useCallback(
    (value: string) => {
      setMessageText(value);
      if (value.trim() && onTyping) {
        onTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000);
      }
    },
    [onTyping],
  );

  // File selection
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate size
      if (file.size > 10 * 1024 * 1024) {
        alert("File must be smaller than 10MB");
        return;
      }

      // Validate type
      const validTypes = [
        "image/",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      const isValid = validTypes.some(
        (type) => file.type.startsWith(type) || file.type === type,
      );
      if (!isValid) {
        alert("Please select an image, PDF, or Word document");
        return;
      }

      const category: "image" | "document" = file.type.startsWith("image/")
        ? "image"
        : "document";
      let previewUrl: string | undefined;

      if (category === "image") {
        previewUrl = URL.createObjectURL(file);
      }

      setPendingFile({ file, previewUrl, category });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const clearPendingFile = useCallback(() => {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
  }, [pendingFile]);

  /**
   * WhatsApp-style optimistic image upload:
   *  1. Close preview, insert optimistic bubble instantly
   *  2. Upload to Cloudinary with XHR progress
   *  3. On success: send real message, remove pending
   *  4. On failure: show retry
   */
  const startImageUpload = useCallback(async (
    file: File, localUrl: string, caption: string, tempId: string,
  ) => {
    const abortController = new AbortController();
    const uploadTimeout = setTimeout(() => abortController.abort(), 30_000);

    setPendingUploads(prev => {
      const next = new Map(prev);
      const existing = prev.get(tempId);
      next.set(tempId, {
        tempId, localUrl, caption, file,
        status: 'uploading', progress: 0,
        abortController,
        createdAt: existing?.createdAt ?? Date.now(),
      });
      return next;
    });

    // Auto-scroll
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    try {
      const sigRes = await fetchWithAuth("/api/upload/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
        signal: abortController.signal,
      });
      if (!sigRes.ok) throw new Error("Signature failed");
      const sigData = await sigRes.json();
      if (!sigData.success) throw new Error("Invalid signature");
      const sig = sigData.data;

      if (!sig.signature || !sig.timestamp || !sig.apiKey || !sig.cloudName || !sig.folder) {
        throw new Error("Incomplete upload credentials");
      }

      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 20 });
        return next;
      });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("signature", sig.signature);
      formData.append("timestamp", sig.timestamp.toString());
      formData.append("api_key", sig.apiKey);
      formData.append("folder", sig.folder);

      const imageUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = 20 + Math.round((e.loaded / e.total) * 70);
            setPendingUploads(prev => {
              const next = new Map(prev);
              const entry = next.get(tempId);
              if (entry) next.set(tempId, { ...entry, progress: pct });
              return next;
            });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText).secure_url);
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));

        abortController.signal.addEventListener("abort", () => xhr.abort());
        if (abortController.signal.aborted) { xhr.abort(); return; }
        xhr.send(formData);
      });

      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 95 });
        return next;
      });

      onSendMessage(caption || "Photo", imageUrl);

      clearTimeout(uploadTimeout);
      setPendingUploads(prev => { const next = new Map(prev); next.delete(tempId); return next; });
    } catch (err: any) {
      clearTimeout(uploadTimeout);
      if (err?.name === "AbortError" || abortController.signal.aborted) {
        setPendingUploads(prev => { const next = new Map(prev); next.delete(tempId); return next; });
      } else {
        console.error("[ChatRoom] Image upload error:", err);
        setPendingUploads(prev => {
          const next = new Map(prev);
          const entry = next.get(tempId);
          if (entry) next.set(tempId, { ...entry, status: 'failed', progress: 0, abortController: null });
          return next;
        });
      }
    }
  }, [orderId, onSendMessage]);

  const cancelUpload = useCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (entry?.abortController) entry.abortController.abort();
    setPendingUploads(prev => { const next = new Map(prev); next.delete(tempId); return next; });
  }, []);

  const retryUpload = useCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (!entry) return;
    startImageUpload(entry.file, entry.localUrl, entry.caption, tempId);
  }, [startImageUpload]);

  // Legacy upload for non-image files (documents) — still blocking
  const uploadAndSend = useCallback(async () => {
    if (!pendingFile) return;

    // Images use optimistic path
    if (pendingFile.category === 'image') {
      const tempId = `temp-img-${Date.now()}`;
      const file = await compressImage(pendingFile.file, { maxDimension: 1600, quality: 0.8 });
      const localUrl = pendingFile.previewUrl || URL.createObjectURL(file);
      const caption = messageText.trim();
      setPendingFile(null);
      setMessageText("");
      startImageUpload(file, localUrl, caption, tempId);
      return;
    }

    // Documents: blocking upload (no optimistic UI needed for files)
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const sigRes = await fetchWithAuth("/api/upload/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!sigRes.ok) { setIsUploading(false); return; }
      const sigData = await sigRes.json();
      if (!sigData.success) { setIsUploading(false); return; }
      const sig = sigData.data;

      const formData = new FormData();
      formData.append("file", pendingFile.file);
      formData.append("signature", sig.signature);
      formData.append("timestamp", sig.timestamp.toString());
      formData.append("api_key", sig.apiKey);
      formData.append("folder", sig.folder);

      const fileUrl: string | null = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url);
          else reject(new Error("Upload failed"));
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${sig.cloudName}/raw/upload`);
        xhr.send(formData);
      });

      if (fileUrl) {
        onSendMessage(messageText.trim() || pendingFile.file.name, undefined, {
          fileUrl, fileName: pendingFile.file.name,
          fileSize: pendingFile.file.size, mimeType: pendingFile.file.type,
        });
        setMessageText("");
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      clearPendingFile();
    }
  }, [pendingFile, orderId, messageText, onSendMessage, clearPendingFile, startImageUpload]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    };
  }, [pendingFile]);

  const handleSend = () => {
    if (pendingFile) {
      uploadAndSend();
    } else if (messageText.trim()) {
      onSendMessage(messageText.trim());
      setMessageText("");
      if (onTyping) onTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Get display name for a message
  const getDisplayName = (msg: ChatMessage): string => {
    if (msg.senderName) return msg.senderName;
    switch (msg.senderType) {
      case "user":
        return userName || "Buyer";
      case "merchant":
        return merchantName || "Seller";
      case "compliance":
        return complianceName || "Compliance Officer";
      default:
        return "System";
    }
  };

  // Get typing label
  const getTypingLabel = (): string => {
    if (typingActorName) return `${typingActorName} is typing...`;
    switch (typingActorType) {
      case "user":
        return `${userName || "Buyer"} is typing...`;
      case "merchant":
        return `${merchantName || "Seller"} is typing...`;
      case "compliance":
        return `${complianceName || "Compliance"} is typing...`;
      default:
        return "Someone is typing...";
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Presence bar removed — online/typing now shown in the chat header */}

      {/* Frozen banner */}
      {isFrozen && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs text-red-400">
            Chat frozen by compliance officer
          </span>
          {currentUserType === "compliance" && onFreezeChat && (
            <button
              onClick={() => onFreezeChat(false)}
              className="ml-auto px-2 py-0.5 text-[10px] bg-red-500/20 hover:bg-red-500/30 rounded text-red-400 transition-colors"
            >
              Unfreeze
            </button>
          )}
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
      >
        {/* Older-messages loading spinner — shown at the TOP while fetching history */}
        {isLoadingOlder && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
            <span className="ml-2 text-[11px] text-gray-500">Loading older messages…</span>
          </div>
        )}
        {!hasOlderMessages && messages.length > 0 && (
          <div className="text-center py-2">
            <span className="text-[10px] text-gray-600">Beginning of conversation</span>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
          </div>
        )}

        {messages.map((msg, idx) => {
          // Order separator: render before the first message of a new orderId run.
          // (Each message keeps its own orderId; this is purely visual grouping.)
          const prev = idx > 0 ? messages[idx - 1] : undefined;
          const showOrderSeparator =
            !!msg.orderId &&
            msg.orderId !== prev?.orderId &&
            msg.from !== "system";
          const isFocusedOrder = !!focusOrderId && msg.orderId === focusOrderId;
          // System messages
          if (msg.from === "system") {
            return (
              <div key={msg.id} className="flex justify-center my-2">
                <div className="px-3 py-1.5 bg-white/[0.03] rounded-full border border-white/[0.04]">
                  <p className="text-[11px] text-gray-500 text-center">
                    {msg.text}
                  </p>
                </div>
              </div>
            );
          }

          // Receipt messages: render centered & wider, bypassing the narrow
          // chat bubble so the card doesn't get squeezed by max-w-[75%] +
          // bubble padding + double background chrome.
          if (msg.messageType === "receipt") {
            let payload: Record<string, unknown> | null = msg.receiptData ?? null;
            if (!payload && msg.text) {
              try {
                const parsed = JSON.parse(msg.text);
                if (parsed.type === 'order_receipt' && parsed.data) payload = parsed.data;
                else payload = parsed;
              } catch {}
            }
            if (payload) {
              return (
                <div key={msg.id} className="max-w-[90%] mx-auto my-2">
                  <ReceiptCard
                    data={payload as never}
                    currentStatus={liveReceiptStatus ?? undefined}
                  />
                  <p className="text-[10px] mt-1 text-center text-gray-500">
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              );
            }
          }

          const isMe = msg.from === "me";
          const displayName = getDisplayName(msg);
          const roleColor =
            ROLE_COLORS[msg.senderType || "user"] || ROLE_COLORS.user;

          return (
            <div key={msg.id}>
              {showOrderSeparator && (
                <div
                  className="flex items-center gap-2 my-3 px-1"
                  data-order-id={msg.orderId}
                >
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      isFocusedOrder
                        ? "bg-primary/15 border-primary/30 text-primary/80"
                        : "bg-white/[0.03] border-white/[0.06] text-gray-500"
                    }`}
                  >
                    Order #{(msg.orderId || "").slice(0, 8)}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>
              )}
              <div
                className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${msg.isHighlighted ? "ring-1 ring-yellow-500/50 rounded-lg p-1 bg-yellow-500/5" : ""} ${isFocusedOrder ? "opacity-100" : focusOrderId ? "opacity-60" : ""}`}
              >
                {/* Avatar */}
                {!isMe && (
                  <SenderAvatar
                    senderType={msg.senderType}
                    senderName={displayName}
                  />
                )}

                {/* Message bubble */}
                <div
                  className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}
                >
                  {/* Sender name + role.
                      Only the compliance badge is shown — the Buyer/Seller
                      role is already obvious from the chat context, so the
                      tag is noise for trader-to-trader messages. */}
                  {!isMe && (
                    <div className="flex items-center gap-1.5 mb-0.5 px-1">
                      <span
                        className={`text-[11px] font-medium ${roleColor.name}`}
                      >
                        {displayName}
                      </span>
                      {msg.senderType === "compliance" && (
                        <span
                          className={`text-[9px] px-1 py-0.5 rounded ${roleColor.bg} ${roleColor.text}`}
                        >
                          {getRoleName(msg.senderType)}
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    className={`rounded-2xl px-3 py-2 ${
                      isMe
                        ? "bg-primary/20 border border-primary/10"
                        : msg.from === "compliance"
                          ? "bg-red-500/10 border border-red-500/10"
                          : "bg-white/[0.05] border border-white/[0.04]"
                    }`}
                  >
                    {/* Image content */}
                    {msg.messageType === "image" && msg.imageUrl && (
                      <ImagePreview
                        imageUrl={msg.imageUrl}
                        caption={msg.text !== "Photo" ? msg.text : undefined}
                      />
                    )}

                    {/* File content */}
                    {msg.messageType === "file" && (
                      <FileAttachment
                        fileName={msg.fileName}
                        fileSize={msg.fileSize}
                        fileUrl={msg.fileUrl}
                        mimeType={msg.mimeType}
                      />
                    )}

                    {/* Text content (skip if it's a pure image/file) */}
                    {msg.messageType !== "image" &&
                      msg.messageType !== "file" &&
                      msg.text && (
                        <p className="text-sm text-white/90 whitespace-pre-wrap break-words">
                          {msg.text}
                        </p>
                      )}

                    {/* Text with file (combined message) */}
                    {msg.messageType === "file" &&
                      msg.text &&
                      msg.text !== msg.fileName && (
                        <p className="text-sm text-white/90 mt-1">{msg.text}</p>
                      )}

                    {/* Timestamp + status */}
                    <div
                      className={`flex items-center gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}
                    >
                      <span className="text-[10px] text-gray-600">
                        {formatTime(msg.timestamp)}
                      </span>
                      {isMe && <MessageStatusIcon status={msg.status} />}
                    </div>
                  </div>

                  {/* Compliance: highlight button */}
                  {currentUserType === "compliance" &&
                    onHighlightMessage &&
                    !isMe &&
                    (msg.from as string) !== "system" && (
                      <button
                        onClick={() =>
                          onHighlightMessage(msg.id, !msg.isHighlighted)
                        }
                        className={`mt-0.5 px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                          msg.isHighlighted
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "text-gray-600 hover:text-yellow-400 hover:bg-yellow-500/10"
                        }`}
                        title={
                          msg.isHighlighted
                            ? "Remove highlight"
                            : "Highlight for investigation"
                        }
                      >
                        <Star className="w-3 h-3 inline mr-0.5" />
                        {msg.isHighlighted ? "Highlighted" : "Highlight"}
                      </button>
                    )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex items-center gap-2 px-2">
            <SenderAvatar senderType={typingActorType} />
            <div className="px-3 py-2 bg-white/[0.03] rounded-2xl border border-white/[0.04]">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-gray-500">
                  {getTypingLabel()}
                </span>
                <span className="flex gap-0.5">
                  <span
                    className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Pending image upload bubbles — optimistic UI */}
        {pendingUploads.size > 0 && (
          Array.from(pendingUploads.values())
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((upload) => (
            <div key={upload.tempId} className="flex justify-end px-3 mb-1">
              <div className="max-w-[75%] rounded-lg rounded-br-sm bg-primary/10 border border-primary/15 p-1.5">
                <ImageMessageBubble
                  imageUrl={upload.localUrl}
                  caption={upload.caption || undefined}
                  uploadStatus={upload.status}
                  uploadProgress={upload.progress}
                  onCancel={() => cancelUpload(upload.tempId)}
                  onRetry={() => retryUpload(upload.tempId)}
                  isOwn
                />
              </div>
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Upload preview */}
      {pendingFile && (
        <div className="px-3 py-2 border-t border-white/[0.04] bg-[#0d0d0d]">
          <div className="flex items-center gap-3">
            {pendingFile.category === "image" && pendingFile.previewUrl ? (
              <img
                src={pendingFile.previewUrl}
                alt="Preview"
                className="w-16 h-16 object-cover rounded-lg"
              />
            ) : (
              <div className="w-16 h-16 bg-white/[0.04] rounded-lg flex flex-col items-center justify-center">
                <FileText className="w-6 h-6 text-gray-400" />
                <span className="text-[8px] text-gray-500 mt-0.5 px-1 truncate max-w-full">
                  {pendingFile.file.name.split(".").pop()?.toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/80 truncate">
                {pendingFile.file.name}
              </p>
              <p className="text-[10px] text-gray-500">
                {formatFileSize(pendingFile.file.size)}
              </p>
              {isUploading && (
                <div className="mt-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
            {!isUploading && (
              <button
                onClick={clearPendingFile}
                className="p-1 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-2 border-t border-foreground/[0.04] bg-foreground/[0.02]">
        {/* Chat-closed banner — replaces the input row entirely when the
            backend (or the order's terminal status) has disabled chat.
            Compliance reviewers can still see the input via the freeze
            controls below; everyone else sees only this banner. */}
        {!chatEnabled && currentUserType !== "compliance" ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] text-[12px] text-foreground/50">
            <Lock className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
            <span className="truncate">
              {chatReason || "This chat is closed. You can no longer send messages."}
            </span>
          </div>
        ) : null}

        {/* Compliance controls */}
        {currentUserType === "compliance" && (
          <div className="flex items-center gap-2 mb-2">
            {onFreezeChat && (
              <button
                onClick={() => onFreezeChat(!isFrozen)}
                className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 transition-colors ${
                  isFrozen
                    ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    : "bg-white/[0.04] text-gray-400 hover:bg-white/[0.08]"
                }`}
              >
                {isFrozen ? (
                  <Unlock className="w-3 h-3" />
                ) : (
                  <Lock className="w-3 h-3" />
                )}
                {isFrozen ? "Unfreeze Chat" : "Freeze Chat"}
              </button>
            )}
          </div>
        )}

        {(chatEnabled || currentUserType === "compliance") && (
        <div className="flex items-center gap-2 w-full">
          {/* Hidden native file picker — triggered by the paperclip button inside the pill */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
            disabled={
              disabled ||
              isUploading ||
              (isFrozen && currentUserType !== "compliance")
            }
          />

          {/* Pill container: text input + attach button live inside one rounded row
              so the Send button can never be pushed off-screen by long text.
              min-w-0 on the flex parent is the critical bit — without it the
              <input> can overflow its flex cell on narrow screens. */}
          <div className="flex-1 min-w-0 flex items-center gap-1 bg-foreground/[0.04] border border-foreground/[0.06] rounded-full pl-4 pr-1.5 focus-within:border-primary/30 transition-colors">
            {/* Text input — disabled when chat is closed/frozen/waiting */}
            <input
              ref={inputRef}
              type="text"
              name="chat-message"
              autoComplete="off"
              maxLength={1000}
              value={messageText}
              onChange={(e) => handleTypingChange(e.target.value.slice(0, 1000))}
              onKeyDown={handleKeyDown}
              placeholder={
                !chatEnabled && chatReason
                  ? chatReason
                  : isFrozen && currentUserType !== "compliance"
                  ? "Chat is frozen..."
                  : "Type a message..."
              }
              disabled={
                disabled ||
                isUploading ||
                !chatEnabled ||
                (isFrozen && currentUserType !== "compliance")
              }
              className="flex-1 min-w-0 appearance-none border-0 bg-transparent py-2.5 text-sm text-foreground placeholder:text-foreground/30 outline-none focus-visible:outline-none disabled:opacity-40"
            />

            {/* Attach-file trigger — shrink-0 so it holds its width when text is long */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={
                disabled ||
                isUploading ||
                (isFrozen && currentUserType !== "compliance")
              }
              className="shrink-0 p-2 rounded-full hover:bg-foreground/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Attach file"
            >
              <Paperclip className="w-4 h-4 text-foreground/40" />
            </button>
          </div>

          {/* Send button — circular, sits outside the pill. shrink-0 keeps it
              at a fixed size; the row never wraps. */}
          <button
            onClick={handleSend}
            disabled={
              disabled ||
              isUploading ||
              (isFrozen && currentUserType !== "compliance") ||
              (!messageText.trim() && !pendingFile)
            }
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-primary hover:bg-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 text-background animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-background" />
            )}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

export default ChatRoom;
