"use client";

/**
 * Global chat-toast overlay for the USER side.
 *
 * Subscribes to `chatToastBus` for inbound merchant messages and renders a
 * stack of iMessage-style popups in the top-right. Tapping a popup routes
 * the user into that order's chat.
 *
 * Design:
 *  - One popup per orderId (re-messages from the same order update the
 *    existing popup and reset its auto-dismiss timer).
 *  - Max 4 visible at once; oldest is dropped when a 5th arrives.
 *  - 5s auto-dismiss per toast (paused while hovered to avoid losing a
 *    message the user is about to tap).
 *  - Suppressed when the user is already viewing that order's chat
 *    (the publisher in `useUserEffects` gates on `screen === 'order'` and
 *    matching `activeOrderId`, so the event never fires in that case).
 *  - Zero-regression: purely additive, no data-layer changes. If the
 *    component errors or is unmounted, the existing NotificationToast
 *    path (toast.showNewMessage) still fires.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import {
  subscribeChatToast,
  type ChatToastPayload,
} from "@/lib/chat/chatToastBus";

const MAX_VISIBLE = 4;
const AUTO_DISMISS_MS = 5000;

interface ToastEntry extends ChatToastPayload {
  /** Local ID — equal to orderId (dedup key). */
  id: string;
  /** Monotonic counter for re-sorting when the same order re-messages. */
  seq: number;
}

export interface ChatToastHostProps {
  /** Called when the user taps a popup. Parent wires this to activate the
   *  order and open the chat view. */
  onOpenChat: (orderId: string) => void;
}

export const ChatToastHost = memo(function ChatToastHost({
  onOpenChat,
}: ChatToastHostProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const seqRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const hoveredIdRef = useRef<string | null>(null);

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    },
    [clearTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      const timer = setTimeout(() => {
        // Don't dismiss if the user is hovering this toast right now.
        if (hoveredIdRef.current === id) {
          scheduleDismiss(id);
          return;
        }
        dismiss(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [clearTimer, dismiss],
  );

  useEffect(() => {
    const unsubscribe = subscribeChatToast(payload => {
      const seq = ++seqRef.current;
      setToasts(prev => {
        // Dedup by orderId: if a popup for this order is still visible,
        // update its content and bump it to the top of the stack.
        const existing = prev.find(t => t.id === payload.orderId);
        if (existing) {
          const updated = prev
            .filter(t => t.id !== payload.orderId)
            .concat({ ...payload, id: payload.orderId, seq });
          return updated;
        }
        const next = [...prev, { ...payload, id: payload.orderId, seq }];
        // Cap the stack — drop the oldest (lowest seq) when over capacity.
        if (next.length > MAX_VISIBLE) {
          next.sort((a, b) => a.seq - b.seq);
          const dropped = next.slice(0, next.length - MAX_VISIBLE);
          dropped.forEach(d => clearTimer(d.id));
          return next.slice(-MAX_VISIBLE);
        }
        return next;
      });
      scheduleDismiss(payload.orderId);
    });
    return unsubscribe;
  }, [clearTimer, scheduleDismiss]);

  // Cleanup all timers on unmount.
  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const handleTap = useCallback(
    (orderId: string) => {
      dismiss(orderId);
      try {
        onOpenChat(orderId);
      } catch {
        /* swallow — routing errors must not break the toast host */
      }
    },
    [dismiss, onOpenChat],
  );

  // Render newest on top — sort descending by seq.
  const ordered = [...toasts].sort((a, b) => b.seq - a.seq);

  return (
    <div
      className="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col gap-2"
      style={{ maxWidth: "min(360px, calc(100vw - 32px))" }}
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {ordered.map(t => {
          const initial = (t.senderName || "?").charAt(0).toUpperCase();
          return (
            <motion.button
              key={t.id}
              type="button"
              layout
              initial={{ opacity: 0, y: -12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ type: "spring", damping: 24, stiffness: 320 }}
              onClick={() => handleTap(t.id)}
              onMouseEnter={() => {
                hoveredIdRef.current = t.id;
              }}
              onMouseLeave={() => {
                if (hoveredIdRef.current === t.id) {
                  hoveredIdRef.current = null;
                }
                scheduleDismiss(t.id);
              }}
              className="pointer-events-auto group relative w-full text-left rounded-2xl px-3 py-2.5 flex items-center gap-3 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-xl border"
              style={{
                background: "rgba(20, 20, 28, 0.85)",
                borderColor: "rgba(255, 255, 255, 0.08)",
              }}
            >
              {/* Avatar */}
              <div className="relative w-9 h-9 rounded-full shrink-0 overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary/30 to-primary/10 border border-white/10">
                {t.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.avatarUrl}
                    alt={t.senderName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-[13px] font-bold text-white">
                    {initial}
                  </span>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary border-2 border-[rgba(20,20,28,1)] flex items-center justify-center">
                  <MessageCircle className="w-2.5 h-2.5 text-background" />
                </span>
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white truncate">
                  {t.senderName}
                </div>
                <div className="text-[11px] text-white/60 truncate">
                  {t.preview || "Sent you a message"}
                </div>
              </div>

              {/* Close */}
              <span
                role="button"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                className="shrink-0 p-1 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
});

export default ChatToastHost;
