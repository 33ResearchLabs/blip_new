'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, Store, User, CheckCheck, Paperclip, Loader2, X, Image as ImageIcon } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { ReceiptCard } from '@/components/chat/cards/ReceiptCard';
import { ImageMessageBubble, type ImageUploadStatus } from '@/components/chat/ImageMessageBubble';
import { compressImage } from '@/lib/utils/compressImage';
import dynamic from 'next/dynamic';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

interface DirectChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  timestamp: Date;
  messageType: 'text' | 'image' | 'receipt';
  receiptData?: Record<string, unknown> | null;
  imageUrl?: string | null;
  isRead: boolean;
}

interface DirectChatViewProps {
  contactName: string;
  contactType: 'user' | 'merchant';
  contactId?: string;
  messages: DirectChatMessage[];
  isLoading: boolean;
  isTyping?: boolean;
  onSendMessage: (text: string, imageUrl?: string) => void;
  onTyping?: (orderId?: string) => void;
  onBack: () => void;
  orderStatus?: string;
  hasActiveOrder?: boolean;
  /** Active order ID for this contact — needed to fire typing events on the order channel */
  activeOrderId?: string;
}

function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function DirectChatView({
  contactName,
  contactType,
  contactId,
  messages,
  isLoading,
  isTyping,
  onSendMessage,
  onTyping,
  onBack,
  orderStatus,
  hasActiveOrder = true,
  activeOrderId,
}: DirectChatViewProps) {
  // ── Mark order messages as read when merchant opens/views chat ──────
  // This fires the PATCH mark-read on the ORDER channel so the user sees ✓✓ blue.
  // Without this, the user's chat never gets read acknowledgment from the merchant.
  // Also re-fires when new messages arrive (messages.length changes) to ACK them.
  const lastAckedCountRef = useRef(0);
  useEffect(() => {
    if (!activeOrderId) return;
    // Only fire when there are new messages to acknowledge
    if (messages.length === lastAckedCountRef.current && lastAckedCountRef.current > 0) return;
    lastAckedCountRef.current = messages.length;
    fetchWithAuth(`/api/orders/${activeOrderId}/messages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reader_type: 'merchant' }),
    }).catch(() => {});
  }, [activeOrderId, messages.length]);

  // ── Live presence (online/offline + last seen) ─────────────────────
  const [presence, setPresence] = useState<{ isOnline: boolean; lastSeen: string | null } | null>(null);
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchWithAuth(`/api/presence?actorType=${contactType}&actorId=${contactId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.success) {
          setPresence({ isOnline: !!data.data?.isOnline, lastSeen: data.data?.lastSeen || null });
        }
      } catch {
        // Best-effort
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [contactId, contactType]);

  const formatLastSeen = (iso: string | null): string => {
    if (!iso) return 'offline';
    const diffMs = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emoji = getUserEmoji(contactName);

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

  // Abort all in-flight uploads on unmount
  useEffect(() => {
    return () => {
      for (const entry of pendingUploadsRef.current.values()) {
        if (entry.abortController) entry.abortController.abort();
      }
    };
  }, []);

  // Fetch live order statuses for receipt cards — poll every 10s to track status changes
  const [receiptStatuses, setReceiptStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    const orderNumbers: string[] = [];
    for (const msg of messages) {
      // New structured format
      if (msg.messageType === 'receipt' && msg.receiptData) {
        const num = msg.receiptData.order_number as string | undefined;
        if (num) orderNumbers.push(num);
        continue;
      }
      // Backward compat: old JSON-in-content format
      try {
        if (msg.text.startsWith('{')) {
          const parsed = JSON.parse(msg.text);
          if (parsed.type === 'order_receipt' && parsed.data?.order_number) {
            orderNumbers.push(parsed.data.order_number);
          }
        }
      } catch { /* not JSON */ }
    }

    if (orderNumbers.length === 0) return;

    const unique = [...new Set(orderNumbers)];
    const fetchStatuses = () => {
      fetchWithAuth(`/api/orders/status?order_numbers=${encodeURIComponent(unique.join(','))}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data) {
            setReceiptStatuses(data.data);
          }
        })
        .catch(() => { /* ignore */ });
    };

    fetchStatuses();
    const interval = setInterval(fetchStatuses, 10000);
    return () => clearInterval(interval);
  }, [messages.length]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Store file locally + show preview (no upload yet)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    if (rawFile.size > 10 * 1024 * 1024) return;
    if (!rawFile.type.startsWith('image/')) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    const file = await compressImage(rawFile, { maxDimension: 1600, quality: 0.8 });
    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ file, previewUrl });
  };

  const clearPendingImage = () => {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
  };

  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * WhatsApp-style optimistic image upload:
   *  1. Insert optimistic bubble instantly (local preview)
   *  2. Upload to Cloudinary in background with XHR progress
   *  3. On success: send real message, remove pending
   *  4. On failure: show retry button
   */
  const startImageUpload = useCallback(async (
    file: File,
    localUrl: string,
    caption: string,
    tempId: string,
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

    // Auto-scroll to see the new optimistic bubble
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    try {
      // Step 1: Get Cloudinary signature
      const sigRes = await fetchWithAuth('/api/upload/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'direct-chat' }),
        signal: abortController.signal,
      });
      if (!sigRes.ok) throw new Error('Signature request failed');
      const sigData = await sigRes.json();
      if (!sigData.success) throw new Error('Invalid signature');
      const sig = sigData.data;

      if (!sig.signature || !sig.timestamp || !sig.apiKey || !sig.cloudName || !sig.folder) {
        throw new Error('Incomplete upload credentials');
      }

      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 20 });
        return next;
      });

      // Step 2: Upload with XHR for progress tracking
      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', sig.signature);
      formData.append('timestamp', sig.timestamp.toString());
      formData.append('api_key', sig.apiKey);
      formData.append('folder', sig.folder);

      const imageUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);

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
        xhr.onerror = () => reject(new Error('Network error'));

        abortController.signal.addEventListener('abort', () => xhr.abort());
        if (abortController.signal.aborted) { xhr.abort(); return; }

        xhr.send(formData);
      });

      // Step 3: Send the real chat message
      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 95 });
        return next;
      });

      onSendMessage(caption || 'Photo', imageUrl);

      // Step 4: Remove from pending
      clearTimeout(uploadTimeout);
      setPendingUploads(prev => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });

    } catch (err: any) {
      clearTimeout(uploadTimeout);
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        setPendingUploads(prev => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
      } else {
        console.error('[DirectChatView] Image upload error:', err);
        setPendingUploads(prev => {
          const next = new Map(prev);
          const entry = next.get(tempId);
          if (entry) next.set(tempId, { ...entry, status: 'failed', progress: 0, abortController: null });
          return next;
        });
      }
    }
  }, [onSendMessage]);

  const cancelUpload = useCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (entry?.abortController) entry.abortController.abort();
    setPendingUploads(prev => {
      const next = new Map(prev);
      next.delete(tempId);
      return next;
    });
  }, []);

  const retryUpload = useCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (!entry) return;
    startImageUpload(entry.file, entry.localUrl, entry.caption, tempId);
  }, [startImageUpload]);

  /** Called when user confirms image send from preview */
  const handleImageConfirm = useCallback(async () => {
    if (!pendingImage) return;
    const tempId = `temp-img-${Date.now()}`;
    const file = await compressImage(pendingImage.file, { maxDimension: 1600, quality: 0.8 });
    const localUrl = pendingImage.previewUrl;
    const caption = inputText.trim();
    setPendingImage(null); // Close preview
    setInputText('');
    startImageUpload(file, localUrl, caption, tempId);
  }, [pendingImage, inputText, startImageUpload]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  // Group messages by date and detect consecutive same-sender groups
  let lastDate = '';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-section-divider">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-foreground/[0.06] transition-colors text-foreground/30 hover:text-foreground/50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="w-6 h-6 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center text-xs">
            {emoji}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase truncate">
                {contactName}
              </span>
              {contactType === 'merchant' ? (
                <Store className="w-2.5 h-2.5 text-primary/60" />
              ) : (
                <User className="w-2.5 h-2.5 text-foreground/25" />
              )}
            </div>
            {contactId && (
              <div className="flex items-center gap-1 mt-0.5">
                {isTyping ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-[9px] font-mono text-green-400">typing...</span>
                  </>
                ) : (
                  <>
                    <span className={`w-1.5 h-1.5 rounded-full ${presence?.isOnline ? 'bg-green-500' : 'bg-white/25'}`} />
                    <span className={`text-[9px] font-mono ${presence?.isOnline ? 'text-green-400' : 'text-foreground/35'}`}>
                      {presence?.isOnline ? 'Online' : `last seen ${formatLastSeen(presence?.lastSeen || null)}`}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-foreground/15">
            <p className="text-[10px] font-mono">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {messages.map((msg, i) => {
              const msgDate = formatDateSeparator(msg.timestamp);
              const showDate = msgDate !== lastDate;
              lastDate = msgDate;

              // Show avatar only on first message in a group from same sender
              const prevMsg = i > 0 ? messages[i - 1] : null;
              const isFirstInGroup = !prevMsg || prevMsg.from !== msg.from ||
                (msg.timestamp.getTime() - prevMsg.timestamp.getTime() > 120000); // 2 min gap = new group

              // Detect receipt card messages — structured (new) or JSON fallback (old)
              let receiptPayload: Record<string, unknown> | null = null;
              if (msg.messageType === 'receipt' && msg.receiptData) {
                receiptPayload = msg.receiptData;
              } else {
                try {
                  if (msg.text.startsWith('{')) {
                    const parsed = JSON.parse(msg.text);
                    if (parsed.type === 'order_receipt' && parsed.data) {
                      receiptPayload = parsed.data;
                    }
                  }
                } catch { /* not JSON */ }
              }

              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-2">
                      <span className="text-[9px] text-foreground/20 bg-foreground/[0.03] px-2 py-0.5 rounded-full font-mono">
                        {msgDate}
                      </span>
                    </div>
                  )}

                  {receiptPayload ? (
                    /* Receipt card — shown centered for both parties */
                    <div className="max-w-[90%] mx-auto my-2">
                      <ReceiptCard data={receiptPayload as any} currentStatus={receiptStatuses[(receiptPayload as any).order_number] || orderStatus} />
                      <span className="text-[9px] text-foreground/20 mt-1 block text-center font-mono">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  ) : msg.from === 'them' ? (
                    /* Incoming message */
                    <div className={`flex items-end gap-1.5 ${isFirstInGroup ? 'mt-2' : 'mt-0.5'}`}>
                      {isFirstInGroup ? (
                        <div className="w-5 h-5 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center text-[10px] shrink-0">
                          {emoji}
                        </div>
                      ) : (
                        <div className="w-5 shrink-0" />
                      )}
                      <div className="max-w-[80%]">
                        <div className="px-2.5 py-1.5 rounded-lg rounded-bl-sm bg-foreground/[0.04] border border-foreground/[0.06] text-[11px] text-foreground/80">
                          {msg.messageType === 'image' && msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full max-h-36 rounded-md mb-1 object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          <span className="text-[9px] text-foreground/20 ml-1.5 whitespace-nowrap font-mono">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Outgoing message */
                    <div className={`flex justify-end ${isFirstInGroup ? 'mt-2' : 'mt-0.5'}`}>
                      <div className="max-w-[80%]">
                        <div className="px-2.5 py-1.5 rounded-lg rounded-br-sm bg-primary/10 border border-primary/15 text-[11px] text-foreground/80">
                          {msg.messageType === 'image' && msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full max-h-36 rounded-md mb-1 object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          <span className="inline-flex items-center gap-0.5 ml-1.5 align-bottom">
                            <span className="text-[9px] text-foreground/20 whitespace-nowrap font-mono">
                              {formatTime(msg.timestamp)}
                            </span>
                            <CheckCheck className={`w-2.5 h-2.5 ${
                              msg.isRead ? 'text-primary/60' : 'text-foreground/15'
                            }`} />
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Pending image upload bubbles — optimistic UI */}
            {pendingUploads.size > 0 && (
              Array.from(pendingUploads.values())
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((upload) => (
                <div key={upload.tempId} className="flex justify-end mt-1">
                  <div className="max-w-[80%] px-2.5 py-1.5 rounded-lg rounded-br-sm bg-primary/10 border border-primary/15">
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
        )}
      </div>

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div className="border-t border-section-divider">
          <EmojiPicker
            onEmojiClick={(emojiData: { emoji: string }) => {
              setInputText(prev => prev + emojiData.emoji);
              setShowEmojiPicker(false);
              inputRef.current?.focus();
            }}
            width="100%"
            height={280}
            theme={"dark" as any}
            searchDisabled
            skinTonesDisabled
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}

      {/* Image preview bar */}
      {pendingImage && (
        <div className="px-2 py-1.5 border-t border-section-divider flex items-center gap-2">
          <div className="relative">
            <img
              src={pendingImage.previewUrl}
              alt="Preview"
              className="w-12 h-12 rounded-lg object-cover border border-foreground/[0.06]"
            />
            <button
              onClick={clearPendingImage}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neutral-700 flex items-center justify-center"
            >
              <X className="w-2.5 h-2.5 text-foreground" />
            </button>
          </div>
          <span className="text-[9px] text-foreground/30 font-mono flex-1">Ready to send</span>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="mx-2 mb-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-2">
          <p className="text-[10px] text-red-400">{uploadError}</p>
          <button onClick={() => setUploadError(null)} className="text-red-400/60 hover:text-red-400">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* No active order info banner — chat still works */}
      {!hasActiveOrder && (
        <div className="mx-2 mb-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-[10px] text-amber-400/80">
            No active trade with this {contactType}. You can still send messages.
          </p>
        </div>
      )}

      {/* Input */}
      <div className="px-2 py-1.5 border-t border-section-divider">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex items-center gap-1.5">
          {/* Emoji button */}
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="w-7 h-7 rounded-lg bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] transition-colors flex items-center justify-center"
            title="Emoji"
          >
            <span className="text-xs leading-none">😊</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-7 h-7 rounded-lg bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] transition-colors disabled:opacity-50 flex items-center justify-center"
            title="Attach image"
          >
            {isUploading ? (
              <Loader2 className="w-3 h-3 text-foreground/30 animate-spin" />
            ) : (
              <Paperclip className="w-3 h-3 text-foreground/30" />
            )}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); onTyping?.(activeOrderId); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (pendingImage) { handleImageConfirm(); } else { handleSend(); }
                setShowEmojiPicker(false);
              }
            }}
            placeholder={pendingImage ? "Add a caption..." : "Type a message..."}
            className="flex-1 px-3 py-1.5 text-[11px] bg-foreground/[0.02] border border-foreground/[0.06] rounded-lg
                       text-white placeholder:text-foreground/15 focus:outline-none focus:border-white/15 transition-colors font-mono"
          />
          <button
            onClick={() => {
              if (pendingImage) { handleImageConfirm(); } else { handleSend(); }
              setShowEmojiPicker(false);
            }}
            disabled={!inputText.trim() && !pendingImage}
            className={`w-7 h-7 rounded-lg border transition-colors disabled:opacity-20 flex items-center justify-center ${
              pendingImage
                ? 'bg-primary/30 border-primary/40 text-primary/80 hover:bg-primary/40'
                : 'bg-primary/20 border-primary/30 text-primary hover:bg-primary/30'
            }`}
          >
            {isUploading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DirectChatView;
